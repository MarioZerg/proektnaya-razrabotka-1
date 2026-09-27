"""Журнал сбоев приложения: приём ошибок из браузера и чтение их админом.

ЗАЧЕМ ЭТО НУЖНО.

Раньше ошибка в браузере сотрудника нигде не сохранялась — она жила только в
консоли его планшета. Сотрудник говорил «не работает», и разобраться было нечем:
чужой сбой почти невозможно воспроизвести на другом устройстве.

Теперь каждый сбой приходит сюда и сохраняется: что упало, на какой странице, у
кого и в какой версии системы. Разбор начинается с факта, а не с догадок.

ПОЧЕМУ ПРИЁМ ОШИБОК БЕЗ ПАРОЛЯ.

Ошибка часто случается ДО входа в систему или ровно в тот момент, когда вход и
сломался. Требовать токен значило бы терять именно те сбои, которые важнее всего.
Поэтому запись открыта, но защищена по-другому:

  * одна ошибка занимает считаные килобайты — длинные поля обрезаются;
  * за раз принимается не больше пачки из 20 ошибок;
  * одинаковые ошибки с одного устройства не плодятся: повтор в течение минуты
    не записывается второй раз.

Без этих ограничений любой мог бы залить в базу мусор с одного адреса.

ЧТЕНИЕ — ТОЛЬКО АДМИН. В тексте ошибки может оказаться фрагмент рабочих данных,
поэтому список сбоев видит лишь администратор.
"""

import json
import os

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-Authorization, X-User-Id',
    'Access-Control-Max-Age': '86400',
}

HEADERS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

# Пределы на одну запись. Стек вызовов бывает огромным, а для поиска причины
# хватает первых строк: дальше идут внутренности библиотек.
MAX_MESSAGE = 2000
MAX_STACK = 8000
MAX_SHORT = 500

# Сколько ошибок принимаем одним запросом. Браузер иногда сыпет серией.
MAX_BATCH = 20

MAX_ROWS = 200


def _resp(status, body):
    return {'statusCode': status, 'headers': HEADERS, 'body': json.dumps(body, ensure_ascii=False)}


def _cut(value, limit):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


def _actor(cur, event):
    """Кто пришёл. Роль берём из базы по ключу сессии, а не из тела запроса."""
    headers = {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}
    token = (headers.get('x-auth-token') or headers.get('x-authorization') or '').strip()
    if token.lower().startswith('bearer '):
        token = token[7:].strip()
    if not token:
        return None, None, None
    cur.execute(
        "SELECT u.id, u.role, u.full_name FROM auth_sessions s "
        "JOIN users u ON u.id = s.user_id "
        "WHERE s.token = %s AND (s.expires_at IS NULL OR s.expires_at > now())",
        (token,),
    )
    row = cur.fetchone()
    if not row:
        return None, None, None
    return row[0], row[1], row[2]


def handler(event: dict, context) -> dict:
    """Журнал сбоев приложения.

    POST /  { errors: [...] }  - принять ошибки из браузера (без пароля)
    GET  /?limit=50            - список сбоев (только администратор)
    GET  /?summary=1           - сводка: какие ошибки повторяются чаще всего
    """
    method = event.get('httpMethod', 'POST')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            items = body_data.get('errors')
            if not isinstance(items, list):
                items = [body_data]
            items = items[:MAX_BATCH]

            user_id, user_role, user_name = _actor(cur, event)
            headers = {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}
            user_agent = _cut(headers.get('user-agent'), MAX_SHORT)

            saved = 0
            for it in items:
                if not isinstance(it, dict):
                    continue
                message = _cut(it.get('message'), MAX_MESSAGE)
                if not message:
                    continue
                page = _cut(it.get('page'), MAX_SHORT)

                # Один и тот же сбой в цикле перерисовки повторяется десятки раз
                # в секунду. Записываем его один раз в минуту: иначе журнал
                # забьётся копиями, и настоящие ошибки в нём утонут.
                cur.execute(
                    "SELECT 1 FROM app_errors "
                    "WHERE message = %s AND COALESCE(page, '') = COALESCE(%s, '') "
                    "  AND COALESCE(user_id, 0) = COALESCE(%s, 0) "
                    "  AND occurred_at > now() - interval '1 minute' LIMIT 1",
                    (message, page, user_id),
                )
                if cur.fetchone():
                    continue

                cur.execute(
                    "INSERT INTO app_errors (source, level, message, stack, page, "
                    "  user_id, user_name, user_role, user_agent, app_version) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        _cut(it.get('source'), 30) or 'frontend',
                        _cut(it.get('level'), 20) or 'error',
                        message,
                        _cut(it.get('stack'), MAX_STACK),
                        page,
                        user_id,
                        user_name,
                        user_role,
                        user_agent,
                        _cut(it.get('appVersion'), 100),
                    ),
                )
                saved += 1

            conn.commit()
            return _resp(200, {'saved': saved})

        if method != 'GET':
            return _resp(405, {'error': 'Method not allowed'})

        _, role, _ = _actor(cur, event)
        if role != 'admin':
            return _resp(403, {'error': 'Журнал сбоев доступен только администратору'})

        params = event.get('queryStringParameters') or {}

        if params.get('summary'):
            cur.execute(
                "SELECT message, count(*), max(occurred_at), count(DISTINCT user_id) "
                "FROM app_errors WHERE occurred_at > now() - interval '7 days' "
                "GROUP BY message ORDER BY count(*) DESC LIMIT 30"
            )
            return _resp(200, {'summary': [
                {
                    'message': r[0],
                    'count': int(r[1]),
                    'lastAt': r[2].isoformat() + 'Z' if r[2] else None,
                    'users': int(r[3] or 0),
                }
                for r in cur.fetchall()
            ]})

        try:
            limit = min(int(params.get('limit') or 50), MAX_ROWS)
        except (TypeError, ValueError):
            limit = 50

        where = []
        if (params.get('source') or '').strip():
            where.append(('source = %s', params['source'].strip()))
        if (params.get('search') or '').strip():
            where.append(('message ILIKE %s', f'%{params["search"].strip()}%'))
        clause = (' WHERE ' + ' AND '.join(w[0] for w in where)) if where else ''
        values = tuple(w[1] for w in where)

        cur.execute(
            "SELECT id, occurred_at, source, level, message, stack, page, "
            "  user_name, user_role, user_agent, app_version "
            f"FROM app_errors{clause} ORDER BY occurred_at DESC LIMIT {limit}",
            values,
        )
        return _resp(200, {'items': [
            {
                'id': r[0],
                'at': r[1].isoformat() + 'Z' if r[1] else None,
                'source': r[2],
                'level': r[3],
                'message': r[4],
                'stack': r[5],
                'page': r[6],
                'userName': r[7],
                'userRole': r[8],
                'userAgent': r[9],
                'appVersion': r[10],
            }
            for r in cur.fetchall()
        ]})
    finally:
        conn.close()
