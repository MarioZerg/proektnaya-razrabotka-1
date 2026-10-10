import json
import os
import re
import urllib.request
import urllib.error

import psycopg2

# Синхронизация карточек товаров из OZON и Wildberries в справочник marketplace_items.
# Тянет реально заведённые на площадках карточки и добавляет недостающие артикулы.
# Уже заполненный артикул и уже заполненные коды площадок не перезаписывает —
# ручная правка сохраняется. Пустые поля дописывает: у карточки без артикула
# ставит offer_id / vendorCode, у карточки без кода OZON или баркода WB —
# числовой SKU и 13-значный баркод с площадки.
# Товары OZON и WB объединяются по артикулу продавца (offer_id = vendorCode = sku).
# Материал/расход не заполняем — их укажут сотрудники.
#
# Магазинов несколько (МЕГАТЮЛЬ, ДЮНА), у каждого свой кабинет на площадке и свои
# ключи. Поэтому синхронизация всегда идёт по конкретному магазину: карточки ДЮНЫ
# должны лечь под её shop_id, иначе они смешаются с чужим ассортиментом. Артикулы
# у магазинов могут совпадать — сравниваем существующие только внутри магазина.

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

def get_ozon_credentials(cur, shop_id):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'ozon' AND shop_id = %s LIMIT 1",
        (int(shop_id),),
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


def _ozon_numeric_sku(item):
    """Числовой SKU карточки OZON. Ноль и пустое значение — это «кода нет»."""
    candidates = []
    for key in ('sku', 'fbs_sku', 'fbo_sku'):
        val = item.get(key)
        if val and str(val).strip() not in ('0',):
            candidates.append(str(val).strip())
    for src in item.get('sources') or []:
        val = src.get('sku')
        if val and str(val).strip() not in ('0',):
            candidates.append(str(val).strip())
    for val in candidates:
        if val.isdigit() and len(val) >= 6:
            return val
    return candidates[0] if candidates else ''


def fetch_ozon_cards(client_id, api_key):
    """Все карточки товаров OZON. Возвращает (список, предупреждения).

    Список уже содержит offer_id. Детали (числовой SKU и название) добираем
    отдельно: если OZON отверг пачку, артикул с этой страницы всё равно остаётся,
    а в предупреждение попадает текст ошибки.
    """
    cards = []
    warnings = []
    last_id = ''
    for _ in range(100):
        status, data = ozon_post(
            '/v3/product/list', client_id, api_key,
            {'filter': {'visibility': 'ALL'}, 'last_id': last_id, 'limit': 1000},
        )
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(_ozon_err(status, data))
        result = data.get('result') or data
        items = result.get('items') or []
        if not items:
            break
        by_offer = {}
        product_ids = []
        for it in items:
            offer = (it.get('offer_id') or '').strip()
            if it.get('product_id'):
                product_ids.append(it.get('product_id'))
            if offer:
                by_offer[offer] = {
                    'offer_id': offer,
                    'ozon_sku': '',
                    'name': '',
                }
        try:
            for detail in fetch_ozon_info(client_id, api_key, product_ids):
                key = detail['offer_id']
                if not key:
                    continue
                row = by_offer.setdefault(key, {'offer_id': key, 'ozon_sku': '', 'name': ''})
                row['ozon_sku'] = detail['ozon_sku'] or row['ozon_sku']
                row['name'] = detail['name'] or row['name']
        except RuntimeError as exc:
            warnings.append(str(exc))
        cards.extend(by_offer.values())
        last_id = result.get('last_id') or ''
        if not last_id or len(items) < 1000:
            break
    return cards, warnings


def fetch_ozon_info(client_id, api_key, product_ids):
    """Детали товаров OZON по product_id: offer_id, числовой sku, название.

    Пачками по 200. Сначала идентификаторы строками — так принимает текущий
    /v3/product/info/list. Если кабинет ждёт числа, ту же пачку повторяем числами.
    """
    ids = [str(pid) for pid in product_ids if pid]
    if not ids:
        return []
    out = []
    for start in range(0, len(ids), 200):
        chunk = ids[start:start + 200]
        status, data = ozon_post(
            '/v3/product/info/list', client_id, api_key, {'product_id': chunk},
        )
        if status != 200 or not isinstance(data, dict):
            ints = []
            for pid in chunk:
                try:
                    ints.append(int(pid))
                except ValueError:
                    pass
            status, data = ozon_post(
                '/v3/product/info/list', client_id, api_key, {'product_id': ints},
            )
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(_ozon_err(status, data))
        items = (data.get('items') or (data.get('result') or {}).get('items') or [])
        for it in items:
            out.append({
                'offer_id': (it.get('offer_id') or '').strip(),
                'ozon_sku': _ozon_numeric_sku(it),
                'name': (it.get('name') or '').strip(),
            })
    return out


def _ozon_err(status, data):
    if isinstance(data, dict):
        return data.get('message') or json.dumps(data, ensure_ascii=False)
    return f'OZON ошибка {status}: {data}'


# ---------- Wildberries ----------

def get_wb_credentials(cur, shop_id):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'wildberries' AND shop_id = %s LIMIT 1",
        (int(shop_id),),
    )
    row = cur.fetchone()
    if not row:
        return None, False
    is_enabled = bool(row[0])
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('apiKey') or '').strip(), is_enabled


def fetch_wb_cards(api_key):
    """Все карточки товаров WB (content/v2/get/cards/list).

    wb_sku — 13-значный баркод из размера (им заявляют поставку).
    wb_nm_id — номер номенклатуры nmID, отдельно от баркода.
    """
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
            nm = c.get('nmID')
            cards.append({
                'vendor_code': (c.get('vendorCode') or '').strip(),
                'wb_sku': barcode.strip(),
                'wb_nm_id': str(nm).strip() if nm else '',
                'name': (c.get('title') or c.get('subjectName') or '').strip(),
            })

        rc = (data.get('cursor') or {})
        total = rc.get('total', 0)
        if total < 100:
            break
        cursor = {'updatedAt': rc.get('updatedAt'), 'nmID': rc.get('nmID'), 'limit': 100}
    return cards


# ---------- Синхронизация ----------

def _blank(value):
    return not str(value or '').strip()


def _norm_name(name):
    return re.sub(r'\s+', ' ', str(name or '').strip().lower())


def _ozon_barcode(ozon_sku):
    """Код для поставки FBO, как он уже лежит в справочнике: OZN + числовой SKU."""
    sku = str(ozon_sku or '').strip()
    if not sku or sku == '0':
        return ''
    return f'OZN{sku}'


def _wb_barcode(value):
    """В wb_sku хранится баркод WB (13 цифр), не номер номенклатуры."""
    text = str(value or '').strip()
    if text.isdigit() and len(text) >= 8:
        return text
    return ''


def _empty_card():
    return {'name': '', 'ozon_sku': '', 'wb_sku': '', 'wb_nm_id': ''}


def _load_shop_items(cur, shop_id):
    """Карточки магазина: с артикулом и без. Чужой магазин сюда не попадает."""
    cur.execute(
        "SELECT id, sku, ozon_sku, wb_sku, barcode, wb_nm_id, name "
        "FROM marketplace_items WHERE shop_id = %s",
        (int(shop_id),),
    )
    by_sku = {}
    by_sku_ci = {}
    blank = []
    for row in cur.fetchall():
        item = {
            'id': row[0],
            'sku': (row[1] or '').strip(),
            'ozon_sku': (row[2] or '').strip(),
            'wb_sku': (row[3] or '').strip(),
            'barcode': (row[4] or '').strip(),
            'wb_nm_id': row[5],
            'name': row[6] or '',
        }
        if item['sku']:
            by_sku[item['sku']] = item
            by_sku_ci.setdefault(item['sku'].lower(), []).append(item)
        else:
            blank.append(item)
    return by_sku, by_sku_ci, blank


def _find_blank(blank, data, name_counts):
    """Карточка без артикула, которая и есть эта карточка площадки.

    Сначала код OZON, баркод WB и штрихкод OZN. Название — только когда
    и в справочнике, и на площадке оно одно такое.
    """
    ozon = data.get('ozon_sku') or ''
    wb = _wb_barcode(data.get('wb_sku'))
    code = _ozon_barcode(ozon)
    for item in blank:
        if ozon and item['ozon_sku'] == ozon:
            return item
        if wb and item['wb_sku'] == wb:
            return item
        if code and item['barcode'] == code:
            return item
    name = _norm_name(data.get('name'))
    if not name or name_counts.get(name) != 1:
        return None
    same = [item for item in blank if _norm_name(item['name']) == name]
    if len(same) == 1:
        return same[0]
    return None


def _fill_item(cur, item, data, sku=None):
    """Дописывает только пустые поля. Заполненный артикул и коды не меняет."""
    fields = []
    params = []
    visible = False
    if sku and _blank(item['sku']):
        fields.append('sku = %s')
        params.append(sku[:100])
        item['sku'] = sku[:100]
        visible = True
        width, height = parse_size_from_sku(sku)
        if width and height:
            fields.append('width = COALESCE(width, %s)')
            fields.append('height = COALESCE(height, %s)')
            params.extend([width, height])
    ozon = (data.get('ozon_sku') or '').strip()
    if ozon and ozon != '0' and _blank(item['ozon_sku']):
        fields.append('ozon_sku = %s')
        params.append(ozon[:100])
        item['ozon_sku'] = ozon[:100]
        visible = True
    wb = _wb_barcode(data.get('wb_sku'))
    if wb and _blank(item['wb_sku']):
        fields.append('wb_sku = %s')
        params.append(wb[:100])
        item['wb_sku'] = wb[:100]
        visible = True
    code = _ozon_barcode(item['ozon_sku'])
    if code and _blank(item['barcode']):
        fields.append('barcode = %s')
        params.append(code[:100])
        item['barcode'] = code[:100]
        visible = True
    nm = str(data.get('wb_nm_id') or '').strip()
    if nm.isdigit() and not item.get('wb_nm_id'):
        fields.append('wb_nm_id = %s')
        params.append(int(nm))
        item['wb_nm_id'] = int(nm)
    if not fields:
        return False
    fields.append('updated_at = now()')
    params.append(item['id'])
    cur.execute(
        f"UPDATE marketplace_items SET {', '.join(fields)} WHERE id = %s",
        params,
    )
    return visible


def handle_sync(cur, shop_id):
    client_id, ozon_key, ozon_on = get_ozon_credentials(cur, shop_id)
    wb_key, wb_on = get_wb_credentials(cur, shop_id)

    merged = {}
    errors = []
    ozon_count = 0
    wb_count = 0

    if ozon_on and client_id and ozon_key:
        try:
            cards, ozon_warnings = fetch_ozon_cards(client_id, ozon_key)
            errors.extend(f'OZON: {w}' for w in ozon_warnings)
            for c in cards:
                key = c['offer_id']
                if not key:
                    continue
                ozon_count += 1
                m = merged.setdefault(key, _empty_card())
                m['ozon_sku'] = c['ozon_sku'] or m['ozon_sku']
                m['name'] = c['name'] or m['name']
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
                m = merged.setdefault(key, _empty_card())
                m['wb_sku'] = c['wb_sku'] or m['wb_sku']
                m['wb_nm_id'] = c['wb_nm_id'] or m['wb_nm_id']
                m['name'] = m['name'] or c['name']
        except Exception as e:
            errors.append(f'WB: {e}')
    elif wb_on:
        errors.append('WB: не заполнен Api-Key')

    if not ozon_on and not wb_on:
        return _resp(400, {'error': 'У магазина не включены интеграции OZON и Wildberries — '
                                    'заполните ключи в разделе «Интеграции»'})

    if not merged and errors:
        return _resp(400, {'error': '; '.join(errors)})

    # Артикул другого магазина не помеха: у ДЮНЫ может быть свой vyal3_260.
    by_sku, by_sku_ci, blank = _load_shop_items(cur, shop_id)
    name_counts = {}
    for data in merged.values():
        name = _norm_name(data.get('name'))
        if name:
            name_counts[name] = name_counts.get(name, 0) + 1

    created = 0
    linked = 0
    for sku, data in merged.items():
        item = by_sku.get(sku)
        if not item:
            folded = by_sku_ci.get(sku.lower()) or []
            if len(folded) == 1:
                item = folded[0]
        if item:
            if _fill_item(cur, item, data):
                linked += 1
            continue

        target = _find_blank(blank, data, name_counts)
        if target:
            if _fill_item(cur, target, data, sku=sku):
                linked += 1
            blank.remove(target)
            by_sku[target['sku']] = target
            by_sku_ci.setdefault(target['sku'].lower(), []).append(target)
            continue

        width, height = parse_size_from_sku(sku)
        name = data['name'] or sku
        ozon = (data['ozon_sku'] or '').strip() or None
        wb = _wb_barcode(data.get('wb_sku')) or None
        code = _ozon_barcode(ozon) or None
        nm = str(data.get('wb_nm_id') or '').strip()
        nm_value = int(nm) if nm.isdigit() else None
        cur.execute(
            "INSERT INTO marketplace_items "
            "(name, sku, ozon_sku, wb_sku, barcode, width, height, shop_id, wb_nm_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                name[:200], sku[:100], ozon, wb, code,
                width, height, int(shop_id), nm_value,
            ),
        )
        created += 1

    return _resp(200, {
        'created': created,
        'linked': linked,
        'ozonCards': ozon_count,
        'wbCards': wb_count,
        'totalArticles': len(merged),
        'skipped': max(0, len(merged) - created - linked),
        'warnings': errors,
    })


def handler(event: dict, context) -> dict:
    """Синхронизация карточек товаров из OZON и Wildberries в справочник marketplace_items.
    Добавляет новые артикулы и дописывает пустые коды площадок на уже заведённые карточки.
    Заполненный артикул и заполненные коды не перезаписывает.

    POST / { action: 'sync', shopId } — shopId обязателен: ключи площадок у каждого
    магазина свои, и карточки должны лечь под его shop_id."""
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    if method != 'POST':
        return _resp(405, {'error': 'Метод не поддерживается'})

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    if action != 'sync':
        return _resp(400, {'error': 'Неизвестное действие'})

    shop_id = body_data.get('shopId')
    if not shop_id:
        return _resp(400, {'error': 'Не указан магазин'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        result = handle_sync(cur, int(shop_id))
        conn.commit()
        return result
    finally:
        conn.close()