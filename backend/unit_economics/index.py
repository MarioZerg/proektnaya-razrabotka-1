import json
import os
import urllib.error
import urllib.request

import psycopg2

OZON_API = 'https://api-seller.ozon.ru'
WB_PRICES_API = 'https://discounts-prices-api.wildberries.ru'
WB_COMMISSION_API = 'https://common-api.wildberries.ru'
WB_TARIFFS_API = 'https://common-api.wildberries.ru'
YM_API = 'https://api.partner.market.yandex.ru'

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

# Площадки, по которым считаем. Порядок = порядок вкладок на экране.
MARKETPLACES = ('ozon', 'wildberries', 'yandex_market')

# Как площадка называется в таблице заказов: оттуда берём реальный процент выкупа.
ORDERS_CODE = {'ozon': 'OZON', 'wildberries': 'WB', 'yandex_market': 'YANDEX'}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def _is_admin(cur, actor_id):
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _can_edit(cur, actor_id):
    """Менеджер ведёт цены и тарифы площадок — это его работа.

    Он торгуется с площадками, участвует в акциях и должен видеть, где проходит
    граница убытка. Налог и постоянные расходы компании правит только владелец.
    """
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] in ('admin', 'manager'))


def _http(url, method='GET', headers=None, payload=None, timeout=3):
    """Запрос к API площадки. Возвращает (код ответа, разобранный JSON или текст)."""
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read().decode('utf-8')
            return r.status, (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', errors='replace')
        try:
            detail = json.loads(detail)
        except Exception:
            pass
        return e.code, detail
    except Exception as e:
        return 0, str(e)


def _credentials(cur, code):
    """Ключи доступа к кабинету площадки."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = %s",
        (code,),
    )
    row = cur.fetchone()
    if not row:
        return {}, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds, bool(row[0])


def _save_prices(cur, code, rows):
    """Кладёт цены в базу ОДНИМ запросом.

    Раньше на каждую строку шёл отдельный INSERT, и пара сотен карточек не
    укладывалась в лимит времени функции — загрузка обрывалась, не сохранив
    ничего. Теперь все строки уходят одним запросом.
    """
    if not rows:
        return 0

    def val(v):
        if v is None:
            return 'NULL'
        return str(float(v))

    values = ', '.join(
        f"({int(r['itemId'])}, '{code}', {val(r.get('price'))}, "
        f"{val(r.get('priceBeforeDiscount'))}, "
        f"{val(r.get('priceWithMarketplaceDiscount'))}, "
        f"{val(r.get('discountPercent'))}, {val(r.get('commissionFbo'))}, "
        f"{val(r.get('commissionFbs'))}, {val(r.get('volumeLiters'))}, "
        f"{val(r.get('weightKg'))}, {val(r.get('logisticsFbo'))}, "
        f"{val(r.get('logisticsFbs'))}, {val(r.get('returnFbo'))}, "
        f"{val(r.get('returnFbs'))}, {val(r.get('acquiringAmount'))})"
        for r in rows
    )
    cur.execute(
        "INSERT INTO marketplace_prices (marketplace_item_id, marketplace_code, "
        "price, price_before_discount, price_with_marketplace_discount, "
        "discount_percent, commission_fbo_percent, commission_fbs_percent, "
        "volume_liters, weight_kg, logistics_fbo, logistics_fbs, return_fbo, "
        "return_fbs, acquiring_amount) VALUES " + values + " "
        "ON CONFLICT (marketplace_item_id, marketplace_code) DO UPDATE SET "
        "price = COALESCE(EXCLUDED.price, marketplace_prices.price), "
        "price_before_discount = COALESCE(EXCLUDED.price_before_discount, "
        "  marketplace_prices.price_before_discount), "
        "price_with_marketplace_discount = COALESCE("
        "  EXCLUDED.price_with_marketplace_discount, "
        "  marketplace_prices.price_with_marketplace_discount), "
        "discount_percent = COALESCE(EXCLUDED.discount_percent, "
        "  marketplace_prices.discount_percent), "
        "commission_fbo_percent = COALESCE(EXCLUDED.commission_fbo_percent, "
        "  marketplace_prices.commission_fbo_percent), "
        "commission_fbs_percent = COALESCE(EXCLUDED.commission_fbs_percent, "
        "  marketplace_prices.commission_fbs_percent), "
        "volume_liters = COALESCE(EXCLUDED.volume_liters, marketplace_prices.volume_liters), "
        "weight_kg = COALESCE(EXCLUDED.weight_kg, marketplace_prices.weight_kg), "
        "logistics_fbo = COALESCE(EXCLUDED.logistics_fbo, marketplace_prices.logistics_fbo), "
        "logistics_fbs = COALESCE(EXCLUDED.logistics_fbs, marketplace_prices.logistics_fbs), "
        "return_fbo = COALESCE(EXCLUDED.return_fbo, marketplace_prices.return_fbo), "
        "return_fbs = COALESCE(EXCLUDED.return_fbs, marketplace_prices.return_fbs), "
        "acquiring_amount = COALESCE(EXCLUDED.acquiring_amount, "
        "  marketplace_prices.acquiring_amount), "
        "source = 'api', synced_at = now(), updated_at = now()"
    )
    return len(rows)


def _sync_ozon(cur, cursor=None):
    """Цены и комиссии товаров с Ozon.

    /v5/product/info/prices отдаёт по каждому товару и цену, и проценты комиссии
    отдельно для FBO и FBS — ровно то, что нужно для расчёта. Сопоставляем по
    offer_id: это наш артикул, он же sku в справочнике товаров.
    """
    creds, enabled = _credentials(cur, 'ozon')
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()
    if not enabled or not client_id or not api_key:
        return {'ok': False, 'error': 'Интеграция Ozon не подключена'}

    cur.execute("SELECT sku, id FROM marketplace_items WHERE sku IS NOT NULL")
    by_sku = {str(r[0]).strip(): r[1] for r in cur.fetchall()}

    # У функции 5 секунд на всё, а карточек почти тысяча: тянем ОДНУ страницу за
    # вызов и возвращаем курсор. Экран сам продолжает загрузку, показывая прогресс, —
    # иначе запрос обрывался по таймауту и цены не сохранялись вовсе.
    headers = {'Client-Id': client_id, 'Api-Key': api_key}
    rows = []
    status, data = _http(
        f'{OZON_API}/v5/product/info/prices', 'POST', headers,
        {'filter': {'visibility': 'ALL'}, 'limit': 100, 'cursor': cursor or ''},
    )
    if True:
        if status != 200 or not isinstance(data, dict):
            return {'ok': False, 'error': f'Ozon ответил {status}: {str(data)[:200]}'}
        items = data.get('items') or []
        for it in items:
            item_id = by_sku.get(str(it.get('offer_id') or '').strip())
            if not item_id:
                continue
            price = it.get('price') or {}
            comm = it.get('commissions') or {}

            def num(v):
                try:
                    return float(v) if v not in (None, '') else None
                except (TypeError, ValueError):
                    return None

            rows.append({
                'itemId': item_id,
                'price': num(price.get('price')),
                'priceBeforeDiscount': num(price.get('old_price')),
                'priceWithMarketplaceDiscount': num(price.get('marketing_price')),
                # Комиссия FBO и FBS у Ozon разная — берём обе.
                'commissionFbo': num(comm.get('sales_percent_fbo')),
                'commissionFbs': num(comm.get('sales_percent_fbs')),
                'volumeLiters': num(it.get('volume_weight')),
                # Логистика Ozon отдаёт в рублях по КАЖДОМУ товару: магистраль
                # (зависит от габаритов) плюс доставка до покупателя. Это точнее
                # общего тарифа — крупная штора и мелкий товар едут по разной цене.
                'logisticsFbo': round(
                    (num(comm.get('fbo_direct_flow_trans_min_amount')) or 0)
                    + (num(comm.get('fbo_deliv_to_customer_amount')) or 0), 2) or None,
                'logisticsFbs': round(
                    (num(comm.get('fbs_direct_flow_trans_min_amount')) or 0)
                    + (num(comm.get('fbs_deliv_to_customer_amount')) or 0)
                    + (num(comm.get('fbs_first_mile_min_amount')) or 0), 2) or None,
                'returnFbo': num(comm.get('fbo_return_flow_amount')),
                'returnFbs': num(comm.get('fbs_return_flow_amount')),
                'acquiringAmount': num(it.get('acquiring')),
            })
        next_cursor = data.get('cursor') or ''
        done = not next_cursor or not items

    saved = _save_prices(cur, 'ozon', rows)
    return {'ok': True, 'saved': saved, 'fetched': len(rows),
            'cursor': next_cursor, 'done': done}


def _sync_wb(cur, cursor=None):
    """Цены товаров с Wildberries.

    Берём карточки со скидками: WB отдаёт цену и текущую скидку продавца.
    Сопоставляем по vendorCode — это наш артикул.
    """
    creds, enabled = _credentials(cur, 'wildberries')
    api_key = (creds.get('apiKey') or '').strip()
    if not enabled or not api_key:
        return {'ok': False, 'error': 'Интеграция Wildberries не подключена'}

    cur.execute("SELECT sku, id FROM marketplace_items WHERE sku IS NOT NULL")
    by_sku = {str(r[0]).strip(): r[1] for r in cur.fetchall()}

    # Одна страница за вызов — см. пояснение в загрузке Ozon.
    headers = {'Authorization': api_key}
    rows = []
    offset = int(cursor or 0)
    status, data = _http(
        f'{WB_PRICES_API}/api/v2/list/goods/filter?limit=100&offset={offset}',
        'GET', headers,
    )
    if True:
        if status != 200 or not isinstance(data, dict):
            return {'ok': False, 'error': f'WB ответил {status}: {str(data)[:200]}'}
        goods = ((data.get('data') or {}).get('listGoods')) or []
        for g in goods:
            item_id = by_sku.get(str(g.get('vendorCode') or '').strip())
            if not item_id:
                continue
            sizes = g.get('sizes') or []
            price = None
            discounted = None
            if sizes:
                price = sizes[0].get('price')
                discounted = sizes[0].get('discountedPrice')
            rows.append({
                'itemId': item_id,
                # Продавец получает цену ПОСЛЕ своей скидки.
                'price': float(discounted) if discounted else (
                    float(price) if price else None),
                'priceBeforeDiscount': float(price) if price else None,
                'discountPercent': float(g['discount']) if g.get('discount') else None,
            })
        done = len(goods) < 100
        next_cursor = '' if done else str(offset + 100)

    saved = _save_prices(cur, 'wildberries', rows)
    return {'ok': True, 'saved': saved, 'fetched': len(rows),
            'cursor': next_cursor, 'done': done}


def _sync_yandex(cur, cursor=None):
    """Цены товаров с Яндекс Маркета.

    Партнёрский API отдаёт цены по кампании. Сопоставляем по offerId — наш артикул.
    """
    creds, enabled = _credentials(cur, 'yandex_market')
    api_key = (creds.get('apiKey') or '').strip()
    campaign_id = str(creds.get('campaignId') or '').strip()
    if not enabled or not api_key or not campaign_id:
        return {'ok': False, 'error': 'Интеграция Яндекс Маркета не подключена'}

    cur.execute("SELECT sku, id FROM marketplace_items WHERE sku IS NOT NULL")
    by_sku = {str(r[0]).strip(): r[1] for r in cur.fetchall()}

    # Одна страница за вызов — см. пояснение в загрузке Ozon.
    headers = {'Api-Key': api_key}
    rows = []
    url = f'{YM_API}/campaigns/{campaign_id}/offer-prices?limit=100'
    if cursor:
        url += f'&page_token={cursor}'
    status, data = _http(url, 'GET', headers)
    if True:
        if status != 200 or not isinstance(data, dict):
            return {'ok': False, 'error': f'Яндекс ответил {status}: {str(data)[:200]}'}
        result = data.get('result') or {}
        offers = result.get('offers') or []
        for o in offers:
            item_id = by_sku.get(str(o.get('offerId') or o.get('id') or '').strip())
            if not item_id:
                continue
            price = (o.get('price') or {}).get('value')
            rows.append({
                'itemId': item_id,
                'price': float(price) if price else None,
            })
        next_cursor = (result.get('paging') or {}).get('nextPageToken') or ''
        done = not next_cursor or not offers

    saved = _save_prices(cur, 'yandex_market', rows)
    return {'ok': True, 'saved': saved, 'fetched': len(rows),
            'cursor': next_cursor, 'done': done}


def _settings(cur):
    """Налог и постоянные расходы компании."""
    cur.execute(
        "SELECT tax_percent, fixed_costs_month FROM unit_economics_settings "
        "ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return {'taxPercent': 6.0, 'fixedCostsMonth': 0.0}
    return {'taxPercent': float(r[0] or 0), 'fixedCostsMonth': float(r[1] or 0)}


def _tariffs(cur):
    """Тарифы каждой площадки: логистика, хранение, приёмка, эквайринг, реклама."""
    cur.execute(
        "SELECT marketplace_code, logistics_fbo, logistics_fbs, return_logistics, "
        "storage_per_month, acceptance_fee, acquiring_percent, promo_percent, "
        "storage_months, commission_fbo_percent, commission_fbs_percent "
        "FROM marketplace_tariffs"
    )
    out = {}
    for r in cur.fetchall():
        out[r[0]] = {
            'marketplaceCode': r[0],
            'logisticsFbo': float(r[1] or 0),
            'logisticsFbs': float(r[2] or 0),
            'returnLogistics': float(r[3] or 0),
            'storagePerMonth': float(r[4] or 0),
            'acceptanceFee': float(r[5] or 0),
            'acquiringPercent': float(r[6] or 0),
            'promoPercent': float(r[7] or 0),
            'storageMonths': float(r[8] or 1) or 1.0,
            # Запасная комиссия: WB и Яндекс не отдают её по товару.
            'commissionFboPercent': float(r[9] or 0),
            'commissionFbsPercent': float(r[10] or 0),
        }
    for code in MARKETPLACES:
        out.setdefault(code, {
            'marketplaceCode': code, 'logisticsFbo': 0.0, 'logisticsFbs': 0.0,
            'returnLogistics': 0.0, 'storagePerMonth': 0.0, 'acceptanceFee': 0.0,
            'acquiringPercent': 0.0, 'promoPercent': 0.0, 'storageMonths': 1.0,
            'commissionFboPercent': 0.0, 'commissionFbsPercent': 0.0,
        })
    return out


def _buyout_rates(cur):
    """РЕАЛЬНЫЙ процент выкупа по нашим заказам — отдельно по площадке и схеме.

    Это ключевой параметр всей экономики: при выкупе 80% каждая пятая вещь едет
    обратно, и обратная логистика съедает прибыль с четырёх проданных. Считать
    его «на глазок» нельзя, а у нас есть точные отметки отмен по заказам.
    """
    cur.execute(
        "SELECT marketplace, order_type, COUNT(*), "
        "COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) "
        "FROM orders WHERE marketplace IS NOT NULL AND order_type IS NOT NULL "
        "GROUP BY marketplace, order_type"
    )
    out = {}
    for mp, otype, total, cancelled in cur.fetchall():
        total = int(total or 0)
        cancelled = int(cancelled or 0)
        if total <= 0:
            continue
        out[(mp, otype)] = {
            'percent': round(100.0 * (total - cancelled) / total, 1),
            'orders': total,
            'cancelled': cancelled,
        }
    return out


def _material_prices(cur):
    """Цена материала за единицу — как в расчёте себестоимости.

    Берём максимальную цену among поставщиков: считаем по худшему сценарию, иначе
    товар покажется прибыльнее, чем он есть. Нет прайса — падаем на среднюю цену
    рулонов на складе (фактически потраченные деньги).
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
        "FROM materials m LEFT JOIN material_types mt ON mt.id = m.type_id"
    )
    out = {}
    for r in cur.fetchall():
        sp = float(r[4]) if r[4] is not None else None
        rp = float(r[5]) if r[5] is not None else None
        out[r[0]] = {
            'name': r[1], 'unit': r[2], 'typeName': r[3] or '',
            'price': round(sp if sp else (rp or 0.0), 4),
            'priceSource': 'supplier' if sp else ('rolls' if rp else 'none'),
        }
    return out


def _rates(cur, workshop_id):
    """Тарифы работ цеха: раскрой, пошив, стикеровка."""
    cutter, sewer, packer = {}, {}, 0.0
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


def _cost_by_group(cur):
    """Себестоимость производства по паре «ткань + ширина».

    ВАЖНО: здесь только СВОИ затраты — материалы, работа цеха и прочие расходы.
    Комиссию площадки и налог сюда НЕ включаем, в отличие от страницы
    себестоимости: в юнит-экономике они считаются от ЦЕНЫ ПРОДАЖИ, а не от
    затрат. Иначе комиссия была бы посчитана дважды и от неверной базы.
    """
    cur.execute(
        "SELECT tax_percent, marketplace_percent, overhead_per_item, workshop_id "
        "FROM cost_settings ORDER BY id LIMIT 1"
    )
    cs = cur.fetchone()
    workshop_id = cs[3] if cs else None
    overhead_legacy = float(cs[2] or 0) if cs else 0.0

    cur.execute(
        "SELECT amount, per_items FROM cost_extra_expenses WHERE is_active = true"
    )
    extra_per_unit = 0.0
    for amount, per_items in cur.fetchall():
        per = int(per_items or 1) or 1
        extra_per_unit += float(amount or 0) / per

    prices = _material_prices(cur)
    cutter_rates, sewer_rates, packer_rate = _rates(cur, workshop_id)

    cur.execute(
        "SELECT mi.material, mi.width, mim.material_id, mim.quantity "
        "FROM marketplace_items mi "
        "LEFT JOIN marketplace_item_materials mim ON mim.marketplace_item_id = mi.id "
        "WHERE mi.id IN ("
        "  SELECT DISTINCT ON (material, width) id FROM marketplace_items "
        "  ORDER BY material, width, id"
        ")"
    )
    groups = {}
    for material, width, material_id, qty in cur.fetchall():
        key = (material, width)
        g = groups.setdefault(key, {'materials': [], 'fabricMaterialId': None})
        if material_id is None:
            continue
        p = prices.get(material_id, {'name': '?', 'unit': '', 'typeName': '',
                                     'price': 0.0, 'priceSource': 'none'})
        q = float(qty or 0)
        if p['typeName'] == 'Тюль':
            g['fabricMaterialId'] = material_id
        g['materials'].append({
            'materialId': material_id, 'name': p['name'], 'typeName': p['typeName'],
            'unit': p['unit'], 'quantity': round(q, 3), 'pricePerUnit': p['price'],
            'sum': round(q * p['price'], 2), 'priceSource': p['priceSource'],
        })

    cur.execute(
        "SELECT m.id, m.name FROM materials m "
        "JOIN material_types mt ON mt.id = m.type_id WHERE mt.name = 'Тюль'"
    )
    fabric_by_name = {r[1]: r[0] for r in cur.fetchall()}

    out = {}
    for (material, width_raw), g in groups.items():
        width = float(width_raw or 0)
        meters = round(width / 100, 2) if width else 0.0
        materials_cost = sum(m['sum'] for m in g['materials'])
        fabric_id = g['fabricMaterialId'] or fabric_by_name.get(material)
        cut = round(meters * cutter_rates.get(fabric_id, 0.0), 2) if fabric_id else 0.0
        sew = round(sewer_rates.get(int(width), 0.0), 2) if width else 0.0
        pack = round(meters * packer_rate, 2)
        labor = cut + sew + pack
        overhead = round(extra_per_unit + overhead_legacy, 2)
        out[(material, width_raw)] = {
            'materials': g['materials'],
            'materialsCost': round(materials_cost, 2),
            'cutCost': cut, 'sewCost': sew, 'packWorkCost': pack,
            'laborCost': round(labor, 2),
            'overhead': overhead,
            # Полная себестоимость производства — без комиссии и налога.
            'productionCost': round(materials_cost + labor + overhead, 2),
            'missing': [
                *(['Не задан расход материалов'] if not g['materials'] else []),
                *(['Нет тарифа закройщика'] if cut == 0 else []),
                *(['Нет тарифа швеи'] if sew == 0 else []),
                *([f'Нет цены: {m["name"]}'
                   for m in g['materials'] if m['priceSource'] == 'none']),
            ],
        }
    return out


def _prices_by_item(cur, code):
    """Цены и комиссии товаров на конкретной площадке."""
    cur.execute(
        "SELECT marketplace_item_id, price, price_before_discount, "
        "price_with_marketplace_discount, discount_percent, commission_fbo_percent, "
        "commission_fbs_percent, volume_liters, weight_kg, source, synced_at, "
        "logistics_fbo, logistics_fbs, return_fbo, return_fbs, acquiring_amount "
        "FROM marketplace_prices WHERE marketplace_code = %s",
        (code,),
    )
    out = {}
    for r in cur.fetchall():
        out[r[0]] = {
            'price': float(r[1]) if r[1] is not None else None,
            'priceBeforeDiscount': float(r[2]) if r[2] is not None else None,
            'priceWithMarketplaceDiscount': float(r[3]) if r[3] is not None else None,
            'discountPercent': float(r[4]) if r[4] is not None else None,
            'commissionFboPercent': float(r[5]) if r[5] is not None else None,
            'commissionFbsPercent': float(r[6]) if r[6] is not None else None,
            'volumeLiters': float(r[7]) if r[7] is not None else None,
            'weightKg': float(r[8]) if r[8] is not None else None,
            'source': r[9],
            'syncedAt': r[10].isoformat() + 'Z' if r[10] else None,
            'logisticsFbo': float(r[11]) if r[11] is not None else None,
            'logisticsFbs': float(r[12]) if r[12] is not None else None,
            'returnFbo': float(r[13]) if r[13] is not None else None,
            'returnFbs': float(r[14]) if r[14] is not None else None,
            'acquiringAmount': float(r[15]) if r[15] is not None else None,
        }
    return out


def _calc_unit(price, cost, tariff, settings, commission_percent, scheme, buyout,
               item_fees=None):
    """Экономика ОДНОЙ проданной единицы.

    Считается по общепринятой для маркетплейсов схеме: из цены продажи вычитаем
    всё, что забирает площадка, затем свои затраты и налог.

    Ключевая тонкость — ВЫКУП. При выкупе 85% из каждых 100 отправленных вещей
    продаются 85, а 15 едут обратно, и за каждую возвращённую мы платим логистику
    в обе стороны, ничего не получая. Эти потери нужно разложить на проданные
    вещи, иначе прибыль окажется завышенной. Именно поэтому «прибыль по чеку» и
    реальная прибыль расходятся в разы.
    """
    if not price or price <= 0:
        return None

    share = max(buyout, 1.0) / 100.0  # доля выкупа, не даём делить на ноль

    fees = item_fees or {}
    commission = round(price * (commission_percent or 0) / 100, 2)
    # Эквайринг: Ozon отдаёт готовую сумму по товару — она точнее процента.
    acquiring = round(
        fees['acquiringAmount'] if fees.get('acquiringAmount') is not None
        else price * tariff['acquiringPercent'] / 100, 2
    )
    promo = round(price * tariff['promoPercent'] / 100, 2)

    # Логистику берём ПО ТОВАРУ, если площадка её отдала: она зависит от габаритов,
    # и общий тариф для шторы 800 см и мелочи одинаковым быть не может.
    item_log = fees.get('logisticsFbo') if scheme == 'FBO' else fees.get('logisticsFbs')
    logistics_direct = item_log if item_log is not None else (
        tariff['logisticsFbo'] if scheme == 'FBO' else tariff['logisticsFbs'])
    item_ret = fees.get('returnFbo') if scheme == 'FBO' else fees.get('returnFbs')
    return_tariff = item_ret if item_ret is not None else tariff['returnLogistics']
    # Хранение и приёмка есть только на складе площадки (FBO).
    storage = round(tariff['storagePerMonth'] * tariff['storageMonths'], 2) if scheme == 'FBO' else 0.0
    acceptance = tariff['acceptanceFee'] if scheme == 'FBO' else 0.0

    # Логистика: платим за КАЖДУЮ отправленную вещь, а выручку получаем только
    # с выкупленных. Поэтому расход на одну ПРОДАННУЮ вещь выше тарифа.
    logistics = round(logistics_direct / share, 2)
    # Возвраты: на каждую проданную приходится (1/выкуп - 1) возвратов.
    returns_per_sale = (1.0 / share) - 1.0
    return_cost = round(return_tariff * returns_per_sale, 2)

    marketplace_costs = round(
        commission + acquiring + promo + logistics + return_cost + storage + acceptance, 2
    )

    # Себестоимость возвращённых вещей НЕ теряется: вещь приезжает обратно и
    # уходит следующему покупателю. Товар не портится, поэтому в потери её не
    # закладываем — иначе экономика была бы занижена вдвое.
    production = cost['productionCost']

    # Налог УСН «доходы» — с выручки, а не с прибыли.
    tax = round(price * settings['taxPercent'] / 100, 2)

    profit = round(price - marketplace_costs - production - tax, 2)
    margin = round(profit / price * 100, 1) if price else 0.0
    # Рентабельность вложений: сколько прибыли на каждый вложенный рубль.
    roi = round(profit / production * 100, 1) if production else 0.0

    # Минимальная цена без убытка. Комиссия, эквайринг, реклама и налог зависят
    # от самой цены, поэтому решаем уравнение: цена × (1 - доля%) = постоянные.
    # Если эквайринг пришёл суммой, он не зависит от цены — значит уходит в
    # постоянную часть, а не в процентную.
    acquiring_is_fixed = fees.get('acquiringAmount') is not None
    variable_share = (
        (commission_percent or 0)
        + (0 if acquiring_is_fixed else tariff['acquiringPercent'])
        + tariff['promoPercent'] + settings['taxPercent']
    ) / 100.0
    fixed_part = (logistics + return_cost + storage + acceptance + production
                  + (acquiring if acquiring_is_fixed else 0))
    break_even_price = (
        round(fixed_part / (1 - variable_share), 2) if variable_share < 1 else None
    )

    return {
        'price': round(price, 2),
        'commission': commission,
        'commissionPercent': round(commission_percent or 0, 2),
        'acquiring': acquiring,
        'promo': promo,
        'logistics': logistics,
        'logisticsBase': round(logistics_direct, 2),
        'returnCost': return_cost,
        'storage': storage,
        'acceptance': acceptance,
        'marketplaceCosts': marketplace_costs,
        'productionCost': production,
        'tax': tax,
        'profit': profit,
        'margin': margin,
        'roi': roi,
        'buyoutPercent': round(buyout, 1),
        'breakEvenPrice': break_even_price,
    }


def _build(cur, code, scheme, buyout_override):
    """Собирает расчёт по всем товарам одной площадки."""
    settings = _settings(cur)
    tariffs = _tariffs(cur)[code]
    costs = _cost_by_group(cur)
    prices = _prices_by_item(cur, code)
    buyouts = _buyout_rates(cur)

    orders_mp = ORDERS_CODE.get(code)
    real = buyouts.get((orders_mp, scheme))
    real_buyout = real['percent'] if real else None
    buyout = buyout_override if buyout_override else (real_buyout or 100.0)

    # Один товар-образец на пару «ткань + ширина»: себестоимость внутри пары
    # одинакова, а цены на площадке у разных высот различаются — поэтому цену
    # усредняем по всем карточкам пары и показываем разброс.
    cur.execute(
        "SELECT mi.material, mi.width, mi.id, mi.height, mi.name, mi.sku "
        "FROM marketplace_items mi ORDER BY mi.material, mi.width, mi.height"
    )
    groups = {}
    for material, width, item_id, height, name, sku in cur.fetchall():
        key = (material, width)
        g = groups.setdefault(key, {'material': material, 'width': width, 'items': []})
        p = prices.get(item_id)
        g['items'].append({
            'id': item_id, 'height': height, 'name': name, 'sku': sku,
            'price': p['price'] if p else None,
            'commissionFbo': p['commissionFboPercent'] if p else None,
            'commissionFbs': p['commissionFbsPercent'] if p else None,
            'discountPercent': p['discountPercent'] if p else None,
            'source': p['source'] if p else None,
            'fees': p if p else None,
        })

    rows = []
    for (material, width), g in sorted(groups.items(), key=lambda x: (x[0][0] or '', x[0][1] or 0)):
        cost = costs.get((material, width))
        if not cost:
            continue
        priced = [i for i in g['items'] if i['price']]
        # Комиссию берём из карточки товара; если площадка её не отдала — 0,
        # и менеджер увидит предупреждение «не задана комиссия».
        comm_key = 'commissionFbo' if scheme == 'FBO' else 'commissionFbs'
        comms = [i[comm_key] for i in priced if i[comm_key] is not None]
        # Комиссия по товару в приоритете; нет её — берём общую по площадке,
        # которую менеджер вписал из своего кабинета.
        fallback_comm = (tariffs['commissionFboPercent'] if scheme == 'FBO'
                         else tariffs['commissionFbsPercent'])
        commission_percent = (round(sum(comms) / len(comms), 2) if comms
                              else fallback_comm)

        # По каждой ВЫСОТЕ считаем отдельно: цена у разных высот своя, и одна
        # высота может быть убыточной, пока соседняя приносит прибыль.
        heights = []
        for i in sorted(g['items'], key=lambda x: x['height'] or 0):
            unit = _calc_unit(
                i['price'], cost, tariffs, settings,
                i[comm_key] if i[comm_key] is not None else commission_percent,
                scheme, buyout, i['fees'],
            )
            heights.append({
                'itemId': i['id'], 'height': i['height'], 'name': i['name'],
                'sku': i['sku'], 'source': i['source'],
                'discountPercent': i['discountPercent'],
                'unit': unit,
            })

        avg_price = round(sum(i['price'] for i in priced) / len(priced), 2) if priced else None
        # Тарифы для группы берём у первого товара с ценой: внутри пары
        # «ткань + ширина» габариты одинаковые, значит и логистика тоже.
        group_fees = priced[0]['fees'] if priced else None
        group_unit = _calc_unit(avg_price, cost, tariffs, settings,
                                commission_percent, scheme, buyout, group_fees)
        rows.append({
            'material': material,
            'width': width,
            'productsCount': len(g['items']),
            'pricedCount': len(priced),
            'minPrice': round(min(i['price'] for i in priced), 2) if priced else None,
            'maxPrice': round(max(i['price'] for i in priced), 2) if priced else None,
            'avgPrice': avg_price,
            'cost': cost,
            'unit': group_unit,
            'heights': heights,
            'missing': cost['missing'] + (
                [] if (comms or fallback_comm > 0)
                else ['Не задана комиссия площадки — впишите её в тарифах']),
        })

    return {
        'marketplaceCode': code,
        'scheme': scheme,
        'settings': settings,
        'tariffs': tariffs,
        'buyout': {
            'used': round(buyout, 1),
            'real': real_buyout,
            'isOverride': bool(buyout_override),
            'orders': real['orders'] if real else 0,
            'cancelled': real['cancelled'] if real else 0,
        },
        'rows': rows,
    }


def handler(event: dict, context) -> dict:
    """Юнит-экономика маркетплейсов: сколько мы зарабатываем на одной вещи.

    Себестоимость отвечает, во сколько вещь обходится нам. Здесь — что от цены
    продажи останется после того, как площадка заберёт комиссию, логистику,
    эквайринг и хранение, а часть покупателей откажется от заказа.

    Считается по паре «ткань + ширина» и отдельно по каждой ВЫСОТЕ: цены у разных
    высот свои, и одна высота может быть убыточной, пока соседняя прибыльна.

    GET  /?marketplace=ozon&scheme=FBS[&buyout=80] - расчёт по площадке и схеме
    GET  /?action=compare                          - сравнение всех площадок и схем
    POST /  { action: 'sync_prices', marketplaceCode } - тянет цены и комиссии из кабинета
    POST /  { action: 'save_tariffs', marketplaceCode, ... }   - тарифы площадки
    POST /  { action: 'save_settings', taxPercent, fixedCostsMonth }
    POST /  { action: 'save_price', itemId, marketplaceCode, price, ... }
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            action = params.get('action')

            if action == 'compare':
                # Одна ткань и ширина на всех площадках и обеих схемах рядом —
                # видно, где продавать выгоднее и какая схема лучше.
                out = {}
                for code in MARKETPLACES:
                    for scheme in ('FBO', 'FBS'):
                        data = _build(cur, code, scheme, None)
                        for row in data['rows']:
                            key = f"{row['material']}|{row['width']}"
                            entry = out.setdefault(key, {
                                'material': row['material'],
                                'width': row['width'],
                                'productionCost': row['cost']['productionCost'],
                                'variants': [],
                            })
                            if row['unit']:
                                entry['variants'].append({
                                    'marketplaceCode': code,
                                    'scheme': scheme,
                                    'price': row['unit']['price'],
                                    'profit': row['unit']['profit'],
                                    'margin': row['unit']['margin'],
                                    'roi': row['unit']['roi'],
                                    'buyoutPercent': row['unit']['buyoutPercent'],
                                })
                rows = sorted(out.values(), key=lambda x: (x['material'] or '', x['width'] or 0))
                for r in rows:
                    r['variants'].sort(key=lambda v: v['profit'], reverse=True)
                    r['best'] = r['variants'][0] if r['variants'] else None
                return _resp(200, {'rows': rows})

            code = params.get('marketplace') or 'ozon'
            if code not in MARKETPLACES:
                return _resp(400, {'error': 'Неизвестный маркетплейс'})
            scheme = (params.get('scheme') or 'FBS').upper()
            if scheme not in ('FBO', 'FBS'):
                return _resp(400, {'error': 'Схема бывает FBO или FBS'})
            raw_buyout = params.get('buyout')
            buyout_override = None
            if raw_buyout:
                try:
                    v = float(raw_buyout)
                    if 1 <= v <= 100:
                        buyout_override = v
                except ValueError:
                    pass
            return _resp(200, _build(cur, code, scheme, buyout_override))

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')

        if action == 'save_tariffs':
            if not _can_edit(cur, actor_id):
                return _resp(403, {'error': 'Тарифы ведёт менеджер или администратор'})
            code = body_data.get('marketplaceCode')
            if code not in MARKETPLACES:
                return _resp(400, {'error': 'Неизвестный маркетплейс'})
            cur.execute(
                "UPDATE marketplace_tariffs SET logistics_fbo = %s, logistics_fbs = %s, "
                "return_logistics = %s, storage_per_month = %s, acceptance_fee = %s, "
                "acquiring_percent = %s, promo_percent = %s, storage_months = %s, "
                "commission_fbo_percent = %s, commission_fbs_percent = %s, "
                "updated_at = now(), updated_by = %s WHERE marketplace_code = %s",
                (
                    float(body_data.get('logisticsFbo') or 0),
                    float(body_data.get('logisticsFbs') or 0),
                    float(body_data.get('returnLogistics') or 0),
                    float(body_data.get('storagePerMonth') or 0),
                    float(body_data.get('acceptanceFee') or 0),
                    float(body_data.get('acquiringPercent') or 0),
                    float(body_data.get('promoPercent') or 0),
                    float(body_data.get('storageMonths') or 1),
                    float(body_data.get('commissionFboPercent') or 0),
                    float(body_data.get('commissionFbsPercent') or 0),
                    int(actor_id) if actor_id else None,
                    code,
                ),
            )
            conn.commit()
            return _resp(200, {'success': True})

        if action == 'save_settings':
            # Налог и постоянные расходы компании — деньги владельца.
            if not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Налог и расходы компании меняет администратор'})
            cur.execute(
                "UPDATE unit_economics_settings SET tax_percent = %s, "
                "fixed_costs_month = %s, updated_at = now(), updated_by = %s "
                "WHERE id = (SELECT id FROM unit_economics_settings ORDER BY id LIMIT 1)",
                (
                    float(body_data.get('taxPercent') or 0),
                    float(body_data.get('fixedCostsMonth') or 0),
                    int(actor_id) if actor_id else None,
                ),
            )
            conn.commit()
            return _resp(200, {'success': True})

        if action == 'sync_prices':
            # Тянем актуальные цены и комиссии из кабинета площадки.
            if not _can_edit(cur, actor_id):
                return _resp(403, {'error': 'Обновлять цены может менеджер или администратор'})
            code = body_data.get('marketplaceCode')
            if code not in MARKETPLACES:
                return _resp(400, {'error': 'Неизвестный маркетплейс'})
            cursor = body_data.get('cursor')
            if code == 'ozon':
                res = _sync_ozon(cur, cursor)
            elif code == 'wildberries':
                res = _sync_wb(cur, cursor)
            else:
                res = _sync_yandex(cur, cursor)
            if not res.get('ok'):
                conn.rollback()
                return _resp(502, {'error': res.get('error') or 'Площадка не ответила'})
            conn.commit()
            return _resp(200, res)

        if action == 'save_price':
            if not _can_edit(cur, actor_id):
                return _resp(403, {'error': 'Цены ведёт менеджер или администратор'})
            item_id = body_data.get('itemId')
            code = body_data.get('marketplaceCode')
            if not item_id or code not in MARKETPLACES:
                return _resp(400, {'error': 'Укажите товар и маркетплейс'})
            cur.execute(
                "INSERT INTO marketplace_prices (marketplace_item_id, marketplace_code, "
                "price, commission_fbo_percent, commission_fbs_percent, source, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, 'manual', now()) "
                "ON CONFLICT (marketplace_item_id, marketplace_code) DO UPDATE SET "
                "price = EXCLUDED.price, "
                "commission_fbo_percent = COALESCE(EXCLUDED.commission_fbo_percent, "
                "  marketplace_prices.commission_fbo_percent), "
                "commission_fbs_percent = COALESCE(EXCLUDED.commission_fbs_percent, "
                "  marketplace_prices.commission_fbs_percent), "
                "source = 'manual', updated_at = now()",
                (
                    int(item_id), code,
                    float(body_data['price']) if body_data.get('price') else None,
                    float(body_data['commissionFbo']) if body_data.get('commissionFbo') else None,
                    float(body_data['commissionFbs']) if body_data.get('commissionFbs') else None,
                ),
            )
            conn.commit()
            return _resp(200, {'success': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()