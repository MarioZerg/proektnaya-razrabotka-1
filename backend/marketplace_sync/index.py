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


SITE_SHOP_CODE = 'megatul_site'
DEFAULT_SITE_URL = 'https://xn--80aff0ab3b6do.xn--p1ai'


def normalize_site_url(raw):
    """Адрес сайта в виде, понятном серверу: «мегатюль.рф» -> xn--...; без слеша в конце."""
    url = (raw or '').strip().rstrip('/')
    if not url:
        return url
    if '://' not in url:
        url = 'https://' + url
    scheme, rest = url.split('://', 1)
    host, _, path = rest.partition('/')
    try:
        host = host.encode('idna').decode('ascii')
    except UnicodeError:
        pass
    return f"{scheme}://{host}" + (f"/{path}" if path else '')


def _site_settings(cur, shop_id):
    """Если магазин — интернет-магазин мегатюль.рф, вернёт (site_url, api_key, enabled)."""
    cur.execute("SELECT code FROM shops WHERE id = %s", (int(shop_id),))
    row = cur.fetchone()
    if not row or row[0] != SITE_SHOP_CODE:
        return None
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'internet_shop' AND shop_id = %s LIMIT 1",
        (int(shop_id),),
    )
    r = cur.fetchone()
    creds = {}
    enabled = False
    if r:
        enabled = bool(r[0])
        creds = r[1] if isinstance(r[1], dict) else json.loads(r[1] or '{}')
    site_url = normalize_site_url(creds.get('siteUrl') or DEFAULT_SITE_URL)
    return site_url, (creds.get('apiKey') or '').strip(), enabled


def _to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _site_fetch(url, api_key):
    req = urllib.request.Request(
        url,
        headers={'Accept': 'application/json', 'X-Api-Key': api_key,
                 'Authorization': f'Bearer {api_key}'},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8') or '{}')


def _site_units(products):
    """Каталог сайта -> строки ERP: ОДИН артикул размера = одна строка.

    Карточка магазина — полотно и цвет (id стабильный, по нему и сверяемся),
    в sizes — её размеры: {id}-{ширина}x{высота}.
    """
    units = []
    for p in products or []:
        pid = str(p.get('id') or '').strip()
        base_name = (p.get('name') or p.get('title') or '').strip()
        fabric = (p.get('fabric') or p.get('material') or '').strip()
        sizes = p.get('sizes') or p.get('variants') or []
        if not isinstance(sizes, list):
            continue
        for v in sizes:
            w, h = _to_int(v.get('width')), _to_int(v.get('height'))
            sku = str(v.get('sku') or '').strip()
            if not sku and pid and w and h:
                sku = f'{pid}-{w}x{h}'
            if not sku:
                continue
            if not (w and h):
                m = re.search(r'(\d{2,4})x(\d{2,4})$', sku)
                if m:
                    w, h = w or int(m.group(1)), h or int(m.group(2))
            name = f'{base_name} {w}×{h}' if base_name and w and h else (base_name or sku)
            units.append({'sku': sku, 'pid': pid or None, 'name': name,
                          'material': fabric, 'width': w, 'height': h})
    return units


def handle_site_sync(cur, shop_id, site_url, api_key):
    """Товары интернет-магазина мегатюль.рф -> marketplace_items ЭТОГО магазина.

    Правила (только shop_id интеграции «мегатюль.рф», чужие магазины не трогаем):
      * новый артикул размера — новая строка, расход пустой;
      * существующий — обновляем только имя, ткань, ширину и высоту;
        расход (marketplace_item_materials) не трогаем никогда;
      * артикула нет в ответе сайта — archived_at, строку не удаляем:
        заказы и история продаж по sku остаются;
      * артикул вернулся — снимаем архив, расход сохранён;
      * ручные товары (без привязки к карточке сайта) не архивируем.
    """
    try:
        data = _site_fetch(f'{site_url}/api/crm/products', api_key)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return _resp(400, {'error': 'Сайт не принял ключ доступа. Проверьте ключ в «Интеграциях».'})
        if e.code == 404:
            return _resp(400, {'error': 'Сайт не отдаёт каталог (/api/crm/products ответил 404).'})
        return _resp(400, {'error': f'Сайт ответил ошибкой {e.code}'})
    except Exception as e:
        return _resp(400, {'error': f'Сайт недоступен: {e}'})

    products = data.get('products') if isinstance(data, dict) else None
    if not isinstance(products, list):
        return _resp(400, {'error': 'Сайт вернул каталог в непонятном виде — ожидается список products'})
    units = _site_units(products)

    cur.execute(
        "SELECT id, sku, archived_at, site_product_id, internal_sku FROM marketplace_items "
        "WHERE shop_id = %s AND COALESCE(sku, '') NOT LIKE 'dup:%%'",
        (int(shop_id),),
    )
    by_sku = {}
    aliases = {}
    for item_id, sku, archived_at, spid, internal_sku in cur.fetchall():
        if (sku or '').strip():
            by_sku[sku.strip().lower()] = (item_id, archived_at, spid)
        if (internal_sku or '').strip():
            aliases[internal_sku.strip().lower()] = (item_id, archived_at, spid, (sku or '').strip().lower())

    # Пишем пачками: по запросу на каждый артикул база упирается в лимит запросов.
    def q(v):
        if v is None:
            return 'NULL'
        if isinstance(v, int):
            return str(v)
        return "'" + str(v).replace("'", "''") + "'"

    created = updated = restored = 0
    seen = set()
    to_update, to_insert = [], []
    for u in units:
        sku = u['sku'][:100]
        key = sku.lower()
        if key in seen:
            continue
        seen.add(key)
        row = (sku, u['name'][:200], (u['material'] or '')[:100] or None,
               u['width'], u['height'], u['pid'])
        existing = by_sku.get(key)
        if not existing and key in aliases:
            # Сайт перешёл на наш внутренний артикул — это та же строка, а не новый товар.
            item_id, archived_at, spid, old_key = aliases[key]
            existing = (item_id, archived_at, spid)
            seen.add(old_key)
        if existing:
            to_update.append((existing[0], existing[1]) + row)
        else:
            to_insert.append(row)

    for i in range(0, len(to_update), 300):
        chunk = to_update[i:i + 300]
        values = ','.join(
            f"({int(item_id)}, {q(sku)}, {q(name)}, {q(material)}, {q(w)}::int, {q(h)}::int, {q(pid)})"
            for item_id, _arch, sku, name, material, w, h, pid in chunk
        )
        cur.execute(
            "UPDATE marketplace_items mi SET sku = v.sku, name = v.name, material = COALESCE(v.material, mi.material), "
            "  width = v.width, height = v.height, site_product_id = v.pid, "
            "  archived_at = NULL, updated_at = now() "
            f"FROM (VALUES {values}) AS v(id, sku, name, material, width, height, pid) "
            f"WHERE mi.id = v.id AND mi.shop_id = {int(shop_id)} AND ("
            "  mi.sku IS DISTINCT FROM v.sku OR mi.name IS DISTINCT FROM v.name "
            "  OR (v.material IS NOT NULL AND mi.material IS DISTINCT FROM v.material) "
            "  OR mi.width IS DISTINCT FROM v.width OR mi.height IS DISTINCT FROM v.height "
            "  OR mi.site_product_id IS DISTINCT FROM v.pid OR mi.archived_at IS NOT NULL) "
            "RETURNING mi.id"
        )
        changed = {r[0] for r in cur.fetchall()}
        archived_before = {item_id for item_id, arch, *_ in chunk if arch}
        restored += len(changed & archived_before)
        updated += len(changed - archived_before)

    for i in range(0, len(to_insert), 300):
        chunk = to_insert[i:i + 300]
        values = ','.join(
            f"({q(name)}, {q(sku)}, {q(material)}, {q(w)}, {q(h)}, {int(shop_id)}, {q(pid)})"
            for sku, name, material, w, h, pid in chunk
        )
        cur.execute(
            "INSERT INTO marketplace_items (name, sku, material, width, height, shop_id, site_product_id) "
            f"VALUES {values}"
        )
        created += len(chunk)

    # В архив — только товары, пришедшие с сайта (site_product_id заполнен),
    # и только если каталог не пустой: сбой сайта не должен убрать весь ассортимент.
    archived = 0
    if seen:
        gone = [item_id for k, (item_id, archived_at, spid) in by_sku.items()
                if k not in seen and not archived_at and spid]
        if gone:
            ids_csv = ','.join(str(int(i)) for i in gone)
            cur.execute(
                f"UPDATE marketplace_items SET archived_at = now(), updated_at = now() "
                f"WHERE id IN ({ids_csv}) AND shop_id = {int(shop_id)} AND archived_at IS NULL"
            )
            archived = cur.rowcount

    return _resp(200, {
        'created': created,
        'linked': updated,
        'updated': updated,
        'restored': restored,
        'archived': archived,
        'ozonCards': 0,
        'wbCards': 0,
        'siteProducts': len(products),
        'siteCards': len(seen),
        'totalArticles': len(seen),
        'skipped': max(0, len(seen) - created - updated - restored),
        'warnings': [],
    })


def handle_sync(cur, shop_id):
    site = _site_settings(cur, shop_id)
    if site is not None:
        site_url, api_key, enabled = site
        if not api_key or not enabled:
            return _resp(400, {'error': 'Магазин мегатюль.рф не подключён: заполните ключ доступа '
                                        'в «Интеграциях» на вкладке магазина и включите интеграцию.'})
        return handle_site_sync(cur, shop_id, site_url, api_key)

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
    """Синхронизация карточек товаров из OZON и Wildberries (или с сайта мегатюль.рф) в справочник marketplace_items.
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