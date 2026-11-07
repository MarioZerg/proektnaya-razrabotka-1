"""Данные Ozon для автопредложки пошива: откуда и куда едут заказы, что лежит на складах.

ЛОКАЛИЗАЦИЯ. Ozon считает заказ локальным, если вещь отгрузили со склада того же
кластера, где живёт покупатель. В отправлении это financial_data:
cluster_from (откуда отгрузили) и cluster_to (куда везут). Наши FBS-заказы
всегда едут из Ярославля, поэтому для покупателей других кластеров они не локальны.

Храним по каждой строке отправления (posting + sku): схема, кластер отгрузки,
кластер покупателя, дата. Из этого считаем:
  * спрос по кластеру покупателя и артикулу — сколько продаём в каждый регион;
  * текущую локализацию — доля заказов, где cluster_from = cluster_to.

Отправления тянем порциями: за один вызов — не больше MAX_PAGES страниц, курсор
и границу окна запоминаем в ozon_geo_sync. Так загрузка месяца не упирается
в таймаут функции, а повторный запуск продолжает с того же места.
"""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

OZON_API = 'https://api-seller.ozon.ru'
GEO_DAYS = 28
MAX_PAGES = 12
STOCK_CHUNK = 50


def ozon_post(path, client_id, api_key, payload, timeout=8):
    """Запрос к Ozon. «Слишком часто» — ждём и повторяем до 3 раз."""
    status, data = 0, None
    for attempt in range(3):
        req = urllib.request.Request(OZON_API + path, method='POST',
                                     data=json.dumps(payload).encode('utf-8'))
        req.add_header('Client-Id', client_id)
        req.add_header('Api-Key', api_key)
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode('utf-8')
                status, data = resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as err:
            detail = err.read().decode('utf-8', errors='replace')
            try:
                detail = json.loads(detail)
            except Exception:
                pass
            status, data = err.code, detail
        except Exception as err:
            status, data = 0, str(err)
        limited = status == 429 or (isinstance(data, dict)
                                    and 'rate limit' in str(data.get('message') or '').lower())
        if not limited:
            return status, data
        time.sleep(1.2 * (attempt + 1))
    return status, data


def creds(cur, shop_id):
    cur.execute(
        "SELECT credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'ozon' AND shop_id = %s ORDER BY is_enabled DESC LIMIT 1",
        (int(shop_id),),
    )
    row = cur.fetchone()
    if not row:
        return None, None
    data = row[0] if isinstance(row[0], dict) else json.loads(row[0] or '{}')
    return (data.get('clientId') or '').strip(), (data.get('apiKey') or '').strip()


def clusters(client_id, api_key):
    """Справочник кластеров Ozon: [{id, macroId, name}]."""
    status, data = ozon_post('/v1/cluster/list', client_id, api_key,
                             {'cluster_type': 'CLUSTER_TYPE_OZON'})
    found = []
    if status == 200 and isinstance(data, dict):
        for c in data.get('clusters') or []:
            if c.get('id') and c.get('name'):
                found.append({'id': int(c['id']),
                              'macroId': int(c.get('macrolocal_cluster_id') or 0) or None,
                              'name': str(c['name'])})
    return found


def _iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def _save_postings(cur, shop_id, scheme, postings):
    rows = []
    for p in postings:
        number = p.get('posting_number')
        created = p.get('in_process_at') or p.get('created_at')
        if not number or not created:
            continue
        fin = p.get('financial_data') or {}
        src = (fin.get('cluster_from') or '').strip() or None
        dst = (fin.get('cluster_to') or '').strip() or None
        status = str(p.get('status') or '')
        for prod in p.get('products') or []:
            sku = prod.get('sku')
            if not sku:
                continue
            rows.append((number, int(sku), int(shop_id), scheme, int(prod.get('quantity') or 1),
                         src, dst, status, created))
    if not rows:
        return 0

    def q(v):
        if v is None:
            return 'NULL'
        if isinstance(v, int):
            return str(v)
        return "'" + str(v).replace("'", "''") + "'"

    values = ', '.join('(' + ', '.join(q(v) for v in r) + ')' for r in rows)
    cur.execute(
        "INSERT INTO ozon_posting_geo (posting_number, sku, shop_id, scheme, quantity, "
        "  cluster_from, cluster_to, status, created_at) VALUES " + values + " "
        "ON CONFLICT (posting_number, sku) DO UPDATE SET status = EXCLUDED.status, "
        "  cluster_from = COALESCE(EXCLUDED.cluster_from, ozon_posting_geo.cluster_from), "
        "  cluster_to = COALESCE(EXCLUDED.cluster_to, ozon_posting_geo.cluster_to)"
    )
    return len(rows)


def sync_geo(cur, conn, shop_id, deadline):
    """Догружает отправления FBO и FBS за GEO_DAYS дней. Возвращает {scheme: строк}."""
    client_id, api_key = creds(cur, shop_id)
    if not client_id or not api_key:
        return {'error': 'У магазина нет ключей Ozon'}
    now = datetime.now(timezone.utc)
    result = {}
    for scheme, path in (('FBO', '/v3/posting/fbo/list'), ('FBS', '/v4/posting/fbs/list')):
        cur.execute(
            "SELECT synced_to, cursor, window_to FROM ozon_geo_sync WHERE shop_id = %s AND scheme = %s",
            (int(shop_id), scheme),
        )
        row = cur.fetchone()
        synced_to, cursor, window_to = row if row else (None, None, None)
        # Окно: от последней полной загрузки (с запасом 2 дня — статусы меняются)
        # или от начала периода, до «сейчас». Пока окно не дочитано, держим его.
        since = (synced_to - timedelta(days=2)) if synced_to else now - timedelta(days=GEO_DAYS)
        since = max(since, now - timedelta(days=GEO_DAYS))
        if not cursor or not window_to:
            window_to = now
            cursor = ''
        saved = 0
        finished = False
        for _ in range(MAX_PAGES):
            if time.time() > deadline:
                break
            req = {'filter': {'since': _iso(since), 'to': _iso(window_to)},
                   'limit': 100, 'with': {'financial_data': True}}
            req['sort_dir'] = 'DESC'
            if cursor:
                req['cursor'] = cursor
            status, data = ozon_post(path, client_id, api_key, req)
            if status != 200 or not isinstance(data, dict):
                result[f'{scheme}Error'] = f'Ozon ответил {status}'
                break
            body = data.get('result') if isinstance(data.get('result'), dict) else data
            postings = body.get('postings') or []
            saved += _save_postings(cur, shop_id, scheme, postings)
            cursor = body.get('cursor') or ''
            if not postings or not body.get('has_next') or not cursor:
                finished = True
                break
        cur.execute(
            "INSERT INTO ozon_geo_sync (shop_id, scheme, synced_to, cursor, window_to, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (shop_id, scheme) DO UPDATE SET synced_to = EXCLUDED.synced_to, "
            "  cursor = EXCLUDED.cursor, window_to = EXCLUDED.window_to, updated_at = now()",
            (int(shop_id), scheme,
             window_to if finished else synced_to,
             None if finished else cursor,
             None if finished else window_to),
        )
        conn.commit()
        result[scheme] = saved
        result[f'{scheme}Done'] = finished
    cur.execute(
        "DELETE FROM ozon_posting_geo WHERE shop_id = %s AND created_at < now() - interval '60 days'",
        (int(shop_id),),
    )
    conn.commit()
    return result


def sync_stock(cur, conn, shop_id, deadline):
    """Остатки артикулов по кластерам Ozon: доступно, в пути, в заявках.

    /v1/analytics/stocks отдаёт строки по складам — складываем в кластер.
    Читаем пачками по STOCK_CHUNK артикулов и запоминаем, на какой пачке
    остановились (ozon_geo_sync, scheme='STOCK'): функция ограничена по
    времени, а артикулов сотни. Каждая пачка сразу пишется в базу, а когда
    круг пройден целиком — удаляем строки, не обновлённые за этот круг.
    Заодно запоминаем, к какому кластеру относится каждый склад.
    """
    client_id, api_key = creds(cur, shop_id)
    if not client_id or not api_key:
        return {'error': 'У магазина нет ключей Ozon'}
    cur.execute(
        "SELECT ozon_sku FROM marketplace_items WHERE shop_id = %s "
        "AND ozon_sku IS NOT NULL AND ozon_sku ~ '^[0-9]+$'",
        (int(shop_id),),
    )
    skus = sorted({r[0] for r in cur.fetchall()}, key=lambda x: int(x))
    cur.execute(
        "SELECT cursor, window_to FROM ozon_geo_sync WHERE shop_id = %s AND scheme = 'STOCK'",
        (int(shop_id),),
    )
    row = cur.fetchone()
    offset = int(row[0]) if row and row[0] and str(row[0]).isdigit() else 0
    pass_start = row[1] if row and row[1] and offset else None
    if pass_start is None:
        cur.execute("SELECT now()")
        pass_start = cur.fetchone()[0]
        offset = 0

    def q(v):
        if v is None:
            return 'NULL'
        if isinstance(v, int):
            return str(v)
        return "'" + str(v).replace("'", "''") + "'"

    finished = False
    while True:
        if offset >= len(skus):
            finished = True
            break
        if time.time() > deadline:
            break
        status, data = ozon_post('/v1/analytics/stocks', client_id, api_key,
                                 {'skus': skus[offset:offset + STOCK_CHUNK]})
        # 429 — Ozon просит притормозить. Времени у планировщика теперь
        # достаточно: ждём и пробуем ту же пачку ещё раз, а не бросаем круг.
        for wait in (5, 15):
            if status != 429 or time.time() > deadline - wait - 3:
                break
            time.sleep(wait)
            status, data = ozon_post('/v1/analytics/stocks', client_id, api_key,
                                     {'skus': skus[offset:offset + STOCK_CHUNK]})
        if status >= 500 and time.time() < deadline - 3:
            # У Ozon этот отчёт иногда отвечает 500 — одна повторная попытка.
            time.sleep(1)
            status, data = ozon_post('/v1/analytics/stocks', client_id, api_key,
                                     {'skus': skus[offset:offset + STOCK_CHUNK]})
        if status != 200 or not isinstance(data, dict):
            conn.commit()
            return {'error': f'Ozon не отдал остатки ({status})'}
        agg, names, wh = {}, {}, {}
        for it in data.get('items') or []:
            cid, sku = it.get('cluster_id'), it.get('sku')
            if not cid or not sku:
                continue
            key = (int(cid), int(sku))
            a = agg.setdefault(key, [0, 0, 0, None, it.get('macrolocal_cluster_id')])
            a[0] += int(it.get('available_stock_count') or 0)
            a[1] += int(it.get('transit_stock_count') or 0)
            a[2] += int(it.get('requested_stock_count') or 0)
            a[3] = it.get('turnover_grade_cluster') or a[3]
            names[int(cid)] = it.get('cluster_name') or ''
            wname = (it.get('warehouse_name') or '').strip()
            if wname and not wname.upper().startswith('ПВЗ'):
                wh[wname] = (int(cid), it.get('cluster_name') or '')
        if agg:
            values = ', '.join(
                f"({int(shop_id)}, {cid}, {q(names.get(cid, ''))}, {sku}, {a[0]}, {a[1]}, {a[2]}, "
                f"{q(a[3])}, {q(int(a[4]) if a[4] else None)}, now())"
                for (cid, sku), a in agg.items()
            )
            cur.execute(
                "INSERT INTO ozon_cluster_stock (shop_id, cluster_id, cluster_name, sku, available, "
                "  in_transit, requested, grade, macro_cluster_id, updated_at) VALUES " + values + " "
                "ON CONFLICT (shop_id, cluster_id, sku) DO UPDATE SET cluster_name = EXCLUDED.cluster_name, "
                "  available = EXCLUDED.available, in_transit = EXCLUDED.in_transit, "
                "  requested = EXCLUDED.requested, grade = EXCLUDED.grade, "
                "  macro_cluster_id = EXCLUDED.macro_cluster_id, updated_at = now()"
            )
        if wh:
            values = ', '.join(f"({q(n)}, {c}, {q(cn)})" for n, (c, cn) in wh.items())
            cur.execute(
                "INSERT INTO ozon_warehouse_cluster (warehouse_name, cluster_id, cluster_name) VALUES "
                + values + " ON CONFLICT (warehouse_name) DO UPDATE SET cluster_id = EXCLUDED.cluster_id, "
                "  cluster_name = EXCLUDED.cluster_name, updated_at = now()"
            )
        offset += STOCK_CHUNK
        cur.execute(
            "INSERT INTO ozon_geo_sync (shop_id, scheme, cursor, window_to, updated_at) "
            "VALUES (%s, 'STOCK', %s, %s, now()) ON CONFLICT (shop_id, scheme) DO UPDATE SET "
            "  cursor = EXCLUDED.cursor, window_to = EXCLUDED.window_to, updated_at = now()",
            (int(shop_id), str(offset), pass_start),
        )
        conn.commit()
    if finished:
        # Артикул пропал с какого-то склада — его строка за круг не обновилась.
        cur.execute(
            "UPDATE ozon_cluster_stock SET available = 0, in_transit = 0, requested = 0 "
            "WHERE shop_id = %s AND updated_at < %s",
            (int(shop_id), pass_start),
        )
        cur.execute(
            "INSERT INTO ozon_geo_sync (shop_id, scheme, synced_to, cursor, window_to, updated_at) "
            "VALUES (%s, 'STOCK', now(), NULL, NULL, now()) ON CONFLICT (shop_id, scheme) DO UPDATE SET "
            "  synced_to = now(), cursor = NULL, window_to = NULL, updated_at = now()",
            (int(shop_id),),
        )
        conn.commit()
    return {'done': finished, 'read': min(offset, len(skus)), 'skus': len(skus)}
