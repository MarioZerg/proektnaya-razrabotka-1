import json
import os

import psycopg2


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
    GET  /?calendar=1&workshop_id=1&shift_number=1&month=YYYY-MM
                                             - список дат-выходных в этом месяце для смены
    POST /  { action: 'create', workshopId, name, shiftNumber? }
        - создаёт смену; shiftNumber по умолчанию — следующий свободный номер в цехе
    POST /  { action: 'update', id, name?, isActive? }
        - isActive=false выключает смену — все её сотрудники смогут работать в любой смене
    POST /  { action: 'delete', id }
        - запрещено, если в смене ещё есть сотрудники
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

            if params.get('calendar'):
                wid = params.get('workshop_id')
                snum = params.get('shift_number')
                month = params.get('month')
                if not wid or not snum or not month:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите workshop_id, shift_number и month=YYYY-MM'})}
                month_esc = month.replace("'", "''")
                cur.execute(
                    f"SELECT calendar_date FROM shift_calendar WHERE workshop_id = {int(wid)} "
                    f"AND shift_number = {int(snum)} AND to_char(calendar_date, 'YYYY-MM') = '{month_esc}'"
                )
                days_off = [r[0].isoformat() for r in cur.fetchall()]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'daysOff': days_off})}

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
                    "SELECT id, full_name, role, shift_free FROM users "
                    "WHERE workshop = %s AND shift_number = %s ORDER BY full_name",
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

            if action == 'set_day_off':
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                date = body_data.get('date')
                day_off = body_data.get('dayOff')
                if not workshop_id or not shift_number or not date:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите workshopId, shiftNumber и date'})}

                date_esc = str(date).replace("'", "''")
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