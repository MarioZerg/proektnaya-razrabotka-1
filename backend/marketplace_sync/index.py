import json
import os
import re
import urllib.request
import urllib.error

import psycopg2

# Синхронизация карточек товаров из OZON и Wildberries в справочник marketplace_items.
# Тянет реально заведённые на площадках карточки и ДОБАВЛЯЕТ недостающие (существующие
# не трогает — ручные правки сохраняются). Товары OZON и WB объединяются по артикулу
# (offer_id OZON = vendorCode WB = наш sku): в одну карточку пишем и ozon_sku, и wb_sku.
# Материал/расход не заполняем — их укажут сотрудники; товар всё равно попадёт на конвейер.

OZON_API_BASE = 'https://api-seller.ozon.ru'
WB_CONTENT_BASE = 'https://content-api.wildberries.ru'

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False),
    }


def parse_size_from_sku(sku):
    """Ширина/высота из артикула вида 'vyal4_290' или '2vyal3_260' -> (400, 290) / (300, 260).
    Ширина = последняя цифра перед '_' умноженная на 100, высота = число после '_'."""
    if not sku:
        return None, None
    m = re.match(r'^.*?(\d)_(\d{2,3})$', str(sku))
    if not m:
        return None, None
    width = int(m.group(1)) * 100
    height = int(m.group(2))
    return width, height


# ---------- OZON ----------

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


def fetch_ozon_cards(client_id, api_key):
    """Все карточки товаров OZON. Возвращает список dict: offer_id, ozon_sku, name, barcode."""
    cards = []
    last_id = ''
    for _ in range(100):  # страховка от бесконечного цикла (до 100 страниц по 1000)
        status, data = ozon_post(
            '/v3/product/list', client_id, api_key,
            {'filter': {'visibility': 'ALL'}, 'last_id': last_id, 'limit': 1000},
        )
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(_ozon_err(status, data))
        result = data.get('result') or {}
        items = result.get('items') or []
        if not items:
            break
        product_ids = [it.get('product_id') for it in items if it.get('product_id')]
        details = fetch_ozon_info(client_id, api_key, product_ids)
        cards.extend(details)
        last_id = result.get('last_id') or ''
        if not last_id or len(items) < 1000:
            break
    return cards


def fetch_ozon_info(client_id, api_key, product_ids):
    """Детали товаров OZON по product_id (/v3/product/info/list): offer_id, sku, barcode, name."""
    if not product_ids:
        return []
    status, data = ozon_post(
        '/v3/product/info/list', client_id, api_key, {'product_id': product_ids},
    )
    if status != 200 or not isinstance(data, dict):
        raise RuntimeError(_ozon_err(status, data))
    items = (data.get('items') or (data.get('result') or {}).get('items') or [])
    out = []
    for it in items:
        barcode = it.get('barcode') or ''
        if not barcode:
            bcs = it.get('barcodes') or []
            barcode = bcs[0] if bcs else ''
        out.append({
            'offer_id': (it.get('offer_id') or '').strip(),
            'ozon_sku': str(it.get('sku') or it.get('fbo_sku') or it.get('fbs_sku') or '').strip(),
            'name': (it.get('name') or '').strip(),
            'barcode': str(barcode or '').strip(),
        })
    return out


def _ozon_err(status, data):
    if isinstance(data, dict):
        return data.get('message') or json.dumps(data, ensure_ascii=False)
    return f'OZON ошибка {status}: {data}'


# ---------- Wildberries ----------

def get_wb_credentials(cur):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'wildberries' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        return None, False
    is_enabled = bool(row[0])
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('apiKey') or '').strip(), is_enabled


def fetch_wb_cards(api_key):
    """Все карточки товаров WB (content/v2/get/cards/list). Возвращает список dict:
    vendor_code (артикул продавца), wb_sku (nmID), name, barcode."""
    cards = []
    cursor = {'limit': 100}
    for _ in range(200):
        payload = {'settings': {'cursor': cursor, 'filter': {'withPhoto': -1}}}
        body = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            WB_CONTENT_BASE + '/content/v2/get/cards/list', method='POST', data=body,
        )
        req.add_header('Authorization', api_key)
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                data = json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', errors='replace')
            raise RuntimeError(f'WB ошибка {e.code}: {detail}')
        except Exception as e:
            raise RuntimeError(f'WB ошибка соединения: {e}')

        page_cards = data.get('cards') or []
        for c in page_cards:
            barcode = ''
            for s in (c.get('sizes') or []):
                skus = s.get('skus') or []
                if skus:
                    barcode = str(skus[0])
                    break
            cards.append({
                'vendor_code': (c.get('vendorCode') or '').strip(),
                'wb_sku': str(c.get('nmID') or '').strip(),
                'name': (c.get('title') or c.get('subjectName') or '').strip(),
                'barcode': barcode.strip(),
            })

        rc = (data.get('cursor') or {})
        total = rc.get('total', 0)
        if total < 100:
            break
        cursor = {'updatedAt': rc.get('updatedAt'), 'nmID': rc.get('nmID'), 'limit': 100}
    return cards


# ---------- Синхронизация ----------

def handle_sync(cur):
    client_id, ozon_key, ozon_on = get_ozon_credentials(cur)
    wb_key, wb_on = get_wb_credentials(cur)

    # Собираем товары по артикулу: sku -> {name, ozon_sku, wb_sku, barcode}
    merged = {}
    errors = []
    ozon_count = 0
    wb_count = 0

    if ozon_on and client_id and ozon_key:
        try:
            for c in fetch_ozon_cards(client_id, ozon_key):
                key = c['offer_id']
                if not key:
                    continue
                ozon_count += 1
                m = merged.setdefault(key, {'name': '', 'ozon_sku': '', 'wb_sku': '', 'barcode': ''})
                m['ozon_sku'] = c['ozon_sku'] or m['ozon_sku']
                m['name'] = c['name'] or m['name']
                m['barcode'] = c['barcode'] or m['barcode']
        except Exception as e:
            errors.append(f'OZON: {e}')
    elif ozon_on:
        errors.append('OZON: не заполнены Client-Id / Api-Key')

    if wb_on and wb_key:
        try:
            for c in fetch_wb_cards(wb_key):
                key = c['vendor_code']
                if not key:
                    continue
                wb_count += 1
                m = merged.setdefault(key, {'name': '', 'ozon_sku': '', 'wb_sku': '', 'barcode': ''})
                m['wb_sku'] = c['wb_sku'] or m['wb_sku']
                m['name'] = m['name'] or c['name']
                m['barcode'] = m['barcode'] or c['barcode']
        except Exception as e:
            errors.append(f'WB: {e}')
    elif wb_on:
        errors.append('WB: не заполнен Api-Key')

    if not merged and errors:
        return _resp(400, {'error': '; '.join(errors)})

    # Уже существующие артикулы — их не трогаем (добавляем только новые).
    cur.execute("SELECT sku FROM marketplace_items WHERE sku IS NOT NULL")
    existing = {r[0] for r in cur.fetchall()}

    created = 0
    for sku, data in merged.items():
        if sku in existing:
            continue
        width, height = parse_size_from_sku(sku)
        name = data['name'] or sku
        cur.execute(
            "INSERT INTO marketplace_items (name, sku, ozon_sku, wb_sku, barcode, width, height) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                name[:200], sku[:100],
                (data['ozon_sku'] or None), (data['wb_sku'] or None), (data['barcode'] or None),
                width, height,
            ),
        )
        created += 1

    return _resp(200, {
        'created': created,
        'ozonCards': ozon_count,
        'wbCards': wb_count,
        'totalArticles': len(merged),
        'skipped': len(merged) - created,
        'warnings': errors,
    })


def handler(event: dict, context) -> dict:
    """Синхронизация карточек товаров из OZON и Wildberries в справочник marketplace_items.
    Добавляет новые карточки (по артикулу), существующие не изменяет."""
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    if method != 'POST':
        return _resp(405, {'error': 'Метод не поддерживается'})

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    if action != 'sync':
        return _resp(400, {'error': 'Неизвестное действие'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        result = handle_sync(cur)
        conn.commit()
        return result
    finally:
        conn.close()
