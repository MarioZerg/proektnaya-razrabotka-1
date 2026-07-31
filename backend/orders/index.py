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
    POST /  { action: 'cut', id }
        - переводит заказ в статус "Раскроено" и автоматически списывает материалы товара
          (по составу marketplace_items) с доступных рулонов (сначала более старые остатки)
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
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute(
                    "SELECT material, width, height FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                order_row = cur.fetchone()
                if not order_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                material, width, height = order_row

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

                shortages = []
                write_offs = []
                for material_id, qty_needed in needed:
                    qty_needed = float(qty_needed)
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
                    f"UPDATE orders SET sewing_status = 'Раскроено' WHERE id = {int(item_id)}"
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