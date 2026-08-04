import json
import os

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False),
    }


def handler(event: dict, context) -> dict:
    """Справочник вешалок. Админ заводит номера вешалок; закройщик при раскрое выбирает
    вешалку из этого списка.

    GET  /                         - список вешалок
    POST /  { action: 'create', number }  - добавить вешалку
    POST /  { action: 'delete', id }      - удалить вешалку
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            cur.execute("SELECT id, number FROM hangers ORDER BY number")
            hangers = [{'id': r[0], 'number': r[1]} for r in cur.fetchall()]
            return _resp(200, {'hangers': hangers})

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            action = body_data.get('action')

            if action == 'create':
                number = body_data.get('number')
                try:
                    number = int(number)
                except (TypeError, ValueError):
                    return _resp(400, {'error': 'Укажите номер вешалки'})
                if number <= 0:
                    return _resp(400, {'error': 'Номер вешалки должен быть больше нуля'})
                cur.execute("SELECT id FROM hangers WHERE number = %s", (number,))
                if cur.fetchone():
                    return _resp(409, {'error': f'Вешалка № {number} уже есть'})
                cur.execute("INSERT INTO hangers (number) VALUES (%s) RETURNING id", (number,))
                new_id = cur.fetchone()[0]
                conn.commit()
                return _resp(200, {'id': new_id, 'number': number})

            if action == 'delete':
                hanger_id = body_data.get('id')
                if not hanger_id:
                    return _resp(400, {'error': 'Укажите id'})
                cur.execute("DELETE FROM hangers WHERE id = %s", (int(hanger_id),))
                conn.commit()
                return _resp(200, {'ok': True})

            return _resp(400, {'error': 'Неизвестное действие'})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()
