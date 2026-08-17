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
    """Справочник вешалок. Админ заводит вешалки; закройщик при раскрое выбирает
    вешалку из этого списка.

    Вешалку можно назвать по-человечески («Синяя у окна»), а можно оставить просто
    номер. Номер при этом есть всегда: на него ссылаются заказы, поэтому если админ
    имя не указал — номер подбирается сам, следующий свободный.

    GET  /                                        - список вешалок
    POST /  { action: 'create', name, number }    - добавить вешалку
    POST /  { action: 'rename', id, name }        - переименовать
    POST /  { action: 'delete', id }              - удалить вешалку
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            cur.execute("SELECT id, number, COALESCE(name, '') FROM hangers ORDER BY number")
            hangers = [{'id': r[0], 'number': r[1], 'name': r[2]} for r in cur.fetchall()]
            return _resp(200, {'hangers': hangers})

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            action = body_data.get('action')

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                raw_number = body_data.get('number')
                # Номер указывать необязательно: обычно админ просто пишет название.
                # Но номер нужен внутри системы — на него ссылаются заказы, поэтому
                # берём следующий свободный.
                if raw_number in (None, ''):
                    if not name:
                        return _resp(400, {'error': 'Укажите название вешалки'})
                    cur.execute("SELECT COALESCE(MAX(number), 0) + 1 FROM hangers")
                    number = cur.fetchone()[0]
                else:
                    try:
                        number = int(raw_number)
                    except (TypeError, ValueError):
                        return _resp(400, {'error': 'Номер вешалки должен быть числом'})
                    if number <= 0:
                        return _resp(400, {'error': 'Номер вешалки должен быть больше нуля'})
                    cur.execute("SELECT id FROM hangers WHERE number = %s", (number,))
                    if cur.fetchone():
                        return _resp(409, {'error': f'Вешалка № {number} уже есть'})

                if name:
                    cur.execute("SELECT id FROM hangers WHERE lower(name) = lower(%s)", (name,))
                    if cur.fetchone():
                        return _resp(409, {'error': f'Вешалка «{name}» уже есть'})

                cur.execute(
                    "INSERT INTO hangers (number, name) VALUES (%s, %s) RETURNING id",
                    (number, name or None),
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return _resp(200, {'id': new_id, 'number': number, 'name': name})

            if action == 'rename':
                hanger_id = body_data.get('id')
                name = (body_data.get('name') or '').strip()
                if not hanger_id:
                    return _resp(400, {'error': 'Укажите id'})
                if name:
                    cur.execute(
                        "SELECT id FROM hangers WHERE lower(name) = lower(%s) AND id <> %s",
                        (name, int(hanger_id)),
                    )
                    if cur.fetchone():
                        return _resp(409, {'error': f'Вешалка «{name}» уже есть'})
                cur.execute(
                    "UPDATE hangers SET name = %s WHERE id = %s",
                    (name or None, int(hanger_id)),
                )
                conn.commit()
                return _resp(200, {'ok': True, 'name': name})

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
