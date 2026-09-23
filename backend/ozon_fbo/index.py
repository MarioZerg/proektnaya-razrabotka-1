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

    # supply_id на стороне OZON (для cargoes). Берём из кеша: лишний запрос к
    # площадке съедает до 5с из 5, отведённых функции, и закрытие короба
    # обрывается таймаутом.
    ozon_supply_id = get_ozon_supply_id(
        cur, supply_id, ozon_order_id, client_id, api_key)
    if not ozon_supply_id:
        return _resp(502, {'error': 'Не удалось получить данные заявки OZON'})

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

    # СНАЧАЛА ЗАБИРАЕМ НОМЕРА ПО НЕЗАВЕРШЁННЫМ ОПЕРАЦИЯМ.
    #
    # Если прошлый заход создал место на OZON, но оборвался по таймауту до
    # записи cargo_id, операция осталась сохранённой. Доводим её до конца —
    # тогда короб привяжется к УЖЕ созданному месту, а не получит второе.
    # Ровно из-за пропуска этого шага «первый короб всегда висел» на площадке.
    recovered = 0
    for box_id, box_number, ozon_cargo_id in boxes:
        if ozon_cargo_id:
            continue
        cur.execute(
            "SELECT ozon_create_operation_id FROM marketplace_supply_boxes WHERE id = %s",
            (int(box_id),),
        )
        op_row = cur.fetchone()
        pending_op = op_row[0] if op_row else None
        if not pending_op:
            continue
        st_p, info_p = poll_operation(
            '/v2/cargoes/create/info', client_id, api_key, pending_op,
            attempts=2, delay=0.5,
        )
        res_p = info_p.get('result') if isinstance(info_p, dict) else None
        items_p = (res_p or {}).get('cargoes') or [] if isinstance(res_p, dict) else []
        for c in items_p:
            val = c.get('value') if isinstance(c.get('value'), dict) else {}
            cid_p = val.get('cargo_id') or c.get('cargo_id')
            if c.get('key') == f'box-{box_id}' and cid_p:
                cur.execute(
                    "UPDATE marketplace_supply_boxes SET ozon_cargo_id = %s, "
                    "  closed_at = COALESCE(closed_at, now()), "
                    "  ozon_create_operation_id = NULL WHERE id = %s",
                    (int(cid_p), int(box_id)),
                )
                recovered += 1
    if recovered:
        conn.commit()
        # Перечитываем короба: у восстановленных появился cargo_id, и второе
        # место им заводить уже не нужно.
        if one_box_id:
            cur.execute(
                "SELECT b.id, b.box_number, b.ozon_cargo_id FROM marketplace_supply_boxes b "
                "WHERE b.supply_id = %s AND b.id = %s",
                (int(supply_id), int(one_box_id)),
            )
        else:
            cur.execute(
                "SELECT b.id, b.box_number, b.ozon_cargo_id FROM marketplace_supply_boxes b "
                "WHERE b.supply_id = %s ORDER BY b.box_number",
                (int(supply_id),),
            )
        boxes = cur.fetchall()

    cargoes_payload = []
    box_keys = {}  # key -> box_id
    already_on_ozon = []
    for box_id, box_number, ozon_cargo_id in boxes:
        # У КОРОБА УЖЕ ЕСТЬ ГРУЗОМЕСТО — ВТОРОЕ НЕ ЗАВОДИМ.
        #
        # Повторное нажатие «Закрыть короб» (или закрытие после неудачного
        # переоткрытия) отправляло состав заново, и OZON заводил ЕЩЁ ОДНО
        # место с тем же товаром. На приёмку приезжали два одинаковых короба
        # с разными штрихкодами, а заявка расходилась вдвое.
        #
        # Место снимается только явным переоткрытием короба, где мы
        # дожидаемся подтверждения удаления от площадки.
        if ozon_cargo_id:
            already_on_ozon.append(box_number)
            continue
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
        # Отправлять нечего, потому что грузоместо уже заведено — это не
        # ошибка, а защита от задвоения. Говорим прямо, что делать дальше.
        if already_on_ozon:
            nums = ', '.join(f'№{n}' for n in already_on_ozon)
            return _resp(409, {
                'error': f'Короб {nums} уже заведён на OZON — второе грузоместо '
                         f'не создаём, иначе на приёмке будет два одинаковых '
                         f'короба. Чтобы изменить состав, откройте короб кнопкой '
                         f'«Открыть короб и поправить состав»',
            })
        return _resp(400, {'error': 'В коробах нет товаров с распознанным артикулом OZON'})

    # 1) Создаём грузоместа на OZON.
    #
    # delete_current_version НИКОГДА НЕ СТАВИМ В true.
    #
    # Этот флаг стирает на заявке ВСЕ ранее созданные грузоместа и оставляет
    # только те, что пришли в текущем запросе. Раньше при нажатии «Закрыть
    # короба» на всю поставку он включался — и получалось вот что: короба,
    # закрытые по одному ранее, в payload не попадают (у них уже есть
    # cargo_id, мы их осознанно пропускаем), а флаг всё равно приказывает
    # площадке снести прежний список. Собрали девять коробов, шесть закрыли
    # по одному, нажали «Закрыть короба» — OZON снёс шесть мест и завёл три.
    # В поставке осталось три короба, остальные «не подтянулись», хотя
    # физически стоят заклеенные на складе.
    #
    # Грузоместа всегда ДОБАВЛЯЕМ к существующим. Снятие лишнего — отдельная,
    # явная операция (/v1/cargoes/delete) с подтверждением от площадки.
    # ДОБИВАЕМ НЕСНЯТЫЕ МЕСТА ПЕРЕД СОЗДАНИЕМ НОВОГО.
    #
    # OZON подтверждает снятие грузоместа раньше, чем применяет его: ответ
    # SUCCESS приходит сразу, а с заявки место пропадает через десятки секунд.
    # Кладовщик переоткрывает короб и закрывает его через 5-10 секунд — старое
    # место ещё живо, и рядом появляется новое. Это и есть «осиротевший дубль».
    #
    # Повторный запрос на снятие идемпотентен: если место уже исчезло, вреда
    # нет, а если висит — уйдёт сейчас, до создания нового.
    flush_pending_removals(cur, supply_id, ozon_supply_id, client_id, api_key)
    conn.commit()

    st, data = ozon_post('/v1/cargoes/create', client_id, api_key, {
        'supply_id': int(ozon_supply_id),
        'delete_current_version': False,
        'cargoes': cargoes_payload,
    })
    # ЛИМИТ ЧАСТОТЫ — НЕ ОШИБКА СБОРКИ.
    #
    # Кладовщик закрывает короба подряд, по одному в 6-8 секунд, и площадка
    # начинает отвечать 429. Короб при этом НЕ создан — повторять можно
    # спокойно, дублей не будет. Красное «OZON не принял короба» здесь только
    # пугает: человек думает, что сломал поставку, хотя надо просто подождать.
    if st == 429:
        return _resp(429, {
            'error': 'OZON ограничивает частоту запросов. Подождите полминуты '
                     'и нажмите «Закрыть короб» ещё раз — короб не пострадал',
        })
    if st != 200 or not isinstance(data, dict) or not data.get('operation_id'):
        return _resp(502, {'error': f'OZON не принял короба: {ozon_error_text(st, data)}'})
    op_id = data['operation_id']

    # ЗАПОМИНАЕМ ОПЕРАЦИЮ СРАЗУ — ИНАЧЕ ПЛОДИМ ГРУЗОМЕСТА-СИРОТЫ.
    #
    # Место на OZON уже создаётся, но его номер (cargo_id) придёт позже,
    # отдельным запросом. У функции всего 5 секунд, а ожидание занимает до 22:
    # она обрывается по таймауту ПОСЛЕ создания места, но ДО записи cargo_id.
    #
    # Так и появлялся «первый короб, который всегда висит»: на площадке место
    # есть, у нас о нём ни следа, кладовщик жмёт «Закрыть» снова — создаётся
    # ещё одно. Заявка показывает два одинаковых короба с разными штрихкодами.
    #
    # Сохранив operation_id отдельным коммитом, мы даём следующему заходу
    # ЗАБРАТЬ номер уже созданного места вместо создания нового.
    for _key, _box_id in box_keys.items():
        cur.execute(
            "UPDATE marketplace_supply_boxes SET ozon_create_operation_id = %s WHERE id = %s",
            (str(op_id), int(_box_id)),
        )
    conn.commit()

    # 2) Ждём результат создания — получаем cargo_id по каждому key.
    #
    # Ответ приходит вложенным: {"status": "SUCCESS", "result": {"cargoes":
    # [{"key": "box-1", "value": {"cargo_id": 123}}]}}. Раньше cargoes искали на
    # верхнем уровне, а cargo_id — прямо в элементе, минуя value. Оба ключа не
    # находились: грузоместо на площадке создавалось, а у нас короб оставался
    # незакрытым, без cargo_id и без этикетки.
    #
    # Ждём КОРОТКО, с запасом до таймаута функции: не успели — номер заберёт
    # следующий заход по сохранённой операции, место при этом не задвоится.
    st, info = poll_operation(
        '/v2/cargoes/create/info', client_id, api_key, op_id,
        attempts=3, delay=0.6,
    )
    result = info.get('result') if isinstance(info, dict) else None
    cargoes_result = (result or {}).get('cargoes') or [] if isinstance(result, dict) else []
    if not cargoes_result:
        # НОМЕР ЕЩЁ НЕ ПРИШЁЛ — КОРОБ ВСЁ РАВНО ЗАКРЫВАЕМ.
        #
        # Раньше здесь возвращалась 202 с просьбой нажать «Повторить отправку
        # на OZON». На деле это выглядело как ошибка: кладовщик видел красное
        # сообщение, обновлял страницу — и короб оказывался закрыт. Место на
        # площадке к тому моменту уже создавалось, номер просто приходил
        # секундой позже, и его забирал следующий заход.
        #
        # Теперь короб закрываем сразу: физически он заклеен, и держать его
        # открытым из-за задержки площадки незачем. Операция сохранена
        # (ozon_create_operation_id), поэтому номер подтянется автоматически —
        # при следующем открытии карточки или запросе этикетки. Второго места
        # при этом не заведётся: перед созданием мы всегда проверяем операцию.
        for _key, _box_id in box_keys.items():
            cur.execute(
                "UPDATE marketplace_supply_boxes SET closed_at = COALESCE(closed_at, now()) "
                "WHERE id = %s",
                (int(_box_id),),
            )
        conn.commit()
        return _resp(200, {
            'closedBoxes': len(box_keys),
            'stickersSaved': 0,
            'pending': True,
            'note': 'Короб закрыт. OZON ещё присваивает номер грузоместа — '
                    'этикетка появится через несколько секунд',
        })

    cargo_ids = []
    for c in cargoes_result:
        key = c.get('key')
        value = c.get('value') if isinstance(c.get('value'), dict) else {}
        cargo_id = value.get('cargo_id') or c.get('cargo_id')
        if key in box_keys and cargo_id:
            cargo_ids.append(int(cargo_id))
            cur.execute(
                "UPDATE marketplace_supply_boxes SET ozon_cargo_id = %s, "
                "  closed_at = COALESCE(closed_at, now()), "
                "  ozon_create_operation_id = NULL WHERE id = %s",
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
    label_cargo_ids = cargo_ids
    if one_box_id:
        cur.execute(
            "SELECT ozon_cargo_id FROM marketplace_supply_boxes WHERE id = %s",
            (int(one_box_id),),
        )
        one_row = cur.fetchone()
        if one_row and one_row[0]:
            label_cargo_ids = [int(one_row[0])]

    # ГРУЗОМЕСТО СОЗДАНО — ФИКСИРУЕМ ЭТО ДО ЗАПРОСА ЭТИКЕТКИ.
    #
    # Если запрос этикетки ниже не пройдёт (площадка тормозит, лимит частоты),
    # короб всё равно останется закрытым: место на OZON заведено, и терять эту
    # запись нельзя — иначе повторное нажатие заведёт второе место.
    conn.commit()

    st, lbl = ozon_post('/v1/cargoes-label/create', client_id, api_key, {
        'supply_id': int(ozon_supply_id),
        'cargo_ids': label_cargo_ids,
    })
    label_op = lbl.get('operation_id') if isinstance(lbl, dict) else None
    if label_op:
        # ЗАПОМИНАЕМ ОПЕРАЦИЮ ПО КАЖДОМУ КОРОБУ ПАКЕТА, А НЕ ТОЛЬКО ОДИНОЧНОМУ.
        #
        # Если ниже не успеем дождаться файла, кнопка «Получить этикетку»
        # ПРОДОЛЖИТ эту операцию, а не создаст новую (иначе файл не забирается
        # никогда и мы упираемся в лимит частоты OZON).
        #
        # Раньше operation_id сохранялся только при закрытии одного короба. При
        # закрытии пачкой короба оставались без ссылки на операцию: каждая
        # кнопка «Получить этикетку» заводила новую и тут же упиралась в 429.
        target_ids = [int(one_box_id)] if one_box_id else [
            int(b) for b in box_keys.values()]
        for _bid in target_ids:
            cur.execute(
                "UPDATE marketplace_supply_boxes SET ozon_label_operation_id = %s "
                "WHERE id = %s",
                (str(label_op), _bid),
            )
        conn.commit()

    # ЗА САМИМ ФАЙЛОМ ЗДЕСЬ НЕ ХОДИМ — ЭТО И БЫЛА ПРИЧИНА ОШИБКИ 504.
    #
    # Раньше закрытие короба доделывало всю цепочку в одном вызове: ждало
    # готовности этикетки, скачивало PDF, резало его по страницам и грузило
    # каждую в хранилище. Только скачивание и нарезка занимают несколько
    # секунд, а у функции на всё около 5 — она обрывалась по таймауту уже
    # ПОСЛЕ того, как грузоместо на OZON создано и записано.
    #
    # Кладовщик видел красную ошибку, обновлял страницу — и короб оказывался
    # закрыт и переданным на площадку. Работа сделана, а выглядит как сбой.
    #
    # Теперь закрытие заканчивается здесь: грузоместо создано, номер записан,
    # генерация этикетки запущена и её operation_id сохранён. Файл забирает
    # отдельный короткий вызов fetch_box_label — фронт дёргает его сразу после
    # закрытия. Так каждый запрос укладывается в отведённое время.
    conn.commit()

    return _resp(200, {
        'closedBoxes': 1 if one_box_id else len(cargo_ids),
        # Стикер на этом шаге не сохраняется никогда: его забирает следующий
        # вызов fetch_box_label. Поле оставлено для совместимости с фронтом.
        'stickersSaved': 0,
        'labelPending': bool(label_op),
        'note': 'Короб закрыт, грузоместо создано. Этикетка готовится — '
                'забираем её следующим шагом',
    })


def get_ozon_supply_id(cur, supply_id, ozon_order_id, client_id, api_key):
    """Возвращает внутренний supply_id заявки на стороне OZON.

    Для работы с грузоместами нужен не номер заказа поставки, а внутренний
    supply_id заявки. Выяснять его запросом к площадке КАЖДЫЙ раз нельзя:
    у функции 5 секунд на всё, а один запрос к OZON занимает до 5с — лишний
    поход укладывает операцию в таймаут.

    Значение постоянно на всю жизнь заявки, поэтому держим его в базе и
    ходим в API только при первом обращении.
    """
    cur.execute(
        "SELECT ozon_internal_supply_id FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    row = cur.fetchone()
    if row and row[0]:
        return int(row[0])

    if not ozon_order_id:
        return None
    apps = fetch_application_details(client_id, api_key, [int(ozon_order_id)])
    if not apps or not (apps[0].get('supplies') or []):
        return None
    value = apps[0]['supplies'][0].get('supply_id')
    if not value:
        return None
    cur.execute(
        "UPDATE marketplace_supplies SET ozon_internal_supply_id = %s WHERE id = %s",
        (int(value), int(supply_id)),
    )
    return int(value)


def remember_removal(cur, supply_id, cargo_id):
    """Запоминает грузоместо, которое попросили снять с OZON.

    Площадка подтверждает снятие раньше, чем применяет его, поэтому одного
    запроса мало — место надо добить позже (см. flush_pending_removals).
    """
    cur.execute(
        "INSERT INTO ozon_cargo_removals (supply_id, cargo_id) VALUES (%s, %s) "
        "ON CONFLICT (cargo_id) DO UPDATE SET attempts = ozon_cargo_removals.attempts + 1, "
        "  confirmed_at = NULL",
        (int(supply_id), int(cargo_id)),
    )


def flush_pending_removals(cur, supply_id, ozon_supply_id, client_id, api_key):
    """ДОБИВАЕТ грузоместа, которые OZON обещал снять, но ещё не снял.

    КОРЕНЬ ПРОБЛЕМЫ «ОСИРОТЕВШИХ ДУБЛЕЙ». Снятие места у OZON только на вид
    мгновенное: статус операции отвечает SUCCESS почти сразу, а с заявки
    место пропадает заметно позже — по замерам от 45 секунд.

    Кладовщик переоткрывает короб и через 5-10 секунд закрывает его снова.
    Старое место в этот момент ЕЩЁ ЖИВО, рядом создаётся новое — и на заявке
    оказываются два одинаковых короба с разными штрихкодами. Поймать это по
    ответу площадки было нельзя: она честно отвечала «снято».

    Поэтому перед КАЖДЫМ созданием места мы повторяем снятие для всего, что
    ещё не подтвердилось. Запрос идемпотентный: если место уже исчезло,
    повтор ничего не испортит.

    Возвращает число мест, по которым отправлен повторный запрос.
    """
    cur.execute(
        "SELECT cargo_id FROM ozon_cargo_removals "
        "WHERE supply_id = %s AND confirmed_at IS NULL "
        "ORDER BY requested_at LIMIT 20",
        (int(supply_id),),
    )
    pending = [int(r[0]) for r in cur.fetchall()]
    if not pending or not ozon_supply_id:
        return 0

    st, data = ozon_post('/v1/cargoes/delete', client_id, api_key, {
        'supply_id': int(ozon_supply_id),
        'cargo_ids': pending,
    })
    # Площадка не приняла запрос — не страшно: попробуем в следующий раз,
    # записи остаются неподтверждёнными.
    if st != 200:
        return 0

    cur.execute(
        "UPDATE ozon_cargo_removals SET attempts = attempts + 1 "
        "WHERE supply_id = %s AND confirmed_at IS NULL",
        (int(supply_id),),
    )
    return len(pending)


def confirm_removals(cur, supply_id, alive_ids):
    """Закрывает записи о снятии для мест, которых на заявке уже нет.

    alive_ids — грузоместа, реально существующие на площадке сейчас.
    """
    cur.execute(
        "SELECT cargo_id FROM ozon_cargo_removals "
        "WHERE supply_id = %s AND confirmed_at IS NULL",
        (int(supply_id),),
    )
    gone = [int(r[0]) for r in cur.fetchall() if int(r[0]) not in alive_ids]
    if not gone:
        return 0
    ids_csv = ','.join(str(c) for c in gone)
    cur.execute(
        f"UPDATE ozon_cargo_removals SET confirmed_at = now() "
        f"WHERE cargo_id IN ({ids_csv})"
    )
    return len(gone)


def handle_sync_cargoes(cur, conn, client_id, api_key, body_data):
    """Приводит грузоместа на OZON в соответствие с нашими коробами.

    ЗАЧЕМ. На площадке копятся ГРУЗОМЕСТА-СИРОТЫ — места, которых у нас уже
    нет, а на OZON они висят с полным товарным составом:

      * короб удалили у нас (кнопка «Удалить короб») — грузоместо осталось;
      * переоткрытие не сняло место, а следующее закрытие завело новое;
      * связь оборвалась между созданием места и записью cargo_id к коробу.

    Заявка в итоге ждёт больше коробов, чем реально приедет, и на приёмке
    товар двоится: одинаковый состав под разными штрихкодами.

    Как ищем лишние. Отдельного списка грузомест OZON не отдаёт, но этикетки
    выдаёт постранично — по странице на место, с номером на самой наклейке.
    Читаем эти номера и сверяем с нашими коробами: чего нет у нас — снимаем
    с площадки, чего нет на площадке — показываем кладовщику.

    ПОЧЕМУ ПРОСИМ ЭТИКЕТКИ НА ВСЕ СВОИ МЕСТА, А НЕ НА ОДНО.
    Раньше запрашивалась наклейка на ОДНО любое наше место в расчёте, что
    OZON всё равно пришлёт файл на всю заявку. Площадка перестала так делать
    и отдаёт ровно запрошенное: в файле одна страница. Сверка читала из неё
    одно грузоместо и радостно отвечала «Всё сходится: на OZON 1 грузомест»,
    хотя коробов девять. Проверка превратилась в пустую кнопку, которая
    успокаивала вместо того, чтобы находить расхождения.

    Теперь передаём ВСЕ свои cargo_id: сколько страниц вернулось — столько
    мест площадка подтвердила. Если ответ шире запроса (старое поведение),
    лишние места так же видны и снимаются.

    Ничего не создаёт и наши данные не трогает: только убирает с OZON лишнее.
    """
    supply_id = body_data.get('supplyId')
    if not supply_id:
        return _resp(400, {'error': 'Укажите supplyId'})

    cur.execute(
        "SELECT marketplace, type, ozon_supply_order_id FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    s_row = cur.fetchone()
    if not s_row:
        return _resp(404, {'error': 'Поставка не найдена'})
    if s_row[0] != 'OZON' or s_row[1] != 'FBO':
        return _resp(400, {'error': 'Действие доступно только для поставок OZON FBO'})
    ozon_order_id = s_row[2]

    ozon_supply_id = get_ozon_supply_id(
        cur, supply_id, ozon_order_id, client_id, api_key)
    if not ozon_supply_id:
        return _resp(502, {'error': 'Не удалось получить данные заявки OZON'})

    # Наши грузоместа — эталон. Всё, чего здесь нет, на площадке лишнее.
    cur.execute(
        "SELECT ozon_cargo_id FROM marketplace_supply_boxes "
        "WHERE supply_id = %s AND ozon_cargo_id IS NOT NULL",
        (int(supply_id),),
    )
    ours = {int(r[0]) for r in cur.fetchall()}
    if not ours:
        return _resp(409, {
            'error': 'Нет ни одного закрытого короба — не с чем сверять. '
                     'Закройте короб, потом синхронизируйте',
        })

    # Просим этикетки на ВСЕ свои места: страница вернётся на каждое, которое
    # площадка признаёт живым. Одного «пробного» места здесь мало — ответ
    # тогда состоит из одной страницы, и сверка видит на OZON ровно одно
    # грузоместо независимо от того, сколько их там на самом деле.
    st, lbl = ozon_post('/v1/cargoes-label/create', client_id, api_key, {
        'supply_id': int(ozon_supply_id),
        'cargo_ids': sorted(ours),
    })
    if st == 429:
        return _resp(429, {'error': 'OZON ограничивает частоту запросов — подождите минуту'})
    label_op = lbl.get('operation_id') if isinstance(lbl, dict) else None
    if not label_op:
        return _resp(502, {'error': f'OZON не принял запрос: {ozon_error_text(st, lbl)}'})

    st, got = poll_operation(
        '/v1/cargoes-label/get', client_id, api_key, label_op,
        attempts=4, delay=0.7,
    )
    lbl_result = got.get('result') if isinstance(got, dict) else None
    file_url = lbl_result.get('file_url') if isinstance(lbl_result, dict) else None
    if not file_url:
        return _resp(202, {
            'done': False,
            'note': 'OZON ещё готовит данные — нажмите «Проверить OZON» ещё раз',
        })

    pdf_bytes = download_file(file_url)
    on_ozon = set(split_label_pages(pdf_bytes).keys())

    # РАЗОБРАТЬ ФАЙЛ НЕ ВЫШЛО — МОЛЧА СОГЛАШАТЬСЯ НЕЛЬЗЯ.
    #
    # Пустой разбор (сменился формат наклейки, файл битый) выглядел как
    # «на OZON нет ни одного места»: лишних не нашлось, и кладовщик получал
    # бодрое «Всё сходится» при полностью неизвестном состоянии заявки.
    if not on_ozon:
        return _resp(502, {
            'error': 'Не удалось прочитать грузоместа из ответа OZON — '
                     'сверка не выполнена. Попробуйте ещё раз через минуту',
        })

    # Видим реальный состав заявки — закрываем записи о тех местах, которые
    # уже действительно исчезли. Остальные продолжим добивать.
    confirm_removals(cur, supply_id, on_ozon)
    conn.commit()

    extra = sorted(on_ozon - ours)
    # Наше место, которого на площадке нет: короб у нас закрыт и считается
    # уехавшим, а грузоместа под него на заявке не существует. Именно так
    # выглядела поставка после того, как delete_current_version снёс ранее
    # закрытые места: у нас девять коробов, на OZON три.
    lost = sorted(ours - on_ozon)
    lost_nums = []
    if lost:
        # ЧИНИМ САМИ, А НЕ ПРОСИМ КЛАДОВЩИКА ПЕРЕОТКРЫТЬ КОРОБ.
        #
        # Совет «откройте короб и закройте заново» тут вредный: переоткрытие
        # шлёт на OZON снятие места, которого там и так нет, и занимает у
        # кладовщика по минуте на короб. А чинить нужно ровно одно — забыть
        # мёртвый cargo_id, чтобы короб снова стал кандидатом на отправку.
        #
        # Ставим место в очередь на снятие: если оно на самом деле живо (не
        # прочиталась страница наклейки), перед созданием нового его добьют,
        # и дубля на приёмке не будет.
        cur.execute(
            "SELECT id, box_number FROM marketplace_supply_boxes "
            "WHERE supply_id = %s AND ozon_cargo_id = ANY(%s) ORDER BY box_number",
            (int(supply_id), [int(c) for c in lost]),
        )
        for _bid, _bnum in cur.fetchall():
            lost_nums.append(_bnum)
        for c in lost:
            remember_removal(cur, supply_id, c)
        cur.execute(
            "UPDATE marketplace_supply_boxes SET ozon_cargo_id = NULL, closed_at = NULL, "
            "  sticker_url = NULL, sticker_name = NULL, ozon_label_operation_id = NULL, "
            "  ozon_create_operation_id = NULL "
            "WHERE supply_id = %s AND ozon_cargo_id = ANY(%s)",
            (int(supply_id), [int(c) for c in lost]),
        )
        log_action(
            cur, body_data.get('actorId'), body_data.get('actorName'),
            'ozon_fbo_sync_cargoes', supply_id,
            f'Короба без грузоместа на OZON открыты заново: '
            f'{", ".join(f"№{n}" for n in lost_nums)}',
        )
        conn.commit()

    if not extra:
        if lost:
            nums = ', '.join(f'№{n}' for n in lost_nums)
            return _resp(200, {
                'done': True, 'removed': 0, 'onOzon': len(on_ozon),
                'lost': len(lost),
                'note': f'На OZON {len(on_ozon)} грузомест, а закрытых коробов у нас '
                        f'было {len(ours)}. Без места остались короба {nums} — '
                        f'они снова открыты. Нажмите «Закрыть короба и получить '
                        f'стикеры»: места заведутся, стикеры придут',
            })
        return _resp(200, {
            'done': True, 'removed': 0, 'onOzon': len(on_ozon),
            'note': f'Всё сходится: на OZON {len(on_ozon)} грузомест, столько же у нас',
        })

    # Снимаем лишние. Удаление асинхронное — дожидаемся подтверждения, иначе
    # вернёмся к тому же: место считается снятым, а на деле висит.
    st, data = ozon_post('/v1/cargoes/delete', client_id, api_key, {
        'supply_id': int(ozon_supply_id),
        'cargo_ids': [int(c) for c in extra],
    })
    if st != 200:
        return _resp(502, {'error': f'OZON не дал удалить лишние места: {ozon_error_text(st, data)}'})

    # Запоминаем всё, что попросили снять: площадка применяет это не сразу,
    # и недоснятое надо будет добить перед следующим созданием места.
    for c in extra:
        remember_removal(cur, supply_id, c)
    conn.commit()

    del_op = data.get('operation_id') if isinstance(data, dict) else None
    if del_op:
        st2, res = poll_operation(
            '/v1/cargoes/delete/status', client_id, api_key, del_op,
            attempts=4, delay=0.7,
        )
        state = str(res.get('status', '')).upper() if isinstance(res, dict) else ''
        if state != 'SUCCESS':
            return _resp(202, {
                'done': False,
                'note': f'OZON ещё снимает {len(extra)} лишних грузомест — '
                        f'нажмите «Проверить OZON» ещё раз через минуту',
            })

    log_action(
        cur, body_data.get('actorId'), body_data.get('actorName'),
        'ozon_fbo_sync_cargoes', supply_id,
        f'Сняты лишние грузоместа на OZON: {", ".join(str(c) for c in extra)}',
    )
    conn.commit()

    # Короба, потерявшие место, мы только что открыли заново — они больше не
    # числятся закрытыми, и в остатке на OZON их нет.
    alive = len(ours) - len(lost)
    note = (f'Снято лишних грузомест: {len(extra)}. На OZON осталось {alive} — '
            f'ровно столько, сколько закрытых коробов у нас')
    if lost_nums:
        note += (f'. Короба {", ".join(f"№{n}" for n in lost_nums)} остались без '
                 f'места и снова открыты — нажмите «Закрыть короба и получить стикеры»')

    return _resp(200, {
        'done': True,
        'removed': len(extra),
        'onOzon': alive,
        'lost': len(lost),
        'note': note,
    })


def handle_fetch_box_label(cur, conn, client_id, api_key, body_data):
    """Догружает этикетку уже закрытого короба.

    ЗАЧЕМ ОТДЕЛЬНЫМ ШАГОМ. У функции 5 секунд на всю работу, а один запрос к
    OZON занимает до 5с сам по себе. Закрытие короба и получение этикетки в
    одном вызове не укладывались: грузоместо создавалось, а на этикетке
    функция обрывалась по таймауту и откатывала всё — короб выглядел
    незакрытым, хотя на площадке место уже было заведено.

    Теперь закрытие фиксируется сразу, а этикетка забирается этим действием —
    столько раз, сколько нужно. Оно же чинит короба, закрытые ранее и
    оставшиеся без стикера.
    """
    box_id = body_data.get('boxId')
    if not box_id:
        return _resp(400, {'error': 'Укажите короб'})

    cur.execute(
        "SELECT b.supply_id, b.box_number, b.ozon_cargo_id, b.closed_at, "
        "       b.ozon_label_operation_id, s.ozon_supply_order_id, "
        "       b.ozon_create_operation_id "
        "FROM marketplace_supply_boxes b "
        "JOIN marketplace_supplies s ON s.id = b.supply_id WHERE b.id = %s",
        (int(box_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Короб не найден'})
    (supply_id, box_number, cargo_id, closed_at, saved_op,
     ozon_order_id, create_op) = row

    if not closed_at:
        return _resp(409, {
            'error': 'Сначала закройте короб — этикетку OZON выдаёт на грузоместо',
        })

    # НОМЕРА ГРУЗОМЕСТА ЕЩЁ НЕТ — ЗАБИРАЕМ ЕГО ПО СОХРАНЁННОЙ ОПЕРАЦИИ.
    #
    # Площадка присваивает номер не мгновенно, и закрытие короба его не ждёт.
    # Раньше здесь возвращалась ошибка «сначала закройте короб», хотя короб
    # закрыт, — и единственным выходом казалось переоткрыть его и закрыть
    # заново. Это худшее, что можно посоветовать: при переоткрытии место на
    # OZON снимается, а новое получает ДРУГОЙ номер — наклеенные на короба
    # стикеры приходится переклеивать.
    #
    # Вместо этого доводим до конца ту же операцию создания: номер приходит
    # сам, стикер остаётся прежним.
    if not cargo_id and create_op:
        st_c, info_c = poll_operation(
            '/v2/cargoes/create/info', client_id, api_key, create_op,
            attempts=3, delay=0.6,
        )
        res_c = info_c.get('result') if isinstance(info_c, dict) else None
        items_c = (res_c or {}).get('cargoes') or [] if isinstance(res_c, dict) else []
        for c in items_c:
            val = c.get('value') if isinstance(c.get('value'), dict) else {}
            cid = val.get('cargo_id') or c.get('cargo_id')
            if c.get('key') == f'box-{box_id}' and cid:
                cargo_id = int(cid)
                cur.execute(
                    "UPDATE marketplace_supply_boxes SET ozon_cargo_id = %s, "
                    "  ozon_create_operation_id = NULL WHERE id = %s",
                    (cargo_id, int(box_id)),
                )
                conn.commit()
                break

    if not cargo_id:
        return _resp(202, {
            'ready': False,
            'note': 'OZON ещё присваивает номер грузоместа — нажмите «Получить '
                    'этикетку» ещё раз через несколько секунд',
        })

    # ПРОДОЛЖАЕМ УЖЕ ЗАПУЩЕННУЮ ОПЕРАЦИЮ, А НЕ СОЗДАЁМ НОВУЮ.
    #
    # Этикетка готовится асинхронно: create возвращает operation_id, файл
    # появляется через несколько секунд. Раньше каждое нажатие создавало
    # НОВУЮ операцию и проверяло её один раз — она всегда была IN_PROGRESS.
    # Кладовщик жал снова, операция создавалась заново, и файл не забирался
    # никогда; частые вызовы упирались в лимит частоты OZON (429).
    #
    # Поэтому operation_id запоминаем: повторное нажатие ДОЖИДАЕТСЯ старой
    # операции. Новую заводим, только если сохранённой нет.
    label_op = saved_op
    if not label_op:
        ozon_supply_id = get_ozon_supply_id(
            cur, supply_id, ozon_order_id, client_id, api_key)
        if not ozon_supply_id:
            return _resp(502, {'error': 'Не удалось получить данные заявки OZON'})

        st, lbl = ozon_post('/v1/cargoes-label/create', client_id, api_key, {
            'supply_id': int(ozon_supply_id),
            'cargo_ids': [int(cargo_id)],
        })
        label_op = lbl.get('operation_id') if isinstance(lbl, dict) else None
        if not label_op:
            if st == 429:
                return _resp(429, {
                    'ready': False,
                    'note': 'OZON ограничивает частоту запросов — подождите минуту',
                })
            return _resp(502, {
                'error': f'OZON не принял запрос этикетки: {ozon_error_text(st, lbl)}'})
        # Сохраняем СРАЗУ и отдельным коммитом: если ожидание ниже оборвётся
        # по таймауту, операция не потеряется и следующее нажатие продолжит её.
        cur.execute(
            "UPDATE marketplace_supply_boxes SET ozon_label_operation_id = %s WHERE id = %s",
            (str(label_op), int(box_id)),
        )
        conn.commit()

    # Ждём готовности, но с запасом до таймаута функции: лучше вернуть
    # «ещё готовится» и дать нажать снова, чем оборваться на полпути.
    st, got = poll_operation(
        '/v1/cargoes-label/get', client_id, api_key, label_op,
        attempts=4, delay=0.7,
    )
    if st == 429:
        return _resp(429, {
            'ready': False,
            'note': 'OZON ограничивает частоту запросов — подождите минуту и нажмите снова',
        })
    lbl_result = got.get('result') if isinstance(got, dict) else None
    file_url = lbl_result.get('file_url') if isinstance(lbl_result, dict) else None

    # Операция провалилась на стороне OZON — сбрасываем её, чтобы следующее
    # нажатие запросило этикетку заново, а не ждало мёртвую вечно.
    if isinstance(got, dict) and str(got.get('status', '')).upper() in ('FAILED', 'ERROR'):
        cur.execute(
            "UPDATE marketplace_supply_boxes SET ozon_label_operation_id = NULL WHERE id = %s",
            (int(box_id),),
        )
        conn.commit()
        return _resp(502, {'error': 'OZON не смог подготовить этикетку. Нажмите ещё раз'})

    if not file_url:
        return _resp(202, {
            'ready': False,
            'note': 'OZON ещё готовит этикетку — нажмите ещё раз через несколько секунд',
        })

    pdf_bytes = download_file(file_url)

    # Берём страницу СВОЕГО грузоместа: OZON игнорирует cargo_ids и отдаёт
    # файл со всеми местами заявки.
    pages = split_label_pages(pdf_bytes)
    page_pdf = pages.get(int(cargo_id)) or pdf_bytes

    url = upload_pdf(page_pdf, f'supply-{supply_id}-box-{box_id}')
    # Операцию закрываем: этикетка получена, и при следующем запросе (например,
    # после переоткрытия короба) нужна будет уже новая.
    cur.execute(
        "UPDATE marketplace_supply_boxes SET sticker_url = %s, sticker_name = %s, "
        "  ozon_label_operation_id = NULL WHERE id = %s",
        (url, f'Стикер короба №{box_number}.pdf', int(box_id)),
    )
    conn.commit()

    return _resp(200, {'ready': True, 'url': url, 'boxNumber': box_number})


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

    # УБИРАЕМ ГРУЗОМЕСТО НА OZON И ДОЖИДАЕМСЯ РЕЗУЛЬТАТА.
    #
    # Удаление у OZON АСИНХРОННОЕ: /v1/cargoes/delete отвечает 200 и отдаёт
    # operation_id, а само место исчезает позже. Раньше мы считали успехом
    # сам ответ 200 — и открывали короб, не проверив, снялось ли место.
    #
    # Если удаление не проходило, на площадке оставалось СТАРОЕ грузоместо, а
    # повторное закрытие короба заводило ЕЩЁ ОДНО с тем же составом. На приёмку
    # приезжала пара одинаковых коробов с разными штрихкодами — ровно то
    # задвоение, из-за которого расходится заявка.
    ozon_note = None
    if cargo_id and ozon_order_id:
        ozon_supply_id = get_ozon_supply_id(
            cur, supply_id, ozon_order_id, client_id, api_key)
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

            del_op = data.get('operation_id') if isinstance(data, dict) else None
            if del_op:
                st2, res = poll_operation(
                    '/v1/cargoes/delete/status', client_id, api_key, del_op,
                    attempts=4, delay=0.7,
                )
                state = str(res.get('status', '')).upper() if isinstance(res, dict) else ''
                # Операция явно провалилась — короб оставляем закрытым, иначе
                # получим два места с одинаковым составом.
                if state in ('FAILED', 'ERROR'):
                    return _resp(502, {
                        'error': 'OZON не смог удалить грузоместо. Короб оставлен '
                                 'закрытым, чтобы на площадке не задвоились короба',
                    })
                # Не дождались ответа — тоже не открываем: непонятно, снялось
                # место или нет, а угадывать здесь нельзя.
                if state != 'SUCCESS':
                    return _resp(409, {
                        'error': 'OZON ещё удаляет грузоместо. Подождите минуту '
                                 'и нажмите «Открыть короб» ещё раз',
                    })

            # SUCCESS ОТ OZON — ЕЩЁ НЕ ФАКТ, ЧТО МЕСТО СНЯТО.
            #
            # Площадка подтверждает снятие мгновенно, а применяет его через
            # десятки секунд. Кладовщик успевает закрыть короб заново, пока
            # старое место живо, — и получает два короба на заявке.
            #
            # Поэтому запоминаем место: перед следующим созданием мы добьём
            # его повторным запросом, а закроем запись, только когда оно
            # реально исчезнет с заявки.
            remember_removal(cur, supply_id, cargo_id)
            ozon_note = f'Грузоместо {cargo_id} снято на OZON'

    cur.execute(
        "UPDATE marketplace_supply_boxes SET closed_at = NULL, ozon_cargo_id = NULL, "
        "  sticker_url = NULL, sticker_name = NULL, ozon_label_operation_id = NULL, "
        "  ozon_create_operation_id = NULL WHERE id = %s",
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
    POST /  { action: 'sync_cargoes', supplyId }
        - сверяет грузоместа на OZON с нашими коробами и снимает лишние (сироты от
          удалённых коробов и неудавшихся переоткрытий). Ничего не создаёт.
    POST /  { action: 'fetch_box_label', boxId }
        - догружает этикетку уже закрытого короба (закрытие и этикетка разделены:
          обе операции в один вызов не укладываются в таймаут функции).
          Возвращает 202 с ready=false, если OZON ещё готовит файл.
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
                      'close_boxes', 'all_box_labels', 'reopen_box',
                      'fetch_box_label', 'sync_cargoes'):
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
        if action == 'fetch_box_label':
            return handle_fetch_box_label(cur, conn, client_id, api_key, body_data)
        if action == 'sync_cargoes':
            return handle_sync_cargoes(cur, conn, client_id, api_key, body_data)
    finally:
        conn.close()