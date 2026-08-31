import json
import os
from calendar import monthrange
from datetime import date, timedelta

import psycopg2


def is_cycle_day_off(cycle_work: int, cycle_off: int, start: date, day: date) -> bool:
    """Работает ли смена в этот день по цикличному графику (2/2, 3/3 и т.п.).

    Цикл считается от даты первого выхода смены: work дней работаем, off дней отдыхаем,
    и так по кругу. До даты старта смена считается нерабочей. Возвращает True, если день
    ВЫХОДНОЙ.
    """
    if not cycle_work or not cycle_off or not start:
        return False
    if day < start:
        return True
    period = cycle_work + cycle_off
    return ((day - start).days % period) >= cycle_work


def is_weekday_day_off(work_weekdays, day: date) -> bool:
    """Выходной ли день при недельном графике (5/2 и т.п.).

    work_weekdays — номера рабочих дней недели: 1 = понедельник ... 7 = воскресенье.
    Например, 5/2 с выходными в СБ/ВС — это [1, 2, 3, 4, 5].
    """
    if not work_weekdays:
        return False
    return (day.weekday() + 1) not in work_weekdays


def days_off_for_month(shift_row, year: int, month: int) -> list:
    """Даты-выходные смены в месяце: по недельному графику или по циклу (2/2, 3/3).

    shift_row = (cycle_work_days, cycle_off_days, cycle_start_date, work_weekdays).
    """
    cycle_work, cycle_off, start, weekdays = shift_row
    days_in_month = monthrange(year, month)[1]
    result = []
    for d in range(1, days_in_month + 1):
        day = date(year, month, d)
        if weekdays:
            if is_weekday_day_off(weekdays, day):
                result.append(day.isoformat())
        elif is_cycle_day_off(int(cycle_work), int(cycle_off), start, day):
            result.append(day.isoformat())
    return result


def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description, details=None):
    """Пишет запись в журнал действий (audit_log) в той же транзакции перед commit()."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'shifts',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


def sync_workshop_shift_names(cur, workshop_id):
    """Пересчитывает workshops.shift_names (JSONB-массив) и shifts_count из актуальных
    строк таблицы shifts этого цеха — чтобы весь остальной код (печать стикеров, таблица
    "Отгрузка в цех", сводка материалов в цехах), читающий workshops.shift_names, продолжал
    работать без изменений, не зная о новой таблице shifts."""
    cur.execute(
        "SELECT shift_number, name FROM shifts WHERE workshop_id = %s ORDER BY shift_number",
        (workshop_id,),
    )
    rows = cur.fetchall()
    max_number = max((r[0] for r in rows), default=0)
    names = ['' for _ in range(max_number)]
    for number, name in rows:
        names[number - 1] = name
    names_json = json.dumps(names).replace("'", "''")
    cur.execute(
        f"UPDATE workshops SET shift_names = '{names_json}'::jsonb, shifts_count = {max(max_number, 1)} "
        f"WHERE id = {int(workshop_id)}"
    )


def handler(event: dict, context) -> dict:
    """Управляет сменами как отдельной сущностью (не просто числом shifts_count у цеха) и
    ручным календарём выходных дней по сменам.

    Каждая смена — реальная строка (workshop_id, shift_number, name, is_active). Сотрудники
    добавляются В КОНКРЕТНУЮ смену (обновляет users.workshop/shift_number). Смена/цех может
    быть индивидуально выключена — тогда все её сотрудники получают "свободный график"
    (shift_free) и могут работать в любой смене (см. backend/shift_sessions).

    Календарь смен (shift_calendar) — полностью ручная разметка ВЫХОДНЫХ дней по датам:
    наличие строки = выходной (смена не работает в этот день), отсутствие = обычный рабочий
    день. Для цеха с графиком 5/2 админ вручную помечает СБ/ВС как выходные каждую неделю.

    GET  /                                  - список всех смен всех цехов
    GET  /?workshop_id=1                    - смены конкретного цеха
    GET  /?id=1                             - детальная карточка смены + список сотрудников
    GET  /?today=1                          - какие смены работают сегодня по графику
                                              (с учётом цикла 2/2, недельного 5/2 и ручных
                                              выходных) + сколько человек уже на смене
    GET  /?calendar=1&workshop_id=1&shift_number=1&month=YYYY-MM
                                             - список дат-выходных в этом месяце для смены
    POST /  { action: 'create', workshopId, name, shiftNumber? }
        - создаёт смену; shiftNumber по умолчанию — следующий свободный номер в цехе
    POST /  { action: 'update', id, name?, isActive? }
        - isActive=false выключает смену — все её сотрудники смогут работать в любой смене
    POST /  { action: 'delete', id }
        - запрещено, если в смене ещё есть сотрудники
    POST /  { action: 'set_cycle', workshopId, shiftNumber, workDays, offDays, startDate, force? }
        - цикличный график смены (2/2, 5/2 и т.п.): выходные считаются автоматически от
          даты первого выхода. Пустые значения выключают цикл. Если смена пересекается по
          рабочим дням с другой сменой цеха — возвращает 409 со списком пересечений;
          force=true сохраняет всё равно (нормально для 5/2 рядом с бригадами 2/2)
    POST /  { action: 'set_weekdays', workshopId, shiftNumber, workWeekdays: [1..7] }
        - недельный график (5/2): указываются рабочие дни недели, 1 = понедельник.
          Пустой список выключает недельный график
    POST /  { action: 'add_employee', shiftId, userId }
        - добавляет сотрудника в смену (users.workshop/shift_number = смены), сбрасывает
          гостевой режим (shift_free = false) — сотрудник снова жёстко привязан
    POST /  { action: 'remove_employee', userId }
        - убирает сотрудника из текущей смены (shift_number = NULL), цех в профиле остаётся
    POST /  { action: 'set_day_off', workshopId, shiftNumber, date, dayOff }
        - dayOff=true помечает дату выходным для этой смены, false — снимает пометку

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/детальными данными/результатом операции
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
        shift_id = params.get('id')
        workshop_id_filter = params.get('workshop_id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if params.get('today'):
                # Кто по графику должен быть в цехе сегодня: смена работает, если день не
                # отмечен выходным вручную, не выпадает на отдых по циклу (2/2) и попадает
                # в рабочие дни недели (5/2). Плюс сколько человек уже открыли смену.
                cur.execute(
                    "SELECT s.workshop_id, w.name, s.shift_number, s.name, "
                    "(SELECT COUNT(*) FROM shift_sessions ss WHERE ss.workshop_id = s.workshop_id "
                    "  AND ss.shift_number = s.shift_number AND ss.closed_at IS NULL) "
                    "FROM shifts s JOIN workshops w ON w.id = s.workshop_id "
                    "WHERE s.is_active = true AND w.is_active = true "
                    "AND NOT EXISTS (SELECT 1 FROM shift_calendar sc "
                    "  WHERE sc.workshop_id = s.workshop_id AND sc.shift_number = s.shift_number "
                    "  AND sc.calendar_date = (now() + interval '3 hours')::date) "
                    "AND NOT (s.cycle_work_days IS NOT NULL AND s.cycle_off_days IS NOT NULL "
                    "  AND s.cycle_start_date IS NOT NULL "
                    "  AND ((now() + interval '3 hours')::date < s.cycle_start_date "
                    "    OR MOD(((now() + interval '3 hours')::date - s.cycle_start_date), "
                    "           (s.cycle_work_days + s.cycle_off_days)) >= s.cycle_work_days)) "
                    "AND NOT (s.work_weekdays IS NOT NULL "
                    "  AND NOT (EXTRACT(ISODOW FROM (now() + interval '3 hours')::date)::int = ANY(s.work_weekdays))) "
                    "ORDER BY w.id, s.shift_number"
                )
                working = [
                    {
                        'workshopId': r[0],
                        'workshopName': r[1],
                        'shiftNumber': r[2],
                        'shiftName': r[3],
                        'openedCount': r[4],
                    }
                    for r in cur.fetchall()
                ]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'working': working})}

            if params.get('calendar'):
                wid = params.get('workshop_id')
                snum = params.get('shift_number')
                month = params.get('month')
                if not wid or not snum or not month:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите workshop_id, shift_number и month=YYYY-MM'})}
                month_esc = month.replace("'", "''")

                # Если у смены задан цикл (2/2 и т.п.) — выходные считаются автоматически
                # от даты первого выхода, ручные отметки для неё не нужны.
                cur.execute(
                    "SELECT cycle_work_days, cycle_off_days, cycle_start_date, work_weekdays "
                    "FROM shifts WHERE workshop_id = %s AND shift_number = %s",
                    (int(wid), int(snum)),
                )
                cyc = cur.fetchone()
                has_weekdays = bool(cyc and cyc[3])
                has_cycle = bool(cyc and cyc[0] and cyc[1] and cyc[2])
                if has_weekdays or has_cycle:
                    year, mon = int(month[:4]), int(month[5:7])
                    days_off = days_off_for_month(cyc, year, mon)
                    return {
                        'statusCode': 200,
                        'headers': headers,
                        'body': json.dumps({
                            'daysOff': days_off,
                            'cycle': None if has_weekdays else {
                                'workDays': cyc[0],
                                'offDays': cyc[1],
                                'startDate': cyc[2].isoformat(),
                            },
                            'workWeekdays': cyc[3] if has_weekdays else None,
                        }),
                    }

                cur.execute(
                    f"SELECT calendar_date FROM shift_calendar WHERE workshop_id = {int(wid)} "
                    f"AND shift_number = {int(snum)} AND to_char(calendar_date, 'YYYY-MM') = '{month_esc}'"
                )
                days_off = [r[0].isoformat() for r in cur.fetchall()]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'daysOff': days_off, 'cycle': None})}

            if shift_id:
                cur.execute(
                    "SELECT s.id, s.workshop_id, w.name, s.shift_number, s.name, s.is_active, w.is_active, "
                    "s.created_at, s.updated_at FROM shifts s JOIN workshops w ON w.id = s.workshop_id "
                    "WHERE s.id = %s",
                    (int(shift_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Смена не найдена'})}

                cur.execute(
                    # Уволенных (архив) в составе смены не показываем: смена — это
                    # кто выйдет на работу, а не кто когда-то в ней числился.
                    "SELECT id, full_name, role, shift_free FROM users "
                    "WHERE workshop = %s AND shift_number = %s "
                    "AND is_active = true AND archived_at IS NULL ORDER BY full_name",
                    (row[2], row[3]),
                )
                employees = [
                    {'id': r[0], 'fullName': r[1], 'role': r[2], 'shiftFree': r[3]}
                    for r in cur.fetchall()
                ]

                detail = {
                    'id': row[0],
                    'workshopId': row[1],
                    'workshopName': row[2],
                    'shiftNumber': row[3],
                    'name': row[4],
                    'isActive': row[5],
                    'workshopIsActive': row[6],
                    'createdAt': row[7].isoformat() + 'Z',
                    'updatedAt': row[8].isoformat() + 'Z',
                    'employees': employees,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shift': detail})}

            where_clause = f"WHERE s.workshop_id = {int(workshop_id_filter)}" if workshop_id_filter else ""
            cur.execute(
                f"SELECT s.id, s.workshop_id, w.name, s.shift_number, s.name, s.is_active, w.is_active, "
                f"(SELECT COUNT(*) FROM users u WHERE u.workshop = w.name AND u.shift_number = s.shift_number) "
                f"FROM shifts s JOIN workshops w ON w.id = s.workshop_id "
                f"{where_clause} ORDER BY s.workshop_id, s.shift_number"
            )
            shifts = [
                {
                    'id': r[0],
                    'workshopId': r[1],
                    'workshopName': r[2],
                    'shiftNumber': r[3],
                    'name': r[4],
                    'isActive': r[5],
                    'workshopIsActive': r[6],
                    'employeesCount': r[7],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shifts': shifts})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                workshop_id = body_data.get('workshopId')
                name = (body_data.get('name') or '').strip()
                shift_number = body_data.get('shiftNumber')

                if not workshop_id or not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите цех и название смены'})}

                cur.execute("SELECT id FROM workshops WHERE id = %s", (int(workshop_id),))
                if not cur.fetchone():
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Цех не найден'})}

                if not shift_number:
                    cur.execute(
                        "SELECT COALESCE(MAX(shift_number), 0) + 1 FROM shifts WHERE workshop_id = %s",
                        (int(workshop_id),),
                    )
                    shift_number = cur.fetchone()[0]
                else:
                    cur.execute(
                        "SELECT id FROM shifts WHERE workshop_id = %s AND shift_number = %s",
                        (int(workshop_id), int(shift_number)),
                    )
                    if cur.fetchone():
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Смена № {shift_number} в этом цехе уже существует'})}

                name_esc = name.replace("'", "''")
                cur.execute(
                    f"INSERT INTO shifts (workshop_id, shift_number, name) "
                    f"VALUES ({int(workshop_id)}, {int(shift_number)}, '{name_esc}') RETURNING id"
                )
                new_id = cur.fetchone()[0]
                sync_workshop_shift_names(cur, int(workshop_id))

                log_action(
                    cur, actor_id, actor_name, 'create', 'shift', new_id,
                    f'Создал смену "{name}" (№ {shift_number}) в цехе #{workshop_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update':
                shift_id = body_data.get('id')
                if not shift_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute("SELECT workshop_id FROM shifts WHERE id = %s", (int(shift_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Смена не найдена'})}
                workshop_id = row[0]

                fields = []
                if 'name' in body_data:
                    fields.append(f"name = '{str(body_data['name']).replace(chr(39), chr(39)*2)}'")
                if 'isActive' in body_data:
                    fields.append(f"is_active = {'true' if body_data['isActive'] else 'false'}")
                fields.append("updated_at = now()")

                cur.execute(f"UPDATE shifts SET {', '.join(fields)} WHERE id = {int(shift_id)}")
                sync_workshop_shift_names(cur, workshop_id)

                log_action(
                    cur, actor_id, actor_name, 'update', 'shift', shift_id,
                    f'Изменил смену #{shift_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                shift_id = body_data.get('id')
                if not shift_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute(
                    "SELECT s.workshop_id, w.name, s.shift_number FROM shifts s "
                    "JOIN workshops w ON w.id = s.workshop_id WHERE s.id = %s",
                    (int(shift_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Смена не найдена'})}
                workshop_id, workshop_name, shift_number = row

                cur.execute(
                    "SELECT COUNT(*) FROM users WHERE workshop = %s AND shift_number = %s",
                    (workshop_name, shift_number),
                )
                if cur.fetchone()[0] > 0:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В смене ещё есть сотрудники — сначала переведите их в другую смену'})}

                cur.execute("DELETE FROM shift_calendar WHERE workshop_id = %s AND shift_number = %s", (workshop_id, shift_number))
                cur.execute("DELETE FROM shifts WHERE id = %s", (int(shift_id),))
                sync_workshop_shift_names(cur, workshop_id)

                log_action(
                    cur, actor_id, actor_name, 'delete', 'shift', shift_id,
                    f'Удалил смену #{shift_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'add_employee':
                shift_id = body_data.get('shiftId')
                user_id = body_data.get('userId')
                if not shift_id or not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите shiftId и userId'})}

                cur.execute(
                    "SELECT w.name, s.shift_number FROM shifts s JOIN workshops w ON w.id = s.workshop_id WHERE s.id = %s",
                    (int(shift_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Смена не найдена'})}
                workshop_name, shift_number = row
                workshop_name_esc = workshop_name.replace("'", "''")

                cur.execute(
                    f"UPDATE users SET workshop = '{workshop_name_esc}', shift_number = {shift_number}, "
                    f"shift_free = false, updated_at = now() WHERE id = {int(user_id)}"
                )
                log_action(
                    cur, actor_id, actor_name, 'add_employee', 'shift', shift_id,
                    f'Добавил сотрудника #{user_id} в смену #{shift_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'remove_employee':
                user_id = body_data.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(f"UPDATE users SET shift_number = NULL, updated_at = now() WHERE id = {int(user_id)}")
                log_action(
                    cur, actor_id, actor_name, 'remove_employee', 'user', user_id,
                    f'Убрал сотрудника #{user_id} из смены',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'set_cycle':
                # Цикличный график смены (2/2, 3/3): работает work дней, отдыхает off дней,
                # отсчёт от даты первого выхода. Система проверяет, что вторая смена цеха
                # не выходит в те же дни — иначе в цехе окажутся сразу две смены.
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                work_days = body_data.get('workDays')
                off_days = body_data.get('offDays')
                start_date = body_data.get('startDate')
                if not workshop_id or not shift_number:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите workshopId и shiftNumber'})}

                # Пустые значения = выключить цикл, вернуться к ручной отметке выходных.
                if not work_days or not off_days or not start_date:
                    cur.execute(
                        "UPDATE shifts SET cycle_work_days = NULL, cycle_off_days = NULL, "
                        "cycle_start_date = NULL WHERE workshop_id = %s AND shift_number = %s",
                        (int(workshop_id), int(shift_number)),
                    )
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'cycle': None})}

                work_days, off_days = int(work_days), int(off_days)
                start = date.fromisoformat(str(start_date))
                if work_days < 1 or off_days < 1:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Дни работы и отдыха должны быть больше нуля'})}

                # Проверяем пересечение с другими сменами цеха на горизонте одного цикла.
                cur.execute(
                    "SELECT shift_number, name, cycle_work_days, cycle_off_days, cycle_start_date "
                    "FROM shifts WHERE workshop_id = %s AND shift_number <> %s AND is_active = true "
                    "AND cycle_work_days IS NOT NULL",
                    (int(workshop_id), int(shift_number)),
                )
                # Пересечение — не всегда ошибка: смена 5/2 в цехе с двумя сменами 2/2
                # обязана работать одновременно с ними (это разные бригады). Поэтому
                # сообщаем о совпадении и даём сохранить повторным запросом с force.
                period = work_days + off_days
                overlaps = []
                for other in cur.fetchall():
                    for i in range(max(period, other[2] + other[3]) * 2):
                        day = start + timedelta(days=i)
                        mine_off = is_cycle_day_off(work_days, off_days, start, day)
                        their_off = is_cycle_day_off(other[2], other[3], other[4], day)
                        if not mine_off and not their_off:
                            overlaps.append({'date': day.isoformat(), 'shiftName': other[1]})
                            break

                if overlaps and not body_data.get('force'):
                    names = ', '.join(f'«{o["shiftName"]}»' for o in overlaps)
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Смена будет работать одновременно со сменами: {names} '
                                     f'(например {overlaps[0]["date"]})',
                            'overlaps': overlaps,
                            'canForce': True,
                        }),
                    }

                # Цикл и недельный график взаимоисключающие — включаем один, гасим другой.
                cur.execute(
                    "UPDATE shifts SET cycle_work_days = %s, cycle_off_days = %s, "
                    "cycle_start_date = %s, work_weekdays = NULL "
                    "WHERE workshop_id = %s AND shift_number = %s",
                    (work_days, off_days, start, int(workshop_id), int(shift_number)),
                )
                # Ручные отметки больше не нужны — выходные теперь считаются по циклу.
                cur.execute(
                    "DELETE FROM shift_calendar WHERE workshop_id = %s AND shift_number = %s",
                    (int(workshop_id), int(shift_number)),
                )
                log_action(
                    cur, actor_id, actor_name, 'set_cycle', 'shift', None,
                    f'График смены №{shift_number}: {work_days}/{off_days} с {start.isoformat()}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'cycle': {'workDays': work_days, 'offDays': off_days, 'startDate': start.isoformat()},
                    }),
                }

            if action == 'set_weekdays':
                # Недельный график (5/2 и любой другой): админ указывает, в какие дни недели
                # смена выходит — 1 понедельник ... 7 воскресенье. Остальные дни выходные.
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                weekdays = body_data.get('workWeekdays')
                if not workshop_id or not shift_number:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите workshopId и shiftNumber'})}

                if not weekdays:
                    cur.execute(
                        "UPDATE shifts SET work_weekdays = NULL "
                        "WHERE workshop_id = %s AND shift_number = %s",
                        (int(workshop_id), int(shift_number)),
                    )
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'workWeekdays': None})}

                days = sorted({int(d) for d in weekdays if 1 <= int(d) <= 7})
                if not days:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите хотя бы один рабочий день недели'})}

                cur.execute(
                    "UPDATE shifts SET work_weekdays = %s, cycle_work_days = NULL, "
                    "cycle_off_days = NULL, cycle_start_date = NULL "
                    "WHERE workshop_id = %s AND shift_number = %s",
                    (days, int(workshop_id), int(shift_number)),
                )
                cur.execute(
                    "DELETE FROM shift_calendar WHERE workshop_id = %s AND shift_number = %s",
                    (int(workshop_id), int(shift_number)),
                )
                log_action(
                    cur, actor_id, actor_name, 'set_weekdays', 'shift', None,
                    f'Недельный график смены №{shift_number}: рабочие дни {days}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'workWeekdays': days}),
                }

            if action == 'set_day_off':
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                day_date = body_data.get('date')
                day_off = body_data.get('dayOff')
                if not workshop_id or not shift_number or not day_date:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите workshopId, shiftNumber и date'})}

                date_esc = str(day_date).replace("'", "''")
                if day_off:
                    cur.execute(
                        f"INSERT INTO shift_calendar (workshop_id, shift_number, calendar_date, created_by) "
                        f"VALUES ({int(workshop_id)}, {int(shift_number)}, '{date_esc}', "
                        f"{int(actor_id) if actor_id else 'NULL'}) "
                        f"ON CONFLICT (workshop_id, shift_number, calendar_date) DO NOTHING"
                    )
                else:
                    cur.execute(
                        f"DELETE FROM shift_calendar WHERE workshop_id = {int(workshop_id)} "
                        f"AND shift_number = {int(shift_number)} AND calendar_date = '{date_esc}'"
                    )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}