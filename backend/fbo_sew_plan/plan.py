"""Автопредложка поставки FBO В ПОШИВ: что сшить и в какой кластер Ozon везти.

ОТЛИЧИЕ ОТ ПРЕДЛОЖКИ СО СКЛАДА (marketplace_supplies/fbo_proposals.py). Там
вещи уже лежат на полке, и вопрос — куда их отвезти. Здесь вещей ещё нет:
администратор бегунком задаёт, сколько штук отдать цеху, а система решает,
в какой кластер их везти и какие размеры шить.

РАСЧЁТ
1. Спрос — заказы Ozon за 28 дней по КЛАСТЕРУ ПОКУПАТЕЛЯ (cluster_to), FBO и
   FBS вместе, без отменённых. Это настоящий спрос региона, а не только то, что
   уже продаётся с его склада.
2. Запас в кластере — остатки Ozon (доступно + в пути + в заявках) и наши
   поставки FBO, которые ещё не превратились в заявку Ozon (их шьют или
   собирают). Так повторное формирование не шьёт второй раз то, что уже в работе.
3. Потребность = продажи за COVER_DAYS дней − запас.
4. Кластер — где потребность больше всего и локализация ниже всего. Домашний
   кластер (откуда едет FBS — Ярославль) не предлагаем: там заказы и так локальные.
5. Штуки бегунка делим между артикулами пропорционально потребности, сначала
   ходовые. Мелочь меньше MIN_LINE штук отбрасываем — хвосты, ради которых не
   стоит заправлять ткань, их штуки отдаём крупным строкам.
6. Ткань: склад + цех минус то, что уже съест очередь раскроя. Не хватает —
   артикул урезаем или убираем с пометкой «нет ткани». Ткань на паузе выдачи
   (тумблер на главной) не берём вовсе.

ЛИКВИДНОСТЬ
  * hot    — 10+ продаж за 28 дней по всем кластерам;
  * normal — 3–9;
  * weak   — 1–2: в план не идёт сам, но показывается списком «плохо продаётся»,
             его можно добавить руками;
  * без продаж и «ограничен Ozon» (RESTRICTED_NO_SALES) — не показываем.
"""
import math

DEMAND_DAYS = 28
COVER_DAYS = 35
HOT_SALES = 10
LIQUID_SALES = 3
MIN_LINE = 2
MIN_PIECES = 10
MAX_PIECES = 2000
POPULAR_SIZE_SHARE = 0.01


def _fabric_materials(cur):
    """id тканей (тип «Тюль») и их названия с синонимами из заказов."""
    cur.execute(
        "SELECT m.id, m.name FROM materials m JOIN material_types t ON t.id = m.type_id "
        "WHERE t.name = 'Тюль'"
    )
    return {int(r[0]): r[1] for r in cur.fetchall()}


ALIASES = {
    'Вуаль (без ут)': 'Вуаль без утяжелителя',
}


def _cut_paused(cur):
    import json
    cur.execute("SELECT value FROM system_settings WHERE key = 'cut_paused_products'")
    row = cur.fetchone()
    try:
        items = json.loads(row[0]) if row and row[0] else []
    except Exception:
        items = []
    names = {str(x).strip() for x in items if str(x).strip()}
    return names | {a for a, b in ALIASES.items() if b in names}


def home_cluster(cur, shop_id):
    """Откуда едут наши FBS — там заказы и так локальные."""
    cur.execute(
        "SELECT cluster_from, COUNT(*) FROM ozon_posting_geo "
        "WHERE shop_id = %s AND scheme = 'FBS' AND cluster_from IS NOT NULL "
        "GROUP BY 1 ORDER BY 2 DESC LIMIT 1",
        (int(shop_id),),
    )
    row = cur.fetchone()
    return row[0] if row else None


def localization(cur, shop_id):
    """Доля заказов за 28 дней, отгруженных из кластера покупателя: всего и по кластерам."""
    cur.execute(
        "SELECT cluster_to, SUM(quantity), "
        "       SUM(quantity) FILTER (WHERE cluster_from = cluster_to), "
        "       SUM(quantity) FILTER (WHERE scheme = 'FBO') "
        "FROM ozon_posting_geo "
        "WHERE shop_id = %s AND cluster_to IS NOT NULL AND status <> 'cancelled' "
        f"  AND created_at > now() - interval '{DEMAND_DAYS} days' "
        "GROUP BY 1",
        (int(shop_id),),
    )
    by = {}
    total = local = 0
    for name, qty, loc, fbo in cur.fetchall():
        qty, loc = int(qty or 0), int(loc or 0)
        by[name] = {'orders': qty, 'local': loc, 'fbo': int(fbo or 0)}
        total += qty
        local += loc
    return {'total': total, 'local': local,
            'percent': round(local * 100.0 / total, 1) if total else None,
            'byCluster': by}


def data_freshness(cur, shop_id):
    cur.execute(
        "SELECT scheme, synced_to, cursor IS NOT NULL, updated_at FROM ozon_geo_sync WHERE shop_id = %s",
        (int(shop_id),),
    )
    out = {}
    for scheme, synced_to, partial, updated in cur.fetchall():
        out[scheme] = {'syncedTo': synced_to.isoformat() if synced_to else None,
                       'partial': bool(partial),
                       'updatedAt': updated.isoformat() if updated else None}
    return out


def _items(cur, shop_id):
    """Карточки Ozon с расходом ткани: sku -> {...}."""
    fabrics = _fabric_materials(cur)
    cur.execute(
        "SELECT mi.id, mi.ozon_sku, mi.name, mi.material, mi.width, mi.height "
        "FROM marketplace_items mi "
        "WHERE mi.shop_id = %s AND mi.ozon_sku ~ '^[0-9]+$'",
        (int(shop_id),),
    )
    items = {}
    for iid, sku, name, material, width, height in cur.fetchall():
        items[int(sku)] = {'itemId': int(iid), 'sku': int(sku), 'name': name or '',
                           'material': material, 'width': width, 'height': height,
                           'fabricId': None, 'meters': None}
    if not items:
        return items, fabrics
    by_id = {v['itemId']: v for v in items.values()}
    ids = ','.join(str(i) for i in by_id)
    cur.execute(
        "SELECT marketplace_item_id, material_id, quantity FROM marketplace_item_materials "
        f"WHERE marketplace_item_id IN ({ids}) AND workshop_id IS NULL"
    )
    for iid, mid, qty in cur.fetchall():
        if mid is not None and int(mid) in fabrics:
            it = by_id.get(int(iid))
            if it:
                it['fabricId'] = int(mid)
                it['meters'] = (it['meters'] or 0) + float(qty or 0)
    name_to_id = {n: i for i, n in fabrics.items()}
    for it in items.values():
        if it['fabricId'] is None and it['material']:
            mat = ALIASES.get(it['material'], it['material'])
            it['fabricId'] = name_to_id.get(mat)
        if not it['meters'] and it['width']:
            it['meters'] = int(it['width']) / 100.0 + 0.05
    return items, fabrics


def fabric_left(cur, fabrics):
    """Метры ткани: склад + цех минус то, что съест очередь ещё не раскроенных заказов."""
    cur.execute(
        "SELECT material_id, "
        "  COALESCE(SUM(remaining_quantity) FILTER (WHERE status = 'in_storage'), 0), "
        "  COALESCE(SUM(remaining_quantity) FILTER (WHERE status = 'in_workshop'), 0) "
        "FROM rolls WHERE removed_at IS NULL AND defect_flagged_at IS NULL "
        "  AND status IN ('in_storage', 'in_workshop') AND remaining_quantity > 0 "
        "GROUP BY material_id"
    )
    stock = {int(r[0]): {'warehouse': float(r[1]), 'workshop': float(r[2])}
             for r in cur.fetchall() if r[0] is not None and int(r[0]) in fabrics}
    name_to_id = {n: i for i, n in fabrics.items()}
    # Очередь раскроя: заказы ещё не резаны, не со склада, не отменены.
    cur.execute(
        "SELECT o.material, o.width, "
        "  (SELECT SUM(mim.quantity) FROM marketplace_item_materials mim "
        "   WHERE mim.marketplace_item_id = o.marketplace_item_id AND mim.workshop_id IS NULL "
        "     AND mim.material_id IN (" + (','.join(str(i) for i in fabrics) or '0') + ")) "
        "FROM orders o "
        "WHERE o.sewing_status IN ('Новый', 'На раскрое') AND o.fulfilled_from_stock_id IS NULL "
        "  AND COALESCE(o.status, '') <> 'Отменён' AND o.cancelled_at IS NULL "
        "  AND strpos(lower(COALESCE(o.ozon_status, '')), 'cancel') <> 1 "
        "  AND o.material IS NOT NULL"
    )
    queue = {}
    for material, width, meters in cur.fetchall():
        mid = name_to_id.get(ALIASES.get(material, material))
        if mid is None:
            continue
        need = float(meters) if meters else ((int(width) / 100.0 + 0.05) if width else 0)
        queue[mid] = queue.get(mid, 0.0) + need
    out = {}
    for mid, name in fabrics.items():
        s = stock.get(mid, {'warehouse': 0.0, 'workshop': 0.0})
        q = queue.get(mid, 0.0)
        out[mid] = {'name': name, 'warehouse': round(s['warehouse'], 1),
                    'workshop': round(s['workshop'], 1), 'queue': round(q, 1),
                    'free': round(s['warehouse'] + s['workshop'] - q, 1)}
    return out


def _demand(cur, shop_id):
    """sku -> {кластер покупателя: штук за 28 дней}, и итог по sku."""
    cur.execute(
        "SELECT cluster_to, sku, SUM(quantity), "
        "       SUM(quantity) FILTER (WHERE cluster_from = cluster_to) "
        "FROM ozon_posting_geo "
        "WHERE shop_id = %s AND cluster_to IS NOT NULL AND status <> 'cancelled' "
        f"  AND created_at > now() - interval '{DEMAND_DAYS} days' "
        "GROUP BY 1, 2",
        (int(shop_id),),
    )
    by_cluster, total, local = {}, {}, {}
    for cluster, sku, qty, loc in cur.fetchall():
        by_cluster.setdefault(cluster, {})[int(sku)] = int(qty)
        total[int(sku)] = total.get(int(sku), 0) + int(qty)
        local[(cluster, int(sku))] = int(loc or 0)
    return by_cluster, total, local


def _ozon_stock(cur, shop_id):
    cur.execute(
        "SELECT cluster_name, sku, available + in_transit + requested, grade "
        "FROM ozon_cluster_stock WHERE shop_id = %s",
        (int(shop_id),),
    )
    stock, grade = {}, {}
    for cluster, sku, qty, g in cur.fetchall():
        stock.setdefault(cluster, {})[int(sku)] = int(qty or 0)
        grade[(cluster, int(sku))] = g
    return stock, grade


def _our_pipeline(cur, shop_id, items_by_id):
    """Наши FBO-поставки без заявки Ozon: что уже шьётся или собирается по кластерам."""
    cur.execute(
        "SELECT COALESCE(wc.cluster_name, ms.cluster), o.marketplace_item_id, COUNT(*) "
        "FROM orders o JOIN marketplace_supplies ms ON ms.id = o.supply_id "
        "LEFT JOIN ozon_warehouse_cluster wc ON wc.warehouse_name = ms.cluster "
        "WHERE ms.marketplace = 'OZON' AND ms.type = 'FBO' AND ms.shop_id = %s "
        "  AND ms.status IN ('Открытая', 'На сборке') AND ms.ozon_supply_order_id IS NULL "
        "  AND COALESCE(o.status, '') <> 'Отменён' AND o.cancelled_at IS NULL "
        "  AND o.marketplace_item_id IS NOT NULL "
        "GROUP BY 1, 2",
        (int(shop_id),),
    )
    out = {}
    for cluster, iid, qty in cur.fetchall():
        it = items_by_id.get(int(iid))
        if it and cluster:
            out.setdefault(cluster, {})[it['sku']] = out.get(cluster, {}).get(it['sku'], 0) + int(qty)
    return out


def _popular_sizes(cur, shop_id):
    cur.execute(
        "SELECT width, height, COUNT(*) FROM orders "
        "WHERE shop_id = %s AND created_at > now() - interval '60 days' "
        "  AND width IS NOT NULL AND height IS NOT NULL GROUP BY 1, 2",
        (int(shop_id),),
    )
    rows = cur.fetchall()
    total = sum(int(r[2]) for r in rows) or 1
    return {(r[0], r[1]) for r in rows if int(r[2]) / total >= POPULAR_SIZE_SHARE}


def _grade(total_sales):
    if total_sales >= HOT_SALES:
        return 'hot'
    if total_sales >= LIQUID_SALES:
        return 'normal'
    if total_sales >= 1:
        return 'weak'
    return None


def _split(total, weights):
    """Делит total штук по весам методом наибольших остатков."""
    s = sum(weights.values())
    if total <= 0 or s <= 0:
        return {k: 0 for k in weights}
    raw = {k: total * w / s for k, w in weights.items()}
    out = {k: int(math.floor(v)) for k, v in raw.items()}
    left = total - sum(out.values())
    for k in sorted(raw, key=lambda k: raw[k] - out[k], reverse=True)[:left]:
        out[k] += 1
    return out


def build(cur, shop_id, pieces, cluster=None, removed=None, added=None):
    """Считает предложку. Ничего не записывает."""
    pieces = max(MIN_PIECES, min(int(pieces or 0), MAX_PIECES))
    removed = {int(x) for x in (removed or [])}
    added = {int(x) for x in (added or [])}
    items, fabrics = _items(cur, shop_id)
    items_by_id = {v['itemId']: v for v in items.values()}
    demand, total_sales, local = _demand(cur, shop_id)
    if not demand:
        return {'error': 'Нет данных о заказах Ozon по регионам. Нажмите «Обновить данные Ozon»'}
    stock, grades = _ozon_stock(cur, shop_id)
    pipeline = _our_pipeline(cur, shop_id, items_by_id)
    home = home_cluster(cur, shop_id)
    loc = localization(cur, shop_id)
    popular = _popular_sizes(cur, shop_id)
    paused = _cut_paused(cur)
    fabric = fabric_left(cur, fabrics)

    def need_in(cl):
        """sku -> (продажи 28 дн, запас, потребность)."""
        out = {}
        for sku, sold in (demand.get(cl) or {}).items():
            it = items.get(sku)
            if not it:
                continue
            have = (stock.get(cl) or {}).get(sku, 0) + (pipeline.get(cl) or {}).get(sku, 0)
            want = sold * COVER_DAYS / DEMAND_DAYS
            out[sku] = (sold, have, max(0.0, want - have))
        return out

    # Сводка по кластерам — чтобы было видно, почему выбран этот.
    summary = []
    for cl in demand:
        n = need_in(cl)
        liquid_need = sum(v[2] for sku, v in n.items()
                          if _grade(total_sales.get(sku, 0)) in ('hot', 'normal')
                          and grades.get((cl, sku)) != 'RESTRICTED_NO_SALES')
        st = loc['byCluster'].get(cl) or {'orders': 0, 'local': 0}
        summary.append({
            'cluster': cl,
            'orders': st['orders'],
            'localPercent': round(st['local'] * 100.0 / st['orders'], 1) if st['orders'] else None,
            'need': int(round(liquid_need)),
            'onOzon': sum((stock.get(cl) or {}).values()),
            'inWork': sum((pipeline.get(cl) or {}).values()),
            'home': cl == home,
        })
    # Выгоднее всего — где не хватает больше всего и где сейчас много нелокальных заказов.
    for s in summary:
        nonlocal_share = 1 - (s['localPercent'] or 0) / 100.0
        s['score'] = round(s['need'] * (0.5 + nonlocal_share), 1)
    summary.sort(key=lambda s: (s['home'], -s['score']))
    candidates = [s for s in summary if not s['home'] and s['need'] > 0]
    chosen = cluster if cluster in demand else (candidates[0]['cluster'] if candidates else None)
    if not chosen:
        return {'error': 'Во всех кластерах запаса хватает — шить под FBO сейчас нечего',
                'clusters': summary, 'localization': loc}

    need = need_in(chosen)
    lines, weak, skipped = [], [], []
    for sku, (sold, have, n) in need.items():
        it = items[sku]
        g = _grade(total_sales.get(sku, 0))
        size_ok = (it['width'], it['height']) in popular
        row = {
            'sku': sku, 'itemId': it['itemId'], 'name': it['name'], 'material': it['material'],
            'width': it['width'], 'height': it['height'], 'sold': sold,
            'soldTotal': total_sales.get(sku, 0), 'onOzon': have, 'need': int(math.ceil(n)),
            'grade': g, 'popularSize': size_ok, 'quantity': 0, 'note': None,
            'fabricId': it['fabricId'], 'meters': it['meters'],
        }
        if grades.get((chosen, sku)) == 'RESTRICTED_NO_SALES':
            row['note'] = 'Ozon не принимает в поставку (нет продаж 120 дней)'
            skipped.append(row)
            continue
        if not it['fabricId'] or not it['meters']:
            row['note'] = 'Нет расхода ткани в карточке'
            skipped.append(row)
            continue
        if (it['material'] or '') in paused or fabrics.get(it['fabricId']) in paused:
            row['note'] = 'Ткань на паузе выдачи'
            skipped.append(row)
            continue
        if sku in removed:
            row['note'] = 'Удалено из предложки'
            skipped.append(row)
            continue
        if n <= 0:
            continue
        if g in ('hot', 'normal') or sku in added:
            lines.append(row)
        elif g == 'weak':
            weak.append(row)

    # Распределяем штуки: вес — потребность, ходовые размеры вперёд.
    def weight(r):
        return r['need'] * (1.0 if r['popularSize'] else 0.6) * (1.2 if r['grade'] == 'hot' else 1.0)

    fabric_free = {mid: f['free'] for mid, f in fabric.items()}
    plan = {}

    def allocate(pool, budget):
        """Раздаёт budget штук по весам; упёрлись в ткань или потребность — остаток делим дальше."""
        for _ in range(8):
            if budget <= 0 or not pool:
                break
            share = _split(budget, {r['sku']: weight(r) for r in pool})
            progressed = False
            next_pool = []
            for r in pool:
                room = r['need'] - plan.get(r['sku'], 0)
                want = min(share.get(r['sku'], 0), room)
                fits = int(max(0.0, fabric_free.get(r['fabricId'], 0.0)) // r['meters'])
                take = min(want, fits)
                if take > 0:
                    plan[r['sku']] = plan.get(r['sku'], 0) + take
                    fabric_free[r['fabricId']] -= take * r['meters']
                    budget -= take
                    progressed = True
                if want > fits:
                    r['note'] = 'Не хватает ткани'
                if r['need'] - plan.get(r['sku'], 0) > 0 and fits > take:
                    next_pool.append(r)
            pool = next_pool
            if not progressed:
                break
        return budget

    budget = allocate(list(lines), pieces)

    # Хвосты: строки меньше MIN_LINE штук не шьём — ради одной шторы не стоит
    # заправлять ткань и заводить строку в заявке. Их штуки делим между
    # остальными строками так же, по весам.
    for _ in range(3):
        tails = [s for s, q in plan.items() if 0 < q < MIN_LINE]
        if not tails or len(plan) == len(tails):
            break
        for s in tails:
            r = next(x for x in lines if x['sku'] == s)
            fabric_free[r['fabricId']] += plan[s] * r['meters']
            budget += plan.pop(s)
            r['note'] = r['note'] or f'Хвост меньше {MIN_LINE} шт. — убран'
        budget = allocate([r for r in lines if r['sku'] in plan], budget)

    for r in lines:
        r['quantity'] = plan.get(r['sku'], 0)
    chosen_lines = sorted([r for r in lines if r['quantity'] > 0],
                          key=lambda r: (-r['quantity'], r['name']))
    short_lines = [r for r in lines if r['quantity'] == 0 and r['note']]
    planned = sum(r['quantity'] for r in chosen_lines)

    # Локализация после поставки: штуки закроют часть нелокальных заказов кластера.
    st = loc['byCluster'].get(chosen) or {'orders': 0, 'local': 0}
    gain = 0
    for r in chosen_lines:
        sold = demand[chosen].get(r['sku'], 0)
        nonlocal_orders = sold - local.get((chosen, r['sku']), 0)
        gain += min(r['quantity'], max(0, nonlocal_orders))
    after_total = (loc['local'] + gain) * 100.0 / loc['total'] if loc['total'] else None
    after_cluster = ((st['local'] + gain) * 100.0 / st['orders']) if st['orders'] else None

    used = {}
    for r in chosen_lines:
        used[r['fabricId']] = used.get(r['fabricId'], 0.0) + r['quantity'] * r['meters']
    fabric_rows = [
        {**fabric[mid], 'id': mid, 'use': round(m, 1), 'after': round(fabric[mid]['free'] - m, 1)}
        for mid, m in used.items() if mid in fabric
    ]

    note = None
    if planned < pieces:
        note = (f'Собрано {planned} из {pieces} шт.: больше в кластере «{chosen}» '
                'сейчас не нужно или не хватает ткани')

    def clean(r):
        return {k: v for k, v in r.items() if k not in ('fabricId', 'meters')}

    return {
        'cluster': chosen,
        'home': home,
        'requested': pieces,
        'pieces': planned,
        'note': note,
        'lines': [clean(r) for r in chosen_lines],
        'weak': [clean(r) for r in sorted(weak, key=lambda r: -r['sold'])[:40]],
        'skipped': [clean(r) for r in (skipped + short_lines)][:60],
        'fabric': fabric_rows,
        'clusters': summary,
        'localization': {
            'now': loc['percent'],
            'after': round(after_total, 1) if after_total is not None else None,
            'clusterNow': (round(st['local'] * 100.0 / st['orders'], 1) if st['orders'] else None),
            'clusterAfter': round(min(after_cluster, 100.0), 1) if after_cluster is not None else None,
            'orders': loc['total'],
        },
    }
