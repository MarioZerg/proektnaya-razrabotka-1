"""Автопредложения поставок FBO из товара на полках.

Предложка не поставка. Пока администратор её не подтвердил, стикеры GW
в ней заняты и не уходят в подбор. Подтверждение создаёт прямой черновик
FBO и закрывает эти вещи со склада. Отклонение возвращает их на полки.
"""

import json
import os
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

OZON_API = 'https://api-seller.ozon.ru'
MIN_PIECES = 50
DEMAND_DAYS = 30
# Газелька — не раньше чем через 2 рабочих дня (сборка на складе).
MIN_LEAD_DAYS = 2
# Ворота Ozon — через 2 рабочих дня после газельки (дорога). Выходные не считаем.
GATE_GAP_DAYS = 2


def _is_weekend(day):
    return day.weekday() >= 5


def _add_workdays(start, days):
    day = start if isinstance(start, date) else date.fromisoformat(str(start)[:10])
    left = days
    while left > 0:
        day += timedelta(days=1)
        if not _is_weekend(day):
            left -= 1
    while _is_weekend(day):
        day += timedelta(days=1)
    return day


def _sub_workdays(start, days):
    day = start if isinstance(start, date) else date.fromisoformat(str(start)[:10])
    left = days
    while left > 0:
        day -= timedelta(days=1)
        if not _is_weekend(day):
            left -= 1
    while _is_weekend(day):
        day -= timedelta(days=1)
    return day
# Ходовой товар: продан хотя бы столько раз за месяц (любая схема Ozon).
# Неликвид в предложку не берём — иначе он просто переедет на склад Ozon
# и будет лежать там за наши деньги.
LIQUID_MIN_SALES = 2


def _resp(status, body, headers):
    return {
        'statusCode': status,
        'headers': headers,
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def _words(text):
    raw = (text or '').lower().replace('ё', 'е').replace('_', ' ')
    return [w for w in ''.join(ch if ch.isalnum() else ' ' for ch in raw).split() if len(w) >= 4]


def _same_place(left, right):
    a, b = _words(left), _words(right)
    if not a or not b:
        return False
    b_text = ' '.join(b)
    a_text = ' '.join(a)
    return any(w in b_text for w in a) or any(w in a_text for w in b)


def _ozon_post(path, client_id, api_key, payload, timeout=20):
    """Запрос к Ozon. При «rate limit per second» ждём и повторяем до 3 раз."""
    for attempt in range(3):
        status, data = _ozon_post_once(path, client_id, api_key, payload, timeout)
        limited = status == 429 or (
            isinstance(data, dict) and 'rate limit' in str(data.get('message') or '').lower()
        )
        if not limited:
            return status, data
        time.sleep(1.2 * (attempt + 1))
    return status, data


def _ozon_post_once(path, client_id, api_key, payload, timeout=20):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(OZON_API + path, method='POST', data=body)
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8')
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as err:
        detail = err.read().decode('utf-8', errors='replace')
        try:
            detail = json.loads(detail)
        except Exception:
            pass
        return err.code, detail


def _creds(cur, shop_id):
    cur.execute(
        "SELECT credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'ozon' AND shop_id = %s "
        "ORDER BY is_enabled DESC LIMIT 1",
        (int(shop_id),),
    )
    row = cur.fetchone()
    if not row:
        return None, None
    creds = row[0] if isinstance(row[0], dict) else json.loads(row[0] or '{}')
    return (creds.get('clientId') or '').strip(), (creds.get('apiKey') or '').strip()


def _walk(node, bag):
    if isinstance(node, dict):
        bag.append(node)
        for value in node.values():
            _walk(value, bag)
    elif isinstance(node, list):
        for value in node:
            _walk(value, bag)


def _draft_clusters(info):
    """Кластеры, куда прямая поставка сейчас проходит."""
    found = []
    nodes = []
    _walk(info, nodes)
    for node in nodes:
        name = node.get('cluster_name') or node.get('name') or node.get('macrolocal_cluster_name')
        warehouses = node.get('warehouses') or node.get('warehouse_list') or []
        if not name or not isinstance(warehouses, list):
            continue
        available = []
        for warehouse in warehouses:
            if not isinstance(warehouse, dict):
                continue
            status = (warehouse.get('availability_status') or warehouse.get('status')
                      or warehouse.get('availability') or {})
            if isinstance(status, dict):
                state = str(status.get('state') or status.get('invalid_reason') or '')
                if status.get('is_available') is False:
                    continue
                if 'NOT_AVAILABLE' in state or 'NOT_ACCEPT' in state:
                    continue
            warehouse_id = (
                warehouse.get('warehouse_id')
                or (warehouse.get('storage_warehouse') or {}).get('warehouse_id')
                or (warehouse.get('supply_warehouse') or {}).get('warehouse_id')
                or (warehouse.get('warehouse') or {}).get('warehouse_id')
            )
            warehouse_name = (
                warehouse.get('name')
                or (warehouse.get('storage_warehouse') or {}).get('name')
                or (warehouse.get('supply_warehouse') or {}).get('name')
                or (warehouse.get('warehouse') or {}).get('name')
                or name
            )
            if warehouse_id:
                available.append({'id': int(warehouse_id), 'name': warehouse_name,
                                  'rank': int(warehouse.get('total_rank') or 999)})
        # Первым — склад, который Ozon сам рекомендует (меньший ранг).
        available.sort(key=lambda w: w['rank'])
        if available:
            found.append({'name': str(name), 'warehouses': available})
    return found


def _ozon_clusters(client_id, api_key):
    """Справочник кластеров Ozon: название → macrolocal_cluster_id."""
    status, data = _ozon_post('/v1/cluster/list', client_id, api_key, {
        'cluster_type': 'CLUSTER_TYPE_OZON',
    })
    found = []
    if status == 200 and isinstance(data, dict):
        for c in data.get('clusters') or []:
            cid = c.get('macrolocal_cluster_id') or c.get('id')
            names = [c.get('name') or '']
            for lc in c.get('logistic_clusters') or []:
                for w in lc.get('warehouses') or []:
                    names.append(w.get('name') or '')
            if cid:
                found.append({'id': int(cid), 'name': c.get('name') or '', 'names': names})
    return found


def _cluster_id_for(clusters, our_name):
    """Ищем кластер Ozon, к которому относится наш кластер (склад) из заказов."""
    for c in clusters:
        if any(_same_place(our_name, n) for n in c['names'] if n):
            return c['id']
    return None


def _probe_cluster(client_id, api_key, items, cluster_id):
    """Черновик прямой поставки в один кластер и его доступные склады.

    items: [{sku: int, quantity: int}]
    Старый /v1/draft/create Ozon отключил («obsolete method») — теперь
    /v1/draft/direct/create + /v2/draft/create/info.
    """
    status, data = _ozon_post('/v1/draft/direct/create', client_id, api_key, {
        'cluster_info': {'items': items, 'macrolocal_cluster_id': int(cluster_id)},
        # Не прошедшие проверку единицы Ozon уберёт, остальное оставит.
        'deletion_sku_mode': 'PARTIAL',
    })
    if status != 200 or not isinstance(data, dict):
        message = data.get('message') if isinstance(data, dict) else str(data)
        return None, f'Ozon не принял расчёт прямой поставки: {message}'
    draft_id = data.get('draft_id')
    if not draft_id:
        message = data.get('message') or ''
        errs = data.get('errors') or []
        if errs and isinstance(errs[0], dict):
            message = message or errs[0].get('error_message') or ''
        return None, f'Ozon не создал расчёт поставки {message}'.strip()
    info = None
    for _ in range(8):
        status, info = _ozon_post('/v2/draft/create/info', client_id, api_key, {
            'draft_id': int(draft_id),
        })
        if status != 200 or not isinstance(info, dict):
            break
        if str(info.get('status') or '') != 'IN_PROGRESS':
            break
        time.sleep(1)
    if not isinstance(info, dict) or info.get('status') == 'FAILED':
        errs = (info or {}).get('errors') if isinstance(info, dict) else None
        reason = ''
        if errs and isinstance(errs[0], dict):
            reason = errs[0].get('error_message') or ', '.join(errs[0].get('error_reasons') or [])
        return None, f'Ozon не рассчитал поставку {reason}'.strip()
    clusters = _draft_clusters(info)
    if not clusters:
        # Причину берём из ответа Ozon: склады есть, но закрыты — почему.
        why = []
        for c in info.get('clusters') or []:
            for w in c.get('warehouses') or []:
                av = w.get('availability_status') or {}
                r = av.get('invalid_reason') or av.get('state')
                if r and r not in why:
                    why.append(str(r))
        for e in info.get('errors') or []:
            if isinstance(e, dict):
                for r in (e.get('error_reasons') or []) + [e.get('error_message')]:
                    if r and r != 'UNSPECIFIED' and r not in why:
                        why.append(str(r))
        raw = json.dumps(info, ensure_ascii=False)[:600]
        print(f'draft {draft_id} без складов: {raw}')
        return None, ('Ozon не показал ни одного склада, который сейчас принимает прямую поставку'
                      + (f' ({", ".join(why[:5])})' if why else ''))
    return {'draftId': int(draft_id), 'clusters': clusters}, None


def _slot_window(client_id, api_key, draft_id, warehouse_id, cluster_id=None, earliest=None):
    """Ближайшее свободное окно приёмки: (начало, конец) строками Ozon."""
    today = date.today()
    status, data = _ozon_post('/v2/draft/timeslot/info', client_id, api_key, {
        'draft_id': int(draft_id),
        'supply_type': 'DIRECT',
        'date_from': today.isoformat(),
        'date_to': (today + timedelta(days=27)).isoformat(),
        'selected_cluster_warehouses': [{
            'macrolocal_cluster_id': int(cluster_id or 0),
            'storage_warehouse_id': int(warehouse_id),
        }],
    })
    if status != 200 or not isinstance(data, dict):
        return None, None
    nodes = []
    _walk(data, nodes)
    if earliest is None:
        earliest = _add_workdays(_add_workdays(today, MIN_LEAD_DAYS), GATE_GAP_DAYS)
    earliest = str(earliest)[:10]
    best = None
    for node in nodes:
        begin = node.get('from_in_timezone')
        end = node.get('to_in_timezone')
        if not begin or not isinstance(begin, str) or len(begin) < 10:
            continue
        # Раньше газельки + 2 рабочих дня не бронируем, на выходные — тоже.
        if begin[:10] < earliest:
            continue
        try:
            if _is_weekend(date.fromisoformat(begin[:10])):
                continue
        except ValueError:
            continue
        if best is None or begin < best[0]:
            best = (begin, end if isinstance(end, str) else None)
    return best if best else (None, None)


def _nearest_slot(client_id, api_key, draft_id, warehouse_id, cluster_id=None, earliest=None):
    best, _end = _slot_window(client_id, api_key, draft_id, warehouse_id, cluster_id, earliest)
    if not best:
        return None, None
    slot = best[11:16] if len(best) >= 16 and best[10] in ('T', ' ') else None
    return best[:10], slot


def _gazelka_trips(cluster, first_day):
    """Даты рейсов газельки в этот город, не раньше first_day, по возрастанию."""
    token = (os.environ.get('GAZELKA_API_KEY') or '').strip()
    if not token:
        return []
    req = urllib.request.Request(
        'https://gazelka.space/api/my-plans',
        method='POST',
        data=b'{}',
    )
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode('utf-8') or '[]')
    except Exception:
        return []
    plans = payload if isinstance(payload, list) else (payload.get('plans') or payload.get('data') or [])
    first = str(first_day)[:10]
    found = set()
    for plan in plans:
        if not isinstance(plan, dict):
            continue
        address = plan.get('delivery_address') or ''
        if not _same_place(cluster, address):
            continue
        route = plan.get('route') if isinstance(plan.get('route'), dict) else {}
        ship = (route.get('date') or plan.get('delivery_date') or '')[:10]
        if ship and ship >= first:
            found.add(ship)
    return sorted(found)


def _schedule(client_id, api_key, draft_id, warehouse_id, cluster_id, cluster):
    """Газелька и ворота с интервалом.

    Газелька — ближайший рейс не раньше чем через 2 рабочих дня.
    Ворота — не раньше чем через 2 рабочих дня после газельки, без выходных.
    Если ближайший свободный слот позже — газельку сдвигаем к последнему
    рейсу, который всё ещё успевает за 2 рабочих дня до ворот.
    """
    first_ship = _add_workdays(date.today(), MIN_LEAD_DAYS)
    trips = _gazelka_trips(cluster, first_ship)
    ship = date.fromisoformat(trips[0]) if trips else first_ship
    gate_from = _add_workdays(ship, GATE_GAP_DAYS)
    gate_date, gate_slot = _nearest_slot(
        client_id, api_key, draft_id, warehouse_id, cluster_id, gate_from)
    if not gate_date:
        return None, None, ship.isoformat()
    latest_ship = _sub_workdays(gate_date, GATE_GAP_DAYS).isoformat()
    fitting = [t for t in trips if t <= latest_ship]
    if fitting:
        ship_day = fitting[-1]
    elif trips:
        ship_day = ship.isoformat()
    else:
        ship_day = latest_ship
    return gate_date, gate_slot, ship_day


def _popular_sizes(cur):
    cur.execute(
        "SELECT width, height, COUNT(*) FROM orders "
        "WHERE created_at > now() - interval '60 days' "
        "  AND width IS NOT NULL AND height IS NOT NULL "
        "GROUP BY width, height"
    )
    rows = cur.fetchall()
    total = sum(int(r[2]) for r in rows)
    if not total:
        return set()
    return {
        (r[0], r[1]) for r in rows
        if int(r[2]) / total >= 0.01
    }


def _rollback_proposal(cur, pid, sid):
    """Отменяет недописанную поставку предложки и возвращает вещи на полку."""
    if sid:
        cur.execute(
            "UPDATE goods_warehouse SET status = CASE WHEN status = 'picking' THEN 'in_stock' ELSE status END, "
            "reserved_order_id = NULL, matched_at = NULL "
            "WHERE reserved_order_id IN (SELECT id FROM orders WHERE supply_id = %s AND source = 'proposal') "
            "  AND shipping_labeled_at IS NULL AND shipped_at IS NULL",
            (int(sid),),
        )
        cur.execute(
            "UPDATE orders SET status = 'Отменён', fulfilled_from_stock_id = NULL "
            "WHERE supply_id = %s AND source = 'proposal'",
            (int(sid),),
        )
        cur.execute("UPDATE marketplace_supplies SET status = 'Отменена' WHERE id = %s", (int(sid),))
    cur.execute(
        "UPDATE fbo_supply_proposals SET status = 'open', supply_id = NULL, decided_at = NULL "
        "WHERE id = %s",
        (int(pid),),
    )
    cur.execute(
        "UPDATE fbo_supply_proposal_items SET open_hold = true WHERE proposal_id = %s",
        (int(pid),),
    )


def recover_after_failure(dsn, proposal_id):
    """Подтверждение упало на полпути — сразу откатываем, не ждём 3 минуты.

    База платформы фиксирует каждый запрос сразу, поэтому при обрыве
    поставка оставалась записанной частично (33 из 78) и предложка висела.
    Откатываем, только если предложка так и не дошла до 'accepted'.
    """
    import psycopg2
    for _ in range(3):
        try:
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT status, supply_id FROM fbo_supply_proposals WHERE id = %s",
                    (int(proposal_id),),
                )
                row = cur.fetchone()
                if not row:
                    return 'none'
                if row[0] == 'accepted':
                    conn.commit()
                    return 'accepted'
                if row[0] == 'accepting':
                    _rollback_proposal(cur, int(proposal_id), row[1])
                conn.commit()
                return 'rolled_back'
            finally:
                conn.close()
        except psycopg2.OperationalError:
            time.sleep(1.5)
    return 'unknown'


def _recover_stuck(cur, shop_id):
    """Подтверждение оборвалось (база/Ozon не ответили) — откатываем недописанное.

    Предложка висит в 'accepting' дольше 90 секунд (функцию оборвал таймаут): её поставку отменяем, заказы
    снимаем, вещи возвращаем на полку, предложку открываем снова.
    """
    cur.execute(
        "SELECT id, supply_id FROM fbo_supply_proposals "
        "WHERE shop_id = %s AND status = 'accepting' "
        "  AND COALESCE(decided_at, created_at) < now() - interval '90 seconds'",
        (int(shop_id),),
    )
    for pid, sid in cur.fetchall():
        _rollback_proposal(cur, pid, sid)


def list_open(cur, shop_id):
    cur.execute(
        "SELECT p.id, p.cluster, p.gate_date, p.gate_timeslot, p.gazelka_date, "
        "       p.created_at, COUNT(i.id) "
        "FROM fbo_supply_proposals p "
        "JOIN fbo_supply_proposal_items i ON i.proposal_id = p.id AND i.open_hold "
        "WHERE p.shop_id = %s AND p.status = 'open' "
        "GROUP BY p.id ORDER BY p.id DESC",
        (int(shop_id),),
    )
    proposals = []
    for row in cur.fetchall():
        cur.execute(
            "SELECT COALESCE(mi.name, src.product, 'Товар'), COUNT(*), bool_or(i.popular) "
            "FROM fbo_supply_proposal_items i "
            "JOIN goods_warehouse gw ON gw.id = i.goods_warehouse_id "
            "JOIN orders src ON src.id = gw.order_id "
            "LEFT JOIN marketplace_items mi ON mi.id = i.marketplace_item_id "
            "WHERE i.proposal_id = %s AND i.open_hold "
            "GROUP BY 1 ORDER BY 2 DESC",
            (row[0],),
        )
        articles = [
            {'name': name, 'quantity': int(qty), 'popular': bool(popular)}
            for name, qty, popular in cur.fetchall()
        ]
        proposals.append({
            'id': row[0],
            'cluster': row[1],
            'gateDate': row[2].isoformat() if row[2] else None,
            'gateTimeslot': row[3],
            'gazelkaDate': row[4].isoformat() if row[4] else None,
            'createdAt': row[5].isoformat() if row[5] else None,
            'pieces': int(row[6]),
            'articles': articles,
        })
    return proposals


def _free_goods(cur, shop_id):
    cur.execute(
        "SELECT gw.id, src.marketplace_item_id, mi.ozon_sku, src.width, src.height "
        "FROM goods_warehouse gw "
        "JOIN orders src ON src.id = gw.order_id "
        "JOIN marketplace_items mi ON mi.id = src.marketplace_item_id "
        "WHERE gw.status = 'in_stock' AND gw.shelf_id IS NOT NULL "
        "  AND gw.reserved_order_id IS NULL "
        "  AND src.shop_id = %s "
        "  AND mi.ozon_sku IS NOT NULL AND mi.ozon_sku <> '' "
        "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
        "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
        "                  WHERE msi.goods_warehouse_id = gw.id "
        "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
        "  AND NOT EXISTS (SELECT 1 FROM fbo_supply_proposal_items pi "
        "                  WHERE pi.goods_warehouse_id = gw.id AND pi.open_hold) "
        "ORDER BY gw.received_at ASC",
        (int(shop_id),),
    )
    return cur.fetchall()


def _demand(cur, shop_id):
    """Продажи FBO по кластерам за месяц: где и что покупают со склада Ozon."""
    cur.execute(
        "SELECT o.cluster, o.marketplace_item_id, COUNT(*) "
        "FROM orders o "
        "WHERE o.order_type = 'FBO' AND o.marketplace = 'OZON' "
        "  AND o.shop_id = %s AND o.cluster IS NOT NULL AND o.cluster <> '' "
        "  AND o.marketplace_item_id IS NOT NULL "
        f"  AND o.created_at > now() - interval '{DEMAND_DAYS} days' "
        "GROUP BY o.cluster, o.marketplace_item_id",
        (int(shop_id),),
    )
    demand = {}
    for cluster, item_id, qty in cur.fetchall():
        demand.setdefault(cluster, {})[int(item_id)] = int(qty)
    return demand


def _monthly_sales(cur, shop_id):
    """Сколько раз артикул продался на Ozon за месяц — FBS и FBO вместе."""
    cur.execute(
        "SELECT o.marketplace_item_id, COUNT(*) "
        "FROM orders o "
        "WHERE o.marketplace = 'OZON' AND o.shop_id = %s "
        "  AND o.marketplace_item_id IS NOT NULL "
        f"  AND o.created_at > now() - interval '{DEMAND_DAYS} days' "
        "GROUP BY o.marketplace_item_id",
        (int(shop_id),),
    )
    return {int(r[0]): int(r[1]) for r in cur.fetchall()}


def _ozon_stock(client_id, api_key, clusters):
    """Свободный остаток артикула на складах, которые относятся к нашим кластерам."""
    by_cluster = {name: {} for name in clusters}
    offset = 0
    while offset < 5000:
        status, data = _ozon_post('/v2/analytics/stock_on_warehouses', client_id, api_key, {
            'limit': 1000, 'offset': offset, 'warehouse_type': 'ALL',
        })
        if status != 200 or not isinstance(data, dict):
            return None, 'Не удалось прочитать остатки складов Ozon'
        rows = ((data.get('result') or {}).get('rows')) or []
        if not rows:
            break
        for row in rows:
            warehouse = row.get('warehouse_name') or ''
            sku = str(row.get('sku') or '')
            free = int(row.get('free_to_sell_amount') or 0)
            for cluster in clusters:
                if _same_place(cluster, warehouse):
                    by_cluster[cluster][sku] = by_cluster[cluster].get(sku, 0) + free
        if len(rows) < 1000:
            break
        offset += 1000
    return by_cluster, None


def build(cur, shop_id):
    # Два одновременных нажатия «Сформировать» не должны занять одни и те же
    # GW дважды: второй расчёт ждёт, пока первый не закончит. Служебные
    # блокировки базы на платформе запрещены, поэтому держим строку магазина.
    cur.execute('SELECT id FROM shops WHERE id = %s FOR UPDATE', (int(shop_id),))
    goods = _free_goods(cur, shop_id)
    demand = _demand(cur, shop_id)
    if not demand:
        return {'created': [], 'skipped': [f'Нет отгрузок FBO за {DEMAND_DAYS} дней — нечего сравнивать с кластерами']}
    sales = _monthly_sales(cur, shop_id)
    client_id, api_key = _creds(cur, shop_id)
    if not client_id or not api_key:
        return {'error': 'У магазина нет ключей Ozon'}
    stock, stock_error = _ozon_stock(client_id, api_key, list(demand))
    if stock_error:
        return {'error': stock_error}

    # Ozon больше не даёт выбрать склад — только регион (кластер), а склад
    # внутри него назначает сам. Поэтому продажи и остатки складов одного
    # региона (Пушкино, Петровское, Хоругвино…) складываем в одну предложку.
    ozon_clusters = _ozon_clusters(client_id, api_key)
    region_id = {}
    region_demand = {}
    region_stock = {}
    no_region = []
    for our_name, need in demand.items():
        cid = _cluster_id_for(ozon_clusters, our_name)
        region = next((c['name'] for c in ozon_clusters if c['id'] == cid), None) if cid else None
        if not region:
            no_region.append(our_name)
            continue
        region_id[region] = cid
        bucket = region_demand.setdefault(region, {})
        for item_id, qty in need.items():
            bucket[item_id] = bucket.get(item_id, 0) + qty
        sbucket = region_stock.setdefault(region, {})
        for sku, qty in (stock.get(our_name) or {}).items():
            sbucket[sku] = sbucket.get(sku, 0) + qty
    demand, stock = region_demand, region_stock
    if not demand:
        return {'created': [], 'skipped': [f'{n}: не нашли регион в справочнике Ozon' for n in no_region]}
    popular = _popular_sizes(cur)
    by_item = {}
    for gw_id, item_id, ozon_sku, width, height in goods:
        by_item.setdefault(int(item_id), []).append({
            'id': int(gw_id),
            'itemId': int(item_id),
            'sku': int(ozon_sku) if str(ozon_sku).isdigit() else None,
            'popular': (width, height) in popular,
        })

    plans = {c: {'goods': [], 'draft': {}} for c in demand}

    def on_ozon(cluster, sku):
        return stock.get(cluster, {}).get(str(sku), 0) if sku else 0

    def give(cluster, item_id, qty):
        pieces = by_item.get(item_id) or []
        sku = next((p['sku'] for p in pieces if p['sku']), None)
        take = min(len(pieces), qty)
        if take <= 0 or not sku:
            return 0
        plans[cluster]['goods'].extend(pieces[:take])
        del pieces[:take]
        plans[cluster]['draft'][sku] = plans[cluster]['draft'].get(sku, 0) + take
        return take

    # ШАГ 1. ДЕФИЦИТ: в кластере артикул продаётся, а на складе Ozon его
    # меньше, чем ушло за месяц. Везём недостающее.
    for cluster, need in demand.items():
        for item_id, needed in need.items():
            if sales.get(item_id, 0) < LIQUID_MIN_SALES:
                continue
            pieces = by_item.get(item_id) or []
            sku = next((p['sku'] for p in pieces if p['sku']), None)
            give(cluster, item_id, needed - on_ozon(cluster, sku))

    # ШАГ 2. ХОДОВОЙ ТОВАР (от LIQUID_MIN_SALES продаж за месяц), который по
    # FBO в кластере ещё не продавался — например, уходит только с FBS.
    # Делим месячные продажи между кластерами пропорционально их обороту FBO
    # и докладываем то, чего на Ozon не хватает. Неликвид не трогаем.
    weight = {c: sum(n.values()) for c, n in demand.items()}
    total_weight = sum(weight.values()) or 1
    ordered = sorted(demand, key=lambda c: weight[c], reverse=True)
    liquid = sorted(
        (i for i, q in sales.items() if q >= LIQUID_MIN_SALES and by_item.get(i)),
        key=lambda i: sales[i], reverse=True,
    )
    for item_id in liquid:
        for cluster in ordered:
            if not by_item.get(item_id):
                break
            sku = next((p['sku'] for p in by_item[item_id] if p['sku']), None)
            share = sales[item_id] * weight[cluster] / total_weight
            target = max(1, int(share + 0.999))
            already = sum(1 for g in plans[cluster]['goods'] if g['itemId'] == item_id)
            give(cluster, item_id, target - on_ozon(cluster, sku) - already)

    planned = []
    too_small = []
    for cluster in ordered:
        chosen = plans[cluster]['goods']
        if not chosen:
            continue
        if len(chosen) < MIN_PIECES:
            too_small.append(f'{cluster}: набралось {len(chosen)} шт. из {MIN_PIECES} — ходового товара в дефиците мало')
            # Не занимаем вещи: пусть достанутся кластеру, где поставка соберётся.
            for g in chosen:
                by_item.setdefault(g['itemId'], []).append(g)
            continue
        planned.append({
            'cluster': cluster,
            'items': [{'sku': sku, 'quantity': qty} for sku, qty in plans[cluster]['draft'].items()],
            'goods': chosen,
        })

    created = []
    skipped = list(too_small) + [f'{n}: не нашли регион в справочнике Ozon' for n in no_region]
    for plan in planned:
        cur.execute(
            "SELECT id FROM fbo_supply_proposals "
            "WHERE shop_id = %s AND cluster = %s AND status = 'open'",
            (int(shop_id), plan['cluster']),
        )
        if cur.fetchone():
            skipped.append(f'{plan["cluster"]}: предложка уже открыта')
            continue
        cluster_id = region_id.get(plan['cluster'])
        if not cluster_id:
            skipped.append(f'{plan["cluster"]}: не нашли этот кластер в справочнике Ozon')
            continue
        probe, error = _probe_cluster(client_id, api_key, plan['items'], cluster_id)
        if error:
            skipped.append(f'{plan["cluster"]}: {error}')
            continue
        match = probe['clusters'][0]
        warehouse_id = match['warehouses'][0]['id']
        gate_date, gate_slot, gazelka = _schedule(
            client_id, api_key, probe['draftId'], warehouse_id, cluster_id, plan['cluster'])
        cur.execute(
            "INSERT INTO fbo_supply_proposals "
            "(shop_id, cluster, ozon_draft_id, ozon_warehouse_id, gate_date, gate_timeslot, gazelka_date, "
            " ozon_cluster_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (int(shop_id), plan['cluster'], probe['draftId'], warehouse_id,
             gate_date, gate_slot, gazelka, int(cluster_id)),
        )
        proposal_id = cur.fetchone()[0]
        for piece in plan['goods']:
            cur.execute(
                "INSERT INTO fbo_supply_proposal_items "
                "(proposal_id, goods_warehouse_id, marketplace_item_id, popular) "
                "VALUES (%s, %s, %s, %s)",
                (proposal_id, piece['id'], piece['itemId'], piece['popular']),
            )
        created.append(plan['cluster'])
    return {'created': created, 'skipped': skipped}


def reject(cur, proposal_id, actor_id, shop_id):
    cur.execute(
        "SELECT ozon_draft_id FROM fbo_supply_proposals "
        "WHERE id = %s AND shop_id = %s AND status = 'open'",
        (int(proposal_id), int(shop_id)),
    )
    row = cur.fetchone()
    if not row:
        return {'error': 'Открытая предложка не найдена'}
    cur.execute(
        "UPDATE fbo_supply_proposal_items SET open_hold = false WHERE proposal_id = %s",
        (int(proposal_id),),
    )
    cur.execute(
        "UPDATE fbo_supply_proposals SET status = 'rejected', decided_at = now(), decided_by = %s "
        "WHERE id = %s",
        (int(actor_id) if actor_id else None, int(proposal_id)),
    )
    # Черновик Ozon сам исчезает через 30 минут — удалять нечего.
    return {'rejected': True}


def _next_order_number(cur):
    cur.execute(
        "SELECT order_number FROM orders WHERE order_number ~ '^00000-[0-9]+$' "
        "ORDER BY (split_part(order_number, '-', 2))::int DESC LIMIT 1"
    )
    last = cur.fetchone()
    return (int(last[0].split('-')[1]) + 1) if last else 1


def accept(cur, proposal_id, actor_id, actor_name, shop_id):
    cur.execute(
        # Сначала «захватываем» предложку одним запросом: повторное нажатие
        # или второй администратор получат отказ, а не вторую поставку.
        "UPDATE fbo_supply_proposals SET status = 'accepting', decided_at = now() "
        "WHERE id = %s AND shop_id = %s AND status = 'open' "
        "RETURNING cluster, ozon_draft_id, ozon_warehouse_id, gate_date, gate_timeslot, gazelka_date, "
        "          ozon_cluster_id, created_at",
        (int(proposal_id), int(shop_id)),
    )
    proposal = cur.fetchone()
    if not proposal:
        return {'error': 'Предложка уже подтверждена или отклонена — обновите список'}
    (cluster, draft_id, warehouse_id, gate_date, gate_slot, gazelka_date,
     ozon_cluster_id, proposal_created) = proposal
    cur.execute(
        "SELECT i.goods_warehouse_id, i.marketplace_item_id, gw.status, gw.reserved_order_id "
        "FROM fbo_supply_proposal_items i "
        "JOIN goods_warehouse gw ON gw.id = i.goods_warehouse_id "
        # Все строки предложки, а не только «удерживаемые»: потерянная вещь
        # снимается с удержания, но в черновике Ozon она осталась — её
        # нужно заменить или отшить, а не молча выкинуть из поставки.
        "WHERE i.proposal_id = %s "
        "FOR UPDATE OF gw",
        (int(proposal_id),),
    )
    rows = cur.fetchall()
    # Вещь годится, только если всё ещё лежит на полке и НИКЕМ не забронирована.
    # Без проверки брони одна вещь могла уйти и в FBS-заказ, и в эту поставку.
    ready = [(r[0], r[1]) for r in rows if r[2] == 'in_stock' and r[3] is None]
    if not rows:
        cur.execute("UPDATE fbo_supply_proposals SET status = 'open' WHERE id = %s", (int(proposal_id),))
        return {'error': 'В предложке не осталось вещей. Сформируйте заново'}

    # Чего не хватает (вещь потеряли, продали, забронировали под другой заказ):
    # сначала ищем замену того же артикула на полках, остальное — в пошив.
    # Так поставка остаётся ровно того состава, который ушёл в черновик Ozon.
    missing = {}
    for r in rows:
        if not (r[2] == 'in_stock' and r[3] is None):
            missing[int(r[1])] = missing.get(int(r[1]), 0) + 1
    taken = {int(gw) for gw, _ in ready}
    to_sew = []
    for item_id, qty in missing.items():
        cur.execute(
            "SELECT gw.id FROM goods_warehouse gw "
            "JOIN orders src ON src.id = gw.order_id "
            "WHERE gw.status = 'in_stock' AND gw.shelf_id IS NOT NULL "
            "  AND gw.reserved_order_id IS NULL "
            "  AND src.marketplace_item_id = %s AND src.shop_id = %s "
            "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
            "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
            "                  WHERE msi.goods_warehouse_id = gw.id "
            "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
            "  AND NOT EXISTS (SELECT 1 FROM fbo_supply_proposal_items _fpi "
            "                  WHERE _fpi.goods_warehouse_id = gw.id AND _fpi.open_hold) "
            "ORDER BY gw.received_at ASC LIMIT %s "
            "FOR UPDATE OF gw SKIP LOCKED",
            (item_id, int(shop_id), qty + len(taken)),
        )
        subs = [int(x[0]) for x in cur.fetchall() if int(x[0]) not in taken][:qty]
        for gw_id in subs:
            taken.add(gw_id)
            ready.append((gw_id, item_id))
        to_sew.extend([item_id] * (qty - len(subs)))

    client_id, api_key = _creds(cur, shop_id)

    # Черновик Ozon живёт 30 минут. Предложку подтверждают позже — поэтому
    # перед созданием заявки считаем черновик заново по фактическому составу
    # (с заменами и пошивом), иначе Ozon ответит «черновик не существует».
    # ЧЕРНОВИК СВЕЖИЙ И СОСТАВ НЕ МЕНЯЛСЯ — НЕ ПЕРЕСЧИТЫВАЕМ.
    #
    # Пересчёт — это до десятка запросов к Ozon с паузами по секунде, плюс
    # расписание газельки. 27.10 предложку подтвердили через 12 секунд после
    # формирования, пересчёт съел всё время функции, её оборвало на полпути,
    # и предложка зависла «в создании» без поставки. Черновик Ozon живёт
    # 30 минут: пока он свежий и ни одной вещи не заменили, он годится как есть.
    fresh_draft = False
    if proposal_created is not None and draft_id and warehouse_id and not missing:
        cur.execute("SELECT now() - %s < interval '25 minutes'", (proposal_created,))
        fresh_draft = bool(cur.fetchone()[0])

    if client_id and api_key and ozon_cluster_id and not fresh_draft:
        counts = {}
        for gw_id, item_id in ready:
            counts[int(item_id)] = counts.get(int(item_id), 0) + 1
        for item_id in to_sew:
            counts[int(item_id)] = counts.get(int(item_id), 0) + 1
        sku_qty = {}
        if counts:
            ids_csv = ','.join(str(i) for i in counts)
            cur.execute(
                f"SELECT id, ozon_sku FROM marketplace_items WHERE id IN ({ids_csv})"
            )
            for mid, osku in cur.fetchall():
                if osku and str(osku).isdigit():
                    sku_qty[int(osku)] = sku_qty.get(int(osku), 0) + counts[int(mid)]
        if sku_qty:
            probe, _err = _probe_cluster(
                client_id, api_key,
                [{'sku': k, 'quantity': v} for k, v in sku_qty.items()],
                ozon_cluster_id,
            )
            if probe:
                draft_id = probe['draftId']
                warehouse_id = probe['clusters'][0]['warehouses'][0]['id']
                fresh_date, fresh_slot, fresh_ship = _schedule(
                    client_id, api_key, draft_id, warehouse_id, ozon_cluster_id, cluster)
                if fresh_date:
                    gate_date, gate_slot, gazelka_date = fresh_date, fresh_slot, fresh_ship

    cur.execute(
        "INSERT INTO marketplace_supplies "
        "(marketplace, type, status, created_by, ozon_delivery_method, ozon_status, "
        " shop_id, is_b2b, cluster, supply_date, timeslot, ship_to_gazelka_at) "
        "VALUES ('OZON', 'FBO', 'Открытая', %s, 'direct', 'Заполнение данных', "
        "        %s, false, %s, %s, %s, %s) RETURNING id",
        (int(actor_id) if actor_id else None, int(shop_id), cluster,
         gate_date, gate_slot, gazelka_date),
    )
    supply_id = cur.fetchone()[0]
    # Сразу привязываем поставку к предложке: если запись оборвётся на полпути,
    # по этой связи недописанную поставку найдут и откатят (_recover_stuck).
    cur.execute(
        "UPDATE fbo_supply_proposals SET supply_id = %s WHERE id = %s",
        (int(supply_id), int(proposal_id)),
    )
    seq = _next_order_number(cur)
    plan = [(gw, it) for gw, it in ready] + [(None, it) for it in to_sew]

    # Всё пишем ПАКЕТОМ: один INSERT заказов и один UPDATE склада.
    # Раньше было по 2–3 запроса на каждую вещь — база на пике отвечала
    # «rate limit», и поставка оставалась записанной наполовину.
    item_ids = sorted({int(it) for _, it in plan})
    cards = {}
    if item_ids:
        cur.execute(
            "SELECT id, name, material, width, height, barcode, ozon_sku "
            f"FROM marketplace_items WHERE id IN ({','.join(str(i) for i in item_ids)})"
        )
        cards = {int(r[0]): r[1:] for r in cur.fetchall()}

    def q(value):
        if value is None:
            return 'NULL'
        return "'" + str(value).replace("'", "''") + "'"

    values = []
    gw_order = []
    for gw_id, item_id in plan:
        card = cards.get(int(item_id))
        if not card:
            continue
        name, material, width, height, barcode, ozon_sku = card
        product = f'{material} {width}x{height}' if material and width and height else (name or 'Товар')
        number = f'00000-{seq:02d}'
        seq += 1
        values.append(
            f"({q(number)}, 'OZON', 'FBO', 'Новый', {q(cluster)}, {q(product)}, 1, 'proposal', "
            f"{q(material)}, {int(width) if width else 'NULL'}, {int(height) if height else 'NULL'}, "
            f"{int(item_id)}, {q(barcode)}, {q(ozon_sku)}, {int(supply_id)}, {int(shop_id)}, "
            f"{int(gw_id) if gw_id else 'NULL'}, {q('Со склада' if gw_id else 'Новый')})"
        )
        if gw_id:
            gw_order.append((number, int(gw_id)))
    if values:
        cur.execute(
            "INSERT INTO orders (order_number, marketplace, order_type, status, cluster, "
            "product, quantity, source, material, width, height, marketplace_item_id, "
            "product_barcode, product_ozon_sku, supply_id, shop_id, "
            "fulfilled_from_stock_id, sewing_status) VALUES " + ', '.join(values)
        )
    if gw_order:
        pairs = ', '.join(f"({q(n)}, {g})" for n, g in gw_order)
        # Бронь ставим только если вещь всё ещё свободна — иначе её успел
        # забрать FBS, и одна вещь ушла бы в два заказа.
        cur.execute(
            "UPDATE goods_warehouse gw SET reserved_order_id = o.id, matched_at = now() "
            f"FROM (VALUES {pairs}) AS v(num, gw_id) "
            "JOIN orders o ON o.order_number = v.num AND o.supply_id = " + str(int(supply_id)) + " "
            "WHERE gw.id = v.gw_id AND gw.reserved_order_id IS NULL AND gw.status = 'in_stock'"
        )
        if cur.rowcount != len(gw_order):
            # Кто-то забрал часть вещей прямо сейчас: такие заказы — в пошив.
            cur.execute(
                "UPDATE orders o SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый' "
                "WHERE o.supply_id = %s AND o.fulfilled_from_stock_id IS NOT NULL "
                "  AND NOT EXISTS (SELECT 1 FROM goods_warehouse gw "
                "                  WHERE gw.id = o.fulfilled_from_stock_id AND gw.reserved_order_id = o.id)",
                (int(supply_id),),
            )
    # Итог считаем по базе, а не по плану — чтобы «со склада / в пошив» был честным.
    cur.execute(
        "SELECT COUNT(*) FILTER (WHERE fulfilled_from_stock_id IS NOT NULL), "
        "       COUNT(*) FILTER (WHERE fulfilled_from_stock_id IS NULL) "
        "FROM orders WHERE supply_id = %s",
        (int(supply_id),),
    )
    from_stock_cnt, to_sew_cnt = cur.fetchone()
    cur.execute(
        "UPDATE fbo_supply_proposal_items SET open_hold = false WHERE proposal_id = %s",
        (int(proposal_id),),
    )
    cur.execute(
        "UPDATE fbo_supply_proposals SET status = 'accepted', supply_id = %s, "
        "decided_at = now(), decided_by = %s, gate_date = %s, gate_timeslot = %s, gazelka_date = %s "
        "WHERE id = %s",
        (int(supply_id), int(actor_id) if actor_id else None,
         gate_date, gate_slot, gazelka_date, int(proposal_id)),
    )
    ozon_error = None
    real_store = None
    if draft_id and warehouse_id and client_id and api_key and gate_date:
        # Окно берём у Ozon целиком (начало и конец). Раньше начало и конец
        # были одним и тем же временем — нулевое окно Ozon не принимает.
        win_from, win_to = _slot_window(
            client_id, api_key, draft_id, warehouse_id, ozon_cluster_id, gate_date)
        if win_from and win_to:
            slot_from, slot_to = win_from, win_to
        else:
            begin = gate_slot or '10:00'
            end_h = min(int(begin[:2]) + 1, 23)
            slot_from = f'{gate_date}T{begin}:00Z'
            slot_to = f'{gate_date}T{end_h:02d}:{begin[3:5]}:00Z'
        status, data = _ozon_post('/v2/draft/supply/create', client_id, api_key, {
            'draft_id': int(draft_id),
            'supply_type': 'DIRECT',
            'selected_cluster_warehouses': [{
                'macrolocal_cluster_id': int(ozon_cluster_id or 0),
                'storage_warehouse_id': int(warehouse_id),
            }],
            'timeslot': {'from_in_timezone': slot_from, 'to_in_timezone': slot_to},
        })
        order_id = None
        reasons = []
        if status == 200 and isinstance(data, dict):
            reasons = [r for r in (data.get('error_reasons') or []) if r != 'UNSPECIFIED']
            # Заявка создаётся в фоне: ждём номер несколько секунд. Не дождались —
            # номер подтянет синхронизация поставок Ozon.
            for _ in range(4):
                st, res = _ozon_post('/v2/draft/supply/create/status', client_id, api_key, {
                    'draft_id': int(draft_id),
                })
                if st != 200 or not isinstance(res, dict):
                    break
                order_id = res.get('order_id') or None
                state = str(res.get('status') or '')
                if state == 'FAILED':
                    reasons = [r for r in (res.get('error_reasons') or []) if r != 'UNSPECIFIED']
                    break
                if order_id or state == 'SUCCESS':
                    break
                time.sleep(1)
        if order_id:
            cur.execute(
                "UPDATE marketplace_supplies SET ozon_supply_order_id = %s, "
                "supply_number = COALESCE(supply_number, %s), "
                "ozon_application_number = COALESCE(ozon_application_number, %s) "
                "WHERE id = %s",
                (int(order_id), str(order_id), str(order_id), int(supply_id)),
            )
            # Ozon сам выбирает склад внутри региона: читаем, куда он забронировал,
            # и записываем ЭТОТ склад, а не тот, что был в предложке.
            real = _ozon_real_storage(client_id, api_key, order_id)
            if real and real != cluster:
                from shared import apply_ozon_storage
                apply_ozon_storage(cur, supply_id, cluster, real)
                real_store = real
        else:
            message = data.get('message') if isinstance(data, dict) else str(data)
            if reasons:
                message = ', '.join(reasons)
            ozon_error = (
                f'Ozon не создал заявку: {message}' if message
                else 'Ozon не создал заявку. Этикетки коробов появятся после привязки номера'
            )
    return {'supplyId': supply_id, 'ozonError': ozon_error,
            'fromStock': int(from_stock_cnt), 'toSewing': int(to_sew_cnt),
            'ozonStorage': real_store, 'proposedStorage': cluster}


def _ozon_real_storage(client_id, api_key, order_id):
    """Склад, который Ozon назначил заявке."""
    from shared import ozon_storage_name
    for _ in range(2):
        st, data = _ozon_post('/v3/supply-order/get', client_id, api_key,
                              {'order_ids': [int(order_id)]}, timeout=8)
        if st == 200 and isinstance(data, dict):
            for o in data.get('orders') or []:
                name = ozon_storage_name(o)
                if name:
                    return name
        time.sleep(1)
    return None


def _accepted_supply(proposal_id):
    import psycopg2
    try:
        conn = psycopg2.connect(os.environ['DATABASE_URL'])
        try:
            cur = conn.cursor()
            cur.execute("SELECT supply_id FROM fbo_supply_proposals WHERE id = %s", (int(proposal_id),))
            row = cur.fetchone()
            return row[0] if row else None
        finally:
            conn.close()
    except Exception:
        return None


def _expire_stale(cur, shop_id):
    """Предложка, которую не подтвердили до дня Газельки, теряет смысл.

    Раньше она так и висела открытой и держала вещи: подбор их не брал, а сама
    поставка не создавалась. Теперь после дня Газельки предложка закрывается
    сама, вещи возвращаются в подбор.
    """
    cur.execute(
        "UPDATE fbo_supply_proposal_items SET open_hold = false "
        "WHERE open_hold AND proposal_id IN (SELECT id FROM fbo_supply_proposals "
        "  WHERE shop_id = %s AND status = 'open' AND gazelka_date IS NOT NULL "
        "    AND gazelka_date < (now() AT TIME ZONE 'Europe/Moscow')::date)",
        (int(shop_id),),
    )
    cur.execute(
        "UPDATE fbo_supply_proposals SET status = 'rejected', decided_at = now() "
        "WHERE shop_id = %s AND status = 'open' AND gazelka_date IS NOT NULL "
        "  AND gazelka_date < (now() AT TIME ZONE 'Europe/Moscow')::date",
        (int(shop_id),),
    )


def handle_proposal_action(cur, conn, body, headers):
    action = body.get('action')
    shop_id = body.get('shopId')
    if not shop_id:
        return _resp(400, {'error': 'Укажите магазин'}, headers)
    # Список видят все, кто работает с поставками: иначе кладовщик не понимает,
    # почему вещи на полке не идут в подбор. Решение — только за администратором.
    if action != 'fbo_proposal_list' and (body.get('actorRole') or '') != 'admin':
        return _resp(403, {'error': 'Предложку подтверждает и отклоняет администратор'}, headers)
    actor_id = body.get('actorId')
    _recover_stuck(cur, shop_id)
    _expire_stale(cur, shop_id)
    conn.commit()
    if action == 'fbo_proposal_list':
        return _resp(200, {'proposals': list_open(cur, shop_id)}, headers)
    if action == 'fbo_proposal_build':
        result = build(cur, shop_id)
        if result.get('error'):
            conn.rollback()
            return _resp(409, result, headers)
        conn.commit()
        result['proposals'] = list_open(cur, shop_id)
        return _resp(200, result, headers)
    proposal_id = body.get('proposalId')
    if not proposal_id:
        return _resp(400, {'error': 'Укажите предложку'}, headers)
    if action == 'fbo_proposal_reject':
        result = reject(cur, proposal_id, actor_id, shop_id)
        if result.get('error'):
            conn.rollback()
            return _resp(404, result, headers)
        conn.commit()
        return _resp(200, result, headers)
    if action == 'fbo_proposal_accept':
        try:
            result = accept(cur, proposal_id, actor_id, body.get('actorName'), shop_id)
        except Exception as err:
            try:
                conn.rollback()
            except Exception:
                pass
            state = recover_after_failure(os.environ['DATABASE_URL'], proposal_id)
            print(f'fbo_proposal_accept {proposal_id} упал: {err!r}, итог: {state}')
            if state == 'accepted':
                return _resp(200, {'supplyId': _accepted_supply(proposal_id),
                                   'ozonError': 'База ответила с задержкой, но поставка создана целиком'},
                             headers)
            if state == 'rolled_back':
                return _resp(503, {'error': 'Поставку создать не удалось. Ничего не записано: '
                                            'предложка снова открыта, вещи свободны. Подтвердите ещё раз',
                                   'rolledBack': True}, headers)
            return _resp(503, {'error': 'База не ответила. Обновите список через минуту и проверьте, '
                                        'создалась ли поставка — повторно не нажимайте'}, headers)
        if result.get('error'):
            conn.rollback()
            return _resp(409, result, headers)
        conn.commit()
        return _resp(200, result, headers)
    return _resp(400, {'error': 'Неизвестное действие предложки'}, headers)