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
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'wildberries' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
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


def fetch_supply_qr(cur, api_key, use_sandbox, supply_id, wb_supply_id):
    """Забирает у WB QR-стикер самой поставки и сохраняет его как пропуск поставки.

    Это тот лист, который водитель показывает на складе WB при сдаче. Раньше система
    его не запрашивала, и после перевода поставки в доставку кладовщик видел заглушку
    «Подгрузится после подключения API» — стикер приходилось искать в кабинете WB
    вручную. Теперь он появляется сам, сразу после отгрузки.

    QR отдаётся только для поставки, уже переданной в доставку — поэтому запрашиваем
    его строго после PATCH /deliver.

    Возвращает текст ошибки, если стикер получить не удалось (или None при успехе).
    Ошибка НЕ должна отменять отгрузку: поставка на стороне WB уже закрыта, откат
    оставил бы наши данные расходиться с маркетплейсом. Стикер всегда можно
    перезапросить кнопкой.
    """
    status_code, data = wb_request(
        'GET', f'/api/v3/supplies/{wb_supply_id}/barcode?type=png', api_key, use_sandbox
    )
    if status_code != 200 or not isinstance(data, dict):
        return f'WB не отдал QR поставки ({status_code}): {wb_error_text(status_code, data)}'

    b64 = (data.get('file') or data.get('barcode') or '').strip()
    if not b64:
        return 'WB вернул пустой QR поставки'

    url = upload_sticker_png(b64, f'supply-{wb_supply_id}')
    cur.execute(
        "UPDATE marketplace_supplies SET pass_sticker_url = %s, pass_sticker_name = %s "
        "WHERE id = %s",
        (url, f'WB QR поставки {wb_supply_id}.png', int(supply_id)),
    )
    return None


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
    WB-поставку (PATCH /api/marketplace/v3/supplies/{sid}/orders) и фиксирует связь у нас."""
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

    # Ищем готовый (после стикеровки) FBS-заказ WB. Кладовщик может отсканировать как
    # номер сборочного задания, так и ШТРИХКОД С ЯРЛЫКА WB — на стикере печатается
    # именно он. Ищем сразу по обоим, чтобы человек не разбирался, что у него в руках.
    cur.execute(
        "SELECT o.id, o.wb_order_id, o.sewing_status, o.product, o.fulfilled_from_stock_id, "
        "gw.shipping_labeled_at "
        "FROM orders o "
        "LEFT JOIN goods_warehouse gw ON gw.id = o.fulfilled_from_stock_id "
        "WHERE (o.order_number = %s OR o.wb_sticker_barcode = %s) "
        "AND o.marketplace = 'WB' AND o.order_type = 'FBS'",
        (order_number, order_number),
    )
    o_row = cur.fetchone()
    if not o_row:
        return _resp(404, {'error': f'Заказ {order_number} не найден среди WB FBS заказов'})
    order_id, wb_order_id, sewing_status, product, from_stock_id, labeled_at = o_row

    # Заказ закрыт вещью с полки: шить нечего, но вещь должна быть снята с полки и
    # отстикерована — иначе в коробе её физически нет. Отстикерованную принимаем,
    # хотя её статус так и остаётся «Со склада».
    if from_stock_id:
        if not labeled_at:
            return _resp(409, {
                'error': f'Заказ {order_number}: вещь ещё на полке. Соберите и отстикеруйте '
                         f'её в разделе «Сборка товара с полок»'
            })
    elif sewing_status != 'Готовые':
        return _resp(409, {'error': f'Заказ {order_number} ещё не готов (статус: {sewing_status})'})
    if not wb_order_id:
        return _resp(409, {'error': f'У заказа {order_number} нет идентификатора сборочного задания WB'})

    # Вещь могла уже лежать в накопительном буфере (упаковщица отстикеровала). Тогда
    # сканирование — это перенос в сборку кладовщика, а не ошибка. Из чужой РУЧНОЙ
    # сборки заказ забирать нельзя: там его собирает другой человек.
    # Смотрим только на ЖИВЫЕ поставки. Привязка к уже закрытой (отгруженной) поставке
    # — это хвост, из-за которого кладовщик получал «уже добавлен в другую поставку»
    # на вещь, лежащую у него в руках, и собрать её было нельзя.
    cur.execute(
        "SELECT wso.supply_id, COALESCE(s.is_accumulator, false) "
        "FROM wb_supply_orders wso "
        "JOIN marketplace_supplies s ON s.id = wso.supply_id "
        "WHERE wso.order_id = %s "
        "  AND s.status IN ('Открытая', 'На сборке', 'Отгрузка')",
        (order_id,),
    )
    ex = cur.fetchone()
    move_from_accumulator = False
    if ex:
        if ex[0] == int(supply_id):
            return _resp(409, {'error': f'Заказ {order_number} уже в этой поставке'})
        if not ex[1]:
            return _resp(409, {'error': f'Заказ {order_number} уже добавлен в другую поставку'})
        move_from_accumulator = True
    else:
        # Хвост от закрытой поставки убираем, иначе он не даст создать новую связь.
        cur.execute(
            "DELETE FROM wb_supply_orders w USING marketplace_supplies s "
            "WHERE s.id = w.supply_id AND w.order_id = %s "
            "  AND s.status NOT IN ('Открытая', 'На сборке', 'Отгрузка')",
            (order_id,),
        )

    status_code, data = wb_add_orders_to_supply(
        api_key, use_sandbox, wb_supply_id, [wb_order_id]
    )
    if status_code not in (200, 204):
        return _resp(502, {'error': f'WB не принял заказ в поставку ({status_code}): {wb_error_text(status_code, data)}'})

    if move_from_accumulator:
        # WB сам вынул задание из прежней поставки — у себя просто переставляем связь.
        cur.execute(
            "UPDATE wb_supply_orders SET supply_id = %s WHERE order_id = %s",
            (int(supply_id), order_id),
        )
        _cleanup_empty_accumulator(cur, ex[0])
    else:
        cur.execute(
            "INSERT INTO wb_supply_orders (supply_id, order_id) VALUES (%s, %s)",
            (int(supply_id), order_id),
        )
    # Первый скан переводит поставку в статус "На сборке".
    if s_status == 'Открытая':
        cur.execute("UPDATE marketplace_supplies SET status = 'На сборке' WHERE id = %s", (int(supply_id),))
    conn.commit()
    return _resp(200, {'success': True, 'orderId': order_id, 'orderNumber': order_number, 'product': product})


def _cleanup_empty_accumulator(cur, supply_id):
    """Удаляет накопительный буфер, из которого забрали всё. Пустой буфер в базе не нужен —
    при следующей стикеровке создастся новый."""
    cur.execute("SELECT COUNT(*) FROM wb_supply_orders WHERE supply_id = %s", (supply_id,))
    if cur.fetchone()[0] == 0:
        cur.execute(
            "DELETE FROM marketplace_supplies WHERE id = %s AND is_accumulator = true "
            "AND status IN ('Открытая', 'На сборке')",
            (supply_id,),
        )


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

    # ЗАКАЗ ВОЗВРАЩАЕМ В НАКОПИТЕЛЬ, А НЕ УДАЛЯЕМ СОВСЕМ.
    #
    # Кладовщик убирает заказ из поставки, когда вещь не влезла в короб: он закрывает
    # эту поставку и создаёт следующую. Вещь при этом никуда не делась — она лежит у
    # него застикерованная и ждёт следующей поездки.
    #
    # Раньше связь просто удалялась, и заказ пропадал отовсюду: счётчик кладовщика
    # считает заказы в накопителе, а этот заказ не был уже ни в одной поставке. В новой
    # поставке вещь не показывалась, и найти её можно было только вручную по складу.
    #
    # Поэтому переставляем связь обратно в накопительный буфер — туда же, откуда заказ
    # попал в сборку. Если буфера нет (его удалили как пустой), заводим новый.
    err, acc_id, acc_wb_id = ensure_open_supply(cur, conn, api_key, use_sandbox)
    if err or not acc_id:
        # Накопитель недоступен (WB не ответил) — тогда честно сообщаем и НЕ убираем
        # заказ: молча потерять его из всех списков хуже, чем не выполнить действие.
        return _resp(502, {'error': err or 'Не удалось вернуть заказ в очередь на отгрузку'})

    # На стороне WB задание тоже должно лежать в накопительной поставке, иначе при
    # следующем сканировании WB ответит отказом: у нас связь есть, а у него задание
    # ничьё. Сбой здесь не критичен — у нас заказ уже виден кладовщику, а WB примет
    # его в поставку при сканировании.
    if acc_wb_id and wb_order_id:
        wb_add_orders_to_supply(api_key, use_sandbox, acc_wb_id, [wb_order_id])

    cur.execute(
        "UPDATE wb_supply_orders SET supply_id = %s WHERE supply_id = %s AND order_id = %s",
        (int(acc_id), int(supply_id), int(order_id)),
    )
    # Если это был последний заказ — возвращаем поставку в статус "Открытая".
    cur.execute("SELECT COUNT(*) FROM wb_supply_orders WHERE supply_id = %s", (int(supply_id),))
    if cur.fetchone()[0] == 0 and s_status == 'На сборке':
        cur.execute("UPDATE marketplace_supplies SET status = 'Открытая' WHERE id = %s", (int(supply_id),))
    conn.commit()
    return _resp(200, {'success': True, 'orderNumber': order_number})


def _close_finished_supplies(cur, conn, api_key, use_sandbox):
    """Закрывает у нас поставки, которые уже закрыты (отгружены) на стороне WB.

    Кладовщик закрывает поставку — короб уезжает на маркетплейс. WB переводит её
    заказы в «выполнено» и больше НЕ ПОЗВОЛЯЕТ класть их в другую поставку: на
    попытку отвечает отказом 409. Это правильно — вещь уже уехала.

    Раньше такие заказы у нас навсегда оставались в статусе «Новый», привязанные к
    закрытой поставке: счётчик кладовщика показывал ноль, и было непонятно, где они.
    Теперь помечаем их отгруженными, а поставку — выполненной, как и на WB.

    ВАЖНО: возвращать эти заказы в очередь нельзя. Пробовали — WB отвечает отказом
    на каждое сканирование, потому что для него заказ уже отгружен.

    Возвращает количество закрытых заказов.
    """
    cur.execute(
        "SELECT s.id, s.wb_supply_id FROM marketplace_supplies s "
        "WHERE s.marketplace = 'WB' AND s.type = 'FBS' "
        "  AND COALESCE(s.is_accumulator, false) = false "
        "  AND s.status IN ('Открытая', 'На сборке', 'Отгрузка') "
        "  AND s.wb_supply_id IS NOT NULL "
        "  AND EXISTS (SELECT 1 FROM wb_supply_orders w WHERE w.supply_id = s.id)"
    )
    closed_orders = 0

    for supply_id, wb_supply_id in cur.fetchall():
        sc, data = wb_request('GET', f'/api/v3/supplies/{wb_supply_id}', api_key, use_sandbox)
        if sc != 200 or not isinstance(data, dict) or not data.get('done'):
            continue

        cur.execute(
            "UPDATE orders SET status = 'Отгружен', "
            "  completed_at = COALESCE(completed_at, now()) "
            "WHERE id IN (SELECT order_id FROM wb_supply_orders WHERE supply_id = %s) "
            "  AND status NOT IN ('Отгружен', 'Отменён') "
            "RETURNING id",
            (int(supply_id),),
        )
        ids = [r[0] for r in cur.fetchall()]
        closed_orders += len(ids)

        # Вещи уехали — со склада их снимаем, иначе кладовщик ищет на полках то,
        # чего там уже нет.
        if ids:
            ids_csv = ','.join(str(int(i)) for i in ids)
            cur.execute(
                f"UPDATE goods_warehouse SET status = 'shipped', shipped_at = now() "
                f"WHERE status <> 'shipped' "
                f"  AND (reserved_order_id IN ({ids_csv}) OR order_id IN ({ids_csv}))"
            )

        cur.execute(
            "UPDATE marketplace_supplies SET status = 'Выполнена', "
            "  completed_at = COALESCE(completed_at, now()) WHERE id = %s",
            (int(supply_id),),
        )

    return closed_orders


def handle_check_statuses(cur, conn, api_key, use_sandbox, actor_id=None, actor_name=None):
    """Сверяет статусы наших готовых FBS-заказов с WB.

    В счётчике копились заказы, которые на стороне WB давно уехали или отменены —
    у нас они так и висели «Готовые». Спрашиваем WB напрямую и приводим наши данные
    в порядок: уехавшие закрываем, отменённые помечаем отменой.
    """
    cur.execute(
        "SELECT id, wb_order_id, order_number FROM orders "
        "WHERE marketplace = 'WB' AND order_type = 'FBS' "
        # «Со склада» — заказ закрыт вещью с полки. Такие проверять НУЖНО так же, как
        # сшитые: их задание могло закрыться у WB, и тогда вещь висит в подборе мёртвым
        # грузом — кладовщик идёт к стеллажу и упирается в ошибку печати стикера.
        # Проверяем и то, что ЕЩЁ ШЬЁТСЯ. Раньше в проверку попадали только готовые
        # вещи, и отмену покупателя система узнавала лишь на стикеровке: упаковщица
        # доводила заказ до конца и упиралась в отказ WB. Теперь отмена видна сразу,
        # и «Новый» заказ снимается с конвейера до того, как его начнут кроить.
        "AND sewing_status IN ('Новый', 'На раскрое', 'Раскроено', 'В работе', "
        "                      'Стикеровка', 'Готовые', 'Со склада') "
        "AND wb_order_id IS NOT NULL "
        "AND status <> 'Отгружен' "
        # Заказы, лежащие в НАКОПИТЕЛЕ, тоже проверяем. Раньше проверка пропускала
        # всё, что попало в любую поставку, — а накопитель это и есть поставка.
        # В итоге вещи, которые физически уже уехали на WB, годами висели в счётчике
        # «Готово к сборке»: кладовщик видел 27 штук, а на полках их не было.
        # Заказы в РЕАЛЬНОЙ поставке кладовщика не трогаем: он их сейчас собирает.
        #
        # ВАЖНО — только пока поставка ЖИВА. Раньше условие смотрело на любую поставку,
        # и заказ, привязанный к уже ЗАКРЫТОЙ поставке, выпадал из проверки навсегда:
        # статус у WB никто не спрашивал, в новую поставку он не добавлялся, в счётчике
        # не показывался. Так 117 заказов зависли в статусе «Новый» — они и есть та
        # самая «поставка не пополняется».
        "AND NOT EXISTS ("
        "  SELECT 1 FROM wb_supply_orders w "
        "  JOIN marketplace_supplies s ON s.id = w.supply_id "
        "  WHERE w.order_id = orders.id AND COALESCE(s.is_accumulator, false) = false "
        "    AND s.status IN ('Открытая', 'На сборке', 'Отгрузка')"
        ")"
    )
    # ВАЖНО: список забираем СРАЗУ. Ниже вызывается _close_finished_supplies, который
    # делает свои запросы тем же курсором и затирает результат этого. Раньше строки
    # читались после него — и сверка всегда получала пустой список: сколько бы заказов
    # ни зависло, в ответе стояло «проверено 0», и проблема оставалась невидимой.
    rows = cur.fetchall()

    # Затем закрываем поставки, которые уже уехали по данным WB: их заказы должны
    # стать отгруженными, а не висеть в системе непонятно где.
    released_stuck = _close_finished_supplies(cur, conn, api_key, use_sandbox)
    if not rows:
        conn.commit()
        return _resp(200, {'checked': 0, 'closed': 0, 'cancelled': 0,
                           'closedShipped': released_stuck, 'statuses': {}})

    ids = [int(r[1]) for r in rows]
    status_code, data = wb_request(
        'POST', '/api/v3/orders/status', api_key, use_sandbox, {'orders': ids}
    )
    if status_code != 200:
        return _resp(502, {
            'error': f'WB не отдал статусы ({status_code}): {wb_error_text(status_code, data)}'
        })

    by_id = {}
    for o in (data or {}).get('orders') or []:
        by_id[int(o.get('id') or 0)] = {
            'supplier': (o.get('supplierStatus') or '').strip(),
            'wb': (o.get('wbStatus') or '').strip(),
        }

    stats = {}
    closed, cancelled = 0, 0
    # Сколько заказов освободили от привязки к закрытым поставкам.
    released_links = 0
    for order_id, wb_order_id, number in rows:
        st = by_id.get(int(wb_order_id))
        if not st:
            continue
        key = f"{st['supplier']}/{st['wb']}"
        stats[key] = stats.get(key, 0) + 1

        # Отменён покупателем или WB: шить/везти нечего, из очереди убираем.
        if st['supplier'] == 'cancel' or st['wb'] in ('canceled', 'canceled_by_client', 'declined_by_client'):
            # Заказ ЕЩЁ НЕ ВЗЯЛИ в работу — снимаем с конвейера полностью. Ткань цела,
            # труд не потрачен: шить отменённое незачем.
            #
            # Заказ УЖЕ В РАБОТЕ (кроят, шьют, стикеруют) с конвейера НЕ снимаем:
            # материал раскроен, за работу людям платить. Вещь дойдёт до конца, но
            # уедет не покупателю, а на склад — упаковщица наклеит на неё стикер
            # ХРАНЕНИЯ вместо ярлыка отправления, и кладовщик разложит её по полкам.
            # Терминал сам покажет это упаковщице: заказ помечен как отменённый.
            cur.execute(
                "UPDATE orders SET status = 'Отменён', "
                "  cancelled_at = COALESCE(cancelled_at, now()), "
                "  sewing_status = CASE WHEN sewing_status = 'Новый' "
                "                       THEN 'Отменён' ELSE sewing_status END, "
                "  assigned_user_id = CASE WHEN sewing_status = 'Новый' "
                "                          THEN NULL ELSE assigned_user_id END "
                "WHERE id = %s",
                (order_id,),
            )
            _drop_from_accumulator(cur, order_id)
            cancelled += 1
        # Заказ ЖИВ и ждёт отправки, а привязка к закрытой поставке за ним осталась —
        # именно она мешала положить его в новую поставку. Снимаем хвост, чтобы вещь
        # вернулась в работу: при следующей стикеровке она попадёт в актуальную поставку.
        elif st['supplier'] in ('new', 'confirm') and st['wb'] not in (
            'sold', 'sorted', 'ready_for_pickup', 'received'
        ):
            cur.execute(
                "DELETE FROM wb_supply_orders w USING marketplace_supplies s "
                "WHERE s.id = w.supply_id AND w.order_id = %s "
                "  AND s.status NOT IN ('Открытая', 'На сборке', 'Отгрузка')",
                (order_id,),
            )
            released_links += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        # Уже уехал: на WB отправление собрано и передано — у нас тоже закрываем.
        elif st['wb'] in ('sold', 'sorted', 'ready_for_pickup', 'received') or st['supplier'] == 'complete':
            cur.execute(
                "UPDATE orders SET status = 'Отгружен', completed_at = COALESCE(completed_at, now()) "
                "WHERE id = %s",
                (order_id,),
            )
            # Вещь физически уехала — из буфера «Готово к сборке» она должна исчезнуть,
            # иначе кладовщик ищет на полках то, чего там уже нет.
            _drop_from_accumulator(cur, order_id)
            closed += 1

    # Отмечаем запуск в журнале: по нему страница «Планировщик» показывает админу,
    # когда задание отработало последний раз и что нашло. Без этой записи молчащий
    # планировщик неотличим от работающего.
    log_action(
        cur, actor_id, actor_name, 'wb_check_statuses', None,
        f'Проверка статусов WB FBS: проверено {len(rows)}, '
        f'отменено {cancelled}, закрыто отгруженных {closed}, '
        f'закрыто отгруженных поставок: заказов {released_stuck}, '
        f'освобождено из закрытых поставок {released_links}',
    )
    conn.commit()
    return _resp(200, {
        'checked': len(rows), 'closed': closed, 'cancelled': cancelled,
        'closedShipped': released_stuck, 'releasedLinks': released_links,
        'statuses': stats,
    })


def _drop_from_accumulator(cur, order_id):
    """Убирает заказ из накопительного буфера «Готово к сборке».

    Буфер показывает, что лежит в контейнере на производстве и ждёт кладовщика.
    Уехавшая или отменённая вещь там висеть не должна: кладовщик идёт к полкам
    за товаром, которого нет, и не понимает, куда он делся.

    Складскую запись при этом помечаем отгруженной — вещь покинула склад.
    """
    cur.execute(
        "DELETE FROM wb_supply_orders w USING marketplace_supplies s "
        "WHERE w.supply_id = s.id AND w.order_id = %s "
        "AND COALESCE(s.is_accumulator, false) = true",
        (int(order_id),),
    )
    cur.execute(
        "UPDATE goods_warehouse SET status = 'shipped', shipped_at = COALESCE(shipped_at, now()) "
        "WHERE (order_id = %s OR reserved_order_id = %s) "
        "AND status IN ('picking', 'awaiting_supply')",
        (int(order_id), int(order_id)),
    )


def handle_list_pending(cur, body_data):
    """Заказы, накопленные в свободных поставках WB FBS.

    Кладовщик создал свою поставку и должен видеть, что уже собрано упаковщицами:
    список вещей с номером заказа и товаром, чтобы отметить нужные и забрать к себе.
    Заказы из своей же поставки в список не попадают — переносить их некуда.
    """
    supply_id = body_data.get('supplyId')

    exclude = f"AND wso.supply_id <> {int(supply_id)}" if supply_id else ""
    cur.execute(
        "SELECT wso.order_id, o.order_number, o.product, o.material, o.width, o.height, "
        "wso.supply_id, s.supply_number "
        "FROM wb_supply_orders wso "
        "JOIN orders o ON o.id = wso.order_id "
        "JOIN marketplace_supplies s ON s.id = wso.supply_id "
        "WHERE s.marketplace = 'WB' AND s.type = 'FBS' AND s.is_accumulator = true "
        f"AND s.status IN ('Открытая', 'На сборке') {exclude} "
        "ORDER BY wso.order_id DESC"
    )
    orders = [
        {
            'orderId': r[0],
            'orderNumber': r[1],
            'product': r[2],
            'material': r[3],
            'width': float(r[4]) if r[4] is not None else None,
            'height': float(r[5]) if r[5] is not None else None,
            'fromSupplyId': r[6],
            'fromSupplyNumber': r[7],
        }
        for r in cur.fetchall()
    ]
    return _resp(200, {'orders': orders, 'count': len(orders)})


def handle_move_orders(cur, conn, body_data, api_key, use_sandbox):
    """Переносит выбранные заказы из накопительной поставки в поставку кладовщика.

    На стороне WB заказ просто добавляется в новую поставку — WB сам убирает его из
    прежней. У себя переставляем связь. Опустевшую накопительную поставку удаляем,
    чтобы она не мозолила глаза в списке.
    """
    supply_id = body_data.get('supplyId')
    order_ids = body_data.get('orderIds') or []
    if not supply_id or not order_ids:
        return _resp(400, {'error': 'Укажите поставку и заказы'})

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

    moved, errors = 0, []
    touched_supplies = set()

    for oid in order_ids:
        cur.execute(
            "SELECT o.order_number, o.wb_order_id, wso.supply_id FROM orders o "
            "LEFT JOIN wb_supply_orders wso ON wso.order_id = o.id WHERE o.id = %s",
            (int(oid),),
        )
        row = cur.fetchone()
        if not row or not row[1]:
            errors.append(f'Заказ #{oid}: нет сборочного задания WB')
            continue
        order_number, wb_order_id, from_supply_id = row
        if from_supply_id == int(supply_id):
            continue

        status_code, data = wb_add_orders_to_supply(
            api_key, use_sandbox, wb_supply_id, [wb_order_id]
        )
        if status_code not in (200, 204):
            errors.append(f'{order_number}: {wb_error_text(status_code, data)}')
            continue

        if from_supply_id:
            touched_supplies.add(from_supply_id)
            cur.execute(
                "UPDATE wb_supply_orders SET supply_id = %s WHERE order_id = %s",
                (int(supply_id), int(oid)),
            )
        else:
            cur.execute(
                "INSERT INTO wb_supply_orders (supply_id, order_id) VALUES (%s, %s)",
                (int(supply_id), int(oid)),
            )
        moved += 1

    if moved:
        cur.execute(
            "UPDATE marketplace_supplies SET status = 'На сборке' "
            "WHERE id = %s AND status = 'Открытая'",
            (int(supply_id),),
        )
        # Накопительные поставки, из которых всё забрали, убираем из списка.
        for sid in touched_supplies:
            cur.execute("SELECT COUNT(*) FROM wb_supply_orders WHERE supply_id = %s", (sid,))
            if cur.fetchone()[0] == 0:
                cur.execute(
                    "DELETE FROM marketplace_supplies WHERE id = %s "
                    "AND marketplace = 'WB' AND type = 'FBS' "
                    "AND status IN ('Открытая', 'На сборке')",
                    (sid,),
                )
    conn.commit()
    return _resp(200, {'moved': moved, 'errors': errors})


def _next_storage_barcode(cur) -> str:
    """Следующий штрихкод хранения вида GW-000001."""
    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE storage_barcode LIKE 'GW-%'")
    max_seq = 0
    for (bc,) in cur.fetchall():
        suffix = bc.split('-', 1)[1] if '-' in bc else ''
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return f"GW-{max_seq + 1:06d}"


def handle_shelf_cancelled(cur, conn, body_data, api_key, use_sandbox):
    """Отменённый заказ из сборки — на полку склада.

    Покупатель отказался, пока вещь ехала в короб. Везти её на маркетплейс нельзя:
    кладовщик убирает вещь из поставки прямо здесь, она уходит на хранение и ждёт
    нового покупателя. На стороне WB задание из поставки тоже убирается, иначе
    маркетплейс будет ждать посылку, которой не будет.
    """
    supply_id = body_data.get('supplyId')
    order_id = body_data.get('orderId')
    if not supply_id or not order_id:
        return _resp(400, {'error': 'Укажите поставку и заказ'})

    cur.execute(
        "SELECT wb_supply_id, status FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    s_row = cur.fetchone()
    if not s_row:
        return _resp(404, {'error': 'Поставка не найдена'})
    wb_supply_id, s_status = s_row
    if s_status not in ('Открытая', 'На сборке'):
        return _resp(409, {'error': 'Поставка уже передана в доставку — вещь из неё не убрать'})

    cur.execute(
        "SELECT o.order_number, o.wb_order_id, o.status "
        "FROM wb_supply_orders wso JOIN orders o ON o.id = wso.order_id "
        "WHERE wso.supply_id = %s AND wso.order_id = %s",
        (int(supply_id), int(order_id)),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Заказ не найден в этой поставке'})
    order_number, wb_order_id, order_status = row

    # Снимаем задание с поставки на стороне WB. 404 считаем успехом: значит его
    # там уже нет, и наша база просто догоняет маркетплейс.
    if wb_supply_id and wb_order_id:
        status_code, data = wb_request(
            'DELETE', f'/api/v3/supplies/{wb_supply_id}/orders/{int(wb_order_id)}',
            api_key, use_sandbox,
        )
        if status_code not in (200, 204, 404):
            return _resp(502, {
                'error': f'WB не убрал заказ из поставки ({status_code}): '
                         f'{wb_error_text(status_code, data)}'
            })

    cur.execute(
        "DELETE FROM wb_supply_orders WHERE supply_id = %s AND order_id = %s",
        (int(supply_id), int(order_id)),
    )

    # Заводим вещь на складе. Если она там уже есть (например, приходила раньше) —
    # используем прежний штрихкод, чтобы не плодить наклейки на одну вещь.
    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE order_id = %s", (int(order_id),))
    gw = cur.fetchone()
    if gw:
        storage_barcode = gw[0]
        cur.execute(
            "UPDATE goods_warehouse SET status = 'awaiting_shelf', reserved_order_id = NULL "
            "WHERE order_id = %s",
            (int(order_id),),
        )
    else:
        storage_barcode = _next_storage_barcode(cur)
        cur.execute(
            "INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
            "VALUES (%s, 'awaiting_shelf', %s, 'cancelled')",
            (int(order_id), storage_barcode),
        )

    cur.execute("UPDATE orders SET status = 'Отменён' WHERE id = %s", (int(order_id),))

    cur.execute("SELECT COUNT(*) FROM wb_supply_orders WHERE supply_id = %s", (int(supply_id),))
    if cur.fetchone()[0] == 0 and s_status == 'На сборке':
        cur.execute(
            "UPDATE marketplace_supplies SET status = 'Открытая' WHERE id = %s",
            (int(supply_id),),
        )
    conn.commit()
    return _resp(200, {
        'success': True, 'orderNumber': order_number, 'storageBarcode': storage_barcode,
    })


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

    # QR самой поставки — тот лист, который водитель показывает на складе WB.
    # Запрашиваем ПОСЛЕ /deliver: до передачи в доставку WB его не отдаёт.
    qr_warning = fetch_supply_qr(cur, api_key, use_sandbox, supply_id, wb_supply_id)

    cur.execute(
        "UPDATE marketplace_supplies SET status = 'Отгрузка', "
        "ship_to_gazelka_at = COALESCE(ship_to_gazelka_at, now()), "
        "ship_to_marketplace_at = COALESCE(ship_to_marketplace_at, now()) WHERE id = %s",
        (int(supply_id),),
    )
    conn.commit()
    return _resp(200, {
        'success': True,
        'stickersSaved': stickers_saved,
        'qrWarning': qr_warning,
        'sandbox': use_sandbox,
    })


def handle_supply_qr(cur, conn, body_data, api_key, use_sandbox):
    """Повторно запрашивает QR поставки у WB — кнопкой, если при отгрузке он не пришёл.

    WB иногда отвечает не сразу: поставка уже в доставке, а стикер ещё не готов.
    Чтобы кладовщик не лез в кабинет маркетплейса, даём ему кнопку «Загрузить стикер».
    """
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

    err = fetch_supply_qr(cur, api_key, use_sandbox, supply_id, wb_supply_id)
    if err:
        return _resp(502, {'error': err})
    conn.commit()

    cur.execute(
        "SELECT pass_sticker_url, pass_sticker_name FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    row = cur.fetchone()
    return _resp(200, {
        'success': True,
        'passStickerUrl': row[0] if row else None,
        'passStickerName': row[1] if row else None,
    })



def drop_stale_accumulator(cur, conn, api_key, use_sandbox):
    """Закрывает накопительную поставку WB, которой на стороне маркетплейса больше нет.

    Заказы копятся в одной служебной поставке, и стикер WB рисует только для задания,
    которое в ней лежит. Если поставку отгрузили или удалили в кабинете WB, наша запись
    остаётся «Открытой» — и печать стикеров ломается разом для ВСЕХ заказов WB.
    Раньше это вскрывалось только в момент печати: упаковщица упиралась в ошибку и
    вставала. Проверяем заранее, при загрузке заказов.

    Возвращает True, если устаревшую поставку пришлось закрыть.
    """
    cur.execute(
        "SELECT id, wb_supply_id FROM marketplace_supplies "
        "WHERE marketplace = 'WB' AND type = 'FBS' AND is_accumulator = true "
        "AND status IN ('Открытая', 'На сборке') AND wb_supply_id IS NOT NULL "
        "ORDER BY id DESC LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        return False
    supply_id, wb_supply_id = row

    status_code, data = wb_request(
        'GET', f'/api/v3/supplies/{wb_supply_id}', api_key, use_sandbox
    )
    # 404 — поставки у WB нет вовсе. done=true — она уже отгружена, докладывать нельзя.
    gone = status_code == 404
    if status_code == 200 and isinstance(data, dict) and data.get('done'):
        gone = True
    if not gone:
        return False

    cur.execute(
        "UPDATE marketplace_supplies SET status = 'Выполнена', "
        "comment = COALESCE(comment, '') || ' · Закрыта на стороне WB' "
        "WHERE id = %s",
        (supply_id,),
    )
    conn.commit()
    return True


def ensure_open_supply(cur, conn, api_key, use_sandbox):
    """Находит свободную поставку WB FBS, а если её нет — заводит новую.

    Упаковщица печатает стикеры весь день и не должна думать о поставках. Поэтому
    заказы копятся в одной «свободной» поставке: она открыта, ещё не уехала в доставку
    и в неё можно докладывать. Кладовщик потом видит накопленный счётчик и решает,
    что забрать в свою поставку.

    Поставка создаётся сразу и у нас, и на стороне WB: WB не принимает заказы в
    поставку, которой у него нет.

    Возвращает (ошибка, supply_id, wb_supply_id).
    """
    # Берём ИМЕННО накопительную (служебную) поставку. Сборку кладовщика трогать нельзя:
    # он собирает её руками, сканируя стикеры, и чужие вещи туда падать не должны.
    cur.execute(
        "SELECT id, wb_supply_id FROM marketplace_supplies "
        "WHERE marketplace = 'WB' AND type = 'FBS' AND is_accumulator = true "
        "AND status IN ('Открытая', 'На сборке') "
        "ORDER BY id DESC LIMIT 1"
    )
    row = cur.fetchone()
    supply_id = row[0] if row else None
    wb_supply_id = row[1] if row else None

    if not supply_id:
        cur.execute(
            "INSERT INTO marketplace_supplies (marketplace, type, status, comment, is_accumulator) "
            "VALUES ('WB', 'FBS', 'Открытая', %s, true) RETURNING id",
            ('Накопительная поставка: заказы добавляются при стикеровке',),
        )
        supply_id = cur.fetchone()[0]

    if not wb_supply_id:
        name = f'Поставка #{supply_id}'[:128]
        status_code, data = wb_request(
            'POST', '/api/v3/supplies', api_key, use_sandbox, {'name': name}
        )
        if status_code not in (200, 201):
            return (
                f'WB не создал поставку ({status_code}): '
                f'{wb_error_text(status_code, data)}'
            ), None, None
        wb_supply_id = data.get('id') if isinstance(data, dict) else None
        if not wb_supply_id:
            return 'WB не вернул идентификатор поставки', None, None
        cur.execute(
            "UPDATE marketplace_supplies SET wb_supply_id = %s WHERE id = %s",
            (wb_supply_id, supply_id),
        )
        conn.commit()

    return None, supply_id, wb_supply_id


def wb_add_orders_to_supply(api_key, use_sandbox, wb_supply_id, wb_order_ids):
    """Кладёт сборочные задания в поставку на стороне WB.

    ВАЖНО ПРО АДРЕС. Раньше задание добавлялось по одному:
    PATCH /api/v3/supplies/{supplyId}/orders/{orderId}. Wildberries этот адрес
    отключил — на него приходит 404 «path not found», и печать стикеров встала
    целиком: WB рисует ярлык только для задания, лежащего в поставке. Действующий
    метод принимает СПИСОК заданий телом запроса:
    PATCH /api/marketplace/v3/supplies/{supplyId}/orders  {"orders": [id, ...]}

    Возвращает (status_code, data). Успех — 200 или 204.
    """
    return wb_request(
        'PATCH', f'/api/marketplace/v3/supplies/{wb_supply_id}/orders',
        api_key, use_sandbox, {'orders': [int(i) for i in wb_order_ids]},
    )


def add_order_to_open_supply(cur, conn, api_key, use_sandbox, order_number):
    """Кладёт заказ в свободную поставку WB при печати стикера.

    Раньше готовый заказ просто ждал, пока кладовщик отсканирует его в поставку вручную.
    Теперь он попадает туда сразу при печати — сканировать каждую вещь повторно не нужно.

    Ошибки здесь не должны срывать печать: стикер важнее. Возвращает текст проблемы
    (или None), а печать идёт в любом случае.
    """
    cur.execute(
        "SELECT o.id, o.wb_order_id, o.sewing_status, o.fulfilled_from_stock_id "
        "FROM orders o "
        "WHERE o.order_number = %s AND o.marketplace = 'WB' AND o.order_type = 'FBS'",
        (order_number,),
    )
    o_row = cur.fetchone()
    if not o_row or not o_row[1]:
        return 'У заказа нет сборочного задания WB'
    order_id, wb_order_id, sewing_status, from_stock_id = o_row

    # ЗДЕСЬ НЕЛЬЗЯ ТРЕБОВАТЬ ОТМЕТКУ О СТИКЕРОВКЕ. Раньше стояла проверка «вещь ещё
    # лежит на полке — соберите и отстикеруйте её», и вещи со склада вообще нельзя
    # было отправить: отметка о стикеровке ставится ПОСЛЕ успешной печати ярлыка, а
    # ярлык WB рисует только для задания, лежащего в поставке. Круг замыкался —
    # кладовщик стоял у стеллажа с вещью в руках, жал «Печать» и получал совет пойти
    # отстикеровать её в том самом разделе, где он уже находится.
    # Печать ярлыка и ЕСТЬ момент сборки вещи с полки, поэтому в поставку пускаем.
    # Реальная защита от «вещи нет в коробе» стоит на сканировании заказа в поставку
    # (handle_scan_order) — там вещь уже должна быть отстикерована.

    # Заказ уже лежит в ЖИВОЙ поставке — второй раз не добавляем.
    #
    # Раньше проверка была «лежит в любой поставке», и этого хватало, чтобы заказ
    # застрял навсегда: поставку закрыли и отгрузили, а привязка осталась. При печати
    # стикера мы видели связь, считали работу сделанной и выходили — заказ не попадал
    # ни в новую поставку, ни в счётчик кладовщика. Смотрим только на поставки,
    # в которые ещё можно докладывать.
    cur.execute(
        "SELECT w.supply_id FROM wb_supply_orders w "
        "JOIN marketplace_supplies s ON s.id = w.supply_id "
        "WHERE w.order_id = %s AND s.status IN ('Открытая', 'На сборке', 'Отгрузка')",
        (order_id,),
    )
    if cur.fetchone():
        return None

    # Привязка к уже закрытой поставке осталась «хвостом»: она мешает добавить заказ
    # заново (в таблице стоит уникальность по заказу). Убираем — сам заказ при этом
    # не трогаем, ниже он ляжет в актуальную поставку.
    cur.execute(
        "DELETE FROM wb_supply_orders w USING marketplace_supplies s "
        "WHERE s.id = w.supply_id AND w.order_id = %s "
        "  AND s.status NOT IN ('Открытая', 'На сборке', 'Отгрузка')",
        (order_id,),
    )

    err, supply_id, wb_supply_id = ensure_open_supply(cur, conn, api_key, use_sandbox)
    if err:
        return err

    status_code, data = wb_add_orders_to_supply(
        api_key, use_sandbox, wb_supply_id, [wb_order_id]
    )

    # 404 у WB означает две РАЗНЫЕ вещи: «нет такой поставки» и «нет такого задания».
    # Раньше мы считали, что виновата поставка, и на каждую печать закрывали её и
    # заводили новую. За один день так наплодилось восемь пустых поставок в кабинете
    # WB, а стикер всё равно не печатался — настоящая причина была в задании.
    # Поэтому сначала спрашиваем WB напрямую, жива ли поставка.
    supply_alive = None
    if status_code == 404:
        chk_code, _ = wb_request(
            'GET', f'/api/v3/supplies/{wb_supply_id}', api_key, use_sandbox
        )
        supply_alive = chk_code == 200

    # Поставки на стороне WB действительно нет: её закрыли, отгрузили или удалили в
    # кабинете. Наша запись при этом осталась «Открытой», и все стикеры переставали
    # печататься: WB рисует ярлык только для задания, лежащего в поставке. Закрываем
    # устаревшую запись, заводим новую и добавляем заказ в неё — кладовщик просто
    # печатает ярлык и ничего об этом не знает.
    if status_code == 404 and supply_alive is False:
        cur.execute(
            "UPDATE marketplace_supplies SET status = 'Выполнена', "
            "comment = COALESCE(comment, '') || ' · Закрыта на стороне WB' "
            "WHERE id = %s",
            (supply_id,),
        )
        conn.commit()
        err, supply_id, wb_supply_id = ensure_open_supply(cur, conn, api_key, use_sandbox)
        if err:
            return err
        status_code, data = wb_add_orders_to_supply(
            api_key, use_sandbox, wb_supply_id, [wb_order_id]
        )

    if status_code == 404:
        # Поставка жива (или мы её только что пересоздали), а WB всё равно отвечает
        # 404 — значит дело в самом задании: на стороне WB его уже нет в работе.
        # Чаще всего оно лежит в другой, уже отгруженной поставке либо было закрыто
        # в кабинете. Стикер для него WB больше не рисует.
        return (
            f'Wildberries не находит сборочное задание {wb_order_id}: оно закрыто или '
            'лежит в другой поставке на стороне WB. Стикер для него больше не '
            'печатается — проверьте заказ в кабинете WB'
        )
    # 409 FailedToAddSupplyOrder: WB отказывается класть задание в НАШУ поставку.
    #
    # Самая частая причина — задание УЖЕ лежит в поставке на стороне WB (статус
    # supplierStatus = 'confirm'). Так бывает, когда его добавили в кабинете вручную
    # или прошлая попытка успела дойти до WB, но ответ до нас не вернулся.
    #
    # Для упаковщицы это не ошибка: задание в поставке, ярлык для него WB рисует.
    # Раньше киоск показывал ей стену текста про «assembly task requirements», и
    # стикеровка вставала — хотя печатать было можно. Проверяем у WB, в поставке ли
    # задание, и если да — спокойно продолжаем.
    if status_code == 409:
        st_code, st_data = wb_request(
            'POST', '/api/v3/orders/status', api_key, use_sandbox, {'orders': [wb_order_id]}
        )
        in_supply = False
        if st_code == 200:
            for o in (st_data or {}).get('orders') or []:
                if int(o.get('id') or 0) == int(wb_order_id):
                    # 'confirm' = задание собрано и лежит в поставке.
                    in_supply = (o.get('supplierStatus') or '').strip() == 'confirm'
        # В лог кладём фактический статус: без него причина 409 не видна, и каждая
        # такая ошибка превращалась в ручное расследование.
        wb_st = ''
        if st_code == 200:
            for o in (st_data or {}).get('orders') or []:
                if int(o.get('id') or 0) == int(wb_order_id):
                    wb_st = f"{(o.get('supplierStatus') or '').strip()}/{(o.get('wbStatus') or '').strip()}"
        print(f'WB 409 для задания {wb_order_id}: статус на WB = {wb_st or "неизвестен"}')

        # Покупатель отменил заказ, пока вещь шла по конвейеру. WB такое задание в
        # поставку не примет никогда — и это НЕ поломка, а обычная ситуация.
        #
        # Упаковщице важно понять за секунду: шить и клеить больше не нужно, вещь
        # уходит на склад. Поэтому закрываем заказ у себя и отвечаем понятной фразой
        # вместо технического текста WB про «assembly task requirements».
        cancelled_on_wb = wb_st.split('/')[0] == 'cancel' or wb_st.split('/')[-1] in (
            'canceled', 'canceled_by_client', 'declined_by_client'
        )
        if cancelled_on_wb:
            cur.execute("UPDATE orders SET status = 'Отменён' WHERE id = %s", (order_id,))
            _drop_from_accumulator(cur, order_id)
            conn.commit()
            return (
                'Покупатель отменил этот заказ на Wildberries — стикер не нужен. '
                'Отложите вещь: она вернётся на склад как свободный остаток'
            )

        if in_supply:
            # Отмечаем у себя, что заказ в поставке, и печатаем ярлык.
            cur.execute(
                "INSERT INTO wb_supply_orders (supply_id, order_id) VALUES (%s, %s) "
                "ON CONFLICT DO NOTHING",
                (supply_id, order_id),
            )
            cur.execute(
                "UPDATE marketplace_supplies SET status = 'На сборке' "
                "WHERE id = %s AND status = 'Открытая'",
                (supply_id,),
            )
            conn.commit()
            return None
        return (
            f'Wildberries не принял сборочное задание {wb_order_id} в поставку '
            f'(статус на WB: {wb_st or "неизвестен"}). Проверьте заказ в кабинете WB: '
            'он может быть отменён покупателем или уже отгружен в другой поставке'
        )

    if status_code not in (200, 204):
        return f'WB не принял заказ в поставку ({status_code}): {wb_error_text(status_code, data)}'

    cur.execute(
        "INSERT INTO wb_supply_orders (supply_id, order_id) VALUES (%s, %s)",
        (supply_id, order_id),
    )
    cur.execute(
        "UPDATE marketplace_supplies SET status = 'На сборке' "
        "WHERE id = %s AND status = 'Открытая'",
        (supply_id,),
    )
    conn.commit()
    return None


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
        # Показываем, что именно ответил WB: обычно это значит, что задание ещё не
        # в поставке — WB рисует стикер только для собранных отправлений.
        return (
            f'WB не вернул стикер для этого заказа. Ответ WB: {str(data)[:200]}'
        ), None

    # Запоминаем ШТРИХКОД с ярлыка: на стикере печатается он, а не номер сборочного
    # задания. Кладовщик сканирует ярлык в поставку — по этому коду вещь и находится.
    st = stickers[0]
    sticker_code = (st.get('barcode') or '').strip()
    if not sticker_code:
        # У части складов WB отдаёт код кусками partA/partB — собираем из них.
        part_a = str(st.get('partA') or '').strip()
        part_b = str(st.get('partB') or '').strip()
        sticker_code = f'{part_a}{part_b}' if (part_a or part_b) else ''
    if sticker_code:
        cur.execute(
            "UPDATE orders SET wb_sticker_barcode = %s WHERE order_number = %s",
            (sticker_code[:60], order_number),
        )

    return None, st.get('file')


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
        - маркетплейсный стикер WB на вещь (png 58×40) в base64 — для печати на терминале.
          Печать означает, что вещь собрана: заказ сразу кладётся в свободную поставку
          WB FBS (она создаётся автоматически, если открытой нет). Проблемы с поставкой
          печать не срывают — они возвращаются в поле supplyWarning.
    POST /  { action: 'list_pending_orders', supplyId? }
        - заказы, накопленные в свободных поставках WB FBS: кладовщик выбирает из них
          то, что заберёт в свою поставку.
    POST /  { action: 'move_orders_to_supply', supplyId, orderIds[] }
        - переносит выбранные заказы в поставку кладовщика (на WB заказ добавляется в
          новую поставку, WB сам убирает его из прежней). Опустевшая накопительная
          поставка удаляется.
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
                      'label', 'list_pending_orders', 'move_orders_to_supply',
                      'check_statuses', 'shelf_cancelled_order', 'supply_qr',
                      'supply_state'):
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
        if action == 'shelf_cancelled_order':
            return handle_shelf_cancelled(cur, conn, body_data, api_key, use_sandbox)
        if action == 'check_statuses':
            return handle_check_statuses(cur, conn, api_key, use_sandbox, actor_id, actor_name)
        if action == 'list_pending_orders':
            return handle_list_pending(cur, body_data)
        if action == 'move_orders_to_supply':
            return handle_move_orders(cur, conn, body_data, api_key, use_sandbox)

        if action == 'label':
            # Маркетплейсный стикер на вещь — печатается на терминале упаковщика.
            order_number = (body_data.get('orderNumber') or '').strip()
            if not order_number:
                return _resp(400, {'error': 'Укажите номер заказа'})
            # ПОРЯДОК ВАЖЕН: WB рисует стикер только для задания, которое уже лежит
            # в поставке. Поэтому сначала кладём вещь в свободную поставку, и лишь
            # затем просим ярлык — иначе WB отвечает пустым списком стикеров.
            supply_warning = add_order_to_open_supply(
                cur, conn, api_key, use_sandbox, order_number
            )
            err, png_b64 = get_order_sticker(cur, api_key, use_sandbox, order_number)
            # Связь с поставкой сохраняем в любом случае: на стороне WB задание уже
            # добавлено, и откат оставил бы наши данные расходиться с маркетплейсом.
            conn.commit()
            if err:
                # WB рисует стикер только для задания, лежащего в поставке. Если стикера
                # нет, настоящая причина — в неудачном добавлении, а не в самой печати:
                # показываем её кладовщику, иначе он видит невнятное «WB не вернул стикер»
                # и не понимает, что делать дальше.
                if supply_warning:
                    return _resp(502, {'error': supply_warning})
                return _resp(502, {'error': err})
            return _resp(200, {
                'orderNumber': order_number,
                'pngBase64': png_b64,
                'supplyWarning': supply_warning,
            })

        if action == 'deliver_supply':
            return handle_deliver_supply(cur, conn, body_data, api_key, use_sandbox)

        if action == 'supply_qr':
            return handle_supply_qr(cur, conn, body_data, api_key, use_sandbox)

        if action == 'supply_state':
            # Что о поставке думает сам WB. Нужно, когда WB отказывается принимать
            # заказы в поставку и отвечает общей фразой «не соблюдены требования»:
            # без этого причина не видна ни кладовщику, ни в журнале.
            supply_id = body_data.get('supplyId')
            if not supply_id:
                return _resp(400, {'error': 'Укажите supplyId'})
            cur.execute(
                "SELECT wb_supply_id FROM marketplace_supplies WHERE id = %s",
                (int(supply_id),),
            )
            row = cur.fetchone()
            if not row or not row[0]:
                return _resp(404, {'error': 'Поставка не создана на стороне WB'})
            st, data = wb_request('GET', f'/api/v3/supplies/{row[0]}', api_key, use_sandbox)
            return _resp(200, {
                'wbSupplyId': row[0], 'httpStatus': st, 'supply': data,
            })

        # action == 'sync_orders'
        # Пока идём к WB за заказами, заодно проверяем накопительную поставку: если её
        # закрыли или отгрузили в кабинете, печать стикеров ломается для всех заказов WB
        # разом. Закрываем устаревшую запись здесь, а не в момент печати — упаковщица
        # не должна упираться в ошибку с вещью в руках.
        supply_reset = drop_stale_accumulator(cur, conn, api_key, use_sandbox)

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
                "marketplace_item_id, shop_id) "
                "VALUES (%s, 'WB', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, %s, "
                "(SELECT shop_id FROM marketplace_integrations WHERE marketplace_code = 'wildberries' AND is_enabled = true ORDER BY shop_id LIMIT 1)) "
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

        # Пишем в журнал КАЖДЫЙ запуск, даже когда новых заказов нет.
        #
        # Раньше запись появлялась только при created > 0. В спокойный час новых
        # заказов не бывает, задание отрабатывало молча — и на странице «Планировщик»
        # исправное задание выглядело как отвалившееся. Отличить «не запускается»
        # от «запускается, но нечего брать» было невозможно.
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
            # Накопительную поставку пришлось пересоздать: полезно видеть в отчёте,
            # чтобы понимать, почему счётчик поставки обнулился.
            'supplyReset': supply_reset,
        })
    finally:
        conn.close()