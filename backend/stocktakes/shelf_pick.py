"""Подбор полки при инвентаризации.

То же правило, что pick_demand_shelf на складе: ходовой размер — на полку
с названием «Ходовая полка», остальное — на «Не ходовую». Цифры в конце
названия не отличают группу. На полке до 100 вещей, дальше берётся следующая
с тем же названием. Здесь дополнительно считаются вещи, которые этот пересчёт
уже назначил, но ещё не переложил.
"""

import re

POPULAR_SIZE_SHARE = 0.01
SHELF_PIECE_LIMIT = 100


def _shelf_stem(name):
    low = (name or '').lower().replace('ё', 'е')
    return re.sub(r'[\s\-–—._]*\d+\s*$', '', low).strip()


def _shelf_number(name):
    match = re.search(r'(\d+)\s*$', name or '')
    return int(match.group(1)) if match else 0


def _shelf_kind(name):
    stem = _shelf_stem(name)
    if 'не ходов' in stem or 'неходов' in stem:
        return 'rare'
    if 'ходов' in stem:
        return 'popular'
    return None


def pick_inventory_shelf(cur, gw_id, stocktake_id):
    """Возвращает (shelf_id, shelf_name, is_popular) или (None, текст ошибки, is_popular)."""
    cur.execute(
        "SELECT o.material, o.width, o.height FROM goods_warehouse gw "
        "LEFT JOIN orders o ON o.id = gw.order_id WHERE gw.id = %s",
        (int(gw_id),),
    )
    material, width, height = cur.fetchone() or (None, None, None)

    is_popular = False
    if width and height:
        cur.execute(
            "SELECT COUNT(*) FILTER (WHERE width = %s AND height = %s), COUNT(*) FROM orders "
            "WHERE created_at > now() - interval '60 days'",
            (width, height),
        )
        same, total = cur.fetchone()
        is_popular = bool(total) and (int(same) / int(total)) >= POPULAR_SIZE_SHARE

    cur.execute(
        # Сколько вещей окажется на полке ПОСЛЕ пересчёта: то, что лежит и ещё
        # не отсканировано, плюс всё, что этот пересчёт на неё назначил.
        # Раньше вещи, которые инвентаризация уже переназначила на другую полку,
        # продолжали числиться на старой: «Ходовая полка № 1» считалась полной
        # (104), хотя 44 вещи с неё уже уехали, — и кладовщик упирался в
        # «полки заполнены», не имея куда положить ходовой товар (27.10).
        "SELECT s.id, s.name, "
        "  (SELECT COUNT(*) FROM goods_warehouse g "
        "     WHERE g.shelf_id = s.id AND g.status = 'in_stock' "
        "       AND NOT EXISTS (SELECT 1 FROM stocktake_scans x "
        "                       WHERE x.stocktake_id = %s AND x.goods_warehouse_id = g.id)) "
        "  + (SELECT COUNT(*) FROM stocktake_scans sc "
        "     JOIN goods_warehouse g ON g.id = sc.goods_warehouse_id "
        "     WHERE sc.stocktake_id = %s AND sc.shelf_id = s.id "
        "       AND g.status = 'in_stock') "
        "FROM shelves s ORDER BY s.name",
        (int(stocktake_id), int(stocktake_id)),
    )
    wanted = 'popular' if is_popular else 'rare'
    group = []
    for sid, name, cnt in cur.fetchall():
        if _shelf_kind(name) == wanted:
            group.append({'id': sid, 'name': name, 'count': int(cnt or 0)})

    kind = 'Ходовая полка' if is_popular else 'Не ходовая полка'
    if not group:
        return None, (
            f'Не заведена «{kind}». Добавьте полку с таким названием — '
            f'цифры в конце могут быть любыми'
        ), is_popular

    free = [s for s in group if s['count'] < SHELF_PIECE_LIMIT]
    if material and width and height and free:
        free_ids = [s['id'] for s in free]
        cur.execute(
            "SELECT shelf_id FROM ("
            "  SELECT gw.shelf_id FROM goods_warehouse gw "
            "  JOIN orders o ON o.id = gw.order_id "
            "  WHERE gw.status = 'in_stock' AND gw.shelf_id = ANY(%s) "
            "    AND o.material = %s AND o.width = %s AND o.height = %s "
            "    AND NOT EXISTS (SELECT 1 FROM stocktake_scans x "
            "                    WHERE x.stocktake_id = %s AND x.goods_warehouse_id = gw.id) "
            "  UNION ALL "
            "  SELECT sc.shelf_id FROM stocktake_scans sc "
            "  JOIN goods_warehouse gw ON gw.id = sc.goods_warehouse_id "
            "  JOIN orders o ON o.id = gw.order_id "
            "  WHERE sc.stocktake_id = %s AND sc.shelf_id = ANY(%s) "
            "    AND o.material = %s AND o.width = %s AND o.height = %s "
            "    AND gw.status = 'in_stock' "
            ") same GROUP BY shelf_id ORDER BY COUNT(*) DESC LIMIT 1",
            (free_ids, material, width, height, int(stocktake_id),
             int(stocktake_id), free_ids, material, width, height),
        )
        hit = cur.fetchone()
        if hit:
            same_shelf = next(s for s in free if s['id'] == hit[0])
            return same_shelf['id'], same_shelf['name'], is_popular

    if free:
        target = sorted(free, key=lambda s: (_shelf_number(s['name']), s['name']))[0]
        return target['id'], target['name'], is_popular

    return None, (
        f'На полках «{kind}» уже по {SHELF_PIECE_LIMIT} вещей. '
        f'Добавьте ещё одну полку с таким названием'
    ), is_popular
