import json
import os

import psycopg2

# Внутренняя игровая валюта "Варики" (викторина/лототрон для производственных сотрудников).
# НЕ финансы — в зарплате/кассе не учитывается. Начисляются в backend/orders при отправке
# заказа на стикеровку. Здесь: GET баланс сотрудника / список игроков для админа;
# POST списание вариков админом (игра в лототрон).

# Порог, при котором сотруднику предлагается сыграть в лототрон (≈580 заказов при рандоме 1-12).
LOTOTRON_THRESHOLD = 3770

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

PRODUCTION_ROLES = ('sewer', 'cutter', 'packer')


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False),
    }


def handler(event: dict, context) -> dict:
    """Внутренняя игровая валюта "Варики".

    GET /?userId=N   - баланс вариков сотрудника (+порог лототрона)
    GET /?players=1  - список производственных сотрудников с их вариками (для админа)
    POST / { action: 'debit', actorId, userId, amount } - списание вариков (только админ)
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}

            if params.get('players'):
                cur.execute(
                    "SELECT id, full_name, role, COALESCE(variki, 0) FROM users "
                    "WHERE role IN %s AND is_active = true ORDER BY COALESCE(variki, 0) DESC, full_name",
                    (PRODUCTION_ROLES,),
                )
                players = [
                    {'id': r[0], 'fullName': r[1], 'role': r[2], 'variki': r[3],
                     'canPlay': r[3] >= LOTOTRON_THRESHOLD}
                    for r in cur.fetchall()
                ]
                return _resp(200, {'players': players, 'threshold': LOTOTRON_THRESHOLD})

            user_id = params.get('userId')
            if not user_id:
                return _resp(400, {'error': 'Укажите userId'})
            cur.execute("SELECT COALESCE(variki, 0) FROM users WHERE id = %s", (int(user_id),))
            row = cur.fetchone()
            variki = row[0] if row else 0
            return _resp(200, {
                'variki': variki,
                'threshold': LOTOTRON_THRESHOLD,
                'canPlay': variki >= LOTOTRON_THRESHOLD,
            })

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            action = body_data.get('action')

            if action == 'debit':
                # Списывать варики (игра в лототрон) может только администратор.
                actor_id = body_data.get('actorId')
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    ar = cur.fetchone()
                    actor_role = ar[0] if ar else None
                if actor_role != 'admin':
                    return _resp(403, {'error': 'Списывать варики может только администратор'})

                user_id = body_data.get('userId')
                amount = body_data.get('amount')
                try:
                    amount = int(amount)
                except (TypeError, ValueError):
                    return _resp(400, {'error': 'Укажите количество вариков'})
                if not user_id or amount <= 0:
                    return _resp(400, {'error': 'Укажите игрока и количество вариков'})

                cur.execute("SELECT COALESCE(variki, 0) FROM users WHERE id = %s", (int(user_id),))
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Игрок не найден'})
                if row[0] < amount:
                    return _resp(409, {'error': f'У игрока только {row[0]} вариков'})

                cur.execute(
                    "UPDATE users SET variki = COALESCE(variki, 0) - %s WHERE id = %s RETURNING variki",
                    (amount, int(user_id)),
                )
                new_balance = cur.fetchone()[0]
                conn.commit()
                return _resp(200, {'variki': new_balance})

            return _resp(400, {'error': 'Неизвестное действие'})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()
