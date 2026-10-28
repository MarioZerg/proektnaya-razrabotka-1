"""Каталог мегатюль.рф в ERP: цена, себестоимость, выключение и нехватка ткани.

Карточки (название, артикул, ширина, высота) приходят с сайта. Цена задаётся у нас
и отправляется на сайт. Себестоимость берётся из «Себестоимости товара» по паре
ткань из расхода + ширина — только если в карточке проставлен расход материалов.
"""
import json
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
    try:
        with urllib.request.urlopen(PRODUCT_COST_URL, timeout=20) as r:
            data = json.loads(r.read().decode('utf-8') or '{}')
    except Exception:
        return None
    out = {}
    for g in data.get('groups') or []:
        width = int(float(g.get('width') or 0))
        total = float(g.get('total') or 0)
        for m in g.get('materials') or []:
            if m.get('typeName') == 'Тюль' and m.get('materialId'):
                out.setdefault((int(m['materialId']), width), total)
    return out


def list_products(cur, shop_id):
    cur.execute(
        "SELECT mi.id, mi.name, mi.sku, mi.width, mi.height, mi.material, mi.site_product_id, "
        "  mi.archived_at, mi.site_price, mi.site_disabled, mi.site_pushed_at, mi.site_push_error, "
        "  (SELECT COUNT(*) FROM marketplace_item_materials m WHERE m.marketplace_item_id = mi.id), "
        "  (SELECT m.material_id FROM marketplace_item_materials m "
        "   JOIN materials x ON x.id = m.material_id JOIN material_types t ON t.id = x.type_id "
        "   WHERE m.marketplace_item_id = mi.id AND t.name = 'Тюль' ORDER BY m.id LIMIT 1) "
        "FROM marketplace_items mi WHERE mi.shop_id = %s ORDER BY mi.sku",
        (int(shop_id),),
    )
    rows = cur.fetchall()
    costs = _cost_map()
    items = []
    for r in rows:
        has_materials = int(r[12] or 0) > 0
        cost = None
        if has_materials and r[13] and costs is not None:
            cost = costs.get((int(r[13]), int(r[3] or 0)))
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
        })
    return {'items': items, 'costAvailable': costs is not None}


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
    item_id = body.get('itemId')
    price = body.get('price')
    if not item_id:
        return 400, {'error': 'Укажите товар'}
    try:
        price_val = None if price in (None, '') else round(float(price), 2)
    except (TypeError, ValueError):
        return 400, {'error': 'Цена должна быть числом'}
    if price_val is not None and price_val <= 0:
        return 400, {'error': 'Цена должна быть больше нуля'}
    cur.execute(
        "UPDATE marketplace_items SET site_price = %s, updated_at = now() "
        "WHERE id = %s AND shop_id = %s RETURNING id",
        (price_val, int(item_id), int(shop_id)),
    )
    if not cur.fetchone():
        return 404, {'error': 'Товар не найден'}
    ok, err = _push_items(cur, [int(item_id)], site_url, api_key)
    return 200, {'saved': True, 'pushed': ok, 'pushError': err}


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
