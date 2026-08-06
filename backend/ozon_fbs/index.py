import base64
import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

import psycopg2

# OZON Seller API. Тестового контура у OZON нет — ключ боевой, поэтому функция работает
# ТОЛЬКО НА ЧТЕНИЕ: тянет новые FBS-заказы и читает статусы отправлений, но НЕ двигает
# заказы на стороне OZON (не собирает и не отгружает).
OZON_API_BASE = 'https://api-seller.ozon.ru'

# Только заказы, требующие сборки, попадают на конвейер производства.
OZON_NEW_STATUS = 'awaiting_packaging'

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
    """Возвращает (client_id, api_key, is_enabled) для OZON из marketplace_integrations."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'ozon'"
    )
    row = cur.fetchone()
    if not row:
        return None, None, False
    is_enabled = bool(row[0])
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()
    return client_id, api_key, is_enabled


def ozon_post(path, client_id, api_key, payload):
    """POST-запрос к OZON Seller API. Возвращает (status_code, parsed_json_or_text).
    Используется только для чтения (list/get) — статусы заказов не меняются."""
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(OZON_API_BASE + path, method='POST', data=body)
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
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


def find_marketplace_item(cur, ozon_sku, offer_id):
    """Ищет товар: сначала по ozon_sku (числовой sku OZON), затем по offer_id=sku (артикул
    продавца). Возвращает (material, width, height, name, id) или None."""
    if ozon_sku:
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items WHERE ozon_sku = %s LIMIT 1",
            (str(ozon_sku),),
        )
        row = cur.fetchone()
        if row:
            return row
    if offer_id:
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items WHERE sku = %s LIMIT 1",
            (str(offer_id),),
        )
        row = cur.fetchone()
        if row:
            return row
    return None


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


def match_from_stock(cur, order_id, item_id) -> bool:
    """Пробует закрыть новый заказ вещью, которая уже лежит на полке склада.

    Подбор строго по товару справочника (marketplace_item_id) — это та же карточка товара,
    значит вещь подойдёт покупателю. Берём самую давно лежащую вещь (FIFO). Если нашли:
    заказ помечается как закрытый со склада и НЕ уходит на конвейер производства, а вещь
    резервируется под него — кладовщик заберёт её с полки и наклеит стикер отправления.
    """
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
    gw_id = row[0]
    cur.execute(
        "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() WHERE id = %s",
        (int(order_id), gw_id),
    )
    # Заказ закрывается со склада: на конвейер не попадает, ждёт стикеровки кладовщиком.
    cur.execute(
        "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' WHERE id = %s",
        (gw_id, int(order_id)),
    )
    return True


def handle_sync_orders(cur, conn, client_id, api_key, actor_id, actor_name):
    """Тянет новые FBS-заказы OZON (status=awaiting_packaging) и создаёт их в системе."""
    payload = {
        'dir': 'ASC',
        'filter': {
            'cutoff_from': '2020-01-01T00:00:00Z',
            'cutoff_to': '2030-01-01T00:00:00Z',
            'status': OZON_NEW_STATUS,
        },
        # Берём заказы небольшими порциями: OZON отвечает тем дольше, чем больше просим,
        # а функции отведено мало времени. Планировщик ходит часто, поэтому остаток
        # подтянется следующим запуском — заказы не потеряются.
        'limit': 50,
        'offset': 0,
        'with': {},
    }
    status_code, data = ozon_post('/v3/posting/fbs/unfulfilled/list', client_id, api_key, payload)
    if status_code in (401, 403):
        return _resp(400, {'error': 'OZON отклонил ключ (проверьте Client ID и API-ключ в настройках интеграции).'})
    if status_code != 200:
        return _resp(502, {'error': f'OZON вернул ошибку ({status_code}): {ozon_error_text(status_code, data)}'})

    postings = (data.get('result', {}) or {}).get('postings', []) if isinstance(data, dict) else []

    created = 0
    matched = 0
    skipped_existing = 0
    skipped_no_item = 0
    unmatched = []
    created_numbers = []

    for p in postings:
        posting_number = p.get('posting_number')
        ozon_status = p.get('status')
        if not posting_number:
            continue

        # Раньше здесь отправление целиком пропускалось, если по нему уже был хоть один
        # заказ. Из-за этого из отправления с несколькими товарами в производство попадала
        # только первая штука. Теперь проверяем каждую штуку отдельно — по её уникальному
        # номеру заказа (см. ниже), поэтому повторный импорт по-прежнему не создаёт дублей.

        # Время оформления заказа покупателем на OZON: in_process_at (когда отправление
        # ушло в работу), с фолбэком на created_at. По нему считаем ожидание заказа.
        mp_created_at = p.get('in_process_at') or p.get('created_at') or None

        # Каждый товар отправления = отдельная штука на конвейере (1 заказ = 1 штука),
        # с учётом количества.
        products = p.get('products', []) or []
        made_any = False
        for pr in products:
            ozon_sku = pr.get('sku')
            offer_id = pr.get('offer_id')
            qty = int(pr.get('quantity') or 1)
            item = find_marketplace_item(cur, ozon_sku, offer_id)
            if not item:
                skipped_no_item += 1
                unmatched.append({'postingNumber': posting_number, 'ozonSku': ozon_sku, 'offerId': offer_id})
                continue
            material, width, height, item_name, item_id = item
            product = f"{material} {width}x{height}" if material and width and height else item_name
            for n in range(1, qty + 1):
                # Номер заказа для каждой штуки свой: "{отправление}-{артикул}-{номер штуки}".
                # Так несколько товаров одного покупателя становятся отдельными позициями на
                # конвейере, а повторная загрузка не создаёт дублей (ON CONFLICT DO NOTHING).
                # Само отправление хранится в ozon_posting_number — по нему заказы собираются
                # обратно при отгрузке.
                unique_number = f"{posting_number}-{offer_id or ozon_sku}-{n}"
                cur.execute(
                    "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
                    "quantity, source, material, width, height, ozon_posting_number, ozon_status, "
                    "marketplace_created_at, marketplace_item_id) "
                    "VALUES (%s, 'OZON', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                    (
                        unique_number,
                        product,
                        material,
                        int(width) if width else None,
                        int(height) if height else None,
                        posting_number,
                        ozon_status,
                        mp_created_at,
                        int(item_id) if item_id else None,
                    ),
                )
                inserted = cur.fetchone()
                if not inserted:
                    # Эта штука уже загружена ранее — пропускаем, дубль не создаём.
                    skipped_existing += 1
                    continue
                new_order_id = inserted[0]
                # Такая вещь может уже лежать на полке (осталась от отменённого заказа) —
                # тогда шить заново не надо: резервируем её под этот заказ, кладовщик заберёт
                # её с полки, наклеит стикер отправления и отсканирует в поставку FBS.
                matched += 1 if match_from_stock(cur, new_order_id, item_id) else 0
                made_any = True
                created += 1
        if made_any:
            created_numbers.append(posting_number)

    if created > 0:
        log_action(
            cur, actor_id, actor_name, 'ozon_sync_orders',
            f'Загрузка заказов OZON FBS: создано {created}, пропущено (уже есть) {skipped_existing}, '
            f'без товара {skipped_no_item}',
        )
    conn.commit()

    return _resp(200, {
        'created': created,
        'matchedFromStock': matched,
        'skippedExisting': skipped_existing,
        'skippedNoItem': skipped_no_item,
        'totalFromOzon': len(postings),
        'unmatched': unmatched[:50],
        'createdNumbers': created_numbers[:50],
    })


def handle_refresh_status(cur, conn, client_id, api_key, body_data):
    """Читает актуальный статус отправления OZON и сохраняет его у заказов (ТОЛЬКО чтение —
    статус на стороне OZON не меняется)."""
    posting_number = (body_data.get('postingNumber') or '').strip()
    if not posting_number:
        return _resp(400, {'error': 'Укажите postingNumber'})

    status_code, data = ozon_post(
        '/v3/posting/fbs/get', client_id, api_key,
        {'posting_number': posting_number, 'with': {}},
    )
    if status_code != 200:
        return _resp(502, {'error': f'OZON вернул ошибку ({status_code}): {ozon_error_text(status_code, data)}'})

    ozon_status = (data.get('result', {}) or {}).get('status') if isinstance(data, dict) else None
    if ozon_status:
        cur.execute(
            "UPDATE orders SET ozon_status = %s WHERE ozon_posting_number = %s",
            (ozon_status, posting_number),
        )
        conn.commit()
    return _resp(200, {'postingNumber': posting_number, 'ozonStatus': ozon_status})


def handle_refresh_all(cur, conn, client_id, api_key):
    """Разом обновляет статусы всех OZON FBS-заказов в системе. Проходит по списку
    отправлений OZON (/v3/posting/fbs/list, ТОЛЬКО чтение) постранично и для каждого
    отправления, которое есть у нас, сохраняет актуальный ozon_status. Заказы на стороне
    OZON не двигаются."""
    # Множество номеров отправлений, которые есть в нашей системе — обновляем только их.
    cur.execute(
        "SELECT DISTINCT ozon_posting_number FROM orders "
        "WHERE marketplace = 'OZON' AND ozon_posting_number IS NOT NULL"
    )
    known = {r[0] for r in cur.fetchall()}
    if not known:
        return _resp(200, {'updated': 0, 'checked': 0})

    page_limit = 1000
    found = {}  # posting_number -> status (накапливаем в память, БД обновим одним разом)

    # OZON ограничивает длину периода выборки (PERIOD_IS_TOO_LONG), поэтому идём окнами.
    # Загруженные FBS-заказы свежие, поэтому смотрим недалеко в прошлое: 3 окна по 45 дней.
    # Отправления отсортированы по дате (DESC), поэтому свежие заказы находятся быстро —
    # как только нашли все известные, выходим (ранний выход экономит таймаут).
    now = datetime.now(timezone.utc)
    window_days = 45
    windows = 3
    max_pages_per_window = 5
    for w in range(windows):
        to_dt = now - timedelta(days=window_days * w)
        since_dt = now - timedelta(days=window_days * (w + 1))
        offset = 0
        for _ in range(max_pages_per_window):
            status_code, data = ozon_post(
                '/v3/posting/fbs/list', client_id, api_key,
                {
                    'dir': 'DESC',
                    'filter': {
                        'since': since_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                        'to': to_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                    },
                    'limit': page_limit,
                    'offset': offset,
                    'with': {},
                },
            )
            if status_code in (401, 403):
                return _resp(400, {'error': 'OZON отклонил ключ (проверьте Client ID и API-ключ).'})
            if status_code != 200:
                return _resp(502, {'error': f'OZON вернул ошибку ({status_code}): {ozon_error_text(status_code, data)}'})

            result = data.get('result', {}) if isinstance(data, dict) else {}
            postings = result.get('postings', []) or []
            if not postings:
                break

            for p in postings:
                pn = p.get('posting_number')
                st = p.get('status')
                if pn in known and st and pn not in found:
                    found[pn] = st

            if len(found) >= len(known) or not result.get('has_next'):
                break
            offset += page_limit

        if len(found) >= len(known):
            break

    # Пакетное обновление одним запросом (VALUES + UPDATE ... FROM) — быстро даже для сотен строк.
    updated = 0
    if found:
        values_sql = ', '.join(
            "('" + pn.replace("'", "''") + "', '" + st.replace("'", "''") + "')"
            for pn, st in found.items()
        )
        cur.execute(
            f"UPDATE orders o SET ozon_status = v.status "
            f"FROM (VALUES {values_sql}) AS v(posting, status) "
            f"WHERE o.ozon_posting_number = v.posting AND o.ozon_status IS DISTINCT FROM v.status "
            f"RETURNING o.id"
        )
        updated = len(cur.fetchall())

    conn.commit()
    return _resp(200, {'updated': updated, 'checked': len(found), 'known': len(known)})



def get_posting_label(cur, client_id, api_key, order_number):
    """Маркетплейсный ярлык OZON на отправление FBS.

    OZON отдаёт готовую этикетку PDF по номеру отправления — печатаем её как есть, а не
    рисуем свой штрихкод: на ярлыке маркетплейса нужные ему коды и разметка, самодельный
    аналог на складе OZON не примут.

    Возвращает (ошибка, base64_pdf).
    """
    cur.execute(
        "SELECT ozon_posting_number FROM orders WHERE order_number = %s",
        (order_number,),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return 'У этого заказа нет отправления OZON', None
    posting_number = row[0]

    status, data = ozon_post(
        '/v2/posting/fbs/package-label', client_id, api_key,
        {'posting_number': [posting_number]},
    )
    if status != 200:
        # OZON отдаёт этикетку только после того, как отправление собрано на его стороне.
        # Пока заказ в статусе «ожидает упаковки», API отвечает INVALID_ARGUMENT — объясняем
        # это упаковщику человеческим языком, а не кодом ошибки.
        if 'INVALID_ARGUMENT' in str(data):
            return (
                'OZON ещё не подготовил этикетку для этого отправления. '
                'Она появляется после сборки заказа на стороне OZON — попробуйте позже.'
            ), None
        return f'OZON не отдал этикетку (код {status}): {str(data)[:250]}', None
    # Этикетка приходит бинарным PDF — ozon_post уже вернул распарсенное тело, поэтому
    # при бинарном ответе оно приходит строкой.
    if isinstance(data, (bytes, bytearray)):
        return None, base64.b64encode(bytes(data)).decode()
    if isinstance(data, str):
        return None, base64.b64encode(data.encode('latin-1', 'ignore')).decode()
    return 'OZON вернул этикетку в неожиданном формате', None


def handler(event: dict, context) -> dict:
    """Интеграция с OZON FBS (Seller API) — РЕЖИМ ТОЛЬКО ЧТЕНИЕ.

    Тянет новые FBS-заказы OZON на конвейер производства и читает статусы отправлений.
    Ключ OZON боевой (тестового контура у OZON нет), поэтому функция НЕ двигает заказы на
    стороне OZON — не собирает и не отгружает. Client-Id и Api-Key берутся из настроек
    интеграции (marketplace_integrations, marketplace_code='ozon').

    POST /  { action: 'sync_orders', actorId?, actorName? }
        - вызывает OZON /v3/posting/fbs/unfulfilled/list со status=awaiting_packaging
          (только новые, требующие сборки), сопоставляет товар по ozon_sku (фолбэк offer_id=sku)
          и создаёт заказы: marketplace='OZON', order_type='FBS', status='Новый',
          sewing_status='Новый', source='api'. Дубли исключаются по ozon_posting_number.
    POST /  { action: 'refresh_status', postingNumber }
        - читает актуальный статус отправления OZON (/v3/posting/fbs/get) и сохраняет его
          у соответствующих заказов. Статус на стороне OZON не меняется.
    POST /  { action: 'refresh_all_statuses' }
        - разом обновляет статусы всех OZON FBS-заказов системы: постранично читает список
          отправлений OZON (/v3/posting/fbs/list) и сохраняет актуальный статус тем заказам,
          чьё отправление есть в системе. Только чтение — заказы на OZON не двигаются.

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

    # Ночной планировщик тянет заказы сам, без открытой CRM. Ключ сверяем только если он
    # пришёл: из интерфейса вызов идёт как раньше, без ключа.
    if body_data.get('cronSecret'):
        cron_secret = os.environ.get('CRON_SECRET', '')
        if not cron_secret or body_data['cronSecret'] != cron_secret:
            return _resp(403, {'error': 'Неверный ключ планировщика'})
        # В журнале должно быть видно, что заказы подтянул планировщик, а не сотрудник.
        actor_id, actor_name = None, 'Планировщик'

    if action not in ('sync_orders', 'refresh_status', 'refresh_all_statuses', 'label'):
        return _resp(400, {'error': 'Неизвестное действие'})

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        client_id, api_key, is_enabled = get_ozon_credentials(cur)
        if not is_enabled:
            return _resp(400, {'error': 'Интеграция с OZON выключена. Включите её в разделе «Интеграции маркетплейсов».'})
        if not client_id or not api_key:
            return _resp(400, {'error': 'Не указаны Client ID или API-ключ OZON. Добавьте их в разделе «Интеграции маркетплейсов».'})

        if action == 'sync_orders':
            return handle_sync_orders(cur, conn, client_id, api_key, actor_id, actor_name)
        if action == 'refresh_status':
            return handle_refresh_status(cur, conn, client_id, api_key, body_data)
        if action == 'refresh_all_statuses':
            return handle_refresh_all(cur, conn, client_id, api_key)
        if action == 'label':
            # Маркетплейсный ярлык на отправление — печатается на терминале упаковщика.
            order_number = (body_data.get('orderNumber') or '').strip()
            if not order_number:
                return _resp(400, {'error': 'Укажите номер заказа'})
            err, pdf_b64 = get_posting_label(cur, client_id, api_key, order_number)
            if err:
                return _resp(502, {'error': err})
            return _resp(200, {'orderNumber': order_number, 'pdfBase64': pdf_b64})
    finally:
        conn.close()