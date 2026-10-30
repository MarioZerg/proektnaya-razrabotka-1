"""Каталог мегатюль.рф в ERP: цена, себестоимость, выключение и нехватка ткани.

Карточки (название, артикул, ширина, высота) приходят с сайта. Цена задаётся у нас
и отправляется на сайт. Себестоимость берётся из «Себестоимости товара» по паре
ткань из расхода + ширина — только если в карточке проставлен расход материалов.
"""
import json
import time
import urllib.error
import urllib.request

PRODUCT_COST_URL = 'https://functions.poehali.dev/7e85cd3d-e5cd-44e2-a803-5ff07584de12'
LOW_FABRIC_METERS = 20


def is_admin(cur, actor_id):
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _cost_map():
    """Работа и накладные ширины + цены материалов по последним поставкам.

    Материалы считаем по КАЖДОЙ высоте отдельно: у высот могут быть разные пакеты.
    Работа цеха и прочие расходы зависят только от ткани и ширины.
    """
    # Расчёт себестоимости иногда отвечает ошибкой (база в пик упирается в лимит
    # запросов) — тогда у всех строк пропадала подсказка цены. Пробуем ещё раз,
    # а при неудаче отдаём последний удачный расчёт из памяти.
    data = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(PRODUCT_COST_URL, timeout=20) as r:
                data = json.loads(r.read().decode('utf-8') or '{}')
            break
        except Exception:
            if attempt == 0:
                time.sleep(0.4)
    if data is None:
        return _COST_CACHE.get('map')
    result = _parse_cost_map(data)
    _COST_CACHE['map'] = result
    return result


_COST_CACHE: dict = {}


def _parse_cost_map(data):
    groups = {}
    for g in data.get('groups') or []:
        width = int(float(g.get('width') or 0))
        labor = float(g.get('laborCost') or 0)
        salaried = float(g.get('salariedCost') or 0)
        parts = {
            # Сдельная работа цеха без окладов: оклады — постоянный расход, считаем отдельно.
            'labor': round(labor - salaried, 4),
            'shortagePct': float(g.get('shortagePercent') or 0),
        }
        for m in g.get('materials') or []:
            if m.get('typeName') == 'Тюль' and m.get('materialId'):
                groups.setdefault((int(m['materialId']), width), parts)
    prices = {int(k): float(v or 0) for k, v in (data.get('materialPrices') or {}).items()}
    settings = data.get('settings') or {}
    shortage_pct = float(settings.get('shortagePercent') or 0)
    sal = data.get('salaried') or {}
    return {
        'groups': groups, 'prices': prices, 'shortagePct': shortage_pct,
        'extras': data.get('extras') or [],
        'overheadPerItem': float(settings.get('overheadPerItem') or 0),
        'salaried': {'total': float(sal.get('total') or 0), 'perUnit': float(sal.get('perUnit') or 0),
                     'month': sal.get('month'), 'madeUnits': int(sal.get('madeUnits') or 0)},
        'soldUnits': int((data.get('sold') or {}).get('total') or 0),
    }


def fixed_costs(costs, pricing):
    """Постоянные расходы на одну вещь сайта.

    shared    — как сейчас: оклады и ежемесячные расходы делятся на ВСЕ продажи
                (сайт + маркетплейсы), сайт несёт свою долю;
    site_only — сайт работает один: те же ежемесячные суммы делятся только на
                план продаж сайта в месяц.
    Расходы «только маркетплейсы» (Премиум OZON) сайт не несёт ни в каком режиме.
    Не ежемесячные (коробка на 30 отправок) — норма на вещь, от объёма не зависят.
    """
    if costs is None:
        return None
    mode = pricing.get('fixedMode') or 'shared'
    units = max(int(pricing.get('siteMonthlyUnits') or 0), 1)
    lines = []
    sal = costs['salaried']
    sal_unit = sal['perUnit'] if mode == 'shared' else sal['total'] / units
    # perUnitShared — доля при делении на все продажи: по ней экран пересчитывает
    # пример при переключении режима ещё до сохранения.
    lines.append({'name': 'Оклады склада, уборки, администратора', 'monthly': round(sal['total'], 2),
                  'perUnit': round(sal_unit, 2), 'perUnitShared': round(sal['perUnit'], 4),
                  'isMonthly': True, 'channel': 'all'})
    skipped = []
    for e in costs['extras']:
        if not e.get('isActive'):
            continue
        if e.get('channel') == 'marketplaces':
            skipped.append(e.get('name'))
            continue
        monthly = bool(e.get('isMonthly', True))
        amount = float(e.get('amount') or 0)
        # Расход только сайта (реклама сайта, хостинг) несёт один сайт в любом режиме.
        if monthly and (mode == 'site_only' or e.get('channel') == 'site'):
            per = amount / units
        else:
            per = float(e.get('perUnit') or 0)
        lines.append({'name': e.get('name'), 'monthly': round(amount, 2) if monthly else None,
                      'perUnit': round(per, 2), 'perUnitShared': float(e.get('perUnit') or 0),
                      'isMonthly': monthly, 'channel': e.get('channel') or 'all'})
    if costs['overheadPerItem']:
        lines.append({'name': 'Прочие расходы (общее поле)', 'monthly': None,
                      'perUnit': round(costs['overheadPerItem'], 2),
                      'perUnitShared': costs['overheadPerItem'], 'isMonthly': False, 'channel': 'all'})
    monthly_total = round(sum(l['monthly'] or 0 for l in lines if l['isMonthly']), 2)
    return {
        'mode': mode,
        'units': units,
        'perUnit': round(sum(l['perUnit'] for l in lines), 2),
        'monthlyTotal': monthly_total,
        'perItemNorms': round(sum(l['perUnit'] for l in lines if not l['isMonthly']), 2),
        'lines': lines,
        'skipped': skipped,
        'allChannelsUnits': costs['soldUnits'],
        'salariedMonth': sal['month'],
    }


def _item_cost(item_materials, fabric_id, width, costs, fixed=None):
    """Себестоимость одной высоты: материалы + недостачи + сдельная работа + постоянные на штуку."""
    if not item_materials or not fabric_id or costs is None:
        return None
    grp = costs['groups'].get((int(fabric_id), int(width or 0)))
    if grp is None:
        return None
    lines = []
    for mid, name, qty in item_materials:
        price = costs['prices'].get(int(mid), 0.0)
        lines.append({'name': name, 'quantity': round(qty, 3), 'price': round(price, 2),
                      'sum': round(qty * price, 2)})
    materials = round(sum(x['sum'] for x in lines), 2)
    pct = grp['shortagePct'] or costs['shortagePct']
    shortage = round(materials * pct / 100, 2)
    labor = round(grp['labor'], 2)
    overhead = round(fixed['perUnit'], 2) if fixed else 0.0
    variable = round(materials + shortage + labor, 2)
    return {'total': round(variable + overhead, 2), 'variable': variable, 'materials': materials,
            'shortage': shortage, 'labor': labor, 'overhead': overhead, 'lines': lines}


def pricing_settings(cur):
    cur.execute(
        "SELECT min_profit_rub, max_profit_rub, tax_pct, acquiring_pct, blogger_pct, profit_by_width, "
        "  fixed_mode, site_monthly_units "
        "FROM site_pricing_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone() or (250, 450, 6, 2, 10, {}, 'shared', 300)
    raw = r[5] if isinstance(r[5], dict) else json.loads(r[5] or '{}')
    return {'minProfitRub': float(r[0]), 'maxProfitRub': float(r[1]), 'taxPct': float(r[2]),
            'acquiringPct': float(r[3]), 'bloggerPct': float(r[4]),
            'profitByWidth': {str(int(float(k))): float(v) for k, v in raw.items()},
            'fixedMode': r[6] or 'shared', 'siteMonthlyUnits': int(r[7] or 300)}


def save_pricing(cur, body):
    def num(key, lo, hi):
        try:
            v = float(body.get(key))
        except (TypeError, ValueError):
            raise ValueError(f'Неверное значение: {key}')
        if v < lo or v > hi:
            raise ValueError(f'Значение вне диапазона: {key}')
        return v
    try:
        vals = (num('taxPct', 0, 50), num('acquiringPct', 0, 20), num('bloggerPct', 0, 80))
        by_width = {}
        for k, v in (body.get('profitByWidth') or {}).items():
            w = int(float(k))
            p = float(v)
            if w <= 0 or w > 2000 or p < 0 or p > 100000:
                raise ValueError(f'Неверная прибыль для ширины {k}')
            by_width[str(w)] = round(p, 2)
        cur_p = pricing_settings(cur)
        mode = body.get('fixedMode') or cur_p['fixedMode']
        if mode not in ('shared', 'site_only'):
            raise ValueError('Неизвестный режим постоянных расходов')
        units = int(float(body.get('siteMonthlyUnits') or cur_p['siteMonthlyUnits']))
        if units < 1 or units > 1000000:
            raise ValueError('План продаж сайта — от 1 штуки в месяц')
    except (TypeError, ValueError) as e:
        return 400, {'error': str(e)}
    if sum(vals) >= 90:
        return 400, {'error': 'Налог, эквайринг и блогер вместе должны быть меньше 90%'}
    cur.execute(
        "UPDATE site_pricing_settings SET tax_pct = %s, acquiring_pct = %s, blogger_pct = %s, "
        "  profit_by_width = %s::jsonb, fixed_mode = %s, site_monthly_units = %s, "
        "  updated_at = now(), updated_by = %s "
        "WHERE id = (SELECT id FROM site_pricing_settings ORDER BY id LIMIT 1)",
        (*vals, json.dumps(by_width), mode, units, body.get('actorId')),
    )
    return 200, pricing_settings(cur)


INTERNAL_PREFIX = {
    'bambuk': 'bambuk', 'vual': 'vyal', 'len': 'len', 'molniya': 'mol', 'mramor': 'mramor',
    'setka': 'grek', 'shifon': 'krep',
}


def assign_internal_skus(cur, shop_id):
    """Внутренний артикул карточки сайта в стиле маркетплейсов: vyal2_230 (ткань, ширина/100, высота)."""
    cur.execute(
        "SELECT id, site_product_id, width, height FROM marketplace_items "
        "WHERE shop_id = %s AND internal_sku IS NULL AND site_product_id IS NOT NULL "
        "  AND width IS NOT NULL AND height IS NOT NULL",
        (int(shop_id),),
    )
    rows = []
    for item_id, pid, width, height in cur.fetchall():
        prefix = INTERNAL_PREFIX.get(pid) or ''.join(ch for ch in pid.lower() if ch.isalnum())
        w = int(width) // 100 if int(width) % 100 == 0 else int(width)
        rows.append((int(item_id), f"{prefix}{w}_{int(height)}".replace("'", '')))
    if not rows:
        return 0
    values = ','.join(f"({i}, '{code}')" for i, code in rows)
    cur.execute(
        "UPDATE marketplace_items mi SET internal_sku = v.code "
        f"FROM (VALUES {values}) AS v(id, code) "
        "WHERE mi.id = v.id AND NOT EXISTS "
        "(SELECT 1 FROM marketplace_items x WHERE x.internal_sku = v.code)"
    )
    return cur.rowcount


def list_products(cur, shop_id):
    cur.execute(
        "SELECT mi.id, mi.name, mi.sku, mi.width, mi.height, mi.material, mi.site_product_id, "
        "  mi.archived_at, mi.site_price, mi.site_disabled, mi.site_pushed_at, mi.site_push_error, "
        "  (SELECT COUNT(*) FROM marketplace_item_materials m WHERE m.marketplace_item_id = mi.id), "
        "  (SELECT m.material_id FROM marketplace_item_materials m "
        "   JOIN materials x ON x.id = m.material_id JOIN material_types t ON t.id = x.type_id "
        "   WHERE m.marketplace_item_id = mi.id AND t.name = 'Тюль' ORDER BY m.id LIMIT 1), "
        "  mi.internal_sku "
        "FROM marketplace_items mi WHERE mi.shop_id = %s AND COALESCE(mi.sku, '') NOT LIKE 'dup:%%' "
        "ORDER BY mi.sku",
        (int(shop_id),),
    )
    rows = cur.fetchall()
    costs = _cost_map()
    pricing = pricing_settings(cur)
    fixed = fixed_costs(costs, pricing)
    cur.execute(
        "SELECT mim.marketplace_item_id, mim.material_id, m.name, mim.quantity "
        "FROM marketplace_item_materials mim "
        "JOIN marketplace_items mi ON mi.id = mim.marketplace_item_id "
        "LEFT JOIN materials m ON m.id = mim.material_id "
        "WHERE mi.shop_id = %s ORDER BY mim.id",
        (int(shop_id),),
    )
    mats = {}
    for item_id, mid, name, qty in cur.fetchall():
        if mid is not None:
            mats.setdefault(item_id, []).append((mid, name or '?', float(qty or 0)))
    # Ткани из справочника — чтобы предупредить, что полотна карточки нет в системе.
    cur.execute(
        "SELECT lower(replace(m.name, 'ё', 'е')) FROM materials m "
        "JOIN material_types t ON t.id = m.type_id WHERE t.name = 'Тюль'"
    )
    fabric_names = {r[0].strip() for r in cur.fetchall() if r[0]}
    items = []
    for r in rows:
        parts = _item_cost(mats.get(r[0]), r[13], r[3], costs, fixed)
        cost = parts['total'] if parts else None
        if r[13]:
            fabric_status = 'ok'
        elif (r[5] or '').lower().replace('ё', 'е').strip() in fabric_names:
            fabric_status = 'notInMaterials'
        else:
            fabric_status = 'notInReference'
        items.append({
            'id': r[0], 'name': r[1], 'article': r[2], 'width': r[3], 'height': r[4],
            'material': r[5], 'siteProductId': r[6],
            'archivedAt': r[7].isoformat() + 'Z' if r[7] else None,
            'price': float(r[8]) if r[8] is not None else None,
            'disabled': bool(r[9]),
            'pushedAt': r[10].isoformat() + 'Z' if r[10] else None,
            'pushError': r[11],
            'materialsCount': int(r[12] or 0),
            'cost': cost,
            'costParts': parts,
            'internalSku': r[14],
            # ok — ткань в расходе; notInMaterials — ткань есть в справочнике, но не
            # указана в расходе; notInReference — такой ткани в справочнике нет.
            'fabricStatus': fabric_status,
        })
    # Сколько вещей сайт реально продал за 30 дней — подсказка для плана продаж.
    cur.execute(
        "SELECT COUNT(*) FROM orders WHERE shop_id = %s AND site_order_id IS NOT NULL "
        "  AND cancelled_at IS NULL AND COALESCE(marketplace_created_at, created_at) >= now() - interval '30 days'",
        (int(shop_id),),
    )
    site_sold_30 = int(cur.fetchone()[0] or 0)
    if fixed:
        fixed['siteSold30'] = site_sold_30
    return {'items': items, 'costAvailable': costs is not None, 'pricing': pricing, 'fixedCosts': fixed}


def push_to_site(site_url, api_key, payload_items):
    """Отправляет цены и признак продажи на сайт: POST {site}/api/crm/prices.

    Тело: {"items": [{"sku", "price", "active"}]}. Сайт отвечает 200 — принято.
    """
    req = urllib.request.Request(
        f'{site_url}/api/crm/prices',
        data=json.dumps({'items': payload_items}, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                 'X-Api-Key': api_key, 'Authorization': f'Bearer {api_key}'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status < 300, None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False, 'Сайт пока не принимает цены (адрес /api/crm/prices не найден)'
        if e.code in (401, 403):
            return False, 'Сайт не принял ключ доступа'
        return False, f'Сайт ответил ошибкой {e.code}'
    except Exception as e:
        return False, f'Сайт недоступен: {e}'


def _push_items(cur, ids, site_url, api_key):
    if not ids:
        return True, None
    ids_csv = ','.join(str(int(i)) for i in ids)
    cur.execute(
        f"SELECT id, sku, site_price, site_disabled FROM marketplace_items WHERE id IN ({ids_csv})"
    )
    rows = cur.fetchall()
    payload = [{'sku': r[1], 'price': float(r[2]) if r[2] is not None else None,
                'active': not r[3]} for r in rows if r[1]]
    ok, err = push_to_site(site_url, api_key, payload) if api_key else (False, 'Магазин не подключён')
    if ok:
        cur.execute(f"UPDATE marketplace_items SET site_pushed_at = now(), site_push_error = NULL "
                    f"WHERE id IN ({ids_csv})")
    else:
        cur.execute(f"UPDATE marketplace_items SET site_push_error = %s WHERE id IN ({ids_csv})", (err,))
    return ok, err


def set_price(cur, shop_id, body, site_url, api_key):
    """Цена на одну или сразу на все высоты ширины (itemIds)."""
    ids = [int(i) for i in (body.get('itemIds') or []) if i]
    ids += [int(k) for k in (body.get('prices') or {}).keys()]
    if body.get('itemId'):
        ids.append(int(body['itemId']))
    ids = sorted(set(ids))
    if not ids:
        return 400, {'error': 'Укажите товар'}
    per_item = body.get('prices') or {}
    if per_item:
        try:
            pairs = {int(k): round(float(v), 2) for k, v in per_item.items()}
        except (TypeError, ValueError):
            return 400, {'error': 'Цена должна быть числом'}
        if any(v <= 0 for v in pairs.values()):
            return 400, {'error': 'Цена должна быть больше нуля'}
        values = ','.join(f"({k}, {v})" for k, v in pairs.items())
        cur.execute(
            "UPDATE marketplace_items mi SET site_price = v.price, updated_at = now() "
            f"FROM (VALUES {values}) AS v(id, price) "
            "WHERE mi.id = v.id AND mi.shop_id = %s RETURNING mi.id",
            (int(shop_id),),
        )
    else:
        price = body.get('price')
        try:
            price_val = None if price in (None, '') else round(float(price), 2)
        except (TypeError, ValueError):
            return 400, {'error': 'Цена должна быть числом'}
        if price_val is not None and price_val <= 0:
            return 400, {'error': 'Цена должна быть больше нуля'}
        ids_csv = ','.join(str(i) for i in ids)
        cur.execute(
            f"UPDATE marketplace_items SET site_price = %s, updated_at = now() "
            f"WHERE id IN ({ids_csv}) AND shop_id = %s RETURNING id",
            (price_val, int(shop_id)),
        )
    done = [r[0] for r in cur.fetchall()]
    if not done:
        return 404, {'error': 'Товар не найден'}
    ok, err = _push_items(cur, done, site_url, api_key)
    return 200, {'saved': True, 'changed': len(done), 'pushed': ok, 'pushError': err}


def set_disabled(cur, shop_id, body, site_url, api_key):
    """Выключить/включить на сайте один артикул или все артикулы по ткани."""
    disabled = bool(body.get('disabled'))
    item_ids = [int(i) for i in (body.get('itemIds') or []) if i]
    material_id = body.get('materialId')
    if material_id:
        cur.execute(
            "SELECT DISTINCT mi.id FROM marketplace_items mi "
            "JOIN marketplace_item_materials mim ON mim.marketplace_item_id = mi.id "
            "WHERE mi.shop_id = %s AND mi.archived_at IS NULL AND mim.material_id = %s",
            (int(shop_id), int(material_id)),
        )
        item_ids += [r[0] for r in cur.fetchall()]
    item_ids = sorted(set(item_ids))
    if not item_ids:
        return 400, {'error': 'Не выбраны товары'}
    ids_csv = ','.join(str(i) for i in item_ids)
    cur.execute(
        f"UPDATE marketplace_items SET site_disabled = %s, updated_at = now() "
        f"WHERE id IN ({ids_csv}) AND shop_id = %s",
        (disabled, int(shop_id)),
    )
    ok, err = _push_items(cur, item_ids, site_url, api_key)
    return 200, {'changed': len(item_ids), 'pushed': ok, 'pushError': err}


def low_fabric(cur, shop_id):
    """Ткани, которых осталось меньше 20 м на складе и в цехе, и товары сайта на них."""
    cur.execute(
        "WITH fab AS ("
        "  SELECT DISTINCT mim.material_id FROM marketplace_item_materials mim "
        "  JOIN marketplace_items mi ON mi.id = mim.marketplace_item_id "
        "  JOIN materials m ON m.id = mim.material_id "
        "  JOIN material_types mt ON mt.id = m.type_id "
        "  WHERE mi.shop_id = %s AND mi.archived_at IS NULL AND mt.name = 'Тюль'"
        "), stock AS ("
        "  SELECT material_id, SUM(remaining_quantity) AS meters FROM rolls "
        "  WHERE status IN ('in_storage', 'in_workshop') GROUP BY material_id"
        ") "
        "SELECT f.material_id, m.name, COALESCE(s.meters, 0), "
        "  (SELECT COUNT(DISTINCT mi.id) FROM marketplace_items mi "
        "   JOIN marketplace_item_materials x ON x.marketplace_item_id = mi.id "
        "   WHERE x.material_id = f.material_id AND mi.shop_id = %s "
        "     AND mi.archived_at IS NULL AND NOT mi.site_disabled), "
        "  (SELECT COUNT(DISTINCT mi.id) FROM marketplace_items mi "
        "   JOIN marketplace_item_materials x ON x.marketplace_item_id = mi.id "
        "   WHERE x.material_id = f.material_id AND mi.shop_id = %s "
        "     AND mi.archived_at IS NULL AND mi.site_disabled) "
        "FROM fab f JOIN materials m ON m.id = f.material_id "
        "LEFT JOIN stock s ON s.material_id = f.material_id "
        "WHERE COALESCE(s.meters, 0) < %s ORDER BY 3",
        (int(shop_id), int(shop_id), int(shop_id), LOW_FABRIC_METERS),
    )
    return {
        'threshold': LOW_FABRIC_METERS,
        'fabrics': [
            {'materialId': r[0], 'name': r[1], 'meters': round(float(r[2] or 0), 1),
             'activeItems': int(r[3] or 0), 'disabledItems': int(r[4] or 0)}
            for r in cur.fetchall() if int(r[3] or 0) > 0
        ],
    }


def orders_profit(cur, shop_id, month=None):
    """Реальная прибыль заказов сайта за месяц.

    Налог и эквайринг — со всей оплаты покупателя (товар + доставка),
    блогеру — его начисление (15% от товара без доставки), Ozon — фактический тариф.
    """
    month = str(month or '')[:7]
    if len(month) != 7:
        cur.execute("SELECT to_char(now(), 'YYYY-MM')")
        month = cur.fetchone()[0]
    p = pricing_settings(cur)
    cur.execute(
        "SELECT o.id, o.order_number, o.group_key, o.product, o.marketplace_item_id, o.site_city, "
        "  o.site_goods_rub, o.site_delivery_rub, o.site_delivery_cost_rub, o.site_partner_code, "
        "  o.site_partner_rub, o.marketplace_created_at, o.status "
        "FROM orders o WHERE o.shop_id = %s AND o.site_order_id IS NOT NULL "
        "  AND to_char(COALESCE(o.marketplace_created_at, o.created_at), 'YYYY-MM') = %s "
        "ORDER BY COALESCE(o.marketplace_created_at, o.created_at) DESC, o.id",
        (int(shop_id), month),
    )
    rows = cur.fetchall()
    costs = _cost_map()
    fixed = fixed_costs(costs, p)
    item_ids = sorted({r[4] for r in rows if r[4]})
    mats, info = {}, {}
    if item_ids:
        ids_csv = ','.join(str(int(i)) for i in item_ids)
        cur.execute(
            "SELECT mim.marketplace_item_id, mim.material_id, m.name, mim.quantity "
            "FROM marketplace_item_materials mim LEFT JOIN materials m ON m.id = mim.material_id "
            f"WHERE mim.marketplace_item_id IN ({ids_csv}) ORDER BY mim.id"
        )
        for item_id, mid, name, qty in cur.fetchall():
            if mid is not None:
                mats.setdefault(item_id, []).append((mid, name or '?', float(qty or 0)))
        cur.execute(
            "SELECT mi.id, mi.width, (SELECT m.material_id FROM marketplace_item_materials m "
            "  JOIN materials x ON x.id = m.material_id JOIN material_types t ON t.id = x.type_id "
            "  WHERE m.marketplace_item_id = mi.id AND t.name = 'Тюль' ORDER BY m.id LIMIT 1) "
            f"FROM marketplace_items mi WHERE mi.id IN ({ids_csv})"
        )
        info = {r[0]: (r[2], r[1]) for r in cur.fetchall()}
    tax_k = p['taxPct'] / 100
    acq_k = p['acquiringPct'] / 100
    out = []
    totals = {'paid': 0.0, 'goods': 0.0, 'delivery': 0.0, 'tax': 0.0, 'acquiring': 0.0,
              'ozon': 0.0, 'blogger': 0.0, 'cost': 0.0, 'profit': 0.0}
    for r in rows:
        goods = float(r[6]) if r[6] is not None else None
        delivery = float(r[7] or 0)
        ozon = float(r[8]) if r[8] is not None else None
        fabric_id, width = info.get(r[4], (None, None))
        parts = _item_cost(mats.get(r[4]), fabric_id, width, costs, fixed) if r[4] else None
        cost = parts['total'] if parts else None
        paid = (goods or 0) + delivery
        tax = paid * tax_k
        acq = paid * acq_k
        blogger = float(r[10] or 0) if r[9] else 0.0
        complete = goods is not None and cost is not None and ozon is not None
        profit = paid - tax - acq - (ozon or 0) - blogger - (cost or 0) if goods is not None else None
        out.append({
            'id': r[0], 'orderNumber': r[1], 'groupKey': r[2], 'product': r[3], 'city': r[5],
            'goods': goods, 'delivery': delivery, 'ozon': ozon, 'paid': paid,
            'tax': round(tax, 2), 'acquiring': round(acq, 2), 'blogger': blogger,
            'partnerCode': r[9], 'cost': cost,
            'profit': round(profit, 2) if profit is not None else None, 'complete': complete,
            'createdAt': r[11].isoformat() + 'Z' if r[11] else None, 'status': r[12],
        })
        if goods is not None:
            for k, v in (('paid', paid), ('goods', goods), ('delivery', delivery), ('tax', tax),
                         ('acquiring', acq), ('ozon', ozon or 0), ('blogger', blogger),
                         ('cost', cost or 0), ('profit', profit)):
                totals[k] += v
    return {'month': month, 'orders': out, 'totals': {k: round(v, 2) for k, v in totals.items()},
            'pricing': p}