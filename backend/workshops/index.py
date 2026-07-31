import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет цехами: список, создание, редактирование.

    GET  /                       - получить список цехов с числом смен и сотрудников
    POST /  { action: 'create', name, shiftsCount? }
    POST /  { action: 'update', id, name?, shiftsCount?, isActive? }
    POST /  { action: 'delete', id }

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над цехами
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
                "SELECT w.id, w.name, w.is_active, w.shifts_count, w.created_at, w.updated_at, "
                "(SELECT COUNT(*) FROM users u WHERE u.workshop = w.name) "
                "FROM workshops w ORDER BY w.id"
            )
            workshops = [
                {
                    'id': r[0],
                    'name': r[1],
                    'isActive': r[2],
                    'shiftsCount': r[3],
                    'createdAt': r[4].isoformat(),
                    'updatedAt': r[5].isoformat(),
                    'employeesCount': r[6],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'workshops': workshops})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                shifts_count = body_data.get('shiftsCount', 1)

                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название цеха'})}

                name_esc = name.replace("'", "''")
                cur.execute(f"SELECT id FROM workshops WHERE name = '{name_esc}'")
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Цех с названием {name} уже есть'}),
                    }

                cur.execute(
                    f"INSERT INTO workshops (name, shifts_count) VALUES ('{name_esc}', {int(shifts_count)}) RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update':
                workshop_id = body_data.get('id')
                if not workshop_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                fields = []
                if 'name' in body_data:
                    fields.append(f"name = '{str(body_data['name']).replace(chr(39), chr(39)*2)}'")
                if 'shiftsCount' in body_data:
                    fields.append(f"shifts_count = {int(body_data['shiftsCount'])}")
                if 'isActive' in body_data:
                    fields.append(f"is_active = {'true' if body_data['isActive'] else 'false'}")
                fields.append("updated_at = now()")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE workshops SET {', '.join(fields)} WHERE id = {int(workshop_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                workshop_id = body_data.get('id')
                if not workshop_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(f"DELETE FROM workshops WHERE id = {int(workshop_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
