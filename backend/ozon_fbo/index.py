import json
import os
import urllib.request
import urllib.error

import psycopg2
from psycopg2.extras import execute_values

# OZON Seller API (Supply Order — заявки FBO). Ключ боевой (у OZON нет тестового контура),
# поэтому функция работает ТОЛЬКО НА ЧТЕНИЕ заявок и их состава. Единственное изменение,
# которое она делает — в НАШЕЙ базе (создаёт поставку и заказы на конвейер). На стороне OZON
# ничего не двигается.
OZON_API_BASE = 'https://api-seller.ozon.ru'

# Заявки в статусе «Заполнение данных» — те, что ожидают сборки.
OZON_STATE_DATA_FILLING = 'DATA_FILLING'

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
        'body': json.dumps(body),
    }


def get_ozon_credentials(cur):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'ozon'"
    )
    row = cur.fetchone()
    if not row:
        return None, None, False
    is_enabled = bool(row[0])
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('clientId') or '').strip(), (creds.get('apiKey') or '').strip(), is_enabled


def ozon_post(path, client_id, api_key, payload):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(OZON_API_BASE + path, method='POST', data=body)
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
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


def ozon_error_text(status_code, data):
    if isinstance(data, dict):
        return data.get('message') or data.get('error') or json.dumps(data, ensure_ascii=False)
    return str(data)


def fetch_application_details(client_id, api_key, order_ids):
    """Получает детали заявок OZON FBO по их order_ids (/v3/supply-order/get)."""
    if not order_ids:
        return []
    status_code, data = ozon_post('/v3/supply-order/get', client_id, api_key, {'order_ids': order_ids})
    if status_code != 200 or not isinstance(data, dict):
        return []
    return data.get('orders', []) or []


def get_bundle_items(client_id, api_key, bundle_id):
    """Возвращает товарный состав заявки по bundle_id (/v1/supply-order/bundle)."""
    items = []
    last_id = ''
    for _ in range(20):  # постранично, до 20 страниц
        payload = {
            'bundle_ids': [bundle_id],
            'limit': 100,
            'query': '',
            'sort_field': 'UNSPECIFIED',
            'sort_dir': 'ASC',
            'is_asc': True,
        }
        if last_id:
            payload['last_id'] = last_id
        status_code, data = ozon_post('/v1/supply-order/bundle', client_id, api_key, payload)
        if status_code != 200 or not isinstance(data, dict):
            break
        page = data.get('items', []) or []
        items.extend(page)
        last_id = data.get('last_id') or ''
        # Последняя страница: пусто, нет курсора, или пришло меньше лимита.
        if not last_id or not page or len(page) < 100:
            break
    return items


def find_marketplace_item(cur, ozon_sku, offer_id):
    if ozon_sku:
        cur.execute(
            "SELECT material, width, height, name FROM marketplace_items WHERE ozon_sku = %s LIMIT 1",
            (str(ozon_sku),),
        )
        row = cur.fetchone()
        if row:
            return row
    if offer_id:
        cur.execute(
            "SELECT material, width, height, name FROM marketplace_items WHERE sku = %s LIMIT 1",
            (str(offer_id),),
        )
        row = cur.fetchone()
        if row:
            return row
    return None


def log_action(cur, actor_id, actor_name, action, entity_id, description):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'integration',
            action,
            'supply',
            int(entity_id) if entity_id not in (None, '') else None,
            description,
        ),
    )


def handle_list_applications(cur, client_id, api_key):
    """Список заявок OZON FBO, ожидающих сборки (state=DATA_FILLING)."""
    status_code, data = ozon_post(
        '/v3/supply-order/list', client_id, api_key,
        {'filter': {'states': [OZON_STATE_DATA_FILLING]}, 'limit': 100, 'sort_by': 1, 'sort_dir': 1},
    )
    if status_code in (401, 403):
        return _resp(400, {'error': 'OZON отклонил ключ (проверьте Client ID и API-ключ).'})
    if status_code != 200:
        return _resp(502, {'error': f'OZON вернул ошибку ({status_code}): {ozon_error_text(status_code, data)}'})

    order_ids = data.get('order_ids', []) if isinstance(data, dict) else []
    orders = fetch_application_details(client_id, api_key, order_ids)

    # Какие заявки уже импортированы у нас в поставку — чтобы показать это в списке.
    imported = {}
    if order_ids:
        ids_csv = ','.join(str(int(i)) for i in order_ids)
        cur.execute(
            f"SELECT ozon_supply_order_id, id FROM marketplace_supplies "
            f"WHERE ozon_supply_order_id IN ({ids_csv})"
        )
        imported = {r[0]: r[1] for r in cur.fetchall()}

    applications = []
    for o in orders:
        order_id = o.get('order_id')
        warehouse = (o.get('drop_off_warehouse') or {}).get('name') or (o.get('supplies', [{}])[0].get('storage_warehouse', {}) or {}).get('name')
        ts = (o.get('timeslot') or {}).get('timeslot') or {}
        applications.append({
            'orderId': order_id,
            'orderNumber': o.get('order_number'),
            'state': o.get('state'),
            'createdDate': o.get('created_date'),
            'deadline': o.get('data_filling_deadline'),
            'warehouse': warehouse,
            'timeslotFrom': ts.get('from'),
            'timeslotTo': ts.get('to'),
            'supplyId': imported.get(order_id),
        })
    return _resp(200, {'applications': applications})


def handle_import_composition(cur, conn, client_id, api_key, body_data):
    """По заявке OZON FBO создаёт нашу поставку (если ещё нет) и заказы на конвейер из её
    товарного состава. Каждая штука состава → отдельный заказ OZON FBO со статусом «Новый»."""
    order_id = body_data.get('orderId')
    created_by = body_data.get('createdBy')
    actor_id = body_data.get('actorId')
    actor_name = body_data.get('actorName')
    if not order_id:
        return _resp(400, {'error': 'Укажите orderId заявки'})

    orders = fetch_application_details(client_id, api_key, [int(order_id)])
    if not orders:
        return _resp(404, {'error': 'Заявка не найдена в OZON'})
    app = orders[0]
    order_number = app.get('order_number')
    supplies = app.get('supplies') or []
    if not supplies:
        return _resp(400, {'error': 'В заявке нет поставок (bundle)'})
    bundle_id = supplies[0].get('bundle_id')
    warehouse = (supplies[0].get('storage_warehouse') or {}).get('name') or (app.get('drop_off_warehouse') or {}).get('name')
    ts = (app.get('timeslot') or {}).get('timeslot') or {}
    supply_date = (ts.get('from') or '')[:10] or None

    items = get_bundle_items(client_id, api_key, bundle_id) if bundle_id else []
    if not items:
        return _resp(400, {'error': 'Не удалось получить товарный состав заявки'})

    # Наша поставка для этой заявки: используем существующую или создаём новую.
    cur.execute(
        "SELECT id FROM marketplace_supplies WHERE ozon_supply_order_id = %s", (int(order_id),)
    )
    row = cur.fetchone()
    if row:
        supply_id = row[0]
    else:
        cur.execute(
            "INSERT INTO marketplace_supplies (marketplace, type, status, ozon_delivery_method, "
            "ozon_status, ozon_supply_order_id, supply_number, ozon_application_number, cluster, supply_date, created_by) "
            "VALUES ('OZON', 'FBO', 'Открытая', 'direct', 'Заполнение данных', %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                int(order_id),
                str(order_number) if order_number else None,
                str(order_number) if order_number else None,
                warehouse,
                supply_date,
                int(created_by) if created_by not in (None, '') else None,
            ),
        )
        supply_id = cur.fetchone()[0]

    # Справочник товаров грузим в память одним запросом (вместо SELECT в цикле по каждой позиции):
    # ключи — ozon_sku и sku(offer_id) -> (material, width, height, name).
    cur.execute("SELECT ozon_sku, sku, material, width, height, name FROM marketplace_items")
    by_ozon_sku = {}
    by_offer = {}
    for r in cur.fetchall():
        val = (r[2], r[3], r[4], r[5])
        if r[0]:
            by_ozon_sku[str(r[0])] = val
        if r[1]:
            by_offer[str(r[1])] = val

    skipped_no_item = 0
    unmatched = []
    rows = []  # накапливаем все заказы, вставляем одним запросом (быстро)
    for it in items:
        ozon_sku = it.get('sku')
        offer_id = it.get('offer_id')
        qty = int(it.get('quantity') or 1)
        found = None
        if ozon_sku is not None:
            found = by_ozon_sku.get(str(ozon_sku))
        if not found and offer_id:
            found = by_offer.get(str(offer_id))
        if not found:
            skipped_no_item += 1
            unmatched.append({'ozonSku': ozon_sku, 'offerId': offer_id, 'name': it.get('name')})
            continue
        material, width, height, item_name = found
        product = f"{material} {width}x{height}" if material and width and height else item_name
        for n in range(1, qty + 1):
            # order_number уникален (индекс в БД), поэтому каждой штуке даём отдельный номер:
            # {номер заявки}-{артикул}-{порядковый}. ON CONFLICT DO NOTHING делает импорт
            # идемпотентным: повторная загрузка той же заявки не задваивает заказы.
            unique_number = f"{order_number}-{offer_id or ozon_sku}-{n}"
            rows.append((
                unique_number, product, material,
                int(width) if width else None,
                int(height) if height else None,
                warehouse,
            ))

    created = 0
    if rows:
        result = execute_values(
            cur,
            "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
            "quantity, source, material, width, height, cluster) VALUES %s "
            "ON CONFLICT (order_number) DO NOTHING RETURNING id",
            rows,
            template="(%s, 'OZON', 'FBO', 'Новый', %s, 1, 'api', %s, %s, %s, %s)",
            fetch=True,
        )
        created = len(result)

    log_action(
        cur, actor_id, actor_name, 'ozon_fbo_import', supply_id,
        f'Импорт заявки OZON FBO {order_number}: создано заказов {created}, без товара {skipped_no_item}',
    )
    conn.commit()
    return _resp(200, {
        'supplyId': supply_id,
        'created': created,
        'skippedNoItem': skipped_no_item,
        'totalItems': len(items),
        'unmatched': unmatched[:50],
        'orderNumber': order_number,
    })


def handler(event: dict, context) -> dict:
    """Интеграция с OZON FBO (Seller API, Supply Order) — заявки на поставку.

    Позволяет менеджеру видеть реальные заявки OZON FBO, ожидающие сборки, выбрать нужную и
    одним нажатием загрузить её товарный состав на конвейер производства. Ключ OZON боевой
    (тестового контура нет), поэтому на стороне OZON ничего не двигается — только чтение
    заявок и их состава; заказы создаются в НАШЕЙ базе.

    POST /  { action: 'list_applications' }
        - список заявок OZON FBO в статусе «Заполнение данных» (ожидают сборки):
          номер заявки, склад, таймслот, дедлайн, и supplyId нашей поставки, если уже импортирована.
    POST /  { action: 'import_composition', orderId, createdBy?, actorId?, actorName? }
        - создаёт (или переиспользует) нашу поставку OZON FBO для заявки и создаёт заказы на
          конвейер из её товарного состава (каждая штука → отдельный заказ order_type='FBO',
          status='Новый'). Товар сопоставляется по ozon_sku (фолбэк offer_id=sku). Возвращает
          supplyId (для перехода), число созданных заказов и нераспознанные артикулы.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком заявок / результатом импорта
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    if method != 'POST':
        return _resp(405, {'error': 'Method not allowed'})

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    if action not in ('list_applications', 'import_composition'):
        return _resp(400, {'error': 'Неизвестное действие'})

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        client_id, api_key, is_enabled = get_ozon_credentials(cur)
        if not is_enabled:
            return _resp(400, {'error': 'Интеграция с OZON выключена. Включите её в разделе «Интеграции маркетплейсов».'})
        if not client_id or not api_key:
            return _resp(400, {'error': 'Не указаны Client ID или API-ключ OZON.'})

        if action == 'list_applications':
            return handle_list_applications(cur, client_id, api_key)
        if action == 'import_composition':
            return handle_import_composition(cur, conn, client_id, api_key, body_data)
    finally:
        conn.close()