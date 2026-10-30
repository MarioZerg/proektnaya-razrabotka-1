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


def _is_admin(cur, actor_id):
    """Менять параметры расчёта может только администратор.

    Менеджер видит себестоимость — ему важно знать нижнюю границу цены при торге
    с площадками. Но налог, комиссия и статьи расходов — деньги владельца: сдвинув
    их, менеджер сдвинул бы себе и границу торга.
    """
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _settings(cur):
    """Настройки расчёта: прочие расходы и цех, по тарифам которого считаем работу.

    Налога и комиссии площадки здесь больше нет: они зависят от цены продажи, а
    не от затрат цеха, и живут в юнит-экономике. Колонки в таблице остались —
    их читают старые расчёты, но себестоимость их не использует.
    """
    cur.execute(
        "SELECT overhead_per_item, workshop_id, shortage_percent "
        "FROM cost_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return {'overheadPerItem': 0.0, 'workshopId': None,
                'shortagePercent': 5.0}
    return {
        'overheadPerItem': float(r[0] or 0),
        # Надбавка на недостачи: обрезки, брак и пересорт материалов.
        'shortagePercent': float(r[2] if r[2] is not None else 5),
        'workshopId': r[1],
    }


def _material_prices(cur):
    """Цена материала за единицу — по ПОСЛЕДНЕЙ поставке этого материала.

    В одну приёмку собирают всех поставщиков: ткань, тесьму, пакеты. Каждый
    материал берёт цену из своей последней завершённой приёмки, где цена вписана
    (средняя по метражу рулонов этой приёмки). Нет такой поставки — прайс
    поставщика, нет и его — «нет цены».
    """
    cur.execute(
        "WITH last_supply AS ("
        "  SELECT DISTINCT ON (r.material_id) r.material_id, s.id AS shipment_id, "
        "         COALESCE(s.completed_at, s.created_at) AS dt "
        "  FROM rolls r JOIN shipments s ON s.id = r.shipment_id "
        "  WHERE s.type = 'from_supplier' AND s.status = 'Завершено' "
        "    AND r.cost_per_unit > 0 AND r.removed_at IS NULL "
        "  ORDER BY r.material_id, COALESCE(s.completed_at, s.created_at) DESC, s.id DESC"
        "), last_price AS ("
        "  SELECT ls.material_id, ls.shipment_id, ls.dt, "
        "         SUM(r.cost_per_unit * NULLIF(r.initial_quantity, 0)) "
        "           / NULLIF(SUM(NULLIF(r.initial_quantity, 0)), 0) AS price, "
        "         AVG(r.cost_per_unit) AS avg_price "
        "  FROM last_supply ls JOIN rolls r "
        "    ON r.shipment_id = ls.shipment_id AND r.material_id = ls.material_id "
        "  WHERE r.cost_per_unit > 0 AND r.removed_at IS NULL "
        "  GROUP BY ls.material_id, ls.shipment_id, ls.dt"
        ") "
        "SELECT m.id, m.name, m.unit, mt.name, "
        "  COALESCE(lp.price, lp.avg_price), lp.shipment_id, lp.dt, "
        "  (SELECT MAX(sp.price * COALESCE(s.exchange_rate, 1)) "
        "     FROM supplier_prices sp "
        "     JOIN suppliers s ON s.id = sp.supplier_id "
        "    WHERE sp.material_id = m.id) "
        "FROM materials m "
        "LEFT JOIN material_types mt ON mt.id = m.type_id "
        "LEFT JOIN last_price lp ON lp.material_id = m.id"
    )
    out = {}
    for r in cur.fetchall():
        supply_price = float(r[4]) if r[4] is not None else None
        supplier_price = float(r[7]) if r[7] is not None else None
        if supply_price:
            price, source = supply_price, 'supply'
        elif supplier_price:
            price, source = supplier_price, 'supplier'
        else:
            price, source = 0.0, 'none'
        out[r[0]] = {
            'name': r[1],
            'unit': r[2],
            'typeName': r[3] or '',
            'price': round(price, 4),
            'priceSource': source,
            'shipmentId': r[5] if supply_price else None,
            'shipmentDate': r[6].isoformat() if supply_price and r[6] else None,
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
        "SELECT id, name, amount, per_items, note, is_active, channel, is_monthly "
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
            # Куда относится расход: all — все каналы, marketplaces — только
            # маркетплейсы, site — только сайт. Сайт не платит за «Премиум OZON».
            'channel': r[6] or 'all',
            # Ежемесячный (аренда, оклад) — при расчёте «только сайт» делится на
            # продажи сайта. Не ежемесячный (коробка на 30 отправок) — норма на вещь.
            'isMonthly': bool(r[7]),
            # Сколько ложится на одну вещь.
            'perUnit': round(amount / per, 4),
        })
    return rows


SALARIED_TYPES = ('storekeeper_shift', 'senior_storekeeper_shift', 'cleaner_shift',
                  'packer_returns_shift', 'admin_daily')
SALARIED_LABELS = {
    'storekeeper_shift': 'Кладовщики',
    'senior_storekeeper_shift': 'Старший кладовщик',
    'cleaner_shift': 'Уборщица',
    'packer_returns_shift': 'Упаковщица-возвраты',
    'admin_daily': 'Администратор',
}


def _salaried(cur):
    """Окладные начисления из «Финансов» на одну изготовленную вещь.

    Берём прошлый ПОЛНЫЙ месяц: текущий ещё не закончен, и деление половины
    окладов на половину выпуска шатало бы цифру каждый день. Изготовленные
    вещи — те, за пошив которых начислено швеям.
    """
    types_sql = ','.join(f"'{t}'" for t in SALARIED_TYPES)
    period = ("accrued_for >= date_trunc('month', (now() + interval '3 hours')) - interval '1 month' "
              "AND accrued_for < date_trunc('month', (now() + interval '3 hours'))")
    cur.execute(
        f"SELECT type, COALESCE(SUM(amount), 0) FROM salary_accruals "
        f"WHERE type IN ({types_sql}) AND {period} GROUP BY type"
    )
    parts = [{'type': t, 'label': SALARIED_LABELS.get(t, t), 'amount': round(float(a or 0), 2)}
             for t, a in cur.fetchall() if float(a or 0) != 0]
    cur.execute(
        f"SELECT COUNT(DISTINCT order_id), "
        f"  to_char(date_trunc('month', (now() + interval '3 hours')) - interval '1 month', 'YYYY-MM') "
        f"FROM salary_accruals WHERE type = 'sewer_piece' AND order_id IS NOT NULL AND {period}"
    )
    made, month = cur.fetchone()
    made = int(made or 0)
    total = round(sum(p['amount'] for p in parts), 2)
    return {
        'month': month,
        'total': total,
        'madeUnits': made,
        'perUnit': round(total / made, 4) if made else 0.0,
        'parts': sorted(parts, key=lambda p: -p['amount']),
    }


def _sold_units(cur, days=30):
    """Сколько вещей РЕАЛЬНО продано за период — по всем площадкам и схемам.

    Нужно, чтобы делить оклады и прочие постоянные расходы на честное число,
    а не на прикидку «примерно 4000 в месяц». Ошибка в делителе бьёт по всей
    себестоимости разом: оклад 60 000 ₽ при делении на 3300 даёт 18 ₽ на вещь,
    а при делении на 1234 — уже 49 ₽.

    ГЛАВНАЯ ТОНКОСТЬ — FBO.

    По нашим заказам такое число не посчитать. В таблице orders живут только
    FBS-отправления: их мы собираем и клеим стикеры сами. FBO-продажи — товар
    заранее увезли на склад площадки, и оттуда он уходит покупателю без нашего
    участия — в заказы не попадают вовсе. То, что лежит там с пометкой FBO, —
    это заявки на поставку и оформленные возвраты, а не продажи.

    А FBO — это больше половины оборота: 750 штук против 484 FBS. Считая только
    по заказам, мы теряли 61% продаж и завышали расходы на вещь.

    Поэтому по OZON берём цифру из финансовых операций площадки (её кладёт
    синхронизация рекламы, см. backend/ad_spend): там видно обе схемы, и каждая
    строка означает, что деньги за товар получены. По WB и Яндексу такой
    выгрузки нет — там считаем по своим заказам.
    """
    out = []
    total = 0

    # OZON: обе схемы из данных площадки.
    cur.execute(
        "SELECT sold_units, sold_units_fbo, sold_units_fbs, "
        "       delivered_units, returned_units "
        "FROM marketplace_ad_spend "
        "WHERE marketplace_code = 'ozon' AND marketplace_item_id IS NULL"
    )
    row = cur.fetchone()
    if row and row[0]:
        total += int(row[0])
        out.append({
            'marketplace': 'OZON',
            'net': int(row[0]),
            'fbo': int(row[1] or 0),
            'fbs': int(row[2] or 0),
            # Обе половины итога: сколько уехало и сколько вернулось. Без них
            # нельзя проверить, вычтены возвраты или нет, — а на это число
            # делятся все постоянные расходы.
            'delivered': int(row[3] or 0),
            'returned': int(row[4] or 0),
            'source': 'marketplace',
        })

    # WB и Яндекс: по своим заказам. Статуса доставки у них в системе нет,
    # поэтому берём отгруженные — это ближайшее, что есть.
    cur.execute(
        "SELECT o.marketplace, count(*) "
        "FROM orders o "
        "WHERE o.cancelled_at IS NULL "
        "  AND o.marketplace <> 'OZON' "
        "  AND o.status = 'Отгружен' "
        f"  AND o.created_at >= now() - interval '{int(days)} days' "
        "GROUP BY o.marketplace"
    )
    for mp, cnt in cur.fetchall():
        total += int(cnt)
        out.append({
            'marketplace': mp,
            'net': int(cnt),
            'fbo': 0,
            'fbs': int(cnt),
            'delivered': int(cnt),
            'returned': 0,
            'source': 'orders',
        })

    return {'days': int(days), 'total': total, 'byMarketplace': out}


def _calc_groups(cur, settings, salaried_per_unit=0.0):
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
    # Расходы «только для сайта» в себестоимость маркетплейсов не попадают.
    extra_per_unit = round(sum(e['perUnit'] for e in extras
                               if e['isActive'] and e.get('channel') != 'site'), 4)
    salaried_cost = round(float(salaried_per_unit or 0), 4)

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
                'shipmentId': p.get('shipmentId'),
                'shipmentDate': p.get('shipmentDate'),
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

    shortage_pct = settings.get('shortagePercent', 5.0)

    result = []
    for (material, width_raw), g in groups.items():
        width = float(width_raw or 0)
        meters = round(width / 100, 2) if width else 0.0

        fabric_cost = sum(m['sum'] for m in g['materials'] if m['typeName'] == 'Тюль')
        trim_cost = sum(m['sum'] for m in g['materials'] if m['typeName'] == 'Аксессуары')
        pack_cost = sum(m['sum'] for m in g['materials'] if m['typeName'] == 'Упаковка')
        materials_cost = fabric_cost + trim_cost + pack_cost

        # НЕДОСТАЧИ МАТЕРИАЛОВ — отдельной строкой.
        #
        # Ткань, тесьма, пакеты и этикетки уходят не только в изделие: обрезки
        # при раскрое, брак, пересорт. Эти метры оплачены поставщику, но в
        # готовой вещи их нет. Без этой надбавки себестоимость занижена, и
        # прибыль на бумаге выглядит больше настоящей.
        shortage_cost = round(materials_cost * shortage_pct / 100, 2)

        # РАБОТА — по тем же формулам, по которым система начисляет зарплату:
        # закройщику за метраж ширины, швее за штуку по ширине, упаковщице за метраж.
        fabric_id = g.get('fabricMaterialId') or fabric_by_name.get(material)
        cut_cost = round(meters * cutter_rates.get(fabric_id, 0.0), 2) if fabric_id else 0.0
        sew_cost = round(sewer_rates.get(int(width), 0.0), 2) if width else 0.0
        pack_work = round(meters * packer_rate, 2)
        # Оклады склада и уборки из «Финансов» — тоже работа цеха, а не прочие расходы.
        salaried_work = round(salaried_cost, 2)
        labor_cost = cut_cost + sew_cost + pack_work + salaried_work

        # Прочие расходы: список статей владельца плюс старое общее поле.
        overhead = round(
            extra_per_unit + settings['overheadPerItem'], 2
        )

        # СЕБЕСТОИМОСТЬ — ТОЛЬКО НАШИ ЗАТРАТЫ.
        #
        # Раньше сюда добавлялись налог и комиссия площадки, посчитанные ОТ
        # ЗАТРАТ. Это давало неверную цифру дважды:
        #
        #  · налог платится с ВЫРУЧКИ, а не с себестоимости. Считать его от
        #    затрат — всё равно что платить процент с расходов;
        #  · комиссия площадки берётся с ЦЕНЫ ПРОДАЖИ. При комиссии 58% от
        #    затрат вещь за 500 ₽ «дорожала» на 290 ₽, хотя площадка возьмёт
        #    свои проценты совсем с другой суммы.
        #
        # Оба расхода теперь считает юнит-экономика — от цены продажи, как и
        # положено. Здесь остаётся честный ответ на вопрос «во сколько вещь
        # обходится цеху»: материалы, работа и накладные.
        total = round(materials_cost + shortage_cost + labor_cost
                      + overhead, 2)

        result.append({
            'material': material,
            'width': width_raw,
            'productsCount': counts.get((material, width_raw), 0),
            'materials': g['materials'],
            'fabricCost': round(fabric_cost, 2),
            'trimCost': round(trim_cost, 2),
            'packCost': round(pack_cost, 2),
            'materialsCost': round(materials_cost, 2),
            'shortageCost': shortage_cost,
            'shortagePercent': shortage_pct,
            'cutCost': cut_cost,
            'sewCost': sew_cost,
            'packWorkCost': pack_work,
            'salariedCost': salaried_work,
            'laborCost': round(labor_cost, 2),
            'overhead': overhead,
            # Из чего сложились прочие расходы: ручные статьи и менеджер.
            'overheadExtra': round(extra_per_unit + settings['overheadPerItem'], 2),
            'total': total,
            'missing': [
                *(['Не задан расход материалов'] if not g['materials'] else []),
                *(['Нет тарифа закройщика'] if cut_cost == 0 else []),
                *(['Нет тарифа швеи'] if sew_cost == 0 else []),
                *([f'Нет цены ни в одной поставке: {m["name"]}'
                   for m in g['materials'] if m['priceSource'] == 'none']),
            ],
        })

    result.sort(key=lambda x: (x['material'] or '', x['width'] or 0))
    return result, extras


def _site_channel(cur, groups, extras, salaried, settings):
    """Себестоимость для интернет-магазина рядом с маркетплейсами.

    Материалы и сдельная работа одинаковы. Различаются постоянные расходы:
      · маркетплейсы несут статьи «все каналы» и «маркетплейсы»;
      · сайт — «все каналы» и «сайт». Режим из настроек цен сайта: shared —
        ежемесячные суммы делятся на все продажи, site_only — только на план сайта.
        Ежемесячная статья «только сайт» всегда делится на план сайта.
    Дописывает в каждую группу siteFixed и siteTotal, mpFixed.
    """
    try:
        cur.execute("SELECT fixed_mode, site_monthly_units FROM site_pricing_settings ORDER BY id LIMIT 1")
        row = cur.fetchone()
    except Exception:
        row = None
    mode = (row[0] if row else None) or 'shared'
    units = max(int((row[1] if row else 0) or 300), 1)
    sal_site = salaried['perUnit'] if mode == 'shared' else salaried['total'] / units
    site_extra = 0.0
    for e in extras:
        if not e['isActive'] or e.get('channel') == 'marketplaces':
            continue
        if e.get('isMonthly', True) and (mode == 'site_only' or e.get('channel') == 'site'):
            site_extra += e['amount'] / units
        else:
            site_extra += e['perUnit']
    site_fixed = round(sal_site + site_extra + settings['overheadPerItem'], 2)
    for g in groups:
        mp_fixed = round((g.get('salariedCost') or 0) + (g.get('overhead') or 0), 2)
        g['mpFixed'] = mp_fixed
        g['siteFixed'] = site_fixed
        g['siteTotal'] = round(g['total'] - mp_fixed + site_fixed, 2)
    return {'mode': mode, 'units': units, 'fixedPerUnit': site_fixed}


def handler(event: dict, context) -> dict:
    """Себестоимость одной единицы товара.

    Считает, во сколько обходится одна вещь ЦЕХУ: ткань и фурнитура по ценам
    поставщиков, оплата раскроя, пошива и стикеровки по тарифам цеха, прочие
    расходы. Цены и тарифы берутся из системы и всегда актуальны.

    Налога и комиссии площадки здесь НЕТ: они зависят от цены продажи, а не от
    затрат, и считаются в юнит-экономике — там же, где комиссия по каждой
    площадке и логистика по каждому размеру.

    Считается по ТКАНИ и ШИРИНЕ: высота на себестоимость не влияет — кроят, обшивают
    и пакуют по ширине. 875 карточек товара сводятся к 56 реальным сочетаниям.

    GET  /                                        - себестоимость по тканям и ширинам
    POST /  { action: 'save_settings', ... }      - прочие расходы, цех
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
            params = event.get('queryStringParameters') or {}

            settings = _settings(cur)
            sold = _sold_units(cur, 30)
            salaried = _salaried(cur)
            groups, extras = _calc_groups(cur, settings, salaried['perUnit'])
            site = _site_channel(cur, groups, extras, salaried, settings)
            cur.execute("SELECT id, name FROM workshops WHERE name NOT IN ('Цех №2', 'Тестовый цех (QA)') ORDER BY id")
            workshops = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
            return _resp(200, {
                'settings': settings,
                'groups': groups,
                'extras': extras,
                'workshops': workshops,
                # Сколько вещей реально продано за месяц — подсказка для
                # делителя постоянных расходов, чтобы его не брали «на глаз».
                'sold': sold,
                # Окладная часть из «Финансов» за прошлый месяц на одну изготовленную вещь.
                'salaried': salaried,
                # Цена каждого материала по последней поставке — для расчёта по конкретной высоте.
                'materialPrices': {str(k): v['price'] for k, v in _material_prices(cur).items()},
                # Как постоянные расходы ложатся на вещь интернет-магазина.
                'site': site,
            })

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            action = body_data.get('action')

            # Любое изменение параметров — только админ. Проверяем на сервере:
            # спрятанной кнопки недостаточно, запрос можно послать и мимо интерфейса.
            if not _is_admin(cur, body_data.get('actorId')):
                return _resp(403, {'error': 'Менять расчёт может только администратор'})

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
                # Старые экраны правят строку без канала — тогда не сбрасываем его.
                channel = body_data.get('channel')
                if channel is not None and channel not in ('all', 'marketplaces', 'site'):
                    return _resp(400, {'error': 'Неизвестный канал расхода'})
                is_monthly = body_data.get('isMonthly')

                if action == 'add_expense':
                    cur.execute(
                        "INSERT INTO cost_extra_expenses (name, amount, per_items, note, "
                        "  is_active, channel, is_monthly) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                        (name, amount, per_items, note, bool(is_active), channel or 'all',
                         bool(per_items > 100 if is_monthly is None else is_monthly)),
                    )
                    new_id = cur.fetchone()[0]
                    conn.commit()
                    return _resp(200, {'id': new_id})

                expense_id = body_data.get('id')
                if not expense_id:
                    return _resp(400, {'error': 'Укажите id'})
                cur.execute(
                    "UPDATE cost_extra_expenses SET name = %s, amount = %s, "
                    "  per_items = %s, note = %s, is_active = %s, "
                    "  channel = COALESCE(%s, channel), is_monthly = COALESCE(%s, is_monthly) "
                    "WHERE id = %s",
                    (name, amount, per_items, note, bool(is_active), channel,
                     None if is_monthly is None else bool(is_monthly), int(expense_id)),
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

            # Налог и комиссию площадки здесь больше не принимаем: они считаются
            # от цены продажи и настраиваются в юнит-экономике. Если старая
            # версия страницы их пришлёт, они просто игнорируются.
            overhead = num('overheadPerItem')
            workshop_id = body_data.get('workshopId')
            # Надбавку на недостачи держим в разумных рамках: выше 50% это
            # уже не потери, а ошибка ввода.
            shortage = num('shortagePercent', 5.0)
            shortage = min(max(shortage, 0.0), 50.0)

            cur.execute("SELECT id FROM cost_settings ORDER BY id LIMIT 1")
            row = cur.fetchone()
            if row:
                cur.execute(
                    "UPDATE cost_settings SET overhead_per_item = %s, "
                    "  workshop_id = %s, shortage_percent = %s, "
                    "  updated_at = now(), updated_by = %s WHERE id = %s",
                    (overhead, int(workshop_id) if workshop_id else None,
                     shortage, body_data.get('actorId'), row[0]),
                )
            else:
                cur.execute(
                    "INSERT INTO cost_settings (overhead_per_item, workshop_id, "
                    "  shortage_percent, updated_by) VALUES (%s, %s, %s, %s)",
                    (overhead, int(workshop_id) if workshop_id else None,
                     shortage, body_data.get('actorId')),
                )
            conn.commit()
            return _resp(200, {'ok': True})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()