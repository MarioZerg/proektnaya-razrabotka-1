import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Поставки готового товара на маркетплейс. Формируется из товаров, лежащих
    на складе готового товара (goods_warehouse, статус in_stock) — при отгрузке
    их статус переводится в shipped.

    GET  /                       - список поставок
    GET  /?id=1                  - детальная карточка поставки с товарами
    POST /  { action: 'create', marketplace, comment?, goodsWarehouseIds: [...] }
    POST /  { action: 'delete', id }

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/детальными данными/результатом операции
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
        supply_id = params.get('id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if supply_id:
                cur.execute(
                    "SELECT id, marketplace, status, comment, created_at, shipped_at "
                    "FROM marketplace_supplies WHERE id = %s",
                    (int(supply_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}

                cur.execute(
                    "SELECT msi.id, msi.goods_warehouse_id, o.order_number, o.product, o.material, o.width, o.height "
                    "FROM marketplace_supply_items msi "
                    "LEFT JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "WHERE msi.supply_id = %s ORDER BY msi.id",
                    (int(supply_id),),
                )
                items = [
                    {
                        'id': r[0],
                        'goodsWarehouseId': r[1],
                        'orderNumber': r[2],
                        'product': r[3],
                        'material': r[4],
                        'width': r[5],
                        'height': r[6],
                    }
                    for r in cur.fetchall()
                ]

                detail = {
                    'id': row[0],
                    'marketplace': row[1],
                    'status': row[2],
                    'comment': row[3],
                    'createdAt': row[4].isoformat(),
                    'shippedAt': row[5].isoformat() if row[5] else None,
                    'items': items,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'supply': detail})}

            cur.execute(
                "SELECT s.id, s.marketplace, s.status, s.comment, s.created_at, s.shipped_at, "
                "(SELECT COUNT(*) FROM marketplace_supply_items msi WHERE msi.supply_id = s.id) "
                "FROM marketplace_supplies s ORDER BY s.created_at DESC, s.id DESC"
            )
            supplies = [
                {
                    'id': r[0],
                    'marketplace': r[1],
                    'status': r[2],
                    'comment': r[3],
                    'createdAt': r[4].isoformat(),
                    'shippedAt': r[5].isoformat() if r[5] else None,
                    'itemsCount': r[6],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'supplies': supplies})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                marketplace = (body_data.get('marketplace') or '').strip()
                comment = (body_data.get('comment') or '').strip()
                goods_ids = body_data.get('goodsWarehouseIds') or []

                if not marketplace:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите маркетплейс'})}
                if not goods_ids:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите хотя бы один товар'})}

                for gid in goods_ids:
                    cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(gid),))
                    row = cur.fetchone()
                    if not row:
                        return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} не найден на складе'})}
                    if row[0] != 'in_stock':
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} уже отгружен'})}

                marketplace_esc = marketplace.replace("'", "''")
                comment_esc = comment.replace("'", "''")
                cur.execute(
                    f"INSERT INTO marketplace_supplies (marketplace, status, comment, shipped_at) "
                    f"VALUES ('{marketplace_esc}', 'Выполнена', '{comment_esc}', now()) RETURNING id"
                )
                supply_id = cur.fetchone()[0]

                for gid in goods_ids:
                    cur.execute(
                        f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id) "
                        f"VALUES ({supply_id}, {int(gid)})"
                    )
                    cur.execute(
                        f"UPDATE goods_warehouse SET status = 'shipped', shipped_at = now() WHERE id = {int(gid)}"
                    )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': supply_id})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("DELETE FROM marketplace_supply_items WHERE supply_id = %s", (int(item_id),))
                cur.execute("DELETE FROM marketplace_supplies WHERE id = %s", (int(item_id),))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
