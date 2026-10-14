import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import execute_values

# Отзывы с маркетплейсов OZON и WB (FBS). Функция:
#   - action=sync: тянет свежие отзывы из OZON (/v1/review/list) и WB
#     (feedbacks-api /api/v1/feedbacks), сопоставляет с нашими FBS-заказами и сохраняет в reviews;
#   - action=list: отдаёт отзывы вместе с производственным циклом заказа (закройщик/швея/
#     упаковщик) и датами (создан/завершён);
#   - action=rating: рейтинг сотрудников по этапам (средняя оценка + число отзывов).
# Ключи маркетплейсов читаются из marketplace_integrations (как в остальных функциях).

OZON_API_BASE = 'https://api-seller.ozon.ru'
WB_FEEDBACKS_BASE = 'https://feedbacks-api.wildberries.ru'
WB_MARKET_BASE = 'https://marketplace-api.wildberries.ru'

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
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def _iso(dt):
    return (dt.isoformat() + 'Z') if dt else None


def _parse_dt(value):
    if not value:
        return None
    try:
        s = str(value).replace('Z', '+00:00')
        return datetime.fromisoformat(s)
    except Exception:
        try:
            return datetime.fromtimestamp(int(value), tz=timezone.utc)
        except Exception:
            return None


# ---------- Креды ----------

def get_ozon_credentials(cur):
    cur.execute("SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'ozon' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1")
    row = cur.fetchone()
    if not row:
        return None, None, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('clientId') or '').strip(), (creds.get('apiKey') or '').strip(), bool(row[0])


def get_wb_credentials(cur):
    cur.execute("SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'wildberries' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1")
    row = cur.fetchone()
    if not row:
        return None, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('apiKey') or '').strip(), bool(row[0])


# ---------- OZON ----------

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


def fetch_ozon_reviews(client_id, api_key):
    """Отзывы OZON (/v1/review/list). Метод доступен только для продавцов с подпиской Premium
    Plus — при отказе возвращаем предупреждение, а не падаем."""
    reviews = []
    last_id = ''
    for _ in range(50):
        status, data = ozon_post(
            '/v1/review/list', client_id, api_key,
            {'limit': 100, 'last_id': last_id, 'sort_dir': 'DESC', 'status': 'ALL'},
        )
        if status != 200 or not isinstance(data, dict):
            msg = data.get('message') if isinstance(data, dict) else str(data)
            raise RuntimeError(msg or f'OZON отзывы недоступны (код {status})')
        items = data.get('reviews') or []
        for it in items:
            reviews.append({
                'external_id': str(it.get('id') or it.get('review_id') or ''),
                'posting_number': (it.get('order_number') or it.get('posting_number') or '').strip(),
                'sku': str(it.get('sku') or ''),
                'product_name': (it.get('product_name') or '').strip(),
                'rating': it.get('rating'),
                'text': (it.get('text') or {}).get('comment') if isinstance(it.get('text'), dict) else it.get('text'),
                'review_date': _parse_dt(it.get('published_at') or it.get('created_at')),
            })
        last_id = data.get('last_id') or ''
        if not last_id or len(items) < 100:
            break
    return reviews


# ---------- WB ----------

def wb_get(path, api_key):
    """GET к feedbacks-api WB. Возвращает (код ответа, разобранный JSON)."""
    req = urllib.request.Request(WB_FEEDBACKS_BASE + path, method='GET')
    req.add_header('Authorization', api_key)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw[:300]}
    except Exception as e:
        return 0, {'raw': str(e)[:300]}


def fetch_wb_reviews(api_key, is_answered='false', skip=0, take=1000):
    """Одна страница отзывов WB (feedbacks-api /api/v1/feedbacks).

    Раньше тянули весь архив за один вызов и упирались в лимит времени: функция
    обрывалась на середине, в базу попадала лишь малая часть отзывов. Теперь берём
    по одной странице, а обход всего архива идёт вызовами подряд.
    """
    url = f'{WB_FEEDBACKS_BASE}/api/v1/feedbacks?isAnswered={is_answered}&take={take}&skip={skip}'
    req = urllib.request.Request(url, method='GET')
    req.add_header('Authorization', api_key)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            data = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'WB отзывы недоступны (код {e.code}): {detail[:200]}')
    except Exception as e:
        raise RuntimeError(f'WB отзывы: ошибка соединения ({e})')

    feedbacks = ((data.get('data') or {}).get('feedbacks')) or []
    reviews = []
    for f in feedbacks:
        prod = f.get('productDetails') or {}
        # Буквенный ключ заказа WB: в отзыве это srid, у сборочного задания — rid.
        # Без него заказ в нашей базе (где номер = цифровой id задания) не найти.
        srid = (
            f.get('srid')
            or f.get('orderUid')
            or prod.get('srid')
            or prod.get('rid')
            or ''
        )
        # buyout — выкуплен (у клиента), returned — вернули, rejected — отказ.
        order_status = (f.get('orderStatus') or '').strip() or None
        reviews.append({
            'external_id': str(f.get('id') or ''),
            'srid': str(srid).strip(),
            'order_id': prod.get('orderId') or f.get('orderId') or f.get('order_id'),
            'nm_id': str(prod.get('nmId') or f.get('nmId') or ''),
            'product_name': (prod.get('productName') or '').strip(),
            'rating': f.get('productValuation'),
            'text': (f.get('text') or '').strip(),
            'review_date': _parse_dt(f.get('createdDate')),
            'order_status': order_status,
        })
    return reviews, len(feedbacks)


def wb_market_get(path, api_key):
    """GET к marketplace-api WB — сборочные задания с rid, чтобы связать отзыв с заказом."""
    req = urllib.request.Request(WB_MARKET_BASE + path, method='GET')
    req.add_header('Authorization', api_key)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw[:300]}
    except Exception as e:
        return 0, {'raw': str(e)[:300]}


def backfill_wb_rids(cur, api_key):
    """Подставляет rid в старые заказы WB: без него отзыв не находит швею.

    Отзыв WB приходит со srid = rid задания. Номер заказа у нас — id задания,
    rid раньше выкидывали. Берём задания за последние полгода и дописываем rid.
    """
    # Год назад: отзывы часто приходят на старые задания, а rid раньше не писали.
    date_from = int(datetime.now(timezone.utc).timestamp()) - 365 * 24 * 3600
    next_val = 0
    pairs = []
    for _ in range(20):
        st, data = wb_market_get(
            f'/api/v3/orders?limit=1000&next={next_val}&dateFrom={date_from}',
            api_key,
        )
        if st != 200 or not isinstance(data, dict):
            break
        orders = data.get('orders') or []
        for o in orders:
            rid = (o.get('rid') or '').strip()
            if o.get('id') and rid:
                pairs.append((o.get('id'), rid))
        next_val = data.get('next') or 0
        if not orders or not next_val:
            break
    return set_wb_rids(cur, pairs)


def set_wb_rids(cur, pairs):
    """Одним запросом дописывает rid заказам WB, у которых его ещё нет.

    Раньше писали по запросу на каждое задание — тысячи запросов за вызов,
    и база отвечала «rate limit exceeded».
    """
    oids, rids, seen_oid, seen_rid = [], [], set(), set()
    for oid, rid in pairs:
        try:
            oid = int(oid)
        except (TypeError, ValueError):
            continue
        if not rid or oid in seen_oid or rid in seen_rid:
            continue
        seen_oid.add(oid)
        seen_rid.add(rid)
        oids.append(oid)
        rids.append(rid)
    if not oids:
        return 0
    cur.execute(
        "UPDATE orders o SET wb_rid = v.rid "
        "FROM unnest(%s::bigint[], %s::text[]) AS v(oid, rid) "
        "WHERE o.wb_order_id = v.oid AND o.wb_rid IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.wb_rid = v.rid)",
        (oids, rids),
    )
    return cur.rowcount or 0


def resolve_wb_order(by_wb_order, by_rid, by_number, rv):
    """Ищем наш FBS-заказ по полям отзыва WB: id задания, буквенный rid/srid, номер."""
    if rv.get('order_id'):
        try:
            found = by_wb_order.get(int(rv['order_id']))
        except (TypeError, ValueError):
            found = None
        if found:
            return found
    srid = rv.get('srid') or ''
    if not srid:
        return None
    found = by_rid.get(srid) or by_number.get(srid)
    if found:
        return found
    if srid.isdigit():
        found = by_wb_order.get(int(srid)) or by_number.get(srid)
        if found:
            return found
    return None


def rematch_wb_reviews(cur):
    """Привязывает отзывы WB без заказа по сохранённому буквенному srid.

    srid лежит в reviews.wb_srid, rid задания — в orders.wb_rid. После догрузки
    rid в старые заказы (backfill) можно закрыть дыры без повторной выгрузки
    всего архива отзывов с WB. Дополнительно: цифровой id задания в номере заказа.
    """
    cur.execute(
        "UPDATE reviews r SET order_id = o.id "
        "FROM orders o "
        "WHERE r.marketplace = 'WB' "
        "  AND r.order_id IS NULL "
        "  AND r.wb_srid IS NOT NULL AND r.wb_srid <> '' "
        "  AND o.wb_rid = r.wb_srid"
    )
    linked = cur.rowcount or 0
    cur.execute(
        "UPDATE reviews r SET order_id = o.id "
        "FROM orders o "
        "WHERE r.marketplace = 'WB' "
        "  AND r.order_id IS NULL "
        "  AND r.wb_srid ~ '^[0-9]+$' "
        "  AND o.wb_order_id = r.wb_srid::bigint"
    )
    linked += cur.rowcount or 0
    cur.execute(
        "UPDATE reviews r SET order_id = o.id "
        "FROM orders o "
        "WHERE r.marketplace = 'WB' "
        "  AND r.order_id IS NULL "
        "  AND r.wb_srid IS NOT NULL AND r.wb_srid <> '' "
        "  AND o.order_number = r.wb_srid"
    )
    linked += cur.rowcount or 0
    # Номер заказа у нас часто = цифровой id задания WB.
    cur.execute(
        "UPDATE reviews r SET order_id = o.id "
        "FROM orders o "
        "WHERE r.marketplace = 'WB' "
        "  AND r.order_id IS NULL "
        "  AND o.wb_order_id IS NOT NULL "
        "  AND o.order_number = o.wb_order_id::text "
        "  AND r.wb_srid = o.wb_order_id::text"
    )
    linked += cur.rowcount or 0
    return linked


# ---------- Сопоставление и сохранение ----------

def match_order_ozon(cur, posting_number):
    if not posting_number:
        return None
    cur.execute("SELECT id FROM orders WHERE ozon_posting_number = %s LIMIT 1", (posting_number,))
    r = cur.fetchone()
    return r[0] if r else None


def match_order_wb(cur, wb_order_id, order_number):
    if wb_order_id:
        cur.execute("SELECT id FROM orders WHERE wb_order_id = %s LIMIT 1", (int(wb_order_id),))
        r = cur.fetchone()
        if r:
            return r[0]
    if order_number:
        cur.execute("SELECT id FROM orders WHERE order_number = %s LIMIT 1", (str(order_number),))
        r = cur.fetchone()
        if r:
            return r[0]
    return None


def upsert_review(
    cur, marketplace, external_id, order_id, product_sku, product_name,
    rating, text, review_date, wb_srid=None, wb_order_status=None,
):
    if not external_id:
        return 0
    cur.execute(
        "SELECT id, order_id, wb_srid FROM reviews "
        "WHERE marketplace = %s AND external_id = %s",
        (marketplace, external_id),
    )
    row = cur.fetchone()
    if row:
        rid, prev_order, prev_srid = row
        # Дописываем srid, заказ и статус заказа (у клиента / вернули).
        cur.execute(
            "UPDATE reviews SET "
            "  wb_srid = COALESCE(wb_srid, %s), "
            "  order_id = COALESCE(order_id, %s), "
            "  wb_order_status = COALESCE(%s, wb_order_status) "
            "WHERE id = %s",
            (wb_srid or None, order_id, wb_order_status, rid),
        )
        return 0
    cur.execute(
        "INSERT INTO reviews (marketplace, external_id, order_id, product_sku, product_name, "
        " rating, text, review_date, wb_srid, wb_order_status) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            marketplace, external_id, order_id, product_sku,
            (product_name or '')[:300], rating, text, review_date,
            wb_srid or None, wb_order_status,
        ),
    )
    return 1


def upsert_reviews_bulk(cur, marketplace, rows):
    """Пакетная запись отзывов: один запрос на всю порцию вместо 2–3 на отзыв.

    rows — кортежи (external_id, order_id, sku, name, rating, text, date, srid, status).
    Возвращает число новых отзывов.
    """
    uniq = {}
    for r in rows:
        if r[0]:
            uniq[r[0]] = r
    if not uniq:
        return 0
    values = [
        (marketplace, ext, oid, sku, (name or '')[:300], rating, text, dt, srid or None, status)
        for ext, oid, sku, name, rating, text, dt, srid, status in uniq.values()
    ]
    inserted = execute_values(
        cur,
        "INSERT INTO reviews (marketplace, external_id, order_id, product_sku, product_name, "
        " rating, text, review_date, wb_srid, wb_order_status) VALUES %s "
        "ON CONFLICT (marketplace, external_id) DO UPDATE SET "
        "  wb_srid = COALESCE(reviews.wb_srid, EXCLUDED.wb_srid), "
        "  order_id = COALESCE(reviews.order_id, EXCLUDED.order_id), "
        "  wb_order_status = COALESCE(EXCLUDED.wb_order_status, reviews.wb_order_status) "
        "RETURNING (xmax = 0)",
        values,
        page_size=len(values),
        fetch=True,
    )
    return sum(1 for (is_new,) in inserted if is_new)


def handle_sync(cur, body_data=None):
    """Загружает отзывы порциями.

    Архив WB большой (тысячи отзывов) и целиком за один вызов не проходит — функция
    обрывается по времени. Поэтому за раз берём одну страницу и возвращаем позицию,
    с которой продолжить: экран вызывает синхронизацию повторно, пока не дойдёт до конца.
    """
    body_data = body_data or {}
    client_id, ozon_key, ozon_on = get_ozon_credentials(cur)
    wb_key, wb_on = get_wb_credentials(cur)

    created = 0
    warnings = []

    # Сколько отзывов WB уже просмотрено и какую выборку сейчас обходим.
    wb_stage = (body_data.get('wbStage') or 'false').strip()
    wb_skip = int(body_data.get('wbSkip') or 0)
    # По 200 за вызов: 1000 отзывов не успевают сопоставиться с заказами за отведённое
    # функции время, и синхронизация обрывалась на середине. Размер порции можно
    # уменьшить запросом — на медленных ответах WB даже 200 не успевают дойти.
    try:
        page_size = int(body_data.get('pageSize') or 200)
    except (TypeError, ValueError):
        page_size = 200
    page_size = max(20, min(page_size, 1000))
    done = True

    # OZON тянем только на первом шаге: его отзывов немного, они проходят за раз.
    if wb_skip == 0 and wb_stage == 'false':
        if ozon_on and client_id and ozon_key:
            try:
                ozon_reviews = list(fetch_ozon_reviews(client_id, ozon_key))
                postings = list({rv['posting_number'] for rv in ozon_reviews if rv.get('posting_number')})
                by_posting = {}
                if postings:
                    cur.execute(
                        "SELECT ozon_posting_number, id FROM orders "
                        "WHERE ozon_posting_number = ANY(%s)",
                        (postings,),
                    )
                    by_posting = {r[0]: r[1] for r in cur.fetchall()}
                created += upsert_reviews_bulk(cur, 'OZON', [
                    (rv['external_id'], by_posting.get(rv.get('posting_number')), rv['sku'],
                     rv['product_name'], rv['rating'], rv['text'], rv['review_date'], None, None)
                    for rv in ozon_reviews
                ])
            except Exception as e:
                # Отзывы OZON доступны только на платной подписке Premium Plus. Без неё
                # площадка отвечает отказом — это не поломка, поэтому пишем понятно.
                msg = str(e)
                if 'PermissionDenied' in msg or 'subscription' in msg:
                    warnings.append('OZON: отзывы доступны только с подпиской Premium Plus')
                else:
                    warnings.append(f'OZON: {msg}')
        elif ozon_on:
            warnings.append('OZON: не заполнены ключи')

    if wb_on and wb_key:
        try:
            if wb_skip == 0 and wb_stage == 'false':
                try:
                    backfill_wb_rids(cur, wb_key)
                except Exception as e:
                    warnings.append(f'WB rid: {e}')

            reviews, got = fetch_wb_reviews(wb_key, wb_stage, wb_skip, page_size)

            # Если WB отдал и id задания, и srid — дописываем rid заказу сразу.
            set_wb_rids(cur, [
                (rv['order_id'], rv['srid'])
                for rv in reviews if rv.get('order_id') and rv.get('srid')
            ])

            order_ids = []
            for r in reviews:
                if r.get('order_id'):
                    try:
                        order_ids.append(int(r['order_id']))
                    except (TypeError, ValueError):
                        pass
            srids = [r['srid'] for r in reviews if r.get('srid')]
            by_wb_order, by_number, by_rid = {}, {}, {}
            if order_ids:
                cur.execute(
                    "SELECT wb_order_id, id FROM orders WHERE wb_order_id = ANY(%s)",
                    (order_ids,),
                )
                by_wb_order = {r[0]: r[1] for r in cur.fetchall()}
                # Номер заказа часто = id задания строкой.
                cur.execute(
                    "SELECT order_number, id FROM orders WHERE order_number = ANY(%s)",
                    ([str(x) for x in order_ids],),
                )
                by_number.update({r[0]: r[1] for r in cur.fetchall()})
            if srids:
                cur.execute(
                    "SELECT order_number, id FROM orders WHERE order_number = ANY(%s)",
                    (srids,),
                )
                by_number.update({r[0]: r[1] for r in cur.fetchall()})
                cur.execute(
                    "SELECT wb_rid, id FROM orders WHERE wb_rid = ANY(%s)",
                    (srids,),
                )
                by_rid = {r[0]: r[1] for r in cur.fetchall()}

            created += upsert_reviews_bulk(cur, 'WB', [
                (rv['external_id'], resolve_wb_order(by_wb_order, by_rid, by_number, rv),
                 rv['nm_id'], rv['product_name'], rv['rating'], rv['text'], rv['review_date'],
                 rv.get('srid'), rv.get('order_status'))
                for rv in reviews if rv['external_id']
            ])

            # Старые отзывы без заказа — по сохранённому srid после догрузки rid.
            try:
                rematch_wb_reviews(cur)
            except Exception as e:
                warnings.append(f'WB rematch: {e}')

            if got >= page_size:
                wb_skip += page_size
                done = False
            elif wb_stage == 'false':
                # Необработанные закончились — переходим к отвеченным, их основная масса.
                wb_stage, wb_skip, done = 'true', 0, False
        except Exception as e:
            warnings.append(f'WB: {e}')
    elif wb_on:
        warnings.append('WB: не заполнен ключ')

    cur.execute("SELECT COUNT(*) FROM reviews")
    total = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM reviews "
        "WHERE marketplace = 'WB' AND order_id IS NULL"
    )
    unmatched_wb = cur.fetchone()[0]

    return _resp(200, {
        'created': created,
        'warnings': warnings,
        'done': done,
        'wbStage': wb_stage,
        'wbSkip': wb_skip,
        'totalInDatabase': total,
        'unmatchedWb': unmatched_wb,
    })


# ---------- Выборка отзывов с циклом ----------

def handle_list(cur):
    cur.execute(
        "SELECT r.id, r.marketplace, r.rating, r.text, r.review_date, r.product_name, r.product_sku, "
        "r.wb_srid, r.wb_order_status, "
        "o.id, o.order_number, o.order_type, o.created_at, o.completed_at, o.sewing_status, "
        "o.wb_rid, "
        "cu.full_name, su.full_name, pu.full_name "
        "FROM reviews r "
        "LEFT JOIN orders o ON o.id = r.order_id "
        "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
        "LEFT JOIN users su ON su.id = o.sewer_user_id "
        "LEFT JOIN users pu ON pu.id = o.packer_user_id "
        "ORDER BY r.review_date DESC NULLS LAST, r.id DESC "
        "LIMIT 500"
    )
    rows = cur.fetchall()
    reviews = [{
        'id': r[0],
        'marketplace': r[1],
        'rating': r[2],
        'text': r[3],
        'reviewDate': _iso(r[4]),
        'productName': r[5],
        'productSku': r[6],
        # Буквенный ключ WB — по нему ищем заказ и швею.
        'wbSrid': r[7] or r[15],
        'wbOrderStatus': r[8],
        'orderId': r[9],
        'orderNumber': r[10],
        'orderType': r[11],
        'orderCreatedAt': _iso(r[12]),
        'orderCompletedAt': _iso(r[13]),
        'sewingStatus': r[14],
        'wbRid': r[15],
        'cutterName': r[16],
        'sewerName': r[17],
        'packerName': r[18],
    } for r in rows]
    return _resp(200, {'reviews': reviews})


# ---------- Рейтинг сотрудников ----------

def _rating_for_stage(cur, stage_column):
    cur.execute(
        f"SELECT u.id, u.full_name, COUNT(r.id), AVG(r.rating)::numeric(10,2) "
        f"FROM reviews r "
        f"JOIN orders o ON o.id = r.order_id "
        f"JOIN users u ON u.id = o.{stage_column} "
        f"WHERE r.rating IS NOT NULL "
        f"GROUP BY u.id, u.full_name "
        f"ORDER BY AVG(r.rating) DESC, COUNT(r.id) DESC"
    )
    return [{
        'userId': r[0],
        'fullName': r[1],
        'reviewsCount': int(r[2]),
        'avgRating': float(r[3]) if r[3] is not None else None,
    } for r in cur.fetchall()]


def handle_rating(cur):
    return _resp(200, {
        'cutter': _rating_for_stage(cur, 'cutter_user_id'),
        'sewer': _rating_for_stage(cur, 'sewer_user_id'),
        'packer': _rating_for_stage(cur, 'packer_user_id'),
    })


def handler(event: dict, context) -> dict:
    """Отзывы с маркетплейсов OZON/WB: синхронизация, список с производственным циклом,
    рейтинг сотрудников (закройщик/швея/упаковщик) по средней оценке отзывов."""
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        if method == 'GET':
            action = (event.get('queryStringParameters') or {}).get('action', 'list')
            if action == 'rating':
                return handle_rating(cur)
            if action == 'wb_debug':
                # Диагностика: сколько отзывов WB реально отдаёт по каждому виду выборки.
                # Нужна, чтобы понять, ограничение это на стороне WB или наша выгрузка.
                wb_key, wb_on = get_wb_credentials(cur)
                if not wb_key:
                    return _resp(200, {'ok': False, 'error': 'Не заполнен ключ WB'})
                out = {'enabled': wb_on}
                st, cnt = wb_get('/api/v1/feedbacks/count', wb_key)
                out['countEndpoint'] = {'status': st, 'data': cnt}
                st, unans = wb_get('/api/v1/feedbacks/count-unanswered', wb_key)
                out['unansweredEndpoint'] = {'status': st, 'data': unans}
                for flag in ('false', 'true'):
                    st, data = wb_get(
                        f'/api/v1/feedbacks?isAnswered={flag}&take=1000&skip=0', wb_key
                    )
                    fb = ((data or {}).get('data') or {}).get('feedbacks') or []
                    out[f'isAnswered={flag}'] = {
                        'status': st,
                        'returned': len(fb),
                        'countInResponse': ((data or {}).get('data') or {}).get('countUnanswered'),
                        'error': (data or {}).get('errorText') or '',
                    }
                cur.execute("SELECT COUNT(*) FROM reviews WHERE marketplace = 'WB'")
                out['inDatabase'] = cur.fetchone()[0]
                cur.execute(
                    "SELECT COUNT(*) FROM reviews "
                    "WHERE marketplace = 'WB' AND order_id IS NULL"
                )
                out['unmatched'] = cur.fetchone()[0]
                cur.execute(
                    "SELECT COUNT(*) FROM reviews "
                    "WHERE marketplace = 'WB' AND wb_srid IS NOT NULL AND wb_srid <> ''"
                )
                out['withSrid'] = cur.fetchone()[0]
                # Какие поля реально отдаёт WB — без srid привязка к швее невозможна.
                sample = []
                for flag in ('false', 'true'):
                    st, data = wb_get(
                        f'/api/v1/feedbacks?isAnswered={flag}&take=1&skip=0', wb_key
                    )
                    fb = ((data or {}).get('data') or {}).get('feedbacks') or []
                    if fb:
                        sample.append({
                            'isAnswered': flag,
                            'keys': sorted(fb[0].keys()),
                            'srid': fb[0].get('srid'),
                            'orderId': (fb[0].get('productDetails') or {}).get('orderId')
                            or fb[0].get('orderId'),
                        })
                        break
                out['sampleFeedback'] = sample
                return _resp(200, out)
            return handle_list(cur)
        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            if body_data.get('action') == 'sync':
                result = handle_sync(cur, body_data)
                conn.commit()
                return result
            return _resp(400, {'error': 'Неизвестное действие'})
        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()