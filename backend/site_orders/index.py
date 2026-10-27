import base64
import json
import os
import urllib.error
import urllib.request
from datetime import datetime

import psycopg2

SHOP_CODE = 'megatul_site'
DEFAULT_SITE_URL = 'https://xn--80aff0ab3b6do.xn--p1ai'

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def site_settings(cur):
    """Магазин мегатюль.рф и его ключ доступа из «Интеграций»."""
    cur.execute("SELECT id FROM shops WHERE code = %s", (SHOP_CODE,))
    row = cur.fetchone()
    if not row:
        return None, None, None, False
    shop_id = row[0]
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'internet_shop' AND shop_id = %s LIMIT 1",
        (shop_id,),
    )
    r = cur.fetchone()
    creds = {}
    enabled = False
    if r:
        enabled = bool(r[0])
        creds = r[1] if isinstance(r[1], dict) else json.loads(r[1] or '{}')
    site_url = (creds.get('siteUrl') or DEFAULT_SITE_URL).strip().rstrip('/')
    api_key = (creds.get('apiKey') or '').strip()
    return shop_id, site_url, api_key, enabled


def site_get(url, api_key):
    req = urllib.request.Request(
        url,
        headers={'Accept': 'application/json', 'X-Api-Key': api_key,
                 'Authorization': f'Bearer {api_key}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8') or '{}')
        except Exception:
            return e.code, {}


def find_item(cur, shop_id, sku, barcode, name):
    """Товар справочника магазина по артикулу, штрихкоду или точному названию."""
    for field, value in (('sku', sku), ('barcode', barcode), ('name', name)):
        if not value or not str(value).strip():
            continue
        cur.execute(
            f"SELECT material, width, height, name, id FROM marketplace_items "
            f"WHERE {field} = %s AND {field} <> '' AND shop_id = %s LIMIT 1",
            (str(value).strip(), int(shop_id)),
        )
        row = cur.fetchone()
        if row:
            return row
    return None


def parse_date(raw):
    if not raw:
        return None
    text = str(raw).strip().replace('Z', '')
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.strptime(text[:26], fmt)
        except ValueError:
            continue
    return None


def log_action(cur, actor_id, actor_name, action, description):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, 'integration', %s, 'order', NULL, %s)",
        (int(actor_id) if str(actor_id or '').isdigit() else None, actor_name or None, action, description),
    )


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def sync_orders(cur, shop_id, site_url, api_key, actor_id, actor_name):
    """Забирает оплаченные заказы сайта и ставит их на конвейер.

    Все вещи одного заказа клиента получают общий ключ связки SITE-<номер>:
    закройщица забирает связку целиком, и шьёт её одна швея — так же, как
    заказы Яндекса из нескольких вещей.
    """
    status, data = site_get(f'{site_url}/api/crm/orders?status=paid', api_key)
    if status == 401 or status == 403:
        return {'error': 'Магазин не принял ключ доступа. Проверьте ключ в «Интеграциях».'}
    if status == 404:
        return {'error': 'На сайте ещё не включена выдача заказов для CRM (/api/crm/orders).'}
    if status != 200:
        return {'error': f'Сайт ответил ошибкой {status}'}

    site_orders = data.get('orders') if isinstance(data, dict) else data
    site_orders = site_orders or []

    created = 0
    skipped_existing = 0
    unmatched = []
    created_orders = []

    for so in site_orders:
        sid = str(so.get('id') or so.get('number') or '').strip()
        if not sid:
            continue
        number = str(so.get('number') or sid).strip()
        group_key = f'SITE-{number}'

        cur.execute("SELECT 1 FROM orders WHERE site_order_id = %s LIMIT 1", (sid,))
        if cur.fetchone():
            skipped_existing += 1
            continue

        delivery = so.get('delivery') or {}
        tracking = (delivery.get('trackingNumber') or so.get('trackingNumber') or '').strip() or None
        label_url = (delivery.get('labelUrl') or so.get('labelUrl') or '').strip() or None
        customer = so.get('customer') or {}
        created_at = parse_date(so.get('createdAt') or so.get('paidAt'))

        units = []
        has_unknown = False
        for it in so.get('items') or []:
            item = find_item(cur, shop_id, it.get('sku'), it.get('barcode'), it.get('name'))
            if not item:
                width, height = to_int(it.get('width')), to_int(it.get('height'))
                material = (it.get('material') or '').strip()
                if material and width and height:
                    item = (material, width, height, it.get('name') or '', None)
            if not item:
                has_unknown = True
                unmatched.append({'orderNumber': number, 'sku': it.get('sku'), 'name': it.get('name') or ''})
                continue
            for _ in range(max(1, to_int(it.get('quantity')) or 1)):
                units.append(item)

        if has_unknown or not units:
            continue

        size = len(units)
        for pos, (material, width, height, item_name, item_id) in enumerate(units, start=1):
            product = f'{material} {width}x{height}' if material and width and height else item_name
            cur.execute(
                "INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, "
                "source, material, width, height, marketplace_created_at, marketplace_item_id, "
                "group_key, group_size, group_position, shop_id, site_order_id, site_customer_name, "
                "site_customer_phone, delivery_tracking_number, delivery_label_url) "
                "VALUES (%s, 'IM', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, "
                "%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                (
                    f'{group_key}-{pos}' if size > 1 else group_key,
                    product, material,
                    int(width) if width else None, int(height) if height else None,
                    created_at, int(item_id) if item_id else None,
                    group_key if size > 1 else None,
                    size if size > 1 else None,
                    pos if size > 1 else None,
                    int(shop_id), sid,
                    (customer.get('name') or '')[:255] or None,
                    (customer.get('phone') or '')[:64] or None,
                    tracking, label_url,
                ),
            )
            if cur.fetchone():
                created += 1
            else:
                skipped_existing += 1
        created_orders.append(number)

    log_action(
        cur, actor_id, actor_name, 'site_sync',
        f'Загружено с мегатюль.рф: {created} вещей в {len(created_orders)} заказах'
        if created else 'Загрузка с мегатюль.рф: новых заказов нет',
    )
    return {
        'created': created,
        'orders': created_orders,
        'skippedExisting': skipped_existing,
        'unmatched': unmatched[:20],
    }


def refresh_labels(cur, site_url, api_key):
    """Дотягивает номер отправления и этикетку Ozon у заказов, где их ещё нет.

    Отправление Ozon магазин создаёт после оплаты — бывает, что к первой загрузке
    этикетки ещё нет. Спрашиваем сайт повторно по каждому такому заказу.
    """
    cur.execute(
        "SELECT DISTINCT site_order_id FROM orders WHERE marketplace = 'IM' "
        "AND site_order_id IS NOT NULL AND delivery_label_url IS NULL "
        "AND cancelled_at IS NULL AND COALESCE(status, '') NOT IN ('Отменён', 'Выполнен', 'Отгружен') "
        "LIMIT 30"
    )
    updated = 0
    for (sid,) in cur.fetchall():
        st, data = site_get(f'{site_url}/api/crm/orders/{sid}', api_key)
        if st != 200 or not isinstance(data, dict):
            continue
        so = data.get('order') or data
        delivery = so.get('delivery') or {}
        tracking = (delivery.get('trackingNumber') or so.get('trackingNumber') or '').strip() or None
        label_url = (delivery.get('labelUrl') or so.get('labelUrl') or '').strip() or None
        cancelled = str(so.get('status') or '').lower() in ('cancelled', 'canceled', 'refunded')
        if cancelled:
            cur.execute(
                "UPDATE orders SET cancelled_at = now() WHERE site_order_id = %s AND cancelled_at IS NULL",
                (sid,),
            )
            updated += 1
            continue
        if tracking or label_url:
            cur.execute(
                "UPDATE orders SET delivery_tracking_number = COALESCE(%s, delivery_tracking_number), "
                "delivery_label_url = COALESCE(%s, delivery_label_url) WHERE site_order_id = %s",
                (tracking, label_url, sid),
            )
            updated += 1
    return updated


def get_label(cur, order_id, order_number, api_key):
    """Этикетка Ozon Доставки, которую передал магазин, — в base64 для печати."""
    if order_id:
        cur.execute("SELECT delivery_label_url, delivery_tracking_number FROM orders WHERE id = %s", (int(order_id),))
    else:
        cur.execute(
            "SELECT delivery_label_url, delivery_tracking_number FROM orders "
            "WHERE order_number = %s OR delivery_tracking_number = %s OR group_key = %s LIMIT 1",
            (order_number, order_number, order_number),
        )
    row = cur.fetchone()
    if not row:
        return 404, {'error': 'Заказ не найден'}
    url, tracking = row
    if not url:
        return 409, {'error': 'Магазин ещё не передал этикетку Ozon Доставки по этому заказу. '
                              'Подождите несколько минут — система спросит сайт снова.'}
    req = urllib.request.Request(url, headers={'X-Api-Key': api_key, 'Authorization': f'Bearer {api_key}'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            content = r.read()
            ctype = r.headers.get('Content-Type') or ''
    except Exception as e:
        return 502, {'error': f'Не удалось скачать этикетку: {e}'}
    kind = 'pdf' if ('pdf' in ctype or content[:4] == b'%PDF') else 'png'
    return 200, {'kind': kind, 'base64': base64.b64encode(content).decode('ascii'),
                 'trackingNumber': tracking}


def handler(event: dict, context) -> dict:
    """Заказы интернет-магазина мегатюль.рф: загрузка на конвейер и этикетки Ozon Доставки.

    POST { action: 'sync' }                  — забрать оплаченные заказы сайта (и по расписанию)
    POST { action: 'label', orderId }         — этикетка Ozon Доставки для печати
    GET  ?action=status                       — подключён ли магазин
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    body = {}
    if method == 'POST':
        try:
            body = json.loads(event.get('body') or '{}')
        except Exception:
            return _resp(400, {'error': 'Некорректный JSON'})
    params = event.get('queryStringParameters') or {}
    action = body.get('action') or params.get('action') or 'status'
    actor_id = body.get('actorId')
    actor_name = body.get('actorName')

    cron_key = body.get('cronSecret') or params.get('cronSecret')
    if cron_key:
        if cron_key != os.environ.get('CRON_SECRET', '') or not cron_key:
            return _resp(403, {'error': 'Неверный ключ планировщика'})
        actor_id, actor_name = None, 'Планировщик'
    if method == 'GET' and action != 'status' and not cron_key:
        return _resp(403, {'error': 'Действие требует ключ планировщика'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        shop_id, site_url, api_key, enabled = site_settings(cur)
        if not shop_id:
            return _resp(400, {'error': 'Магазин мегатюль.рф не заведён'})

        if action == 'status':
            return _resp(200, {'shopId': shop_id, 'siteUrl': site_url,
                               'connected': bool(api_key) and enabled})

        if action == 'label':
            code, payload = get_label(cur, body.get('orderId'), (body.get('orderNumber') or '').strip(), api_key)
            return _resp(code, payload)

        if not api_key or not enabled:
            return _resp(400, {'error': 'Магазин мегатюль.рф не подключён: заполните ключ доступа '
                                        'в «Интеграциях» на вкладке магазина и включите интеграцию.'})

        if action == 'sync':
            result = sync_orders(cur, shop_id, site_url, api_key, actor_id, actor_name)
            if 'error' in result:
                conn.rollback()
                return _resp(502, result)
            result['labelsUpdated'] = refresh_labels(cur, site_url, api_key)
            conn.commit()
            return _resp(200, result)

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()
