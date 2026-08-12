import json
import os

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

# Сколько сообщений отдаём при первом открытии чата. Вся история цеху не нужна:
# люди читают последние вопросы смены, а не переписку месячной давности.
PAGE_SIZE = 50

# Ограничение длины сообщения. Чат рабочий: длинные простыни здесь не пишут, а без
# ограничения одно сообщение могло бы раздуть ленту у всех на планшетах.
MAX_TEXT = 2000


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False),
    }


def _row_to_message(r):
    return {
        'id': r[0],
        'userId': r[1],
        'userName': r[2],
        'text': r[3],
        'createdAt': r[4].isoformat() + 'Z',
    }


def handler(event: dict, context) -> dict:
    """Общий чат сотрудников: одна лента на всю компанию.

    GET  /                    - последние сообщения (свежие внизу)
    GET  /?since=123          - только сообщения новее id=123. Этим запросом лента
                                обновляется в реальном времени: клиент опрашивает
                                часто, а ответ почти всегда пустой и очень дешёвый.
    GET  /?before=123         - более старые сообщения (подгрузка истории вверх)
    POST /  { action: 'send', userId, userName, text }  - отправить сообщение
    POST /  { action: 'hide', id, actorId }             - скрыть сообщение
                                (автор своё, администратор любое)
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    dsn = os.environ.get('DATABASE_URL')
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            since = params.get('since')
            before = params.get('before')

            if since:
                # Горячий запрос: его шлёт каждый открытый чат каждые несколько секунд.
                # Условие по id попадает в индекс, и при отсутствии новых сообщений
                # запрос не читает ни одной строки.
                cur.execute(
                    "SELECT id, user_id, user_name, text, created_at FROM chat_messages "
                    "WHERE hidden_at IS NULL AND id > %s ORDER BY id ASC LIMIT 200",
                    (int(since),),
                )
                messages = [_row_to_message(r) for r in cur.fetchall()]
                return _resp(200, {'messages': messages})

            if before:
                cur.execute(
                    "SELECT id, user_id, user_name, text, created_at FROM chat_messages "
                    "WHERE hidden_at IS NULL AND id < %s ORDER BY id DESC LIMIT %s",
                    (int(before), PAGE_SIZE),
                )
            else:
                cur.execute(
                    "SELECT id, user_id, user_name, text, created_at FROM chat_messages "
                    "WHERE hidden_at IS NULL ORDER BY id DESC LIMIT %s",
                    (PAGE_SIZE,),
                )
            # Читаем свежие сверху (так работает индекс), а отдаём в порядке беседы.
            rows = list(reversed(cur.fetchall()))
            messages = [_row_to_message(r) for r in rows]
            return _resp(200, {'messages': messages, 'hasMore': len(rows) == PAGE_SIZE})

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            action = body_data.get('action')

            if action == 'send':
                user_id = body_data.get('userId')
                user_name = (body_data.get('userName') or '').strip()
                text = (body_data.get('text') or '').strip()
                if not user_id or not text:
                    return _resp(400, {'error': 'Укажите userId и текст сообщения'})
                if len(text) > MAX_TEXT:
                    return _resp(400, {'error': f'Сообщение длиннее {MAX_TEXT} символов'})

                # Имя берём из профиля, а не с клиента: иначе можно было бы отправить
                # сообщение от чужого имени, подменив его в запросе.
                cur.execute("SELECT full_name FROM users WHERE id = %s", (int(user_id),))
                u_row = cur.fetchone()
                if not u_row:
                    return _resp(404, {'error': 'Сотрудник не найден'})
                author = u_row[0] or user_name or 'Сотрудник'

                cur.execute(
                    "INSERT INTO chat_messages (user_id, user_name, text) "
                    "VALUES (%s, %s, %s) RETURNING id, user_id, user_name, text, created_at",
                    (int(user_id), author, text),
                )
                message = _row_to_message(cur.fetchone())
                conn.commit()
                return _resp(200, {'success': True, 'message': message})

            if action == 'hide':
                message_id = body_data.get('id')
                actor_id = body_data.get('actorId')
                if not message_id or not actor_id:
                    return _resp(400, {'error': 'Укажите id и actorId'})

                cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                role_row = cur.fetchone()
                is_admin = bool(role_row) and role_row[0] == 'admin'

                # Своё сообщение убирает автор, любое — администратор. Проверка на
                # сервере: без неё правило обходится подменой запроса.
                if is_admin:
                    cur.execute(
                        "UPDATE chat_messages SET hidden_at = now(), hidden_by = %s "
                        "WHERE id = %s AND hidden_at IS NULL RETURNING id",
                        (int(actor_id), int(message_id)),
                    )
                else:
                    cur.execute(
                        "UPDATE chat_messages SET hidden_at = now(), hidden_by = %s "
                        "WHERE id = %s AND user_id = %s AND hidden_at IS NULL RETURNING id",
                        (int(actor_id), int(message_id), int(actor_id)),
                    )
                updated = cur.fetchone()
                conn.commit()
                if not updated:
                    return _resp(403, {'error': 'Можно убрать только своё сообщение'})
                return _resp(200, {'success': True})

            return _resp(400, {'error': 'Неизвестное действие'})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()
