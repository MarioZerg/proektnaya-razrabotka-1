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

    Привязка к смене (workshop/shift_number в профиле users) жёсткая: сотрудник открывает
    смену ТОЛЬКО в своём штатном цехе/смене. Исключения:
      - shift_free=true у сотрудника (админ "выключил смену" ему лично) — тогда сотрудник
        сам выбирает, в какой активный цех/смену зайти сегодня (гостевой режим). Штатные
        workshop/shift_number в профиле НЕ меняются
      - штатный цех сотрудника неактивен (workshops.is_active=false), или его штатная смена
        неактивна (shifts.is_active=false) — в этом случае ВСЕ сотрудники этой смены/цеха
        автоматически получают тот же гостевой выбор на сегодня, даже если shift_free=false
      - штатная смена/цех отмечены выходным на сегодня в shift_calendar — открытие смены
        заблокировано (кроме случая, когда сотрудник идёт гостем в ДРУГУЮ, рабочую смену)

    GET  /                          - список сотрудников с текущим статусом смены
                                       (открыта/закрыта, время открытия, ожидаемое
                                       время закрытия по графику shift_from/shift_to,
                                       shiftFree, а также фактические workshopId/shiftNumber
                                       текущей открытой смены — могут отличаться от штатных
                                       в профиле, если сотрудник зашёл гостем)
    GET  /?calendar=1&month=2026-08- календарь: по каждому дню месяца список
                                       сотрудников, открывавших смену в этот день
    GET  /?available_shifts=1&userId=1
                                    - список активных смен, доступных сотруднику для
                                      открытия СЕГОДНЯ гостем (активный цех + активная
                                      смена + сегодня не отмечено выходным в календаре).
                                      Если у userId штатная смена ещё рабочая — она тоже
                                      входит в список, помечена isHome=true
    POST /  { action: 'open', userId, workshopId?, shiftNumber? }
        - открывает смену сотруднику (создаёт запись с closed_at = NULL).
          Если у сотрудника уже есть открытая смена — отклоняется (409).
          Если сотрудник жёстко привязан (shift_free=false) и его штатная смена/цех активны
          и сегодня не выходной — workshopId/shiftNumber ИГНОРИРУЮТСЯ и берутся из профиля
          (нельзя открыть смену в чужом цехе). Если сотрудник свободен (shift_free=true,
          либо его штатная смена/цех выключены) — workshopId/shiftNumber ОБЯЗАТЕЛЬНЫ и должны
          указывать на активный цех + активную смену, не отмеченную выходным на сегодня
    POST /  { action: 'close', userId }
        - закрывает последнюю открытую смену сотрудника (closed_at = now()).
          Если сотрудник — уборщица (role='cleaner'), начисляет ей оклад за смену
          (salary_accruals, type='cleaner_shift'). Ставка (salary_rates, role='cleaner')
          берётся из тарифов цеха, указанного при открытии этой смены (workshop_id), либо
          из цеха её профиля (users.workshop), если у смены цех не был указан

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

            if params.get('available_shifts'):
                user_id = params.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute("SELECT workshop, shift_number FROM users WHERE id = %s", (int(user_id),))
                u_row = cur.fetchone()
                home_workshop_name, home_shift_number = u_row if u_row else (None, None)

                cur.execute(
                    "SELECT s.workshop_id, w.name, s.shift_number, s.name FROM shifts s "
                    "JOIN workshops w ON w.id = s.workshop_id "
                    "WHERE s.is_active = true AND w.is_active = true "
                    "AND NOT EXISTS ("
                    "  SELECT 1 FROM shift_calendar sc WHERE sc.workshop_id = s.workshop_id "
                    "  AND sc.shift_number = s.shift_number AND sc.calendar_date = CURRENT_DATE"
                    ") ORDER BY w.id, s.shift_number"
                )
                available = [
                    {
                        'workshopId': r[0],
                        'workshopName': r[1],
                        'shiftNumber': r[2],
                        'shiftName': r[3],
                        'isHome': r[1] == home_workshop_name and r[2] == home_shift_number,
                    }
                    for r in cur.fetchall()
                ]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shifts': available})}

            cur.execute(
                "SELECT id, full_name, role, shift_number, shift_from, shift_to, workshop, shift_free FROM users "
                "WHERE is_active = true ORDER BY full_name"
            )
            employee_rows = cur.fetchall()

            cur.execute(
                "SELECT DISTINCT ON (user_id) user_id, opened_at, closed_at, workshop_id, shift_number "
                "FROM shift_sessions ORDER BY user_id, opened_at DESC"
            )
            latest_by_user = {r[0]: (r[1], r[2], r[3], r[4]) for r in cur.fetchall()}

            employees = []
            for uid, full_name, role, shift_number, shift_from, shift_to, workshop_name, shift_free in employee_rows:
                latest = latest_by_user.get(uid)
                is_open = bool(latest and latest[1] is None)
                opened_at = latest[0].isoformat() if is_open else None
                can_close_at = None
                if is_open and shift_to:
                    close_dt = datetime.combine(latest[0].date(), shift_to)
                    if shift_from and shift_to < shift_from:
                        close_dt += timedelta(days=1)
                    can_close_at = close_dt.isoformat()
                session_workshop_id = latest[2] if is_open else None
                session_shift_number = latest[3] if is_open else None
                employees.append({
                    'id': uid,
                    'fullName': full_name,
                    'role': role,
                    'shiftNumber': shift_number,
                    'isOpen': is_open,
                    'openedAt': opened_at,
                    'canCloseAt': can_close_at,
                    'shiftFree': shift_free,
                    'sessionWorkshopId': session_workshop_id,
                    'sessionShiftNumber': session_shift_number,
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
                req_workshop_id = body_data.get('workshopId')
                req_shift_number = body_data.get('shiftNumber')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL",
                    (int(user_id),),
                )
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'У сотрудника уже открыта смена'})}

                cur.execute("SELECT workshop, shift_number, shift_free FROM users WHERE id = %s", (int(user_id),))
                u_row = cur.fetchone()
                if not u_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}
                home_workshop_name, home_shift_number, shift_free = u_row

                home_workshop_id = None
                home_workshop_active = False
                home_shift_active = False
                if home_workshop_name:
                    cur.execute("SELECT id, is_active FROM workshops WHERE name = %s", (home_workshop_name,))
                    w_row = cur.fetchone()
                    if w_row:
                        home_workshop_id, home_workshop_active = w_row[0], w_row[1]
                        if home_workshop_active and home_shift_number:
                            cur.execute(
                                "SELECT is_active FROM shifts WHERE workshop_id = %s AND shift_number = %s",
                                (home_workshop_id, home_shift_number),
                            )
                            s_row = cur.fetchone()
                            home_shift_active = bool(s_row and s_row[0])

                # "Эффективно свободен" — либо явно выключена смена сотруднику лично, либо у
                # него вообще нет штатного цеха/смены, либо его штатный цех/смена сейчас
                # неактивны (выключены администратором на вкладке "Цеха"/"Смены").
                effective_free = bool(
                    shift_free or not home_workshop_id or not home_shift_number
                    or not home_workshop_active or not home_shift_active
                )

                if not effective_free:
                    # Жёсткая привязка — игнорируем то, что могло быть передано с фронта,
                    # используем ТОЛЬКО штатные цех/смену, чтобы нельзя было обойти привязку
                    # прямым API-запросом.
                    workshop_id = home_workshop_id
                    shift_number = home_shift_number

                    cur.execute(
                        "SELECT 1 FROM shift_calendar WHERE workshop_id = %s AND shift_number = %s "
                        "AND calendar_date = CURRENT_DATE",
                        (workshop_id, shift_number),
                    )
                    if cur.fetchone():
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Сегодня выходной день для вашей смены'})}
                else:
                    if not req_workshop_id or not req_shift_number:
                        return {
                            'statusCode': 400,
                            'headers': headers,
                            'body': json.dumps({'error': 'Выберите цех и смену, в которую хотите зайти сегодня'}),
                        }
                    cur.execute(
                        "SELECT s.is_active, w.is_active FROM shifts s JOIN workshops w ON w.id = s.workshop_id "
                        "WHERE s.workshop_id = %s AND s.shift_number = %s",
                        (int(req_workshop_id), int(req_shift_number)),
                    )
                    s_row = cur.fetchone()
                    if not s_row:
                        return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Смена не найдена'})}
                    if not s_row[0] or not s_row[1]:
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Эта смена или цех сейчас выключены'})}

                    cur.execute(
                        "SELECT 1 FROM shift_calendar WHERE workshop_id = %s AND shift_number = %s "
                        "AND calendar_date = CURRENT_DATE",
                        (int(req_workshop_id), int(req_shift_number)),
                    )
                    if cur.fetchone():
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Сегодня выходной день для этой смены'})}

                    workshop_id = int(req_workshop_id)
                    shift_number = int(req_shift_number)

                cur.execute(
                    f"INSERT INTO shift_sessions (user_id, workshop_id, shift_number) "
                    f"VALUES ({int(user_id)}, {workshop_id}, {shift_number}) RETURNING id, opened_at"
                )
                new_id, opened_at = cur.fetchone()
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': new_id,
                        'openedAt': opened_at.isoformat(),
                        'workshopId': workshop_id,
                        'shiftNumber': shift_number,
                    }),
                }

            if action == 'close':
                user_id = body_data.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT id, workshop_id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(user_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Открытой смены не найдено'})}
                session_id, session_workshop_id = row

                cur.execute("UPDATE shift_sessions SET closed_at = now() WHERE id = %s", (session_id,))

                # Уборщица получает оклад за смену при её закрытии (salary_rates, role='cleaner'),
                # ставка берётся из тарифов цеха, указанного при открытии этой смены (workshop_id).
                # Если цех у смены не указан — если у уборщицы есть свой цех в профиле, используем его.
                cur.execute("SELECT role, workshop FROM users WHERE id = %s", (int(user_id),))
                user_row = cur.fetchone()
                if user_row and user_row[0] == 'cleaner':
                    rate_workshop_id = session_workshop_id
                    if not rate_workshop_id and user_row[1]:
                        cur.execute("SELECT id FROM workshops WHERE name = %s", (user_row[1],))
                        w_row = cur.fetchone()
                        rate_workshop_id = w_row[0] if w_row else None
                    if rate_workshop_id:
                        cur.execute(
                            "SELECT rate FROM salary_rates WHERE role = 'cleaner' AND workshop_id = %s",
                            (rate_workshop_id,),
                        )
                        rate_row = cur.fetchone()
                        rate = float(rate_row[0]) if rate_row else 0
                        if rate > 0:
                            cur.execute(
                                f"INSERT INTO salary_accruals (user_id, type, amount, shift_session_id, description) "
                                f"VALUES ({int(user_id)}, 'cleaner_shift', {rate}, {session_id}, 'Оклад за смену') "
                                f"ON CONFLICT (shift_session_id, type) WHERE shift_session_id IS NOT NULL DO NOTHING"
                            )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
