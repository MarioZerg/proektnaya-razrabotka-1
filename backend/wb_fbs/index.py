import base64
import json
import os
import uuid
import urllib.request
import urllib.error

import boto3
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


def wb_request(method, path, api_key, use_sandbox, payload=None):
    """Универсальный запрос к WB Marketplace API (GET/POST/PATCH).
    Возвращает (status_code, parsed_json_or_text). Для пустого тела ответа — {}."""
    base = WB_API_SANDBOX_BASE if use_sandbox else WB_API_BASE
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(base + path, method=method, data=body)
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


def wb_error_text(status_code, data):
    """Достаёт человекочитаемое сообщение об ошибке из ответа WB."""
    if isinstance(data, dict):
        return data.get('message') or data.get('detail') or data.get('title') or json.dumps(data, ensure_ascii=False)
    return str(data)


# Список складов приёмки FBO WB отдаёт отдельный Supplies API (другой хост, не marketplace-api).
WB_SUPPLIES_API_BASE = 'https://supplies-api.wildberries.ru'


def wb_supplies_get(path, api_key):
    """GET-запрос к WB Supplies API (склады FBO). Возвращает (status_code, parsed_json_or_text)."""
    req = urllib.request.Request(WB_SUPPLIES_API_BASE + path, method='GET')
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


def handle_list_warehouses(api_key):
    """Возвращает список складов приёмки FBO WildBerries для выпадающего списка."""
    status_code, data = wb_supplies_get('/api/v1/warehouses', api_key)
    if status_code == 401:
        return _resp(400, {'error': 'WildBerries отклонил API-ключ (401). Проверьте ключ в настройках интеграции.'})
    if status_code != 200 or not isinstance(data, list):
        return _resp(502, {'error': f'WildBerries вернул ошибку ({status_code}): {wb_error_text(status_code, data)}'})
    warehouses = [
        {
            'id': w.get('ID') if isinstance(w, dict) else None,
            'name': (w.get('name') if isinstance(w, dict) else None) or '',
            'address': (w.get('address') if isinstance(w, dict) else None) or '',
        }
        for w in data
    ]
    warehouses = [w for w in warehouses if w['name']]
    warehouses.sort(key=lambda w: w['name'])
    return _resp(200, {'warehouses': warehouses})



def match_from_stock(cur, order_id, item_id) -> bool:
    """Пробует закрыть новый заказ вещью, которая уже лежит на полке склада.

    Подбор строго по товару справочника (marketplace_item_id) — та же карточка товара, значит
    вещь подойдёт покупателю. Берём самую давно лежащую (FIFO). Заказ помечается как закрытый
    со склада и на конвейер производства не уходит, вещь резервируется под него.
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
    cur.execute(
        "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' WHERE id = %s",
        (gw_id, int(order_id)),
    )
    return True


def find_marketplace_item(cur, nm_id, skus, article):
    """Ищет товар в marketplace_items: сначала по wb_sku (nmId), затем по любому баркоду
    из skus, затем по sku (артикул продавца). Возвращает (material, width, height, name, id) или None."""
    if nm_id:
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items WHERE wb_sku = %s LIMIT 1",
            (str(nm_id),),
        )
        row = cur.fetchone()
        if row:
            return row
    for sku in (skus or []):
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items WHERE barcode = %s LIMIT 1",
            (str(sku),),
        )
        row = cur.fetchone()
        if row:
            return row
    if article:
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items WHERE sku = %s LIMIT 1",
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


def upload_sticker_png(base64_data: str, name: str) -> str:
    """Загружает PNG-стикер короба WB в S3, возвращает публичный CDN URL."""
    binary = base64.b64decode(base64_data)
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'wb-trbx-stickers/{uuid.uuid4().hex}-{name}.png'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType='image/png')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def handle_create_supply(cur, conn, body_data, api_key, use_sandbox):
    """Создаёт поставку FBS на стороне WB (POST /api/v3/supplies) и привязывает её
    WB-идентификатор к нашей поставке (marketplace_supplies.wb_supply_id)."""
    supply_id = body_data.get('supplyId')
    if not supply_id:
        return _resp(400, {'error': 'Укажите supplyId'})

    cur.execute(
        "SELECT marketplace, type, wb_supply_id, supply_number FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Поставка не найдена'})
    marketplace, supply_type, wb_supply_id, supply_number = row
    if marketplace != 'WB' or supply_type != 'FBS':
        return _resp(400, {'error': 'Действие доступно только для поставок WB FBS'})
    if wb_supply_id:
        return _resp(200, {'wbSupplyId': wb_supply_id, 'alreadyCreated': True})

    name = (supply_number or f'Поставка #{supply_id}')[:128]
    status_code, data = wb_request('POST', '/api/v3/supplies', api_key, use_sandbox, {'name': name})
    if status_code not in (200, 201):
        return _resp(502, {'error': f'WB не создал поставку ({status_code}): {wb_error_text(status_code, data)}'})
    wb_supply_id = data.get('id') if isinstance(data, dict) else None
    if not wb_supply_id:
        return _resp(502, {'error': 'WB не вернул идентификатор поставки'})

    cur.execute(
        "UPDATE marketplace_supplies SET wb_supply_id = %s WHERE id = %s",
        (wb_supply_id, int(supply_id)),
    )
    conn.commit()
    return _resp(200, {'wbSupplyId': wb_supply_id})


def handle_scan_order(cur, conn, body_data, api_key, use_sandbox):
    """Сканирование готового FBS-заказа WB в поставку: добавляет сборочное задание в
    WB-поставку (PATCH /api/v3/supplies/{sid}/orders/{orderId}) и фиксирует связь у нас."""
    supply_id = body_data.get('supplyId')
    order_number = (body_data.get('orderNumber') or '').strip()
    if not supply_id or not order_number:
        return _resp(400, {'error': 'Укажите поставку и номер заказа'})

    cur.execute(
        "SELECT marketplace, type, status, wb_supply_id FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    s_row = cur.fetchone()
    if not s_row:
        return _resp(404, {'error': 'Поставка не найдена'})
    marketplace, supply_type, s_status, wb_supply_id = s_row
    if marketplace != 'WB' or supply_type != 'FBS':
        return _resp(400, {'error': 'Действие доступно только для поставок WB FBS'})
    if s_status not in ('Открытая', 'На сборке'):
        return _resp(409, {'error': 'В эту поставку уже нельзя добавлять заказы'})
    if not wb_supply_id:
        return _resp(409, {'error': 'Поставка ещё не создана на стороне WB'})

    # Ищем готовый (после стикеровки) FBS-заказ WB по номеру заказа.
    cur.execute(
        "SELECT id, wb_order_id, sewing_status, product FROM orders "
        "WHERE order_number = %s AND marketplace = 'WB' AND order_type = 'FBS'",
        (order_number,),
    )
    o_row = cur.fetchone()
    if not o_row:
        return _resp(404, {'error': f'Заказ {order_number} не найден среди WB FBS заказов'})
    order_id, wb_order_id, sewing_status, product = o_row
    if sewing_status != 'Готовые':
        return _resp(409, {'error': f'Заказ {order_number} ещё не готов (статус: {sewing_status})'})
    if not wb_order_id:
        return _resp(409, {'error': f'У заказа {order_number} нет идентификатора сборочного задания WB'})

    cur.execute("SELECT supply_id FROM wb_supply_orders WHERE order_id = %s", (order_id,))
    ex = cur.fetchone()
    if ex:
        if ex[0] == int(supply_id):
            return _resp(409, {'error': f'Заказ {order_number} уже в этой поставке'})
        return _resp(409, {'error': f'Заказ {order_number} уже добавлен в другую поставку'})

    status_code, data = wb_request(
        'PATCH', f'/api/v3/supplies/{wb_supply_id}/orders/{int(wb_order_id)}', api_key, use_sandbox
    )
    if status_code not in (200, 204):
        return _resp(502, {'error': f'WB не принял заказ в поставку ({status_code}): {wb_error_text(status_code, data)}'})

    cur.execute(
        "INSERT INTO wb_supply_orders (supply_id, order_id) VALUES (%s, %s)",
        (int(supply_id), order_id),
    )
    # Первый скан переводит поставку в статус "На сборке".
    if s_status == 'Открытая':
        cur.execute("UPDATE marketplace_supplies SET status = 'На сборке' WHERE id = %s", (int(supply_id),))
    conn.commit()
    return _resp(200, {'success': True, 'orderId': order_id, 'orderNumber': order_number, 'product': product})


def handle_remove_order(cur, conn, body_data, api_key, use_sandbox):
    """Убирает ошибочно отсканированный заказ из WB FBS-поставки: удаляет сборочное задание
    из поставки на стороне WB (DELETE /api/v3/supplies/{sid}/orders/{orderId}) и снимает
    связь у нас. Заказ снова становится готовым к отгрузке. Доступно, пока поставка не
    передана в доставку."""
    supply_id = body_data.get('supplyId')
    order_id = body_data.get('orderId')
    if not supply_id or not order_id:
        return _resp(400, {'error': 'Укажите поставку и заказ'})

    cur.execute(
        "SELECT marketplace, type, status, wb_supply_id FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    s_row = cur.fetchone()
    if not s_row:
        return _resp(404, {'error': 'Поставка не найдена'})
    marketplace, supply_type, s_status, wb_supply_id = s_row
    if marketplace != 'WB' or supply_type != 'FBS':
        return _resp(400, {'error': 'Действие доступно только для поставок WB FBS'})
    if s_status not in ('Открытая', 'На сборке'):
        return _resp(409, {'error': 'Из этой поставки уже нельзя убрать заказ'})

    cur.execute(
        "SELECT o.order_number, o.wb_order_id FROM wb_supply_orders wso "
        "JOIN orders o ON o.id = wso.order_id WHERE wso.supply_id = %s AND wso.order_id = %s",
        (int(supply_id), int(order_id)),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Заказ не найден в этой поставке'})
    order_number, wb_order_id = row

    if wb_supply_id and wb_order_id:
        status_code, data = wb_request(
            'DELETE', f'/api/v3/supplies/{wb_supply_id}/orders/{int(wb_order_id)}', api_key, use_sandbox
        )
        # 404 на стороне WB (задание уже не в поставке) считаем успехом — синхронизируем нашу базу.
        if status_code not in (200, 204, 404):
            return _resp(502, {'error': f'WB не убрал заказ из поставки ({status_code}): {wb_error_text(status_code, data)}'})

    cur.execute(
        "DELETE FROM wb_supply_orders WHERE supply_id = %s AND order_id = %s",
        (int(supply_id), int(order_id)),
    )
    # Если это был последний заказ — возвращаем поставку в статус "Открытая".
    cur.execute("SELECT COUNT(*) FROM wb_supply_orders WHERE supply_id = %s", (int(supply_id),))
    if cur.fetchone()[0] == 0 and s_status == 'На сборке':
        cur.execute("UPDATE marketplace_supplies SET status = 'Открытая' WHERE id = %s", (int(supply_id),))
    conn.commit()
    return _resp(200, {'success': True, 'orderNumber': order_number})


def handle_deliver_supply(cur, conn, body_data, api_key, use_sandbox):
    """Передача поставки в доставку: закрывает поставку на WB (PATCH .../deliver),
    после чего тянет стикеры коробов trbx (PNG) и сохраняет их в нашей системе."""
    supply_id = body_data.get('supplyId')
    if not supply_id:
        return _resp(400, {'error': 'Укажите supplyId'})

    cur.execute(
        "SELECT marketplace, type, wb_supply_id FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    s_row = cur.fetchone()
    if not s_row:
        return _resp(404, {'error': 'Поставка не найдена'})
    marketplace, supply_type, wb_supply_id = s_row
    if marketplace != 'WB' or supply_type != 'FBS':
        return _resp(400, {'error': 'Действие доступно только для поставок WB FBS'})
    if not wb_supply_id:
        return _resp(409, {'error': 'Поставка не создана на стороне WB'})

    # Передаём поставку в доставку (эквивалент "отгрузить" на WB — уходит в статус "на сборке"/доставку).
    status_code, data = wb_request('PATCH', f'/api/v3/supplies/{wb_supply_id}/deliver', api_key, use_sandbox)
    if status_code not in (200, 204):
        return _resp(502, {'error': f'WB не принял поставку в доставку ({status_code}): {wb_error_text(status_code, data)}'})

    # Тянем стикеры коробов trbx этой поставки (PNG). Если коробов нет — не критично.
    stickers_saved = 0
    tr_status, tr_data = wb_request('GET', f'/api/v3/supplies/{wb_supply_id}/trbx', api_key, use_sandbox)
    trbx_ids = []
    if tr_status == 200 and isinstance(tr_data, dict):
        trbx_ids = [b.get('id') for b in (tr_data.get('trbxes') or tr_data.get('trbx') or []) if b.get('id')]

    if trbx_ids:
        st_status, st_data = wb_request(
            'POST', f'/api/v3/supplies/{wb_supply_id}/trbx/stickers?type=png',
            api_key, use_sandbox, {'trbxIds': trbx_ids},
        )
        if st_status == 200 and isinstance(st_data, dict):
            for st in (st_data.get('stickers') or []):
                trbx_id = st.get('trbxId') or st.get('id')
                b64 = (st.get('file') or st.get('image') or '')
                if not trbx_id or not b64:
                    continue
                url = upload_sticker_png(b64, str(trbx_id))
                # Стикер короба привязываем ко всем заказам этого короба (или ко всей поставке,
                # если разбиения по коробам нет — тогда trbx_id один на всё).
                cur.execute(
                    "UPDATE wb_supply_orders SET wb_trbx_id = %s, sticker_url = %s, sticker_name = %s "
                    "WHERE supply_id = %s AND (wb_trbx_id = %s OR wb_trbx_id IS NULL)",
                    (str(trbx_id), url, f'trbx-{trbx_id}', int(supply_id), str(trbx_id)),
                )
                stickers_saved += 1

    cur.execute(
        "UPDATE marketplace_supplies SET status = 'Отгрузка', "
        "ship_to_gazelka_at = COALESCE(ship_to_gazelka_at, now()), "
        "ship_to_marketplace_at = COALESCE(ship_to_marketplace_at, now()) WHERE id = %s",
        (int(supply_id),),
    )
    conn.commit()
    return _resp(200, {'success': True, 'stickersSaved': stickers_saved, 'sandbox': use_sandbox})



def get_order_sticker(cur, api_key, use_sandbox, order_number):
    """Маркетплейсный стикер WB на сборочное задание FBS.

    WB отдаёт готовый стикер по id сборочного задания. Просим формат 58×40 — ровно наша
    термонаклейка, чтобы печатать как есть. Свой штрихкод рисовать нельзя: на складе WB
    принимают только их стикер с их кодом.

    Возвращает (ошибка, base64_png).
    """
    cur.execute("SELECT wb_order_id FROM orders WHERE order_number = %s", (order_number,))
    row = cur.fetchone()
    if not row or not row[0]:
        return 'У этого заказа нет сборочного задания WB', None

    status, data = wb_request(
        'POST', '/api/v3/orders/stickers?type=png&width=58&height=40', api_key, use_sandbox,
        {'orders': [int(row[0])]},
    )
    if status != 200 or not isinstance(data, dict):
        return f'WB не отдал стикер (код {status}): {str(data)[:250]}', None
    stickers = data.get('stickers') or []
    if not stickers:
        return 'WB не вернул стикер для этого заказа', None
    return None, stickers[0].get('file')


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

    POST /  { action: 'create_supply', supplyId }
        - создаёт поставку FBS на стороне WB (POST /api/v3/supplies) для нашей поставки
          WB FBS и сохраняет её WB-идентификатор (marketplace_supplies.wb_supply_id).
    POST /  { action: 'scan_order_to_supply', supplyId, orderNumber }
        - сканирует готовый (sewing_status='Готовые') FBS-заказ WB в поставку: добавляет
          сборочное задание в WB-поставку (PATCH /supplies/{sid}/orders/{orderId}) и пишет
          связь в wb_supply_orders; первый скан переводит поставку в статус "На сборке".
    POST /  { action: 'remove_order_from_supply', supplyId, orderId }
        - убирает ошибочно отсканированный заказ из WB FBS-поставки: удаляет сборочное задание
          из поставки на WB (DELETE /supplies/{sid}/orders/{orderId}) и снимает связь у нас;
          заказ снова становится готовым к отгрузке. Доступно, пока поставка не в доставке.
    POST /  { action: 'label', orderNumber }
        - маркетплейсный стикер WB на вещь (png 58×40) в base64 — для печати на терминале
    POST /  { action: 'deliver_supply', supplyId }
        - передаёт поставку в доставку на WB (PATCH /supplies/{sid}/deliver), тянет PNG-стикеры
          коробов trbx (POST /supplies/{sid}/trbx/stickers), сохраняет их в S3 и привязывает
          к заказам поставки; переводит поставку в статус "Отгрузка".

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с результатом синхронизации
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    # Планировщики (cron-job.org и подобные) умеют дёргать только простую ссылку — GET
    # без тела запроса. Поэтому для запуска по расписанию разрешаем GET с параметрами
    # в адресе: ?action=sync_orders&cronSecret=... Ключ обязателен, иначе отказ.
    if method == 'GET':
        params = event.get('queryStringParameters') or {}
        if not params.get('cronSecret'):
            return _resp(405, {'error': 'Method not allowed'})
        body_data = dict(params)
    elif method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
    else:
        return _resp(405, {'error': 'Method not allowed'})

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

    if action not in ('sync_orders', 'create_supply', 'scan_order_to_supply',
                      'remove_order_from_supply', 'deliver_supply', 'list_warehouses',
                      'label'):
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

        if action == 'list_warehouses':
            return handle_list_warehouses(api_key)
        if action == 'create_supply':
            return handle_create_supply(cur, conn, body_data, api_key, use_sandbox)
        if action == 'scan_order_to_supply':
            return handle_scan_order(cur, conn, body_data, api_key, use_sandbox)
        if action == 'remove_order_from_supply':
            return handle_remove_order(cur, conn, body_data, api_key, use_sandbox)
        if action == 'label':
            # Маркетплейсный стикер на вещь — печатается на терминале упаковщика.
            order_number = (body_data.get('orderNumber') or '').strip()
            if not order_number:
                return _resp(400, {'error': 'Укажите номер заказа'})
            err, png_b64 = get_order_sticker(cur, api_key, use_sandbox, order_number)
            if err:
                return _resp(502, {'error': err})
            return _resp(200, {'orderNumber': order_number, 'pngBase64': png_b64})

        if action == 'deliver_supply':
            return handle_deliver_supply(cur, conn, body_data, api_key, use_sandbox)

        # action == 'sync_orders'
        status_code, data = wb_get('/api/v3/orders/new', api_key, use_sandbox)
        if status_code == 401:
            return _resp(400, {'error': 'WildBerries отклонил API-ключ (401). Проверьте ключ в настройках интеграции.'})
        if status_code != 200:
            msg = data.get('message') if isinstance(data, dict) else str(data)
            return _resp(502, {'error': f'WildBerries вернул ошибку ({status_code}): {msg}'})

        wb_orders = data.get('orders', []) if isinstance(data, dict) else []

        created = 0
        matched = 0
        skipped_existing = 0
        skipped_no_item = 0
        unmatched = []
        created_numbers = []

        for wb in wb_orders:
            wb_order_id = wb.get('id')
            if not wb_order_id:
                continue

            # Проверяем и по сборочному заданию, и по номеру заказа.
            #
            # У заказов, перенесённых из старой системы, поле wb_order_id пустое, а номер
            # заказа тот же. Проверка только по wb_order_id их не находила, загрузка
            # пыталась создать дубль и падала на уникальности номера — обрывая при этом
            # ВСЮ загрузку, а не один заказ.
            cur.execute(
                "SELECT id FROM orders WHERE wb_order_id = %s OR order_number = %s",
                (int(wb_order_id), str(wb_order_id)),
            )
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

            material, width, height, item_name, item_id = item
            product = (
                f"{material} {width}x{height}" if material and width and height else item_name
            )
            # Номер заказа для сотрудников — id сборочного задания WB (например 5425685523).
            # Именно он показан продавцу в личном кабинете WB и на стикере, по нему заказ
            # ищут в цеху. Поле rid не берём: это длинный технический код вида
            # "eAD.iba337cd...1.0", который в кабинете нигде не виден и людям ни о чём
            # не говорит.
            order_number = str(wb_order_id)

            # Время оформления заказа покупателем на WB (createdAt) — по нему считаем,
            # сколько заказ уже ждёт, а не с момента импорта в нашу систему.
            mp_created_at = wb.get('createdAt') or None

            # ON CONFLICT вместо обработки ошибки: если заказ с таким номером уже есть,
            # запись просто не создаётся. Без этого одна занятая строка обрывала всю
            # загрузку, и в систему не попадал ни один заказ.
            cur.execute(
                "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
                "quantity, source, material, width, height, wb_order_id, marketplace_created_at, "
                "marketplace_item_id) "
                "VALUES (%s, 'WB', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                (
                    order_number,
                    product,
                    material,
                    int(width) if width else None,
                    int(height) if height else None,
                    int(wb_order_id),
                    mp_created_at,
                    int(item_id) if item_id else None,
                ),
            )
            row_new = cur.fetchone()
            if not row_new:
                skipped_existing += 1
                continue
            new_id = row_new[0]
            # Такая вещь может уже лежать на полке склада (осталась от отменённого заказа) —
            # тогда шить заново не нужно, резервируем её под этот заказ.
            if match_from_stock(cur, new_id, item_id):
                matched += 1
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
            'matchedFromStock': matched,
            'skippedExisting': skipped_existing,
            'skippedNoItem': skipped_no_item,
            'totalFromWb': len(wb_orders),
            'unmatched': unmatched[:50],
            'createdNumbers': created_numbers[:50],
            'sandbox': use_sandbox,
        })
    finally:
        conn.close()