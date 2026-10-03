"""МЕГАМАГ — помощник менеджера по кабинетам маркетплейсов (OZON, WB, Яндекс Маркет).

Это не МЕГАБУХ. Бухгалтерию, 1С, налоги, зарплаты, раскрой и склад цеха не трогает.
Только витрина и кабинет продавца: карточки, SEO, реклама, что требует внимания.

ГЛАВНОЕ ПРАВИЛО — ТОЛЬКО ЧТЕНИЕ.
- Postgres: соединение READ ONLY, запросы — фиксированные SELECT из кода
  (модель SQL не пишет).
- Площадки: только методы из белого списка READ_ENDPOINTS. У OZON / WB / Яндекса
  списки карточек часто отдаются через POST — это чтение, а не запись.
  Цены, карточки, кампании и объявления агент не меняет.
- Ключи площадок читаются из marketplace_integrations (вкладка «Интеграции
  маркетплейсов» в CRM) и никогда не попадают в текст для модели.

POST { question, history?, userId, role? }
"""

import json
import os
import socket
import threading
import time
import re
import html as html_lib
import ipaddress
import urllib.error
import urllib.parse
import urllib.request

import psycopg2

# Основной API и зеркало: у части провайдеров блокируют api.aitunnel.ru —
# тогда тот же ключ и пути работают на ru-api.
AITUNNEL_BASES = (
    'https://api.aitunnel.ru/v1',
    'https://ru-api.aitunnel.ru/v1',
)
# Запас, если ключ без белого списка и auto не ответил.
DEFAULT_MODEL = 'openai/gpt-6-luna-pro'
MODEL_CANDIDATES = [
    DEFAULT_MODEL,
    'gpt-6-luna-pro',
    'gpt-6.1-sol-pro',
    'gpt-4o-mini',
    'gpt-4.1-mini',
    'gpt-5-mini',
    'gpt-5.4-mini',
    'gpt-4.1-nano',
]
MAX_STEPS = 6
MAX_TOOL_CHARS = 14000
MP_TIMEOUT = 8
# Живое чтение кабинета (prefetch) должно уложиться сюда — остальное время модели.
LIVE_BUDGET = 14


def _parallel(jobs, budget):
    """Запускает [(key, fn, args)] параллельно; что не успело за budget секунд — None."""
    from concurrent.futures import ThreadPoolExecutor, wait
    if not jobs:
        return {}
    ex = ThreadPoolExecutor(max_workers=min(8, len(jobs)))
    futs = {ex.submit(fn, *args): key for key, fn, args in jobs}
    done, _ = wait(futs, timeout=max(1, budget))
    out = {}
    for f, key in futs.items():
        if f in done:
            try:
                out[key] = f.result()
            except Exception as e:
                out[key] = e
        else:
            out[key] = None
    ex.shutdown(wait=False, cancel_futures=True)
    return out

OZON_API = 'https://api-seller.ozon.ru'
WB_CONTENT_API = 'https://content-api.wildberries.ru'
WB_ADVERT_API = 'https://advert-api.wildberries.ru'
YM_API = 'https://api.partner.market.yandex.ru'

MARKETPLACES = ('ozon', 'wildberries', 'yandex_market')
MP_TITLES = {'ozon': 'OZON', 'wildberries': 'Wildberries', 'yandex_market': 'Яндекс Маркет'}

# Официальные справки площадок — единственное, что агент ищет и читает в сети.
ALLOWED_DOMAINS = (
    'seller-edu.ozon.ru',
    'docs.ozon.ru',
    'seller.wildberries.ru',
    'dev.wildberries.ru',
)
# yandex.ru — только раздел /support.
YANDEX_SUPPORT_HOST = 'yandex.ru'
YANDEX_SUPPORT_PATH = '/support'
ALLOWED_SITE_TOKENS = ALLOWED_DOMAINS + ('yandex.ru/support',)


# ---------------------------------------------------------------- доступ

def _access(cur, schema, user_id, requested_role):
    """МЕГАМАГ — менеджеру. Админ проходит, если явно переключился на role=manager."""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return False, ''
    cur.execute(
        f"SELECT role, is_active, full_name FROM {schema}.users WHERE id = %s", (uid,),
    )
    row = cur.fetchone()
    if not row or not row[1]:
        return False, ''
    roles = set()
    if row[0]:
        roles.add(row[0])
    cur.execute(
        f"SELECT role FROM {schema}.user_roles WHERE user_id = %s AND is_approved = true",
        (uid,),
    )
    roles |= {r[0] for r in cur.fetchall()}
    full_name = (row[2] or '').strip()
    want = (requested_role or '').strip()
    if 'manager' in roles and want in ('', 'manager'):
        return True, full_name
    if 'admin' in roles and want == 'manager':
        return True, full_name
    return False, ''


def _given_name(full_name):
    parts = [p for p in re.split(r'\s+', (full_name or '').strip()) if p]
    if not parts:
        return ''
    if len(parts) >= 3:
        return parts[1]
    if len(parts) == 2 and re.search(
        r'(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкая)$', parts[0], re.I,
    ):
        return parts[1]
    return parts[0]


# ---------------------------------------------------------------- база (только чтение)

def _ro_conn(dsn):
    conn = psycopg2.connect(dsn, connect_timeout=5)
    # ГЛАВНАЯ ЗАЩИТА: транзакция только для чтения — запись отклонит сама база.
    # Через set_session(readonly) прокси базы зависал, поэтому команда идёт первой
    # в транзакции. Коммита нет: соединение закрывается после чтения.
    conn.cursor().execute("SET TRANSACTION READ ONLY")
    return conn


def _table_columns(cur, schema, table):
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s",
        (schema, table),
    )
    return {r[0] for r in cur.fetchall()}


def _shops(cur, schema):
    cur.execute(f"SELECT id, code, name FROM {schema}.shops WHERE is_active = true ORDER BY sort_order, id")
    return [{'id': r[0], 'code': r[1], 'name': r[2]} for r in cur.fetchall()]


def _resolve_shop(cur, schema, shop_ref):
    """shop_id может прийти числом, кодом (megatul/duna) или названием (МЕГАТЮЛЬ/ДЮНА)."""
    if shop_ref in (None, '', 0, '0', 'all'):
        return None
    ref = str(shop_ref).strip().lower()
    for s in _shops(cur, schema):
        if ref in (str(s['id']), (s['code'] or '').lower(), (s['name'] or '').lower()):
            return s
    return 'unknown'


def _load_creds(cur, schema, marketplace, shop_id):
    """Ключи площадки из CRM. Наружу (модели) не отдаются."""
    if shop_id:
        cur.execute(
            f"SELECT is_enabled, credentials, shop_id FROM {schema}.marketplace_integrations "
            f"WHERE marketplace_code = %s AND shop_id = %s LIMIT 1",
            (marketplace, int(shop_id)),
        )
    else:
        cur.execute(
            f"SELECT is_enabled, credentials, shop_id FROM {schema}.marketplace_integrations "
            f"WHERE marketplace_code = %s "
            f"ORDER BY is_enabled DESC, (credentials::text <> '{{}}') DESC, shop_id LIMIT 1",
            (marketplace,),
        )
    row = cur.fetchone()
    if not row:
        return None, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds or {}, bool(row[0])


def _rows_text(cur, title, limit=40):
    rows = cur.fetchmany(limit)
    if not rows:
        return f'{title}: нет'
    cols = [d[0] for d in cur.description]
    lines = [f'{title}:', ' | '.join(cols)]
    for r in rows:
        lines.append(' | '.join('' if v is None else str(v) for v in r))
    if len(rows) == limit:
        lines.append(f'... показаны первые {limit}')
    return '\n'.join(lines)


def _mp_list(marketplace):
    m = (marketplace or 'all').strip().lower()
    if m in ('wb', 'вб'):
        m = 'wildberries'
    if m in ('ym', 'yandex', 'яндекс'):
        m = 'yandex_market'
    if m in MARKETPLACES:
        return [m]
    return list(MARKETPLACES)


def _overview(cur, schema, shop):
    out = []
    shops = _shops(cur, schema)
    out.append('МАГАЗИНЫ (shop_id | код | название):')
    for s in shops:
        out.append(f"{s['id']} | {s['code']} | {s['name']}")
    cur.execute(
        f"SELECT mi.shop_id, mi.marketplace_code, mi.is_enabled, "
        f"  (mi.credentials::text <> '{{}}') AS has_keys, mi.updated_at "
        f"FROM {schema}.marketplace_integrations mi "
        f"WHERE mi.marketplace_code = ANY(%s) "
        f"  AND (%s::int IS NULL OR mi.shop_id = %s::int) "
        f"ORDER BY mi.shop_id, mi.marketplace_code",
        (list(MARKETPLACES), shop and shop['id'], shop and shop['id']),
    )
    out.append(_rows_text(cur, 'ПОДКЛЮЧЕНИЯ КАБИНЕТОВ (ключи не показываются)'))
    cols = _table_columns(cur, schema, 'marketplace_items')
    ym = "count(*) FILTER (WHERE COALESCE(ym_sku,'') <> '')" if 'ym_sku' in cols else 'NULL'
    cur.execute(
        f"SELECT s.name AS shop, count(i.id) AS items, "
        f"  count(*) FILTER (WHERE COALESCE(i.ozon_sku,'') <> '') AS on_ozon, "
        f"  count(*) FILTER (WHERE i.wb_nm_id IS NOT NULL OR COALESCE(i.wb_sku,'') <> '') AS on_wb, "
        f"  {ym.replace('ym_sku', 'i.ym_sku')} AS on_ym "
        f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
        f"WHERE (%s::int IS NULL OR i.shop_id = %s::int) GROUP BY s.name ORDER BY s.name",
        (shop and shop['id'], shop and shop['id']),
    )
    out.append(_rows_text(cur, 'КАРТОЧКИ В НАШЕМ СПРАВОЧНИКЕ'))
    out.append(
        'Примечание: реклама, остатки и отзывы в нашей базе хранятся по площадке, '
        'без разделения на магазин. Живые данные по магазину — what=live.'
    )
    return '\n\n'.join(out)


def _listings(cur, schema, shop, mps):
    out = []
    cols = _table_columns(cur, schema, 'marketplace_items')
    sid = shop and shop['id']
    ym_col = ", i.ym_sku" if 'ym_sku' in cols else ''
    # Сначала живые привязанные карточки из нашего справочника — без них агент
    # не может разобрать SEO и витрину по артикулу.
    cur.execute(
        f"SELECT i.id, s.name AS shop, i.sku, i.name, i.width, i.height, i.material, "
        f"  i.ozon_sku, i.wb_nm_id, i.wb_sku{ym_col}, i.barcode "
        f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
        f"WHERE (%s::int IS NULL OR i.shop_id = %s::int) "
        f"  AND (COALESCE(i.ozon_sku,'') <> '' OR i.wb_nm_id IS NOT NULL "
        f"       OR COALESCE(i.wb_sku,'') <> ''"
        + (" OR COALESCE(i.ym_sku,'') <> ''" if 'ym_sku' in cols else '')
        + ") "
        f"ORDER BY i.updated_at DESC NULLS LAST, i.id DESC",
        (sid, sid),
    )
    out.append(_rows_text(cur, 'КАРТОЧКИ В СПРАВОЧНИКЕ (привязаны к площадкам)', 60))
    conds = []
    if 'ozon' in mps:
        conds.append("COALESCE(i.ozon_sku,'') = ''")
    if 'wildberries' in mps:
        conds.append("(i.wb_nm_id IS NULL AND COALESCE(i.wb_sku,'') = '')")
    if 'yandex_market' in mps and 'ym_sku' in cols:
        conds.append("COALESCE(i.ym_sku,'') = ''")
    if conds:
        cur.execute(
            f"SELECT i.id, s.name AS shop, i.sku, i.name, i.ozon_sku, i.wb_nm_id{ym_col} "
            f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
            f"WHERE (%s::int IS NULL OR i.shop_id = %s::int) AND ({' OR '.join(conds)}) "
            f"ORDER BY i.id DESC",
            (sid, sid),
        )
        out.append(_rows_text(cur, 'КАРТОЧКИ БЕЗ ПРИВЯЗКИ К ПЛОЩАДКЕ (нет кода товара на площадке)', 50))
    cur.execute(
        f"SELECT marketplace_code, sku, offer_id, product_name, free_amount, reserved_amount, synced_at "
        f"FROM {schema}.marketplace_stocks WHERE marketplace_code = ANY(%s) AND free_amount <= 0 "
        f"ORDER BY synced_at DESC",
        (mps,),
    )
    out.append(_rows_text(cur, 'НА СКЛАДАХ ПЛОЩАДКИ НОЛЬ (карточка выпадает из выдачи)', 50))
    price_cols = _table_columns(cur, schema, 'marketplace_prices')
    if price_cols and 'marketplace_item_id' in price_cols:
        cur.execute(
            f"SELECT p.marketplace_code, i.sku, i.name, p.price, p.price_before_discount, p.synced_at "
            f"FROM {schema}.marketplace_prices p "
            f"JOIN {schema}.marketplace_items i ON i.id = p.marketplace_item_id "
            f"WHERE p.marketplace_code = ANY(%s) "
            f"  AND (%s::int IS NULL OR i.shop_id = %s::int) "
            f"ORDER BY p.synced_at DESC NULLS LAST",
            (mps, sid, sid),
        )
        out.append(_rows_text(cur, 'ЦЕНЫ НА ПЛОЩАДКАХ (срез)', 40))
    out.append(
        'Чтобы разобрать конкретную карточку на площадке — what=card и query=артикул '
        '(sku / offer_id / nmID / часть названия).'
    )
    return '\n\n'.join(out)


def _ads(cur, schema, mps):
    out = []
    cur.execute(
        f"SELECT marketplace_code, period_days, ad_spend, revenue, ad_percent AS drr, calculated_at "
        f"FROM {schema}.marketplace_ad_spend "
        f"WHERE marketplace_item_id IS NULL AND marketplace_code = ANY(%s) ORDER BY marketplace_code",
        (mps,),
    )
    out.append(_rows_text(cur, 'РЕКЛАМА ИТОГО ПО ПЛОЩАДКЕ (ДРР, %)'))
    cur.execute(
        f"SELECT a.marketplace_code, i.sku, i.name, a.ad_spend, a.revenue, a.ad_percent AS drr "
        f"FROM {schema}.marketplace_ad_spend a "
        f"JOIN {schema}.marketplace_items i ON i.id = a.marketplace_item_id "
        f"WHERE a.marketplace_code = ANY(%s) AND a.ad_spend > 0 "
        f"ORDER BY a.ad_percent DESC NULLS LAST LIMIT 30",
        (mps,),
    )
    out.append(_rows_text(cur, 'ТОВАРЫ С САМЫМ ВЫСОКИМ ДРР'))
    cur.execute(
        f"SELECT marketplace_code, to_char(month, 'YYYY-MM') AS month, ad_spend, revenue, ad_percent AS drr "
        f"FROM {schema}.marketplace_ad_monthly "
        f"WHERE marketplace_code = ANY(%s) AND month >= date_trunc('month', now()) - interval '6 months' "
        f"ORDER BY marketplace_code, month",
        (mps,),
    )
    out.append(_rows_text(cur, 'ДРР ПО МЕСЯЦАМ (полгода)', 60))
    return '\n\n'.join(out)


def _attention(cur, schema, shop, mps):
    out = []
    rv_codes = []
    if 'ozon' in mps:
        rv_codes.append('OZON')
    if 'wildberries' in mps:
        rv_codes.append('WB')
    if rv_codes:
        cur.execute(
            f"SELECT marketplace, rating, product_sku, product_name, left(text, 200) AS text, review_date "
            f"FROM {schema}.reviews WHERE marketplace = ANY(%s) AND rating <= 3 "
            f"AND review_date >= now() - interval '30 days' ORDER BY review_date DESC",
            (rv_codes,),
        )
        out.append(_rows_text(cur, 'ПЛОХИЕ ОТЗЫВЫ ЗА 30 ДНЕЙ (1–3 звезды)', 30))
    cur.execute(
        f"SELECT a.marketplace_code, i.sku, i.name, a.ad_spend, a.revenue, a.ad_percent AS drr "
        f"FROM {schema}.marketplace_ad_spend a "
        f"JOIN {schema}.marketplace_items i ON i.id = a.marketplace_item_id "
        f"WHERE a.marketplace_code = ANY(%s) AND a.ad_spend > 0 "
        f"  AND (a.ad_percent >= 20 OR a.revenue = 0) "
        f"ORDER BY a.ad_spend DESC LIMIT 25",
        (mps,),
    )
    out.append(_rows_text(cur, 'РЕКЛАМА ЖЖЁТ: ДРР ≥ 20% или расход без выручки'))
    cur.execute(
        f"SELECT marketplace_code, count(*) AS zero_stock_skus FROM {schema}.marketplace_stocks "
        f"WHERE marketplace_code = ANY(%s) AND free_amount <= 0 GROUP BY marketplace_code",
        (mps,),
    )
    out.append(_rows_text(cur, 'НУЛЕВЫЕ ОСТАТКИ НА СКЛАДАХ ПЛОЩАДКИ'))
    sid = shop and shop['id']
    cur.execute(
        f"SELECT mi.shop_id, mi.marketplace_code, mi.is_enabled, (mi.credentials::text <> '{{}}') AS has_keys "
        f"FROM {schema}.marketplace_integrations mi "
        f"WHERE mi.marketplace_code = ANY(%s) AND (%s::int IS NULL OR mi.shop_id = %s::int) "
        f"  AND (NOT mi.is_enabled OR mi.credentials::text = '{{}}')",
        (mps, sid, sid),
    )
    out.append(_rows_text(cur, 'КАБИНЕТЫ НЕ ПОДКЛЮЧЕНЫ ИЛИ БЕЗ КЛЮЧЕЙ'))
    return '\n\n'.join(out)


# ---------------------------------------------------------------- площадки (только чтение)

# Белый список: (метод, хост+путь). Всё, чего тут нет, не уходит в кабинет.
READ_ENDPOINTS = {
    ('POST', OZON_API + '/v3/product/list'),
    ('POST', OZON_API + '/v3/product/info/list'),
    ('POST', OZON_API + '/v1/product/rating-by-sku'),
    ('POST', WB_CONTENT_API + '/content/v2/get/cards/list'),
    ('GET', WB_CONTENT_API + '/content/v2/cards/error/list'),
    ('GET', WB_ADVERT_API + '/adv/v1/promotion/count'),
    ('GET', YM_API + '/campaigns/{id}'),
    ('POST', YM_API + '/businesses/{id}/offer-mappings'),
    ('POST', YM_API + '/businesses/{id}/offer-cards'),
}


def _endpoint_allowed(method, url):
    base = url.split('?', 1)[0]
    norm = re.sub(r'/(campaigns|businesses)/\d+', r'/\1/{id}', base)
    return (method, norm) in READ_ENDPOINTS


def _mp_call(method, url, headers, payload=None):
    """Единственная дверь в кабинеты площадок. Проверяет белый список чтения."""
    if not _endpoint_allowed(method, url):
        return -1, 'ОТКАЗАНО: этот метод площадки не входит в список чтения'
    data = None
    if method == 'POST':
        data = json.dumps(payload or {}).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=max(3, min(MP_TIMEOUT, _time_left() - 40))) as r:
            raw = r.read().decode('utf-8', 'replace')
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')[:300]
        return e.code, raw
    except Exception as e:
        return 0, str(e)[:300]


def _ozon_photo_count(it):
    images = it.get('images') or []
    if isinstance(images, str):
        images = [images] if images else []
    n = len(images) if isinstance(images, list) else 0
    prim = it.get('primary_image')
    if prim and (prim if isinstance(prim, str) else (prim[0] if isinstance(prim, list) and prim else None)) not in images:
        n += 1
    return n


def _ozon_weak_reasons(it):
    """Чеклист OZON по ответу product/info: заголовок, фото, штрихкод, статус."""
    name = (it.get('name') or '').strip()
    img_n = _ozon_photo_count(it)
    barcodes = it.get('barcodes') or ([] if not it.get('barcode') else [it.get('barcode')])
    score = 0
    reasons = []
    if len(name) < 50:
        score += 2
        reasons.append(f'короткий title {len(name)} симв. (цель 60–120)')
    if len(name) > 200:
        score += 1
        reasons.append(f'title {len(name)} симв. — переспам')
    if name and name.upper() == name and any(ch.isalpha() for ch in name):
        score += 1
        reasons.append('title капсом')
    if img_n < 4:
        score += 2
        reasons.append(f'фото {img_n} (цель ≥5)')
    if not barcodes:
        score += 1
        reasons.append('нет штрихкода')
    if it.get('errors'):
        score += 3
        reasons.append('ошибки: ' + '; '.join(
            ((e.get('texts') or {}).get('short_description') or e.get('code') or '')[:80]
            for e in (it.get('errors') or [])[:2]))
    return score, name, reasons


def _live_ozon(creds):
    client_id = str(creds.get('clientId') or '').strip()
    api_key = str(creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return 'OZON: в CRM нет Client-Id или Api-Key'
    h = {'Client-Id': client_id, 'Api-Key': api_key}
    lines = ['OZON (живые данные кабинета):']
    url = OZON_API + '/v3/product/list'
    # Первый круг — всё параллельно: счётчики + id ошибочных + id видимых.
    jobs = [
        (vis, _mp_call, ('POST', url, h, {'filter': {'visibility': vis}, 'limit': 1, 'last_id': ''}))
        for vis in ('ALL', 'VISIBLE', 'EMPTY_STOCK')
    ]
    jobs.append(('FAILED', _mp_call, ('POST', url, h,
                 {'filter': {'visibility': 'STATE_FAILED'}, 'limit': 10, 'last_id': ''})))
    jobs.append(('VIS_LIST', _mp_call, ('POST', url, h,
                 {'filter': {'visibility': 'VISIBLE'}, 'limit': 50, 'last_id': ''})))
    r1 = _parallel(jobs, min(LIVE_BUDGET * 0.5, _time_left() - 45))

    def _total(res):
        if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
            return (res[1].get('result') or {}).get('total')
        return None

    def _ids(res):
        if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
            return [it.get('product_id') for it in (res[1].get('result') or {}).get('items') or []
                    if it.get('product_id')]
        return []

    # Повтор для тех, кому OZON отказал (429 при параллельных запросах).
    retry = [(k, f, a) for k, f, a in jobs
             if not (isinstance(r1.get(k), tuple) and r1[k][0] == 200) and _time_left() > 50]
    if retry:
        time.sleep(0.5)
        r1.update({k: v for k, v in _parallel(retry, 4).items() if v is not None})
    for key, title in (('ALL', 'всего карточек'), ('VISIBLE', 'видны покупателю'),
                       ('EMPTY_STOCK', 'нет в наличии'), ('FAILED', 'ошибка создания/модерации')):
        t = _total(r1.get(key))
        code = r1.get(key)[0] if isinstance(r1.get(key), tuple) else 'таймаут'
        lines.append(f'- {title}: {t if t is not None else f"не получено (код {code})"}')
    failed_ids = _ids(r1.get('FAILED'))
    vis_ids = _ids(r1.get('VIS_LIST'))
    # Второй круг — info по ошибочным и видимым параллельно.
    info_url = OZON_API + '/v3/product/info/list'
    jobs2 = []
    if failed_ids:
        jobs2.append(('F', _mp_call, ('POST', info_url, h, {'product_id': failed_ids[:10]})))
    if vis_ids:
        jobs2.append(('V', _mp_call, ('POST', info_url, h, {'product_id': vis_ids[:50]})))
    r2 = _parallel(jobs2, min(LIVE_BUDGET * 0.5, _time_left() - 42)) if _time_left() > 45 else {}
    res = r2.get('F')
    if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
        lines.append('Карточки с ошибкой модерации (offer_id | название | ошибки):')
        for it in (res[1].get('items') or [])[:10]:
            errs = '; '.join(
                (e.get('texts') or {}).get('short_description') or e.get('code') or ''
                for e in (it.get('errors') or [])[:3]
            )
            lines.append(f"  {it.get('offer_id')} | {(it.get('name') or '')[:80]} | {errs}")
    res = r2.get('V')
    if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
        items = res[1].get('items') or []
        weak = []
        for it in items:
            score, name, reasons = _ozon_weak_reasons(it)
            if score:
                weak.append((score, it.get('offer_id'), it.get('sku'), name[:200], ', '.join(reasons)))
        weak.sort(key=lambda x: -x[0])
        name_lens = sorted(len((it.get('name') or '')) for it in items) or [0]
        photo_ns = sorted(_ozon_photo_count(it) for it in items) or [0]
        lines.append(f'SEO-срез видимых (проверено {len(items)} из первых): '
                     f'слабых по чеклисту OZON — {len(weak)}')
        lines.append(f'  длина названия: мин {name_lens[0]}, медиана {name_lens[len(name_lens)//2]}, '
                     f'макс {name_lens[-1]}; фото: мин {photo_ns[0]}, медиана {photo_ns[len(photo_ns)//2]}, '
                     f'макс {photo_ns[-1]}')
        if weak:
            lines.append('Слабые карточки (offer_id | sku | название | что не так):')
            for _, offer, sku, name, why in weak[:15]:
                lines.append(f'  {offer} | {sku} | {name} | {why}')
        else:
            # Явных дыр нет — даём самые «бедные» по контенту, чтобы было что улучшать.
            poorest = sorted(items, key=lambda it: (_ozon_photo_count(it), len(it.get('name') or '')))[:8]
            lines.append('Явных провалов нет. Наименее наполненные (offer_id | sku | фото | длина назв. | название):')
            for it in poorest:
                lines.append(f"  {it.get('offer_id')} | {it.get('sku')} | {_ozon_photo_count(it)} | "
                             f"{len(it.get('name') or '')} | {(it.get('name') or '')[:200]}")
        lines.append('  (рейтинг контента, описание и атрибуты в этом срезе не читаются — '
                     'для них разберите конкретную карточку)')
    elif vis_ids:
        lines.append('SEO-срез видимых: OZON не ответил вовремя — повторите вопрос.')
    return '\n'.join(lines)


def _live_wb(creds):
    api_key = str(creds.get('apiKey') or '').strip()
    if not api_key:
        return 'Wildberries: в CRM нет токена'
    if creds.get('useSandbox'):
        return 'Wildberries: в CRM включена песочница — живой кабинет не читаем'
    h = {'Authorization': api_key}
    lines = ['Wildberries (живые данные кабинета):']
    r = _parallel([
        ('cards', _mp_call, ('POST', WB_CONTENT_API + '/content/v2/get/cards/list', h,
                             {'settings': {'cursor': {'limit': 100}, 'filter': {'withPhoto': -1}}})),
        ('errs', _mp_call, ('GET', WB_CONTENT_API + '/content/v2/cards/error/list', h)),
        ('adv', _mp_call, ('GET', WB_ADVERT_API + '/adv/v1/promotion/count', h)),
    ], LIVE_BUDGET - 1)
    st, data = r.get('cards') if isinstance(r.get('cards'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        cards = data.get('cards') or []
        total = (data.get('cursor') or {}).get('total')
        no_photo = [c for c in cards if not c.get('photos')]
        short_title = [c for c in cards if len((c.get('title') or '')) < 20]
        no_descr = [c for c in cards if len((c.get('description') or '')) < 300]
        lines.append(f'- карточек в первой выборке: {len(cards)} (всего по курсору: {total})')
        lines.append(f'- без фото: {len(no_photo)}')
        lines.append(f'- короткий заголовок (<20 симв.): {len(short_title)}')
        lines.append(f'- короткое описание (<300 симв.): {len(no_descr)}')
        for c in (no_photo + short_title + no_descr)[:12]:
            lines.append(f"  {c.get('vendorCode')} | nmID {c.get('nmID')} | {(c.get('title') or '')[:70]}")
    else:
        lines.append(f'- карточки: не получено (код {st})')
    st, data = r.get('errs') if isinstance(r.get('errs'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        errs = data.get('data') or []
        lines.append(f'- несозданные карточки с ошибками: {len(errs)}')
        for e in errs[:10]:
            lines.append(f"  {e.get('vendorCode')} | {'; '.join((e.get('errors') or [])[:2])[:160]}")
    else:
        lines.append(f'- ошибки карточек: не получено (код {st})')
    st, data = r.get('adv') if isinstance(r.get('adv'), tuple) else (0, 'нет ответа')
    status_names = {4: 'готова к запуску', 7: 'завершена', 8: 'отказ', 9: 'идёт показ', 11: 'на паузе', -1: 'удаляется'}
    if st == 200 and isinstance(data, dict):
        lines.append(f"- рекламных кампаний всего: {data.get('all')}")
        for g in data.get('adverts') or []:
            lines.append(f"  статус «{status_names.get(g.get('status'), g.get('status'))}»: {g.get('count')}")
    else:
        lines.append(f'- реклама: не получено (код {st}; возможно, у токена нет доступа к «Продвижению»)')
    return '\n'.join(lines)


def _live_ym(creds):
    api_key = str(creds.get('apiKey') or '').strip()
    campaign_id = str(creds.get('campaignId') or '').strip()
    if not api_key or not campaign_id.isdigit():
        return 'Яндекс Маркет: в CRM нет Api-Key или номера кампании'
    h = {'Api-Key': api_key}
    lines = ['Яндекс Маркет (живые данные кабинета):']
    st, camp = _mp_call('GET', f'{YM_API}/campaigns/{campaign_id}', h)
    business_id = None
    if st == 200 and isinstance(camp, dict):
        c = camp.get('campaign') or {}
        business_id = (c.get('business') or {}).get('id')
        lines.append(f"- магазин: {c.get('domain') or ''}, модель: {c.get('placementType') or ''}")
    else:
        return f'Яндекс Маркет: кампания не прочиталась (код {st})'
    if not business_id:
        return '\n'.join(lines + ['- кабинет (business) не определён'])
    bid = int(business_id)
    r = _parallel([
        ('maps', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-mappings?limit=100', h, {})),
        ('cards', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-cards?limit=100', h, {})),
    ], LIVE_BUDGET - 4)
    st, data = r.get('maps') if isinstance(r.get('maps'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        maps = (data.get('result') or {}).get('offerMappings') or []
        rejected = [m for m in maps if m.get('rejectedMapping')]
        awaiting = [m for m in maps if m.get('awaitingModerationMapping')]
        no_card = [m for m in maps if not m.get('mapping')]
        lines.append(f'- товаров в первой выборке: {len(maps)}')
        lines.append(f'- без карточки Маркета: {len(no_card)}, на модерации: {len(awaiting)}, отклонено: {len(rejected)}')
        for m in (rejected + no_card)[:10]:
            o = m.get('offer') or {}
            lines.append(f"  {o.get('offerId')} | {(o.get('name') or '')[:80]}")
    else:
        lines.append(f'- каталог: не получено (код {st})')
    st, data = r.get('cards') if isinstance(r.get('cards'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        cards = (data.get('result') or {}).get('offerCards') or []
        weak = sorted(
            [c for c in cards if c.get('contentRating') is not None],
            key=lambda c: c.get('contentRating') or 0,
        )
        with_err = [c for c in cards if c.get('errors')]
        lines.append(f'- карточек с ошибками: {len(with_err)}')
        if weak:
            lines.append('- самый низкий рейтинг контента (offerId | рейтинг):')
            for c in weak[:10]:
                lines.append(f"  {c.get('offerId')} | {c.get('contentRating')}")
    else:
        lines.append(f'- качество карточек: не получено (код {st})')
    return '\n'.join(lines)


def _scrub(text, secrets):
    for s in secrets:
        if s and len(s) >= 6:
            text = text.replace(s, '***')
    return text


def _live(cur, schema, shop, mps):
    """Обход кабинетов: все магазины × площадки параллельно, общий бюджет LIVE_BUDGET."""
    shops = [shop] if shop else _shops(cur, schema)
    fns = {'ozon': _live_ozon, 'wildberries': _live_wb, 'yandex_market': _live_ym}
    slots = []
    jobs = []
    for s in shops:
        for mp in mps:
            creds, enabled = _load_creds(cur, schema, mp, s['id'])
            key = (s['id'], mp)
            if not creds:
                slots.append((s, mp, f'{MP_TITLES[mp]}: кабинет не подключён в CRM', None))
            elif not enabled:
                slots.append((s, mp, f'{MP_TITLES[mp]}: интеграция выключена в CRM — не читаем', None))
            else:
                slots.append((s, mp, None, creds))
                jobs.append((key, fns[mp], (creds,)))
    res = _parallel(jobs, min(LIVE_BUDGET, _time_left() - 40))
    out = []
    cur_shop = None
    for s, mp, text, creds in slots:
        if cur_shop != s['id']:
            out.append(f"=== Магазин {s['name']} (shop_id {s['id']}) ===")
            cur_shop = s['id']
        if creds is None:
            out.append(text)
            continue
        txt = res.get((s['id'], mp))
        if txt is None:
            txt = f'{MP_TITLES[mp]}: кабинет не ответил за {LIVE_BUDGET} с — повторите вопрос'
        elif isinstance(txt, Exception):
            txt = f'{MP_TITLES[mp]}: ошибка чтения ({str(txt)[:150]})'
        secrets = [str(v) for v in creds.values() if isinstance(v, (str, int))]
        out.append(_scrub(txt, secrets))
    return '\n\n'.join(out)


def _find_items(cur, schema, shop, query):
    """Ищет карточки в нашем справочнике по sku / ozon / wb / ym / названию."""
    q = (query or '').strip()
    if not q:
        return []
    cols = _table_columns(cur, schema, 'marketplace_items')
    sid = shop and shop['id']
    ym_select = "i.ym_sku" if 'ym_sku' in cols else "NULL::text AS ym_sku"
    like = f'%{q}%'
    nm = None
    if q.isdigit():
        try:
            nm = int(q)
        except ValueError:
            nm = None
    where = [
        "(%s::int IS NULL OR i.shop_id = %s::int)",
        "(i.sku ILIKE %s OR i.name ILIKE %s OR COALESCE(i.ozon_sku,'') ILIKE %s "
        "OR COALESCE(i.wb_sku,'') ILIKE %s OR COALESCE(i.barcode,'') ILIKE %s",
    ]
    params = [sid, sid, like, like, like, like, like]
    if 'ym_sku' in cols:
        where[1] += " OR COALESCE(i.ym_sku,'') ILIKE %s"
        params.append(like)
    if nm is not None:
        where[1] += " OR i.wb_nm_id = %s"
        params.append(nm)
    where[1] += ")"
    params.extend([q, q, q])
    cur.execute(
        f"SELECT i.id, s.name AS shop, i.shop_id, i.sku, i.name, i.width, i.height, i.material, "
        f"  i.ozon_sku, i.wb_nm_id, i.wb_sku, {ym_select}, i.barcode "
        f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY "
        f"  CASE WHEN i.sku = %s THEN 0 WHEN i.ozon_sku = %s THEN 1 "
        f"       WHEN CAST(i.wb_nm_id AS text) = %s THEN 2 ELSE 3 END, i.id DESC "
        f"LIMIT 12",
        params,
    )
    cols_out = [d[0] for d in cur.description]
    return [dict(zip(cols_out, r)) for r in cur.fetchall()]


def _ozon_card_lines(item):
    """Разбор одной карточки OZON из product/info — SEO и модерация."""
    name = (item.get('name') or '').strip()
    offer = (item.get('offer_id') or '').strip()
    sku = item.get('sku') or item.get('fbo_sku') or item.get('fbs_sku') or ''
    barcodes = item.get('barcodes') or ([] if not item.get('barcode') else [item.get('barcode')])
    images = item.get('images') or item.get('primary_image') or []
    if isinstance(images, str):
        images = [images] if images else []
    img_n = len(images) if isinstance(images, list) else (1 if images else 0)
    descr = (item.get('description') or item.get('rich_content_json') or '')
    if isinstance(descr, dict):
        descr = json.dumps(descr, ensure_ascii=False)
    descr = str(descr or '')
    attrs = item.get('attributes') or []
    errs = item.get('errors') or []
    status = item.get('statuses') or item.get('status') or {}
    issues = []
    if len(name) < 40:
        issues.append(f'короткий заголовок ({len(name)} симв., лучше ≥60)')
    if len(name) > 150:
        issues.append(f'очень длинный заголовок ({len(name)} симв.)')
    if img_n < 3:
        issues.append(f'мало фото ({img_n}, желательно ≥5)')
    if not barcodes:
        issues.append('нет штрихкода')
    has_descr = 'description' in item or 'rich_content_json' in item
    has_attrs = 'attributes' in item
    if has_descr and len(descr) < 200:
        issues.append(f'короткое описание ({len(descr)} симв.)')
    if has_attrs and isinstance(attrs, list) and len(attrs) < 5:
        issues.append(f'мало характеристик ({len(attrs)})')
    if errs:
        issues.append('ошибки модерации/контента: ' + '; '.join(
            ((e.get('texts') or {}).get('short_description') or e.get('code') or str(e))[:120]
            for e in errs[:4]
        ))
    lines = [
        f"OZON live: offer_id={offer} | sku={sku} | название ({len(name)}): {name[:160]}",
        f"  фото≈{img_n}, штрихкодов={len(barcodes) if isinstance(barcodes, list) else 0}, "
        f"атрибуты: {len(attrs) if has_attrs else 'НЕ ЧИТАЮТСЯ этим методом API (не значит, что пусто)'}, "
        f"описание: {str(len(descr)) + ' симв.' if has_descr else 'НЕ ЧИТАЕТСЯ этим методом API (не значит, что пусто)'}; "
        f"заполненность характеристик/описания смотри по группам рейтинга контента ниже",
    ]
    if status:
        lines.append(f"  статус: {json.dumps(status, ensure_ascii=False)[:240]}")
    if issues:
        lines.append('  SEO/качество: ' + '; '.join(issues))
    else:
        lines.append('  SEO/качество: явных дыр в ответе API не видно')
    return lines


def _rating_groups_text(g):
    """Компактно: группа рейтинг/вес и невыполненные условия — это и есть чеклист OZON."""
    parts = []
    for grp in (g.get('groups') or [])[:6]:
        miss = [c.get('description') for c in (grp.get('conditions') or [])
                if not c.get('fulfilled') and c.get('description')]
        txt = f"{grp.get('name')} {grp.get('rating')}/100 (вес {grp.get('weight')}%)"
        if miss:
            txt += ' — не выполнено: ' + '; '.join(m[:70] for m in miss[:4])
        parts.append(txt)
    return ' | '.join(parts) or json.dumps(g, ensure_ascii=False)[:300]


def _card_live_ozon(creds, item_row, query):
    client_id = str(creds.get('clientId') or '').strip()
    api_key = str(creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return ['OZON: в CRM нет Client-Id или Api-Key']
    h = {'Client-Id': client_id, 'Api-Key': api_key}
    offer_ids = []
    skus = []
    if item_row:
        if item_row.get('sku'):
            offer_ids.append(str(item_row['sku']))
        if item_row.get('ozon_sku'):
            skus.append(str(item_row['ozon_sku']))
    q = (query or '').strip()
    if q:
        offer_ids.append(q)
        if q.isdigit():
            skus.append(q)
    offer_ids = list(dict.fromkeys([x for x in offer_ids if x]))[:20]
    skus = list(dict.fromkeys([x for x in skus if x]))[:20]
    lines = []
    if not offer_ids and not skus:
        return ['OZON: нечего искать — нужен артикул (offer_id) или sku']
    info_url = OZON_API + '/v3/product/info/list'
    jobs = []
    if offer_ids:
        jobs.append(('offer', _mp_call, ('POST', info_url, h, {'offer_id': offer_ids})))
    sku_int = [int(x) for x in skus if str(x).isdigit()][:20]
    if sku_int:
        jobs.append(('sku', _mp_call, ('POST', info_url, h, {'sku': sku_int})))
    r = _parallel(jobs, min(LIVE_BUDGET * 0.6, _time_left() - 42))
    items = []
    st = 0
    seen = set()
    for key in ('offer', 'sku'):
        res = r.get(key)
        if isinstance(res, tuple):
            st = res[0] if not items else st
            if res[0] == 200 and isinstance(res[1], dict):
                for it in res[1].get('items') or (res[1].get('result') or {}).get('items') or []:
                    pid = it.get('id') or it.get('product_id') or it.get('offer_id')
                    if pid not in seen:
                        seen.add(pid)
                        items.append(it)
    if not items:
        return [f'OZON: карточка не найдена в кабинете (код {st}). Проверьте артикул и магазин.']
    for it in items[:5]:
        lines.extend(_ozon_card_lines(it))
    # Контент-рейтинг по sku, если есть.
    rating_skus = []
    for it in items[:10]:
        s = it.get('sku') or it.get('fbo_sku') or it.get('fbs_sku')
        if s:
            try:
                rating_skus.append(int(s))
            except (TypeError, ValueError):
                pass
    if rating_skus and _time_left() >= 45:
        st, rating = _mp_call(
            'POST', OZON_API + '/v1/product/rating-by-sku', h, {'skus': rating_skus[:10]},
        )
        if st == 200 and isinstance(rating, dict):
            for g in (rating.get('products') or rating.get('result') or [])[:5]:
                lines.append(
                    f"  рейтинг контента OZON sku={g.get('sku')}: {g.get('rating')} "
                    f"(группы: {_rating_groups_text(g)})"
                )
        else:
            lines.append(f'  рейтинг контента: не получен (код {st})')
    elif rating_skus:
        lines.append('  рейтинг контента: пропуск (мало времени на ответ)')
    return lines


def _card_live_wb(creds, item_row, query):
    api_key = str(creds.get('apiKey') or '').strip()
    if not api_key:
        return ['Wildberries: в CRM нет токена']
    if creds.get('useSandbox'):
        return ['Wildberries: в CRM включена песочница — живой кабинет не читаем']
    h = {'Authorization': api_key}
    search = (query or '').strip()
    if item_row and item_row.get('sku'):
        search = str(item_row['sku'])
    nm = item_row.get('wb_nm_id') if item_row else None
    lines = []
    payload = {
        'settings': {
            'cursor': {'limit': 100},
            'filter': {'withPhoto': -1},
        },
    }
    if search:
        payload['settings']['filter']['textSearch'] = search
    st, data = _mp_call('POST', WB_CONTENT_API + '/content/v2/get/cards/list', h, payload)
    cards = []
    if st == 200 and isinstance(data, dict):
        cards = data.get('cards') or []
    if nm and cards:
        cards = [c for c in cards if c.get('nmID') == nm] or cards
    elif nm and not cards:
        # Повтор без textSearch — ищем nmID в первой сотне (редко, но лучше чем пусто).
        st2, data2 = _mp_call(
            'POST', WB_CONTENT_API + '/content/v2/get/cards/list', h,
            {'settings': {'cursor': {'limit': 100}, 'filter': {'withPhoto': -1}}},
        )
        if st2 == 200 and isinstance(data2, dict):
            cards = [c for c in (data2.get('cards') or []) if c.get('nmID') == nm]
    if not cards:
        return [f'Wildberries: карточка не найдена (код {st}). Проверьте vendorCode / nmID.']
    for c in cards[:5]:
        title = (c.get('title') or '').strip()
        descr = (c.get('description') or '').strip()
        photos = c.get('photos') or []
        chars = c.get('characteristics') or []
        sizes = c.get('sizes') or []
        issues = []
        if len(title) < 40:
            issues.append(f'короткий заголовок ({len(title)})')
        if len(descr) < 300:
            issues.append(f'короткое описание ({len(descr)})')
        if not photos:
            issues.append('нет фото')
        elif len(photos) < 3:
            issues.append(f'мало фото ({len(photos)})')
        if len(chars) < 5:
            issues.append(f'мало характеристик ({len(chars)})')
        lines.append(
            f"WB live: vendorCode={c.get('vendorCode')} | nmID={c.get('nmID')} | "
            f"название ({len(title)}): {title[:160]}"
        )
        lines.append(
            f"  фото={len(photos)}, описание={len(descr)} симв., "
            f"характеристик={len(chars)}, размеров={len(sizes)}"
        )
        if issues:
            lines.append('  SEO/качество: ' + '; '.join(issues))
        else:
            lines.append('  SEO/качество: явных дыр в ответе API не видно')
        # Короткий срез характеристик — менеджеру видно, что заполнено.
        for ch in chars[:8]:
            lines.append(f"  · {(ch.get('name') or '')}: {', '.join(ch.get('value') or [])}"[:180])
    return lines


def _card_live_ym(creds, item_row, query):
    api_key = str(creds.get('apiKey') or '').strip()
    campaign_id = str(creds.get('campaignId') or '').strip()
    if not api_key or not campaign_id.isdigit():
        return ['Яндекс Маркет: в CRM нет Api-Key или номера кампании']
    h = {'Api-Key': api_key}
    st, camp = _mp_call('GET', f'{YM_API}/campaigns/{campaign_id}', h)
    if st != 200 or not isinstance(camp, dict):
        return [f'Яндекс Маркет: кампания не прочиталась (код {st})']
    business_id = ((camp.get('campaign') or {}).get('business') or {}).get('id')
    if not business_id:
        return ['Яндекс Маркет: business id не определён']
    offer_ids = []
    if item_row and item_row.get('sku'):
        offer_ids.append(str(item_row['sku']))
    if item_row and item_row.get('ym_sku'):
        offer_ids.append(str(item_row['ym_sku']))
    q = (query or '').strip()
    if q:
        offer_ids.append(q)
    offer_ids = list(dict.fromkeys([x for x in offer_ids if x]))[:20]
    payload = {'offerIds': offer_ids} if offer_ids else {}
    lines = []
    bid = int(business_id)
    r = _parallel([
        ('maps', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-mappings?limit=20', h, payload)),
        ('cards', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-cards?limit=20', h, payload)),
    ], LIVE_BUDGET - 4)
    st, data = r.get('maps') if isinstance(r.get('maps'), tuple) else (0, 'нет ответа')
    maps = []
    if st == 200 and isinstance(data, dict):
        maps = (data.get('result') or {}).get('offerMappings') or []
    if not maps:
        lines.append(f'Яндекс Маркет: offer-mappings пусто (код {st})')
    for m in maps[:5]:
        o = m.get('offer') or {}
        lines.append(
            f"YM live: offerId={o.get('offerId')} | {(o.get('name') or '')[:120]} | "
            f"mapping={'есть' if m.get('mapping') else 'нет'} | "
            f"модерация={'ждёт' if m.get('awaitingModerationMapping') else 'нет'} | "
            f"reject={'да' if m.get('rejectedMapping') else 'нет'}"
        )
    st, data = r.get('cards') if isinstance(r.get('cards'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        for c in ((data.get('result') or {}).get('offerCards') or [])[:5]:
            errs = c.get('errors') or []
            lines.append(
                f"  карточка offerId={c.get('offerId')} | contentRating={c.get('contentRating')} | "
                f"ошибок={len(errs)}"
            )
            for e in errs[:3]:
                lines.append(f"    ! {json.dumps(e, ensure_ascii=False)[:200]}")
    else:
        lines.append(f'  качество карточек YM: не получено (код {st})')
    return lines or ['Яндекс Маркет: карточка не найдена']


def _card_context(cur, schema, item_row, mps):
    """Остатки, цены, реклама, отзывы по найденной карточке из нашей базы."""
    if not item_row:
        return []
    lines = []
    sku = str(item_row.get('sku') or '')
    ozon = str(item_row.get('ozon_sku') or '')
    nm = item_row.get('wb_nm_id')
    lines.append(
        f"Из CRM: id={item_row.get('id')} | магазин={item_row.get('shop')} | "
        f"sku={sku} | {item_row.get('name')} | "
        f"{item_row.get('width')}×{item_row.get('height')} | материал={item_row.get('material')}"
    )
    lines.append(
        f"  привязки: ozon_sku={ozon or '—'} | wb_nm_id={nm or '—'} | "
        f"wb_sku={item_row.get('wb_sku') or '—'} | ym_sku={item_row.get('ym_sku') or '—'} | "
        f"barcode={item_row.get('barcode') or '—'}"
    )
    keys = [k for k in (sku, ozon, str(nm) if nm else '') if k]
    if keys:
        cur.execute(
            f"SELECT marketplace_code, sku, offer_id, product_name, free_amount, reserved_amount, synced_at "
            f"FROM {schema}.marketplace_stocks "
            f"WHERE marketplace_code = ANY(%s) AND (sku = ANY(%s) OR offer_id = ANY(%s)) "
            f"ORDER BY synced_at DESC NULLS LAST LIMIT 20",
            (mps, keys, keys),
        )
        lines.append(_rows_text(cur, 'ОСТАТКИ НА ПЛОЩАДКЕ', 20))
        if _table_columns(cur, schema, 'marketplace_prices'):
            cur.execute(
                f"SELECT p.marketplace_code, p.price, p.price_before_discount, "
                f"  p.price_with_marketplace_discount, p.synced_at "
                f"FROM {schema}.marketplace_prices p "
                f"WHERE p.marketplace_item_id = %s AND p.marketplace_code = ANY(%s) "
                f"ORDER BY p.synced_at DESC NULLS LAST LIMIT 20",
                (item_row.get('id'), mps),
            )
            lines.append(_rows_text(cur, 'ЦЕНЫ', 20))
        cur.execute(
            f"SELECT a.marketplace_code, a.ad_spend, a.revenue, a.ad_percent AS drr, a.period_days "
            f"FROM {schema}.marketplace_ad_spend a "
            f"WHERE a.marketplace_item_id = %s",
            (item_row.get('id'),),
        )
        lines.append(_rows_text(cur, 'РЕКЛАМА ПО ЭТОЙ КАРТОЧКЕ', 10))
        rv_codes = []
        if 'ozon' in mps:
            rv_codes.append('OZON')
        if 'wildberries' in mps:
            rv_codes.append('WB')
        if rv_codes:
            cur.execute(
                f"SELECT marketplace, rating, product_sku, left(text, 180) AS text, review_date "
                f"FROM {schema}.reviews "
                f"WHERE marketplace = ANY(%s) AND ("
                f"  product_sku = ANY(%s) OR product_sku = %s OR product_sku = %s"
                f") ORDER BY review_date DESC LIMIT 15",
                (rv_codes, keys, sku, ozon),
            )
            lines.append(_rows_text(cur, 'ОТЗЫВЫ ПО КАРТОЧКЕ', 15))
    return lines


def _card_analyze(dsn, schema, shop, mps, query):
    """Разбор конкретной карточки: справочник CRM + живой кабинет площадки."""
    q = (query or '').strip()
    if not q:
        return (
            'Укажите query: артикул (sku), offer_id OZON, nmID WB, ym offerId '
            'или часть названия товара.'
        )
    conn = _ro_conn(dsn)
    try:
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 8000")
        items = _find_items(cur, schema, shop, q)
        out = [f'ЗАПРОС КАРТОЧКИ: «{q}»']
        if not items:
            out.append('В справочнике CRM точного совпадения нет — ищу только в живых кабинетах.')
        else:
            out.append(f'Найдено в CRM: {len(items)}')
        # Живой кабинет — только по лучшему совпадению (укладываемся в шлюз);
        # остальные совпадения перечисляем, чтобы менеджер уточнил артикул.
        targets = items[:1] if items else [None]
        if len(items) > 1:
            out.append('Другие совпадения в CRM (sku | название | магазин): ' + '; '.join(
                f"{r.get('sku')} | {(r.get('name') or '')[:50]} | {r.get('shop')}" for r in items[1:6]))
        shops = [shop] if shop else _shops(cur, schema)
        for item_row in targets:
            if item_row:
                out.extend(_card_context(cur, schema, item_row, mps))
                shop_id = item_row.get('shop_id')
                shop_loop = [s for s in shops if s['id'] == shop_id] or shops
                # Только площадки, куда карточка реально привязана — быстрее и точнее.
                bound = []
                if item_row.get('ozon_sku') and 'ozon' in mps:
                    bound.append('ozon')
                if (item_row.get('wb_nm_id') or item_row.get('wb_sku')) and 'wildberries' in mps:
                    bound.append('wildberries')
                if item_row.get('ym_sku') and 'yandex_market' in mps:
                    bound.append('yandex_market')
                use_mps = bound or list(mps)
            else:
                shop_loop = shops[:1]  # без CRM-попадания не обходим все магазины
                use_mps = list(mps)[:1] if len(mps) > 1 else list(mps)
            fns = {'ozon': _card_live_ozon, 'wildberries': _card_live_wb, 'yandex_market': _card_live_ym}
            s = shop_loop[0] if shop_loop else None
            if s is None:
                out.append('Живой кабинет: нет активных магазинов.')
                continue
            out.append(f"--- Живой кабинет: {s['name']} (shop_id {s['id']}) ---")
            jobs, creds_map = [], {}
            for mp in use_mps:
                creds, enabled = _load_creds(cur, schema, mp, s['id'])
                if not creds or not enabled:
                    out.append(f'{MP_TITLES[mp]}: нет ключей или выключено')
                    continue
                creds_map[mp] = creds
                jobs.append((mp, fns[mp], (creds, item_row, q)))
            res = _parallel(jobs, min(LIVE_BUDGET, _time_left() - 40))
            for mp, creds in creds_map.items():
                lines = res.get(mp)
                if lines is None:
                    lines = [f'{MP_TITLES[mp]}: кабинет не ответил за {LIVE_BUDGET} с']
                elif isinstance(lines, Exception):
                    lines = [f'{MP_TITLES[mp]}: ошибка ({str(lines)[:150]})']
                secrets = [str(v) for v in creds.values() if isinstance(v, (str, int))]
                out.append(_scrub('\n'.join(lines), secrets))
        out.append(
            'Формат ответа: разбор по чеклисту площадки из инструкции (каждый пункт: ✅/⚠️/❌ + '
            'факт из данных), коммерция, приоритетный план правок руками в кабинете.'
        )
        return '\n'.join(out)
    except Exception as e:
        return f'Не удалось разобрать карточку: {str(e)[:300]}'
    finally:
        conn.close()


def _cabinet_read(dsn, schema, args):
    what = (args.get('what') or 'overview').strip().lower()
    mps = _mp_list(args.get('marketplace'))
    query = (args.get('query') or args.get('sku') or args.get('offer_id') or '').strip()
    if what == 'card':
        shop = None
        conn = _ro_conn(dsn)
        try:
            cur = conn.cursor()
            shop = _resolve_shop(cur, schema, args.get('shop_id'))
        finally:
            conn.close()
        if shop == 'unknown':
            return 'Магазин не найден. Возьмите shop_id из what=overview.'
        return _card_analyze(dsn, schema, shop, mps, query)
    conn = _ro_conn(dsn)
    try:
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 8000")
        shop = _resolve_shop(cur, schema, args.get('shop_id'))
        if shop == 'unknown':
            return 'Магазин не найден. Возьмите shop_id из what=overview.'
        if what == 'overview':
            return _overview(cur, schema, shop)
        if what == 'listings':
            return _listings(cur, schema, shop, mps)
        if what == 'ads':
            return _ads(cur, schema, mps)
        if what == 'attention':
            return _attention(cur, schema, shop, mps)
        if what == 'live':
            return _live(cur, schema, shop, mps)
        return (
            'Неизвестный what. Допустимо: overview | listings | ads | attention | live | card'
        )
    except Exception as e:
        return f'Не удалось прочитать данные: {str(e)[:300]}'
    finally:
        conn.close()


# ---------------------------------------------------------------- официальные справки

def _host_is_private(host):
    if not host or host in ('localhost',) or host.endswith('.local') or host.endswith('.internal'):
        return True
    try:
        ipaddress.ip_address(host)
        return True  # голые IP (внутренние и любые другие) не открываем
    except ValueError:
        return False


def _url_allowed(url):
    try:
        p = urllib.parse.urlparse(url)
    except Exception:
        return False
    if p.scheme not in ('http', 'https'):
        return False
    host = (p.hostname or '').lower()
    if _host_is_private(host) or p.port not in (None, 80, 443):
        return False
    for d in ALLOWED_DOMAINS:
        if host == d or host.endswith('.' + d):
            return True
    if host == YANDEX_SUPPORT_HOST and (p.path or '').startswith(YANDEX_SUPPORT_PATH):
        return True
    return False


def _http_get(url, timeout=12):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; MegatulMarketplace/1.0)',
        'Accept': 'text/plain, text/html;q=0.9, */*;q=0.8',
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()[:80000].decode('utf-8', 'ignore')


def _strip_tags(text):
    text = re.sub(r'(?is)<script.*?>.*?</script>', ' ', text)
    text = re.sub(r'(?is)<style.*?>.*?</style>', ' ', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', html_lib.unescape(text)).strip()


def _web_search(query):
    q = (query or '').strip()[:200]
    if not q:
        return 'Пустой поисковый запрос'
    sites = re.findall(r'site:(\S+)', q, re.I)
    if not sites:
        return ('ОТКАЗАНО: добавьте site: — разрешены только ' + ', '.join(ALLOWED_SITE_TOKENS))
    for s in sites:
        s = s.lower().rstrip('/')
        if s not in ALLOWED_SITE_TOKENS:
            return f'ОТКАЗАНО: site:{s} не официальная справка площадки'
    try:
        body = urllib.parse.urlencode({'q': q, 'kl': 'ru-ru'}).encode('utf-8')
        req = urllib.request.Request(
            'https://html.duckduckgo.com/html/', data=body,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; MegatulMarketplace/1.0)',
                     'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            page = r.read()[:120000].decode('utf-8', 'ignore')
        blocks = re.findall(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</(?:a|td|span)',
            page, re.S | re.I,
        )
        items = []
        for href, title, snip in blocks:
            href = html_lib.unescape(href)
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            if qs.get('uddg'):
                href = qs['uddg'][0]
            if href.startswith('//'):
                href = 'https:' + href
            if not _url_allowed(href):
                continue
            items.append(f'{_strip_tags(title)}\n{_strip_tags(snip)}\n{href}')
            if len(items) >= 8:
                break
        if items:
            return '\n\n'.join(items)[:MAX_TOOL_CHARS]
        return 'В официальных справках ничего не нашлось. Переформулируйте запрос.'
    except Exception as e:
        return f'Поиск сейчас недоступен: {e}'


def _read_page(url):
    url = (url or '').strip()
    if not _url_allowed(url):
        return ('ОТКАЗАНО: читаю только официальные справки: ' + ', '.join(ALLOWED_SITE_TOKENS))
    try:
        text = _http_get('https://r.jina.ai/' + url).strip()
        if len(text) < 40:
            return 'Страница открылась пустой'
        return text[:MAX_TOOL_CHARS]
    except Exception as e:
        return f'Не удалось открыть страницу: {e}'


# ---------------------------------------------------------------- модель

# Лимит функции на Поехали — 90 с. Держим запас, чтобы успеть вернуть ответ самим.
REQUEST_BUDGET = 82
_DEADLINE = [0.0]


def _start_budget():
    _DEADLINE[0] = time.monotonic() + REQUEST_BUDGET


def _time_left():
    if not _DEADLINE[0]:
        return float(REQUEST_BUDGET)
    return _DEADLINE[0] - time.monotonic()


# База, до которой уже достучались (живёт, пока жив тёплый контейнер).
_GOOD_BASE = ['']
_DEAD_BASES = {}
_DEAD_TTL = 300


def _aitunnel_bases():
    """Базы AITUNNEL: сначала основная, при блоке сети — зеркало ru-api."""
    preferred = (os.environ.get('AITUNNEL_BASE_URL', '') or '').strip().rstrip('/')
    bases = []
    if preferred:
        bases.append(preferred)
    for b in AITUNNEL_BASES:
        if b not in bases:
            bases.append(b)
    now = time.monotonic()
    alive = [b for b in bases if now - _DEAD_BASES.get(b, -1e9) > _DEAD_TTL]
    dead = [b for b in bases if b not in alive]
    good = _GOOD_BASE[0]
    if good in alive:
        alive.remove(good)
        alive.insert(0, good)
    return alive + dead


def _base_reachable(base, timeout=4):
    """Быстрая проверка TCP+TLS: блок/зависание видно за секунды, а не за минуту."""
    try:
        host = urllib.parse.urlparse(base).hostname
        import ssl
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host):
                return True
    except Exception:
        return False


def _aitunnel_open(path, api_key, payload=None, timeout=30):
    """GET или POST к AITUNNEL. При сетевом сбое пробует зеркало ru-api.

    HTTP-ответ от сервера (4xx/5xx) — это уже AITUNNEL, зеркало не меняет смысл.
    Переключаемся только когда до сервера не достучались.
    """
    body = None
    method = 'GET'
    if payload is not None:
        method = 'POST'
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    last_err = None
    for base in _aitunnel_bases():
        url = base.rstrip('/') + '/' + path.lstrip('/')
        left = _time_left() - 2
        if left < 3:
            last_err = last_err or 'не хватило времени на запрос'
            break
        if base != _GOOD_BASE[0] and not _base_reachable(base, timeout=min(8, left)):
            _DEAD_BASES[base] = time.monotonic()
            last_err = 'нет соединения с ' + (urllib.parse.urlparse(base).hostname or base)
            print(f'[aitunnel] {base} недоступен, пробую зеркало', flush=True)
            continue
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        t_req = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=min(timeout, left)) as r:
                out = json.loads(r.read().decode('utf-8'))
            print(f'[aitunnel] {path} via {urllib.parse.urlparse(base).hostname} {time.monotonic() - t_req:.1f}s', flush=True)
            _GOOD_BASE[0] = base
            _DEAD_BASES.pop(base, None)
            return out, None, 0
        except urllib.error.HTTPError as e:
            _GOOD_BASE[0] = base
            raw = e.read().decode('utf-8', 'ignore')
            return None, f'Сервис ИИ ответил ошибкой {e.code}: {raw[:300]}', e.code
        except Exception as e:
            last_err = e
            _DEAD_BASES[base] = time.monotonic()
            if _GOOD_BASE[0] == base:
                _GOOD_BASE[0] = ''
            print(f'[aitunnel] {path} {base} сбой сети через {time.monotonic() - t_req:.1f}s: {type(e).__name__}', flush=True)
            continue
    return None, f'Не удалось связаться с сервисом ИИ: {last_err}', 0


_KEY_CACHE = {}
_KEY_TTL = 600


def _key_allowed_models(api_key):
    """Белый список моделей ключа AITUNNEL. None — ограничений нет или ключ не ответил."""
    cached = _KEY_CACHE.get(api_key)
    if cached and time.monotonic() - cached[0] < _KEY_TTL:
        return cached[1]
    data, err, _code = _aitunnel_open('aitunnel/key', api_key, None, timeout=8)
    if data is None:
        return None
    result = _parse_allowed(data)
    _KEY_CACHE[api_key] = (time.monotonic(), result)
    return result


def _warm_key(api_key):
    """Список моделей ключа тянем в фоне, пока читаем базу — экономим 8–12 с."""
    if api_key in _KEY_CACHE:
        return None
    t = threading.Thread(target=_key_allowed_models, args=(api_key,), daemon=True)
    t.start()
    return t


def _parse_allowed(data):
    allowed = data.get('allowed_models')
    if not isinstance(allowed, list) or not allowed:
        return None
    out = []
    for item in allowed:
        name = str(item or '').strip()
        if name and name not in out:
            out.append(name)
    return out or None


def _model_aliases(name):
    """В каталоге одно и то же часто лежит как gpt-6-luna-pro и openai/gpt-6-luna-pro."""
    n = (name or '').strip()
    if not n or n == 'auto':
        return [n] if n else []
    out = [n]
    if n.startswith('openai/'):
        out.append(n.split('/', 1)[1])
    elif '/' not in n:
        out.append('openai/' + n)
    seen = []
    for item in out:
        if item and item not in seen:
            seen.append(item)
    return seen


def _add_models(ordered, name):
    for alias in _model_aliases(name):
        if alias not in ordered:
            ordered.append(alias)


def _model_candidates(api_key, state):
    """Модель берём с ключа: если он ограничен — только его список, иначе auto."""
    if state.get('candidates'):
        return state['candidates']
    preferred = os.environ.get('AITUNNEL_MODEL', '').strip()
    t0 = time.monotonic()
    allowed = None if state.get('skip_key_lookup') else _key_allowed_models(api_key)
    print(f'[megamag] key models={allowed} {time.monotonic() - t0:.1f}s', flush=True)
    state['allowed_models'] = allowed
    ordered = []
    if allowed:
        if preferred:
            pref_set = set(_model_aliases(preferred))
            for name in allowed:
                if pref_set & set(_model_aliases(name)):
                    _add_models(ordered, name)
                    break
        for name in allowed:
            _add_models(ordered, name)
        state['candidates'] = ordered[:8]
        return state['candidates']
    if preferred:
        _add_models(ordered, preferred)
    _add_models(ordered, 'auto')
    _add_models(ordered, DEFAULT_MODEL)
    for name in MODEL_CANDIDATES:
        _add_models(ordered, name)
    state['candidates'] = ordered[:8]
    return state['candidates']


def _call_model(api_key, model, messages, tools):
    payload = {
        'model': model,
        'messages': messages,
        'temperature': 0.2,
        'max_tokens': 2500,
    }
    if tools:
        payload['tools'] = tools
    return _aitunnel_open('chat/completions', api_key, payload, timeout=75)


ANSWER_DEADLINE = 27  # с от старта: шлюз Поехали фактически рвёт соединение на 33–60 с


def _stream_answer(api_key, messages, state, deadline_left):
    """Потоковый ответ модели без инструментов. Возвращает (text, err, truncated).

    Если время подходит к концу — останавливаемся и отдаём уже написанное,
    вместо обрыва шлюзом с 503.
    """
    stop_at = time.monotonic() + max(5, deadline_left)
    last_err = 'модель не ответила'
    fast = [m.strip() for m in os.environ.get(
        'MEGAMAG_FAST_MODELS', 'gpt-4.1-mini,openai/gpt-4.1-mini,gpt-4o-mini').split(',') if m.strip()]
    allowed = state.get('allowed_models')
    if allowed:
        allowed_set = {a for n in allowed for a in _model_aliases(n)}
        fast = [m for m in fast if m in allowed_set]
    base_list = [state['model']] if state.get('model') else _model_candidates(api_key, state)
    order = []
    for m in fast + base_list:
        if m not in order:
            order.append(m)
    for model in order:
        payload = {
            'model': model, 'messages': messages,
            'max_tokens': 2200, 'stream': True,
        }
        if not state.get('no_reasoning_param'):
            payload['reasoning_effort'] = os.environ.get('MEGAMAG_REASONING', 'low')
        else:
            payload['temperature'] = 0.2
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        for base in _aitunnel_bases():
            left = stop_at - time.monotonic()
            if left < 3:
                return '', 'не хватило времени на ответ модели', True
            req = urllib.request.Request(
                base.rstrip('/') + '/chat/completions', data=body, method='POST',
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json',
                         'Accept': 'text/event-stream'},
            )
            parts = []
            t0 = time.monotonic()
            try:
                # Короткий таймаут сокета: зависшая модель не съедает весь бюджет.
                r = urllib.request.urlopen(req, timeout=max(2, min(10, left)))
            except urllib.error.HTTPError as e:
                raw = e.read().decode('utf-8', 'ignore')[:300]
                last_err = f'Сервис ИИ ответил ошибкой {e.code}: {raw}'
                _GOOD_BASE[0] = base
                print(f'[megamag] stream http {e.code}: {raw[:200]}', flush=True)
                if e.code == 400 and 'reasoning' in raw.lower() and not state.get('no_reasoning_param'):
                    state['no_reasoning_param'] = True
                    return _stream_answer(api_key, messages, state, stop_at - time.monotonic())
                if e.code in (400, 403, 404):
                    break  # следующая модель
                return '', last_err, False
            except Exception as e:
                last_err = f'нет связи с {base}: {type(e).__name__}'
                _DEAD_BASES[base] = time.monotonic()
                continue
            _GOOD_BASE[0] = base
            truncated = False
            first = [None]
            try:
                with r:
                    for raw_line in r:
                        if first[0] is None:
                            first[0] = time.monotonic() - t0
                        if time.monotonic() > stop_at:
                            truncated = True
                            break
                        line = raw_line.decode('utf-8', 'ignore').strip()
                        if not line.startswith('data:'):
                            continue
                        chunk = line[5:].strip()
                        if chunk == '[DONE]':
                            break
                        try:
                            d = json.loads(chunk)
                        except ValueError:
                            continue
                        for ch in d.get('choices') or []:
                            piece = (ch.get('delta') or {}).get('content') or \
                                    (ch.get('message') or {}).get('content') or ''
                            if piece:
                                parts.append(piece)
            except Exception as e:
                truncated = True
                last_err = f'обрыв потока: {type(e).__name__}'
            text = ''.join(parts).strip()
            stalled = not text and first[0] is None
            print(f'[megamag] stream {model} {time.monotonic() - t0:.1f}s first_byte={first[0]} '
                  f'{len(text)} chars truncated={truncated}', flush=True)
            if text:
                state['model'] = model
                return text, None, truncated
            if stalled or (not text and not truncated):
                break  # следующая модель
            return '', last_err, truncated
    return '', last_err, False


def _ask_model(api_key, messages, tools, state):
    if state.get('model'):
        return _call_model(api_key, state['model'], messages, tools)[:2]
    last_err = 'Не удалось подобрать доступную модель'
    for model in _model_candidates(api_key, state):
        data, err, code = _call_model(api_key, model, messages, tools)
        if data is not None:
            state['model'] = model
            return data, None
        last_err = err
        if code not in (400, 403, 404):
            break
    allowed = state.get('allowed_models') or []
    if allowed and last_err:
        last_err = (
            last_err
            + ' Ключ AITUNNEL разрешает только: '
            + ', '.join(allowed[:8])
            + '. МЕГАМАГ должен звать одно из этих имён один в один.'
        )
    elif last_err and ('не разрешена' in last_err or '403' in last_err):
        last_err = (
            'Ключ AITUNNEL ограничен моделями, которых МЕГАМАГ не смог вызвать. '
            'Имена должны совпасть с каталогом один в один (gpt-6-luna-pro и '
            'openai/gpt-6-luna-pro — разные записи).'
        )
    return None, last_err


SYSTEM_PROMPT = """Ты — МЕГАМАГ, помощник менеджера по кабинетам маркетплейсов швейного производства
штор и тюля. Магазины: МЕГАТЮЛЬ и ДЮНА. Площадки: OZON, Wildberries, Яндекс Маркет.

ТВОЯ ЗОНА: витрина и кабинет продавца — карточки и их качество, SEO (заголовки, описания,
характеристики, фото, штрихкоды), рейтинг контента, реклама и ДРР, отзывы, остатки на
складах площадки, цены, что требует внимания.
НЕ ТВОЯ ЗОНА: бухгалтерия, 1С, налоги, зарплаты, раскрой, склад цеха. На такие вопросы вежливо
скажи, что это к МЕГАБУХу или к администратору, и не отвечай по существу.

ТОЛЬКО ЧТЕНИЕ. Ты ничего не меняешь ни в нашей базе, ни в кабинетах: не меняешь цены и карточки,
не включаешь и не выключаешь кампании, не создаёшь объявления. Если просят сделать — объясни,
где и как менеджер сделает это сам в кабинете (по шагам), со ссылкой на официальную справку.

ИНСТРУМЕНТЫ:
- cabinet_read:
  what=overview — магазины и подключения ключей.
  what=listings — справочник карточек, дыры в привязках, нулевые остатки, цены.
  what=ads — реклама и ДРР.
  what=attention — что горит (отзывы 1–3★, дорогая реклама, нули, кабинеты без ключей).
  what=live — живой обход кабинета площадки (счётчики и SEO-срез).
  what=card — РАЗБОР КОНКРЕТНОЙ КАРТОЧКИ. Обязателен query: артикул sku / offer_id OZON /
    nmID WB / offerId Яндекса / часть названия. Читает CRM + живой кабинет.
  marketplace = ozon | wildberries | yandex_market | all. shop_id — из overview.
  Карточка/артикул/SEO одной позиции → what=card.
  «Какие карточки плохие / SEO витрины / что с кабинетом» → what=live (+ marketplace).
  «Что горит» → what=attention. Магазин неизвестен → overview.

- web_search: только официальные справки, запрос ВСЕГДА с site: — seller-edu.ozon.ru,
  docs.ozon.ru, seller.wildberries.ru, dev.wildberries.ru, yandex.ru/support.
- read_page: открыть страницу этих же доменов.

ЧЕКЛИСТЫ ТРЕБОВАНИЙ ПЛОЩАДОК (проверяй карточку по КАЖДОМУ пункту; спорное — подтверди справкой):
OZON:
 1. Модерация: нет ошибок/STATE_FAILED; карточка видна (VISIBLE), есть остаток.
 2. Название: формула «тип товара + бренд/коллекция + ключевые свойства (материал, размер Ш×В, цвет,
    крепление)»; ориентир 60–120 символов, без капса, повторов, эмодзи, слов «хит/скидка/лучший».
 3. Фото: ≥5 (цель 8–15), главное — товар целиком на белом/светлом фоне, без водяных знаков,
    чужих логотипов и цен; есть интерьерное фото, крупный план ткани, фото крепления/ленты, размеры.
 4. Видео/видеообложка и Rich-контент — плюс к рейтингу контента.
 5. Характеристики: заполнены все обязательные и максимум рекомендуемых (тип, материал, состав,
    ширина/высота, цвет, плотность, тип крепления, комплектация, страна, уход).
 6. Описание: 1000+ символов, польза для покупателя, ключевые запросы естественно, уход, размеры.
 7. Штрихкод есть; рейтинг контента OZON — цель 80+ (смотри группы, где недобор).
Wildberries:
 1. Нет ошибок в cards/error/list; vendorCode = наш sku; карточка в склейке по цвету/размеру если нужно.
 2. Наименование: до 60 символов, тип товара + ключевое свойство, без бренда-спама и капса.
 3. Фото: ≥3 обязательно, цель 5–10, 3:4 (900×1200+), белый/интерьерный фон, инфографика без
    обещаний «лучший/№1»; видео — плюс.
 4. Описание: 1000–2000 символов (ниже 300 — явно слабое), без ссылок, контактов, html.
 5. Характеристики категории — все обязательные + рекомендуемые (состав, размер, цвет, крепление).
 6. Размеры/баркоды на каждый размер; комплектация указана.
Яндекс Маркет:
 1. Оффер сматчен с карточкой Маркета (mapping есть), нет rejectedMapping; на модерации — ждать.
 2. contentRating: цель 80+; ниже 50 — приоритет. Ошибки и предупреждения offer-cards устранять первыми.
 3. Название: «тип + бренд + модель/коллекция + ключевые свойства», без рекламных слов.
 4. Фото: ≥3, цель 5+, белый фон у главного; описание содержательное (до 6000 симв.).
 5. Обязательные параметры категории заполнены; штрихкод, габариты и вес упаковки указаны.

КАК ОТВЕЧАТЬ (развёрнуто, но по делу):
• Вопрос про слабые карточки / витрину → сводка цифрами (всего, видимых, без остатка, с ошибками),
  затем таблица/список слабых карточек: артикул (offer_id/sku) | название | что не так по чеклисту |
  что сделать. Затем общие выводы (системные проблемы: например, у большинства мало фото) и
  приоритетный план на неделю.
• Разбор одной карточки → 
  1) Контекст: магазин, sku, размер/материал, привязки к площадкам.
  2) Чеклист площадки по пунктам: ✅ ок / ⚠️ можно лучше / ❌ мешает продажам — с фактом из данных
     (длина названия, число фото, атрибутов, ошибки, рейтинг контента).
  3) Коммерция: остаток, цена, реклама/ДРР, свежие отзывы — если есть в данных.
  4) Конкретные правки: предложи пример улучшенного названия и структуру описания, какие фото доснять,
     какие характеристики дозаполнить.
  5) План по приоритету: ошибки модерации → видимость/остаток → контент (название, фото, атрибуты)
     → описание/Rich → реклама. Где это сделать в кабинете (раздел, шаги).
• Пункта нет в данных API (например, видео) — так и пиши «в данных API не видно, проверьте в кабинете».

ПРАВИЛА ОТВЕТА:
- Опирайся на цифры из инструментов; не выдумывай. Нет данных — так и скажи и что проверить.
- Никогда не показывай ключи, токены, Client-Id, пароли.
- По-русски, развёрнуто по делу. Не односложный ответ и не «сейчас сверю» без вызова инструмента.
- Не пиши, что не видишь карточку, пока не вызвал what=card или what=live."""

TOOLS = [
    {'type': 'function', 'function': {
        'name': 'cabinet_read',
        'description': (
            'Читает данные кабинетов маркетплейсов (только чтение). '
            'Карточка: what=card + query. Витрина/SEO кабинета: what=live.'
        ),
        'parameters': {'type': 'object', 'properties': {
            'what': {
                'type': 'string',
                'enum': ['overview', 'listings', 'ads', 'attention', 'live', 'card'],
            },
            'marketplace': {
                'type': 'string',
                'enum': ['ozon', 'wildberries', 'yandex_market', 'all'],
            },
            'shop_id': {
                'type': 'string',
                'description': 'id магазина из overview (МЕГАТЮЛЬ / ДЮНА); пусто — все',
            },
            'query': {
                'type': 'string',
                'description': (
                    'Для what=card: sku, offer_id OZON, nmID WB, offerId Яндекса '
                    'или часть названия товара'
                ),
            },
        }, 'required': ['what']},
    }},
    {'type': 'function', 'function': {
        'name': 'web_search',
        'description': ('Поиск по официальным справкам площадок. Запрос обязательно с site: '
                        + ', '.join(ALLOWED_SITE_TOKENS)),
        'parameters': {'type': 'object', 'properties': {
            'query': {'type': 'string'},
        }, 'required': ['query']},
    }},
    {'type': 'function', 'function': {
        'name': 'read_page',
        'description': 'Открыть страницу официальной справки (те же домены).',
        'parameters': {'type': 'object', 'properties': {
            'url': {'type': 'string'},
        }, 'required': ['url']},
    }},
]


def _resp(code, body, headers):
    return {'statusCode': code, 'headers': headers, 'body': json.dumps(body, ensure_ascii=False)}


_CARD_INTENT = re.compile(r'карточк|артикул|\bsku\b|\bseo\b|\bсео\b|nmid|offer_?id|разбер|провер', re.I)
_ART_TOKEN = re.compile(r'(?<![\wА-Яа-яЁё])(?=[A-Za-zА-Яа-яЁё0-9_\-./]*\d)[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_\-./]{3,}')
_LIVE_INTENT = re.compile(
    r'витрин|кабинет|seo|сео|карточк|качеств|слаб|плох|ошибк|модерац|что.*смотр',
    re.I,
)
_ATTENTION_INTENT = re.compile(r'вниман|что горит|проблем|срочн|горит', re.I)


def _guess_marketplace(question):
    low = (question or '').lower()
    if 'ozon' in low or 'озон' in low:
        return 'ozon'
    if 'wildberries' in low or re.search(r'\bwb\b|вб|вайлдб', low):
        return 'wildberries'
    if 'яндекс' in low or 'yandex' in low or re.search(r'\bym\b', low):
        return 'yandex_market'
    return 'all'


def _cabinet_prefetch(question):
    """Сразу читаем кабинет до модели — шлюз Поехали рвёт долгие цепочки tool-calls."""
    q = question or ''
    mp = _guess_marketplace(q)
    if _CARD_INTENT.search(q):
        m = _ART_TOKEN.search(q)
        if m:
            return {'what': 'card', 'marketplace': mp, 'query': m.group(0).strip('.-/')}
    if _ATTENTION_INTENT.search(q):
        return {'what': 'attention', 'marketplace': mp}
    if _LIVE_INTENT.search(q):
        return {'what': 'live', 'marketplace': mp if mp != 'all' else 'ozon'}
    return None


def handler(event: dict, context) -> dict:
    """МЕГАМАГ: помощник менеджера по кабинетам OZON / WB / Яндекс Маркета. Только чтение.

    POST / { question, history?, userId, role? }
    """
    _start_budget()
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }
    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    if method != 'POST':
        return _resp(405, {'error': 'Только POST'}, headers)

    try:
        body_data = json.loads(event.get('body') or '{}')
    except json.JSONDecodeError:
        return _resp(400, {'error': 'Неверный JSON'}, headers)
    question = (body_data.get('question') or '').strip()
    user_id = body_data.get('userId')
    history = body_data.get('history') or []
    requested_role = (body_data.get('role') or '').strip()
    if not question:
        return _resp(400, {'error': 'Пустой вопрос'}, headers)
    if not user_id:
        return _resp(400, {'error': 'Не указан пользователь'}, headers)

    # Отдельный ключ агента менеджера; если его нет — общий ключ ИИ проекта.
    api_key = (os.environ.get('API_KEY_MEGAMAG', '').strip()
               or os.environ.get('AITUNNEL_API_KEY', '').strip())
    if not api_key:
        return _resp(500, {'error': 'Не настроен ключ доступа к сервису ИИ'}, headers)

    dsn = os.environ['DATABASE_URL']
    schema = os.environ.get('MAIN_DB_SCHEMA', 'public')
    key_thread = _warm_key(api_key)

    conn = _ro_conn(dsn)
    try:
        cur = conn.cursor()
        ok, full_name = _access(cur, schema, user_id, requested_role)
        if not ok:
            return _resp(403, {'error': 'МЕГАМАГ доступен менеджеру'}, headers)
        cur.execute("SELECT to_char(now() + interval '3 hours', 'DD.MM.YYYY HH24:MI')")
        now_human = cur.fetchone()[0]
    finally:
        conn.close()

    given = _given_name(full_name)
    extra = f'\n\nСЕЙЧАС по Москве: {now_human}.'
    if given:
        extra += f'\nСОБЕСЕДНИК: {given}. Обращайся по имени, на «вы», не чаще раза за ответ.'
    else:
        extra += '\nИмя собеседника неизвестно — говори на «вы».'

    messages = [{'role': 'system', 'content': SYSTEM_PROMPT + extra}]
    if isinstance(history, list):
        for m in history[-24:]:
            if not isinstance(m, dict):
                continue
            role = m.get('role')
            content = (m.get('content') or '').strip() if isinstance(m.get('content'), str) else ''
            if role in ('user', 'assistant') and content:
                messages.append({'role': role, 'content': content[:8000]})
    messages.append({'role': 'user', 'content': question[:8000]})

    queries_ran = []
    state = {}
    t_start = time.monotonic()
    pre = _cabinet_prefetch(question)
    if pre:
        # Экономим один круг модели: шлюз Поехали рвёт долгие запросы.
        t1 = time.monotonic()
        pre_result = _cabinet_read(dsn, schema, pre)
        print(
            f"[megamag] prefetch {pre.get('what')} {pre} "
            f"{time.monotonic() - t1:.1f}s {len(pre_result or '')} chars: "
            f"{(pre_result or '')[:400]!r}",
            flush=True,
        )
        queries_ran.append(
            f"cabinet: {pre.get('what')} / {pre.get('marketplace') or 'all'}"
            + (f" / q {pre['query']}" if pre.get('query') else '')
        )
        messages.append({
            'role': 'assistant',
            'content': None,
            'tool_calls': [{
                'id': 'prefetch_cabinet',
                'type': 'function',
                'function': {'name': 'cabinet_read', 'arguments': json.dumps(pre, ensure_ascii=False)},
            }],
        })
        messages.append({
            'role': 'tool',
            'tool_call_id': 'prefetch_cabinet',
            'content': (pre_result or '')[:MAX_TOOL_CHARS],
        })
    if key_thread:
        # Не ждём список моделей ключа дольше пары секунд — модель важнее.
        key_thread.join(timeout=2)
        if key_thread.is_alive():
            state['skip_key_lookup'] = True
    for step in range(MAX_STEPS):
        # Шлюз Поехали фактически рвёт ответ раньше заявленных 90 с.
        final = _time_left() < 50 or step == MAX_STEPS - 1
        if step == 0 and pre:
            hint = (
                'Данные кабинета выше. Ответь развёрнуто по разделу «КАК ОТВЕЧАТЬ» инструкции: '
                'сводка цифрами, список слабых карточек (артикул | название | что не так по '
                'чеклисту площадки | что сделать), системные проблемы, приоритетный план правок '
                'руками в кабинете. Инструменты сейчас не вызывай — отвечай сразу по этим данным.'
            )
            if pre.get('what') == 'card':
                hint = (
                    'Данные карточки выше. Дай развёрнутый разбор по схеме «Разбор одной карточки»: '
                    'контекст (кратко), чеклист площадки по каждому пункту (✅/⚠️/❌ + факт), '
                    'коммерция, ПЛАН ПРАВОК ПО ПРИОРИТЕТУ с шагами в кабинете, затем пример '
                    'улучшенного названия и структуры описания. Если поле «не читается методом API» — '
                    'не называй его пустым, а скажи проверить в кабинете. Пиши плотно, без воды. '
                    'Инструменты не вызывай — отвечай сразу.'
                )
            print(f'[megamag] one-shot start left={_time_left():.0f}s', flush=True)
            elapsed = REQUEST_BUDGET - _time_left()
            plain = [m for m in messages if m.get('role') in ('system', 'user', 'assistant')
                     and not m.get('tool_calls')]
            plain.append({'role': 'user', 'content': (
                'ДАННЫЕ КАБИНЕТА (только что прочитаны, только чтение):\n'
                + (pre_result or '')[:MAX_TOOL_CHARS] + '\n\n' + hint)})
            answer, err, truncated = _stream_answer(
                api_key, plain, state,
                ANSWER_DEADLINE - elapsed,
            )
            print(f'[megamag] one-shot {pre.get("what")} {time.monotonic() - t_start:.1f}s err={err}', flush=True)
            if answer:
                if api_key in answer:
                    answer = answer.replace(api_key, '***')
                if truncated:
                    answer += ('\n\n…Ответ сокращён по времени шлюза. Напишите «продолжи» — '
                               'допишу план правок.')
                return _resp(200, {'answer': answer, 'queries': queries_ran, 'model': state.get('model')}, headers)
            return _resp(200, {
                'answer': 'Сервис ИИ не успел ответить, поэтому показываю данные кабинета как есть '
                          f'(повторите вопрос для разбора).\n\n{(pre_result or "")[:6000]}',
                'queries': queries_ran,
                'model': state.get('model'),
                'error': err,
            }, headers)
        if final and step > 0:
            messages.append({
                'role': 'user',
                'content': 'Время на ответ заканчивается. Больше инструменты не вызывай — '
                           'дай развёрнутый ответ по уже полученным данным.',
            })
        t0 = time.monotonic()
        data, err = _ask_model(api_key, messages, None if (final and step > 0) else TOOLS, state)
        print(f'[megamag] step {step} model={state.get("model")} {time.monotonic() - t0:.1f}s left={_time_left():.0f}s err={bool(err)}', flush=True)
        if err:
            return _resp(502, {'error': err}, headers)
        msg = ((data.get('choices') or [{}])[0]).get('message') or {}
        calls = msg.get('tool_calls') or []
        if not calls:
            answer = (msg.get('content') or '').strip()
            if api_key and api_key in answer:
                answer = answer.replace(api_key, '***')
            return _resp(200, {
                'answer': answer or 'Не удалось получить ответ, попробуйте переспросить.',
                'queries': queries_ran,
                'model': state.get('model'),
            }, headers)
        messages.append(msg)
        for call in calls:
            fn = call.get('function') or {}
            name = fn.get('name') or ''
            try:
                args = json.loads(fn.get('arguments') or '{}')
            except json.JSONDecodeError:
                args = {}
            if name == 'cabinet_read':
                t1 = time.monotonic()
                result = _cabinet_read(dsn, schema, args)
                print(f'[megamag] cabinet {args.get("what")} {time.monotonic() - t1:.1f}s', flush=True)
                queries_ran.append(
                    f"cabinet: {args.get('what') or 'overview'} / {args.get('marketplace') or 'all'}"
                    + (f" / shop {args.get('shop_id')}" if args.get('shop_id') else '')
                    + (f" / q {args.get('query')}" if args.get('query') else '')
                )
            elif name == 'web_search':
                q = (args.get('query') or '').strip()
                result = _web_search(q)
                queries_ran.append('search: ' + q)
            elif name == 'read_page':
                url = (args.get('url') or '').strip()
                result = _read_page(url)
                queries_ran.append('read: ' + url)
            else:
                result = 'Этот инструмент недоступен'
            print(f'[megamag] tool {name} {json.dumps(args, ensure_ascii=False)[:200]} -> {len(result or "")} chars', flush=True)
            messages.append({
                'role': 'tool',
                'tool_call_id': call.get('id'),
                'content': (result or '')[:MAX_TOOL_CHARS],
            })

    return _resp(200, {
        'answer': 'Вопрос оказался слишком сложным — попробуйте спросить конкретнее.',
        'queries': queries_ran,
        'model': state.get('model'),
    }, headers)