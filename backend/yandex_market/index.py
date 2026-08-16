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


def match_group_from_stock(cur, group_key) -> int:
    """Закрывает связку Яндекса вещами со склада — ТОЛЬКО ЦЕЛИКОМ.

    У Яндекса на весь заказ покупателя один ярлык, и вещи едут вместе. Закрыть часть
    заказа со склада нельзя: половина уехала бы готовой, половина ушла бы в пошив, а
    ярлык на них общий — к отгрузке заказ не собрать.

    Раньше подбор шёл поштучно, сразу при создании каждой вещи: первая вещь заказа
    находила себе пару на полке и уходила в «Со склада», а на вторую готовой не
    хватало, и она уезжала в цех. Связка разрывалась в момент загрузки заказа — ровно
    та беда, от которой на складе стоит отдельная защита.

    Теперь смотрим на заказ целиком: если на складе лежат вещи под ВСЕ позиции связки —
    закрываем её со склада; не хватает хоть одной — не трогаем склад вовсе, заказ
    целиком уходит в пошив, а вещи остаются свободны для других заказов.

    Возвращает число закрытых со склада вещей (0, если связку закрыть не удалось).
    """
    cur.execute(
        "SELECT id, marketplace_item_id FROM orders "
        "WHERE group_key = %s AND fulfilled_from_stock_id IS NULL "
        "  AND sewing_status = 'Новый' AND COALESCE(status, '') <> 'Отменён' "
        "ORDER BY group_position, id",
        (group_key,),
    )
    units = cur.fetchall()
    if not units:
        return 0

    # Сначала ПОДБИРАЕМ вещи под все позиции, ничего не занимая. Одна и та же вещь не
    # должна закрыть две позиции, поэтому уже выбранные исключаем из следующего поиска.
    picked = []
    taken = set()
    for order_id, item_id in units:
        if not item_id:
            return 0
        exclude = ''
        if taken:
            exclude = ' AND gw.id NOT IN (' + ','.join(str(int(t)) for t in taken) + ')'
        cur.execute(
            "SELECT gw.id FROM goods_warehouse gw "
            "JOIN orders src ON src.id = gw.order_id "
            "WHERE gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
            "AND src.marketplace_item_id = %s" + exclude + " "
            "ORDER BY gw.received_at ASC LIMIT 1",
            (int(item_id),),
        )
        row = cur.fetchone()
        if not row:
            # Хоть на одну позицию готовой вещи нет — связку со склада не закрываем.
            return 0
        picked.append((order_id, row[0]))
        taken.add(row[0])

    # Вещи нашлись на ВСЕ позиции — только теперь занимаем их.
    for order_id, gw_id in picked:
        cur.execute(
            "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() "
            "WHERE id = %s",
            (int(order_id), int(gw_id)),
        )
        cur.execute(
            "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' "
            "WHERE id = %s",
            (int(gw_id), int(order_id)),
        )
    return len(picked)


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
    # ЗАБИРАЕМ ВСЕ СТРАНИЦЫ, А НЕ ПЕРВЫЕ 50.
    #
    # Яндекс отдаёт заказы порциями и кладёт ссылку на следующую порцию в paging.
    # Раньше запрашивалась ровно одна страница: пока заказов было мало, всё сходилось,
    # но в первый же день распродажи 51-й и дальше заказы просто не попадали на
    # конвейер — их никто не шил, а на маркетплейсе капала просрочка. Ровно на этом
    # мы обожглись с OZON, там пришлось доделывать постраничную загрузку задним числом.
    #
    # Идём по страницам, пока Яндекс отдаёт токен следующей. Ограничитель в 40 страниц
    # (до 2000 заказов) — страховка от бесконечного цикла, если API вернёт тот же токен.
    all_orders = []
    page_token = None
    for _ in range(40):
        q = f'/campaigns/{campaign_id}/orders?status={YM_NEW_STATUS}&pageSize=50'
        if page_token:
            q += f'&page_token={page_token}'
        status_code, data = ym_get(q, api_key)
        if status_code != 200 or 'orders' not in data:
            # Первая страница не пришла — это ошибка настройки или связи, сообщаем.
            # Оборвалась середина — работаем с тем, что успели забрать: лучше поставить
            # в цех часть заказов, чем не поставить ни одного.
            if not all_orders:
                return {
                    'error': 'Яндекс Маркет вернул ошибку',
                    'status': status_code,
                    'details': data,
                }
            break
        all_orders.extend(data.get('orders', []) or [])
        next_token = (data.get('paging') or {}).get('nextPageToken')
        if not next_token or next_token == page_token:
            break
        page_token = next_token

    created = 0
    matched = 0
    skipped_existing = 0
    skipped_no_item = 0
    unmatched = []
    created_orders = []

    for o in all_orders:
        ym_id = o.get('id')
        if not ym_id:
            continue
        group_key = f'YM-{ym_id}'
        mp_created_at = o.get('creationDate') or None

        # Сначала разворачиваем позиции в плоский список вещей: товар с count=3 — это три
        # отдельные вещи на конвейере, но все они из одного заказа покупателя.
        units = []
        has_unknown = False
        for it in o.get('items', []) or []:
            offer_id = it.get('offerId')
            shop_sku = it.get('shopSku')
            # Штрихкоды из карточки Яндекса — запасной способ найти товар, если артикулы
            # в системах разошлись. Яндекс отдаёт их списком в barcodes.
            barcodes = it.get('barcodes') or []
            item = find_marketplace_item(cur, offer_id, shop_sku, barcodes)
            if not item:
                has_unknown = True
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

        # ЗАКАЗ ЗАВОДИМ ТОЛЬКО ЦЕЛИКОМ.
        #
        # Если хоть одна позиция не опознана (товара нет в справочнике), заказ не
        # ставим на конвейер вовсе. Иначе получалось так: в заказе три вещи, одна не
        # опозналась — заводились две, связка считала себя полной из двух, цех шил две,
        # и поставка уезжала недоукомплектованной. А ярлык у Яндекса один на весь заказ:
        # покупателю приходила неполная посылка, маркетплейс засчитывал недовоз.
        #
        # Такой заказ попадает в список «не опознано» — менеджер заводит товар в
        # справочник, и следующая синхронизация ставит заказ в цех целиком и правильно.
        if has_unknown or not units:
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
            made_any = True
            created += 1

        # Подбор со склада — ПОСЛЕ того, как заведена вся связка, и только целиком.
        #
        # Раньше подбор стоял внутри цикла: первая вещь заказа сразу забирала себе
        # готовую с полки, а на вторую готовой не хватало — и она уходила в пошив.
        # Заказ разрывался пополам, хотя ярлык на него один и вещи обязаны ехать
        # вместе. Теперь решение принимается по заказу целиком.
        if made_any:
            created_orders.append(group_key)
            matched += match_group_from_stock(cur, group_key)

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

    # Действия, которые МЕНЯЮТ данные, по обычной ссылке недоступны.
    #
    # Раньше загрузку заказов можно было запустить простым переходом по адресу
    # функции — без ключа и без входа в систему. Любой, кто увидел ссылку (а её
    # знает браузер, история, закладки), дёргал за нас API маркетплейса и заводил
    # заказы в производство. Из интерфейса вызовы идут методом POST, планировщик
    # ходит по ссылке с ключом — обоим ничего не мешает.
    if method == 'GET' and action not in ('check', 'campaigns') and not cron_key:
        return _resp(403, {'error': 'Действие требует ключ планировщика'})

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

        if action == 'check_statuses':
            # Ловим отмены покупателей ДО того, как вещь дойдёт до стикеровки.
            #
            # Без этой проверки отмена всплывала только в момент печати ярлыка:
            # упаковщица доводила заказ до конца и упиралась в отказ Яндекса.
            #
            # Правило то же, что на OZON и WB:
            #   * заказ ещё «Новый» — снимаем с конвейера, шить отменённое незачем;
            #   * заказ уже в работе — доводим до конца, но вещь уедет не покупателю,
            #     а на склад: упаковщица наклеит стикер ХРАНЕНИЯ вместо ярлыка.
            #
            # Особенность Яндекса — СВЯЗКИ. У заказа из нескольких вещей один ярлык на
            # всех, поэтому отмена связки касается её целиком: если хоть одна вещь уже
            # в работе, вся связка доходит до конца и целиком уходит на хранение.
            # Иначе половина уехала бы, половина осталась — с одним ярлыком на двоих.
            cur.execute(
                "SELECT id, ym_order_id, order_number, sewing_status, group_key "
                "FROM orders WHERE marketplace = 'Yandex' AND ym_order_id IS NOT NULL "
                "  AND COALESCE(status, '') NOT IN ('Отменён', 'Отгружен') "
                "  AND sewing_status IN ('Новый', 'На раскрое', 'Раскроено', 'В работе', "
                "                        'Стикеровка', 'Готовые', 'Со склада')"
            )
            rows = cur.fetchall()
            if not rows:
                return _resp(200, {'checked': 0, 'cancelled': 0, 'removedFromLine': 0})

            # СПРАШИВАЕМ ЯНДЕКС ОДНИМ СПИСКОМ, А НЕ ПО ЗАКАЗУ ЗА РАЗ.
            #
            # Раньше на каждый заказ уходил отдельный запрос к API. При сотне заказов
            # в работе это сотня обращений подряд: функция упиралась в таймаут и
            # обрывалась, отмены не долавливались вовсе — а узнавали мы о них только
            # когда упаковщица не могла напечатать ярлык.
            #
            # Забираем отменённые одним списком (постранично) и сверяем с нашими.
            ym_ids = {int(r[1]) for r in rows}
            cancelled_ym = set()
            page_token = None
            for _ in range(40):
                q = f'/campaigns/{campaign_id}/orders?status=CANCELLED&pageSize=50'
                if page_token:
                    q += f'&page_token={page_token}'
                st_code, st_data = ym_get(q, api_key)
                if st_code != 200 or not isinstance(st_data, dict):
                    break
                for co in (st_data.get('orders') or []):
                    cid = co.get('id')
                    if cid and int(cid) in ym_ids:
                        cancelled_ym.add(int(cid))
                next_token = (st_data.get('paging') or {}).get('nextPageToken')
                if not next_token or next_token == page_token:
                    break
                page_token = next_token

            # Связки, где хоть одна вещь уже в работе: такие с конвейера не снимаем.
            groups_in_work = set()
            for _oid, ym_id, _num, sew, gkey in rows:
                if int(ym_id) in cancelled_ym and gkey and sew != 'Новый':
                    groups_in_work.add(gkey)

            cancelled_count = 0
            removed = 0
            for order_id, ym_id, _num, sew, gkey in rows:
                if int(ym_id) not in cancelled_ym:
                    continue
                cancelled_count += 1
                # Снимаем с конвейера, только если работа не начиналась НИ ПО ОДНОЙ
                # вещи связки. Одиночный заказ — просто по своему статусу.
                can_drop = sew == 'Новый' and (not gkey or gkey not in groups_in_work)
                if can_drop:
                    cur.execute(
                        "UPDATE orders SET status = 'Отменён', sewing_status = 'Отменён', "
                        "  cancelled_at = COALESCE(cancelled_at, now()), assigned_user_id = NULL "
                        "WHERE id = %s",
                        (order_id,),
                    )
                    removed += 1
                else:
                    cur.execute(
                        "UPDATE orders SET status = 'Отменён', "
                        "  cancelled_at = COALESCE(cancelled_at, now()) WHERE id = %s",
                        (order_id,),
                    )
            conn.commit()
            return _resp(200, {
                'checked': len(rows),
                'cancelled': cancelled_count,
                'removedFromLine': removed,
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