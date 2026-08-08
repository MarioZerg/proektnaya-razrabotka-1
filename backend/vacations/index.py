import json
import os
from datetime import date, datetime, timedelta

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

# Отпуск длится две недели.
VACATION_DAYS = 14
# За рабочий год положено два отпуска.
VACATIONS_PER_YEAR = 2
# Должности, которым положен отпуск по этим правилам.
VACATION_ROLES = ('sewer', 'cutter', 'packer', 'storekeeper', 'senior_storekeeper', 'cleaner')


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def work_year_of(first_date, start):
    """Какой это рабочий год относительно даты первого отпуска.

    Рабочий год считается не с января, а от даты первого отпуска сотрудника:
    год 1 — первые 12 месяцев от неё, год 2 — следующие и так далее.
    """
    if not first_date:
        return 1
    months = (start.year - first_date.year) * 12 + (start.month - first_date.month)
    if start.day < first_date.day:
        months -= 1
    return max(1, months // 12 + 1)


def year_bounds(first_date, work_year):
    """Начало и конец указанного рабочего года."""
    start = date(first_date.year + work_year - 1, first_date.month, first_date.day)
    end = date(first_date.year + work_year, first_date.month, first_date.day) - timedelta(days=1)
    return start, end


def next_available_date(cur, user_id):
    """Когда сотруднику можно в следующий отпуск.

    Возвращает словарь с датой, номером рабочего года и пояснением. Если дата первого
    отпуска не задана, вернём подсказку — без неё отсчёт вести не от чего.
    """
    cur.execute(
        "SELECT first_vacation_date, workshop, shift_number, role, full_name "
        "FROM users WHERE id = %s",
        (int(user_id),),
    )
    row = cur.fetchone()
    if not row:
        return None

    first_date = row[0]
    if not first_date:
        return {
            'firstVacationDate': None,
            'nextDate': None,
            'reason': 'Не указана дата первого отпуска — задайте её в профиле',
            'usedInYear': 0,
            'workYear': 1,
        }

    today = date.today()
    # Отпуска считаем по рабочим годам: в каждом положено VACATIONS_PER_YEAR штук.
    cur.execute(
        "SELECT starts_on, ends_on, work_year FROM vacations "
        "WHERE user_id = %s AND cancelled_at IS NULL ORDER BY starts_on",
        (int(user_id),),
    )
    taken = cur.fetchall()

    current_year = max(1, work_year_of(first_date, today))
    used = [t for t in taken if t[2] == current_year]

    # Ближайшая возможная дата: сразу после последнего отпуска, но не раньше сегодня.
    candidate = today
    if taken:
        last_end = max(t[1] for t in taken)
        if last_end >= today:
            candidate = last_end + timedelta(days=1)

    if len(used) >= VACATIONS_PER_YEAR:
        # Лимит года исчерпан — следующий отпуск только в новом рабочем году.
        _, year_end = year_bounds(first_date, current_year)
        candidate = max(candidate, year_end + timedelta(days=1))
        current_year += 1
        used = []

    # Первый отпуск не может начаться раньше назначенной даты.
    if not taken and candidate < first_date:
        candidate = first_date

    return {
        'firstVacationDate': first_date,
        'nextDate': candidate,
        'workYear': current_year,
        'usedInYear': len(used),
        'perYear': VACATIONS_PER_YEAR,
        'days': VACATION_DAYS,
        'reason': None,
    }


def check_conflict(cur, user_id, starts_on, ends_on):
    """Проверяет, что в эти даты смена не останется без людей.

    Одновременно отдыхать может только один человек от смены цеха: если уйдут двое,
    работать будет некому. В разных сменах отпуска пересекаться могут.
    """
    cur.execute("SELECT workshop, shift_number FROM users WHERE id = %s", (int(user_id),))
    u = cur.fetchone()
    if not u:
        return None
    workshop_name, shift_number = u[0], u[1]
    if not workshop_name or shift_number is None:
        return None

    cur.execute("SELECT id FROM workshops WHERE name = %s", (workshop_name,))
    w = cur.fetchone()
    workshop_id = w[0] if w else None
    if not workshop_id:
        return None

    cur.execute(
        "SELECT v.id, u.full_name, v.starts_on, v.ends_on FROM vacations v "
        "JOIN users u ON u.id = v.user_id "
        "WHERE v.cancelled_at IS NULL AND v.workshop_id = %s AND v.shift_number = %s "
        "AND v.user_id <> %s AND v.starts_on <= %s AND v.ends_on >= %s LIMIT 1",
        (workshop_id, shift_number, int(user_id), ends_on, starts_on),
    )
    return cur.fetchone()


def handler(event: dict, context) -> dict:
    """Отпуска сотрудников: список, оформление и отмена.

    Отпуск длится 2 недели, положено 2 отпуска за рабочий год (год отсчитывается от даты
    первого отпуска сотрудника). Одновременно в отпуске может быть только один человек
    от смены цеха — иначе смене некому работать.

    GET  /                       - список отпусков и права сотрудников
    GET  /?userId=5              - когда сотруднику можно в следующий отпуск
    POST /  { action: 'create', userId, startsOn, comment?, actorId? }
    POST /  { action: 'cancel', id, actorId? }
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            user_id = params.get('userId')
            if user_id:
                info = next_available_date(cur, user_id)
                if info is None:
                    return _resp(404, {'error': 'Сотрудник не найден'})
                return _resp(200, info)

            cur.execute(
                "SELECT v.id, v.user_id, u.full_name, u.role, v.starts_on, v.ends_on, "
                "v.work_year, COALESCE(v.comment, ''), w.name, v.shift_number, "
                "v.cancelled_at IS NOT NULL "
                "FROM vacations v JOIN users u ON u.id = v.user_id "
                "LEFT JOIN workshops w ON w.id = v.workshop_id "
                "ORDER BY v.starts_on DESC LIMIT 300"
            )
            items = [
                {
                    'id': r[0],
                    'userId': r[1],
                    'userName': r[2],
                    'role': r[3],
                    'startsOn': r[4],
                    'endsOn': r[5],
                    'workYear': r[6],
                    'comment': r[7],
                    'workshopName': r[8],
                    'shiftNumber': r[9],
                    'cancelled': r[10],
                }
                for r in cur.fetchall()
            ]
            return _resp(200, {'items': items})

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        if action == 'create':
            user_id = body_data.get('userId')
            starts_on = (body_data.get('startsOn') or '').strip()
            if not user_id or not starts_on:
                return _resp(400, {'error': 'Укажите сотрудника и дату начала'})

            try:
                start = datetime.strptime(starts_on[:10], '%Y-%m-%d').date()
            except ValueError:
                return _resp(400, {'error': 'Неверный формат даты'})
            end = start + timedelta(days=VACATION_DAYS - 1)

            cur.execute(
                "SELECT role, first_vacation_date, workshop, shift_number FROM users WHERE id = %s",
                (int(user_id),),
            )
            u_row = cur.fetchone()
            if not u_row:
                return _resp(404, {'error': 'Сотрудник не найден'})
            if u_row[0] not in VACATION_ROLES:
                return _resp(409, {'error': 'Этой должности отпуск по графику не оформляется'})

            first_date = u_row[1]
            if not first_date:
                # Первый отпуск задаёт точку отсчёта рабочего года — сохраняем её в профиль.
                first_date = start
                cur.execute(
                    "UPDATE users SET first_vacation_date = %s, updated_at = now() WHERE id = %s",
                    (start, int(user_id)),
                )
            if start < first_date:
                return _resp(409, {
                    'error': f'Отпуск не может начаться раньше {first_date.strftime("%d.%m.%Y")} — '
                             f'это дата первого отпуска сотрудника'
                })

            work_year = work_year_of(first_date, start)

            # Не больше двух отпусков за рабочий год.
            cur.execute(
                "SELECT COUNT(*) FROM vacations WHERE user_id = %s AND work_year = %s "
                "AND cancelled_at IS NULL",
                (int(user_id), work_year),
            )
            if int(cur.fetchone()[0]) >= VACATIONS_PER_YEAR:
                y_start, y_end = year_bounds(first_date, work_year)
                return _resp(409, {
                    'error': f'За период с {y_start.strftime("%d.%m.%Y")} по '
                             f'{y_end.strftime("%d.%m.%Y")} сотрудник уже отгулял '
                             f'{VACATIONS_PER_YEAR} отпуска'
                })

            # Свои отпуска не должны накладываться друг на друга.
            cur.execute(
                "SELECT id FROM vacations WHERE user_id = %s AND cancelled_at IS NULL "
                "AND starts_on <= %s AND ends_on >= %s LIMIT 1",
                (int(user_id), end, start),
            )
            if cur.fetchone():
                return _resp(409, {'error': 'На эти даты у сотрудника уже оформлен отпуск'})

            conflict = check_conflict(cur, user_id, start, end)
            if conflict:
                return _resp(409, {
                    'error': f'В эти даты уже отдыхает {conflict[1]} '
                             f'({conflict[2].strftime("%d.%m")}–{conflict[3].strftime("%d.%m")}). '
                             f'Одновременно от смены может отдыхать только один человек'
                })

            workshop_id = None
            if u_row[2]:
                cur.execute("SELECT id FROM workshops WHERE name = %s", (u_row[2],))
                w = cur.fetchone()
                workshop_id = w[0] if w else None

            actor_id = body_data.get('actorId')
            cur.execute(
                "INSERT INTO vacations (user_id, workshop_id, shift_number, starts_on, ends_on, "
                "work_year, comment, created_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    int(user_id), workshop_id, u_row[3], start, end, work_year,
                    (body_data.get('comment') or '').strip() or None,
                    int(actor_id) if actor_id else None,
                ),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return _resp(200, {'id': new_id, 'startsOn': start, 'endsOn': end, 'workYear': work_year})

        if action == 'cancel':
            item_id = body_data.get('id')
            if not item_id:
                return _resp(400, {'error': 'Укажите id'})
            actor_id = body_data.get('actorId')
            cur.execute(
                "UPDATE vacations SET cancelled_at = now(), cancelled_by = %s "
                "WHERE id = %s AND cancelled_at IS NULL",
                (int(actor_id) if actor_id else None, int(item_id)),
            )
            conn.commit()
            return _resp(200, {'success': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()
