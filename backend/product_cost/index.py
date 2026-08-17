import json
import os

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def _settings(cur):
    """Настройки расчёта: налог, комиссия площадки, прочие расходы, цех для тарифов."""
    cur.execute(
        "SELECT tax_percent, marketplace_percent, overhead_per_item, workshop_id "
        "FROM cost_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return {'taxPercent': 0.0, 'marketplacePercent': 0.0,
                'overheadPerItem': 0.0, 'workshopId': None}
    return {
        'taxPercent': float(r[0] or 0),
        'marketplacePercent': float(r[1] or 0),
        'overheadPerItem': float(r[2] or 0),
        'workshopId': r[3],
    }


def _material_prices(cur):
    """Актуальная цена каждого материала за единицу.

    Цену берём из прайса поставщика с его курсом валюты — это «живая» цена: меняется
    прайс, меняется и себестоимость, без ручного ввода. Из нескольких поставщиков
    берём максимальную: считать выгодно по худшему сценарию, иначе себестоимость
    окажется занижена и товар будет казаться прибыльнее, чем он есть.

    Прайса нет (старый материал, разовая закупка) — падаем на среднюю цену рулонов,
    лежащих на складе. Это фактические деньги, уже потраченные на этот материал.
    """
    cur.execute(
        "SELECT m.id, m.name, m.unit, mt.name, "
        "  (SELECT MAX(sp.price * COALESCE(s.exchange_rate, 1)) "
        "     FROM supplier_prices sp "
        "     JOIN suppliers s ON s.id = sp.supplier_id "
        "    WHERE sp.material_id = m.id), "
        "  (SELECT AVG(NULLIF(r.cost_per_unit, 0)) FROM rolls r "
        "    WHERE r.material_id = m.id "
        "      AND r.status IN ('in_storage', 'in_workshop')) "
        "FROM materials m "
        "LEFT JOIN material_types mt ON mt.id = m.type_id"
    )
    out = {}
    for r in cur.fetchall():
        supplier_price = float(r[4]) if r[4] is not None else None
        roll_price = float(r[5]) if r[5] is not None else None
        price = supplier_price if supplier_price else (roll_price or 0.0)
        out[r[0]] = {
            'name': r[1],
            'unit': r[2],
            'typeName': r[3] or '',
            'price': round(price, 4),
            # Откуда взяли цену — владелец должен видеть, чему верить.
            'priceSource': 'supplier' if supplier_price else ('rolls' if roll_price else 'none'),
        }
    return out


def _rates(cur, workshop_id):
    """Тарифы работ выбранного цеха.

    Закройщик — ставка за пог.м. по конкретной ткани (width IS NULL).
    Швея — ставка за штуку по ширине изделия.
    Упаковщик — ставка за пог.м., одна на цех.
    """
    cutter = {}
    sewer = {}
    packer = 0.0
    if not workshop_id:
        return cutter, sewer, packer

    cur.execute(
        "SELECT material_id, rate FROM salary_rates "
        "WHERE role = 'cutter' AND width IS NULL AND workshop_id = %s AND rate > 0",
        (int(workshop_id),),
    )
    cutter = {r[0]: float(r[1]) for r in cur.fetchall()}

    cur.execute(
        "SELECT width, rate FROM salary_rates "
        "WHERE role = 'sewer' AND width IS NOT NULL AND workshop_id = %s AND rate > 0",
        (int(workshop_id),),
    )
    sewer = {int(r[0]): float(r[1]) for r in cur.fetchall()}

    cur.execute(
        "SELECT MAX(rate) FROM salary_rates WHERE role = 'packer' AND workshop_id = %s",
        (int(workshop_id),),
    )
    row = cur.fetchone()
    packer = float(row[0]) if row and row[0] else 0.0
    return cutter, sewer, packer


def _calc_items(cur, settings):
    """Себестоимость каждого товара: материалы + работа + прочее + налог."""
    prices = _material_prices(cur)
    cutter_rates, sewer_rates, packer_rate = _rates(cur, settings['workshopId'])

    cur.execute(
        "SELECT mi.id, mi.name, mi.width, mi.height, mi.material, "
        "       mim.material_id, mim.quantity "
        "FROM marketplace_items mi "
        "LEFT JOIN marketplace_item_materials mim ON mim.marketplace_item_id = mi.id "
        "ORDER BY mi.name, mi.id"
    )

    items = {}
    for r in cur.fetchall():
        item_id = r[0]
        if item_id not in items:
            items[item_id] = {
                'id': item_id,
                'name': r[1],
                'width': r[2],
                'height': r[3],
                'material': r[4],
                'materials': [],
            }
        if r[5] is not None:
            p = prices.get(r[5], {'name': '?', 'unit': '', 'typeName': '',
                                  'price': 0.0, 'priceSource': 'none'})
            qty = float(r[6] or 0)
            # Ткань изделия определяем по РАСХОДУ, а не по названию в карточке.
            # Название там пишут вручную и сокращают: «Вуаль (без ут)» вместо
            # «Вуаль без утяжелителя» — по такому тариф закройщика не находился,
            # и у 91 товара работа кроя считалась нулевой.
            if p['typeName'] == 'Тюль':
                items[item_id]['fabricMaterialId'] = r[5]
            items[item_id]['materials'].append({
                'materialId': r[5],
                'name': p['name'],
                'typeName': p['typeName'],
                'unit': p['unit'],
                'quantity': round(qty, 3),
                'pricePerUnit': p['price'],
                'sum': round(qty * p['price'], 2),
                'priceSource': p['priceSource'],
            })

    # Сопоставление названия ткани с её id: тариф закройщика задан на материал.
    cur.execute(
        "SELECT m.id, m.name FROM materials m "
        "JOIN material_types mt ON mt.id = m.type_id WHERE mt.name = 'Тюль'"
    )
    fabric_by_name = {r[1]: r[0] for r in cur.fetchall()}

    result = []
    for it in items.values():
        width = float(it['width'] or 0)
        meters = round(width / 100, 2) if width else 0.0

        # МАТЕРИАЛЫ, разложенные по назначению — так владелец видит,
        # где именно сидят деньги: в ткани, в тесьме или в упаковке.
        fabric_cost = sum(m['sum'] for m in it['materials'] if m['typeName'] == 'Тюль')
        trim_cost = sum(m['sum'] for m in it['materials'] if m['typeName'] == 'Аксессуары')
        pack_cost = sum(m['sum'] for m in it['materials'] if m['typeName'] == 'Упаковка')
        materials_cost = fabric_cost + trim_cost + pack_cost

        # РАБОТА. Считаем ровно по тем же формулам, по которым система реально
        # начисляет зарплату, — иначе себестоимость разойдётся с кассой.
        #
        # Ткань берём из состава изделия, а если расход не задан — пробуем по
        # названию в карточке.
        fabric_id = it.get('fabricMaterialId') or fabric_by_name.get(it['material'])
        cut_cost = round(meters * cutter_rates.get(fabric_id, 0.0), 2) if fabric_id else 0.0
        sew_cost = round(sewer_rates.get(int(width), 0.0), 2) if width else 0.0
        pack_work = round(meters * packer_rate, 2)
        labor_cost = cut_cost + sew_cost + pack_work

        overhead = settings['overheadPerItem']
        # База до налога: всё, что мы реально тратим на вещь.
        base = materials_cost + labor_cost + overhead
        tax = round(base * settings['taxPercent'] / 100, 2)
        commission = round(base * settings['marketplacePercent'] / 100, 2)
        total = round(base + tax + commission, 2)

        result.append({
            **{k: v for k, v in it.items() if k != 'fabricMaterialId'},
            'fabricCost': round(fabric_cost, 2),
            'trimCost': round(trim_cost, 2),
            'packCost': round(pack_cost, 2),
            'materialsCost': round(materials_cost, 2),
            'cutCost': cut_cost,
            'sewCost': sew_cost,
            'packWorkCost': pack_work,
            'laborCost': round(labor_cost, 2),
            'overhead': overhead,
            'tax': tax,
            'commission': commission,
            'total': total,
            # Чего не хватает для честной цифры: без этого владелец не поймёт,
            # почему у одного товара себестоимость 300 ₽, а у соседнего 12 ₽.
            'missing': [
                *(['Не задан расход материалов'] if not it['materials'] else []),
                *(['Нет тарифа закройщика'] if cut_cost == 0 else []),
                *(['Нет тарифа швеи'] if sew_cost == 0 else []),
                *([f'Нет цены: {m["name"]}'
                   for m in it['materials'] if m['priceSource'] == 'none']),
            ],
        })

    result.sort(key=lambda x: -x['total'])
    return result


def handler(event: dict, context) -> dict:
    """Себестоимость одной единицы товара.

    Считает, во сколько обходится одна вещь: ткань и фурнитура по ценам поставщиков,
    оплата раскроя, пошива и стикеровки по тарифам цеха, прочие расходы, налог и
    комиссия площадки. Цены и тарифы берутся из системы и всегда актуальны.

    GET  /                               - себестоимость всех товаров + настройки
    POST /  { action: 'save_settings', taxPercent, marketplacePercent,
              overheadPerItem, workshopId }  - изменить параметры расчёта
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            settings = _settings(cur)
            items = _calc_items(cur, settings)
            cur.execute("SELECT id, name FROM workshops ORDER BY id")
            workshops = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
            return _resp(200, {
                'settings': settings,
                'items': items,
                'workshops': workshops,
            })

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            if body_data.get('action') != 'save_settings':
                return _resp(400, {'error': 'Неизвестное действие'})

            def num(key, default=0.0):
                try:
                    return float(body_data.get(key, default) or 0)
                except (TypeError, ValueError):
                    return default

            tax = num('taxPercent')
            commission = num('marketplacePercent')
            overhead = num('overheadPerItem')
            workshop_id = body_data.get('workshopId')
            if tax < 0 or tax > 100 or commission < 0 or commission > 100:
                return _resp(400, {'error': 'Проценты должны быть от 0 до 100'})

            cur.execute("SELECT id FROM cost_settings ORDER BY id LIMIT 1")
            row = cur.fetchone()
            if row:
                cur.execute(
                    "UPDATE cost_settings SET tax_percent = %s, marketplace_percent = %s, "
                    "  overhead_per_item = %s, workshop_id = %s, updated_at = now(), "
                    "  updated_by = %s WHERE id = %s",
                    (tax, commission, overhead,
                     int(workshop_id) if workshop_id else None,
                     body_data.get('actorId'), row[0]),
                )
            else:
                cur.execute(
                    "INSERT INTO cost_settings (tax_percent, marketplace_percent, "
                    "  overhead_per_item, workshop_id, updated_by) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (tax, commission, overhead,
                     int(workshop_id) if workshop_id else None,
                     body_data.get('actorId')),
                )
            conn.commit()
            return _resp(200, {'ok': True})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()