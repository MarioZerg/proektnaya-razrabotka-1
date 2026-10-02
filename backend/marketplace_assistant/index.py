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
import re
import html as html_lib
import ipaddress
import urllib.error
import urllib.parse
import urllib.request

import psycopg2

AITUNNEL_URL = 'https://api.aitunnel.ru/v1/chat/completions'
AITUNNEL_KEY_URL = 'https://api.aitunnel.ru/v1/aitunnel/key'
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
MAX_STEPS = 8
MAX_TOOL_CHARS = 12000
MP_TIMEOUT = 15

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
    conds = []
    if 'ozon' in mps:
        conds.append("COALESCE(i.ozon_sku,'') = ''")
    if 'wildberries' in mps:
        conds.append("(i.wb_nm_id IS NULL AND COALESCE(i.wb_sku,'') = '')")
    if 'yandex_market' in mps and 'ym_sku' in cols:
        conds.append("COALESCE(i.ym_sku,'') = ''")
    ym_col = ", i.ym_sku" if 'ym_sku' in cols else ''
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
        with urllib.request.urlopen(req, timeout=MP_TIMEOUT) as r:
            raw = r.read().decode('utf-8', 'replace')
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')[:300]
        return e.code, raw
    except Exception as e:
        return 0, str(e)[:300]


def _live_ozon(creds):
    client_id = str(creds.get('clientId') or '').strip()
    api_key = str(creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return 'OZON: в CRM нет Client-Id или Api-Key'
    h = {'Client-Id': client_id, 'Api-Key': api_key}
    lines = ['OZON (живые данные кабинета):']
    for vis, title in (
        ('ALL', 'всего карточек'),
        ('VISIBLE', 'видны покупателю'),
        ('INVISIBLE', 'скрыты'),
        ('EMPTY_STOCK', 'нет в наличии'),
        ('STATE_FAILED', 'ошибка создания/модерации'),
    ):
        st, data = _mp_call('POST', OZON_API + '/v3/product/list', h,
                            {'filter': {'visibility': vis}, 'limit': 1, 'last_id': ''})
        if st == 200 and isinstance(data, dict):
            total = (data.get('result') or {}).get('total')
            lines.append(f'- {title}: {total}')
        else:
            lines.append(f'- {title}: не получено (код {st})')
    # Примеры проблемных карточек — по коду и названию.
    st, data = _mp_call('POST', OZON_API + '/v3/product/list', h,
                        {'filter': {'visibility': 'STATE_FAILED'}, 'limit': 20, 'last_id': ''})
    ids = []
    if st == 200 and isinstance(data, dict):
        ids = [it.get('product_id') for it in (data.get('result') or {}).get('items') or []
               if it.get('product_id')]
    if ids:
        st, info = _mp_call('POST', OZON_API + '/v3/product/info/list', h, {'product_id': ids[:20]})
        if st == 200 and isinstance(info, dict):
            lines.append('Карточки с ошибкой (offer_id | название | ошибки):')
            for it in (info.get('items') or [])[:20]:
                errs = '; '.join(
                    (e.get('texts') or {}).get('short_description') or e.get('code') or ''
                    for e in (it.get('errors') or [])[:3]
                )
                lines.append(f"  {it.get('offer_id')} | {(it.get('name') or '')[:80]} | {errs}")
    return '\n'.join(lines)


def _live_wb(creds):
    api_key = str(creds.get('apiKey') or '').strip()
    if not api_key:
        return 'Wildberries: в CRM нет токена'
    if creds.get('useSandbox'):
        return 'Wildberries: в CRM включена песочница — живой кабинет не читаем'
    h = {'Authorization': api_key}
    lines = ['Wildberries (живые данные кабинета):']
    st, data = _mp_call('POST', WB_CONTENT_API + '/content/v2/get/cards/list', h,
                        {'settings': {'cursor': {'limit': 100}, 'filter': {'withPhoto': -1}}})
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
    st, data = _mp_call('GET', WB_CONTENT_API + '/content/v2/cards/error/list', h)
    if st == 200 and isinstance(data, dict):
        errs = data.get('data') or []
        lines.append(f'- несозданные карточки с ошибками: {len(errs)}')
        for e in errs[:10]:
            lines.append(f"  {e.get('vendorCode')} | {'; '.join((e.get('errors') or [])[:2])[:160]}")
    else:
        lines.append(f'- ошибки карточек: не получено (код {st})')
    st, data = _mp_call('GET', WB_ADVERT_API + '/adv/v1/promotion/count', h)
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
    st, data = _mp_call('POST', f'{YM_API}/businesses/{int(business_id)}/offer-mappings?limit=100', h, {})
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
    st, data = _mp_call('POST', f'{YM_API}/businesses/{int(business_id)}/offer-cards?limit=100', h, {})
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
    out = []
    shops = [shop] if shop else _shops(cur, schema)
    for s in shops:
        out.append(f"=== Магазин {s['name']} (shop_id {s['id']}) ===")
        for mp in mps:
            creds, enabled = _load_creds(cur, schema, mp, s['id'])
            if creds is None or not creds:
                out.append(f'{MP_TITLES[mp]}: кабинет не подключён в CRM')
                continue
            if not enabled:
                out.append(f'{MP_TITLES[mp]}: интеграция выключена в CRM — не читаем')
                continue
            fn = {'ozon': _live_ozon, 'wildberries': _live_wb, 'yandex_market': _live_ym}[mp]
            try:
                txt = fn(creds)
            except Exception as e:
                txt = f'{MP_TITLES[mp]}: ошибка чтения ({str(e)[:150]})'
            secrets = [str(v) for v in creds.values() if isinstance(v, (str, int))]
            out.append(_scrub(txt, secrets))
    return '\n\n'.join(out)


def _cabinet_read(dsn, schema, args):
    what = (args.get('what') or 'overview').strip().lower()
    mps = _mp_list(args.get('marketplace'))
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
        return 'Неизвестный what. Допустимо: overview | listings | ads | attention | live'
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


def _http_get(url, timeout=20):
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

def _key_allowed_models(api_key):
    """Белый список моделей ключа AITUNNEL. None — ограничений нет или ключ не ответил."""
    req = urllib.request.Request(
        AITUNNEL_KEY_URL,
        headers={'Authorization': f'Bearer {api_key}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception:
        return None
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
    allowed = _key_allowed_models(api_key)
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
        'max_tokens': 2000,
    }
    if tools:
        payload['tools'] = tools
    req = urllib.request.Request(
        AITUNNEL_URL,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode('utf-8')), None, 0
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')
        return None, f'Сервис ИИ ответил ошибкой {e.code}: {body[:300]}', e.code
    except Exception as e:
        return None, f'Не удалось связаться с сервисом ИИ: {e}', 0


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
характеристики, фото), реклама и ДРР, отзывы, остатки на складах площадки, что требует внимания.
НЕ ТВОЯ ЗОНА: бухгалтерия, 1С, налоги, зарплаты, раскрой, склад цеха. На такие вопросы вежливо
скажи, что это к МЕГАБУХу или к администратору, и не отвечай по существу.

ТОЛЬКО ЧТЕНИЕ. Ты ничего не меняешь ни в нашей базе, ни в кабинетах: не меняешь цены и карточки,
не включаешь и не выключаешь кампании, не создаёшь объявления. Если просят сделать — объясни,
где и как менеджер сделает это сам в кабинете (по шагам), со ссылкой на официальную справку.

ИНСТРУМЕНТЫ:
- cabinet_read: what = overview (магазины и подключения), listings (карточки без привязки,
  нулевые остатки), ads (реклама, ДРР), attention (что горит), live (живой обход кабинета
  площадки). marketplace = ozon | wildberries | yandex_market | all. shop_id — из overview.
  Начинай с overview, если не знаешь shop_id. Для свежей картины кабинета — live.
- web_search: только официальные справки, запрос ВСЕГДА с site: — seller-edu.ozon.ru,
  docs.ozon.ru, seller.wildberries.ru, dev.wildberries.ru, yandex.ru/support.
- read_page: открыть страницу этих же доменов.

ПРАВИЛА ОТВЕТА:
- Опирайся на цифры из инструментов; не выдумывай. Нет данных — так и скажи.
- Никогда не показывай ключи, токены, Client-Id, пароли.
- Отвечай по-русски, коротко и по делу: сначала вывод, потом список действий по приоритету.
- Правила площадок подтверждай ссылкой на официальную справку."""

TOOLS = [
    {'type': 'function', 'function': {
        'name': 'cabinet_read',
        'description': 'Читает данные кабинетов маркетплейсов (только чтение).',
        'parameters': {'type': 'object', 'properties': {
            'what': {'type': 'string', 'enum': ['overview', 'listings', 'ads', 'attention', 'live']},
            'marketplace': {'type': 'string', 'enum': ['ozon', 'wildberries', 'yandex_market', 'all']},
            'shop_id': {'type': 'string', 'description': 'id магазина из overview (МЕГАТЮЛЬ / ДЮНА); пусто — все'},
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


def handler(event: dict, context) -> dict:
    """МЕГАМАГ: помощник менеджера по кабинетам OZON / WB / Яндекс Маркета. Только чтение.

    POST / { question, history?, userId, role? }
    """
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
    for _ in range(MAX_STEPS):
        data, err = _ask_model(api_key, messages, TOOLS, state)
        if err:
            return _resp(502, {'error': err}, headers)
        msg = ((data.get('choices') or [{}])[0]).get('message') or {}
        calls = msg.get('tool_calls') or []
        if not calls:
            answer = (msg.get('content') or '').strip()
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
                result = _cabinet_read(dsn, schema, args)
                queries_ran.append(
                    f"cabinet: {args.get('what') or 'overview'} / {args.get('marketplace') or 'all'}"
                    + (f" / shop {args.get('shop_id')}" if args.get('shop_id') else '')
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