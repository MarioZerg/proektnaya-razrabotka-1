"""Отпуска сотрудников.

Годовой отпуск — 28 календарных дней. Его делят на две равные части:
раз в полгода один отпуск ровно на 14 дней подряд. Первые полгода
после выхода на работу отпуск закрыт. В один день может уйти только
один сотрудник, чтобы смена не осталась без людей.
"""
import calendar
from datetime import date, timedelta

# Половина годового отпуска: новое окно каждые полгода.
PERIOD_DAYS = 14


def ensure_schema(cur):
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hired_at date")
    cur.execute(
        "CREATE TABLE IF NOT EXISTS employee_vacations ("
        "  id SERIAL PRIMARY KEY,"
        "  user_id INTEGER NOT NULL REFERENCES users(id),"
        "  date_from DATE NOT NULL,"
        "  date_to DATE NOT NULL,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  CHECK (date_to >= date_from)"
        ")"
    )


def _add_months(day, months):
    month_index = day.month - 1 + months
    year = day.year + month_index // 12
    month = month_index % 12 + 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last))


def _parse_date(value):
    if not value:
        return None
    text = str(value)[:10]
    try:
        year, month, day = (int(part) for part in text.split('-'))
        return date(year, month, day)
    except (TypeError, ValueError):
        return None


def _days_inclusive(start, end):
    return (end - start).days + 1


def _today(cur):
    cur.execute("SELECT (now() AT TIME ZONE 'Europe/Moscow')::date")
    return cur.fetchone()[0]


def _period_start(hired, index):
    """Начало полугодия: 0 — день выхода, 1 — через полгода, и дальше."""
    return _add_months(hired, 6 * index)


def _period_index(hired, day):
    """Какое полугодие содержит день. До выхода — нет окна."""
    if day < hired:
        return -1
    index = 0
    while _period_start(hired, index + 1) <= day:
        index += 1
        if index > 80:
            break
    return index


def _overlap_days(start, end, period_from, period_to):
    """Сколько дней брони попало в полугодие. period_to — не включая этот день."""
    left = max(start, period_from)
    right = min(end, period_to - timedelta(days=1))
    if left > right:
        return 0
    return _days_inclusive(left, right)


def _balance(hired, bookings, today):
    """Текущее полугодие: один отпуск ровно на 14 дней, без удлинения.

    Пропущенное окно не прибавляет дни к следующему. Иначе отпуск
    перестал бы быть ровно двумя неделями и смена на две недели
    оставалась бы без человека дольше, чем можно.
    """
    eligible = _add_months(hired, 6)
    current = _period_index(hired, today)
    if current < 1:
        return {
            'eligible': eligible,
            'period_from': None,
            'period_to': None,
            'carried': 0,
            'taken': False,
            'trip_days': PERIOD_DAYS,
            'days_left': 0,
        }
    start = _period_start(hired, current)
    end = _period_start(hired, current + 1)
    used = sum(_overlap_days(a, b, start, end) for a, b in bookings)
    return {
        'eligible': eligible,
        'period_from': start,
        'period_to': end - timedelta(days=1),
        'carried': 0,
        'taken': used > 0,
        'trip_days': PERIOD_DAYS,
        'days_left': 0 if used else PERIOD_DAYS,
    }


def board(cur):
    ensure_schema(cur)
    today = _today(cur)
    cur.execute(
        "SELECT u.id, u.full_name, u.role, "
        "       NULLIF(COALESCE(u.avatar_url, u.max_avatar_url), ''), u.hired_at "
        "FROM users u "
        "WHERE u.is_active = true AND u.archived_at IS NULL "
        "  AND u.role <> 'admin' "
        "ORDER BY u.full_name"
    )
    people = []
    rows = cur.fetchall()
    ids = [r[0] for r in rows]
    bookings_by_user = {uid: [] for uid in ids}
    if ids:
        cur.execute(
            "SELECT id, user_id, date_from, date_to FROM employee_vacations "
            "WHERE user_id = ANY(%s) ORDER BY date_from",
            (ids,),
        )
        for bid, uid, start, end in cur.fetchall():
            bookings_by_user.setdefault(uid, []).append({
                'id': bid,
                'from': start.isoformat(),
                'to': end.isoformat(),
                'days': _days_inclusive(start, end),
            })

    for uid, name, role, avatar, hired in rows:
        raw = []
        for item in bookings_by_user.get(uid, []):
            start = _parse_date(item['from'])
            end = _parse_date(item['to'])
            if start and end:
                raw.append((start, end))
        balance = _balance(hired, raw, today) if hired else None
        people.append({
            'id': uid,
            'fullName': name,
            'role': role,
            'avatarUrl': avatar,
            'hiredAt': hired.isoformat() if hired else None,
            'eligibleFrom': balance['eligible'].isoformat() if balance else None,
            'periodFrom': balance['period_from'].isoformat() if balance and balance['period_from'] else None,
            'periodTo': balance['period_to'].isoformat() if balance and balance['period_to'] else None,
            'carriedDays': balance['carried'] if balance else 0,
            'takenThisPeriod': balance['taken'] if balance else False,
            'tripDays': balance['trip_days'] if balance else PERIOD_DAYS,
            'daysLeft': balance['days_left'] if balance else 0,
            'bookings': bookings_by_user.get(uid, []),
        })
    return {
        'today': today.isoformat(),
        'periodDays': PERIOD_DAYS,
        'allowance': PERIOD_DAYS,
        'people': people,
    }


def book(cur, user_id, date_from, date_to):
    ensure_schema(cur)
    start = _parse_date(date_from)
    end = _parse_date(date_to)
    if not start or not end or end < start:
        return 'Укажите даты отпуска'
    today = _today(cur)
    if start <= today:
        return 'Отпуск бронируют заранее, со следующего дня'
    cur.execute(
        "SELECT hired_at, is_active, archived_at IS NOT NULL "
        "FROM users WHERE id = %s",
        (int(user_id),),
    )
    row = cur.fetchone()
    if not row or not row[1] or row[2]:
        return 'Сотрудник не найден'
    if not row[0]:
        return 'Администратор ещё не указал дату выхода на работу'
    hired = row[0]
    current = _period_index(hired, today)
    if current < 1:
        eligible = _add_months(hired, 6)
        return f'Отпуск можно выбрать с {eligible.strftime("%d.%m.%Y")}'
    period_from = _period_start(hired, current)
    period_end = _period_start(hired, current + 1)
    period_to = period_end - timedelta(days=1)
    if start < period_from or end > period_to:
        return (
            'В этом полугодии отпуск можно выбрать '
            f'с {period_from.strftime("%d.%m.%Y")} по {period_to.strftime("%d.%m.%Y")}'
        )
    span = _days_inclusive(start, end)
    cur.execute(
        "SELECT date_from, date_to FROM employee_vacations WHERE user_id = %s",
        (int(user_id),),
    )
    history = [(a, b) for a, b in cur.fetchall()]
    if _overlap_days(start, end, period_from, period_end) and any(
        _overlap_days(a, b, period_from, period_end) for a, b in history
    ):
        return 'В этом полугодии отпуск уже выбран — второй раз уйти нельзя'
    balance = _balance(hired, history, today)
    if balance['taken']:
        return 'В этом полугодии отпуск уже выбран — второй раз уйти нельзя'
    if span != PERIOD_DAYS:
        return 'Отпуск — ровно 14 дней подряд, один раз за полугодие'
    cur.execute(
        "SELECT u.full_name FROM employee_vacations v "
        "JOIN users u ON u.id = v.user_id "
        "WHERE daterange(v.date_from, v.date_to, '[]') && daterange(%s, %s, '[]') "
        "LIMIT 1",
        (start, end),
    )
    clash = cur.fetchone()
    if clash:
        return f'Эти дни уже заняты: {clash[0]}'
    cur.execute(
        "INSERT INTO employee_vacations (user_id, date_from, date_to) "
        "VALUES (%s, %s, %s) RETURNING id",
        (int(user_id), start, end),
    )
    return None


def cancel(cur, booking_id, actor_id, is_admin):
    ensure_schema(cur)
    cur.execute(
        "SELECT user_id, date_from FROM employee_vacations WHERE id = %s",
        (int(booking_id),),
    )
    row = cur.fetchone()
    if not row:
        return 'Бронь не найдена'
    if not is_admin and int(row[0]) != int(actor_id):
        return 'Снять можно только свой отпуск'
    today = _today(cur)
    if row[1] <= today and not is_admin:
        return 'Начавшийся отпуск снимает администратор'
    cur.execute("DELETE FROM employee_vacations WHERE id = %s", (int(booking_id),))
    return None
