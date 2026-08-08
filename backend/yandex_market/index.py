import base64
import json
import os
import urllib.request
import urllib.error

import psycopg2

# Яндекс Маркет Partner API. Работает ТОЛЬКО НА ЧТЕНИЕ: тянет новые заказы FBS и их
# статусы, но не двигает заказы на стороне Яндекса (не собирает и не отгружает).
YM_API_BASE = 'https://api.partner.market.yandex.ru'

# Заказ попадает на конвейер, когда Яндекс ждёт от нас сборку.
YM_NEW_STATUS = 'PROCESSING'

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False),
    }


def get_ym_credentials(cur):
    """Возвращает (api_key, campaign_id, is_enabled) для Яндекс Маркета."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'yandex_market'"
    )
    row = cur.fetchone()
    if not row:
        return None, None, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('apiKey') or '').strip(), (creds.get('campaignId') or '').strip(), bool(row[0])


def ym_get(path, api_key):
    """GET к Partner API. Возвращает (status_code, parsed_json_or_text)."""
    req = urllib.request.Request(YM_API_BASE + path, method='GET')
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            data = r.read().decode('utf-8')
            return r.status, (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw[:500]}
    except Exception as e:
        return 0, {'raw': str(e)[:500]}


def ym_post(path, api_key, payload=None):
    """POST к Partner API. Каталог товаров отдаётся только этим методом."""
    body = json.dumps(payload or {}).encode('utf-8')
    req = urllib.request.Request(YM_API_BASE + path, data=body, method='POST')
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            data = r.read().decode('utf-8')
            return r.status, (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw[:500]}
    except Exception as e:
        return 0, {'raw': str(e)[:500]}


def find_marketplace_item(cur, offer_id, shop_sku, barcodes=None):
    """Ищет товар справочника по кодам из заказа Яндекса.

    Раньше искали только по артикулу продавца (sku) — если в Яндексе артикул отличался
    хоть одним символом, вещь не попадала на конвейер и заказ терялся. Теперь пробуем
    по очереди все известные коды: артикул, затем штрихкод из карточки Яндекса. По
    штрихкоду товар находится, даже если артикулы в системах разошлись.
    """
    # Сначала — артикул, заполненный специально для Яндекса: он главнее общего,
    # потому что в кабинете Яндекса артикул может отличаться от внутреннего.
    for code in (offer_id, shop_sku):
        if not code or not str(code).strip():
            continue
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items "
            "WHERE ym_sku = %s AND ym_sku <> '' LIMIT 1",
            (str(code).strip(),),
        )
        row = cur.fetchone()
        if row:
            return row

    for code in (offer_id, shop_sku):
        if not code or not str(code).strip():
            continue
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items "
            "WHERE sku = %s AND sku <> '' LIMIT 1",
            (str(code).strip(),),
        )
        row = cur.fetchone()
        if row:
            return row

    for code in (barcodes or []):
        if not code or not str(code).strip():
            continue
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items "
            "WHERE barcode = %s AND barcode <> '' LIMIT 1",
            (str(code).strip(),),
        )
        row = cur.fetchone()
        if row:
            return row
    return None


def match_from_stock(cur, order_id, item_id) -> bool:
    """Пробует закрыть заказ вещью, уже лежащей на полке (FIFO), — шить заново не нужно."""
    if not item_id:
        return False
    cur.execute(
        "SELECT gw.id FROM goods_warehouse gw "
        "JOIN orders src ON src.id = gw.order_id "
        "WHERE gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
        "AND src.marketplace_item_id = %s "
        "ORDER BY gw.received_at ASC LIMIT 1",
        (int(item_id),),
    )
    row = cur.fetchone()
    if not row:
        return False
    cur.execute(
        "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() WHERE id = %s",
        (int(order_id), row[0]),
    )
    cur.execute(
        "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' WHERE id = %s",
        (row[0], int(order_id)),
    )
    return True


def log_action(cur, actor_id, actor_name, action, description):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'integration',
            action,
            'order',
            None,
            description,
        ),
    )


def sync_orders(cur, api_key, campaign_id, actor_id, actor_name):
    """Тянет новые заказы Яндекс Маркета и ставит их на конвейер.

    Ключевое отличие от OZON и WB: у Яндекса покупатель заказывает несколько вещей ОДНИМ
    заказом, и ярлык-стикер на такой заказ выдаётся ОДИН на всё отправление. Разорвать его
    между разными закройщиками и швеями нельзя — вещи разъедутся по цеху, а к отгрузке их
    надо собрать вместе под один ярлык.

    Поэтому все вещи одного заказа получают общий group_key: в цеху они идут одной пачкой,
    закройщик берёт заказ целиком, и шьёт его одна швея.
    """
    status_code, data = ym_get(
        f'/campaigns/{campaign_id}/orders?status={YM_NEW_STATUS}&pageSize=50', api_key
    )
    if status_code != 200 or 'orders' not in data:
        return {'error': 'Яндекс Маркет вернул ошибку', 'status': status_code, 'details': data}

    created = 0
    matched = 0
    skipped_existing = 0
    skipped_no_item = 0
    unmatched = []
    created_orders = []

    for o in data.get('orders', []) or []:
        ym_id = o.get('id')
        if not ym_id:
            continue
        group_key = f'YM-{ym_id}'
        mp_created_at = o.get('creationDate') or None

        # Сначала разворачиваем позиции в плоский список вещей: товар с count=3 — это три
        # отдельные вещи на конвейере, но все они из одного заказа покупателя.
        units = []
        for it in o.get('items', []) or []:
            offer_id = it.get('offerId')
            shop_sku = it.get('shopSku')
            # Штрихкоды из карточки Яндекса — запасной способ найти товар, если артикулы
            # в системах разошлись. Яндекс отдаёт их списком в barcodes.
            barcodes = it.get('barcodes') or []
            item = find_marketplace_item(cur, offer_id, shop_sku, barcodes)
            if not item:
                skipped_no_item += 1
                unmatched.append({
                    'orderId': ym_id,
                    'offerId': offer_id,
                    'shopSku': shop_sku,
                    'barcodes': barcodes,
                    # Название из заказа — по нему видно, что за товар не нашёлся.
                    'name': it.get('offerName') or '',
                })
                continue
            for _ in range(int(it.get('count') or 1)):
                units.append(item)

        if not units:
            continue

        group_size = len(units)
        made_any = False
        for pos, (material, width, height, item_name, item_id) in enumerate(units, start=1):
            product = f'{material} {width}x{height}' if material and width and height else item_name
            # Номер вида "YM-12345-2" — вторая вещь заказа 12345. Повторная загрузка дублей
            # не создаст (ON CONFLICT), а по group_key вещи всегда собираются обратно.
            unique_number = f'{group_key}-{pos}'
            cur.execute(
                "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
                "quantity, source, material, width, height, ym_order_id, ym_status, "
                "marketplace_created_at, marketplace_item_id, group_key, group_size, group_position) "
                "VALUES (%s, 'Yandex', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                (
                    unique_number,
                    product,
                    material,
                    int(width) if width else None,
                    int(height) if height else None,
                    int(ym_id),
                    o.get('status'),
                    mp_created_at,
                    int(item_id) if item_id else None,
                    group_key,
                    group_size,
                    pos,
                ),
            )
            inserted = cur.fetchone()
            if not inserted:
                skipped_existing += 1
                continue
            if match_from_stock(cur, inserted[0], item_id):
                matched += 1
            made_any = True
            created += 1
        if made_any:
            created_orders.append(group_key)

    if created:
        log_action(
            cur, actor_id, actor_name, 'ym_sync',
            f'Загружено с Яндекс Маркета: {created} вещей в {len(created_orders)} заказах',
        )
    return {
        'created': created,
        'matchedFromStock': matched,
        'skippedExisting': skipped_existing,
        'skippedNoItem': skipped_no_item,
        'unmatched': unmatched[:20],
        'orders': created_orders,
    }



def ym_get_raw(path, api_key):
    """GET к Partner API, возвращающий БИНАРНЫЙ ответ (PDF ярлыка). Отдаём (код, bytes)."""
    req = urllib.request.Request(YM_API_BASE + path, method='GET')
    req.add_header('Api-Key', api_key)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode()


def get_order_label(cur, api_key, campaign_id, order_number):
    """Ярлык-наклейка Яндекса на вещь заказа FBS.

    Яндекс печатает ярлык на КАЖДОЕ грузоместо (пакет), а не один на весь заказ: на ярлыке
    указано «1 из 3». Формат A9 — это как раз 58×40 мм, наш размер термонаклейки, поэтому
    просим у API сразу его и печатаем как есть, без пересборки.

    Возвращает (ошибка, base64_pdf).
    """
    cur.execute(
        "SELECT ym_order_id, group_position, group_size FROM orders WHERE order_number = %s",
        (order_number,),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return 'Это не заказ Яндекс Маркета', None
    ym_id, position, size = row

    status, data = ym_get_raw(
        f'/campaigns/{campaign_id}/orders/{ym_id}/delivery/labels?format=A9', api_key
    )
    if status != 200:
        text = data.decode('utf-8', 'replace')[:300] if data else ''
        return f'Яндекс не отдал ярлык (код {status}): {text}', None
    return None, base64.b64encode(data).decode()


def handler(event: dict, context) -> dict:
    """Интеграция с Яндекс Маркетом: загрузка заказов FBS на конвейер производства.

    Заказ Яндекса может содержать несколько вещей, и ярлык на них один общий — поэтому все
    вещи одного заказа связываются общим ключом группы и идут по цеху вместе: их берёт один
    закройщик и шьёт одна швея, чтобы к отгрузке заказ собрался целиком.

    GET  /?action=campaigns       - какие кампании доступны ключу (проверка настроек)
    GET  /?action=check&status=   - проверка ключа: сколько заказов ждёт сборки
    POST /  { action: 'sync' }    - загрузить новые заказы на конвейер
    POST /  { action: 'label', orderNumber }
        - ярлык-наклейка Яндекса на вещь заказа (формат A9 = 58×40 мм) в base64 PDF.
          Яндекс печатает ярлык на КАЖДОЕ грузоместо, на нём указано «1 из 3»

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с результатом синхронизации
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    body_data = {}
    if method == 'POST':
        try:
            body_data = json.loads(event.get('body') or '{}')
        except Exception:
            return _resp(400, {'error': 'Некорректный JSON'})

    params = event.get('queryStringParameters') or {}
    action = body_data.get('action') or params.get('action') or 'check'
    actor_id = body_data.get('actorId') or params.get('actorId')
    actor_name = body_data.get('actorName') or params.get('actorName')

    # Ночной планировщик тянет заказы сам, без открытой CRM. Ключ сверяем только если он
    # пришёл: из интерфейса вызов идёт как раньше, без ключа.
    # Ключ берём и из адреса — планировщик умеет дёргать только простую ссылку.
    cron_key = body_data.get('cronSecret') or params.get('cronSecret')
    if cron_key:
        cron_secret = os.environ.get('CRON_SECRET', '')
        if not cron_secret or cron_key != cron_secret:
            return _resp(403, {'error': 'Неверный ключ планировщика'})
        # В журнале должно быть видно, что заказы подтянул планировщик, а не сотрудник.
        actor_id, actor_name = None, 'Планировщик'

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        api_key, campaign_id, is_enabled = get_ym_credentials(cur)
        if not api_key or not campaign_id:
            return _resp(400, {'error': 'Не заполнены API-ключ и номер кампании Яндекс Маркета'})
        if not is_enabled:
            return _resp(400, {'error': 'Интеграция с Яндекс Маркетом выключена'})

        if action == 'campaigns':
            # Список кампаний, доступных ключу — чтобы убедиться, что campaignId указан верно.
            st, data = ym_get('/campaigns', api_key)
            return _resp(200, {
                'status': st,
                'configuredCampaignId': campaign_id,
                'campaigns': [
                    {
                        'id': c.get('id'),
                        'domain': c.get('domain'),
                        'businessId': (c.get('business') or {}).get('id'),
                        'placementType': c.get('placementType'),
                    }
                    for c in (data.get('campaigns') or [])
                ] if isinstance(data, dict) else data,
            })

        if action == 'match_items':
            # Проставляет товарам артикул Яндекса: тянет каталог кабинета и сопоставляет
            # его с нашим справочником по штрихкоду, а затем по общему артикулу.
            # Штрихкод надёжнее — он одинаков во всех системах, а артикулы расходятся.
            # businessId экран передаёт со второго вызова — экономим запрос к Яндексу,
            # иначе на каждую страницу каталога уходило бы два обращения вместо одного.
            business_id = (body_data.get('businessId') or '').strip()
            if not business_id:
                st, camp = ym_get(f'/campaigns/{campaign_id}', api_key)
                business_id = (((camp or {}).get('campaign') or {}).get('business') or {}).get('id')
                if not business_id:
                    return _resp(200, {'ok': False, 'error': 'Не удалось определить кабинет',
                                       'status': st, 'details': camp})

            # Каталог большой, за один вызов целиком не проходит — берём по одной странице
            # и возвращаем метку следующей. Экран вызывает действие повторно, пока метка
            # не опустеет: так укладываемся в лимит времени на вызов.
            page_token = (body_data.get('pageToken') or '').strip() or None
            path = f'/businesses/{business_id}/offer-mappings?limit=50'
            if page_token:
                path += f'&page_token={page_token}'
            st, data = ym_post(path, api_key, {})
            if st != 200:
                return _resp(200, {'ok': False, 'error': 'Каталог недоступен',
                                   'status': st, 'details': data})
            result = (data or {}).get('result') or {}
            offers = result.get('offerMappings') or []
            next_token = (result.get('paging') or {}).get('nextPageToken')

            # Справочник маленький (сотни строк) — читаем его целиком одним запросом
            # и сопоставляем в памяти. Так на страницу каталога уходит один поход в базу
            # вместо сотни, иначе функция не укладывается в отведённое время.
            cur.execute(
                "SELECT id, sku, barcode, COALESCE(ym_sku, '') FROM marketplace_items"
            )
            by_barcode, by_sku = {}, {}
            for r in cur.fetchall():
                if r[2]:
                    by_barcode.setdefault(str(r[2]).strip(), r)
                if r[1]:
                    by_sku.setdefault(str(r[1]).strip(), r)

            updated, already, not_found, to_update = 0, 0, [], []
            for om in offers:
                offer = om.get('offer') or {}
                ym_code = (offer.get('offerId') or '').strip()
                if not ym_code:
                    continue

                row = None
                for b in (offer.get('barcodes') or []):
                    row = by_barcode.get(str(b).strip())
                    if row:
                        break
                if not row:
                    row = by_sku.get(ym_code)

                if not row:
                    not_found.append({'offerId': ym_code, 'name': offer.get('name') or ''})
                    continue
                if row[3] == ym_code:
                    already += 1
                    continue
                to_update.append((ym_code, row[0]))

            for ym_code, item_id in to_update:
                cur.execute(
                    "UPDATE marketplace_items SET ym_sku = %s, updated_at = now() WHERE id = %s",
                    (ym_code, item_id),
                )
                updated += 1

            conn.commit()
            return _resp(200, {
                'ok': True,
                'offersInYandex': len(offers),
                'updated': updated,
                'alreadySet': already,
                'notFound': len(not_found),
                'notFoundSample': not_found[:20],
                # Пока метка не пуста — есть ещё страницы каталога.
                'nextPageToken': next_token or '',
                'businessId': str(business_id),
                'done': not next_token,
            })

        if action == 'check':
            # По умолчанию смотрим заказы в работе, но можно указать любой статус
            # (?status=DELIVERED) — например чтобы разобрать состав прошлых заказов.
            want = (params.get('status') or YM_NEW_STATUS).strip()
            q = f'/campaigns/{campaign_id}/orders?pageSize=50'
            if want.upper() != 'ANY':
                q += f'&status={want}'
            status_code, data = ym_get(q, api_key)
            if status_code != 200:
                return _resp(200, {'ok': False, 'status': status_code, 'details': data})
            orders = data.get('orders', []) or []
            multi = sum(
                1 for o in orders if sum(int(i.get('count') or 1) for i in (o.get('items') or [])) > 1
            )
            return _resp(200, {
                'ok': True,
                'ordersAwaiting': len(orders),
                'multiItemOrders': multi,
                'sample': [
                    {
                        'id': o.get('id'),
                        'status': o.get('status'),
                        'itemsTotal': sum(int(i.get('count') or 1) for i in (o.get('items') or [])),
                        'positions': len(o.get('items') or []),
                        'offers': [i.get('offerId') for i in (o.get('items') or [])][:5],
                    }
                    for o in orders[:10]
                ],
            })

        if action == 'label':
            # Ярлык на вещь заказа — печатается на терминале упаковщика и клеится на пакет.
            order_number = (body_data.get('orderNumber') or params.get('orderNumber') or '').strip()
            if not order_number:
                return _resp(400, {'error': 'Укажите номер заказа'})
            err, pdf_b64 = get_order_label(cur, api_key, campaign_id, order_number)
            if err:
                return _resp(502, {'error': err})
            return _resp(200, {'orderNumber': order_number, 'pdfBase64': pdf_b64})

        if action == 'sync':
            result = sync_orders(cur, api_key, campaign_id, actor_id, actor_name)
            if 'error' in result:
                conn.rollback()
                return _resp(502, result)
            conn.commit()
            return _resp(200, result)

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()