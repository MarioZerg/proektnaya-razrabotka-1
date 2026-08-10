import json
import os

import psycopg2


def is_admin(cur, actor_id) -> bool:
    """Роль берём из базы: в запросе её можно подменить, в базе — нет."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description, details=None):
    """Пишет запись в журнал действий (audit_log) в той же транзакции перед commit()."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'warehouse',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


# Этапы, после которых вещь уже в производстве: ткань раскроена, потрачен труд.
# Такой заказ подбирать со склада поздно — иначе работа цеха пропадёт впустую.
NOT_STARTED_SEWING = 'Новый'


def try_match_orders_from_stock(cur, gw_id=None):
    """Ищет заказы, которые можно закрыть вещами со склада, и резервирует их.

    Раньше подбор срабатывал ТОЛЬКО в момент прихода заказа с маркетплейса: если вещь
    появлялась на полке позже (швея дошила, вернули возврат, принял админ), заказ так и
    уходил в пошив, хотя на складе уже лежала готовая вещь.
    Теперь подбор запускается и в обратную сторону — когда вещь легла на полку.

    Правила:
      * берём только заказы, к которым ЕЩЁ НЕ ПРИСТУПИЛИ (sewing_status='Новый'):
        если закройщик уже взял заказ в раскрой, вещь со склада ему не подсунуть;
      * одна вещь — один заказ (reserved_order_id), двойного резерва не бывает;
      * OZON и WB подбираются поштучно, а заказ Яндекса — только целиком (см. ниже);
      * FIFO: сначала уходят вещи, дольше всех лежащие на полке.

    Возвращает список подобранных пар для журнала и уведомления кладовщику.
    """
    matched = []

    # Свободные вещи на полке: не зарезервированы, лежат в наличии.
    where_gw = "gw.status = 'in_stock' AND gw.reserved_order_id IS NULL"
    if gw_id:
        where_gw += f" AND gw.id = {int(gw_id)}"
    # FOR UPDATE OF gw SKIP LOCKED: вещь, которую параллельно резервирует другой процесс,
    # пропускаем — так одна вещь физически не может уйти в два заказа сразу.
    cur.execute(
        "SELECT gw.id, src.marketplace_item_id FROM goods_warehouse gw "
        "JOIN orders src ON src.id = gw.order_id "
        f"WHERE {where_gw} AND src.marketplace_item_id IS NOT NULL "
        "ORDER BY gw.received_at ASC "
        "FOR UPDATE OF gw SKIP LOCKED"
    )
    free_stock = cur.fetchall()
    if not free_stock:
        return matched

    # Складываем свободные вещи по товару справочника: ключ — marketplace_item_id.
    by_item = {}
    for row_gw_id, item_id in free_stock:
        by_item.setdefault(int(item_id), []).append(int(row_gw_id))

    item_ids_csv = ','.join(str(i) for i in by_item)

    # --- 1. Яндекс: заказ покупателя закрывается ТОЛЬКО целиком -------------------
    # У Яндекса на весь заказ один ярлык, вещи едут вместе. Закрыть часть заказа со
    # склада нельзя: половина уедет, половина будет шиться, а ярлык один. Поэтому
    # берём связку только если на складе есть ВСЕ её вещи; иначе не трогаем склад —
    # заказ шьётся целиком, а вещи остаются свободны для других заказов.
    cur.execute(
        "SELECT group_key FROM orders "
        "WHERE marketplace = 'Yandex' AND group_key IS NOT NULL "
        f"AND sewing_status = '{NOT_STARTED_SEWING}' AND fulfilled_from_stock_id IS NULL "
        "AND COALESCE(status, '') <> 'Отменён' "
        "GROUP BY group_key ORDER BY min(created_at) ASC"
    )
    group_keys = [r[0] for r in cur.fetchall()]

    for gkey in group_keys:
        # SKIP LOCKED: строки, которые прямо сейчас забирает закройщик, не попадут в выборку.
        # Тогда связка окажется неполной и мы её просто пропустим — работу из цеха не отбираем.
        cur.execute(
            "SELECT id, marketplace_item_id FROM orders "
            "WHERE group_key = %s AND fulfilled_from_stock_id IS NULL "
            f"AND sewing_status = '{NOT_STARTED_SEWING}' "
            "AND COALESCE(status, '') <> 'Отменён' ORDER BY group_position, id "
            "FOR UPDATE SKIP LOCKED",
            (gkey,),
        )
        units = cur.fetchall()
        if not units:
            continue

        # Все вещи связки должны быть доступны: если часть заблокирована цехом или уже
        # закрыта, размер выборки не совпадёт с реальным размером заказа — не трогаем.
        cur.execute(
            "SELECT count(*) FROM orders WHERE group_key = %s "
            "AND COALESCE(status, '') <> 'Отменён'",
            (gkey,),
        )
        if len(units) != int(cur.fetchone()[0]):
            continue
        # Вся связка должна быть ещё не начата: если хоть одну вещь уже кроят, заказ
        # доделывает цех целиком.
        cur.execute(
            "SELECT count(*) FROM orders WHERE group_key = %s "
            f"AND sewing_status <> '{NOT_STARTED_SEWING}' AND COALESCE(status, '') <> 'Отменён'",
            (gkey,),
        )
        if int(cur.fetchone()[0]) > 0:
            continue

        # Хватит ли склада на ВСЮ связку: считаем потребность по каждому товару.
        need = {}
        for _, unit_item in units:
            if not unit_item:
                need = None
                break
            need[int(unit_item)] = need.get(int(unit_item), 0) + 1
        if not need:
            continue
        if any(len(by_item.get(k, [])) < n for k, n in need.items()):
            continue  # склад не покрывает заказ целиком — шьём всё, склад не трогаем

        for unit_id, unit_item in units:
            pick_id = by_item[int(unit_item)].pop(0)
            cur.execute(
                "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() WHERE id = %s",
                (int(unit_id), pick_id),
            )
            cur.execute(
                "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' "
                "WHERE id = %s",
                (pick_id, int(unit_id)),
            )
            matched.append({'gwId': pick_id, 'orderId': int(unit_id), 'groupKey': gkey})

    # --- 2. OZON и WB: вещи штучные, подбираем по одной ---------------------------
    if item_ids_csv:
        # SKIP LOCKED: заказы, которые прямо сейчас забирает закройщик, пропускаем —
        # вещь со склада под них подберётся в следующий раз, если они вернутся в очередь.
        cur.execute(
            "SELECT id, marketplace_item_id FROM orders "
            "WHERE marketplace <> 'Yandex' AND group_key IS NULL "
            f"AND sewing_status = '{NOT_STARTED_SEWING}' AND fulfilled_from_stock_id IS NULL "
            "AND COALESCE(status, '') <> 'Отменён' "
            f"AND marketplace_item_id IN ({item_ids_csv}) "
            "ORDER BY (order_type = 'FBS') DESC, created_at ASC, id ASC "
            "FOR UPDATE SKIP LOCKED"
        )
        for order_id, item_id in cur.fetchall():
            pool = by_item.get(int(item_id))
            if not pool:
                continue
            pick_id = pool.pop(0)
            cur.execute(
                "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() WHERE id = %s",
                (int(order_id), pick_id),
            )
            cur.execute(
                "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' "
                "WHERE id = %s",
                (pick_id, int(order_id)),
            )
            matched.append({'gwId': pick_id, 'orderId': int(order_id), 'groupKey': None})

    return matched


def next_storage_barcode(cur) -> str:
    """Генерирует следующий штрихкод хранения вида GW-000001 (по максимальному текущему)."""
    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE storage_barcode LIKE 'GW-%'")
    max_seq = 0
    for (bc,) in cur.fetchall():
        suffix = bc.split('-', 1)[1] if '-' in bc else ''
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return f"GW-{max_seq + 1:06d}"


def handler(event: dict, context) -> dict:
    """Склад готового товара: изделия, сшитые и упакованные (статус заказа "Готовые"),
    попадают на склад товара на конкретную полку под уникальным штрихкодом хранения
    (storage_barcode), откуда далее уходят в поставку на маркетплейс.

    Статусы (status):
      - awaiting_shelf — отстикерован, ждёт, пока кладовщик отсканирует его на полку
      - in_stock  — на хранении (лежит на полке, ничего с ним не происходит)
      - picking   — на сборке (кладовщик отобрал его как нужный для будущей поставки FBS,
                     ещё не привязан к конкретной поставке)
      - reserved  — зарезервирован в конкретной поставке (marketplace_supply_items)
      - shipped   — отгружен на маркетплейс
      - lost      — утерян (с указанием причины), выбывает из активных статусов

    GET  /                          - список товаров (можно ?status=in_stock и т.д.)
        доп. фильтры: ?material=Вуаль, ?width=200, ?height=250, ?shelf_id=1
    GET  /?barcode=GW-000001         - найти товар по штрихкоду хранения (для сканера подбора
                                        и сканирования в поставку)
    POST /  { action: 'admin_receive', marketplaceItemId, shelfId? }
        - ручной приём администратором: вещь без заказа с маркетплейса (излишек производства,
          найденный товар). Под неё создаётся служебный заказ WH-00001 и запись склада с
          receive_reason='admin' — в списке видно, что товар принял админ вручную
    POST /  { action: 'place_on_shelf', barcode, shelfId }
        - кладовщик у себя на компьютере сканирует стикер хранения вещи, отменённой клиентом
          (статус awaiting_shelf), и кладёт её на конкретную полку → in_stock
    GET  /?pending_shelf=1
        - список отменённых вещей, отстикерованных упаковщиком, но ещё не положенных на полку
          (виджет на дашборде кладовщика)
    POST /  { action: 'receive_return', orderNumber }
        - приём возврата с маркетплейса по номеру заказа (ручной ввод, до появления API).
          Полка НЕ выбирается: вещь встаёт в статус awaiting_shelf и попадает на полку только
          сканированием стикера хранения (place_on_shelf) — так товар не окажется «не на месте».
          Если заказ уже был на складе, старый storage_barcode сохраняется
    POST /  { action: 'move_shelf_by_barcode', barcode, shelfId }
        - то же самое, но по штрихкоду хранения (для диалога "Смена полки" со сканером)
    POST /  { action: 'return_to_workshop', id }
        - возвращает товар в цех (например, брак при выходном контроле), статус заказа
          сбрасывается на "В работе", запись удаляется со склада
    POST /  { action: 'start_picking', barcode }
        - сканер подбора: находит товар по storage_barcode (должен быть in_stock),
          переводит в статус picking — отмечает "то, что нужно для будущей поставки FBS"
    POST /  { action: 'cancel_picking', id }
        - отмена подбора: возвращает товар из picking обратно в in_stock
    POST /  { action: 'mark_lost', id, reason }
        - отмечает товар утерянным (с любого активного статуса, кроме shipped/lost)

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над складом товара
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        params = event.get('queryStringParameters') or {}
        status = params.get('status')
        barcode = params.get('barcode')
        material = params.get('material')
        width = params.get('width')
        height = params.get('height')
        shelf_id_filter = params.get('shelf_id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Счётчик для кладовщика: сколько вещей на полках уже подобрано под заказы и
            # ждёт, чтобы он наклеил стикер отправления. По нему в меню горит значок.
            if params.get('pending_count'):
                cur.execute(
                    "SELECT count(*) FROM goods_warehouse "
                    "WHERE reserved_order_id IS NOT NULL AND status = 'in_stock' "
                    "AND shipping_labeled_at IS NULL"
                )
                pending = int(cur.fetchone()[0])
                cur.execute(
                    "SELECT count(*) FROM goods_warehouse WHERE status = 'awaiting_shelf'"
                )
                awaiting = int(cur.fetchone()[0])
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'pendingLabel': pending, 'awaitingShelf': awaiting}),
                }

            # Заказы, пришедшие на подбор: их ещё не начали шить и под них не нашли
            # готовую вещь на складе. Кладовщик смотрит список и решает, что можно
            # закрыть остатками, а что уйдёт в цех.
            if params.get('picking_orders'):
                # Реальная работа на сегодня: вещи, которые система уже подобрала под
                # заказы и которые лежат на полке в ожидании стикера отправления.
                # Кладовщик идёт с этим списком к стеллажу и собирает их.
                #
                # Просто «новые заказы» тут показывать нельзя: их сотни, но закрыть
                # складом можно лишь те, под которые реально лежит нужная вещь.
                cur.execute(
                    "SELECT gw.id, o.order_number, o.product, o.material, o.width, o.height, "
                    "       gw.matched_at, o.marketplace, gw.storage_barcode, sh.name "
                    "FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.reserved_order_id "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    "WHERE gw.status = 'in_stock' "
                    "  AND gw.reserved_order_id IS NOT NULL "
                    "  AND gw.shipping_labeled_at IS NULL "
                    "ORDER BY gw.matched_at ASC NULLS LAST, gw.id ASC"
                )
                orders_rows = cur.fetchall()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps([
                        {
                            'id': r[0],
                            'orderNumber': r[1],
                            'product': r[2],
                            'material': r[3],
                            'width': r[4],
                            'height': r[5],
                            'createdAt': r[6].isoformat() if r[6] else None,
                            'marketplace': r[7],
                            'storageBarcode': r[8],
                            'shelfName': r[9],
                        }
                        for r in orders_rows
                    ], ensure_ascii=False),
                }

            if barcode:
                barcode_esc = barcode.strip().replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.order_id, o.order_number, o.product, o.material, o.width, o.height, "
                    "gw.shelf_id, s.name, gw.status, gw.received_at, gw.shipped_at, gw.storage_barcode, "
                    "gw.lost_reason, gw.lost_at, gw.receive_reason "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                    f"WHERE gw.storage_barcode = '{barcode_esc}'"
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар со штрихкодом {barcode} не найден'})}
                item = {
                    'id': row[0], 'orderId': row[1], 'orderNumber': row[2], 'product': row[3],
                    'material': row[4], 'width': row[5], 'height': row[6], 'shelfId': row[7],
                    'shelfName': row[8], 'status': row[9], 'receivedAt': row[10].isoformat() + 'Z',
                    'shippedAt': (row[11].isoformat() + 'Z') if row[11] else None, 'storageBarcode': row[12],
                    'lostReason': row[13], 'lostAt': (row[14].isoformat() + 'Z') if row[14] else None,
                    'receiveReason': row[15] or 'manual',
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'item': item})}

            conditions = []
            if status:
                status_esc = status.replace("'", "''")
                conditions.append(f"gw.status = '{status_esc}'")
            if material:
                material_esc = material.replace("'", "''")
                conditions.append(f"o.material = '{material_esc}'")
            if width:
                conditions.append(f"o.width = {int(width)}")
            if height:
                conditions.append(f"o.height = {int(height)}")
            if shelf_id_filter:
                conditions.append(f"gw.shelf_id = {int(shelf_id_filter)}")
            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"SELECT gw.id, gw.order_id, o.order_number, o.product, o.material, o.width, o.height, "
                f"gw.shelf_id, s.name, gw.status, gw.received_at, gw.shipped_at, gw.storage_barcode, "
                f"gw.lost_reason, gw.lost_at, gw.receive_reason, gw.reserved_order_id, ro.order_number, "
                f"gw.shipping_labeled_at "
                f"FROM goods_warehouse gw "
                f"LEFT JOIN orders o ON o.id = gw.order_id "
                f"LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                f"LEFT JOIN shelves s ON s.id = gw.shelf_id "
                f"{where_clause} "
                f"ORDER BY gw.received_at DESC, gw.id DESC"
            )
            items = [
                {
                    'id': r[0],
                    'orderId': r[1],
                    'orderNumber': r[2],
                    'product': r[3],
                    'material': r[4],
                    'width': r[5],
                    'height': r[6],
                    'shelfId': r[7],
                    'shelfName': r[8],
                    'status': r[9],
                    'receivedAt': r[10].isoformat() + 'Z',
                    'shippedAt': (r[11].isoformat() + 'Z') if r[11] else None,
                    'storageBarcode': r[12],
                    'lostReason': r[13],
                    'lostAt': (r[14].isoformat() + 'Z') if r[14] else None,
                    'receiveReason': r[15] or 'manual',
                    'reservedOrderId': r[16],
                    'reservedOrderNumber': r[17],
                    'shippingLabeledAt': (r[18].isoformat() + 'Z') if r[18] else None,
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'items': items})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'admin_receive':
                # Ручной приём администратором: он находит товар в справочнике по названию
                # («Вуаль 300x250») и кладёт вещь на склад без заказа с маркетплейса — например,
                # излишек с производства или найденный на складе товар. Под такую вещь создаётся
                # служебный заказ (source='manual'), а запись помечается receive_reason='admin',
                # чтобы в списке было видно: это принял админ вручную.
                item_id = body_data.get('marketplaceItemId')
                shelf_id = body_data.get('shelfId')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите товар'})}

                cur.execute(
                    "SELECT name, material, width, height, barcode, ozon_sku FROM marketplace_items WHERE id = %s",
                    (int(item_id),),
                )
                item_row = cur.fetchone()
                if not item_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}
                item_name, item_material, item_width, item_height, item_barcode, item_ozon_sku = item_row
                product = (
                    f"{item_material} {item_width}x{item_height}"
                    if item_material and item_width and item_height
                    else item_name
                )

                # Служебный номер заказа для складской вещи без заказа маркетплейса: WH-00001.
                cur.execute(
                    "SELECT order_number FROM orders WHERE order_number ~ '^WH-[0-9]+$' "
                    "ORDER BY (split_part(order_number, '-', 2))::int DESC LIMIT 1"
                )
                last_row = cur.fetchone()
                next_seq = (int(last_row[0].split('-')[1]) + 1) if last_row else 1
                order_number = f"WH-{next_seq:05d}"

                cur.execute(
                    "INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, "
                    "source, material, width, height, marketplace_item_id, product_barcode, product_ozon_sku, "
                    "sewing_status) "
                    "VALUES (%s, 'OZON', 'FBS', 'Новый', %s, 1, 'manual', %s, %s, %s, %s, %s, %s, 'Готовые') "
                    "RETURNING id",
                    (
                        order_number, product, item_material,
                        int(item_width) if item_width else None,
                        int(item_height) if item_height else None,
                        int(item_id), item_barcode or None, item_ozon_sku or None,
                    ),
                )
                new_order_id = cur.fetchone()[0]

                storage_barcode = next_storage_barcode(cur)
                # Полку админ может указать сразу (он принимает вещь осознанно), а если не
                # указал — вещь встанет в очередь «Ждёт полку» и ляжет на полку по скану.
                status_val = 'in_stock' if shelf_id not in (None, '') else 'awaiting_shelf'
                cur.execute(
                    "INSERT INTO goods_warehouse (order_id, shelf_id, status, storage_barcode, receive_reason) "
                    "VALUES (%s, %s, %s, %s, 'admin') RETURNING id",
                    (
                        new_order_id,
                        int(shelf_id) if shelf_id not in (None, '') else None,
                        status_val,
                        storage_barcode,
                    ),
                )
                new_gw_id = cur.fetchone()[0]
                log_action(
                    cur, actor_id, actor_name, 'admin_receive', 'goods_warehouse', new_gw_id,
                    f'Администратор принял товар вручную: {product} ({storage_barcode})',
                )
                # Принятая вещь сразу на полке — вдруг её уже ждёт незапущенный заказ.
                if status_val == 'in_stock':
                    try_match_orders_from_stock(cur, gw_id=new_gw_id)
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': new_gw_id,
                        'orderNumber': order_number,
                        'product': product,
                        'storageBarcode': storage_barcode,
                        'status': status_val,
                    }),
                }

            if action == 'ship_label':
                # Кладовщик забрал с полки вещь, зарезервированную под новый заказ FBS,
                # наклеил на неё стикер отправления маркетплейса и сканирует стикер хранения
                # у себя на компьютере. После этого вещь готова к сканированию в поставку FBS.
                scan_barcode = (body_data.get('barcode') or '').strip()
                if not scan_barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте стикер хранения'})}

                bc_esc = scan_barcode.replace("'", "''")
                # Маркетплейс и тип заказа нужны, чтобы сразу напечатать стикер:
                # у WB он приходит картинкой, у OZON и Яндекса — файлом PDF.
                cur.execute(
                    "SELECT gw.id, gw.status, gw.reserved_order_id, ro.order_number, o.product, "
                    "s.name, ro.marketplace, ro.order_type "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                    "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                    f"WHERE gw.storage_barcode = '{bc_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Стикер {scan_barcode} не найден'})}
                (gw_id, gw_status, reserved_order_id, target_number, gw_product,
                 shelf_name, mp, order_type) = gw_row
                if not reserved_order_id:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Эта вещь не подобрана ни под один заказ — стикеровать её рано'}),
                    }
                if gw_status not in ('in_stock', 'picking'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Вещь недоступна (статус: {gw_status})'}),
                    }

                # picking = отстикерована и готова к сканированию в поставку FBS.
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'picking', shipping_labeled_at = now() WHERE id = {gw_id}"
                )
                log_action(
                    cur, actor_id, actor_name, 'ship_label', 'goods_warehouse', gw_id,
                    f'Наклеил стикер отправления на заказ #{target_number} ({scan_barcode})',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': gw_id,
                        'orderId': reserved_order_id,
                        'orderNumber': target_number,
                        'product': gw_product,
                        'shelfName': shelf_name,
                        'storageBarcode': scan_barcode,
                        'marketplace': mp,
                        'orderType': order_type,
                    }, ensure_ascii=False),
                }

            if action == 'place_on_shelf':
                # Кладовщик забрал из цеха вещь, отменённую клиентом (упаковщик уже наклеил
                # на неё стикер хранения), и сканирует её у себя на компьютере, укладывая на
                # конкретную полку. Работает только со сканера — вручную полки не путаем.
                scan_barcode = (body_data.get('barcode') or '').strip()
                shelf_id = body_data.get('shelfId')
                if not scan_barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте стикер хранения'})}
                if shelf_id in (None, ''):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите полку'})}

                bc_esc = scan_barcode.replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.status, o.order_number, o.product FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    f"WHERE gw.storage_barcode = '{bc_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': f'Стикер {scan_barcode} не найден — это не стикер хранения'}),
                    }
                gw_id, gw_status, gw_order_number, gw_product = gw_row
                if gw_status == 'in_stock':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар {gw_order_number or ""} уже лежит на полке'}),
                    }
                if gw_status != 'awaiting_shelf':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар {gw_order_number or ""} не ожидает укладки (статус: {gw_status})'}),
                    }

                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'in_stock', shelf_id = {int(shelf_id)}, "
                    f"received_at = now() WHERE id = {gw_id}"
                )
                cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                shelf_row = cur.fetchone()
                shelf_name = shelf_row[0] if shelf_row else None
                log_action(
                    cur, actor_id, actor_name, 'place_on_shelf', 'goods_warehouse', gw_id,
                    f'Положил на полку {shelf_name or shelf_id}: заказ #{gw_order_number} ({scan_barcode})',
                )
                # Вещь появилась на полке — сразу проверяем, не ждёт ли её какой-то заказ.
                # Если ждёт, заказ закрывается складом и не уходит в пошив.
                auto_matched = try_match_orders_from_stock(cur, gw_id=gw_id)
                if auto_matched:
                    log_action(
                        cur, actor_id, actor_name, 'auto_match', 'goods_warehouse', gw_id,
                        f'Вещь подобрана под заказ автоматически ({len(auto_matched)})',
                    )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': gw_id, 'orderNumber': gw_order_number,
                        'product': gw_product, 'shelfName': shelf_name,
                        'autoMatched': len(auto_matched),
                    }),
                }

            if action == 'receive_return':
                order_number = (body_data.get('orderNumber') or '').strip()
                if not order_number:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите номер заказа'})}

                order_number_esc = order_number.replace("'", "''")
                cur.execute(f"SELECT id FROM orders WHERE order_number = '{order_number_esc}'")
                order_row = cur.fetchone()
                if not order_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Заказ {order_number} не найден'})}
                order_id = order_row[0]

                # Полку вручную не выбираем: возврат принимается в статусе awaiting_shelf, а на
                # конкретную полку вещь кладётся ТОЛЬКО сканированием стикера хранения
                # (action place_on_shelf) — так на складе не бывает вещей «не на своём месте».

                # Заказ уже был на складе (в т.ч. отгружен раньше) — просто возвращаем
                # существующую запись обратно в "На хранении" с новой полкой, без дублирования
                # (order_id в таблице UNIQUE).
                cur.execute("SELECT id, storage_barcode FROM goods_warehouse WHERE order_id = %s", (order_id,))
                existing = cur.fetchone()
                if existing:
                    gw_id, storage_barcode = existing
                    cur.execute(
                        f"UPDATE goods_warehouse SET status = 'awaiting_shelf', shelf_id = NULL, "
                        f"shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
                        f"reserved_order_id = NULL, shipping_labeled_at = NULL, "
                        f"receive_reason = 'return' WHERE id = {gw_id}"
                    )
                    log_action(cur, actor_id, actor_name, 'receive_return', 'goods_warehouse', gw_id, f'Принял возврат заказа #{order_number} повторно')
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': gw_id, 'storageBarcode': storage_barcode})}

                storage_barcode = next_storage_barcode(cur)
                cur.execute(
                    f"INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
                    f"VALUES ({order_id}, 'awaiting_shelf', '{storage_barcode}', 'return') RETURNING id"
                )
                new_id = cur.fetchone()[0]
                log_action(cur, actor_id, actor_name, 'receive_return', 'goods_warehouse', new_id, f'Принял возврат заказа #{order_number} ({storage_barcode})')
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id, 'storageBarcode': storage_barcode})}

            if action == 'move_shelf_by_barcode':
                barcode = (body_data.get('barcode') or '').strip()
                shelf_id = body_data.get('shelfId')
                if not barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте штрихкод хранения'})}
                barcode_esc = barcode.replace("'", "''")
                cur.execute(f"SELECT id FROM goods_warehouse WHERE storage_barcode = '{barcode_esc}'")
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар со штрихкодом {barcode} не найден'})}
                shelf_sql = int(shelf_id) if shelf_id not in (None, '') else 'NULL'
                cur.execute(f"UPDATE goods_warehouse SET shelf_id = {shelf_sql} WHERE id = {row[0]}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'id': row[0]})}

            if action == 'return_to_workshop':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT order_id, status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[1] not in ('in_stock', 'picking'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар уже зарезервирован/отгружен, вернуть нельзя'})}
                cur.execute(f"DELETE FROM goods_warehouse WHERE id = {int(item_id)}")
                cur.execute(f"UPDATE orders SET sewing_status = 'В работе' WHERE id = {int(row[0])}")
                log_action(cur, actor_id, actor_name, 'return_to_workshop', 'order', row[0], f'Вернул товар #{item_id} в цех')
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'rematch_stock':
                # Ручной перезапуск подбора по всему складу. Нужен как страховка: если
                # заказы пришли раньше, чем вещи легли на полку, или подбор пропустил
                # заказ из-за параллельной работы цеха — эта кнопка всё пересчитает.
                rematched = try_match_orders_from_stock(cur)
                if rematched:
                    log_action(
                        cur, actor_id, actor_name, 'rematch_stock', 'goods_warehouse', None,
                        f'Пересчёт подбора: закрыто складом заказов {len(rematched)}',
                    )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'matched': len(rematched)}),
                }

            if action == 'start_picking':
                barcode = (body_data.get('barcode') or '').strip()
                if not barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте штрихкод хранения'})}
                barcode_esc = barcode.replace("'", "''")
                cur.execute("SELECT id, status FROM goods_warehouse WHERE storage_barcode = %s", (barcode_esc,))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар со штрихкодом {barcode} не найден'})}
                gw_id, status = row
                if status != 'in_stock':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар не на хранении (статус: {status}), подобрать нельзя'}),
                    }
                cur.execute(f"UPDATE goods_warehouse SET status = 'picking' WHERE id = {gw_id}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'id': gw_id})}

            if action == 'cancel_picking':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[0] != 'picking':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар не в статусе "На сборке"'})}
                cur.execute(f"UPDATE goods_warehouse SET status = 'in_stock' WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'send_to_sewing':
                # Вещь с полки испорчена (порвана, пятно, брак) — отгружать её нельзя.
                # Списываем вещь со склада и возвращаем заказ в производство: его сошьют заново.
                # Если вещь была подобрана под заказ, заказ снимается с подбора и уходит в цех,
                # иначе он завис бы в ожидании стикеровки навсегда.
                item_id = body_data.get('id')
                reason = (body_data.get('reason') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                if not reason:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите причину — почему вещь нельзя отгрузить'}, ensure_ascii=False),
                    }

                cur.execute(
                    "SELECT gw.status, gw.reserved_order_id, gw.storage_barcode, o.order_number, o.product "
                    "FROM goods_warehouse gw LEFT JOIN orders o ON o.id = gw.order_id "
                    "WHERE gw.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                gw_status, reserved_order_id, gw_barcode, gw_order_number, gw_product = row
                if gw_status in ('shipped', 'lost'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Вещь уже отгружена или списана'}, ensure_ascii=False),
                    }
                if gw_status == 'reserved':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Вещь уже лежит в собранной поставке — сначала уберите её оттуда'},
                            ensure_ascii=False,
                        ),
                    }

                # Списываем испорченную вещь со склада.
                reason_esc = reason.replace("'", "''")
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'lost', reserved_order_id = NULL, "
                    f"matched_at = NULL, shipping_labeled_at = NULL, "
                    f"lost_reason = 'Брак, отправлен в пошив: {reason_esc}', lost_at = now() "
                    f"WHERE id = {int(item_id)}"
                )

                # Заказ покупателя, который закрывался этой вещью, возвращаем в производство.
                returned_order = None
                if reserved_order_id:
                    cur.execute(
                        "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый', "
                        "assigned_user_id = NULL, workshop_id = NULL WHERE id = %s "
                        "RETURNING order_number, group_key",
                        (int(reserved_order_id),),
                    )
                    ret = cur.fetchone()
                    returned_order = ret[0] if ret else None

                    # Заказ Яндекса едет одним ярлыком: если одна вещь связки испорчена,
                    # шить надо всю связку заново, иначе половина уедет, половина нет.
                    group_key = ret[1] if ret else None
                    if group_key:
                        cur.execute(
                            "SELECT gw.id FROM goods_warehouse gw "
                            "JOIN orders o ON o.id = gw.reserved_order_id "
                            "WHERE o.group_key = %s AND gw.status = 'in_stock'",
                            (group_key,),
                        )
                        sibling_ids = [r[0] for r in cur.fetchall()]
                        for sib in sibling_ids:
                            # Соседние вещи не испорчены — просто возвращаем их на полку
                            # свободными, они пригодятся другим заказам.
                            cur.execute(
                                "UPDATE goods_warehouse SET reserved_order_id = NULL, "
                                "matched_at = NULL, shipping_labeled_at = NULL WHERE id = %s",
                                (sib,),
                            )
                        cur.execute(
                            "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый', "
                            "assigned_user_id = NULL, workshop_id = NULL "
                            "WHERE group_key = %s AND COALESCE(status, '') <> 'Отменён'",
                            (group_key,),
                        )

                log_action(
                    cur, actor_id, actor_name, 'send_to_sewing', 'goods_warehouse', item_id,
                    f'Вещь {gw_barcode} ({gw_product or gw_order_number}) списана как брак и '
                    f'отправлена в пошив: {reason}'
                    + (f'. Заказ {returned_order} вернулся в производство' if returned_order else ''),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps(
                        {'success': True, 'returnedOrder': returned_order},
                        ensure_ascii=False,
                    ),
                }

            if action == 'delete_goods':
                # Удаление записи со склада. Доступно ТОЛЬКО администратору и только для
                # вещей на хранении: в остальных состояниях вещь в работе (едет в поставку,
                # ждёт разбора), и удаление порвало бы связь с заказом.
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                if not is_admin(cur, actor_id):
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Удалять товар со склада может только администратор'}, ensure_ascii=False),
                    }
                cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[0] != 'in_stock':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Удалить можно только товар на хранении'}, ensure_ascii=False),
                    }
                cur.execute(
                    "SELECT 1 FROM marketplace_supply_items WHERE goods_warehouse_id = %s LIMIT 1",
                    (int(item_id),),
                )
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Товар добавлен в поставку — сначала уберите его оттуда'}, ensure_ascii=False),
                    }
                log_action(cur, actor_id, actor_name, 'delete_goods', 'goods_warehouse', item_id,
                           f'Удалил товар #{item_id} со склада')
                cur.execute("DELETE FROM goods_warehouse WHERE id = %s", (int(item_id),))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'mark_lost':
                item_id = body_data.get('id')
                reason = (body_data.get('reason') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[0] in ('shipped', 'lost'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар уже отгружен или помечен утерянным'})}
                reason_esc = reason.replace("'", "''")
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'lost', lost_reason = '{reason_esc}', lost_at = now() "
                    f"WHERE id = {int(item_id)}"
                )
                log_action(cur, actor_id, actor_name, 'mark_lost', 'goods_warehouse', item_id, f'Отметил товар #{item_id} утерянным: {reason}')
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}