import base64
import io
import json
import os
import re
import time
import uuid
import urllib.request
import urllib.error

import boto3
import psycopg2
from psycopg2.extras import execute_values

from authz import AuthError, auth_error_response, require_role

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
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'ozon' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        return None, None, False
    is_enabled = bool(row[0])
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('clientId') or '').strip(), (creds.get('apiKey') or '').strip(), is_enabled


def ozon_post(path, client_id, api_key, payload, retries=4):
    """POST в Seller API OZON.

    ПЛОЩАДКА ЖЁСТКО ОГРАНИЧИВАЕТ ЧАСТОТУ ЗАПРОСОВ и на превышение отвечает 429.
    Закрытие короба — это цепочка из создания грузоместа, опроса операции и
    запроса этикетки подряд; на середине цепочки 429 прилетает регулярно. Без
    повтора короб закрывался «наполовину»: грузоместо создано, а этикетка не
    пришла, и кладовщику нечего клеить. Ждём и пробуем снова.
    """
    body = json.dumps(payload).encode('utf-8')
    status_code, detail = 0, {}
    for attempt in range(retries):
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
            status_code = e.code
            # Лимит частоты: ждём с нарастающей паузой и повторяем.
            if e.code == 429 and attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return status_code, detail
        except Exception as e:
            return 0, str(e)
    return status_code, detail


def ozon_error_text(status_code, data):
    if isinstance(data, dict):
        # OZON может вернуть {"errors":{"error_reasons":[...]}} или {"message":...}
        if 'errors' in data and isinstance(data['errors'], dict):
            reasons = data['errors'].get('error_reasons')
            if reasons:
                return ', '.join(map(str, reasons))
        return data.get('message') or data.get('error') or json.dumps(data, ensure_ascii=False)
    return str(data)


def upload_pdf(binary: bytes, name: str) -> str:
    """Загружает PDF-этикетку короба OZON в S3, возвращает публичный CDN URL."""
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'ozon-cargo-labels/{uuid.uuid4().hex}-{name}.pdf'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType='application/pdf')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


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


def load_item_lookup(cur):
    """Грузит справочник товаров в память одним запросом. Возвращает два индекса:
    по ozon_sku и по sku(offer_id) -> (material, width, height, name, barcode, item_id, ozon_sku)."""
    cur.execute("SELECT ozon_sku, sku, material, width, height, name, barcode, id FROM marketplace_items")
    by_ozon_sku = {}
    by_offer = {}
    for r in cur.fetchall():
        val = (r[2], r[3], r[4], r[5], r[6], r[7], r[0])
        if r[0]:
            by_ozon_sku[str(r[0])] = val
        if r[1]:
            by_offer[str(r[1])] = val
    return by_ozon_sku, by_offer


def load_fabric_per_item(cur):
    """Расход ТКАНИ на одно изделие по каждому товару: {marketplace_items.id: метры}.

    Берём ту же цифру, что показывает сводка заказов: норму из состава товара по
    материалу типа «Тюль». В неё уже заложен запас на подгибку, поэтому она больше
    «чистой» ширины — именно столько метров спишется со склада.

    Нужно, чтобы менеджер ДО загрузки заявки на конвейер видел, сколько ткани съест
    поставка. Раньше состав показывал только штуки: FBO-заявка на несколько сотен
    изделий уходила в цех вслепую, и нехватка ткани всплывала уже на раскрое.
    """
    cur.execute(
        "SELECT mim.marketplace_item_id, mim.quantity "
        "FROM marketplace_item_materials mim "
        "JOIN materials mm ON mm.id = mim.material_id "
        "JOIN material_types mmt ON mmt.id = mm.type_id "
        "WHERE mmt.name = 'Тюль'"
    )
    return {int(r[0]): float(r[1] or 0) for r in cur.fetchall()}


def match_item(by_ozon_sku, by_offer, ozon_sku, offer_id):
    """Сопоставляет позицию OZON с нашим товаром: сначала по ozon_sku, затем по offer_id."""
    if ozon_sku is not None:
        found = by_ozon_sku.get(str(ozon_sku))
        if found:
            return found
    if offer_id:
        return by_offer.get(str(offer_id))
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


def handle_check_composition(cur, client_id, api_key, body_data):
    """Проверяет товарный состав заявки OZON FBO БЕЗ создания заказов: сколько позиций и штук,
    сколько распознано (есть наш товар) и список нераспознанных артикулов. Нужно, чтобы
    менеджер до загрузки видел, всё ли сопоставляется."""
    order_id = body_data.get('orderId')
    if not order_id:
        return _resp(400, {'error': 'Укажите orderId заявки'})

    orders = fetch_application_details(client_id, api_key, [int(order_id)])
    if not orders:
        return _resp(404, {'error': 'Заявка не найдена в OZON'})
    supplies = orders[0].get('supplies') or []
    bundle_id = supplies[0].get('bundle_id') if supplies else None
    items = get_bundle_items(client_id, api_key, bundle_id) if bundle_id else []

    by_ozon_sku, by_offer = load_item_lookup(cur)
    fabric_per_item = load_fabric_per_item(cur)

    # Остаток ткани на складе — по нему сразу видно, хватит ли материала на заявку.
    cur.execute(
        "SELECT m.name, m.unit, "
        "COALESCE((SELECT SUM(r.remaining_quantity) FROM rolls r "
        "          WHERE r.material_id = m.id AND r.status = 'in_storage'), 0) "
        "FROM materials m"
    )
    stock = {r[0].strip().lower(): (float(r[2]), r[1]) for r in cur.fetchall()}

    total_items = len(items)
    total_qty = 0
    matched_items = 0
    matched_qty = 0
    unmatched = []
    # Сколько метров каждой ткани съест заявка, если загрузить её на конвейер.
    materials = {}
    for it in items:
        qty = int(it.get('quantity') or 1)
        total_qty += qty
        found = match_item(by_ozon_sku, by_offer, it.get('sku'), it.get('offer_id'))
        if found:
            matched_items += 1
            matched_qty += qty
            material, width, _height, _name, _barcode, item_id, _sku = found
            # Норма из состава товара, а если её не завели — «чистая» ширина в
            # метрах: так позиция не выпадет из подсчёта совсем.
            per_item = fabric_per_item.get(int(item_id)) or ((width or 0) / 100)
            key = material or 'Без материала'
            agg = materials.setdefault(key, {'meters': 0.0, 'items': 0})
            agg['meters'] += per_item * qty
            agg['items'] += qty
        else:
            unmatched.append({'ozonSku': it.get('sku'), 'offerId': it.get('offer_id'), 'name': it.get('name'), 'quantity': qty})

    material_rows = []
    for name, agg in sorted(materials.items(), key=lambda x: -x[1]['meters']):
        left = stock.get(name.strip().lower())
        material_rows.append({
            'material': name,
            'meters': round(agg['meters'], 2),
            'items': agg['items'],
            'inStock': round(left[0], 2) if left else None,
            'unit': left[1] if left else None,
        })

    return _resp(200, {
        'totalItems': total_items,
        'totalQty': total_qty,
        'matchedItems': matched_items,
        'matchedQty': matched_qty,
        'unmatchedItems': len(unmatched),
        'unmatched': unmatched[:100],
        # Сколько ткани уйдёт на заявку и сколько её сейчас на складе.
        'materials': material_rows,
        'totalMeters': round(sum(r['meters'] for r in material_rows), 2),
    })


def handle_import_composition(cur, conn, client_id, api_key, body_data):
    """По заявке OZON FBO создаёт нашу поставку и связывает заказы с ней.
     (если ещё нет) и заказы на конвейер из её
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
    # Дата создания заявки на OZON — по ней считаем, сколько заказ уже ждёт.
    app_created_at = app.get('created_at') or app.get('created_date') or None

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

    by_ozon_sku, by_offer = load_item_lookup(cur)

    skipped_no_item = 0
    unmatched = []
    rows = []  # накапливаем все заказы, вставляем одним запросом (быстро)

    # Сколько ВСЕГО вещей в заявке — от этого зависит формат номера:
    #   одна вещь  -> номер РОВНО как у OZON, без хвоста
    #   несколько  -> с порядковым хвостом «-1», «-2» (каждая вещь шьётся отдельно,
    #                 номера обязаны различаться)
    total_units = 0
    for it in items:
        if match_item(by_ozon_sku, by_offer, it.get('sku'), it.get('offer_id')):
            total_units += int(it.get('quantity') or 1)

    # Если вещи этой заявки уже заводились — сохраняем прежний формат номера, иначе
    # повторная загрузка создала бы дубли (защита ON CONFLICT сверяет именно номер).
    cur.execute(
        "SELECT order_number FROM orders WHERE supply_id = %s LIMIT 1",
        (int(supply_id),),
    )
    existing_row = cur.fetchone()
    keep_plain_number = None
    if existing_row:
        keep_plain_number = existing_row[0] == order_number

    # Сквозной счётчик вещей внутри заявки: общий на все товары, иначе разные позиции
    # получили бы одинаковые номера.
    unit_seq = 0
    for it in items:
        ozon_sku = it.get('sku')
        offer_id = it.get('offer_id')
        qty = int(it.get('quantity') or 1)
        found = match_item(by_ozon_sku, by_offer, ozon_sku, offer_id)
        if not found:
            skipped_no_item += 1
            unmatched.append({'ozonSku': ozon_sku, 'offerId': offer_id, 'name': it.get('name')})
            continue
        material, width, height, item_name, barcode, item_id, item_ozon_sku = found
        product = f"{material} {width}x{height}" if material and width and height else item_name
        for _n in range(1, qty + 1):
            # order_number уникален (индекс в БД), поэтому каждой штуке даём отдельный
            # номер: {номер заявки}-{порядковый номер вещи}. ON CONFLICT DO NOTHING делает
            # импорт идемпотентным: повторная загрузка той же заявки не задваивает заказы.
            unit_seq += 1
            use_plain = (
                keep_plain_number if keep_plain_number is not None else total_units <= 1
            )
            unique_number = order_number if use_plain else f"{order_number}-{unit_seq}"
            rows.append((
                unique_number, product, material,
                int(width) if width else None,
                int(height) if height else None,
                warehouse,
                barcode or None,
                int(item_id) if item_id else None,
                item_ozon_sku or None,
                app_created_at,
                int(supply_id),
            ))

    created = 0
    if rows:
        result = execute_values(
            cur,
            "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
            "quantity, source, material, width, height, cluster, product_barcode, marketplace_item_id, "
            "product_ozon_sku, marketplace_created_at, supply_id, shop_id) VALUES %s "
            "ON CONFLICT (order_number) DO NOTHING RETURNING id",
            rows,
            template="(%s, 'OZON', 'FBO', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                     "(SELECT shop_id FROM marketplace_integrations WHERE marketplace_code = 'ozon' AND is_enabled = true ORDER BY shop_id LIMIT 1))",
            fetch=True,
        )
        created = len(result)

    # СКОЛЬКО ШТУК МЫ ОБЕЩАЛИ ПРИВЕЗТИ — ЭТО ПЛАН ПОСТАВКИ.
    #
    # По нему проверяется, собрана ли поставка целиком: пока в коробах меньше,
    # кладовщику нельзя закрывать сборку, иначе на площадку уедет недовоз.
    #
    # Раньше план НЕ ЗАПИСЫВАЛСЯ вообще, поле оставалось пустым — и проверка
    # недовоза (check_fbo_underfilled) молча пропускала любую поставку. Кнопка
    # «Поставка собрана» горела при двух коробах из двадцати.
    #
    # Считаем по ВСЕЙ заявке, включая позиции без нашего товара: маркетплейс
    # ждёт их все, и расхождение кладовщик должен видеть, а не узнавать на приёмке.
    planned_units = sum(int(it.get('quantity') or 1) for it in items)
    cur.execute(
        "UPDATE marketplace_supplies SET total_quantity_marketplace = %s WHERE id = %s",
        (planned_units, int(supply_id)),
    )

    log_action(
        cur, actor_id, actor_name, 'ozon_fbo_import', supply_id,
        f'Импорт заявки OZON FBO {order_number}: создано заказов {created}, '
        f'без товара {skipped_no_item}, план поставки {planned_units} шт.',
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


def poll_operation(path, client_id, api_key, operation_id, attempts=15, delay=1.5):
    """Опрашивает статус асинхронной операции OZON по operation_id. Возвращает (status, data).

    ОТВЕТ ОПЕРАЦИИ УСТРОЕН ТАК: {"status": "SUCCESS|IN_PROGRESS|FAILED", "result": {...}}.
    Полезное лежит ВНУТРИ result: грузоместа — result.cargoes, этикетка —
    result.file_url.

    Раньше готовность искали по ключам 'cargoes'/'content' на ВЕРХНЕМ уровне,
    которых там нет никогда, а 'result' сравнивали со строкой 'SUCCESS' — но
    result это объект, и сравнение не срабатывало. Ожидание всегда доходило до
    конца по таймауту, а готовый ответ площадки отбрасывался как «OZON не
    ответил». Именно поэтому короб не закрывался: грузоместо на OZON создавалось,
    но мы считали операцию провалившейся и cargo_id не сохраняли.
    """
    status_code, data = 0, {}
    for _ in range(attempts):
        status_code, data = ozon_post(path, client_id, api_key, {'operation_id': operation_id})
        if status_code == 200 and isinstance(data, dict):
            state = str(data.get('status') or '').upper()
            if state in ('SUCCESS', 'COMPLETED', 'DONE', 'FAILED', 'ERROR'):
                return status_code, data
        time.sleep(delay)
    return status_code, data


def download_file(url: str) -> bytes:
    """Скачивает файл по ссылке OZON (этикетки отдаются ссылкой на S3, не base64)."""
    req = urllib.request.Request(url, method='GET')
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def split_label_pages(pdf_bytes: bytes) -> dict:
    """Режет PDF с наклейками на страницы и раскладывает по грузоместам.

    ЗАЧЕМ. OZON не умеет отдавать наклейку на ОДНО грузоместо: сколько бы
    cargo_ids мы ни передали в /v1/cargoes-label/create, в ответ приходит PDF
    со ВСЕМИ грузоместами заявки — по странице на каждое. Сохранив такой файл
    коробу целиком, кладовщик при печати получает пачку чужих наклеек.

    На каждой странице крупно напечатан ID грузового места. По нему и
    раскладываем: читаем текст страницы, достаём длинное число и считаем его
    номером грузоместа.

    Возвращает {cargo_id: pdf_одной_страницы}. Пустой словарь — разобрать не
    вышло (сменился формат наклейки), вызывающий код сохранит файл как есть.
    """
    try:
        from pypdf import PdfReader, PdfWriter
    except Exception:
        return {}

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception:
        return {}

    result = {}
    for page in reader.pages:
        try:
            text = page.extract_text() or ''
        except Exception:
            continue
        # ID грузоместа — длинное число (19 знаков). На наклейке оно напечатано
        # ДВАЖДЫ: сверху с пробелом-разделителем («1000000000059 818626») и ниже
        # целиком под штрихкодом. Читая страницу подряд, эти два вхождения
        # сливаются в одно число двойной длины, поэтому берём ПОСЛЕДНИЕ 19 цифр
        # найденной последовательности — это и есть сам номер.
        cargo_id = None
        for chunk in sorted(re.findall(r'[\d\s]{15,}', text), key=len, reverse=True):
            bare = re.sub(r'\D', '', chunk)
            if len(bare) < 15:
                continue
            # Номер повторён дважды — оставляем одну половину.
            half = len(bare) // 2
            if len(bare) % 2 == 0 and bare[:half] == bare[half:]:
                bare = bare[:half]
            cargo_id = int(bare)
            break
        if cargo_id is None or cargo_id in result:
            continue
        writer = PdfWriter()
        writer.add_page(page)
        buf = io.BytesIO()
        writer.write(buf)
        result[cargo_id] = buf.getvalue()
    return result


def handle_close_boxes(cur, conn, client_id, api_key, body_data):
    """Закрывает короба поставки OZON FBO: создаёт грузоместа (cargoes) на стороне OZON из
    состава каждого короба (группировка по ozon_sku), затем получает PDF-этикетки коробов и
    сохраняет их. Действует на реальной заявке OZON.

    boxId (необязательный) — закрыть ОДИН короб, а не всю поставку разом.

    Кладовщик работает коробами: набил — заклеил — наклеил этикетку — взял
    следующий. Закрывать всё скопом в конце неудобно и неверно: к тому моменту
    короба уже заклеены скотчем, и если этикетка не встанет на свой короб,
    вскрывать придётся все.
    """
    supply_id = body_data.get('supplyId')
    one_box_id = body_data.get('boxId')
    if not supply_id:
        return _resp(400, {'error': 'Укажите supplyId'})

    cur.execute(
        "SELECT marketplace, type, ozon_supply_order_id, ozon_cargo_type FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    s_row = cur.fetchone()
    if not s_row:
        return _resp(404, {'error': 'Поставка не найдена'})
    marketplace, supply_type, ozon_order_id, cargo_type_db = s_row
    # Тип грузоместа: явный из запроса имеет приоритет, иначе из настройки поставки, иначе BOX.
    cargo_type = (body_data.get('cargoType') or cargo_type_db or 'BOX').strip()
    if marketplace != 'OZON' or supply_type != 'FBO':
        return _resp(400, {'error': 'Действие доступно только для поставок OZON FBO'})
    if not ozon_order_id:
        return _resp(409, {'error': 'Поставка не связана с заявкой OZON'})

    # supply_id на стороне OZON (для cargoes) берём из заявки: supplies[0].supply_id.
    apps = fetch_application_details(client_id, api_key, [int(ozon_order_id)])
    if not apps or not (apps[0].get('supplies') or []):
        return _resp(502, {'error': 'Не удалось получить данные заявки OZON'})
    ozon_supply_id = apps[0]['supplies'][0].get('supply_id')

    # СОСТАВ ГРУЗОМЕСТА OZON ПРИНИМАЕТ ПО offer_id (НАШ АРТИКУЛ), А НЕ ПО sku.
    #
    # На /v1/cargoes/create с одним лишь sku площадка отвечает
    # «One of offer_id or barcode must be specified» — и закрытие короба
    # обрывалось на первом же запросе. offer_id хранится у нас в
    # marketplace_items.sku, ozon_sku нужен только для поиска товара.
    cur.execute(
        "SELECT id, sku, ozon_sku, material, width, height "
        "FROM marketplace_items WHERE sku IS NOT NULL AND sku <> ''"
    )
    offer_by_item = {}
    offer_by_ozon_sku = {}
    offer_by_mwh = {}
    for item_id, offer_id, ozon_sku, material, width, height in cur.fetchall():
        offer_by_item[item_id] = offer_id
        if ozon_sku:
            offer_by_ozon_sku[str(ozon_sku)] = offer_id
        offer_by_mwh[(material, width, height)] = offer_id
    # Короба, где нашлись вещи без артикула OZON: о них предупредим кладовщика.
    unmatched_boxes = []

    # КАКИЕ КОРОБА ОТПРАВЛЯЕМ НА OZON.
    #
    # Закрываем один короб — отправляем ТОЛЬКО его, с delete_current_version =
    # false: площадка добавляет грузоместо к уже существующим. Ранее закрытые
    # короба не трогаются, их cargo_id и напечатанные этикетки остаются в силе.
    #
    # Раньше при закрытии одного короба заново отправлялся состав ВСЕХ закрытых
    # с delete_current_version = true. OZON при этом удалял прежние грузоместа и
    # заводил новые с другими cargo_id: этикетки, уже наклеенные на заклеенные
    # короба, переставали соответствовать заявке.
    if one_box_id:
        cur.execute(
            "SELECT b.id, b.box_number, b.ozon_cargo_id FROM marketplace_supply_boxes b "
            "WHERE b.supply_id = %s AND b.id = %s",
            (int(supply_id), int(one_box_id)),
        )
    else:
        # Закрытие всей поставки разом: пересоздаём список грузомест целиком.
        cur.execute(
            "SELECT b.id, b.box_number, b.ozon_cargo_id FROM marketplace_supply_boxes b "
            "WHERE b.supply_id = %s ORDER BY b.box_number",
            (int(supply_id),),
        )
    boxes = cur.fetchall()
    if not boxes:
        return _resp(400, {'error': 'В поставке нет коробов'})

    cargoes_payload = []
    box_keys = {}  # key -> box_id
    for box_id, box_number, ozon_cargo_id in boxes:
        # СОСТАВ КОРОБА: вещь на складе -> её заказ -> товар -> ozon_sku.
        #
        # Раньше здесь читался msi.order_id, но такой колонки в
        # marketplace_supply_items нет (только id, supply_id,
        # goods_warehouse_id, box_id). Запрос падал с ошибкой колонки, и
        # закрыть короб OZON было невозможно в принципе: кладовщик жал
        # «Закрыть короб» и получал ошибку, грузоместо на площадке не
        # создавалось.
        #
        # Связь у вещи одна — goods_warehouse. Заказ берём и по order_id
        # (вещь сшили под этот заказ), и по reserved_order_id (вещь сняли с
        # полки под заказ): у FBO-товара со склада заполнено то или другое.
        #
        # ozon_sku ищем сначала прямо у заказа (product_ozon_sku проставляется
        # при импорте), затем через справочник по marketplace_item_id и лишь
        # потом по материалу с размерами. Раньше был только третий путь, и
        # товар, у которого в справочнике не совпала пара «ширина-высота»,
        # молча выпадал из состава короба — на OZON уезжало меньше, чем в
        # коробе лежит.
        cur.execute(
            "SELECT o.material, o.width, o.height, o.product_ozon_sku, o.marketplace_item_id "
            "FROM marketplace_supply_items msi "
            "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
            "JOIN orders o ON o.id = COALESCE(gw.order_id, gw.reserved_order_id) "
            "WHERE msi.supply_id = %s AND msi.box_id = %s",
            (int(supply_id), box_id),
        )
        offer_counts = {}
        unmatched = 0
        for material, width, height, order_sku, item_id in cur.fetchall():
            offer_id = (
                offer_by_item.get(item_id)
                or (offer_by_ozon_sku.get(str(order_sku)) if order_sku else None)
                or offer_by_mwh.get((material, width, height))
            )
            if offer_id:
                offer_counts[offer_id] = offer_counts.get(offer_id, 0) + 1
            else:
                unmatched += 1
        # Товар без артикула на OZON не передать — но и молчать нельзя: короб
        # заклеят, а в заявке будет меньше штук, чем внутри.
        if unmatched:
            unmatched_boxes.append((box_number, unmatched))
        if not offer_counts:
            continue
        key = f'box-{box_id}'
        box_keys[key] = box_id
        # Формат грузоместа: {key, value: {type, items}}. Плоская структура
        # {key, cargo_type, items} площадкой не читается — она отвечала
        # «CargoType must be set», и короб не закрывался никогда.
        cargoes_payload.append({
            'key': key,
            'value': {
                'type': cargo_type,
                'items': [
                    {'offer_id': str(offer_id), 'quantity': int(q)}
                    for offer_id, q in offer_counts.items()
                ],
            },
        })

    # НЕ ОТПРАВЛЯЕМ КОРОБ, СОСТАВ КОТОРОГО РАСХОДИТСЯ С РЕАЛЬНЫМ.
    #
    # Если часть вещей без ozon_sku, на OZON уедет меньше штук, чем физически
    # лежит в коробе. На приёмке это расхождение — недостача по документам, а
    # короб к тому моменту уже заклеен. Лучше остановить кладовщика сейчас.
    if unmatched_boxes:
        parts = '; '.join(f'короб №{n}: {c} шт.' for n, c in unmatched_boxes)
        return _resp(409, {
            'error': 'В коробах есть товар, которого нет в справочнике OZON '
                     f'({parts}). Пропишите товару артикул (offer_id) в справочнике '
                     'и закройте короб заново — иначе на площадку уедет меньше, '
                     'чем лежит в коробе',
        })

    if not cargoes_payload:
        return _resp(400, {'error': 'В коробах нет товаров с распознанным артикулом OZON'})

    # 1) Создаём грузоместа на OZON.
    #
    # delete_current_version = true стирает ВСЕ ранее созданные грузоместа
    # заявки. При закрытии одного короба это недопустимо: у закрытых коробов
    # сменились бы cargo_id, а этикетки на них уже наклеены. Поэтому один короб
    # добавляем к существующим, а пересоздаём список только при закрытии всей
    # поставки разом.
    st, data = ozon_post('/v1/cargoes/create', client_id, api_key, {
        'supply_id': int(ozon_supply_id),
        'delete_current_version': not one_box_id,
        'cargoes': cargoes_payload,
    })
    if st != 200 or not isinstance(data, dict) or not data.get('operation_id'):
        return _resp(502, {'error': f'OZON не принял короба: {ozon_error_text(st, data)}'})
    op_id = data['operation_id']

    # 2) Ждём результат создания — получаем cargo_id по каждому key.
    #
    # Ответ приходит вложенным: {"status": "SUCCESS", "result": {"cargoes":
    # [{"key": "box-1", "value": {"cargo_id": 123}}]}}. Раньше cargoes искали на
    # верхнем уровне, а cargo_id — прямо в элементе, минуя value. Оба ключа не
    # находились: грузоместо на площадке создавалось, а у нас короб оставался
    # незакрытым, без cargo_id и без этикетки.
    st, info = poll_operation('/v2/cargoes/create/info', client_id, api_key, op_id)
    result = info.get('result') if isinstance(info, dict) else None
    cargoes_result = (result or {}).get('cargoes') or [] if isinstance(result, dict) else []
    if not cargoes_result:
        return _resp(502, {'error': f'OZON не создал грузоместа: {ozon_error_text(st, info)}'})

    cargo_ids = []
    for c in cargoes_result:
        key = c.get('key')
        value = c.get('value') if isinstance(c.get('value'), dict) else {}
        cargo_id = value.get('cargo_id') or c.get('cargo_id')
        if key in box_keys and cargo_id:
            cargo_ids.append(int(cargo_id))
            cur.execute(
                "UPDATE marketplace_supply_boxes SET ozon_cargo_id = %s, closed_at = COALESCE(closed_at, now()) "
                "WHERE id = %s",
                (int(cargo_id), box_keys[key]),
            )
    conn.commit()
    if not cargo_ids:
        return _resp(502, {'error': f'OZON не вернул номера грузомест: {ozon_error_text(st, info)}'})

    # 3) Запрашиваем генерацию этикеток коробов.
    #
    # При закрытии ОДНОГО короба просим этикетку только на него: OZON отдаёт
    # один PDF на все переданные грузоместа, и общий файл на десять коробов
    # кладовщику бесполезен — ему нужна наклейка на тот короб, что в руках.
    stickers_saved = 0
    label_cargo_ids = cargo_ids
    if one_box_id:
        cur.execute(
            "SELECT ozon_cargo_id FROM marketplace_supply_boxes WHERE id = %s",
            (int(one_box_id),),
        )
        one_row = cur.fetchone()
        if one_row and one_row[0]:
            label_cargo_ids = [int(one_row[0])]

    st, lbl = ozon_post('/v1/cargoes-label/create', client_id, api_key, {
        'supply_id': int(ozon_supply_id),
        'cargo_ids': label_cargo_ids,
    })
    label_op = lbl.get('operation_id') if isinstance(lbl, dict) else None
    if label_op:
        # 4) Получаем готовый PDF.
        #
        # Этикетку OZON отдаёт ССЫЛКОЙ на файл: {"status": "SUCCESS", "result":
        # {"file_guid": "...", "file_url": "https://ir.ozone.ru/..."}}. Ключей
        # content/file_content с base64 в ответе нет вовсе — раньше их и искали,
        # поэтому стикер не сохранялся никогда, даже когда площадка его отдала.
        st, got = poll_operation('/v1/cargoes-label/get', client_id, api_key, label_op)
        lbl_result = got.get('result') if isinstance(got, dict) else None
        pdf_bytes = None
        if isinstance(lbl_result, dict):
            file_url = lbl_result.get('file_url')
            if file_url:
                try:
                    pdf_bytes = download_file(file_url)
                except Exception:
                    pdf_bytes = None
        if not pdf_bytes and isinstance(got, dict):
            content = got.get('content') or got.get('file_content')
            if content:
                try:
                    pdf_bytes = base64.b64decode(content)
                except Exception:
                    pdf_bytes = None
        if pdf_bytes:
            # OZON ИГНОРИРУЕТ cargo_ids И ОТДАЁТ ЭТИКЕТКИ ВСЕЙ ЗАЯВКИ.
            #
            # Мы просим наклейку на один короб, а в ответ приходит PDF со всеми
            # грузоместами поставки — по странице на каждое. Если сохранить
            # такой файл коробу целиком, кладовщик печатает пачку чужих
            # наклеек и клеит их наугад.
            #
            # Поэтому режем PDF по страницам и раскладываем: на каждой
            # странице напечатан ID грузового места — по нему и находим,
            # какому коробу она принадлежит.
            pages = split_label_pages(pdf_bytes)
            saved_ids = set()
            for cargo_id, page_pdf in pages.items():
                cur.execute(
                    "SELECT id, box_number FROM marketplace_supply_boxes "
                    "WHERE supply_id = %s AND ozon_cargo_id = %s",
                    (int(supply_id), int(cargo_id)),
                )
                b_row = cur.fetchone()
                if not b_row:
                    continue
                try:
                    url = upload_pdf(page_pdf, f'supply-{supply_id}-box-{b_row[0]}')
                except Exception:
                    continue
                cur.execute(
                    "UPDATE marketplace_supply_boxes SET sticker_url = %s, "
                    "  sticker_name = %s WHERE id = %s",
                    (url, f'Стикер короба №{b_row[1]}.pdf', int(b_row[0])),
                )
                saved_ids.add(int(b_row[0]))
            stickers_saved = len(saved_ids)

            # Разрезать не вышло (формат файла изменился) — сохраняем как есть,
            # иначе кладовщик останется совсем без наклейки.
            if not stickers_saved:
                try:
                    if one_box_id:
                        url = upload_pdf(pdf_bytes, f'supply-{supply_id}-box-{one_box_id}')
                        cur.execute(
                            "UPDATE marketplace_supply_boxes SET sticker_url = %s, "
                            "  sticker_name = %s WHERE id = %s",
                            (url, f'Стикер короба #{one_box_id}.pdf', int(one_box_id)),
                        )
                        stickers_saved = 1
                    else:
                        url = upload_pdf(pdf_bytes, f'supply-{supply_id}')
                        cur.execute(
                            "UPDATE marketplace_supply_boxes SET sticker_url = %s, sticker_name = %s "
                            "WHERE supply_id = %s AND ozon_cargo_id IS NOT NULL",
                            (url, f'Этикетки коробов #{supply_id}.pdf', int(supply_id)),
                        )
                        stickers_saved = len(cargo_ids)
                except Exception:
                    pass
    conn.commit()

    return _resp(200, {
        'closedBoxes': 1 if one_box_id else len(cargo_ids),
        'stickersSaved': stickers_saved,
        'note': None if stickers_saved else 'Грузоместо создано, но этикетка ещё готовится — обновите через минуту.',
    })


def handle_reopen_box(cur, conn, client_id, api_key, body_data):
    """Переоткрывает закрытый короб, чтобы поправить его состав.

    ЗАЧЕМ. Закрытие короба — необратимый шаг: создаётся грузоместо на OZON,
    приходит этикетка, состав замораживается. Но кладовщик закрывает короб
    и ТУТ ЖЕ видит, что положил лишнее или не доложил — а исправить нечем.
    Оставалось собирать поставку заново.

    Что делаем: удаляем грузоместо на стороне OZON (иначе на приёмке будет
    лишнее место с неверным составом), снимаем отметку о закрытии и стираем
    устаревший стикер. После правки короб закрывают заново — OZON заведёт
    новое грузоместо и выдаст свежую этикетку.

    Печатать старую наклейку после этого нельзя, поэтому и стираем: иначе
    кладовщик наклеит грузоместо, которого на площадке уже нет.
    """
    box_id = body_data.get('boxId')
    if not box_id:
        return _resp(400, {'error': 'Укажите короб'})

    cur.execute(
        "SELECT b.supply_id, b.box_number, b.ozon_cargo_id, b.closed_at, "
        "       s.status, s.ozon_supply_order_id "
        "FROM marketplace_supply_boxes b "
        "JOIN marketplace_supplies s ON s.id = b.supply_id WHERE b.id = %s",
        (int(box_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Короб не найден'})
    supply_id, box_number, cargo_id, closed_at, s_status, ozon_order_id = row

    if not closed_at:
        return _resp(409, {'error': 'Короб и так открыт'})
    # Поставка уже уехала — состав коробов трогать поздно, документы поданы.
    if s_status not in ('Открытая', 'На сборке'):
        return _resp(409, {
            'error': 'Поставка уже в отгрузке — состав коробов менять нельзя',
        })

    # Убираем грузоместо на OZON. Если его там нет (короб закрылся, а площадка
    # не ответила) — просто открываем короб у себя.
    ozon_note = None
    if cargo_id and ozon_order_id:
        apps = fetch_application_details(client_id, api_key, [int(ozon_order_id)])
        ozon_supply_id = None
        if apps and (apps[0].get('supplies') or []):
            ozon_supply_id = apps[0]['supplies'][0].get('supply_id')
        if ozon_supply_id:
            st, data = ozon_post('/v1/cargoes/delete', client_id, api_key, {
                'supply_id': int(ozon_supply_id),
                'cargo_ids': [int(cargo_id)],
            })
            if st != 200:
                # Не смогли снять грузоместо — короб НЕ открываем. Иначе на
                # OZON останется место с одним составом, а у нас будет другой.
                return _resp(502, {
                    'error': f'OZON не дал удалить грузоместо: {ozon_error_text(st, data)}. '
                             f'Короб оставлен закрытым',
                })
            ozon_note = f'Грузоместо {cargo_id} удалено на OZON'

    cur.execute(
        "UPDATE marketplace_supply_boxes SET closed_at = NULL, ozon_cargo_id = NULL, "
        "  sticker_url = NULL, sticker_name = NULL WHERE id = %s",
        (int(box_id),),
    )
    log_action(
        cur, body_data.get('actorId'), body_data.get('actorName'),
        'ozon_fbo_reopen_box', supply_id,
        f'Переоткрыт короб №{box_number} для правки состава'
        + (f' ({ozon_note})' if ozon_note else ''),
    )
    conn.commit()

    return _resp(200, {'success': True, 'boxNumber': box_number, 'note': ozon_note})


def handle_all_labels(cur, conn, client_id, api_key, body_data):
    """Собирает ОДИН PDF со стикерами всех коробов поставки — для печати пачкой.

    ЗАЧЕМ. Короб закрывают по одному, и стикер печатают тут же — это рабочий
    порядок. Но когда поставка собрана целиком, кладовщику удобнее один раз
    отправить на принтер весь комплект наклеек, а не открывать каждый короб
    заново и жать печать двадцать раз подряд.

    Страницы идут В ПОРЯДКЕ НОМЕРОВ КОРОБОВ: лист №1 — короб №1. Иначе пачка
    на выходе из принтера ложится в случайном порядке, и кладовщик
    перебирает наклейки, сверяя ID грузоместа глазами.

    Файл собираем из УЖЕ СОХРАНЁННЫХ стикеров коробов, не дёргая OZON заново:
    каждый из них площадка уже отдала при закрытии короба, и они разложены по
    коробам постранично. Повторный запрос к OZON только упёрся бы в лимит
    частоты и вернул бы то же самое.
    """
    supply_id = body_data.get('supplyId')
    if not supply_id:
        return _resp(400, {'error': 'Укажите supplyId'})

    cur.execute(
        "SELECT marketplace, type FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    s_row = cur.fetchone()
    if not s_row:
        return _resp(404, {'error': 'Поставка не найдена'})
    if s_row[0] != 'OZON' or s_row[1] != 'FBO':
        return _resp(400, {'error': 'Действие доступно только для поставок OZON FBO'})

    # Короба поставки: сколько всего, у скольких есть стикер и все ли закрыты.
    cur.execute(
        "SELECT box_number, sticker_url, closed_at, ozon_cargo_id, "
        "       (SELECT COUNT(*) FROM marketplace_supply_items i WHERE i.box_id = b.id) "
        "FROM marketplace_supply_boxes b "
        "WHERE b.supply_id = %s ORDER BY b.box_number",
        (int(supply_id),),
    )
    boxes = cur.fetchall()
    if not boxes:
        return _resp(400, {'error': 'В поставке нет коробов'})

    # Непустой короб без отметки о закрытии — работа не закончена: на OZON
    # такого грузоместа нет, и печатать пачку рано.
    open_boxes = [str(n) for n, _u, closed, _c, items in boxes if items and not closed]
    if open_boxes:
        return _resp(409, {
            'error': f'Не закрыты короба: №{", №".join(open_boxes)}. '
                     f'Закройте их — только тогда OZON выдаёт стикеры',
        })

    with_sticker = [(n, u, cargo) for n, u, _c, cargo, items in boxes if u and items]
    if not with_sticker:
        return _resp(409, {
            'error': 'Ни у одного короба нет стикера. Закройте короба — '
                     'стикер приходит с OZON при закрытии',
        })

    missing = [str(n) for n, u, _c, _cargo, items in boxes if items and not u]

    try:
        from pypdf import PdfWriter
    except Exception:
        return _resp(500, {'error': 'Не удалось собрать общий файл стикеров'})

    writer = PdfWriter()
    added = 0
    for _box_number, url, cargo_id in with_sticker:
        try:
            box_pdf = download_file(url)
        except Exception:
            # Один недоступный файл не должен рушить всю пачку: остальные
            # наклейки кладовщику нужны, а про пропуск скажем в ответе.
            continue

        # БЕРЁМ ТОЛЬКО СТРАНИЦУ СВОЕГО ГРУЗОМЕСТА.
        #
        # У коробов, закрытых до того, как мы научились резать ответ OZON,
        # в стикере лежит ПОЛНЫЙ файл заявки — все грузоместа подряд.
        # Склеив такие файлы как есть, кладовщик получил бы наклейки чужих
        # коробов вперемешку со своими и наклеил бы их наугад.
        #
        # Поэтому разбираем файл по грузоместам и берём страницу нужного.
        # Разобрать не вышло (одностраничный свежий стикер) — кладём как есть.
        page_pdf = None
        if cargo_id:
            pages = split_label_pages(box_pdf)
            page_pdf = pages.get(int(cargo_id))
        try:
            writer.append(io.BytesIO(page_pdf or box_pdf))
            added += 1
        except Exception:
            continue

    if not added:
        return _resp(502, {'error': 'Не удалось прочитать ни один стикер короба'})

    buf = io.BytesIO()
    writer.write(buf)
    url = upload_pdf(buf.getvalue(), f'supply-{supply_id}-all-boxes')

    log_action(
        cur, body_data.get('actorId'), body_data.get('actorName'),
        'ozon_fbo_all_labels', supply_id,
        f'Собрал общий файл стикеров коробов: {added} шт.',
    )
    conn.commit()

    return _resp(200, {
        'url': url,
        'boxes': added,
        'missingBoxes': missing,
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
    POST /  { action: 'check_composition', orderId }
        - проверяет товарный состав заявки БЕЗ создания заказов: сколько позиций/штук всего,
          сколько распознано (есть наш товар) и список нераспознанных артикулов. Нужно, чтобы
          менеджер до загрузки видел, всё ли сопоставляется.
    POST /  { action: 'import_composition', orderId, createdBy?, actorId?, actorName? }
        - создаёт (или переиспользует) нашу поставку OZON FBO для заявки и создаёт заказы на
          конвейер из её товарного состава (каждая штука → отдельный заказ order_type='FBO',
          status='Новый'). Товар сопоставляется по ozon_sku (фолбэк offer_id=sku). Возвращает
          supplyId (для перехода), число созданных заказов и нераспознанные артикулы.
    POST /  { action: 'close_boxes', supplyId, boxId?, cargoType? }
        - закрывает короба поставки OZON FBO: создаёт грузоместа (cargoes) на OZON из состава
          каждого короба (по артикулу offer_id), сохраняет их cargo_id, тянет PDF-этикетки
          коробов и привязывает их к коробам. boxId — закрыть ОДИН короб, добавив грузоместо к
          уже созданным. cargoType по умолчанию 'BOX'. Действует на реальной заявке.
    POST /  { action: 'reopen_box', boxId }
        - переоткрывает закрытый короб для правки состава: удаляет грузоместо на OZON,
          снимает closed_at и стирает устаревший стикер. После правки короб закрывают заново.
    POST /  { action: 'all_box_labels', supplyId }
        - собирает ОДИН PDF со стикерами всех коробов поставки (по странице на короб, в
          порядке их номеров) для печати пачкой. Берёт уже сохранённые стикеры коробов,
          к OZON не обращается. Отклоняет запрос, если есть незакрытые непустые короба.

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
    if action not in ('list_applications', 'check_composition', 'import_composition',
                      'close_boxes', 'all_box_labels', 'reopen_box'):
        return _resp(400, {'error': 'Неизвестное действие'})

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        # КТО ПРИШЁЛ — ПРОВЕРЯЕМ ТОКЕНОМ, А НЕ ТЕЛОМ ЗАПРОСА.
        #
        # Раньше функция не проверяла права ВООБЩЕ: её адрес виден в коде
        # страницы, и любой человек из интернета мог дёрнуть её напрямую.
        # А она ходит в боевой кабинет OZON — создаёт грузоместа в реальной
        # заявке и заводит заказы на конвейер. Чужой запрос мог переписать
        # состав поставки или забить производство выдуманными заказами.
        #
        # Роли те же, что у сборки поставок: короба собирает кладовщик,
        # заявки ведёт менеджер, администратор может всё.
        try:
            require_role(
                cur, event,
                'admin', 'manager', 'senior_storekeeper', 'storekeeper',
            )
        except AuthError as err:
            return auth_error_response(err, CORS_HEADERS)

        client_id, api_key, is_enabled = get_ozon_credentials(cur)
        if not is_enabled:
            return _resp(400, {'error': 'Интеграция с OZON выключена. Включите её в разделе «Интеграции маркетплейсов».'})
        if not client_id or not api_key:
            return _resp(400, {'error': 'Не указаны Client ID или API-ключ OZON.'})

        if action == 'list_applications':
            return handle_list_applications(cur, client_id, api_key)
        if action == 'check_composition':
            return handle_check_composition(cur, client_id, api_key, body_data)
        if action == 'import_composition':
            return handle_import_composition(cur, conn, client_id, api_key, body_data)
        if action == 'close_boxes':
            return handle_close_boxes(cur, conn, client_id, api_key, body_data)
        if action == 'all_box_labels':
            return handle_all_labels(cur, conn, client_id, api_key, body_data)
        if action == 'reopen_box':
            return handle_reopen_box(cur, conn, client_id, api_key, body_data)
    finally:
        conn.close()