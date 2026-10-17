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
DEMAND_DAYS = 14


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
            status = warehouse.get('status') or warehouse.get('availability') or {}
            if isinstance(status, dict):
                state = str(status.get('state') or status.get('invalid_reason') or '')
                if status.get('is_available') is False:
                    continue
                if 'NOT_AVAILABLE' in state or 'NOT_ACCEPT' in state:
                    continue
            warehouse_id = (
                warehouse.get('warehouse_id')
                or (warehouse.get('supply_warehouse') or {}).get('warehouse_id')
                or (warehouse.get('warehouse') or {}).get('warehouse_id')
            )
            warehouse_name = (
                warehouse.get('name')
                or (warehouse.get('supply_warehouse') or {}).get('name')
                or (warehouse.get('warehouse') or {}).get('name')
                or name
            )
            if warehouse_id:
                available.append({'id': int(warehouse_id), 'name': warehouse_name})
        if available:
            found.append({'name': str(name), 'warehouses': available})
    return found


def _probe_cluster(client_id, api_key, items):
    """Считает черновик прямой поставки и возвращает живые кластеры со слотом.

    items: [{sku: int, quantity: int}]
    """
    status, data = _ozon_post('/v1/draft/create', client_id, api_key, {
        'items': items,
        'type': 'CREATE_TYPE_DIRECT',
    })
    if status != 200:
        message = data.get('message') if isinstance(data, dict) else str(data)
        return None, f'Ozon не принял расчёт прямой поставки: {message}'
    draft_id = None
    if isinstance(data, dict):
        draft_id = data.get('draft_id') or (data.get('result') or {}).get('draft_id')
    if not draft_id:
        return None, 'Ozon не вернул номер расчёта поставки'
    info = None
    for _ in range(8):
        status, info = _ozon_post('/v1/draft/create/info', client_id, api_key, {
            'draft_id': int(draft_id),
        })
        if status != 200:
            break
        calc = ''
        if isinstance(info, dict):
            calc = str(info.get('status') or (info.get('result') or {}).get('status') or '')
        if 'IN_PROGRESS' not in calc:
            break
        time.sleep(1)
    clusters = _draft_clusters(info or {})
    if not clusters:
        _ozon_post('/v1/draft/delete', client_id, api_key, {'draft_id': int(draft_id)})
        return None, 'Ozon не показал ни одного кластера, который сейчас принимает прямую поставку'
    return {'draftId': int(draft_id), 'clusters': clusters}, None


def _nearest_slot(client_id, api_key, draft_id, warehouse_id):
    start = datetime.utcnow()
    status, data = _ozon_post('/v1/draft/timeslot/info', client_id, api_key, {
        'draft_id': int(draft_id),
        'warehouse_ids': [int(warehouse_id)],
        'date_from': start.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'date_to': (start + timedelta(days=21)).strftime('%Y-%m-%dT%H:%M:%SZ'),
    })
    if status != 200 or not isinstance(data, dict):
        return None, None
    nodes = []
    _walk(data, nodes)
    best = None
    for node in nodes:
        begin = node.get('from_in_timezone') or node.get('from') or node.get('begin')
        if not begin or not isinstance(begin, str) or len(begin) < 10:
            continue
        if best is None or begin < best:
            best = begin
    if not best:
        return None, None
    slot = best[11:16] if len(best) >= 16 and best[10] in ('T', ' ') else None
    return best[:10], slot


def _gazelka_date(cluster, gate_day):
    """Ближайший рейс в этот город не позже ворот. Без ключа — день слота."""
    if not gate_day:
        return None
    token = (os.environ.get('GAZELKA_API_KEY') or '').strip()
    if not token:
        return gate_day
    req = urllib.request.Request(
        'https://gazelka.space/api/my-plans',
        method='POST',
        data=b'{}',
    )
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode('utf-8') or '[]')
    except Exception:
        return gate_day
    plans = payload if isinstance(payload, list) else (payload.get('plans') or payload.get('data') or [])
    today = date.today().isoformat()
    chosen = None
    for plan in plans:
        if not isinstance(plan, dict):
            continue
        address = plan.get('delivery_address') or ''
        if not _same_place(cluster, address):
            continue
        route = plan.get('route') if isinstance(plan.get('route'), dict) else {}
        ship = (route.get('date') or plan.get('delivery_date') or '')[:10]
        if not ship or ship < today or ship > gate_day:
            continue
        if chosen is None or ship < chosen:
            chosen = ship
    return chosen or gate_day


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
    cur.execute(
        "SELECT o.cluster, o.marketplace_item_id, COUNT(*) "
        "FROM orders o "
        "WHERE o.order_type = 'FBO' AND o.marketplace = 'OZON' "
        "  AND o.shop_id = %s AND o.cluster IS NOT NULL AND o.cluster <> '' "
        "  AND o.created_at > now() - interval '14 days' "
        "GROUP BY o.cluster, o.marketplace_item_id",
        (int(shop_id),),
    )
    demand = {}
    for cluster, item_id, qty in cur.fetchall():
        demand.setdefault(cluster, {})[int(item_id)] = int(qty)
    return demand


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
    cur.execute('SELECT pg_advisory_xact_lock(740361, %s)', (int(shop_id),))
    goods = _free_goods(cur, shop_id)
    demand = _demand(cur, shop_id)
    if not demand:
        return {'created': [], 'skipped': ['Нет отгрузок FBO за 14 дней — нечего сравнивать с кластерами']}
    client_id, api_key = _creds(cur, shop_id)
    if not client_id or not api_key:
        return {'error': 'У магазина нет ключей Ozon'}
    stock, stock_error = _ozon_stock(client_id, api_key, list(demand))
    if stock_error:
        return {'error': stock_error}
    popular = _popular_sizes(cur)
    by_item = {}
    for gw_id, item_id, ozon_sku, width, height in goods:
        by_item.setdefault(int(item_id), []).append({
            'id': int(gw_id),
            'itemId': int(item_id),
            'sku': int(ozon_sku) if str(ozon_sku).isdigit() else None,
            'popular': (width, height) in popular,
        })

    planned = []
    for cluster, need in demand.items():
        chosen = []
        draft_items = {}
        for item_id, needed in need.items():
            pieces = by_item.get(item_id) or []
            on_ozon = 0
            sku = next((p['sku'] for p in pieces if p['sku']), None)
            if sku:
                on_ozon = stock.get(cluster, {}).get(str(sku), 0)
            if on_ozon >= needed:
                continue
            take = min(len(pieces), needed - on_ozon)
            if take <= 0 or not sku:
                continue
            chosen.extend(pieces[:take])
            del pieces[:take]
            draft_items[sku] = draft_items.get(sku, 0) + take
        if len(chosen) < MIN_PIECES:
            continue
        planned.append({
            'cluster': cluster,
            'items': [{'sku': sku, 'quantity': qty} for sku, qty in draft_items.items()],
            'goods': chosen,
        })

    created = []
    skipped = []
    for plan in planned:
        cur.execute(
            "SELECT id FROM fbo_supply_proposals "
            "WHERE shop_id = %s AND cluster = %s AND status = 'open'",
            (int(shop_id), plan['cluster']),
        )
        if cur.fetchone():
            skipped.append(f'{plan["cluster"]}: предложка уже открыта')
            continue
        probe, error = _probe_cluster(client_id, api_key, plan['items'])
        if error:
            skipped.append(f'{plan["cluster"]}: {error}')
            continue
        match = next((c for c in probe['clusters'] if _same_place(plan['cluster'], c['name'])), None)
        if not match:
            _ozon_post('/v1/draft/delete', client_id, api_key, {'draft_id': probe['draftId']})
            skipped.append(f'{plan["cluster"]}: кластер сейчас не принимает прямую поставку')
            continue
        warehouse_id = match['warehouses'][0]['id']
        gate_date, gate_slot = _nearest_slot(client_id, api_key, probe['draftId'], warehouse_id)
        gazelka = _gazelka_date(plan['cluster'], gate_date)
        cur.execute(
            "INSERT INTO fbo_supply_proposals "
            "(shop_id, cluster, ozon_draft_id, ozon_warehouse_id, gate_date, gate_timeslot, gazelka_date) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (int(shop_id), plan['cluster'], probe['draftId'], warehouse_id,
             gate_date, gate_slot, gazelka),
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
    client_id, api_key = _creds(cur, shop_id)
    if row[0] and client_id and api_key:
        _ozon_post('/v1/draft/delete', client_id, api_key, {'draft_id': int(row[0])})
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
        "SELECT cluster, ozon_draft_id, ozon_warehouse_id, gate_date, gate_timeslot, gazelka_date "
        "FROM fbo_supply_proposals WHERE id = %s AND shop_id = %s AND status = 'open' "
        "FOR UPDATE",
        (int(proposal_id), int(shop_id)),
    )
    proposal = cur.fetchone()
    if not proposal:
        return {'error': 'Открытая предложка не найдена'}
    cluster, draft_id, warehouse_id, gate_date, gate_slot, gazelka_date = proposal
    cur.execute(
        "SELECT i.goods_warehouse_id, i.marketplace_item_id, gw.status "
        "FROM fbo_supply_proposal_items i "
        "JOIN goods_warehouse gw ON gw.id = i.goods_warehouse_id "
        "WHERE i.proposal_id = %s AND i.open_hold "
        "FOR UPDATE OF gw",
        (int(proposal_id),),
    )
    rows = cur.fetchall()
    ready = [row for row in rows if row[2] == 'in_stock']
    if len(ready) < MIN_PIECES:
        return {'error': f'В предложке осталось {len(ready)} шт. Нужно не меньше {MIN_PIECES}. Сформируйте заново'}

    client_id, api_key = _creds(cur, shop_id)
    if draft_id and client_id and api_key and gate_date and str(gate_date) < date.today().isoformat():
        fresh_date, fresh_slot = _nearest_slot(client_id, api_key, draft_id, warehouse_id)
        if fresh_date:
            gate_date, gate_slot = fresh_date, fresh_slot
            gazelka_date = _gazelka_date(cluster, gate_date)

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
    seq = _next_order_number(cur)
    for gw_id, item_id, _status in ready:
        cur.execute(
            "SELECT name, material, width, height, barcode, ozon_sku "
            "FROM marketplace_items WHERE id = %s",
            (int(item_id),),
        )
        item = cur.fetchone()
        if not item:
            continue
        name, material, width, height, barcode, ozon_sku = item
        product = f'{material} {width}x{height}' if material and width and height else name
        cur.execute(
            "INSERT INTO orders (order_number, marketplace, order_type, status, cluster, "
            "product, quantity, source, material, width, height, marketplace_item_id, "
            "product_barcode, product_ozon_sku, supply_id, shop_id, "
            "fulfilled_from_stock_id, sewing_status) "
            "VALUES (%s, 'OZON', 'FBO', 'Новый', %s, %s, 1, 'proposal', %s, %s, %s, %s, %s, %s, "
            "%s, %s, %s, 'Со склада') RETURNING id",
            (
                f'00000-{seq:02d}', cluster, product, material,
                int(width) if width else None, int(height) if height else None,
                int(item_id), barcode, ozon_sku, int(supply_id), int(shop_id), int(gw_id),
            ),
        )
        order_id = cur.fetchone()[0]
        seq += 1
        cur.execute(
            "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() WHERE id = %s",
            (order_id, int(gw_id)),
        )
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
    if draft_id and warehouse_id and client_id and api_key and gate_date:
        slot_from = f'{gate_date}T{(gate_slot or "10:00")}:00Z'
        slot_to = f'{gate_date}T{(gate_slot or "12:00")}:00Z'
        status, data = _ozon_post('/v1/draft/supply/create', client_id, api_key, {
            'draft_id': int(draft_id),
            'warehouse_id': int(warehouse_id),
            'timeslot': {'from_in_timezone': slot_from, 'to_in_timezone': slot_to},
        })
        order_id = None
        if isinstance(data, dict):
            order_id = data.get('order_id') or (data.get('result') or {}).get('order_id')
        if status == 200 and order_id:
            cur.execute(
                "UPDATE marketplace_supplies SET ozon_supply_order_id = %s, "
                "supply_number = COALESCE(supply_number, %s), "
                "ozon_application_number = COALESCE(ozon_application_number, %s) "
                "WHERE id = %s",
                (int(order_id), str(order_id), str(order_id), int(supply_id)),
            )
        else:
            message = data.get('message') if isinstance(data, dict) else str(data)
            ozon_error = message or 'Ozon не создал заявку. Этикетки коробов появятся после привязки номера'
    return {'supplyId': supply_id, 'ozonError': ozon_error}


def handle_proposal_action(cur, conn, body, headers):
    if (body.get('actorRole') or '') != 'admin':
        return _resp(403, {'error': 'Предложку подтверждает и отклоняет администратор'}, headers)
    action = body.get('action')
    shop_id = body.get('shopId')
    if not shop_id:
        return _resp(400, {'error': 'Укажите магазин'}, headers)
    actor_id = body.get('actorId')
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
        result = accept(cur, proposal_id, actor_id, body.get('actorName'), shop_id)
        if result.get('error'):
            conn.rollback()
            return _resp(409, result, headers)
        conn.commit()
        return _resp(200, result, headers)
    return _resp(400, {'error': 'Неизвестное действие предложки'}, headers)
