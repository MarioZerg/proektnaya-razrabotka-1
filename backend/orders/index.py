import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет заказами с маркетплейсов (OZON, WB, Яндекс.Маркет).

    Правила:
      - Один заказ = одна позиция товара, количество всегда равно 1 (без объединения
        нескольких единиц в одну строку и без дробления одного заказа на несколько).
      - Заказ попадает в систему двумя способами: через API маркетплейса или вручную кнопкой.
      - При ручном создании номер заказа проверяется на дубль: если такой номер уже
        есть в системе (в т.ч. пришедший ранее по API) — новый заказ не создаётся.

    GET  /                       - получить список заказов
    GET  /?id=1                  - получить детальную карточку заказа с расходом материалов
    POST /  { action: 'create_manual', orderNumber, marketplace, orderType, cluster?, product }
    POST /  { action: 'update_order', id, orderNumber?, marketplace?, orderType?, status?, product?,
              sewingStatus?, assignedUserId?, workshopId? }
    POST /  { action: 'take_stack', userId, workshopId, shiftNumber }
        - закройщик берёт стек заказов из статуса "Новый": количество берётся из настройки
          цеха max_quantity_orders_to_cutter (или глобальной system_settings, по умолчанию 20).
          Заказы назначаются на userId, переводятся в "На раскрое" и получают workshopId.
          Если у закройщика уже есть незавершённые заказы в "На раскрое" — отклоняется (409).
    POST /  { action: 'cut', id, rollId }
        - переводит заказ в статус "Раскроено". Тюль списывается с указанного закройщиком
          рулона rollId (должен быть в его цехе/смене), упаковка (этикетки, пакеты) списывается
          автоматически по FIFO со склада. Тесьма (Аксессуары) НЕ списывается на этом этапе —
          её позже указывает швея перед отправкой на стикеровку
    POST /  { action: 'take_order', userId }
        - швея получает в работу самый старый заказ из "Раскроено" (по времени раскроя, FIFO,
          без привязки к цеху). Атомарная операция (FOR UPDATE SKIP LOCKED) исключает дубли
          при одновременных нажатиях. Назначает заказ на userId, переводит в "В работе"
    POST /  { action: 'send_to_stickering', id, rollId }
        - швея указывает рулон тесьмы (должен быть в её цехе/смене), с которого списывается
          тесьма товара, и переводит заказ в статус "Стикеровка". Без указания рулона тесьмы
          перевод недоступен
    POST /  { action: 'delete_order', id }

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над заказами
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
        order_id = params.get('id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if order_id:
                cur.execute(
                    "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.status, o.cluster, o.product, "
                    "o.quantity, o.source, o.created_at, o.completed_at, o.material, o.width, o.height, "
                    "o.sewing_status, o.assigned_user_id, u.full_name, o.workshop_id, w.name "
                    "FROM orders o "
                    "LEFT JOIN users u ON u.id = o.assigned_user_id "
                    "LEFT JOIN workshops w ON w.id = o.workshop_id "
                    "WHERE o.id = %s",
                    (int(order_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}

                cur.execute(
                    "SELECT omu.id, omu.material_id, m.name, m.unit, omu.roll_id, r.barcode, omu.quantity, omu.created_at "
                    "FROM order_material_usage omu "
                    "LEFT JOIN materials m ON m.id = omu.material_id "
                    "LEFT JOIN rolls r ON r.id = omu.roll_id "
                    "WHERE omu.order_id = %s ORDER BY omu.id",
                    (int(order_id),),
                )
                materialUsage = [
                    {
                        'id': r[0],
                        'materialId': r[1],
                        'materialName': r[2],
                        'unit': r[3],
                        'rollId': r[4],
                        'rollBarcode': r[5],
                        'quantity': float(r[6]),
                        'createdAt': r[7].isoformat(),
                    }
                    for r in cur.fetchall()
                ]

                detail = {
                    'id': row[0],
                    'orderNumber': row[1],
                    'marketplace': row[2],
                    'orderType': row[3],
                    'status': row[4],
                    'cluster': row[5],
                    'product': row[6],
                    'quantity': float(row[7]),
                    'source': row[8],
                    'createdAt': row[9].isoformat(),
                    'completedAt': row[10].isoformat() if row[10] else None,
                    'material': row[11],
                    'width': row[12],
                    'height': row[13],
                    'sewingStatus': row[14],
                    'assignedUserId': row[15],
                    'assignedUserName': row[16],
                    'workshopId': row[17],
                    'workshopName': row[18],
                    'materialUsage': materialUsage,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'order': detail})}

            cur.execute(
                "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.status, o.cluster, o.product, "
                "o.quantity, o.source, o.created_at, o.completed_at, o.material, o.width, o.height, "
                "o.sewing_status, o.assigned_user_id, u.full_name, o.workshop_id, w.name "
                "FROM orders o "
                "LEFT JOIN users u ON u.id = o.assigned_user_id "
                "LEFT JOIN workshops w ON w.id = o.workshop_id "
                "ORDER BY o.created_at DESC, o.id DESC"
            )
            orders = [
                {
                    'id': r[0],
                    'orderNumber': r[1],
                    'marketplace': r[2],
                    'orderType': r[3],
                    'status': r[4],
                    'cluster': r[5],
                    'product': r[6],
                    'quantity': float(r[7]),
                    'source': r[8],
                    'createdAt': r[9].isoformat(),
                    'completedAt': r[10].isoformat() if r[10] else None,
                    'material': r[11],
                    'width': r[12],
                    'height': r[13],
                    'sewingStatus': r[14],
                    'assignedUserId': r[15],
                    'assignedUserName': r[16],
                    'workshopId': r[17],
                    'workshopName': r[18],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'orders': orders})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'take_stack':
                user_id = body_data.get('userId')
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')

                if not user_id or not workshop_id:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите userId и workshopId'}),
                    }

                cur.execute(
                    "SELECT COUNT(*) FROM orders WHERE assigned_user_id = %s AND sewing_status = 'На раскрое'",
                    (int(user_id),),
                )
                unfinished = cur.fetchone()[0]
                if unfinished > 0:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'У вас есть {unfinished} нераскроенных заказов — сначала раскроите их'}
                        ),
                    }

                cur.execute(
                    "SELECT value FROM workshop_settings WHERE workshop_id = %s AND key = 'max_quantity_orders_to_cutter'",
                    (int(workshop_id),),
                )
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        "SELECT value FROM system_settings WHERE key = 'max_quantity_orders_to_cutter'"
                    )
                    row = cur.fetchone()
                stack_size = int(row[0]) if row and row[0] else 20

                cur.execute(
                    "SELECT id FROM orders WHERE sewing_status = 'Новый' "
                    "ORDER BY created_at ASC, id ASC LIMIT %s",
                    (stack_size,),
                )
                order_ids = [r[0] for r in cur.fetchall()]

                if not order_ids:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Нет новых заказов для взятия в работу'}),
                    }

                ids_csv = ','.join(str(i) for i in order_ids)
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'На раскрое', assigned_user_id = {int(user_id)}, "
                    f"workshop_id = {int(workshop_id)} WHERE id IN ({ids_csv})"
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'count': len(order_ids), 'orderIds': order_ids}),
                }

            if action == 'create_manual':
                order_number = (body_data.get('orderNumber') or '').strip()
                marketplace = (body_data.get('marketplace') or '').strip()
                order_type = (body_data.get('orderType') or 'FBO').strip()
                cluster = (body_data.get('cluster') or '').strip()
                product = (body_data.get('product') or '').strip()

                if not order_number or not marketplace or not product:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите номер заказа, маркетплейс и товар'}),
                    }

                order_number_esc = order_number.replace("'", "''")
                cur.execute(
                    f"SELECT id FROM orders WHERE order_number = '{order_number_esc}'"
                )
                existing = cur.fetchone()
                if existing:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'Заказ с номером {order_number} уже есть в системе — дубль не создан'}
                        ),
                    }

                marketplace_esc = marketplace.replace("'", "''")
                order_type_esc = order_type.replace("'", "''")
                cluster_esc = cluster.replace("'", "''")
                product_esc = product.replace("'", "''")

                cur.execute(
                    f"INSERT INTO orders (order_number, marketplace, order_type, status, cluster, product, quantity, source) "
                    f"VALUES ('{order_number_esc}', '{marketplace_esc}', '{order_type_esc}', 'Новый', "
                    f"'{cluster_esc}', '{product_esc}', 1, 'manual') "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update_order':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                if 'orderNumber' in body_data:
                    new_number = str(body_data['orderNumber']).strip()
                    new_number_esc = new_number.replace("'", "''")
                    cur.execute(
                        f"SELECT id FROM orders WHERE order_number = '{new_number_esc}' AND id != {int(item_id)}"
                    )
                    if cur.fetchone():
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({'error': f'Заказ с номером {new_number} уже есть в системе'}),
                        }

                fields = []
                if 'orderNumber' in body_data:
                    fields.append(f"order_number = '{str(body_data['orderNumber']).replace(chr(39), chr(39)*2)}'")
                if 'marketplace' in body_data:
                    fields.append(f"marketplace = '{str(body_data['marketplace']).replace(chr(39), chr(39)*2)}'")
                if 'orderType' in body_data:
                    fields.append(f"order_type = '{str(body_data['orderType']).replace(chr(39), chr(39)*2)}'")
                if 'status' in body_data:
                    status_val = str(body_data['status']).replace(chr(39), chr(39) * 2)
                    fields.append(f"status = '{status_val}'")
                    if body_data['status'] == 'Выполнен':
                        fields.append("completed_at = now()")
                if 'product' in body_data:
                    fields.append(f"product = '{str(body_data['product']).replace(chr(39), chr(39)*2)}'")
                if 'sewingStatus' in body_data:
                    sewing_status_val = str(body_data['sewingStatus']).replace(chr(39), chr(39) * 2)
                    fields.append(f"sewing_status = '{sewing_status_val}'")
                if 'assignedUserId' in body_data:
                    val = body_data['assignedUserId']
                    fields.append(f"assigned_user_id = {int(val) if val not in (None, '') else 'NULL'}")
                if 'workshopId' in body_data:
                    val = body_data['workshopId']
                    fields.append(f"workshop_id = {int(val) if val not in (None, '') else 'NULL'}")
                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE orders SET {', '.join(fields)} WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'cut':
                item_id = body_data.get('id')
                roll_id_chosen = body_data.get('rollId')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute(
                    "SELECT material, width, height, workshop_id FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                order_row = cur.fetchone()
                if not order_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                material, width, height, order_workshop_id = order_row

                cur.execute(
                    "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
                    (material, width, height),
                )
                item_row = cur.fetchone()
                if not item_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Не найден товар маркетплейса для этого материала/размера — расход материалов не определён'}),
                    }
                marketplace_item_id = item_row[0]

                cur.execute(
                    "SELECT material_id, quantity FROM marketplace_item_materials WHERE marketplace_item_id = %s",
                    (marketplace_item_id,),
                )
                needed = cur.fetchall()
                if not needed:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'У товара не заполнен расход материалов'}),
                    }

                cur.execute("SELECT id FROM material_types WHERE name = 'Тюль'")
                tul_type_row = cur.fetchone()
                tul_type_id = tul_type_row[0] if tul_type_row else None

                cur.execute("SELECT id FROM material_types WHERE name = 'Аксессуары'")
                acc_type_row = cur.fetchone()
                acc_type_id = acc_type_row[0] if acc_type_row else None

                fabric_material_id = None
                accessory_material_ids = set()
                for material_id, _qty in needed:
                    cur.execute("SELECT type_id FROM materials WHERE id = %s", (material_id,))
                    mt_row = cur.fetchone()
                    if not mt_row:
                        continue
                    if tul_type_id and mt_row[0] == tul_type_id and fabric_material_id is None:
                        fabric_material_id = material_id
                    elif acc_type_id and mt_row[0] == acc_type_id:
                        accessory_material_ids.add(material_id)

                if fabric_material_id and not roll_id_chosen:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Выберите рулон тюля для раскроя'}),
                    }

                shortages = []
                write_offs = []
                for material_id, qty_needed in needed:
                    qty_needed = float(qty_needed)

                    if material_id in accessory_material_ids:
                        # Тесьма списывается позже швеёй перед отправкой на стикеровку
                        continue

                    if fabric_material_id and material_id == fabric_material_id:
                        cur.execute(
                            "SELECT id, remaining_quantity, workshop_id FROM rolls WHERE id = %s "
                            "AND material_id = %s AND status = 'in_workshop'",
                            (int(roll_id_chosen), material_id),
                        )
                        roll_row = cur.fetchone()
                        if not roll_row:
                            return {
                                'statusCode': 404,
                                'headers': headers,
                                'body': json.dumps({'error': 'Выбранный рулон не найден или недоступен'}),
                            }
                        if order_workshop_id and roll_row[2] != order_workshop_id:
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': 'Рулон не принадлежит вашему цеху/смене'}),
                            }
                        roll_remaining = float(roll_row[1])
                        if roll_remaining < qty_needed:
                            cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
                            mat_name, mat_unit = cur.fetchone()
                            shortages.append(
                                f"{mat_name}: нужно {qty_needed} {mat_unit}, в рулоне осталось {roll_remaining} {mat_unit}"
                            )
                            continue
                        write_offs.append((roll_row[0], material_id, qty_needed))
                        continue

                    cur.execute(
                        "SELECT id, remaining_quantity FROM rolls "
                        "WHERE material_id = %s AND status IN ('in_storage', 'in_workshop') AND remaining_quantity > 0 "
                        "ORDER BY created_at ASC",
                        (material_id,),
                    )
                    available_rolls = cur.fetchall()
                    total_available = sum(float(r[1]) for r in available_rolls)
                    if total_available < qty_needed:
                        cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
                        mat_name, mat_unit = cur.fetchone()
                        shortages.append(
                            f"{mat_name}: нужно {qty_needed} {mat_unit}, доступно {total_available} {mat_unit}"
                        )
                        continue

                    remaining_to_take = qty_needed
                    for roll_id, roll_remaining in available_rolls:
                        if remaining_to_take <= 0:
                            break
                        take = min(float(roll_remaining), remaining_to_take)
                        write_offs.append((roll_id, material_id, take))
                        remaining_to_take -= take

                if shortages:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Недостаточно материалов на складе: ' + '; '.join(shortages)}),
                    }

                for roll_id, material_id, take in write_offs:
                    cur.execute(
                        "SELECT remaining_quantity FROM rolls WHERE id = %s",
                        (roll_id,),
                    )
                    roll_remaining = float(cur.fetchone()[0])
                    new_remaining = roll_remaining - take
                    new_status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
                    cur.execute(
                        f"UPDATE rolls SET remaining_quantity = {new_remaining}{new_status_sql} WHERE id = {roll_id}"
                    )
                    cur.execute(
                        f"INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
                        f"VALUES ({int(item_id)}, {material_id}, {roll_id}, {take})"
                    )

                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Раскроено', cut_at = now() WHERE id = {int(item_id)}"
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'take_order':
                user_id = body_data.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT id FROM orders WHERE sewing_status = 'Раскроено' "
                    "ORDER BY cut_at ASC NULLS LAST, id ASC "
                    "LIMIT 1 FOR UPDATE SKIP LOCKED"
                )
                row = cur.fetchone()
                if not row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Нет раскроенных заказов в очереди'}),
                    }
                order_id = row[0]

                cur.execute(
                    f"UPDATE orders SET sewing_status = 'В работе', assigned_user_id = {int(user_id)} "
                    f"WHERE id = {order_id}"
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'orderId': order_id})}

            if action == 'send_to_stickering':
                item_id = body_data.get('id')
                roll_id_chosen = body_data.get('rollId')
                if not item_id or not roll_id_chosen:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите id заказа и rollId рулона тесьмы'}),
                    }

                cur.execute(
                    "SELECT material, width, height, workshop_id, sewing_status FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                order_row = cur.fetchone()
                if not order_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                material, width, height, order_workshop_id, current_status = order_row
                if current_status == 'Стикеровка':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Заказ уже отправлен на стикеровку'}),
                    }

                cur.execute(
                    "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
                    (material, width, height),
                )
                item_row = cur.fetchone()
                if not item_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Не найден товар маркетплейса для этого материала/размера'}),
                    }
                marketplace_item_id = item_row[0]

                cur.execute("SELECT id FROM material_types WHERE name = 'Аксессуары'")
                acc_type_row = cur.fetchone()
                acc_type_id = acc_type_row[0] if acc_type_row else None

                cur.execute(
                    "SELECT material_id, quantity FROM marketplace_item_materials WHERE marketplace_item_id = %s",
                    (marketplace_item_id,),
                )
                needed = cur.fetchall()

                trim_material_id = None
                trim_qty_needed = None
                if acc_type_id:
                    for material_id, qty in needed:
                        cur.execute("SELECT type_id FROM materials WHERE id = %s", (material_id,))
                        mt_row = cur.fetchone()
                        if mt_row and mt_row[0] == acc_type_id:
                            trim_material_id = material_id
                            trim_qty_needed = float(qty)
                            break

                if not trim_material_id:
                    cur.execute(
                        f"UPDATE orders SET sewing_status = 'Стикеровка' WHERE id = {int(item_id)}"
                    )
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

                cur.execute(
                    "SELECT id, remaining_quantity, workshop_id FROM rolls WHERE id = %s "
                    "AND material_id = %s AND status = 'in_workshop'",
                    (int(roll_id_chosen), trim_material_id),
                )
                roll_row = cur.fetchone()
                if not roll_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Выбранный рулон тесьмы не найден или недоступен'}),
                    }
                if order_workshop_id and roll_row[2] != order_workshop_id:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Рулон не принадлежит вашему цеху/смене'}),
                    }
                roll_remaining = float(roll_row[1])
                if roll_remaining < trim_qty_needed:
                    cur.execute("SELECT name, unit FROM materials WHERE id = %s", (trim_material_id,))
                    mat_name, mat_unit = cur.fetchone()
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'{mat_name}: нужно {trim_qty_needed} {mat_unit}, в рулоне осталось {roll_remaining} {mat_unit}'}
                        ),
                    }

                new_remaining = roll_remaining - trim_qty_needed
                new_status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
                cur.execute(
                    f"UPDATE rolls SET remaining_quantity = {new_remaining}{new_status_sql} WHERE id = {roll_row[0]}"
                )
                cur.execute(
                    f"INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
                    f"VALUES ({int(item_id)}, {trim_material_id}, {roll_row[0]}, {trim_qty_needed})"
                )
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Стикеровка' WHERE id = {int(item_id)}"
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete_order':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(f"DELETE FROM orders WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}