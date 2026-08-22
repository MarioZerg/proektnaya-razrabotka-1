import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2

OZON_API = 'https://api-seller.ozon.ru'
WB_PRICES_API = 'https://discounts-prices-api.wildberries.ru'
WB_COMMISSION_API = 'https://common-api.wildberries.ru'
WB_TARIFFS_API = 'https://common-api.wildberries.ru'
WB_CONTENT_API = 'https://content-api.wildberries.ru'
WB_STATS_API = 'https://statistics-api.wildberries.ru'
YM_API = 'https://api.partner.market.yandex.ru'

# За сколько дней считаем выкуп. Два месяца — чтобы попали и возвраты по
# вещам, купленным в конце периода: покупатель возвращает не сразу.
BUYOUT_PERIOD_DAYS = 60

# Объём одной упакованной вещи в литрах. Логистика WB считается за литры, а
# штора едет в мягкой упаковке — примерно 40x30x10 см. От этого числа зависит
# расчёт доставки, поэтому оно вынесено сюда, а не спрятано в формуле.
WB_VOLUME_LITERS = 12.0

# Габариты и вес для расчёта тарифов Яндекса — та же упакованная штора.
YM_PARCEL = {'length': 40, 'width': 30, 'height': 10, 'weight': 1.5}

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
    # Ozon отдаёт комиссию и логистику по КАЖДОМУ товару, и расчёт берёт их
    # оттуда. Но в настройках площадки те же цифры нужны как ориентир: менеджер
    # смотрит туда, чтобы понять условия работы, и не должен видеть там свои
    # прошлогодние 55%, когда площадка давно считает по 48%.
    tariffs = {}
    if done:
        cur.execute(
            "SELECT AVG(commission_fbo_percent), AVG(commission_fbs_percent), "
            "AVG(logistics_fbo), AVG(logistics_fbs), AVG(return_fbo), "
            "AVG(return_fbs) FROM marketplace_prices "
            "WHERE marketplace_code = 'ozon'"
        )
        r = cur.fetchone() or ()
        keys = ('commission_fbo_percent', 'commission_fbs_percent',
                'logistics_fbo', 'logistics_fbs', 'return_fbo', 'return_fbs')
        for key, val in zip(keys, r):
            if val is not None:
                tariffs[key] = round(float(val), 2)
        # Обратная логистика в настройках одна на площадку — берём по схеме FBS,
        # по ней мы и работаем.
        if 'return_fbs' in tariffs:
            tariffs['return_logistics'] = tariffs.pop('return_fbs')
        tariffs.pop('return_fbo', None)
        if tariffs:
            _save_tariffs(cur, 'ozon', tariffs)
        # Выкуп по данным площадки — с учётом возвратов после доставки.
        _sync_ozon_buyout(cur, headers)
    return {'ok': True, 'saved': saved, 'fetched': len(rows),
            'cursor': next_cursor, 'done': done, 'tariffs': tariffs}


def _save_tariffs(cur, code, fields):
    """Обновляет тарифы площадки теми полями, что пришли из её кабинета.

    Пустые значения не затираем: если площадка что-то не отдала, остаётся то,
    что менеджер вписал руками. Иначе одна неудачная загрузка обнулила бы
    настройки, и весь расчёт поехал бы.
    """
    fields = {k: v for k, v in fields.items() if v is not None}
    if not fields:
        return 0
    # Отметки «авто» НАКАПЛИВАЕМ, а не перезаписываем.
    #
    # Площадка не всегда отдаёт всё сразу: WB ограничивает частоту запросов и на
    # втором заходе может вернуть только логистику. Если затирать список, поле
    # комиссии теряло бы пометку «авто» и выглядело бы так, будто его надо
    # заполнять руками, — хотя площадка его прекрасно присылает.
    cur.execute(
        "SELECT synced_fields FROM marketplace_tariffs WHERE marketplace_code = %s",
        (code,),
    )
    row = cur.fetchone()
    known = {f for f in ((row[0] if row else '') or '').split(',') if f}
    known.update(fields)

    sets = ', '.join(f"{k} = %s" for k in fields)
    cur.execute(
        f"UPDATE marketplace_tariffs SET {sets}, updated_at = now(), "
        "synced_at = now(), synced_fields = %s WHERE marketplace_code = %s",
        (*fields.values(), ','.join(sorted(known)), code),
    )
    return cur.rowcount


def _num_ru(v):
    """Число из ответа площадки. WB присылает «78,2» и «-» вместо пустого."""
    s = str(v or '').strip().replace(',', '.')
    if not s or s == '-':
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _wb_card_dimensions(headers, limit_pages=6, start_cursor=None):
    """Габариты карточек WB по артикулу: {vendorCode: объём в литрах}.

    Логистика WB считается за ЛИТРЫ, а у нас тюль 200 см и штора 800 см едут в
    разных по размеру упаковках. Один общий объём для всех размеров означал бы,
    что мелкие вещи мы считаем дороже, чем есть, а крупные — дешевле.

    Габариты вписаны в саму карточку, поэтому берём их оттуда и переводим в
    литры: сантиметры в кубе делим на 1000.
    """
    out = {}
    cursor = dict(start_cursor) if start_cursor else {}
    cursor['limit'] = 100
    next_cursor = None
    for _ in range(limit_pages):
        st, data = _http(
            f'{WB_CONTENT_API}/content/v2/get/cards/list', 'POST', headers,
            {'settings': {'cursor': cursor, 'filter': {'withPhoto': -1}}},
            timeout=12,
        )
        if st != 200 or not isinstance(data, dict):
            break
        cards = data.get('cards') or []
        for c in cards:
            code = (c.get('vendorCode') or '').strip()
            dim = c.get('dimensions') or {}
            l, w, h = dim.get('length'), dim.get('width'), dim.get('height')
            if code and l and w and h:
                out[code] = round(float(l) * float(w) * float(h) / 1000.0, 3)
        nxt = data.get('cursor') or {}
        if len(cards) < 100 or not nxt.get('updatedAt'):
            # Каталог кончился — следующий заход начнёт сначала, с обновлёнными
            # габаритами. Так изменения в карточках рано или поздно доедут.
            next_cursor = None
            break
        cursor = {'limit': 100, 'updatedAt': nxt.get('updatedAt'),
                  'nmID': nxt.get('nmID')}
        next_cursor = {'updatedAt': nxt.get('updatedAt'), 'nmID': nxt.get('nmID')}
    return out, next_cursor


def _wb_box_rates(headers):
    """Тариф короба WB: (база за первый литр, цена литра) для FBS и FBO."""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    st, box = _http(
        f'{WB_TARIFFS_API}/api/v1/tariffs/box?date={today}', 'GET', headers,
        timeout=12,
    )
    if st != 200 or not isinstance(box, dict):
        return None
    whs = (((box.get('response') or {}).get('data') or {}).get('warehouseList')) or []
    base_l, liter_l, base_o, liter_o = [], [], [], []
    for w in whs:
        b, li = (_num_ru(w.get('boxDeliveryMarketplaceBase')),
                 _num_ru(w.get('boxDeliveryMarketplaceLiter')))
        if b is not None and li is not None:
            base_l.append(b)
            liter_l.append(li)
        bo, lo = (_num_ru(w.get('boxDeliveryBase')),
                  _num_ru(w.get('boxDeliveryLiter')))
        if bo is not None and lo is not None:
            base_o.append(bo)
            liter_o.append(lo)
    avg = lambda xs: sum(xs) / len(xs) if xs else None  # noqa: E731
    return {
        'fbsBase': avg(base_l), 'fbsLiter': avg(liter_l),
        'fboBase': avg(base_o), 'fboLiter': avg(liter_o),
    }


def _box_price(rates, prefix, liters):
    """Стоимость доставки короба по объёму: первый литр по базе, дальше по литру."""
    base = rates.get(f'{prefix}Base')
    liter = rates.get(f'{prefix}Liter')
    if base is None or liter is None or not liters:
        return None
    return round(base + liter * max(liters - 1, 0), 2)


def _sync_wb_tariffs(cur, headers):
    """Комиссия и логистика Wildberries — из кабинета продавца.

    Комиссия у WB зависит от КАТЕГОРИИ товара, а не от карточки: тюль и шторы
    считаются по своей ставке. Поэтому берём категории наших карточек и по ним
    находим комиссию — вписывать её руками значит однажды забыть обновить.

    Логистика приходит тарифом короба: база за первый литр плюс цена за каждый
    следующий. Считаем по среднему объёму нашей вещи — шторы едут в мягкой
    упаковке, около 12 литров.
    """
    out = {}

    # 1. Категории наших карточек. Обычно она одна — «Тюль».
    st, cards = _http(
        'https://content-api.wildberries.ru/content/v2/get/cards/list', 'POST',
        headers, {'settings': {'cursor': {'limit': 100}, 'filter': {'withPhoto': -1}}},
        timeout=10,
    )
    subjects = set()
    if st == 200 and isinstance(cards, dict):
        for c in (cards.get('cards') or []):
            name = (c.get('subjectName') or '').strip()
            if name:
                subjects.add(name.lower())

    # 2. Комиссия по этим категориям.
    st2, comm = _http(
        'https://common-api.wildberries.ru/api/v1/tariffs/commission?locale=ru',
        'GET', headers, timeout=10,
    )
    if st2 == 200 and isinstance(comm, dict):
        fbs, fbo = [], []
        for r in (comm.get('report') or []):
            if (r.get('subjectName') or '').strip().lower() in subjects:
                # kgvpMarketplace — продажа со своего склада (FBS),
                # kgvpSupplier — со склада WB (FBO).
                if r.get('kgvpMarketplace') is not None:
                    fbs.append(float(r['kgvpMarketplace']))
                if r.get('kgvpSupplier') is not None:
                    fbo.append(float(r['kgvpSupplier']))
        if fbs:
            out['commission_fbs_percent'] = round(sum(fbs) / len(fbs), 2)
        if fbo:
            out['commission_fbo_percent'] = round(sum(fbo) / len(fbo), 2)

    # 3. Логистика: тариф короба на сегодня.
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    st3, box = _http(
        f'https://common-api.wildberries.ru/api/v1/tariffs/box?date={today}',
        'GET', headers, timeout=10,
    )
    if st3 == 200 and isinstance(box, dict):
        whs = (((box.get('response') or {}).get('data') or {}).get('warehouseList')) or []
        base_l, liter_l, base_o, liter_o = [], [], [], []
        for w in whs:
            b = _num_ru(w.get('boxDeliveryMarketplaceBase'))
            li = _num_ru(w.get('boxDeliveryMarketplaceLiter'))
            if b is not None and li is not None:
                base_l.append(b)
                liter_l.append(li)
            bo = _num_ru(w.get('boxDeliveryBase'))
            lo = _num_ru(w.get('boxDeliveryLiter'))
            if bo is not None and lo is not None:
                base_o.append(bo)
                liter_o.append(lo)
        if base_l:
            # Первый литр по базовой ставке, остальные по литровой.
            out['logistics_fbs'] = round(
                sum(base_l) / len(base_l)
                + sum(liter_l) / len(liter_l) * (WB_VOLUME_LITERS - 1), 2)
        if base_o:
            out['logistics_fbo'] = round(
                sum(base_o) / len(base_o)
                + sum(liter_o) / len(liter_o) * (WB_VOLUME_LITERS - 1), 2)

    return out


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

        # ЛОГИСТИКА ПО КАЖДОМУ РАЗМЕРУ.
        #
        # WB считает доставку за литры, а тюль 200 см и штора 800 см едут в
        # разных упаковках. Раньше на все размеры шёл один усреднённый объём —
        # мелкие вещи выглядели дороже, чем есть, крупные дешевле. Берём
        # габариты из самой карточки и считаем доставку для каждого размера.
        # Габариты карточек копим в базе: за вызов WB отдаёт сотню, а карточек
        # почти восемьсот. Уже известные объёмы берём из базы, новые дописываем
        # по одной странице за заход — так за несколько запусков наберутся все,
        # и ни один вызов не упрётся в лимит времени.
        cur.execute(
            "SELECT mi.sku, mp.volume_liters FROM marketplace_prices mp "
            "JOIN marketplace_items mi ON mi.id = mp.marketplace_item_id "
            "WHERE mp.marketplace_code = 'wildberries' "
            "  AND mp.volume_liters IS NOT NULL AND mi.sku IS NOT NULL"
        )
        dims = {str(r[0]).strip(): float(r[1]) for r in cur.fetchall()}

        cur.execute(
            "SELECT value FROM system_settings WHERE key = 'wb_cards_cursor'")
        row = cur.fetchone()
        try:
            start = json.loads(row[0]) if row and row[0] else None
        except (TypeError, ValueError):
            start = None

        fresh, next_cards = _wb_card_dimensions(
            headers, limit_pages=1, start_cursor=start)
        dims.update(fresh)
        cur.execute(
            "INSERT INTO system_settings (key, value) VALUES "
            "('wb_cards_cursor', %s) ON CONFLICT (key) DO UPDATE SET "
            "value = EXCLUDED.value, updated_at = now()",
            (json.dumps(next_cards) if next_cards else '',),
        )
        box = _wb_box_rates(headers) or {}

        for g in goods:
            vendor = str(g.get('vendorCode') or '').strip()
            item_id = by_sku.get(vendor)
            if not item_id:
                continue
            liters = dims.get(vendor)
            sizes = g.get('sizes') or []
            price = None
            discounted = None
            if sizes:
                price = sizes[0].get('price')
                discounted = sizes[0].get('discountedPrice')
            # Цена, которую реально платит покупатель. WB отдаёт её как
            # clubDiscountedPrice (цена с WB-кошельком) или discountedPrice —
            # это уже после скидок площадки, а не наша цена в карточке.
            club = sizes[0].get('clubDiscountedPrice') if sizes else None
            actual = club or discounted
            rows.append({
                'itemId': item_id,
                # Продавец получает цену ПОСЛЕ своей скидки.
                'price': float(discounted) if discounted else (
                    float(price) if price else None),
                'priceBeforeDiscount': float(price) if price else None,
                'priceWithMarketplaceDiscount': float(actual) if actual else None,
                'discountPercent': float(g['discount']) if g.get('discount') else None,
                'volumeLiters': liters,
                'logisticsFbs': _box_price(box, 'fbs', liters),
                'logisticsFbo': _box_price(box, 'fbo', liters),
            })
        done = len(goods) < 100
        next_cursor = '' if done else str(offset + 100)

    saved = _save_prices(cur, 'wildberries', rows)
    # Комиссию и логистику тянем один раз — на последней странице. Они общие для
    # площадки, дёргать их на каждой сотне карточек незачем.
    tariffs = _sync_wb_tariffs(cur, headers) if done else {}
    if tariffs:
        _save_tariffs(cur, 'wildberries', tariffs)
    if done:
        # Выкуп по отчёту продаж площадки — там видны возвраты после доставки.
        _sync_wb_buyout(cur, headers)
    return {'ok': True, 'saved': saved, 'fetched': len(rows),
            'cursor': next_cursor, 'done': done, 'tariffs': tariffs}


def _sync_ym_tariffs(cur, headers, campaign_id, avg_price):
    """Комиссия, эквайринг и доставка Яндекс Маркета — через калькулятор тарифов.

    Яндекс не отдаёт «ставку комиссии» списком: он считает стоимость услуг для
    КОНКРЕТНОГО товара — цена, габариты, категория. Поэтому спрашиваем расчёт по
    нашей средней шторе и переводим ответ в проценты и рубли.

    Что приходит:
      FEE               — комиссия за продажу, % от цены;
      PAYMENT_TRANSFER  — перевод денег продавцу, это эквайринг;
      DELIVERY_TO_CUSTOMER — доставка покупателю, рублями.
    """
    out = {}
    # Категория наших карточек: спрашиваем у самого Маркета, к чему он относит
    # наш товар, — угадывать номер категории руками нельзя, он меняется.
    #
    # Категория лежит в карточках бизнеса (offer-mappings), а не в ценах: там
    # только цены и остатки. Номер бизнеса берём из списка кампаний, чтобы не
    # зашивать его в код.
    business_id = _ym_business_id(headers, campaign_id)

    category_id = None
    if business_id:
        st, maps = _http(
            f'{YM_API}/businesses/{business_id}/offer-mappings?limit=10',
            'POST', headers, {}, timeout=10,
        )
        if st == 200 and isinstance(maps, dict):
            for m in ((maps.get('result') or {}).get('offerMappings')) or []:
                category_id = (m.get('mapping') or {}).get('marketCategoryId')
                if category_id:
                    break

    if not category_id:
        return out

    st2, data = _http(
        f'{YM_API}/tariffs/calculate', 'POST', headers,
        {'parameters': {'campaignId': int(campaign_id)},
         'offers': [{'categoryId': int(category_id),
                     'price': avg_price or 5000, 'quantity': 1, **YM_PARCEL}]},
        timeout=10,
    )
    if st2 != 200 or not isinstance(data, dict):
        return out

    offers = ((data.get('result') or {}).get('offers')) or []
    if not offers:
        return out

    for t in (offers[0].get('tariffs') or []):
        kind = t.get('type')
        params = {p.get('name'): p.get('value') for p in (t.get('parameters') or [])}
        value = _num_ru(params.get('value'))
        amount = _num_ru(t.get('amount'))
        if kind == 'FEE' and value is not None:
            out['commission_fbs_percent'] = round(value, 2)
        elif kind == 'PAYMENT_TRANSFER' and value is not None:
            out['acquiring_percent'] = round(value, 2)
        elif kind == 'DELIVERY_TO_CUSTOMER' and amount is not None:
            out['logistics_fbs'] = round(amount, 2)
    return out


def _ym_business_id(headers, campaign_id):
    """Номер бизнеса Яндекса по кампании — в нём лежат карточки с габаритами."""
    st, camps = _http(f'{YM_API}/campaigns', 'GET', headers, timeout=10)
    if st != 200 or not isinstance(camps, dict):
        return None
    for c in (camps.get('campaigns') or []):
        if str(c.get('id')) == str(campaign_id):
            return (c.get('business') or {}).get('id')
    return None


def _ym_item_logistics(headers, campaign_id, business_id, offer_ids, prices):
    """Логистика Яндекса по КАЖДОМУ товару: {offerId: рубли}.

    Доставка зависит от габаритов и цены, а они у наших размеров разные: тюль
    200 см и штора 800 см не могут стоить одинаково в перевозке. Калькулятор
    Яндекса умеет считать сразу пачку товаров — этим и пользуемся.

    Габариты берём из карточек: продавец заполняет их в кабинете, и это те же
    цифры, по которым площадка считает доставку на самом деле.
    """
    if not business_id or not offer_ids:
        return {}

    # Габариты и категории карточек.
    cards = {}
    st, data = _http(
        f'{YM_API}/businesses/{business_id}/offer-mappings?limit=200', 'POST',
        headers, {'offerIds': offer_ids[:200]}, timeout=12,
    )
    if st == 200 and isinstance(data, dict):
        for m in ((data.get('result') or {}).get('offerMappings')) or []:
            offer = m.get('offer') or {}
            oid = (offer.get('offerId') or '').strip()
            wd = offer.get('weightDimensions') or {}
            cat = (m.get('mapping') or {}).get('marketCategoryId')
            if oid and cat and wd.get('length'):
                cards[oid] = {
                    'categoryId': int(cat),
                    'length': float(wd.get('length') or 0),
                    'width': float(wd.get('width') or 0),
                    'height': float(wd.get('height') or 0),
                    'weight': float(wd.get('weight') or 0) or 1.0,
                }

    if not cards:
        return {}

    order = list(cards.keys())
    offers = [{
        'categoryId': cards[o]['categoryId'],
        'price': prices.get(o) or 5000,
        'length': cards[o]['length'] or YM_PARCEL['length'],
        'width': cards[o]['width'] or YM_PARCEL['width'],
        'height': cards[o]['height'] or YM_PARCEL['height'],
        'weight': cards[o]['weight'] or YM_PARCEL['weight'],
        'quantity': 1,
    } for o in order]

    out = {}
    # Считаем частями: калькулятор не любит слишком длинные списки.
    for start in range(0, len(offers), 50):
        chunk = offers[start:start + 50]
        st2, res = _http(
            f'{YM_API}/tariffs/calculate', 'POST', headers,
            {'parameters': {'campaignId': int(campaign_id)}, 'offers': chunk},
            timeout=15,
        )
        if st2 != 200 or not isinstance(res, dict):
            continue
        for i, row in enumerate(((res.get('result') or {}).get('offers')) or []):
            oid = order[start + i] if start + i < len(order) else None
            if not oid:
                continue
            for t in (row.get('tariffs') or []):
                if t.get('type') == 'DELIVERY_TO_CUSTOMER':
                    amount = _num_ru(t.get('amount'))
                    if amount is not None:
                        out[oid] = round(amount, 2)
    return out


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

        # Логистика по КАЖДОМУ размеру: считаем пачкой для товаров этой страницы.
        #
        # У функции 5 секунд на всё, а тут три обращения к Яндексу подряд:
        # кампании, карточки, калькулятор. Номер бизнеса не меняется — держим
        # его в настройках, чтобы не спрашивать заново на каждой странице.
        page_ids, page_prices = [], {}
        for o in offers:
            oid = str(o.get('offerId') or o.get('id') or '').strip()
            if oid and by_sku.get(oid):
                page_ids.append(oid)
                p = (o.get('price') or {}).get('value')
                if p:
                    page_prices[oid] = float(p)

        cur.execute(
            "SELECT value FROM system_settings WHERE key = 'ym_business_id'")
        row = cur.fetchone()
        business_id = (row[0] if row else None) or None
        if not business_id:
            business_id = _ym_business_id(headers, campaign_id)
            if business_id:
                cur.execute(
                    "INSERT INTO system_settings (key, value) VALUES "
                    "('ym_business_id', %s) ON CONFLICT (key) DO UPDATE SET "
                    "value = EXCLUDED.value, updated_at = now()",
                    (str(business_id),),
                )

        item_logistics = _ym_item_logistics(
            headers, campaign_id, business_id, page_ids, page_prices)

        for o in offers:
            offer_id = str(o.get('offerId') or o.get('id') or '').strip()
            item_id = by_sku.get(offer_id)
            if not item_id:
                continue
            price = (o.get('price') or {}).get('value')
            # Цена покупателя на витрине: Яндекс отдаёт её отдельно, уже с
            # учётом своих акций. Наша цена из кабинета бывает заметно выше.
            market = (o.get('marketSku') or {}).get('price') or {}
            actual = market.get('value') or (
                (o.get('priceWithDiscount') or {}).get('value'))
            rows.append({
                'itemId': item_id,
                'price': float(price) if price else None,
                'priceWithMarketplaceDiscount': float(actual) if actual else None,
                'logisticsFbs': item_logistics.get(offer_id),
            })
        next_cursor = (result.get('paging') or {}).get('nextPageToken') or ''
        done = not next_cursor or not offers

    saved = _save_prices(cur, 'yandex_market', rows)
    # Тарифы считаются по конкретной цене товара, поэтому берём среднюю по
    # нашим карточкам, а не выдуманную. Спрашиваем один раз, в конце обхода.
    tariffs = {}
    if done:
        cur.execute(
            "SELECT AVG(price) FROM marketplace_prices "
            "WHERE marketplace_code = 'yandex_market' AND price > 0"
        )
        row = cur.fetchone()
        avg_price = float(row[0]) if row and row[0] else None
        tariffs = _sync_ym_tariffs(cur, headers, campaign_id, avg_price)
        # Выкуп по статусам заказов площадки — с учётом невыкупов.
        _sync_ym_buyout(cur, headers, campaign_id)
        if tariffs:
            _save_tariffs(cur, 'yandex_market', tariffs)
    return {'ok': True, 'saved': saved, 'fetched': len(rows),
            'cursor': next_cursor, 'done': done, 'tariffs': tariffs}


def _settings(cur):
    """Налоги компании: УСН и НДС.

    Постоянных расходов здесь больше нет. Аренда, оклады и обслуживание машин
    ведутся списком статей в себестоимости и уже разложены на каждую вещь —
    держать их ещё и тут значило считать одни и те же деньги дважды.
    """
    cur.execute(
        "SELECT tax_percent, vat_percent "
        "FROM unit_economics_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return {'taxPercent': 6.0, 'vatPercent': 0.0}
    return {'taxPercent': float(r[0] or 0), 'vatPercent': float(r[1] or 0)}


def _tariffs(cur):
    """Тарифы каждой площадки: логистика, хранение, приёмка, эквайринг, реклама."""
    cur.execute(
        "SELECT marketplace_code, logistics_fbo, logistics_fbs, return_logistics, "
        "storage_per_month, acceptance_fee, acquiring_percent, promo_percent, "
        "storage_months, commission_fbo_percent, commission_fbs_percent, "
        "synced_at, synced_fields, promo_from_fact, promo_fact_percent, "
        "promo_synced_at FROM marketplace_tariffs"
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
            # Какие поля пришли из кабинета площадки и когда: экран помечает их,
            # чтобы менеджер не правил руками то, что перезапишется загрузкой.
            'syncedAt': r[11].isoformat() + 'Z' if r[11] else None,
            'syncedFields': [f for f in (r[12] or '').split(',') if f],
            # Реклама по факту: сколько площадка реально списала за месяц.
            'promoFromFact': bool(r[13]) if r[13] is not None else True,
            'promoFactPercent': float(r[14]) if r[14] is not None else None,
            'promoSyncedAt': r[15].isoformat() + 'Z' if r[15] else None,
        }
    for code in MARKETPLACES:
        out.setdefault(code, {
            'marketplaceCode': code, 'logisticsFbo': 0.0, 'logisticsFbs': 0.0,
            'returnLogistics': 0.0, 'storagePerMonth': 0.0, 'acceptanceFee': 0.0,
            'acquiringPercent': 0.0, 'promoPercent': 0.0, 'storageMonths': 1.0,
            'commissionFboPercent': 0.0, 'commissionFbsPercent': 0.0,
            'syncedAt': None, 'syncedFields': [],
            'promoFromFact': True, 'promoFactPercent': None,
            'promoSyncedAt': None,
        })
    return out


def _save_buyout(cur, code, scheme, percent, stats):
    """Сохраняет процент выкупа, посчитанный самой площадкой."""
    if percent is None:
        return
    cur.execute(
        "INSERT INTO marketplace_buyout (marketplace_code, scheme, percent, "
        "ordered_units, delivered_units, returned_units, cancelled_units, "
        "period_days, synced_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now()) "
        "ON CONFLICT (marketplace_code, scheme) DO UPDATE SET "
        "percent = EXCLUDED.percent, ordered_units = EXCLUDED.ordered_units, "
        "delivered_units = EXCLUDED.delivered_units, "
        "returned_units = EXCLUDED.returned_units, "
        "cancelled_units = EXCLUDED.cancelled_units, "
        "period_days = EXCLUDED.period_days, synced_at = now()",
        (code, scheme, round(percent, 2), stats.get('ordered'),
         stats.get('delivered'), stats.get('returned'), stats.get('cancelled'),
         BUYOUT_PERIOD_DAYS),
    )


def _sync_ozon_buyout(cur, headers):
    """Выкуп OZON — из отчёта аналитики площадки.

    Площадка отдаёт по каждому товару: сколько заказали, сколько доставили,
    сколько отменили и вернули. Выкуп — это доля доставленных за вычетом
    возвратов: именно те вещи, за которые нам заплатили и оставили себе.
    """
    date_to = datetime.now(timezone.utc).date()
    date_from = date_to - timedelta(days=BUYOUT_PERIOD_DAYS)
    st, data = _http(
        f'{OZON_API}/v1/analytics/data', 'POST', headers,
        {'date_from': date_from.strftime('%Y-%m-%d'),
         'date_to': date_to.strftime('%Y-%m-%d'),
         'metrics': ['ordered_units', 'delivered_units', 'cancellations',
                     'returns'],
         'dimension': ['sku'], 'limit': 1000},
        timeout=15,
    )
    if st != 200 or not isinstance(data, dict):
        return None
    totals = ((data.get('result') or {}).get('totals')) or []
    if len(totals) < 4:
        return None
    ordered, delivered, cancelled, returned = (float(x or 0) for x in totals[:4])
    if ordered <= 0:
        return None
    kept = max(delivered - returned, 0)
    percent = round(100.0 * kept / ordered, 2)
    stats = {'ordered': int(ordered), 'delivered': int(delivered),
             'returned': int(returned), 'cancelled': int(cancelled)}
    _save_buyout(cur, 'ozon', 'FBS', percent, stats)
    _save_buyout(cur, 'ozon', 'FBO', percent, stats)
    return {'percent': percent, **stats}


def _sync_wb_buyout(cur, headers):
    """Выкуп Wildberries — из отчёта о продажах.

    В отчёте каждая строка — либо продажа, либо возврат (номер начинается с R).
    Выкуп считаем как долю продаж, оставшихся у покупателей.
    """
    date_from = (datetime.now(timezone.utc).date()
                 - timedelta(days=BUYOUT_PERIOD_DAYS)).strftime('%Y-%m-%d')
    st, rows = _http(
        f'{WB_STATS_API}/api/v1/supplier/sales?dateFrom={date_from}',
        'GET', headers, timeout=20,
    )
    if st != 200 or not isinstance(rows, list) or not rows:
        return None
    returns = sum(1 for r in rows if str(r.get('saleID') or '').startswith('R'))
    sales = len(rows) - returns
    total = sales + returns
    if total <= 0:
        return None
    percent = round(100.0 * sales / total, 2)
    stats = {'ordered': total, 'delivered': sales, 'returned': returns,
             'cancelled': None}
    _save_buyout(cur, 'wildberries', 'FBS', percent, stats)
    _save_buyout(cur, 'wildberries', 'FBO', percent, stats)
    return {'percent': percent, **stats}


def _sync_ym_buyout(cur, headers, campaign_id):
    """Выкуп Яндекс Маркета — по статусам заказов кампании.

    Площадка отдаёт список заказов со статусами. Выкуп — доля доставленных из
    всех, что доехали до развязки: отменённые и возвращённые вычитаем.
    """
    date_from = (datetime.now(timezone.utc).date()
                 - timedelta(days=BUYOUT_PERIOD_DAYS)).strftime('%Y-%m-%d')
    st, data = _http(
        f'{YM_API}/campaigns/{campaign_id}/orders'
        f'?fromDate={date_from}&pageSize=200', 'GET', headers, timeout=20,
    )
    if st != 200 or not isinstance(data, dict):
        return None
    orders = data.get('orders') or []
    if not orders:
        return None

    delivered = cancelled = returned = 0
    for o in orders:
        status = (o.get('status') or '').upper()
        sub = (o.get('substatus') or '').upper()
        if status == 'DELIVERED':
            delivered += 1
        elif status == 'CANCELLED':
            # Возврат после доставки — отдельная история: покупатель вещь видел.
            if 'RETURNED' in sub or 'DELIVERY_SERVICE_UNDELIVERED' in sub:
                returned += 1
            else:
                cancelled += 1
    total = delivered + cancelled + returned
    # Меньше двадцати заказов — это не статистика, а случайность: один
    # отказ качнёт процент на пять пунктов. Лучше показать «нет данных»,
    # чем посчитать всю экономику по трём заказам.
    if total < 20:
        return None
    percent = round(100.0 * delivered / total, 2)
    stats = {'ordered': total, 'delivered': delivered, 'returned': returned,
             'cancelled': cancelled}
    _save_buyout(cur, 'yandex_market', 'FBS', percent, stats)
    _save_buyout(cur, 'yandex_market', 'FBO', percent, stats)
    return {'percent': percent, **stats}


def _buyout_from_marketplaces(cur):
    """Проценты выкупа, посчитанные площадками: {(код, схема): данные}."""
    cur.execute(
        "SELECT marketplace_code, scheme, percent, ordered_units, "
        "delivered_units, returned_units, synced_at FROM marketplace_buyout"
    )
    out = {}
    for code, scheme, percent, ordered, delivered, returned, at in cur.fetchall():
        out[(code, scheme)] = {
            'percent': float(percent) if percent is not None else None,
            'ordered': ordered, 'delivered': delivered, 'returned': returned,
            'syncedAt': at.isoformat() + 'Z' if at else None,
        }
    return out


def _buyout_rates(cur):
    """РЕАЛЬНЫЙ процент выкупа по нашим заказам — отдельно по площадке и схеме.

    Это ключевой параметр всей экономики: при выкупе 80% каждая пятая вещь едет
    обратно, и обратная логистика съедает прибыль с четырёх проданных. Считать
    его «на глазок» нельзя, а у нас есть точные отметки отмен по заказам.

    ВАЖНО: это только отмены ДО отгрузки. Возврат через две недели после
    доставки сюда не попадает, поэтому цифра всегда оптимистичнее правды. Более
    честные данные приходят от самой площадки — см. _buyout_from_marketplaces.
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
    Комиссия площадки и налог сюда не входят: они считаются от ЦЕНЫ ПРОДАЖИ, а
    не от затрат, и вычитаются ниже, в расчёте одной единицы. Страница
    себестоимости считает ровно так же — обе стороны показывают одну цифру.
    """
    cur.execute(
        "SELECT overhead_per_item, workshop_id FROM cost_settings ORDER BY id LIMIT 1"
    )
    cs = cur.fetchone()
    workshop_id = cs[1] if cs else None
    overhead_legacy = float(cs[0] or 0) if cs else 0.0

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


# Потолок доли рекламы в цене товара. Бывает, что на позицию потратили больше,
# чем она принесла (в данных встречалось 887% — товар только раскручивали).
# Тащить такое число в юнит-экономику нельзя: оно не описывает нормальную
# продажу, а превращает расчёт в бессмыслицу и прячет настоящую картину по
# остальному ассортименту. Всё, что выше, считаем разовым перекосом и
# ограничиваем средним по площадке.
AD_PERCENT_CAP = 40.0


def _ad_percents(cur, marketplace):
    """Фактическая доля рекламы по каждому товару, %.

    WB отдаёт расход по каждому товару, поэтому позиция, которую продвигали,
    несёт свою рекламу, а та, что продавалась сама, не платит за чужой бустинг.
    OZON списывает рекламу общей суммой — там у всех товаров один процент.
    """
    cur.execute(
        "SELECT marketplace_item_id, ad_percent FROM marketplace_ad_spend "
        "WHERE marketplace_code = %s AND marketplace_item_id IS NOT NULL "
        "  AND ad_percent IS NOT NULL",
        (marketplace,),
    )
    return {r[0]: min(float(r[1]), AD_PERCENT_CAP) for r in cur.fetchall()}


def _calc_unit(price, cost, tariff, settings, commission_percent, scheme, buyout,
               item_fees=None, ad_percent=None):
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
    # Продвижение считаем ПО ФАКТУ, а не по числу, вписанному руками: реклама
    # съедает около 20% выручки, а в настройках стояло 10% (WB — вообще ноль), и
    # маржа выходила завышенной. Порядок такой:
    #   1) сколько реально потрачено на ЭТОТ товар (WB отдаёт по каждому);
    #   2) если по товару данных нет — средний факт по площадке;
    #   3) если факта нет совсем — ручное значение как запасной вариант.
    promo_percent = ad_percent
    if promo_percent is None:
        promo_percent = tariff.get('promoFactPercent')
    if promo_percent is None or not tariff.get('promoFromFact', True):
        promo_percent = tariff['promoPercent']
    promo = round(price * (promo_percent or 0) / 100, 2)

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

    # НАЛОГИ. Считаются от ФАКТИЧЕСКОЙ цены покупателя (price) — это вся сумма,
    # которую он заплатил на площадке. Комиссия и логистика базу НЕ уменьшают:
    # при УСН «доходы» налог платится со всей выручки, даже с той части, что
    # площадка удержала себе и до нашего счёта не дошла.
    #
    # НДС уже сидит ВНУТРИ цены на витрине — покупатель не доплачивает его
    # сверху. Поэтому его не прибавляют к цене, а ВЫНИМАЮТ из неё:
    # при ставке 22% в 1220 ₽ содержится 220 ₽ налога.
    vat_percent = settings.get('vatPercent') or 0
    vat = round(price * vat_percent / (100 + vat_percent), 2) if vat_percent else 0.0

    # Доход по УСН считается БЕЗ НДС — иначе один и тот же рубль облагается
    # дважды. Поэтому база для УСН — цена за вычетом НДС.
    revenue_net = round(price - vat, 2)
    tax = round(revenue_net * settings['taxPercent'] / 100, 2)

    profit = round(price - marketplace_costs - production - tax - vat, 2)
    margin = round(profit / price * 100, 1) if price else 0.0
    # Рентабельность вложений: сколько прибыли на каждый вложенный рубль.
    roi = round(profit / production * 100, 1) if production else 0.0

    # Минимальная цена без убытка. Комиссия, эквайринг, реклама и налог зависят
    # от самой цены, поэтому решаем уравнение: цена × (1 - доля%) = постоянные.
    # Если эквайринг пришёл суммой, он не зависит от цены — значит уходит в
    # постоянную часть, а не в процентную.
    acquiring_is_fixed = fees.get('acquiringAmount') is not None
    # НДС и УСН тоже тянутся за ценой, но по-своему: НДС — это доля vat/(100+vat)
    # от цены, а УСН берётся с остатка после НДС. Считаем их совокупную долю,
    # иначе минимальная цена окажется заниженной и товар уйдёт в минус.
    vat_share = vat_percent / (100.0 + vat_percent) if vat_percent else 0.0
    tax_share = (1 - vat_share) * settings['taxPercent'] / 100.0
    variable_share = (
        (commission_percent or 0)
        + (0 if acquiring_is_fixed else tariff['acquiringPercent'])
        + (promo_percent or 0)
    ) / 100.0 + vat_share + tax_share
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
        # Какой процент рекламы применён к этому товару и откуда он взят —
        # экран показывает это рядом с цифрой, чтобы не гадать.
        'promoPercent': round(promo_percent or 0, 2),
        'promoIsFact': ad_percent is not None
        or (tariff.get('promoFactPercent') is not None
            and tariff.get('promoFromFact', True)),
        'logistics': logistics,
        'logisticsBase': round(logistics_direct, 2),
        'returnCost': return_cost,
        'storage': storage,
        'acceptance': acceptance,
        'marketplaceCosts': marketplace_costs,
        'productionCost': production,
        'tax': tax,
        'vat': vat,
        # Ставка НДС — нужна карточке, чтобы показать формулу расчёта.
        'vatPercent': vat_percent,
        # Выручка без НДС — именно с неё считается налог УСН.
        'revenueNet': revenue_net,
        'profit': profit,
        'margin': margin,
        'roi': roi,
        'buyoutPercent': round(buyout, 1),
        'breakEvenPrice': break_even_price,
    }


def _build(cur, code, scheme, buyout_override, shared=None):
    """Собирает расчёт по всем товарам одной площадки.

    shared — уже прочитанные справочники (налоги, тарифы, себестоимость, выкуп).
    Сравнение площадок считает шесть вариантов подряд, и без этого одни и те же
    таблицы перечитывались шесть раз: база упиралась в лимит запросов и страница
    сравнения падала целиком.
    """
    s = shared or {}
    settings = s.get('settings') or _settings(cur)
    tariffs = (s.get('tariffs') or _tariffs(cur))[code]
    costs = s.get('costs') or _cost_by_group(cur)
    prices = _prices_by_item(cur, code)
    buyouts = s.get('buyouts') or _buyout_rates(cur)

    orders_mp = ORDERS_CODE.get(code)
    real = buyouts.get((orders_mp, scheme))
    real_buyout = real['percent'] if real else None

    # ВЫКУП БЕРЁМ У ПЛОЩАДКИ, а не из своих заказов.
    #
    # Наши отметки видят только отмены ДО отгрузки. Покупатель может забрать
    # вещь и вернуть её через две недели — такой возврат в наши данные не
    # попадает, поэтому свой выкуп всегда выглядит красивее реального.
    # У OZON разрыв оказался в 20 пунктов: 90% по нашим отметкам против 69% по
    # данным площадки. Считать логистику по завышенному выкупу — значит не
    # видеть трети обратных поездок.
    mp_buyouts = s.get('mpBuyouts') or _buyout_from_marketplaces(cur)
    from_mp = mp_buyouts.get((code, scheme))
    mp_buyout = from_mp['percent'] if from_mp else None

    buyout = buyout_override or mp_buyout or real_buyout or 100.0

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
        # ЦЕНА, ПО КОТОРОЙ СЧИТАЕМ ВСЁ, — та, что реально платит покупатель.
        #
        # На витрине площадка часто режет цену своими акциями и баллами: в
        # карточке 5000 ₽, а на кассе покупатель отдаёт 4300 ₽. Комиссия,
        # эквайринг и налог считаются от этой фактической суммы, а не от нашей
        # цены в кабинете — иначе прибыль на бумаге выше настоящей.
        #
        # Если площадка фактическую цену не отдала, берём цену карточки: лучше
        # посчитать по ней, чем не посчитать вовсе.
        actual = (p or {}).get('priceWithMarketplaceDiscount')
        g['items'].append({
            'id': item_id, 'height': height, 'name': name, 'sku': sku,
            'price': (actual if actual else (p['price'] if p else None)),
            # Помечаем, откуда взялась цена: менеджеру важно видеть, где расчёт
            # идёт по реальной продаже, а где по цене витрины.
            'priceIsActual': bool(actual),
            'cardPrice': p['price'] if p else None,
            'commissionFbo': p['commissionFboPercent'] if p else None,
            'commissionFbs': p['commissionFbsPercent'] if p else None,
            'discountPercent': p['discountPercent'] if p else None,
            'source': p['source'] if p else None,
            'fees': p if p else None,
        })

    # Фактическая реклама по товарам этой площадки.
    ad_percents = _ad_percents(cur, code)

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
                scheme, buyout, i['fees'], ad_percents.get(i['id']),
            )
            heights.append({
                'itemId': i['id'], 'height': i['height'], 'name': i['name'],
                'sku': i['sku'], 'source': i['source'],
                'discountPercent': i['discountPercent'],
                'priceIsActual': i['priceIsActual'],
                'cardPrice': i['cardPrice'],
                'unit': unit,
            })

        avg_price = round(sum(i['price'] for i in priced) / len(priced), 2) if priced else None
        # Тарифы для группы берём у первого товара с ценой: внутри пары
        # «ткань + ширина» габариты одинаковые, значит и логистика тоже.
        group_fees = priced[0]['fees'] if priced else None
        # Реклама по группе — средняя по её размерам: внутри «ткань + ширина»
        # продвигают обычно не все высоты, и брать процент одной из них нельзя.
        g_ads = [ad_percents[i['id']] for i in g['items'] if i['id'] in ad_percents]
        group_ad = round(sum(g_ads) / len(g_ads), 2) if g_ads else None
        group_unit = _calc_unit(avg_price, cost, tariffs, settings,
                                commission_percent, scheme, buyout, group_fees,
                                group_ad)
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
            # Данные самой площадки: они честнее наших отметок, потому что
            # учитывают возвраты уже после доставки.
            'fromMarketplace': mp_buyout,
            'mpOrdered': from_mp['ordered'] if from_mp else None,
            'mpDelivered': from_mp['delivered'] if from_mp else None,
            'mpReturned': from_mp['returned'] if from_mp else None,
            'mpSyncedAt': from_mp['syncedAt'] if from_mp else None,
            'source': ('override' if buyout_override
                       else 'marketplace' if mp_buyout
                       else 'orders' if real_buyout else 'none'),
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
    POST /  { action: 'save_settings', taxPercent, vatPercent }
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

            if action == 'storage':
                """Хранение по товарам: кто съедает деньги на складе.

                Площадка присылает хранение ОДНОЙ суммой за месяц, и по ней
                нельзя понять, какие позиции его тянут. Сама она «сколько дней
                лежит эта штука» не отдаёт, поэтому считаем оборачиваемость:
                дни запаса = остаток / средние продажи в день.

                Позиция с остатком 300 штук при продаже 2 в день пролежит
                150 дней и наберёт хранения; такая же при 30 в день уйдёт за
                декаду. Общую сумму раскладываем пропорционально «штуко-дням»,
                то есть остатку с поправкой на скорость продаж, — иначе быстрый
                товар платил бы за чужой простой.
                """
                code = params.get('marketplace') or 'ozon'
                days = int(params.get('days') or 30)

                # Хранение за последний месяц, где оно есть.
                cur.execute(
                    "SELECT month::text, sum(amount) FROM marketplace_fees_monthly "
                    "WHERE marketplace_code = %s AND category = 'storage' "
                    "GROUP BY month ORDER BY month DESC LIMIT 1",
                    (code,),
                )
                row = cur.fetchone()
                storage_total = float(row[1]) if row else 0.0
                storage_month = row[0] if row else None

                # Остатки и продажи по каждой позиции.
                mp_name = {'ozon': 'OZON', 'wildberries': 'WB'}.get(code, 'OZON')
                cur.execute(
                    "SELECT s.sku, s.offer_id, s.product_name, "
                    "       s.marketplace_item_id, "
                    "       s.free_amount + s.reserved_amount AS stock, "
                    "       coalesce(o.sold, 0) AS sold "
                    "FROM marketplace_stocks s "
                    "LEFT JOIN ("
                    "  SELECT marketplace_item_id, count(*) AS sold "
                    "  FROM orders "
                    f"  WHERE marketplace = '{mp_name}' AND cancelled_at IS NULL "
                    f"    AND created_at >= now() - interval '{days} days' "
                    "  GROUP BY marketplace_item_id"
                    ") o ON o.marketplace_item_id = s.marketplace_item_id "
                    "WHERE s.marketplace_code = %s "
                    "  AND s.free_amount + s.reserved_amount > 0 "
                    "ORDER BY stock DESC",
                    (code,),
                )
                raw = cur.fetchall()

                # Штуко-дни: остаток × сколько дней он пролежит. Это и есть
                # доля товара в счёте за хранение.
                items = []
                total_weight = 0.0
                for sku, offer, name, item_id, stock, sold in raw:
                    stock = int(stock or 0)
                    sold = int(sold or 0)
                    per_day = sold / days if sold else 0
                    # Без продаж товар лежит неопределённо долго. Ограничиваем
                    # год: иначе одна мёртвая позиция забирает весь счёт на себя
                    # и остальные выглядят бесплатными.
                    days_left = min(365, round(stock / per_day)) if per_day else 365
                    weight = stock * days_left
                    total_weight += weight
                    items.append({
                        'sku': sku,
                        'offerId': offer,
                        'name': name,
                        'itemId': item_id,
                        'stock': stock,
                        'soldPeriod': sold,
                        'perDay': round(per_day, 2),
                        'daysLeft': days_left,
                        '_w': weight,
                    })

                for it in items:
                    share = (it.pop('_w') / total_weight) if total_weight else 0
                    cost = storage_total * share
                    it['storageCost'] = round(cost, 2)
                    it['storagePerUnit'] = round(cost / it['stock'], 2) \
                        if it['stock'] else None

                items.sort(key=lambda x: x['storageCost'], reverse=True)

                return _resp(200, {
                    'marketplace': code,
                    'month': storage_month,
                    'storageTotal': round(storage_total, 2),
                    'positions': len(items),
                    'totalStock': sum(i['stock'] for i in items),
                    'items': items[:100],
                })

            if action == 'fees':
                """Удержания площадки по статьям и месяцам + чистая прибыль.

                В юнит-экономике товара учтены только комиссия, логистика,
                эквайринг и реклама — то, что зависит от самой продажи.
                А площадка удерживает и другое: досрочная выплата, платные
                слоты, подписка Premium, страхование, штрафы. Эти расходы
                относятся к МАГАЗИНУ и МЕСЯЦУ, а не к конкретной вещи:
                подписка не дорожает от того, что продали ещё одну штору.

                Класть их в юнитку товара нельзя — цифра станет ложной.
                Поэтому показываем отдельно и здесь же считаем, что осталось
                после ВСЕХ удержаний.
                """
                code = params.get('marketplace') or 'ozon'
                months = int(params.get('months') or 6)

                cur.execute(
                    "SELECT month::text, fee_name, amount, operations, category "
                    "FROM marketplace_fees_monthly "
                    "WHERE marketplace_code = %s "
                    f"  AND month >= date_trunc('month', now()) "
                    f"      - interval '{months} months' "
                    "ORDER BY month DESC, amount DESC",
                    (code,),
                )
                rows = cur.fetchall()

                by_month = {}
                for m, name, amount, ops, cat in rows:
                    by_month.setdefault(m, []).append({
                        'name': name,
                        'amount': float(amount or 0),
                        'operations': int(ops or 0),
                        'category': cat,
                    })

                # Оборот, реклама и штуки того же месяца — чтобы посчитать,
                # сколько осталось и сколько это на вещь.
                cur.execute(
                    "SELECT month::text, revenue, ad_spend, sold_units "
                    "FROM marketplace_ad_monthly "
                    "WHERE marketplace_code = %s "
                    f"  AND month >= date_trunc('month', now()) "
                    f"      - interval '{months} months' ",
                    (code,),
                )
                base = {
                    r[0]: {
                        'revenue': float(r[1] or 0),
                        'adSpend': float(r[2] or 0),
                        'soldUnits': int(r[3] or 0),
                    }
                    for r in cur.fetchall()
                }

                # Средняя прибыль с одной вещи — из самой юнит-экономики,
                # чтобы не пересчитывать её здесь второй раз и не разойтись
                # с цифрой, которую владелец видит на экране товаров.
                avg_profit = 0.0
                try:
                    shared = {
                        'settings': _settings(cur),
                        'tariffs': _tariffs(cur),
                        'costs': _cost_by_group(cur),
                        'buyouts': _buyout_rates(cur),
                        'mpBuyouts': _buyout_from_marketplaces(cur),
                    }
                    ue = _build(cur, code, 'FBS', None, shared)
                    profits = [r['unit']['profit'] for r in (ue.get('rows') or [])
                               if r.get('unit')]
                    if profits:
                        avg_profit = sum(profits) / len(profits)
                except Exception:
                    # Прибыль — приятное дополнение к отчёту, но не он сам.
                    # Если расчёт не сложился, статьи расходов показать важнее.
                    avg_profit = 0.0

                out = []
                for m in sorted(set(by_month) | set(base), reverse=True):
                    items = by_month.get(m, [])
                    b = base.get(m, {})
                    fees_total = sum(i['amount'] for i in items)
                    units = b.get('soldUnits') or 0
                    revenue = b.get('revenue') or 0

                    by_cat = {}
                    for i in items:
                        by_cat[i['category']] = by_cat.get(i['category'], 0) + i['amount']

                    # ЧИСТАЯ ПРИБЫЛЬ МЕСЯЦА.
                    #
                    # Юнитка считает прибыль с одной вещи, но она не знает про
                    # удержания магазина: подписку, слоты, штрафы. Умножив её
                    # на количество проданного, владелец получал завышенную
                    # картину. Здесь вычитаем то, что юнитка не видит.
                    unit_profit = avg_profit or 0
                    gross = round(unit_profit * units, 2) if units else 0
                    net = round(gross - fees_total, 2)

                    out.append({
                        'month': m,
                        'revenue': revenue,
                        'adSpend': b.get('adSpend') or 0,
                        'soldUnits': units,
                        # Прибыль по юнитке: продано × прибыль с вещи.
                        'grossProfit': gross,
                        # Она же за вычетом удержаний магазина.
                        'netProfit': net,
                        'unitProfit': round(unit_profit, 2),
                        'feesTotal': round(fees_total, 2),
                        'feesPerUnit': round(fees_total / units, 2) if units else None,
                        'feesPercent': round(fees_total / revenue * 100, 2)
                        if revenue else None,
                        'byCategory': {k: round(v, 2) for k, v in by_cat.items()},
                        'items': items,
                    })

                return _resp(200, {'marketplace': code, 'months': out})

            if action == 'monthly':
                """Помесячная динамика по размерам: не упал ли спрос.

                Отвечает на вопрос, который по одной цифре за 30 дней увидеть
                нельзя: выручка по размеру просела — это спрос ушёл или мы
                просто перестали его рекламировать?

                Смотреть надо ПАРУ «выручка + ДРР»:
                  выручка вниз, ДРР вверх — размер теряет спрос, реклама его
                    больше не вытягивает: пора менять цену или выводить;
                  выручка вверх, ДРР вверх сильнее — рост куплен за рекламу
                    и съедает маржу.
                """
                code = params.get('marketplace') or 'ozon'
                mp_name = {'ozon': 'OZON', 'wildberries': 'WB',
                           'yandex_market': 'Yandex'}.get(code, 'OZON')
                months = int(params.get('months') or 6)

                # Выручка и штуки по каждому размеру за каждый месяц.
                # Цену берём из прайса площадки: в самом заказе её нет.
                cur.execute(
                    "SELECT date_trunc('month', o.created_at)::date AS m, "
                    "       o.width, count(*), sum(mp.price) "
                    "FROM orders o "
                    "JOIN marketplace_prices mp "
                    "  ON mp.marketplace_item_id = o.marketplace_item_id "
                    f" AND mp.marketplace_code = '{code}' "
                    f"WHERE o.marketplace = '{mp_name}' "
                    "  AND o.cancelled_at IS NULL "
                    "  AND o.width IS NOT NULL "
                    f" AND o.created_at >= date_trunc('month', now()) "
                    f"     - interval '{months} months' "
                    "GROUP BY 1, 2 ORDER BY 1, 2"
                )
                by_size = {}
                for m, width, cnt, rev in cur.fetchall():
                    key = str(width)
                    by_size.setdefault(key, {})[str(m)] = {
                        'count': int(cnt),
                        'revenue': round(float(rev or 0), 2),
                    }

                # ДРР по месяцам — общий по площадке. Разложить рекламу по
                # размерам физически не из чего: OZON списывает её общей суммой
                # без указания товара.
                cur.execute(
                    "SELECT month::text, ad_percent, ad_spend, revenue "
                    "FROM marketplace_ad_monthly "
                    "WHERE marketplace_code = %s "
                    f"  AND month >= date_trunc('month', now()) "
                    f"      - interval '{months} months' "
                    "ORDER BY month",
                    (code,),
                )
                ad_by_month = {
                    r[0]: {
                        'adPercent': float(r[1]) if r[1] is not None else None,
                        'adSpend': float(r[2] or 0),
                        'adRevenue': float(r[3] or 0),
                    }
                    for r in cur.fetchall()
                }

                # Список месяцев по порядку — им подписываем колонки таблицы.
                all_months = sorted({
                    m for sizes in by_size.values() for m in sizes
                } | set(ad_by_month))

                return _resp(200, {
                    'marketplace': code,
                    'months': all_months,
                    'adByMonth': ad_by_month,
                    'sizes': [
                        {'width': int(w), 'byMonth': data}
                        for w, data in sorted(by_size.items(), key=lambda x: int(x[0]))
                    ],
                })

            if action == 'compare':
                # Одна ткань и ширина на всех площадках и обеих схемах рядом —
                # видно, где продавать выгоднее и какая схема лучше.
                out = {}
                # Справочники общие для всех шести вариантов — читаем их один
                # раз, иначе база упирается в лимит и сравнение не открывается.
                shared = {
                    'settings': _settings(cur),
                    'tariffs': _tariffs(cur),
                    'costs': _cost_by_group(cur),
                    'buyouts': _buyout_rates(cur),
                    'mpBuyouts': _buyout_from_marketplaces(cur),
                }
                for code in MARKETPLACES:
                    for scheme in ('FBO', 'FBS'):
                        data = _build(cur, code, scheme, None, shared)
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
            data = _build(cur, code, scheme, buyout_override)

            # Вторая схема — для сравнения прямо на карточке товара.
            #
            # Логистика и комиссия у FBS и FBO разные, и по одной цифре нельзя
            # понять, где товар выгоднее. Считаем обе и отдаём вместе: владелец
            # видит разницу, не переключая страницу туда-обратно.
            if params.get('withCompare') == '1':
                other = 'FBO' if scheme == 'FBS' else 'FBS'
                try:
                    alt = _build(cur, code, other, buyout_override)
                    alt_by_key = {
                        (r['material'], r['width']): r.get('unit')
                        for r in (alt.get('rows') or [])
                    }
                    for r in (data.get('rows') or []):
                        r['altUnit'] = alt_by_key.get((r['material'], r['width']))
                    data['altScheme'] = other
                except Exception:
                    # Сравнение — дополнение, а не основа: если вторая схема
                    # не посчиталась, страница должна открыться без неё.
                    data['altScheme'] = None

            return _resp(200, data)

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')

        if action == 'save_tariffs':
            if not _can_edit(cur, actor_id):
                return _resp(403, {'error': 'Тарифы ведёт менеджер или администратор'})
            code = body_data.get('marketplaceCode')
            if code not in MARKETPLACES:
                return _resp(400, {'error': 'Неизвестный маркетплейс'})

            # ЛОГИСТИКУ И КОМИССИЮ РУКАМИ НЕ ПРАВИМ.
            #
            # Их присылает площадка, причём по каждому размеру отдельно: тюль
            # 200 см и штора 800 см едут за разные деньги. Вписанное вручную
            # число ломает расчёт молча — оно выглядит достоверно, но перестаёт
            # соответствовать тарифам площадки уже на следующий день.
            #
            # Поэтому такие поля просто не принимаем: сохраняем то, что задаёт
            # менеджер по своему усмотрению, а остальное оставляем как есть.
            editable = {
                'storage_per_month': body_data.get('storagePerMonth'),
                'acceptance_fee': body_data.get('acceptanceFee'),
                'promo_percent': body_data.get('promoPercent'),
                'storage_months': body_data.get('storageMonths'),
            }
            # Поля, которые площадка уже прислала, менеджер не трогает. Всё
            # прочее он может задать сам — площадка их не отдаёт.
            cur.execute(
                "SELECT synced_fields FROM marketplace_tariffs "
                "WHERE marketplace_code = %s",
                (code,),
            )
            row = cur.fetchone()
            auto = {f for f in ((row[0] if row else '') or '').split(',') if f}
            for key, param in (
                ('return_logistics', 'returnLogistics'),
                ('acquiring_percent', 'acquiringPercent'),
                ('commission_fbo_percent', 'commissionFboPercent'),
                ('commission_fbs_percent', 'commissionFbsPercent'),
            ):
                if key not in auto:
                    editable[key] = body_data.get(param)

            editable = {k: float(v or 0) for k, v in editable.items() if v is not None}
            if editable:
                sets = ', '.join(f"{k} = %s" for k in editable)
                cur.execute(
                    f"UPDATE marketplace_tariffs SET {sets}, updated_at = now(), "
                    "updated_by = %s WHERE marketplace_code = %s",
                    (*editable.values(), int(actor_id) if actor_id else None, code),
                )
            conn.commit()
            return _resp(200, {'success': True})

        if action == 'save_settings':
            # Ставки налогов компании — деньги владельца.
            if not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Ставки налогов меняет администратор'})
            # Постоянные расходы больше не принимаем: они ведутся статьями в
            # себестоимости. Если старая версия страницы их пришлёт — игнорируем.
            cur.execute(
                "UPDATE unit_economics_settings SET tax_percent = %s, "
                "vat_percent = %s, updated_at = now(), updated_by = %s "
                "WHERE id = (SELECT id FROM unit_economics_settings ORDER BY id LIMIT 1)",
                (
                    float(body_data.get('taxPercent') or 0),
                    float(body_data.get('vatPercent') or 0),
                    int(actor_id) if actor_id else None,
                ),
            )
            conn.commit()
            return _resp(200, {'success': True})

        if action == 'auto_sync_prices':
            # АВТОМАТИЧЕСКАЯ ЗАГРУЗКА ЦЕН, ЛОГИСТИКИ И КОМИССИЙ СО ВСЕХ ПЛОЩАДОК.
            #
            # Ручная кнопка тянет одну страницу за нажатие: у функции 5 секунд, а
            # карточек почти тысяча. Человеку приходилось сидеть и ждать прогресс —
            # и на практике цены обновляли раз в несколько месяцев, поэтому вся
            # юнит-экономика считалась по устаревшим тарифам.
            #
            # Здесь тот же обход, но его дёргает планировщик: за вызов проходим
            # столько страниц, сколько успеваем, и запоминаем курсор в настройках.
            # Следующий запуск продолжает с того же места — так за несколько
            # заходов обновляется весь каталог без участия человека.
            marketplaces = body_data.get('marketplaces') or list(MARKETPLACES)
            # Сколько страниц берём за один запуск. По умолчанию 3 — укладываемся
            # в таймаут даже на медленном ответе площадки.
            max_pages = int(body_data.get('maxPages') or 3)

            report = {}
            for code in marketplaces:
                if code not in MARKETPLACES:
                    continue
                # Курсор незавершённого обхода лежит в настройках: планировщик
                # продолжает с той страницы, на которой остановился прошлый запуск.
                cur.execute(
                    "SELECT value FROM system_settings WHERE key = %s",
                    (f'ue_sync_cursor_{code}',),
                )
                cur_row = cur.fetchone()
                cursor = (cur_row[0] or '') if cur_row else ''

                fetched = 0
                saved = 0
                tariffs = {}
                pages = 0
                done = False
                error = None
                for _ in range(max_pages):
                    if code == 'ozon':
                        res = _sync_ozon(cur, cursor)
                    elif code == 'wildberries':
                        res = _sync_wb(cur, cursor)
                    else:
                        res = _sync_yandex(cur, cursor)
                    if not res.get('ok'):
                        error = res.get('error')
                        break
                    fetched += int(res.get('fetched') or 0)
                    saved += int(res.get('saved') or 0)
                    pages += 1
                    cursor = res.get('cursor') or ''
                    # Тарифы приходят только на последней странице каталога —
                    # запоминаем их, иначе в отчёте не видно, обновились они
                    # или площадка промолчала.
                    if res.get('tariffs'):
                        tariffs = res['tariffs']
                    if res.get('done'):
                        done = True
                        cursor = ''
                        break

                # Запоминаем, где остановились. Каталог пройден целиком — курсор
                # чистим, следующий запуск начнёт заново с актуальными ценами.
                cur.execute(
                    "INSERT INTO system_settings (key, value) VALUES (%s, %s) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
                    (f'ue_sync_cursor_{code}', cursor),
                )
                report[code] = {
                    'fetched': fetched, 'saved': saved, 'pages': pages,
                    'done': done, 'error': error, 'tariffs': tariffs,
                }

            total_saved = sum(v['saved'] for v in report.values())
            parts = []
            for code, v in report.items():
                if v['error']:
                    parts.append(f"{code}: ошибка — {v['error'][:60]}")
                else:
                    parts.append(
                        f"{code}: {v['saved']} цен"
                        + (f", тарифов {len(v['tariffs'])}" if v.get('tariffs') else '')
                        + (' (каталог пройден)' if v['done'] else ' (продолжение)')
                    )
            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, entity_type, description) "
                "VALUES ('integration', NULL, 'Планировщик', 'ue_sync_prices', 'unit_economics', %s)",
                (f'Обновление цен и логистики: {"; ".join(parts)}',),
            )
            conn.commit()
            return _resp(200, {'ok': True, 'saved': total_saved, 'report': report})

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