import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет категориями и позициями инвентаризации материалов.

    GET  /?tab=Ткани          - получить категории и позиции для вкладки
    POST /                     - создать категорию { action: 'create_category', name, tab }
    POST /                     - создать позицию { action: 'create_item', category_id, name, quantity, rolls, status }
    POST /                     - обновить позицию { action: 'update_item', id, name, quantity, rolls, status }
    POST /                     - удалить категорию { action: 'delete_category', id }
    POST /                     - удалить позицию { action: 'delete_item', id }

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с данными категорий/позиций
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
        tab = params.get('tab')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            if tab:
                tab_escaped = tab.replace("'", "''")
                cur.execute(
                    f"SELECT id, name, tab, sort_order FROM inventory_categories "
                    f"WHERE tab = '{tab_escaped}' ORDER BY sort_order, id"
                )
            else:
                cur.execute(
                    "SELECT id, name, tab, sort_order FROM inventory_categories ORDER BY tab, sort_order, id"
                )
            categories = [
                {'id': r[0], 'name': r[1], 'tab': r[2], 'sortOrder': r[3]} for r in cur.fetchall()
            ]

            category_ids = [c['id'] for c in categories]
            items_by_category: dict = {cid: [] for cid in category_ids}
            if category_ids:
                ids_str = ','.join(str(i) for i in category_ids)
                cur.execute(
                    f"SELECT id, category_id, name, quantity, rolls, status, sort_order "
                    f"FROM inventory_items WHERE category_id IN ({ids_str}) ORDER BY sort_order, id"
                )
                for r in cur.fetchall():
                    items_by_category.setdefault(r[1], []).append(
                        {
                            'id': r[0],
                            'categoryId': r[1],
                            'name': r[2],
                            'quantity': r[3],
                            'rolls': r[4],
                            'status': r[5],
                            'sortOrder': r[6],
                        }
                    )

            for c in categories:
                c['items'] = items_by_category.get(c['id'], [])
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'categories': categories})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create_category':
                name = (body_data.get('name') or '').strip()
                tab = (body_data.get('tab') or '').strip()
                if not name or not tab:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите название и вкладку'}),
                    }
                name_esc = name.replace("'", "''")
                tab_esc = tab.replace("'", "''")
                cur.execute(
                    f"INSERT INTO inventory_categories (name, tab, sort_order) "
                    f"VALUES ('{name_esc}', '{tab_esc}', "
                    f"(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM inventory_categories WHERE tab = '{tab_esc}')) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'create_item':
                category_id = body_data.get('categoryId')
                name = (body_data.get('name') or '').strip()
                quantity = (body_data.get('quantity') or '0').strip()
                rolls = (body_data.get('rolls') or '0').strip()
                status = (body_data.get('status') or 'В наличии').strip()
                if not category_id or not name:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите категорию и название'}),
                    }
                name_esc = name.replace("'", "''")
                quantity_esc = quantity.replace("'", "''")
                rolls_esc = rolls.replace("'", "''")
                status_esc = status.replace("'", "''")
                cur.execute(
                    f"INSERT INTO inventory_items (category_id, name, quantity, rolls, status, sort_order) "
                    f"VALUES ({int(category_id)}, '{name_esc}', '{quantity_esc}', '{rolls_esc}', '{status_esc}', "
                    f"(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM inventory_items WHERE category_id = {int(category_id)})) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update_item':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                fields = []
                if 'name' in body_data:
                    fields.append(f"name = '{body_data['name'].replace(chr(39), chr(39)*2)}'")
                if 'quantity' in body_data:
                    fields.append(f"quantity = '{body_data['quantity'].replace(chr(39), chr(39)*2)}'")
                if 'rolls' in body_data:
                    fields.append(f"rolls = '{body_data['rolls'].replace(chr(39), chr(39)*2)}'")
                if 'status' in body_data:
                    fields.append(f"status = '{body_data['status'].replace(chr(39), chr(39)*2)}'")
                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}
                cur.execute(f"UPDATE inventory_items SET {', '.join(fields)} WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
