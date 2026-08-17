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


def _extra_expenses(cur):
    """Доп. расходы на единицу: коробки, оклады кладовщика, менеджера, уборщицы.

    Каждая строка — сумма и число вещей, на которое её делят. Владелец задаёт это
    сам: система не может знать, что коробка за 250 ₽ рассчитана на 30 отправлений,
    а оклад в 60 000 ₽ — на 4000 вещей в месяц.
    """
    cur.execute(
        "SELECT id, name, amount, per_items, note, is_active "
        "FROM cost_extra_expenses ORDER BY id"
    )
    rows = []
    for r in cur.fetchall():
        amount = float(r[2] or 0)
        per = int(r[3] or 1) or 1
        rows.append({
            'id': r[0],
            'name': r[1],
            'amount': amount,
            'perItems': per,
            'note': r[4],
            'isActive': bool(r[5]),
            # Сколько ложится на одну вещь.
            'perUnit': round(amount / per, 4),
        })
    return rows


def _calc_groups(cur, settings):
    """Себестоимость по ТКАНИ и ШИРИНЕ, а не по каждому товару.

    Высота изделия на себестоимость не влияет: полотно кроят по ширине, тесьму
    пришивают по ширине, пакет берут по ширине. Проверено по данным — внутри одной
    пары «ткань + ширина» расход материалов одинаковый при любой высоте.

    Поэтому 875 карточек товара схлопываются в 56 реальных сочетаний (8 тканей на
    7 ширин). Владельцу не нужно листать сотни одинаковых плашек: он смотрит ткань
    и переключает ширину.
    """
    prices = _material_prices(cur)
    cutter_rates, sewer_rates, packer_rate = _rates(cur, settings['workshopId'])
    extras = _extra_expenses(cur)
    extra_per_unit = round(sum(e['perUnit'] for e in extras if e['isActive']), 4)

    # Берём ОДИН товар-образец на каждую пару «ткань + ширина»: расход внутри пары
    # одинаковый, а высоту мы намеренно не различаем.
    cur.execute(
        "SELECT mi.material, mi.width, mim.material_id, mim.quantity, "
        "       COUNT(*) OVER (PARTITION BY mi.material, mi.width) "
        "FROM marketplace_items mi "
        "LEFT JOIN marketplace_item_materials mim ON mim.marketplace_item_id = mi.id "
        "WHERE mi.id IN ("
        "  SELECT DISTINCT ON (material, width) id FROM marketplace_items "
        "  ORDER BY material, width, id"
        ") "
        "ORDER BY mi.material, mi.width"
    )

    groups = {}
    for r in cur.fetchall():
        key = (r[0], r[1])
        if key not in groups:
            groups[key] = {'material': r[0], 'width': r[1], 'materials': []}
        if r[2] is not None:
            p = prices.get(r[2], {'name': '?', 'unit': '', 'typeName': '',
                                  'price': 0.0, 'priceSource': 'none'})
            qty = float(r[3] or 0)
            # Ткань определяем по РАСХОДУ, а не по названию в карточке: там пишут
            # руками и сокращают («Вуаль (без ут)» вместо «Вуаль без утяжелителя»),
            # и тариф закройщика по такому названию не находился.
            if p['typeName'] == 'Тюль':
                groups[key]['fabricMaterialId'] = r[2]
            groups[key]['materials'].append({
                'materialId': r[2],
                'name': p['name'],
                'typeName': p['typeName'],
                'unit': p['unit'],
                'quantity': round(qty, 3),
                'pricePerUnit': p['price'],
                'sum': round(qty * p['price'], 2),
                'priceSource': p['priceSource'],
            })

    # Сколько товаров стоит за каждой парой — владельцу видно, что плашка
    # закрывает не одну позицию, а весь ряд высот.
    cur.execute(
        "SELECT material, width, COUNT(*) FROM marketplace_items GROUP BY material, width"
    )
    counts = {(r[0], r[1]): int(r[2]) for r in cur.fetchall()}

    cur.execute(
        "SELECT m.id, m.name FROM materials m "
        "JOIN material_types mt ON mt.id = m.type_id WHERE mt.name = 'Тюль'"
    )
    fabric_by_name = {r[1]: r[0] for r in cur.fetchall()}

    result = []
    for (material, width_raw), g in groups.items():
        width = float(width_raw or 0)
        meters = round(width / 100, 2) if width else 0.0

        fabric_cost = sum(m['sum'] for m in g['materials'] if m['typeName'] == 'Тюль')
        trim_cost = sum(m['sum'] for m in g['materials'] if m['typeName'] == 'Аксессуары')
        pack_cost = sum(m['sum'] for m in g['materials'] if m['typeName'] == 'Упаковка')
        materials_cost = fabric_cost + trim_cost + pack_cost

        # РАБОТА — по тем же формулам, по которым система начисляет зарплату:
        # закройщику за метраж ширины, швее за штуку по ширине, упаковщице за метраж.
        fabric_id = g.get('fabricMaterialId') or fabric_by_name.get(material)
        cut_cost = round(meters * cutter_rates.get(fabric_id, 0.0), 2) if fabric_id else 0.0
        sew_cost = round(sewer_rates.get(int(width), 0.0), 2) if width else 0.0
        pack_work = round(meters * packer_rate, 2)
        labor_cost = cut_cost + sew_cost + pack_work

        # Прочие расходы: список статей владельца плюс старое общее поле.
        overhead = round(extra_per_unit + settings['overheadPerItem'], 2)
        base = materials_cost + labor_cost + overhead
        tax = round(base * settings['taxPercent'] / 100, 2)
        commission = round(base * settings['marketplacePercent'] / 100, 2)
        total = round(base + tax + commission, 2)

        result.append({
            'material': material,
            'width': width_raw,
            'productsCount': counts.get((material, width_raw), 0),
            'materials': g['materials'],
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
            'missing': [
                *(['Не задан расход материалов'] if not g['materials'] else []),
                *(['Нет тарифа закройщика'] if cut_cost == 0 else []),
                *(['Нет тарифа швеи'] if sew_cost == 0 else []),
                *([f'Нет цены: {m["name"]}'
                   for m in g['materials'] if m['priceSource'] == 'none']),
            ],
        })

    result.sort(key=lambda x: (x['material'] or '', x['width'] or 0))
    return result, extras


def handler(event: dict, context) -> dict:
    """Себестоимость одной единицы товара.

    Считает, во сколько обходится одна вещь: ткань и фурнитура по ценам поставщиков,
    оплата раскроя, пошива и стикеровки по тарифам цеха, прочие расходы, налог и
    комиссия площадки. Цены и тарифы берутся из системы и всегда актуальны.

    Считается по ТКАНИ и ШИРИНЕ: высота на себестоимость не влияет — кроят, обшивают
    и пакуют по ширине. 875 карточек товара сводятся к 56 реальным сочетаниям.

    GET  /                                        - себестоимость по тканям и ширинам
    POST /  { action: 'save_settings', ... }      - налог, комиссия, цех
    POST /  { action: 'add_expense', name, amount, perItems, note }  - статья расходов
    POST /  { action: 'update_expense', id, ... } - изменить статью
    POST /  { action: 'delete_expense', id }      - удалить статью
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            settings = _settings(cur)
            groups, extras = _calc_groups(cur, settings)
            cur.execute("SELECT id, name FROM workshops ORDER BY id")
            workshops = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
            return _resp(200, {
                'settings': settings,
                'groups': groups,
                'extras': extras,
                'workshops': workshops,
            })

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            action = body_data.get('action')

            # СТАТЬИ ДОПОЛНИТЕЛЬНЫХ РАСХОДОВ.
            # Владелец сам решает, что и на сколько штук делить: коробку на 30
            # отправлений, оклад кладовщика на 4000 вещей в месяц.
            if action in ('add_expense', 'update_expense'):
                name = (body_data.get('name') or '').strip()
                if not name:
                    return _resp(400, {'error': 'Укажите название расхода'})
                try:
                    amount = float(body_data.get('amount') or 0)
                    per_items = int(body_data.get('perItems') or 1)
                except (TypeError, ValueError):
                    return _resp(400, {'error': 'Сумма и количество должны быть числами'})
                if amount < 0:
                    return _resp(400, {'error': 'Сумма не может быть отрицательной'})
                if per_items < 1:
                    return _resp(400, {'error': 'Делить нужно хотя бы на 1 штуку'})
                note = (body_data.get('note') or '').strip() or None
                is_active = body_data.get('isActive', True)

                if action == 'add_expense':
                    cur.execute(
                        "INSERT INTO cost_extra_expenses (name, amount, per_items, note, "
                        "  is_active) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                        (name, amount, per_items, note, bool(is_active)),
                    )
                    new_id = cur.fetchone()[0]
                    conn.commit()
                    return _resp(200, {'id': new_id})

                expense_id = body_data.get('id')
                if not expense_id:
                    return _resp(400, {'error': 'Укажите id'})
                cur.execute(
                    "UPDATE cost_extra_expenses SET name = %s, amount = %s, "
                    "  per_items = %s, note = %s, is_active = %s WHERE id = %s",
                    (name, amount, per_items, note, bool(is_active), int(expense_id)),
                )
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'delete_expense':
                expense_id = body_data.get('id')
                if not expense_id:
                    return _resp(400, {'error': 'Укажите id'})
                cur.execute(
                    "DELETE FROM cost_extra_expenses WHERE id = %s", (int(expense_id),)
                )
                conn.commit()
                return _resp(200, {'ok': True})

            if action != 'save_settings':
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