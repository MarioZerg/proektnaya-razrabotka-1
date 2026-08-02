import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет справочником поставщиков.

    GET  /                       - получить список поставщиков
    POST /  { action: 'create', name, phone?, address?, comment? }
    POST /  { action: 'update', id, name?, phone?, address?, comment? }
    POST /  { action: 'delete', id }

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над поставщиками
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
                "SELECT id, name, phone, address, comment, created_at, updated_at "
                "FROM suppliers ORDER BY id"
            )
            suppliers = [
                {
                    'id': r[0],
                    'name': r[1],
                    'phone': r[2],
                    'address': r[3],
                    'comment': r[4],
                    'createdAt': r[5].isoformat() + 'Z',
                    'updatedAt': r[6].isoformat() + 'Z',
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'suppliers': suppliers})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                phone = (body_data.get('phone') or '').strip()
                address = (body_data.get('address') or '').strip()
                comment = (body_data.get('comment') or '').strip()

                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название поставщика'})}

                name_esc = name.replace("'", "''")
                phone_esc = phone.replace("'", "''")
                address_esc = address.replace("'", "''")
                comment_esc = comment.replace("'", "''")

                cur.execute(
                    f"INSERT INTO suppliers (name, phone, address, comment) "
                    f"VALUES ('{name_esc}', '{phone_esc}', '{address_esc}', '{comment_esc}') "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update':
                supplier_id = body_data.get('id')
                if not supplier_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                fields = []
                if 'name' in body_data:
                    fields.append(f"name = '{str(body_data['name']).replace(chr(39), chr(39)*2)}'")
                if 'phone' in body_data:
                    fields.append(f"phone = '{str(body_data['phone']).replace(chr(39), chr(39)*2)}'")
                if 'address' in body_data:
                    fields.append(f"address = '{str(body_data['address']).replace(chr(39), chr(39)*2)}'")
                if 'comment' in body_data:
                    fields.append(f"comment = '{str(body_data['comment']).replace(chr(39), chr(39)*2)}'")
                fields.append("updated_at = now()")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE suppliers SET {', '.join(fields)} WHERE id = {int(supplier_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                supplier_id = body_data.get('id')
                if not supplier_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(f"DELETE FROM suppliers WHERE id = {int(supplier_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}