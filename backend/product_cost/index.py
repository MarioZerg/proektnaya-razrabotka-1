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
        "SELECT overhead_per_item, workshop_id FROM cost_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return {'overheadPerItem': 0.0, 'workshopId': None}
    return {
        'overheadPerItem': float(r[0] or 0),
        'workshopId': r[1],
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


def loss_share_for_period(cur, p_from, p_to, mp_code='ozon'):
    """Доля убыточных продаж за период: штук в минусе и их вес в деньгах.

    Нужна для начисления менеджеру: премировать за проданное в убыток не за что.
    Живёт здесь, а не в финансах менеджера, потому что рядом уже есть весь
    расчёт себестоимости — считать его во второй раз значит гарантированно
    разойтись в цифрах.

    Убыточной считаем продажу, где цена не покрывает полных затрат: своя
    себестоимость (материалы, работа цеха, прочие расходы) плюс удержания
    площадки — комиссия, эквайринг, логистика.

    Вознаграждение менеджера в затраты НЕ включаем: иначе оно влияет само на
    себя — чем больше начислено, тем больше товаров становятся убыточными,
    и расчёт начинает ходить по кругу.
    """
    settings = _settings(cur)
    groups, _ = _calc_groups(cur, settings, 0.0)
    cost_by_key = {
        (g['material'], float(g['width'] or 0)): float(g['total'] or 0)
        for g in groups
    }

    # В заказах площадка записана своим именем, в тарифах — кодом.
    mp_orders = {
        'ozon': 'OZON', 'wildberries': 'WB', 'yandex_market': 'Yandex',
    }.get(mp_code, mp_code.upper())

    cur.execute(
        "SELECT commission_fbs_percent, acquiring_percent, logistics_fbs "
        "FROM marketplace_tariffs WHERE marketplace_code = %s", (mp_code,)
    )
    t = cur.fetchone()
    commission_pct = float(t[0] or 0) if t else 0.0
    acquiring_pct = float(t[1] or 0) if t else 0.0
    logistics = float(t[2] or 0) if t else 0.0

    cur.execute(
        "SELECT o.material, o.width, mp.price, count(*) "
        "FROM orders o "
        "JOIN marketplace_prices mp "
        "  ON mp.marketplace_item_id = o.marketplace_item_id "
        " AND mp.marketplace_code = %s "
        "WHERE o.marketplace = %s AND o.cancelled_at IS NULL "
        "  AND o.created_at::date >= %s AND o.created_at::date <= %s "
        "  AND mp.price > 0 "
        "GROUP BY o.material, o.width, mp.price",
        (mp_code, mp_orders, p_from, p_to),
    )

    total_units = 0
    loss_units = 0
    # Вес считаем по ВЫРУЧКЕ, а не по штукам: убыточной чаще оказывается
    # дешёвая позиция, и по количеству её доля выглядит больше, чем по деньгам.
    total_revenue = 0.0
    loss_revenue = 0.0
    profit_total = 0.0
    # Разбор убыточных позиций: менеджеру нужен не сухой вычет, а список,
    # с которым можно работать — какие товары и насколько ушли в минус.
    details = []

    for material, width, price, cnt in cur.fetchall():
        price = float(price or 0)
        cnt = int(cnt or 0)
        own = cost_by_key.get((material, float(width or 0)))
        if own is None:
            # Себестоимость не посчитана — судить об убытке не по чему.
            continue

        total_units += cnt
        total_revenue += price * cnt

        platform = price * (commission_pct + acquiring_pct) / 100.0 + logistics
        profit = price - (own + platform)
        profit_total += profit * cnt

        if profit <= 0:
            loss_units += cnt
            loss_revenue += price * cnt
            details.append({
                'material': material,
                'width': float(width or 0),
                'price': round(price, 2),
                'lossPerUnit': round(-profit, 2),
                'units': cnt,
                'lossTotal': round(-profit * cnt, 2),
            })

    share = (loss_revenue / total_revenue) if total_revenue > 0 else 0.0
    # Средняя маржа за период: сколько осталось с рубля выручки.
    avg_margin = (profit_total / total_revenue * 100.0) if total_revenue else 0.0

    details.sort(key=lambda x: -x['lossTotal'])
    return {
        'lossUnits': loss_units,
        'totalUnits': total_units,
        'share': round(share, 6),
        'avgMargin': round(avg_margin, 2),
        # Только заметные позиции: длинный список в отчёте читать невозможно.
        'details': details[:12],
    }


def _manager_commission(cur, sold_units):
    """Вознаграждение менеджера маркетплейсов и сколько это на вещь.

    Менеджер получает процент с поступлений по отчётам площадок. Считали это
    вручную, и в себестоимость товара расход не попадал вовсе — при том что на
    каждой вещи он заметен.

    База — НАЧИСЛЕННОЕ по отчёту, а не пришедшее на счёт. Разница между ними
    появляется, когда мы берём досрочную выплату: площадка удерживает её из
    перевода. Но досрочная выплата — наше решение по деньгам, а не результат
    работы менеджера, и урезать из-за неё вознаграждение неправильно.

    Берём ПРОШЛЫЙ ПОЛНЫЙ месяц: текущий ещё идёт, и по нему сумма занижена —
    себестоимость скакала бы весь месяц вверх по мере поступления отчётов.
    """
    cur.execute(
        "SELECT percent, is_active, comment, user_id FROM manager_commission_settings "
        "ORDER BY id LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        return None
    percent = float(row[0] or 0)
    is_active = bool(row[1])

    # Прошлый полный месяц.
    cur.execute(
        "SELECT (date_trunc('month', now()) - interval '1 month')::date, "
        "       (date_trunc('month', now()) - interval '1 day')::date"
    )
    m_start, m_end = cur.fetchone()

    cur.execute(
        "SELECT coalesce(sum(transferred_amount), 0), "
        "       coalesce(sum(early_payout_amount), 0), count(*), "
        "       coalesce(sum(accrued_amount), 0), "
        "       coalesce(sum(agency_fee), 0) "
        "FROM marketplace_payouts "
        "WHERE period_start >= %s AND period_start <= %s",
        (m_start, m_end),
    )
    transferred, early, periods, accrued, agency = cur.fetchone()
    transferred = float(transferred or 0)
    accrued = float(accrued or 0)
    early = float(early or 0)
    agency = float(agency or 0)

    payout = round(transferred * percent / 100.0, 2)
    per_unit = round(payout / sold_units, 2) if sold_units else None

    return {
        'percent': percent,
        'isActive': is_active,
        # Кому начисляем: нужен владельцу, чтобы открыть отчёты менеджера
        # и выплатить по ним, не переключая учётную запись.
        'userId': int(row[3]) if len(row) > 3 and row[3] else None,
        'comment': row[2],
        'month': str(m_start),
        'monthEnd': str(m_end),
        'periods': int(periods or 0),
        # Фактически перечислено на расчётный счёт — БАЗА ПРОЦЕНТА.
        # Раньше базой было «начисленное», которое мы складывали сами из
        # заказов и удержаний. Оно расходилось с деньгами: в услугах сидит
        # агентское вознаграждение — техническая проводка на миллионы, из-за
        # неё июль показывал 17,1 млн вместо реальных перечислений.
        'transferred': round(transferred, 2),
        # Расчётная сумма по отчёту — для сверки, но не база.
        'accrued': round(accrued, 2),
        # Агентское вознаграждение: объясняет разрыв между ними.
        'agencyFee': round(agency, 2),
        # Удержано досрочными выплатами: на процент менеджера не влияет,
        # но показать надо — это реальные деньги, ушедшие из перевода.
        'earlyPayout': round(early, 2),
        'payout': payout,
        'perUnit': per_unit,
    }


def _calc_groups(cur, settings, manager_per_unit=0.0):
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
    # Вознаграждение менеджера — такой же расход на вещь, как коробка или
    # оклад кладовщика. Раньше оно считалось отдельной панелью и в стоимость
    # товара не попадало: себестоимость выглядела ниже настоящей, а решения
    # по ценам принимались по ней.
    manager_cost = round(float(manager_per_unit or 0), 4)

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
        overhead = round(
            extra_per_unit + settings['overheadPerItem'] + manager_cost, 2
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
        total = round(materials_cost + labor_cost + overhead, 2)

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
            # Из чего сложились прочие расходы: ручные статьи и менеджер.
            'overheadExtra': round(extra_per_unit + settings['overheadPerItem'], 2),
            'overheadManager': round(manager_cost, 2),
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

            # Доля убыточных продаж за период — для начисления менеджеру.
            # Отдельным действием, чтобы не считать её при каждом открытии
            # страницы себестоимости: запрос тяжёлый, а нужен раз в неделю.
            if params.get('action') == 'loss_share':
                p_from = params.get('from')
                p_to = params.get('to')
                if not p_from or not p_to:
                    return _resp(400, {'error': 'Укажите from и to'})
                return _resp(200, loss_share_for_period(
                    cur, p_from, p_to, params.get('marketplace') or 'ozon'))

            settings = _settings(cur)
            sold = _sold_units(cur, 30)
            manager = _manager_commission(cur, sold['total'])
            # Вознаграждение включаем в себестоимость только когда расчёт
            # включён: выключенная договорённость не должна тихо сидеть в цене.
            manager_per_unit = (
                manager['perUnit'] or 0
                if manager and manager.get('isActive') else 0
            )
            groups, extras = _calc_groups(cur, settings, manager_per_unit)
            cur.execute("SELECT id, name FROM workshops ORDER BY id")
            workshops = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
            return _resp(200, {
                'settings': settings,
                'groups': groups,
                'extras': extras,
                'workshops': workshops,
                # Сколько вещей реально продано за месяц — подсказка для
                # делителя постоянных расходов, чтобы его не брали «на глаз».
                'sold': sold,
                # Вознаграждение менеджера маркетплейсов: процент с поступлений.
                'manager': manager,
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

            if action == 'save_manager':
                # Ставка менеджера маркетплейсов. Меняется руками: договорённость
                # может пересматриваться, а из отчётов площадки её не вывести.
                try:
                    percent = float(body_data.get('percent') or 0)
                except (TypeError, ValueError):
                    return _resp(400, {'error': 'Процент указан неверно'})
                if percent < 0 or percent > 50:
                    return _resp(400, {'error': 'Процент должен быть от 0 до 50'})
                cur.execute(
                    "UPDATE manager_commission_settings SET percent = %s, "
                    "  is_active = %s, comment = %s, updated_at = now(), "
                    "  updated_by = %s "
                    "WHERE id = (SELECT id FROM manager_commission_settings "
                    "            ORDER BY id LIMIT 1)",
                    (percent, bool(body_data.get('isActive', True)),
                     (body_data.get('comment') or '').strip() or None,
                     body_data.get('actorId')),
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

            cur.execute("SELECT id FROM cost_settings ORDER BY id LIMIT 1")
            row = cur.fetchone()
            if row:
                cur.execute(
                    "UPDATE cost_settings SET overhead_per_item = %s, "
                    "  workshop_id = %s, updated_at = now(), "
                    "  updated_by = %s WHERE id = %s",
                    (overhead, int(workshop_id) if workshop_id else None,
                     body_data.get('actorId'), row[0]),
                )
            else:
                cur.execute(
                    "INSERT INTO cost_settings (overhead_per_item, workshop_id, "
                    "  updated_by) VALUES (%s, %s, %s)",
                    (overhead, int(workshop_id) if workshop_id else None,
                     body_data.get('actorId')),
                )
            conn.commit()
            return _resp(200, {'ok': True})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()