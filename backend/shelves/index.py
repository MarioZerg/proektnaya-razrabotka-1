import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Справочник полок на складе готового товара.

    GET  /                  - список полок
    POST /  { action: 'create', name }
    POST /  { action: 'delete', id }
        - запрещено, если на полке есть товар

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над полками
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
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT s.id, s.name, s.created_at, "
                "(SELECT COUNT(*) FROM goods_warehouse gw WHERE gw.shelf_id = s.id AND gw.status = 'in_stock') "
                "FROM shelves s ORDER BY s.name"
            )
            shelves = [
                {'id': r[0], 'name': r[1], 'createdAt': r[2].isoformat() + 'Z', 'itemsCount': r[3]}
                for r in cur.fetchall()
            ]
        finally:
            conn.close()
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shelves': shelves})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Создавать и удалять полки может только администратор. Роль проверяем по actorId
            # (в будущем кладовщик сможет только раскладывать товар по полкам, но не менять их).
            if action in ('create', 'delete'):
                actor_id = body_data.get('actorId')
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    row = cur.fetchone()
                    actor_role = row[0] if row else None
                if actor_role != 'admin':
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Полки может изменять только администратор'})}

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название полки'})}
                name_esc = name.replace("'", "''")
                cur.execute(f"SELECT id FROM shelves WHERE name = '{name_esc}'")
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Полка с таким названием уже существует'})}
                cur.execute(f"INSERT INTO shelves (name) VALUES ('{name_esc}') RETURNING id")
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "SELECT COUNT(*) FROM goods_warehouse WHERE shelf_id = %s AND status = 'in_stock'",
                    (int(item_id),),
                )
                if cur.fetchone()[0] > 0:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'На полке есть товар — сначала переместите его'})}
                cur.execute(f"DELETE FROM shelves WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}