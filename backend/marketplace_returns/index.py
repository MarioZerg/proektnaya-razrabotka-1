import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2

# Возвраты тянем ТОЛЬКО НА ЧТЕНИЕ: списки заявок на возврат у OZON и WB. Ничего на стороне
# маркетплейса не подтверждаем и не отклоняем — решение принимает кладовщик, когда вещь
# физически доехала до склада.
OZON_API_BASE = 'https://api-seller.ozon.ru'
# Заявки покупателей на возврат WB отдаёт отдельный хост returns-api (не marketplace-api).
WB_RETURNS_API_BASE = 'https://returns-api.wildberries.ru'

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


def log_action(cur, actor_id, actor_name, action, description, details=None):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, description, details) "
        "VALUES (%s, %s, 'returns', %s, 'marketplace_return', %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            action,
            description,
            json.dumps(details) if details else None,
        ),
    )


def get_credentials(cur, code):
    """Учётные данные маркетплейса из marketplace_integrations."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = %s",
        (code,),
    )
    row = cur.fetchone()
    if not row:
        return {}, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds, bool(row[0])


def http_json(url, method, headers, payload=None):
    """HTTP-запрос с JSON. Возвращает (status_code, parsed_json_or_text)."""
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in headers.items():
        req.add_header(k, v)
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


def error_text(data):
    if isinstance(data, dict):
        return data.get('message') or data.get('error') or data.get('detail') or json.dumps(data, ensure_ascii=False)
    return str(data)


def find_item(cur, sku, offer_id):
    """Находит товар в справочнике по SKU маркетплейса или артикулу продавца."""
    if sku:
        cur.execute(
            "SELECT id, name FROM marketplace_items WHERE ozon_sku = %s OR wb_sku = %s LIMIT 1",
            (str(sku), str(sku)),
        )
        row = cur.fetchone()
        if row:
            return row
    if offer_id:
        cur.execute("SELECT id, name FROM marketplace_items WHERE sku = %s LIMIT 1", (str(offer_id),))
        row = cur.fetchone()
        if row:
            return row
    return None, None


def find_order(cur, marketplace, posting_number):
    """Заказ, по которому оформлен возврат.

    У OZON это номер отправления (ozon_posting_number), у WB — srid заявки, который
    совпадает с order_number заказа (там он берётся из поля rid сборочного задания).
    """
    if not posting_number:
        return None
    if marketplace == 'OZON':
        cur.execute(
            "SELECT id FROM orders WHERE ozon_posting_number = %s ORDER BY id LIMIT 1",
            (str(posting_number),),
        )
    else:
        cur.execute(
            "SELECT id FROM orders WHERE order_number = %s AND marketplace = 'WB' "
            "ORDER BY id LIMIT 1",
            (str(posting_number),),
        )
    row = cur.fetchone()
    return row[0] if row else None


def save_return(cur, marketplace, r):
    """Сохраняет одну заявку на возврат. Повторная загрузка обновляет статус, но не плодит
    дубли (уникальный индекс marketplace + external_id). Возвращает 'created'/'updated'."""
    cur.execute(
        "SELECT id, status FROM marketplace_returns WHERE marketplace = %s AND external_id = %s",
        (marketplace, r['externalId']),
    )
    existing = cur.fetchone()
    if existing:
        # Свой статус обработки не трогаем — обновляем только данные со стороны маркетплейса.
        cur.execute(
            "UPDATE marketplace_returns SET mp_status = %s, return_reason = %s, "
            "product_name = COALESCE(%s, product_name) WHERE id = %s",
            (r.get('mpStatus'), r.get('reason'), r.get('productName'), existing[0]),
        )
        return 'updated'

    item_id, item_name = find_item(cur, r.get('sku'), r.get('offerId'))
    order_id = find_order(cur, marketplace, r.get('postingNumber'))
    cur.execute(
        "INSERT INTO marketplace_returns (marketplace, external_id, posting_number, order_id, "
        "offer_id, sku, product_name, marketplace_item_id, quantity, mp_status, return_reason, "
        "mp_created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            marketplace,
            r['externalId'],
            r.get('postingNumber'),
            order_id,
            r.get('offerId'),
            str(r.get('sku')) if r.get('sku') else None,
            r.get('productName') or item_name,
            item_id,
            int(r.get('quantity') or 1),
            r.get('mpStatus'),
            r.get('reason'),
            r.get('createdAt'),
        ),
    )
    return 'created'


def sync_ozon(cur, days):
    """Заявки на возврат OZON (FBS и FBO). Читаем список возвратов за период."""
    creds, enabled = get_credentials(cur, 'ozon')
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция OZON выключена'}
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнены Client Id и Api Key OZON'}

    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    headers = {'Client-Id': client_id, 'Api-Key': api_key}
    created = updated = 0
    last_id = 0
    for _ in range(20):  # страховка от бесконечной постраничной выборки
        status, data = http_json(
            OZON_API_BASE + '/v1/returns/list',
            'POST',
            headers,
            {
                'filter': {'logistic_return_date': {'time_from': since}},
                'limit': 500,
                'last_id': last_id,
            },
        )
        if status != 200:
            return {'created': created, 'updated': updated, 'error': error_text(data)}

        returns = (data or {}).get('returns') or []
        if not returns:
            break
        for it in returns:
            product = it.get('product') or {}
            exchange = it.get('exchange_order') or {}
            rec = {
                'externalId': str(it.get('id') or exchange.get('id') or ''),
                'postingNumber': it.get('posting_number'),
                'offerId': product.get('offer_id'),
                'sku': product.get('sku'),
                'productName': product.get('name'),
                'quantity': product.get('quantity') or 1,
                'mpStatus': (it.get('visual') or {}).get('status', {}).get('display_name')
                or it.get('status'),
                'reason': it.get('return_reason_name') or it.get('reason'),
                'createdAt': it.get('logistic', {}).get('return_date')
                or it.get('created_at'),
            }
            if not rec['externalId']:
                continue
            if save_return(cur, 'OZON', rec) == 'created':
                created += 1
            else:
                updated += 1
        if not (data or {}).get('has_next'):
            break
        last_id = returns[-1].get('id') or 0
    return {'created': created, 'updated': updated, 'error': None}


def sync_wb(cur, days):
    """Заявки покупателей на возврат Wildberries."""
    creds, enabled = get_credentials(cur, 'wildberries')
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция Wildberries выключена'}
    api_key = (creds.get('apiKey') or '').strip()
    if not api_key:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнен Api Key Wildberries'}

    # WB отдаёт заявки постранично и НЕ принимает фильтр по дате — берём свежие
    # (is_archive=false: ещё не закрытые) и отсеиваем старые уже у себя.
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    created = updated = 0
    claims = []
    for offset in range(0, 1000, 200):
        status, data = http_json(
            f'{WB_RETURNS_API_BASE}/api/v1/claims?is_archive=false&limit=200&offset={offset}',
            'GET',
            {'Authorization': api_key},
        )
        if status != 200:
            return {'created': created, 'updated': updated, 'error': error_text(data)}
        page = (data or {}).get('claims') or []
        claims.extend(page)
        if len(page) < 200:
            break

    for it in claims:
        # WB отдаёт статус числом: 0 — заявка на рассмотрении, 1 — одобрена продавцом,
        # 2 — отклонена, 3 — автоматически одобрена площадкой.
        wb_status_labels = {
            0: 'На рассмотрении',
            1: 'Одобрен продавцом',
            2: 'Отклонён',
            3: 'Одобрен автоматически',
        }
        raw_status = it.get('status')
        status_text = it.get('status_name') or wb_status_labels.get(
            raw_status if isinstance(raw_status, int) else -1, ''
        )
        rec = {
            'externalId': str(it.get('id') or ''),
            'postingNumber': str(it.get('srid') or ''),
            'offerId': str(it.get('nm_id')) if it.get('nm_id') else None,
            'sku': it.get('nm_id'),
            'productName': it.get('imt_name'),
            'quantity': 1,
            'mpStatus': status_text or None,
            'reason': it.get('user_comment') or it.get('claim_type'),
            'createdAt': it.get('dt'),
        }
        if not rec['externalId']:
            continue
        # Старые заявки за пределами запрошенного периода пропускаем.
        if rec['createdAt']:
            try:
                dt = datetime.fromisoformat(str(rec['createdAt']).replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt < since_dt:
                    continue
            except ValueError:
                pass
        if save_return(cur, 'WB', rec) == 'created':
            created += 1
        else:
            updated += 1
    return {'created': created, 'updated': updated, 'error': None}


def next_storage_barcode(cur):
    cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM goods_warehouse")
    return 'GW-' + str(cur.fetchone()[0]).zfill(6)


def handler(event: dict, context) -> dict:
    """Возвраты с маркетплейсов: загрузка заявок по API и приём вещей на склад.

    Кладовщик больше не вбивает номера заказов руками — система сама тянет с OZON и WB
    список того, что покупатели вернули. Когда коробка физически доехала, кладовщик
    отмечает возврат принятым, и вещь встаёт на склад в очередь «Ждёт полку».

    GET  /                            - список возвратов (фильтры: status, marketplace)
    POST /  { action: 'sync' }        - загрузить свежие заявки с OZON и WB
    POST /  { action: 'receive', id } - принять вещь на склад (создаёт запись склада)
    POST /  { action: 'reject', id }  - возврат не приехал / отклонён

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком возвратов или результатом действия
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        params = event.get('queryStringParameters') or {}
        status_filter = (params.get('status') or '').strip()
        mp_filter = (params.get('marketplace') or '').strip()

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            conditions = []
            if status_filter and status_filter != 'all':
                conditions.append(f"r.status = '{status_filter.replace(chr(39), chr(39) * 2)}'")
            if mp_filter and mp_filter != 'all':
                conditions.append(f"r.marketplace = '{mp_filter.replace(chr(39), chr(39) * 2)}'")
            where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ''

            cur.execute(
                "SELECT r.id, r.marketplace, r.external_id, r.posting_number, r.offer_id, "
                "r.product_name, r.quantity, r.mp_status, r.return_reason, r.status, "
                "r.mp_created_at, r.received_at, u.full_name, gw.storage_barcode, "
                "mi.material, mi.width, mi.height, o.order_number "
                "FROM marketplace_returns r "
                "LEFT JOIN users u ON u.id = r.received_by "
                "LEFT JOIN goods_warehouse gw ON gw.id = r.goods_warehouse_id "
                "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                "LEFT JOIN orders o ON o.id = r.order_id "
                f"{where_sql} ORDER BY r.mp_created_at DESC NULLS LAST, r.id DESC LIMIT 500"
            )
            returns = [
                {
                    'id': r[0],
                    'marketplace': r[1],
                    'externalId': r[2],
                    'postingNumber': r[3],
                    'offerId': r[4],
                    'productName': r[5],
                    'quantity': r[6],
                    'mpStatus': r[7],
                    'returnReason': r[8],
                    'status': r[9],
                    'mpCreatedAt': r[10].isoformat() + 'Z' if r[10] else None,
                    'receivedAt': r[11].isoformat() + 'Z' if r[11] else None,
                    'receivedByName': r[12],
                    'storageBarcode': r[13],
                    'material': r[14],
                    'width': r[15],
                    'height': r[16],
                    'orderNumber': r[17],
                }
                for r in cur.fetchall()
            ]

            cur.execute(
                "SELECT status, COUNT(*) FROM marketplace_returns GROUP BY status"
            )
            counts = {row[0]: row[1] for row in cur.fetchall()}
            return _resp(200, {'returns': returns, 'counts': counts})
        finally:
            conn.close()

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'sync':
                days = int(body_data.get('days') or 30)
                ozon = sync_ozon(cur, days)
                wb = sync_wb(cur, days)
                total_created = ozon['created'] + wb['created']
                if total_created:
                    log_action(
                        cur, actor_id, actor_name, 'sync',
                        f'Загрузка возвратов: новых {total_created}',
                        {'ozon': ozon, 'wb': wb},
                    )
                conn.commit()
                return _resp(200, {'ozon': ozon, 'wildberries': wb, 'created': total_created})

            if action == 'receive':
                # Возврат физически доехал: заводим вещь на склад в очередь «Ждёт полку».
                # На полку она попадёт сканированием стикера хранения, как и все остальные.
                return_id = body_data.get('id')
                if not return_id:
                    return _resp(400, {'error': 'Укажите id возврата'})

                cur.execute(
                    "SELECT status, order_id, product_name, marketplace, external_id "
                    "FROM marketplace_returns WHERE id = %s",
                    (int(return_id),),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Возврат не найден'})
                if row[0] == 'received':
                    return _resp(409, {'error': 'Этот возврат уже принят на склад'})

                order_id = row[1]
                gw_id = None
                storage_barcode = None
                if order_id:
                    # Вещь уже известна системе — переиспользуем её карточку на складе,
                    # чтобы не плодить дубли и сохранить прежний штрихкод хранения.
                    cur.execute(
                        "SELECT id, storage_barcode FROM goods_warehouse WHERE order_id = %s",
                        (int(order_id),),
                    )
                    gw_row = cur.fetchone()
                    if gw_row:
                        gw_id, storage_barcode = gw_row
                        cur.execute(
                            "UPDATE goods_warehouse SET status = 'awaiting_shelf', shelf_id = NULL, "
                            "shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
                            "reserved_order_id = NULL, shipping_labeled_at = NULL, "
                            "receive_reason = 'return', received_at = now() WHERE id = %s",
                            (gw_id,),
                        )
                    else:
                        storage_barcode = next_storage_barcode(cur)
                        cur.execute(
                            "INSERT INTO goods_warehouse (order_id, status, storage_barcode, "
                            "receive_reason) VALUES (%s, 'awaiting_shelf', %s, 'return') RETURNING id",
                            (int(order_id), storage_barcode),
                        )
                        gw_id = cur.fetchone()[0]

                cur.execute(
                    "UPDATE marketplace_returns SET status = 'received', received_at = now(), "
                    "received_by = %s, goods_warehouse_id = %s WHERE id = %s",
                    (int(actor_id) if actor_id else None, gw_id, int(return_id)),
                )
                log_action(
                    cur, actor_id, actor_name, 'receive',
                    f'Принят возврат {row[3]} {row[4]} ({row[2] or "товар"})',
                )
                conn.commit()
                return _resp(200, {
                    'success': True,
                    'storageBarcode': storage_barcode,
                    'needsManualOrder': order_id is None,
                })

            if action == 'reject':
                return_id = body_data.get('id')
                if not return_id:
                    return _resp(400, {'error': 'Укажите id возврата'})
                cur.execute(
                    "UPDATE marketplace_returns SET status = 'rejected' WHERE id = %s",
                    (int(return_id),),
                )
                log_action(cur, actor_id, actor_name, 'reject', f'Возврат #{return_id} отклонён')
                conn.commit()
                return _resp(200, {'success': True})

            return _resp(400, {'error': 'Неизвестное действие'})
        finally:
            conn.close()

    return _resp(405, {'error': 'Method not allowed'})
