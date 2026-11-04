"""Создание поставки FBO в пошив по рассчитанной предложке.

ПОРЯДОК ДЛЯ КАЖДОЙ ШТУКИ (как в предложке со склада и при догрузке пошива):
  1) готовая вещь на полке — бронируем её (FIFO, не забронированную, не в чужой
     поставке и не в открытой предложке со склада);
  2) перехват — крой ОТМЕНЁННОГО заказа того же товара и размера, который висит
     в цехе: новый заказ встаёт на его этап, ткань второй раз не режем;
  3) остальное — новый заказ в пошив («Новый»).

ЗАЩИТА ОТ ДВОЙНОГО НАЖАТИЯ. Экран присылает requestKey; он уникален в
sew_supply_plans. Повторный запрос с тем же ключом вернёт уже созданную
поставку, а не вторую такую же. Параллельные создания одного магазина идут
по очереди — держим строку магазина.
"""
import json


def _q(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _next_seq(cur):
    cur.execute(
        "SELECT order_number FROM orders WHERE order_number ~ '^00000-[0-9]+$' "
        "ORDER BY (split_part(order_number, '-', 2))::int DESC LIMIT 1"
    )
    last = cur.fetchone()
    return (int(last[0].split('-')[1]) + 1) if last else 1


CANCELLED = (
    "o.status = 'Отменён' OR o.sewing_status = 'Отменён' OR o.cancelled_at IS NOT NULL "
    "OR strpos(lower(COALESCE(o.ozon_status, '')), 'cancel') = 1 "
    "OR strpos(upper(COALESCE(o.ym_status, '')), 'CANCEL') > 0"
)


def _take_cancelled_cut(cur, order_id, product, material, width, height):
    """Отдаёт новому заказу крой отменённого заказа того же размера (см. orders/shared.py)."""
    cur.execute(
        "SELECT o.id, o.cut_at, o.cutter_user_id, o.hanger_number, o.workshop_id, "
        "       o.requires_overlock, o.overlocked_at, o.overlock_user_id, o.sewing_status, "
        "       o.assigned_user_id, o.sewer_user_id, o.sewn_at "
        "FROM orders o "
        "WHERE o.sewing_status IN ('Раскроено', 'В работе', 'Стикеровка') "
        "  AND o.cut_given_to_order_id IS NULL "
        f"  AND ({CANCELLED}) "
        "  AND o.product = %s AND o.material = %s AND o.width = %s AND o.height = %s "
        "  AND o.id <> %s "
        "ORDER BY o.cut_at ASC NULLS LAST, o.id ASC LIMIT 1 "
        "FOR UPDATE OF o SKIP LOCKED",
        (product, material, int(width), int(height), int(order_id)),
    )
    cut = cur.fetchone()
    if not cut:
        return False
    (cut_id, cut_at, cutter, hanger, ws, req_ov, ov_at, ov_user, st,
     assigned, sewer, sewn_at) = cut
    cur.execute(
        "UPDATE orders SET sewing_status = %s, cut_at = COALESCE(%s, now()), cutter_user_id = %s, "
        "  hanger_number = %s, workshop_id = COALESCE(%s, workshop_id), requires_overlock = %s, "
        "  overlocked_at = %s, overlock_user_id = %s, cut_from_order_id = %s, "
        "  assigned_user_id = CASE WHEN %s IN ('В работе', 'Стикеровка') THEN %s ELSE assigned_user_id END, "
        "  sewer_user_id = COALESCE(%s, sewer_user_id), sewn_at = COALESCE(%s, sewn_at) "
        "WHERE id = %s",
        (st, cut_at, cutter, hanger or 0, ws, bool(req_ov), ov_at, ov_user, int(cut_id),
         st, assigned, sewer, sewn_at, int(order_id)),
    )
    cur.execute(
        "UPDATE orders SET cut_given_to_order_id = %s, sewing_status = 'Готовые' WHERE id = %s",
        (int(order_id), int(cut_id)),
    )
    return True


def rollback_plan(cur, plan_id):
    """Отменяет недописанную поставку: снимает брони, заказы — в отмену, поставку — «Отменена».

    База платформы фиксирует каждый запрос сразу, поэтому при обрыве функции
    поставка могла остаться записанной наполовину. Трогаем только то, что ещё
    никто не начал делать: заказы «Новый» / «Со склада» без раскроя.
    """
    cur.execute("SELECT supply_id FROM sew_supply_plans WHERE id = %s", (int(plan_id),))
    row = cur.fetchone()
    sid = row[0] if row else None
    if sid:
        cur.execute(
            "UPDATE goods_warehouse SET reserved_order_id = NULL, matched_at = NULL "
            "WHERE reserved_order_id IN (SELECT id FROM orders WHERE supply_id = %s AND source = 'proposal') "
            "  AND status = 'in_stock'",
            (int(sid),),
        )
        cur.execute(
            "UPDATE orders SET status = 'Отменён', cancelled_at = now(), fulfilled_from_stock_id = NULL "
            "WHERE supply_id = %s AND source = 'proposal' AND sewing_status IN ('Новый', 'Со склада') "
            "  AND cut_at IS NULL AND taken_at IS NULL",
            (int(sid),),
        )
        cur.execute(
            "UPDATE marketplace_supplies SET status = 'Отменена', "
            "  comment = 'Создание поставки в пошив оборвалось — отменена автоматически' WHERE id = %s",
            (int(sid),),
        )
    cur.execute("UPDATE sew_supply_plans SET status = 'failed' WHERE id = %s", (int(plan_id),))


def recover_stuck(cur, conn, shop_id):
    """Создание висит дольше 2 минут — функцию оборвало. Откатываем."""
    cur.execute(
        "SELECT id FROM sew_supply_plans WHERE shop_id = %s AND status = 'creating' "
        "  AND created_at < now() - interval '2 minutes'",
        (int(shop_id),),
    )
    for (pid,) in cur.fetchall():
        rollback_plan(cur, pid)
    conn.commit()


def create(cur, conn, shop_id, plan, request_key, actor_id, actor_name):
    cur.execute(
        "SELECT supply_id, status FROM sew_supply_plans WHERE request_key = %s",
        (request_key,),
    )
    row = cur.fetchone()
    if row:
        if row[0]:
            return {'supplyId': int(row[0]), 'repeat': True}
        return {'error': 'Эта поставка уже создаётся — обновите страницу через минуту'}

    cur.execute('SELECT id FROM shops WHERE id = %s FOR UPDATE', (int(shop_id),))
    # Другой администратор прямо сейчас создаёт поставку этого магазина: её
    # заказы ещё не записаны, и наш расчёт их не видит — сошьём дважды.
    cur.execute(
        "SELECT 1 FROM sew_supply_plans WHERE shop_id = %s AND status = 'creating' "
        "  AND created_at > now() - interval '2 minutes'",
        (int(shop_id),),
    )
    if cur.fetchone():
        conn.rollback()
        return {'error': 'Другая поставка в пошив сейчас создаётся. Подождите минуту и пересчитайте'}
    cur.execute(
        "INSERT INTO sew_supply_plans (shop_id, request_key, cluster_name, pieces, "
        "  localization_now, localization_after, items, created_by, created_by_name) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (request_key) DO NOTHING RETURNING id",
        (int(shop_id), request_key, plan['cluster'], plan['pieces'],
         plan['localization'].get('now'), plan['localization'].get('after'),
         json.dumps([{'sku': r['sku'], 'qty': r['quantity']} for r in plan['lines']]),
         int(actor_id) if actor_id else None, (actor_name or '')[:200] or None),
    )
    got = cur.fetchone()
    if not got:
        return {'error': 'Эта поставка уже создаётся — обновите страницу через минуту'}
    plan_id = got[0]
    conn.commit()
    try:
        return _fill(cur, conn, shop_id, plan, plan_id, actor_id, actor_name)
    except Exception:
        try:
            conn.rollback()
            rollback_plan(cur, plan_id)
            conn.commit()
        except Exception:
            pass
        raise


def _fill(cur, conn, shop_id, plan, plan_id, actor_id, actor_name):

    cur.execute(
        "INSERT INTO marketplace_supplies (marketplace, type, status, created_by, ozon_delivery_method, "
        "  shop_id, is_b2b, cluster, total_quantity_marketplace, comment) "
        "VALUES ('OZON', 'FBO', 'Открытая', %s, 'direct', %s, false, %s, %s, %s) RETURNING id",
        (int(actor_id) if actor_id else None, int(shop_id), plan['cluster'], plan['pieces'],
         f"Автопредложка в пошив: {plan['pieces']} шт., локализация "
         f"{plan['localization'].get('now')}% → {plan['localization'].get('after')}%"),
    )
    supply_id = cur.fetchone()[0]
    cur.execute("UPDATE sew_supply_plans SET supply_id = %s WHERE id = %s", (supply_id, plan_id))

    ids = ','.join(str(int(r['itemId'])) for r in plan['lines']) or '0'
    cur.execute(
        "SELECT id, name, material, width, height, barcode, ozon_sku "
        f"FROM marketplace_items WHERE id IN ({ids})"
    )
    cards = {int(r[0]): r[1:] for r in cur.fetchall()}

    # 1) Готовое на полках — бронируем, чтобы не шить заново.
    stock = {}
    for r in plan['lines']:
        cur.execute(
            "SELECT gw.id FROM goods_warehouse gw JOIN orders src ON src.id = gw.order_id "
            "WHERE gw.status = 'in_stock' AND gw.shelf_id IS NOT NULL AND gw.reserved_order_id IS NULL "
            "  AND src.marketplace_item_id = %s AND src.shop_id = %s "
            "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
            "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
            "                  WHERE msi.goods_warehouse_id = gw.id "
            "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
            "  AND NOT EXISTS (SELECT 1 FROM fbo_supply_proposal_items pi "
            "                  WHERE pi.goods_warehouse_id = gw.id AND pi.open_hold) "
            "ORDER BY gw.received_at ASC LIMIT %s FOR UPDATE OF gw SKIP LOCKED",
            (int(r['itemId']), int(shop_id), int(r['quantity'])),
        )
        stock[r['itemId']] = [int(x[0]) for x in cur.fetchall()]

    seq = _next_seq(cur)
    values, gw_pairs, sew_numbers = [], [], []
    for r in plan['lines']:
        card = cards.get(int(r['itemId']))
        if not card:
            continue
        name, material, width, height, barcode, ozon_sku = card
        product = f'{material} {width}x{height}' if material and width and height else (name or 'Товар')
        picks = stock.get(r['itemId'], [])
        for i in range(int(r['quantity'])):
            number = f'00000-{seq:02d}'
            seq += 1
            gw_id = picks[i] if i < len(picks) else None
            values.append(
                f"({_q(number)}, 'OZON', 'FBO', 'Новый', {_q(plan['cluster'])}, {_q(product)}, 1, "
                f"'proposal', {_q(material)}, {int(width) if width else 'NULL'}, "
                f"{int(height) if height else 'NULL'}, {int(r['itemId'])}, {_q(barcode)}, {_q(ozon_sku)}, "
                f"{int(supply_id)}, {int(shop_id)}, {gw_id if gw_id else 'NULL'}, "
                f"{_q('Со склада' if gw_id else 'Новый')})"
            )
            if gw_id:
                gw_pairs.append((number, gw_id))
            elif material and width and height:
                sew_numbers.append((number, product, material, width, height))
    if not values:
        conn.rollback()
        return {'error': 'В предложке не осталось товаров'}
    for i in range(0, len(values), 300):
        cur.execute(
            "INSERT INTO orders (order_number, marketplace, order_type, status, cluster, product, "
            "quantity, source, material, width, height, marketplace_item_id, product_barcode, "
            "product_ozon_sku, supply_id, shop_id, fulfilled_from_stock_id, sewing_status) VALUES "
            + ', '.join(values[i:i + 300])
        )
    if gw_pairs:
        pairs = ', '.join(f"({_q(n)}, {g})" for n, g in gw_pairs)
        cur.execute(
            "UPDATE goods_warehouse gw SET reserved_order_id = o.id, matched_at = now() "
            f"FROM (VALUES {pairs}) AS v(num, gw_id) "
            f"JOIN orders o ON o.order_number = v.num AND o.supply_id = {int(supply_id)} "
            "WHERE gw.id = v.gw_id AND gw.reserved_order_id IS NULL AND gw.status = 'in_stock'"
        )
        if cur.rowcount != len(gw_pairs):
            cur.execute(
                "UPDATE orders o SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый' "
                "WHERE o.supply_id = %s AND o.fulfilled_from_stock_id IS NOT NULL "
                "  AND NOT EXISTS (SELECT 1 FROM goods_warehouse gw "
                "                  WHERE gw.id = o.fulfilled_from_stock_id AND gw.reserved_order_id = o.id)",
                (int(supply_id),),
            )

    # 2) Перехват кроя отменённых заказов того же размера.
    intercepted = 0
    if sew_numbers:
        nums = ', '.join(_q(n) for n, *_ in sew_numbers)
        cur.execute(f"SELECT order_number, id FROM orders WHERE order_number IN ({nums})")
        id_of = {r[0]: r[1] for r in cur.fetchall()}
        cur.execute(
            "SELECT DISTINCT o.product FROM orders o "
            "WHERE o.sewing_status IN ('Раскроено', 'В работе', 'Стикеровка') "
            f"  AND o.cut_given_to_order_id IS NULL AND ({CANCELLED})"
        )
        cut_products = {r[0] for r in cur.fetchall()}
        for number, product, material, width, height in sew_numbers:
            if product in cut_products and id_of.get(number):
                if _take_cancelled_cut(cur, id_of[number], product, material, width, height):
                    intercepted += 1

    cur.execute(
        "SELECT COUNT(*) FILTER (WHERE fulfilled_from_stock_id IS NOT NULL), "
        "       COUNT(*) FILTER (WHERE fulfilled_from_stock_id IS NULL AND sewing_status = 'Новый'), "
        "       COUNT(*) "
        "FROM orders WHERE supply_id = %s",
        (int(supply_id),),
    )
    from_stock, to_sew, total = cur.fetchone()
    cur.execute(
        "UPDATE sew_supply_plans SET status = 'created', from_stock = %s, to_sew = %s, pieces = %s "
        "WHERE id = %s",
        (int(from_stock), int(to_sew), int(total), plan_id),
    )
    cur.execute(
        "UPDATE marketplace_supplies SET total_quantity_marketplace = %s WHERE id = %s",
        (int(total), int(supply_id)),
    )
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, 'supply', 'fbo_sew_plan_create', 'marketplace_supply', %s, %s)",
        (int(actor_id) if actor_id else None, actor_name or None, int(supply_id),
         f"Поставка FBO в пошив №{supply_id}: {plan['cluster']}, {total} шт. "
         f"(со склада {from_stock}, перехват кроя {intercepted}, в пошив {to_sew})"),
    )
    conn.commit()
    return {'supplyId': int(supply_id), 'pieces': int(total), 'fromStock': int(from_stock),
            'intercepted': intercepted, 'toSew': int(to_sew)}
