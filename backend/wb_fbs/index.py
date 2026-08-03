import json
import os
import urllib.request
import urllib.error

import psycopg2

# Боевой контур WB Marketplace API. Тестовый (sandbox) контур WB использует поддомен
# с приставкой -sandbox; переключение — через поле useSandbox в credentials интеграции.
WB_API_BASE = 'https://marketplace-api.wildberries.ru'
WB_API_SANDBOX_BASE = 'https://marketplace-api-sandbox.wildberries.ru'

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


def get_wb_credentials(cur):
    """Возвращает (api_key, use_sandbox, is_enabled) для WildBerries из marketplace_integrations."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'wildberries'"
    )
    row = cur.fetchone()
    if not row:
        return None, False, False
    is_enabled = bool(row[0])
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    api_key = (creds.get('apiKey') or '').strip()
    use_sandbox = bool(creds.get('useSandbox'))
    return api_key, use_sandbox, is_enabled


def wb_get(path, api_key, use_sandbox):
    """GET-запрос к WB Marketplace API. Возвращает (status_code, parsed_json_or_text)."""
    base = WB_API_SANDBOX_BASE if use_sandbox else WB_API_BASE
    req = urllib.request.Request(base + path, method='GET')
    req.add_header('Authorization', api_key)
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


def find_marketplace_item(cur, nm_id, skus, article):
    """Ищет товар в marketplace_items: сначала по wb_sku (nmId), затем по любому баркоду
    из skus, затем по sku (артикул продавца). Возвращает (material, width, height, name) или None."""
    if nm_id:
        cur.execute(
            "SELECT material, width, height, name FROM marketplace_items WHERE wb_sku = %s LIMIT 1",
            (str(nm_id),),
        )
        row = cur.fetchone()
        if row:
            return row
    for sku in (skus or []):
        cur.execute(
            "SELECT material, width, height, name FROM marketplace_items WHERE barcode = %s LIMIT 1",
            (str(sku),),
        )
        row = cur.fetchone()
        if row:
            return row
    if article:
        cur.execute(
            "SELECT material, width, height, name FROM marketplace_items WHERE sku = %s LIMIT 1",
            (str(article),),
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
            'order',
            int(entity_id) if entity_id not in (None, '') else None,
            description,
        ),
    )


def handler(event: dict, context) -> dict:
    """Интеграция с WildBerries FBS (Marketplace API v3).

    Тянет новые FBS-заказы (сборочные задания) с WildBerries и создаёт их в нашей системе,
    чтобы конвейер производства (раскрой -> пошив -> стикеровка -> готовые) их видел.
    API-ключ и режим (боевой/тестовый sandbox) берутся из настроек интеграции
    (таблица marketplace_integrations, marketplace_code='wildberries').

    POST /  { action: 'sync_orders', actorId?, actorName? }
        - вызывает WB GET /api/v3/orders/new, сопоставляет каждый заказ с товаром из
          справочника marketplace_items по артикулу продавца (wb_sku=nmId, затем barcode,
          затем sku) и создаёт заказы: marketplace='WB', order_type='FBS', status='Новый',
          sewing_status='Новый', source='api'. Повторная синхронизация не создаёт дублей
          (защита по wb_order_id). Возвращает счётчики: created / skipped_existing /
          skipped_no_item, и список нераспознанных артикулов для настройки товаров.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с результатом синхронизации
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    if method != 'POST':
        return _resp(405, {'error': 'Method not allowed'})

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    actor_id = body_data.get('actorId')
    actor_name = body_data.get('actorName')

    if action != 'sync_orders':
        return _resp(400, {'error': 'Неизвестное действие'})

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        api_key, use_sandbox, is_enabled = get_wb_credentials(cur)
        if not is_enabled:
            return _resp(400, {'error': 'Интеграция с WildBerries выключена. Включите её в разделе «Интеграции маркетплейсов».'})
        if not api_key:
            return _resp(400, {'error': 'Не указан API-ключ WildBerries. Добавьте его в разделе «Интеграции маркетплейсов».'})

        status_code, data = wb_get('/api/v3/orders/new', api_key, use_sandbox)
        if status_code == 401:
            return _resp(400, {'error': 'WildBerries отклонил API-ключ (401). Проверьте ключ в настройках интеграции.'})
        if status_code != 200:
            msg = data.get('message') if isinstance(data, dict) else str(data)
            return _resp(502, {'error': f'WildBerries вернул ошибку ({status_code}): {msg}'})

        wb_orders = data.get('orders', []) if isinstance(data, dict) else []

        created = 0
        skipped_existing = 0
        skipped_no_item = 0
        unmatched = []
        created_numbers = []

        for wb in wb_orders:
            wb_order_id = wb.get('id')
            if not wb_order_id:
                continue

            cur.execute("SELECT id FROM orders WHERE wb_order_id = %s", (int(wb_order_id),))
            if cur.fetchone():
                skipped_existing += 1
                continue

            nm_id = wb.get('nmId')
            skus = wb.get('skus') or []
            article = wb.get('article')
            item = find_marketplace_item(cur, nm_id, skus, article)
            if not item:
                skipped_no_item += 1
                unmatched.append({'wbOrderId': wb_order_id, 'nmId': nm_id, 'article': article, 'skus': skus})
                continue

            material, width, height, item_name = item
            product = (
                f"{material} {width}x{height}" if material and width and height else item_name
            )
            # Номер заказа для отображения: rid (человекочитаемый идентификатор задания WB),
            # с фолбэком на служебный id сборочного задания.
            order_number = str(wb.get('rid') or wb_order_id)

            cur.execute(
                "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
                "quantity, source, material, width, height, wb_order_id) "
                "VALUES (%s, 'WB', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s) RETURNING id",
                (
                    order_number,
                    product,
                    material,
                    int(width) if width else None,
                    int(height) if height else None,
                    int(wb_order_id),
                ),
            )
            new_id = cur.fetchone()[0]
            created += 1
            created_numbers.append(order_number)

        if created > 0:
            log_action(
                cur, actor_id, actor_name, 'wb_sync_orders', None,
                f'Загрузка заказов WB FBS: создано {created}, пропущено (уже есть) {skipped_existing}, '
                f'без товара {skipped_no_item}',
            )
        conn.commit()

        return _resp(200, {
            'created': created,
            'skippedExisting': skipped_existing,
            'skippedNoItem': skipped_no_item,
            'totalFromWb': len(wb_orders),
            'unmatched': unmatched[:50],
            'createdNumbers': created_numbers[:50],
            'sandbox': use_sandbox,
        })
    finally:
        conn.close()
