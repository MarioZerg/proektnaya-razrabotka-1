import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Склад готового товара: изделия, сшитые и упакованные (статус заказа "Готовые"),
    попадают на склад товара на конкретную полку, откуда далее уходят в поставку
    на маркетплейс.

    GET  /                          - список товаров на складе (можно ?status=in_stock)
    POST /  { action: 'receive', orderId, shelfId? }
        - принимает готовый заказ на склад товара (заказ должен быть в статусе "Готовые")
    POST /  { action: 'move_shelf', id, shelfId }
        - перемещает товар на другую полку
    POST /  { action: 'return_to_workshop', id }
        - возвращает товар в цех (например, брак при выходном контроле), статус заказа сбрасывается на "В работе"

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

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            conditions = []
            if status:
                status_esc = status.replace("'", "''")
                conditions.append(f"gw.status = '{status_esc}'")
            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"SELECT gw.id, gw.order_id, o.order_number, o.product, o.material, o.width, o.height, "
                f"gw.shelf_id, s.name, gw.status, gw.received_at, gw.shipped_at "
                f"FROM goods_warehouse gw "
                f"LEFT JOIN orders o ON o.id = gw.order_id "
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
                    'receivedAt': r[10].isoformat(),
                    'shippedAt': r[11].isoformat() if r[11] else None,
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'items': items})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'receive':
                order_id = body_data.get('orderId')
                shelf_id = body_data.get('shelfId')
                if not order_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите заказ'})}

                cur.execute("SELECT sewing_status FROM orders WHERE id = %s", (int(order_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                if row[0] != 'Готовые':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Заказ должен быть в статусе "Готовые" (сейчас: {row[0]})'}),
                    }

                cur.execute("SELECT id FROM goods_warehouse WHERE order_id = %s", (int(order_id),))
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Этот заказ уже принят на склад товара'})}

                shelf_sql = int(shelf_id) if shelf_id not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO goods_warehouse (order_id, shelf_id, status) "
                    f"VALUES ({int(order_id)}, {shelf_sql}, 'in_stock') RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'move_shelf':
                item_id = body_data.get('id')
                shelf_id = body_data.get('shelfId')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                shelf_sql = int(shelf_id) if shelf_id not in (None, '') else 'NULL'
                cur.execute(f"UPDATE goods_warehouse SET shelf_id = {shelf_sql} WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'return_to_workshop':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT order_id, status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[1] != 'in_stock':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар уже отгружен, вернуть нельзя'})}
                cur.execute(f"DELETE FROM goods_warehouse WHERE id = {int(item_id)}")
                cur.execute(f"UPDATE orders SET sewing_status = 'В работе' WHERE id = {int(row[0])}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
