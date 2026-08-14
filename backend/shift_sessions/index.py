import json
import os
from datetime import datetime, timedelta

import psycopg2


def is_day_off_today(cur, workshop_id, shift_number) -> bool:
    """Выходной ли сегодня у смены: ручная отметка в календаре ИЛИ отдых по цикличному
    графику (2/2 и т.п., отсчёт от даты первого выхода смены)."""
    if not workshop_id or not shift_number:
        return False
    cur.execute(
        "SELECT 1 FROM shift_calendar WHERE workshop_id = %s AND shift_number = %s "
        "AND calendar_date = CURRENT_DATE",
        (int(workshop_id), int(shift_number)),
    )
    if cur.fetchone():
        return True
    cur.execute(
        "SELECT cycle_work_days, cycle_off_days, cycle_start_date, work_weekdays FROM shifts "
        "WHERE workshop_id = %s AND shift_number = %s",
        (int(workshop_id), int(shift_number)),
    )
    row = cur.fetchone()
    if not row:
        return False
    cycle_work, cycle_off, cycle_start, weekdays = row

    # Недельный график (5/2): сегодня выходной, если дня недели нет в списке рабочих.
    if weekdays:
        cur.execute("SELECT EXTRACT(ISODOW FROM CURRENT_DATE)::int")
        return int(cur.fetchone()[0]) not in weekdays

    # Цикличный график (2/2, 3/3): считаем от даты первого выхода смены.
    if cycle_work and cycle_off and cycle_start:
        cur.execute(
            "SELECT CURRENT_DATE < %s "
            "OR MOD((CURRENT_DATE - %s), %s) >= %s",
            (cycle_start, cycle_start, int(cycle_work) + int(cycle_off), int(cycle_work)),
        )
        return bool(cur.fetchone()[0])
    return False


def get_setting(cur, workshop_id, key, default=None):
    """Читает значение настройки: сначала переопределение цеха (workshop_settings),
    если его нет — глобальное значение (system_settings), если и его нет — default."""
    if workshop_id:
        cur.execute(
            "SELECT value FROM workshop_settings WHERE workshop_id = %s AND key = %s",
            (int(workshop_id), key),
        )
        row = cur.fetchone()
        if row and row[0] not in (None, ''):
            return row[0]
    cur.execute("SELECT value FROM system_settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if row and row[0] not in (None, ''):
        return row[0]
    return default


def shift_close_allowed_at(cur, user_id, opened_at):
    """Во сколько сотрудник сможет закрыть смену.

    Считаем от фактического прихода, а не от расписания: график 07:00–19:00 — это
    12 часов работы, значит пришедший в 7:14 закрывает смену в 19:14. Опоздавший
    дорабатывает своё, а не уходит вместе со всеми.

    Возвращает datetime или None, если график не задан (тогда не ограничиваем).
    """
    cur.execute(
        "SELECT shift_from, shift_to FROM users WHERE id = %s",
        (int(user_id),),
    )
    row = cur.fetchone()
    if not row or not row[0] or not row[1]:
        return None

    start, end = row[0], row[1]
    start_dt = datetime.combine(opened_at.date(), start)
    end_dt = datetime.combine(opened_at.date(), end)
    # Ночная смена (например с 19:00 до 07:00) заканчивается на следующий день.
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)

    duration = end_dt - start_dt
    # Пришёл раньше начала смены — отсчёт всё равно ведём от её начала по графику,
    # иначе ранний приход сокращал бы рабочий день.
    base = opened_at if opened_at > start_dt else start_dt
    return base + duration


def count_orders_in_work(cur, user_id, role, session_workshop_id=None):
    """Сколько незавершённой работы держит сотрудника — из-за неё нельзя закрыть смену.

    У каждой должности свой этап, и держать человека надо только на нём:
      - закройщик отвечает за раскрой, поэтому считаем заказы «На раскрое»;
      - швея отвечает за пошив, поэтому считаем только «В работе». Заказы, уже
        отправленные на стикеровку, её не держат — там работает упаковщица;
      - упаковщица отвечает за стикеровку. Её заказы ни за кем не закреплены лично:
        «Стикеровка» — общая очередь цеха, любой заказ берёт та, кто свободна.
        Поэтому считаем всё, что висит в стикеровке по её цеху: пока очередь не
        разобрана, товар не уедет в поставку и зависнет до утра.
    Остальным должностям смену закрывать ничего не мешает."""
    if role == 'packer':
        # Цех берём тот, в котором открыта смена: в гостевом режиме упаковщица может
        # работать не в своём штатном цехе, и держать её должна очередь того цеха,
        # где она сегодня стоит. Цех не указан — держать не за что.
        if not session_workshop_id:
            return 0
        cur.execute(
            "SELECT COUNT(*) FROM orders "
            "WHERE sewing_status = 'Стикеровка' AND workshop_id = %s "
            "AND COALESCE(status, '') <> 'Отменён'",
            (int(session_workshop_id),),
        )
        return int(cur.fetchone()[0])

    if role == 'cutter':
        status = 'На раскрое'
    elif role == 'sewer':
        status = 'В работе'
    else:
        return 0

    cur.execute(
        "SELECT COUNT(*) FROM orders "
        "WHERE (assigned_user_id = %s OR sewer_user_id = %s OR cutter_user_id = %s) "
        "AND sewing_status = %s "
        "AND COALESCE(status, '') <> 'Отменён'",
        (int(user_id), int(user_id), int(user_id), status),
    )
    return int(cur.fetchone()[0])


def apply_penalty(cur, user_id, amount, description, shift_session_id=None):
    """Начисляет автоматический штраф сотруднику (salary_accruals, type='penalty').
    Если shift_session_id указан, защищено уникальным индексом (shift_session_id, type) —
    повторный штраф за ту же смену не создастся (ON CONFLICT DO NOTHING)."""
    if amount <= 0 or not user_id:
        return
    penalty_amount = -abs(float(amount))
    description_esc = description.replace("'", "''")
    session_sql = str(int(shift_session_id)) if shift_session_id else 'NULL'
    conflict_sql = (
        "ON CONFLICT (shift_session_id, type) WHERE shift_session_id IS NOT NULL DO NOTHING"
        if shift_session_id else ""
    )
    cur.execute(
        f"INSERT INTO salary_accruals (user_id, type, amount, shift_session_id, description) "
        f"VALUES ({int(user_id)}, 'penalty', {penalty_amount}, {session_sql}, '{description_esc}') "
        f"{conflict_sql}"
    )


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
    POST /  { action: 'auto_close', cronSecret? }
                                    - закрывает смены, которые сотрудники забыли закрыть:
                                      время конца рабочего дня берётся из настроек цеха
                                      (working_day_end), смена закрывается этим временем,
                                      а не моментом запуска. Если за швеёй/закройщиком ещё
                                      числились заказы на их этапе (у закройщика «На раскрое»,
                                      у швеи «В работе») — штраф unclosed_shift_with_orders_penalty,
                                      иначе обычный unclosed_shift_penalty. Повторный запуск
                                      безопасен: закрытые смены пропускаются, штраф за одну
                                      смену начисляется один раз.
                                      cronSecret — ключ для ночного планировщика (сверяется
                                      с переменной CRON_SECRET). Нужен только внешнему
                                      вызову: автозакрытие начисляет штрафы, поэтому дёргать
                                      адрес без ключа посторонние не должны
    POST /  { action: 'close', userId, closedByAdmin? }
                                    - закрывает смену. Закройщику нельзя закрыть, пока у него
                                      есть заказы «На раскрое», швее — пока есть «В работе»
                                      (409). Заказы на стикеровке швею не держат — их
                                      закрывает упаковщик. Администратор закрывает принудительно
                                      через closedByAdmin=true
    POST /  { action: 'open', userId, workshopId?, shiftNumber?, openedByAdmin?, role? }
        - швея/закройщик/упаковщик работают гибко: цех и смену выбирают при КАЖДОМ открытии
          (можно работать в разных цехах), обязанность закрыть смену сохраняется. Должность
          (role) фиксируется в смене и должна быть в утверждённых ролях сотрудника.
          Кладовщик не привязан ни к цеху, ни к смене — открывает смену по личному графику.
        - открывает смену сотруднику (создаёт запись с closed_at = NULL).
          Если у сотрудника уже есть открытая смена — отклоняется (409).
          Если сотрудник жёстко привязан (shift_free=false) и его штатная смена/цех активны
          и сегодня не выходной — workshopId/shiftNumber ИГНОРИРУЮТСЯ и берутся из профиля
          (нельзя открыть смену в чужом цехе). Если сотрудник свободен (shift_free=true,
          либо его штатная смена/цех выключены) — workshopId/shiftNumber ОБЯЗАТЕЛЬНЫ и должны
          указывать на активный цех + активную смену, не отмеченную выходным на сегодня.
          Опоздание (is_late в shift_sessions) определяется сравнением текущего времени с
          shift_from сотрудника (если задан) либо working_day_start настроек цеха. При
          опоздании начисляется автоштраф (salary_accruals, type='penalty') на сумму
          late_opened_shift_penalty из настроек цеха, если она больше 0 — КРОМЕ случая,
          когда openedByAdmin=true (администратор открыл смену ЗА сотрудника с дашборда —
          сотрудник не виноват в моменте открытия, штраф не начисляется)
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

            if params.get('guest_history'):
                # История гостевых смен: кто выходил в чужой цех и когда. Нужна отчётом,
                # потому что текущий статус показывает только открытые прямо сейчас смены,
                # а разбираться с гостевыми выходами приходится задним числом.
                days_back = params.get('days') or '30'
                try:
                    days_back = max(1, min(365, int(days_back)))
                except ValueError:
                    days_back = 30
                cur.execute(
                    "SELECT ss.id, u.full_name, COALESCE(ss.role, u.role), "
                    "u.workshop, w.name, ss.shift_number, ss.opened_at, ss.closed_at "
                    "FROM shift_sessions ss "
                    "JOIN users u ON u.id = ss.user_id "
                    "JOIN workshops w ON w.id = ss.workshop_id "
                    "WHERE ss.opened_at >= now() - make_interval(days => %s) "
                    "AND u.workshop IS NOT NULL AND u.workshop <> w.name "
                    "ORDER BY ss.opened_at DESC",
                    (days_back,),
                )
                sessions = [
                    {
                        'id': r[0],
                        'fullName': r[1],
                        'role': r[2],
                        'homeWorkshopName': r[3],
                        'workshopName': r[4],
                        'shiftNumber': r[5],
                        'openedAt': r[6].isoformat() + 'Z',
                        'closedAt': (r[7].isoformat() + 'Z') if r[7] else None,
                    }
                    for r in cur.fetchall()
                ]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'sessions': sessions}, ensure_ascii=False),
                }

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
                    # Смена недоступна сегодня, если день отмечен выходным вручную ИЛИ
                    # выпадает на отдых по цикличному графику (2/2 и т.п.).
                    "AND NOT EXISTS ("
                    "  SELECT 1 FROM shift_calendar sc WHERE sc.workshop_id = s.workshop_id "
                    "  AND sc.shift_number = s.shift_number AND sc.calendar_date = CURRENT_DATE"
                    ") "
                    "AND NOT (s.cycle_work_days IS NOT NULL AND s.cycle_off_days IS NOT NULL "
                    "  AND s.cycle_start_date IS NOT NULL "
                    "  AND (CURRENT_DATE < s.cycle_start_date "
                    "    OR MOD((CURRENT_DATE - s.cycle_start_date), "
                    "           (s.cycle_work_days + s.cycle_off_days)) >= s.cycle_work_days)) "
                    "AND NOT (s.work_weekdays IS NOT NULL "
                    "  AND NOT (EXTRACT(ISODOW FROM CURRENT_DATE)::int = ANY(s.work_weekdays))) "
                    "ORDER BY w.id, s.shift_number"
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
                "SELECT DISTINCT ON (ss.user_id) ss.user_id, ss.opened_at, ss.closed_at, "
                "ss.workshop_id, ss.shift_number, ss.role, w.name "
                "FROM shift_sessions ss LEFT JOIN workshops w ON w.id = ss.workshop_id "
                "ORDER BY ss.user_id, ss.opened_at DESC"
            )
            latest_by_user = {r[0]: (r[1], r[2], r[3], r[4], r[5], r[6]) for r in cur.fetchall()}

            employees = []
            for uid, full_name, role, shift_number, shift_from, shift_to, workshop_name, shift_free in employee_rows:
                latest = latest_by_user.get(uid)
                is_open = bool(latest and latest[1] is None)
                opened_at = (latest[0].isoformat() + 'Z') if is_open else None
                # Время закрытия считаем от фактического прихода: смена длится столько,
                # сколько заложено графиком. Пришёл в 7:14 при графике 07:00-19:00 —
                # закроет в 19:14, то есть отработает свои 12 часов.
                can_close_at = None
                if is_open and shift_from and shift_to:
                    start_dt = datetime.combine(latest[0].date(), shift_from)
                    end_dt = datetime.combine(latest[0].date(), shift_to)
                    if end_dt <= start_dt:
                        end_dt += timedelta(days=1)
                    base = latest[0] if latest[0] > start_dt else start_dt
                    can_close_at = (base + (end_dt - start_dt)).isoformat() + 'Z'
                session_workshop_id = latest[2] if is_open else None
                session_shift_number = latest[3] if is_open else None
                session_workshop_name = latest[5] if is_open else None
                # Гость — сотрудник открыл смену не в своём штатном цехе. Сравниваем по
                # названию цеха: у сотрудника цех хранится названием, у смены — номером.
                is_guest = bool(
                    is_open and workshop_name and session_workshop_name
                    and workshop_name != session_workshop_name
                )
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
                    'sessionWorkshopName': session_workshop_name,
                    'homeWorkshopName': workshop_name,
                    'isGuest': is_guest,
                    'sessionRole': (latest[4] if is_open else None) or (role if is_open else None),
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
                req_role = body_data.get('role')
                opened_by_admin = bool(body_data.get('openedByAdmin'))
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL",
                    (int(user_id),),
                )
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'У сотрудника уже открыта смена'})}

                cur.execute(
                    "SELECT workshop, shift_number, shift_free, shift_from, role FROM users WHERE id = %s",
                    (int(user_id),),
                )
                u_row = cur.fetchone()
                if not u_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}
                home_workshop_name, home_shift_number, shift_free, shift_from, user_role = u_row

                # Кладовщик не привязан ни к цеху, ни к смене: он открывает и закрывает смену
                # по личному графику из профиля (shift_from). Цех/смену ему не требуем и не
                # проверяем ни выходные, ни активность смен.
                if user_role in ('storekeeper', 'senior_storekeeper'):
                    is_late = False
                    if shift_from:
                        cur.execute(
                            "SELECT (now()::time > %s::time)",
                            (str(shift_from),),
                        )
                        lr = cur.fetchone()
                        is_late = bool(lr and lr[0])
                    if is_late:
                        cur.execute(
                            "SELECT 1 FROM shift_sessions WHERE user_id = %s "
                            "AND opened_at::date = CURRENT_DATE AND is_late = false LIMIT 1",
                            (int(user_id),),
                        )
                        if cur.fetchone():
                            is_late = False
                    cur.execute(
                        "INSERT INTO shift_sessions (user_id, workshop_id, shift_number, is_late) "
                        "VALUES (%s, NULL, NULL, %s) RETURNING id, opened_at",
                        (int(user_id), is_late),
                    )
                    new_row = cur.fetchone()
                    conn.commit()
                    return {
                        'statusCode': 200,
                        'headers': headers,
                        'body': json.dumps({
                            'id': new_row[0],
                            'openedAt': new_row[1].isoformat() + 'Z',
                            'workshopId': None,
                            'shiftNumber': None,
                            'isLate': is_late,
                        }),
                    }

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

                # Производственные роли работают гибко: сотрудник сам выбирает цех и смену
                # при каждом открытии. Перешёл в другой цех — открывает смену там, но
                # обязанность закрыть смену по окончании рабочего дня сохраняется.
                if user_role in ('sewer', 'cutter', 'packer'):
                    effective_free = True

                # Должность фиксируется на момент открытия смены в цехе. Выбрать можно
                # только из утверждённых администратором ролей сотрудника.
                session_role = user_role
                if req_role and req_role != user_role:
                    cur.execute(
                        "SELECT 1 FROM user_roles WHERE user_id = %s AND role = %s AND is_approved = true",
                        (int(user_id), req_role),
                    )
                    if not cur.fetchone():
                        return {
                            'statusCode': 403,
                            'headers': headers,
                            'body': json.dumps({'error': 'Эта должность вам не разрешена администратором'}),
                        }
                    session_role = req_role

                if not effective_free:
                    # Жёсткая привязка — игнорируем то, что могло быть передано с фронта,
                    # используем ТОЛЬКО штатные цех/смену, чтобы нельзя было обойти привязку
                    # прямым API-запросом.
                    workshop_id = home_workshop_id
                    shift_number = home_shift_number

                    if is_day_off_today(cur, workshop_id, shift_number):
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

                    if is_day_off_today(cur, int(req_workshop_id), int(req_shift_number)):
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Сегодня выходной день для этой смены'})}

                    workshop_id = int(req_workshop_id)
                    shift_number = int(req_shift_number)

                # Расписание рабочего дня: если включено (is_enabled_work_schedule), смену
                # нельзя открыть после окончания рабочего дня (working_day_end) — иначе
                # сотрудник может «открыть смену» ночью и накрутить часы.
                schedule_on = str(get_setting(cur, workshop_id, 'is_enabled_work_schedule', 'false')).lower() == 'true'
                if schedule_on:
                    end_time_str = get_setting(cur, workshop_id, 'working_day_end')
                    if end_time_str:
                        try:
                            end_time = datetime.strptime(str(end_time_str)[:5], '%H:%M').time()
                            if datetime.now().time() > end_time:
                                return {
                                    'statusCode': 409,
                                    'headers': headers,
                                    'body': json.dumps({
                                        'error': f'Рабочий день в цехе закончился в {str(end_time_str)[:5]} — '
                                                 f'смену открыть нельзя'
                                    }),
                                }
                        except ValueError:
                            pass

                # Опоздание определяется по времени начала: shift_from сотрудника, если задан
                # в профиле, иначе working_day_start настроек цеха (переопределение цеха или
                # глобальное значение). Если ни то, ни другое не задано — проверка пропускается.
                start_time_str = str(shift_from) if shift_from else get_setting(cur, workshop_id, 'working_day_start')
                is_late = False
                if start_time_str:
                    try:
                        start_time = datetime.strptime(str(start_time_str)[:5], '%H:%M').time()
                        now_dt = datetime.now()
                        start_dt = datetime.combine(now_dt.date(), start_time)
                        # Небольшая задержка опозданием не считается: пробки, очередь
                        # к терминалу. Допуск берём из профиля сотрудника (по умолчанию
                        # 15 минут) — штраф начисляется только за выход за его пределы.
                        cur.execute(
                            "SELECT COALESCE(late_tolerance_minutes, 15) FROM users WHERE id = %s",
                            (int(user_id),),
                        )
                        tol_row = cur.fetchone()
                        tolerance = int(tol_row[0]) if tol_row else 15
                        is_late = now_dt > start_dt + timedelta(minutes=tolerance)
                    except ValueError:
                        is_late = False

                # Если сегодня сотрудник уже открывал смену вовремя (в любом цехе и в любой
                # должности), то последующие открытия — это переход в другой цех или смена
                # должности в течение дня, а не опоздание. Штраф повторно не начисляем.
                if is_late:
                    cur.execute(
                        "SELECT 1 FROM shift_sessions WHERE user_id = %s "
                        "AND opened_at::date = CURRENT_DATE AND is_late = false LIMIT 1",
                        (int(user_id),),
                    )
                    if cur.fetchone():
                        is_late = False

                cur.execute(
                    "INSERT INTO shift_sessions (user_id, workshop_id, shift_number, is_late, role) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING id, opened_at",
                    (int(user_id), workshop_id, shift_number, is_late, session_role),
                )
                new_id, opened_at = cur.fetchone()

                # Автоштраф за опоздание (late_opened_shift_penalty из настроек цеха) —
                # начисляется сразу при открытии, защищён от дубля уникальным индексом
                # (shift_session_id, type) на случай повторного вызова. Если смену открыл
                # администратор ЗА сотрудника (с дашборда) — сотрудник не виноват в том,
                # когда именно за него открыли смену, поэтому штраф не начисляется.
                charged_penalty = 0
                if is_late and not opened_by_admin:
                    penalty = get_setting(cur, workshop_id, 'late_opened_shift_penalty')
                    try:
                        penalty_amount = float(penalty) if penalty not in (None, '') else 0
                    except (TypeError, ValueError):
                        penalty_amount = 0
                    if penalty_amount > 0:
                        apply_penalty(
                            cur, user_id, penalty_amount,
                            f'Опоздание при открытии смены (после {start_time_str})',
                            shift_session_id=new_id,
                        )
                        charged_penalty = penalty_amount

                # На сколько именно опоздал — считаем от начала смены по графику,
                # чтобы показать сотруднику конкретное время, а не просто «опоздание».
                late_minutes = 0
                if is_late and start_time_str:
                    try:
                        st = datetime.strptime(str(start_time_str)[:5], '%H:%M').time()
                        st_dt = datetime.combine(opened_at.date(), st)
                        late_minutes = max(0, int((opened_at - st_dt).total_seconds() // 60))
                    except ValueError:
                        late_minutes = 0

                # Сразу говорим, во сколько смену можно будет закрыть — сотрудник видит
                # это на терминале при открытии и не подходит к кнопке раньше времени.
                close_at = shift_close_allowed_at(cur, user_id, opened_at)

                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': new_id,
                        'openedAt': opened_at.isoformat() + 'Z',
                        'workshopId': workshop_id,
                        'shiftNumber': shift_number,
                        'isLate': is_late,
                        # На сколько минут опоздал и сколько за это удержано —
                        # терминал показывает это сотруднику сразу после открытия.
                        'lateMinutes': late_minutes,
                        'penaltyAmount': charged_penalty,
                        'shiftStart': str(start_time_str)[:5] if start_time_str else None,
                        'canCloseAt': (close_at.isoformat() + 'Z') if close_at else None,
                    }),
                }

            if action == 'defect_check':
                # Перед закрытием смены напоминаем оформить брак: если сотрудник за смену не
                # завёл ни одной записи — вероятно, забыл, а не работал идеально. Текст свой
                # для каждой роли: закройщик режет ткань, швея работает с тесьмой.
                user_id = body_data.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}
                cur.execute(
                    "SELECT s.id, s.opened_at, u.role FROM shift_sessions s "
                    "JOIN users u ON u.id = s.user_id "
                    "WHERE s.user_id = %s AND s.closed_at IS NULL ORDER BY s.opened_at DESC LIMIT 1",
                    (int(user_id),),
                )
                srow = cur.fetchone()
                if not srow:
                    return {'statusCode': 200, 'headers': headers,
                            'body': json.dumps({'ask': False}, ensure_ascii=False)}
                session_id, opened_at, role = srow

                cur.execute(
                    "SELECT count(*), coalesce(sum(quantity), 0) FROM material_defects "
                    "WHERE user_id = %s AND created_at >= %s",
                    (int(user_id), opened_at),
                )
                cnt, total = cur.fetchone()

                if role == 'cutter':
                    question = 'Вы закрыли брак ткани?'
                    hint = 'Закройщик работает с тюлем — если находили затяжки, полосы или дырки, оформите брак до закрытия смены'
                elif role == 'sewer':
                    question = 'Вы закрыли брак тесьмы?'
                    hint = 'Швея работает с тесьмой — если попадался брак петель или заводской брак, оформите его до закрытия смены'
                else:
                    question = 'Вы закрыли брак материалов?'
                    hint = 'Если за смену попадался брак ткани или тесьмы, оформите его до закрытия смены'

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        # Спрашиваем всегда, но если брак уже оформлен — показываем сколько.
                        'ask': True,
                        'question': question,
                        'hint': hint,
                        'defectsCount': int(cnt),
                        'defectsQuantity': float(total or 0),
                        'role': role,
                    }, ensure_ascii=False),
                }

            if action == 'move_workshop':
                # Сотрудник перешёл работать в другой цех посреди дня. Смену НЕ закрываем
                # и не открываем заново — она одна на весь рабочий день. Просто переносим
                # текущую смену в новый цех, чтобы заказы, лимиты и настройки брались из
                # того цеха, где человек реально стоит.
                user_id = body_data.get('userId')
                new_workshop_id = body_data.get('workshopId')
                if not user_id or not new_workshop_id:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите userId и workshopId'}),
                    }

                cur.execute(
                    "SELECT id, workshop_id, shift_number FROM shift_sessions "
                    "WHERE user_id = %s AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
                    (int(user_id),),
                )
                sess = cur.fetchone()
                if not sess:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Смена не открыта'}),
                    }
                session_id, old_workshop_id, session_shift_number = sess

                if old_workshop_id == int(new_workshop_id):
                    return {
                        'statusCode': 200,
                        'headers': headers,
                        'body': json.dumps({'success': True, 'moved': False}),
                    }

                cur.execute(
                    "SELECT is_active FROM workshops WHERE id = %s", (int(new_workshop_id),)
                )
                w_row = cur.fetchone()
                if not w_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Цех не найден'})}
                if not w_row[0]:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Цех сейчас выключен'})}

                # Номер смены сохраняем, если он есть в новом цехе; иначе берём первую активную.
                new_shift_number = session_shift_number
                cur.execute(
                    "SELECT shift_number FROM shifts WHERE workshop_id = %s AND is_active = true "
                    "ORDER BY shift_number",
                    (int(new_workshop_id),),
                )
                active_shifts = [r[0] for r in cur.fetchall()]
                if new_shift_number not in active_shifts:
                    new_shift_number = active_shifts[0] if active_shifts else None

                cur.execute(
                    "UPDATE shift_sessions SET workshop_id = %s, shift_number = %s WHERE id = %s",
                    (int(new_workshop_id), new_shift_number, session_id),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'moved': True,
                        'workshopId': int(new_workshop_id),
                        'shiftNumber': new_shift_number,
                    }),
                }

            if action == 'close':
                user_id = body_data.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT id, workshop_id, opened_at FROM shift_sessions "
                    "WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(user_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Открытой смены не найдено'})}
                session_id, session_workshop_id, session_opened_at = row

                # Принудительное закрытие — право администратора, и проверяем его по базе,
                # а не по флагу из браузера: иначе любой сотрудник обошёл бы запрет,
                # подставив closedByAdmin в запрос со своего телефона.
                closed_by_admin = False
                if body_data.get('closedByAdmin'):
                    actor_id = body_data.get('actorId')
                    if actor_id:
                        cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                        actor_row = cur.fetchone()
                        closed_by_admin = bool(actor_row) and actor_row[0] == 'admin'
                    if not closed_by_admin:
                        return {
                            'statusCode': 403,
                            'headers': headers,
                            'body': json.dumps(
                                {'error': 'Принудительно закрыть смену может только администратор'},
                                ensure_ascii=False,
                            ),
                        }

                # Смену нельзя закрыть раньше, чем отработана её длительность по графику.
                # Отсчёт идёт от фактического прихода: пришёл в 7:14 при графике 12 часов —
                # закрыть сможет в 19:14. Так смена не закрывается раньше времени, а тот,
                # кто опоздал, не уходит вместе со всеми. Администратор закрывает в любой
                # момент — он разбирает нештатные ситуации вручную.
                can_close_at = shift_close_allowed_at(cur, user_id, session_opened_at)
                if can_close_at and not closed_by_admin:
                    if datetime.now() < can_close_at:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Смену можно закрыть в {can_close_at.strftime("%H:%M")} — '
                                         f'рабочее время ещё не вышло',
                                'canCloseAt': can_close_at.isoformat() + 'Z',
                            }, ensure_ascii=False),
                        }

                # Швея и закройщик не закрывают смену, пока за ними числятся заказы на их
                # этапе: иначе работа зависает до утра и её никто не подхватит. Администратор закрыть
                # может (closedByAdmin) — он разбирается с зависшими заказами вручную.
                # Роль берём ту, в которой человек реально работал в этой смене: в гостевом
                # режиме она может отличаться от штатной должности в профиле.
                cur.execute("SELECT role FROM shift_sessions WHERE id = %s", (session_id,))
                sess_role = (cur.fetchone() or [None])[0]
                if not sess_role:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(user_id),))
                    sess_role = (cur.fetchone() or [None])[0]
                if not closed_by_admin and sess_role:
                    orders_left = count_orders_in_work(
                        cur, user_id, sess_role, session_workshop_id,
                    )
                    if orders_left > 0:
                        stage = {
                            'cutter': 'на раскрое',
                            'sewer': 'в работе',
                            'packer': 'в стикеровке',
                        }.get(sess_role, 'в работе')
                        who = (
                            'В вашем цехе' if sess_role == 'packer' else 'У вас'
                        )
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps(
                                {
                                    'error': f'{who} {orders_left} заказов {stage} — '
                                             f'сначала завершите их, потом закрывайте смену',
                                    'ordersInWork': orders_left,
                                },
                                ensure_ascii=False,
                            ),
                        }

                cur.execute("UPDATE shift_sessions SET closed_at = now() WHERE id = %s", (session_id,))

                # Уборщица получает оклад за смену при её закрытии (salary_rates, role='cleaner'),
                # ставка берётся из тарифов цеха, указанного при открытии этой смены (workshop_id).
                # Если цех у смены не указан — если у уборщицы есть свой цех в профиле, используем его.
                # Оклад за смену получают уборщица, кладовщик и старший кладовщик — у всех
                # троих оплата повременная, а не сдельная. Раньше начислялась только уборщице:
                # кладовщики закрывали смены месяцами и не получали ничего, хотя ставки в
                # таблице стояли (2050 и 1200 руб.). Роль берём ту, в которой человек реально
                # работал в этой смене (shift_sessions.role) — в гостевом режиме она может
                # отличаться от штатной должности в профиле.
                cur.execute("SELECT role, workshop FROM users WHERE id = %s", (int(user_id),))
                user_row = cur.fetchone()
                cur.execute("SELECT role FROM shift_sessions WHERE id = %s", (session_id,))
                sess_role_row = cur.fetchone()
                shift_role = (sess_role_row[0] if sess_role_row and sess_role_row[0]
                              else (user_row[0] if user_row else None))
                if shift_role in ('cleaner', 'storekeeper', 'senior_storekeeper'):
                    rate_workshop_id = session_workshop_id
                    if not rate_workshop_id and user_row[1]:
                        cur.execute("SELECT id FROM workshops WHERE name = %s", (user_row[1],))
                        w_row = cur.fetchone()
                        rate_workshop_id = w_row[0] if w_row else None
                    if rate_workshop_id:
                        cur.execute(
                            "SELECT rate FROM salary_rates WHERE role = %s AND workshop_id = %s",
                            (shift_role, rate_workshop_id),
                        )
                        rate_row = cur.fetchone()
                        rate = float(rate_row[0]) if rate_row else 0
                        if rate > 0:
                            # Оклад за смену платим ОДИН раз в день. Если сотрудник за день
                            # отработал две смены (свою и гостевую в другом цехе), это разные
                            # записи смен, и защита по смене их не ловит — от задвоения
                            # спасает дневной уникальный индекс. Но он бьёт ошибкой и рвёт
                            # закрытие смены, поэтому проверяем день заранее и просто не
                            # начисляем второй оклад.
                            accrual_type = f'{shift_role}_shift'
                            cur.execute(
                                "SELECT 1 FROM salary_accruals WHERE user_id = %s "
                                "AND type = %s AND accrued_for = CURRENT_DATE",
                                (int(user_id), accrual_type),
                            )
                            if not cur.fetchone():
                                cur.execute(
                                    "INSERT INTO salary_accruals (user_id, type, amount, shift_session_id, description) "
                                    "VALUES (%s, %s, %s, %s, 'Оклад за смену') "
                                    "ON CONFLICT (shift_session_id, type) WHERE shift_session_id IS NOT NULL DO NOTHING",
                                    (int(user_id), accrual_type, rate, session_id),
                                )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'auto_close':
                # Автозакрытие начисляет штрафы, то есть трогает деньги сотрудников.
                # Поэтому ночной вызов от планировщика пускаем только с секретом, а из
                # интерфейса — как обычно (там уже есть вход администратора).
                cron_secret = os.environ.get('CRON_SECRET', '')
                from_cron = bool(body_data.get('cronSecret'))
                if from_cron and (not cron_secret or body_data.get('cronSecret') != cron_secret):
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Неверный ключ планировщика'}),
                    }

                # Ночной обход: закрываем смены, которые сотрудники забыли закрыть сами.
                # Время конца рабочего дня у каждого цеха своё (working_day_end), поэтому
                # смотрим смены по одной и сравниваем с настройкой именно её цеха.
                cur.execute(
                    "SELECT s.id, s.user_id, s.workshop_id, s.opened_at, u.role, u.full_name "
                    "FROM shift_sessions s JOIN users u ON u.id = s.user_id "
                    "WHERE s.closed_at IS NULL ORDER BY s.opened_at"
                )
                open_sessions = cur.fetchall()

                closed = []
                for session_id, s_user_id, s_workshop_id, opened_at, s_role, s_name in open_sessions:
                    end_str = get_setting(cur, s_workshop_id, 'working_day_end')
                    if not end_str:
                        continue

                    # Рабочий день кончился, если с момента конца дня уже прошло время.
                    # Смены, открытые ПОСЛЕ конца дня (ночная работа), не трогаем в тот же
                    # день — они закроются на следующем обходе, когда день кончится снова.
                    cur.execute(
                        "SELECT now() > (%s::date + %s::time) AND %s < (%s::date + %s::time)",
                        (opened_at, end_str, opened_at, opened_at, end_str),
                    )
                    should_close = bool(cur.fetchone()[0])
                    if not should_close:
                        continue

                    # Для штрафа считаем только ЛИЧНУЮ незавершённую работу. Упаковщицу
                    # держит общая очередь стикеровки по цеху — закрыть смену она с ней не
                    # может, но штрафовать её повышенным штрафом за заказы, которые швеи
                    # скинули в очередь под конец дня, несправедливо: это не её работа.
                    orders_left = count_orders_in_work(cur, s_user_id, s_role)

                    cur.execute(
                        "UPDATE shift_sessions SET closed_at = (%s::date + %s::time) WHERE id = %s",
                        (opened_at, end_str, session_id),
                    )

                    # Смену закрыли за сотрудника — значит он забыл это сделать сам.
                    # Если при этом за ним ещё висели заказы, штраф отдельный и обычно
                    # больше: незавершённая работа дороже, чем просто забытая смена.
                    if orders_left > 0:
                        penalty = get_setting(cur, s_workshop_id, 'unclosed_shift_with_orders_penalty')
                        description = f'Штраф за незакрытую смену с заказами ({orders_left} шт.)'
                    else:
                        penalty = get_setting(cur, s_workshop_id, 'unclosed_shift_penalty')
                        description = 'Штраф за незакрытую смену'

                    try:
                        penalty_amount = float(penalty) if penalty else 0
                    except ValueError:
                        penalty_amount = 0
                    if penalty_amount > 0:
                        apply_penalty(cur, s_user_id, penalty_amount, description, session_id)

                    closed.append(
                        {
                            'userId': s_user_id,
                            'name': s_name,
                            'ordersInWork': orders_left,
                            'penalty': penalty_amount,
                        }
                    )

                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'closedCount': len(closed), 'closed': closed}),
                }

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}