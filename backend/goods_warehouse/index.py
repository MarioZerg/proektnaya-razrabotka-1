import json
import os

import psycopg2


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

            if action == 'ship_label':
                # Кладовщик забрал с полки вещь, зарезервированную под новый заказ FBS,
                # наклеил на неё стикер отправления маркетплейса и сканирует стикер хранения
                # у себя на компьютере. После этого вещь готова к сканированию в поставку FBS.
                scan_barcode = (body_data.get('barcode') or '').strip()
                if not scan_barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте стикер хранения'})}

                bc_esc = scan_barcode.replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.status, gw.reserved_order_id, ro.order_number, o.product, s.name "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                    "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                    f"WHERE gw.storage_barcode = '{bc_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Стикер {scan_barcode} не найден'})}
                gw_id, gw_status, reserved_order_id, target_number, gw_product, shelf_name = gw_row
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
                    }),
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
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': gw_id, 'orderNumber': gw_order_number,
                        'product': gw_product, 'shelfName': shelf_name,
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