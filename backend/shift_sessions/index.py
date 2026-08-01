import json
import os
from datetime import datetime, timedelta

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет открытием/закрытием смен сотрудников (shift_sessions).

    Виджет "Управление сменами" на главной: администратор видит всех сотрудников
    и может открыть/закрыть смену за них. Виджет "Моя смена" у самого сотрудника
    показывает время открытия и время, когда он сможет закрыть смену (по
    shift_from/shift_to из его профиля). Календарь смен строится по этой же таблице.

    GET  /                          - список сотрудников с текущим статусом смены
                                       (открыта/закрыта, время открытия, ожидаемое
                                       время закрытия по графику shift_from/shift_to)
    GET  /?calendar=1&month=2026-08 - календарь: по каждому дню месяца список
                                       сотрудников, открывавших смену в этот день
    POST /  { action: 'open', userId, workshopId?, shiftNumber? }
        - открывает смену сотруднику (создаёт запись с closed_at = NULL).
          Если у сотрудника уже есть открытая смена — отклоняется (409)
    POST /  { action: 'close', userId }
        - закрывает последнюю открытую смену сотрудника (closed_at = now())

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком сотрудников/статусом операции/календарём
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

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if params.get('calendar'):
                month = params.get('month')  # 'YYYY-MM'
                if not month:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите month=YYYY-MM'})}
                month_esc = month.replace("'", "''")
                cur.execute(
                    f"SELECT ss.opened_at::date, u.full_name, ss.shift_number "
                    f"FROM shift_sessions ss "
                    f"JOIN users u ON u.id = ss.user_id "
                    f"WHERE to_char(ss.opened_at, 'YYYY-MM') = '{month_esc}' "
                    f"ORDER BY ss.opened_at"
                )
                days: dict = {}
                for opened_date, full_name, shift_number in cur.fetchall():
                    key = opened_date.isoformat()
                    if key not in days:
                        days[key] = {'date': key, 'employees': [], 'activeShift': shift_number}
                    days[key]['employees'].append(full_name)
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'days': list(days.values())})}

            cur.execute(
                "SELECT id, full_name, role, shift_number, shift_from, shift_to FROM users "
                "WHERE is_active = true ORDER BY full_name"
            )
            employee_rows = cur.fetchall()

            cur.execute(
                "SELECT DISTINCT ON (user_id) user_id, opened_at, closed_at FROM shift_sessions "
                "ORDER BY user_id, opened_at DESC"
            )
            latest_by_user = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

            employees = []
            for uid, full_name, role, shift_number, shift_from, shift_to in employee_rows:
                latest = latest_by_user.get(uid)
                is_open = bool(latest and latest[1] is None)
                opened_at = latest[0].isoformat() if is_open else None
                can_close_at = None
                if is_open and shift_to:
                    close_dt = datetime.combine(latest[0].date(), shift_to)
                    if shift_from and shift_to < shift_from:
                        close_dt += timedelta(days=1)
                    can_close_at = close_dt.isoformat()
                employees.append({
                    'id': uid,
                    'fullName': full_name,
                    'role': role,
                    'shiftNumber': shift_number,
                    'isOpen': is_open,
                    'openedAt': opened_at,
                    'canCloseAt': can_close_at,
                })
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'employees': employees})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'open':
                user_id = body_data.get('userId')
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL",
                    (int(user_id),),
                )
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'У сотрудника уже открыта смена'})}

                workshop_sql = int(workshop_id) if workshop_id not in (None, '') else 'NULL'
                shift_sql = int(shift_number) if shift_number not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO shift_sessions (user_id, workshop_id, shift_number) "
                    f"VALUES ({int(user_id)}, {workshop_sql}, {shift_sql}) RETURNING id, opened_at"
                )
                new_id, opened_at = cur.fetchone()
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id, 'openedAt': opened_at.isoformat()})}

            if action == 'close':
                user_id = body_data.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(user_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Открытой смены не найдено'})}

                cur.execute("UPDATE shift_sessions SET closed_at = now() WHERE id = %s", (row[0],))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
