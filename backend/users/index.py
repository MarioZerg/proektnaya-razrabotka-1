import base64
import hashlib
import json
import os
import re
import secrets
import uuid

import boto3
import psycopg2


ROLES = {'sewer', 'cutter', 'packer', 'storekeeper', 'senior_storekeeper', 'cleaner', 'admin', 'manager'}


# График по умолчанию для каждой должности. Цех работает сменами 2/2 по 12 часов,
# склад и офис — обычной пятидневкой. Нужен, чтобы новичку не выставлять время вручную.
SCHEDULE_BY_ROLE = {
    'sewer': ('2/2', '07:00', '19:00'),
    'cutter': ('2/2', '07:00', '19:00'),
    'packer': ('2/2', '07:00', '19:00'),
    'storekeeper': ('5/2', '08:00', '17:00'),
    'senior_storekeeper': ('5/2', '08:00', '17:00'),
    'manager': ('5/2', '08:00', '17:00'),
    'cleaner': ('5/2', '08:00', '17:00'),
}


def default_schedule_for_role(role):
    """Возвращает (график, начало, конец) по должности или (None, None, None)."""
    return SCHEDULE_BY_ROLE.get((role or '').strip(), (None, None, None))


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 100000).hex()


def upload_avatar(base64_data: str) -> str:
    header, _, data = base64_data.partition(',')
    ext = 'png'
    if 'jpeg' in header or 'jpg' in header:
        ext = 'jpg'
    elif 'webp' in header:
        ext = 'webp'
    binary = base64.b64decode(data)

    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'avatars/{uuid.uuid4().hex}.{ext}'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType=f'image/{ext}')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def handler(event: dict, context) -> dict:
    """Управляет сотрудниками: список, создание, редактирование, график смен, зарплата, аватар.

    GET  /  - список пользователей. Каждый включает maxUserId (привязанный MAX-аккаунт,
              заполняется автоматически при входе через бота), phone, registeredViaMax
              (true, если человек сам зарегистрировался через MAX, а не создан админом),
              и roles — список всех должностей пользователя вида
              [{role, isApproved}] (утверждённые админом отображаются в интерфейсе,
              неутверждённые ждут решения администратора).
    POST /  { action: 'create', fullName, email, role, password, workshop?, salary?, shiftFrom?, shiftTo?, avatarBase64? }
        - создаёт сотрудника классическим способом (админ вручную), сразу с одной
          утверждённой ролью role в user_roles
    POST /  { action: 'update', id, fullName?, role?, password?, workshop?, salary?, shiftFrom?, shiftTo?,
              avatarBase64?, isActive?, maxUserId?, shiftNumber?, shiftFree? }
        - maxUserId: числовой ID пользователя в MAX, можно скорректировать вручную.
          Обычно заполняется автоматически, когда сотрудник делится номером в боте
        - shiftFree=true — "выключает смену" сотруднику (гостевой режим): он перестаёт быть
          жёстко привязан к своей штатной смене (workshop/shiftNumber в профиле НЕ меняются)
          и при открытии смены сам выбирает, в какой цех/смену зайти сегодня (см.
          backend/shift_sessions). shiftFree=false возвращает жёсткую привязку
    POST /  { action: 'delete', id }
    POST /  { action: 'unlock_salary', id, actorRole } — админ открывает сотруднику
            зарплату досрочно, не дожидаясь двух недель (для опытных работников,
            взятых сразу в работу)
    POST /  { action: 'add_role', id, role, approved? } — добавляет пользователю новую
        должность. approved (по умолчанию true) — сразу утверждённая или нет
    POST /  { action: 'approve_role', id, role, password? } — утверждает заявку
        сотрудника на должность и заодно задаёт ему пароль для входа по логину
        (до утверждения пароля у него нет). В ответе возвращает login, чтобы админ
        сразу продиктовал сотруднику логин и пароль
    POST /  { action: 'reject_role', id, role } — отклоняет заявку новичка на должность:
        убирает её и отключает учётную запись, если других должностей не осталось
    POST /  { action: 'remove_role', id, role } — убирает должность у пользователя

    Логин сотрудника генерируется из email (часть до @). Пароль хранится как
    PBKDF2-HMAC-SHA256 с солью. Аватар загружается в S3, сохраняется публичная ссылка.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над пользователями
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
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, login, email, full_name, role, workshop, salary, "
                "shift_from, shift_to, avatar_url, is_active, created_at, updated_at, shift_number, "
                "max_user_id, phone, registered_via_max, shift_free, salary_unlock_at, "
                "CEIL(GREATEST(0, EXTRACT(EPOCH FROM (salary_unlock_at - now())) / 86400))::int, "
                "work_schedule, COALESCE(late_tolerance_minutes, 15) "
                "FROM users ORDER BY id DESC"
            )
            rows = cur.fetchall()

            cur.execute('SELECT user_id, role, is_approved FROM user_roles ORDER BY id')
            roles_by_user: dict[int, list] = {}
            for user_id, role, is_approved in cur.fetchall():
                roles_by_user.setdefault(user_id, []).append({'role': role, 'isApproved': is_approved})

            users = [
                {
                    'id': r[0],
                    'login': r[1],
                    'email': r[2],
                    'fullName': r[3],
                    'role': r[4],
                    'workshop': r[5],
                    'salary': float(r[6]) if r[6] is not None else 0,
                    'shiftFrom': r[7].strftime('%H:%M') if r[7] else None,
                    'shiftTo': r[8].strftime('%H:%M') if r[8] else None,
                    'avatarUrl': r[9],
                    'isActive': r[10],
                    'createdAt': r[11].isoformat() + 'Z',
                    'updatedAt': r[12].isoformat() + 'Z',
                    'shiftNumber': r[13],
                    'maxUserId': r[14],
                    'phone': r[15],
                    'registeredViaMax': r[16],
                    'shiftFree': r[17],
                    # Зарплата новичка закрыта первые 2 недели. Админ видит, сколько
                    # осталось, и может открыть раньше опытному работнику.
                    'salaryUnlockAt': (r[18].isoformat() + 'Z') if r[18] else None,
                    'salaryDaysLeft': int(r[19]) if r[19] is not None else 0,
                    # График работы: 2/2 (цех, 12 часов) или 5/2 (склад и офис).
                    'workSchedule': r[20],
                    # Сколько минут опоздания прощается, прежде чем начислится штраф.
                    'lateToleranceMinutes': r[21],
                    'roles': roles_by_user.get(r[0], []),
                }
                for r in rows
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'users': users})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                full_name = (body_data.get('fullName') or '').strip()
                email = (body_data.get('email') or '').strip().lower()
                role = (body_data.get('role') or '').strip()
                password = body_data.get('password') or ''
                workshop = (body_data.get('workshop') or '').strip()
                salary = body_data.get('salary', 0)
                shift_from = body_data.get('shiftFrom')
                shift_to = body_data.get('shiftTo')
                avatar_base64 = body_data.get('avatarBase64')

                if not full_name or not email or not password:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите имя, email и пароль'}),
                    }

                if role not in ROLES:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректная роль'})}

                if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный email'})}

                login = re.sub(r'[^a-z0-9_.\-]', '', email.split('@')[0])
                if not login:
                    login = f'user{secrets.token_hex(4)}'

                login_esc = login.replace("'", "''")
                cur.execute(f"SELECT id FROM users WHERE login = '{login_esc}'")
                suffix = 1
                base_login = login
                while cur.fetchone():
                    suffix += 1
                    login = f'{base_login}{suffix}'
                    login_esc = login.replace("'", "''")
                    cur.execute(f"SELECT id FROM users WHERE login = '{login_esc}'")

                email_esc = email.replace("'", "''")
                cur.execute(f"SELECT id FROM users WHERE email = '{email_esc}'")
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Сотрудник с email {email} уже есть в системе'}),
                    }

                salt = secrets.token_hex(16)
                pwd_hash = hash_password(password, salt)

                avatar_url = upload_avatar(avatar_base64) if avatar_base64 else None

                # График и цех подставляем по должности, если админ не указал их сам:
                # цеховые роли — 2/2 с 07:00 до 19:00 в Цехе №1, остальные — 5/2 с 08:00 до 17:00.
                schedule, def_from, def_to = default_schedule_for_role(role)
                if not shift_from and def_from:
                    shift_from = def_from
                if not shift_to and def_to:
                    shift_to = def_to
                if not workshop and schedule == '2/2':
                    workshop = 'Цех №1'

                full_name_esc = full_name.replace("'", "''")
                role_esc = role.replace("'", "''")
                workshop_esc = workshop.replace("'", "''")
                avatar_sql = f"'{avatar_url}'" if avatar_url else 'NULL'
                shift_from_sql = f"'{shift_from}'" if shift_from else 'NULL'
                shift_to_sql = f"'{shift_to}'" if shift_to else 'NULL'
                schedule_sql = f"'{schedule}'" if schedule else 'NULL'

                cur.execute(
                    f"INSERT INTO users (login, password_hash, password_salt, full_name, email, role, "
                    f"workshop, salary, shift_from, shift_to, avatar_url, work_schedule) "
                    f"VALUES ('{login_esc}', '{pwd_hash}', '{salt}', '{full_name_esc}', '{email_esc}', "
                    f"'{role_esc}', '{workshop_esc}', {float(salary)}, {shift_from_sql}, {shift_to_sql}, {avatar_sql}, "
                    f"{schedule_sql}) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                cur.execute(
                    'INSERT INTO user_roles (user_id, role, is_approved) VALUES (%s, %s, true)',
                    (new_id, role),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id, 'login': login})}

            if action == 'update':
                user_id = body_data.get('id')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                fields = []
                if 'fullName' in body_data:
                    fields.append(f"full_name = '{str(body_data['fullName']).replace(chr(39), chr(39)*2)}'")
                if 'role' in body_data:
                    if body_data['role'] not in ROLES:
                        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректная роль'})}
                    fields.append(f"role = '{body_data['role']}'")
                if 'workshop' in body_data:
                    fields.append(f"workshop = '{str(body_data['workshop']).replace(chr(39), chr(39)*2)}'")
                if 'salary' in body_data:
                    fields.append(f"salary = {float(body_data['salary'])}")
                if 'shiftFrom' in body_data:
                    val = body_data['shiftFrom']
                    shift_from_val = f"'{val}'" if val else 'NULL'
                    fields.append(f"shift_from = {shift_from_val}")
                if 'shiftTo' in body_data:
                    val = body_data['shiftTo']
                    shift_to_val = f"'{val}'" if val else 'NULL'
                    fields.append(f"shift_to = {shift_to_val}")
                # Выбор графика сразу проставляет часы работы: 2/2 — с 07:00 до 19:00,
                # 5/2 — с 08:00 до 17:00. Часы потом можно поправить вручную.
                if 'workSchedule' in body_data:
                    sched = (body_data['workSchedule'] or '').strip()
                    if sched in ('2/2', '5/2'):
                        fields.append(f"work_schedule = '{sched}'")
                        if 'shiftFrom' not in body_data and 'shiftTo' not in body_data:
                            hours = ('07:00', '19:00') if sched == '2/2' else ('08:00', '17:00')
                            fields.append(f"shift_from = '{hours[0]}'")
                            fields.append(f"shift_to = '{hours[1]}'")
                    else:
                        fields.append("work_schedule = NULL")
                if 'lateToleranceMinutes' in body_data:
                    try:
                        tol = max(0, int(body_data['lateToleranceMinutes']))
                    except (TypeError, ValueError):
                        tol = 15
                    fields.append(f"late_tolerance_minutes = {tol}")
                if 'isActive' in body_data:
                    fields.append(f"is_active = {'true' if body_data['isActive'] else 'false'}")
                if 'maxUserId' in body_data:
                    val = (body_data['maxUserId'] or '').strip() if body_data['maxUserId'] else ''
                    max_user_id_val = f"'{val.replace(chr(39), chr(39)*2)}'" if val else 'NULL'
                    fields.append(f"max_user_id = {max_user_id_val}")
                if 'shiftNumber' in body_data:
                    val = body_data['shiftNumber']
                    shift_number_val = str(int(val)) if val not in (None, '') else 'NULL'
                    fields.append(f"shift_number = {shift_number_val}")
                if 'shiftFree' in body_data:
                    fields.append(f"shift_free = {'true' if body_data['shiftFree'] else 'false'}")
                if body_data.get('password'):
                    salt = secrets.token_hex(16)
                    pwd_hash = hash_password(body_data['password'], salt)
                    fields.append(f"password_hash = '{pwd_hash}'")
                    fields.append(f"password_salt = '{salt}'")
                if body_data.get('avatarBase64'):
                    avatar_url = upload_avatar(body_data['avatarBase64'])
                    fields.append(f"avatar_url = '{avatar_url}'")

                fields.append("updated_at = now()")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = {int(user_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                # Удаление сотрудника.
                #
                # Раньше здесь был голый DELETE FROM users, и он падал ВСЕГДА: на
                # сотруднике висят его должности (user_roles), и база не даёт удалить
                # запись, пока на неё кто-то ссылается. В интерфейсе кнопка «удалить»
                # молча не срабатывала. Поэтому сначала убираем служебные привязки,
                # которые сами по себе ценности не имеют, и только потом самого человека.
                #
                # Рабочую историю (заказы, смены) не трогаем: если она есть, удалять
                # сотрудника нельзя — иначе из отчётов пропадёт, кто шил и раскраивал.
                # В этом случае честно сообщаем об этом и предлагаем отключить доступ.
                user_id = body_data.get('id')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                uid = int(user_id)

                cur.execute(
                    "SELECT COUNT(*) FROM orders WHERE assigned_user_id = %s "
                    "OR sewer_user_id = %s OR cutter_user_id = %s",
                    (uid, uid, uid),
                )
                orders_cnt = int(cur.fetchone()[0])
                cur.execute('SELECT COUNT(*) FROM shift_sessions WHERE user_id = %s', (uid,))
                shifts_cnt = int(cur.fetchone()[0])
                if orders_cnt or shifts_cnt:
                    conn.rollback()
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'Нельзя удалить: за сотрудником числится заказов — {orders_cnt}, '
                                      f'смен — {shifts_cnt}. Отключите доступ вместо удаления, '
                                      f'иначе пропадёт история работы.'},
                            ensure_ascii=False,
                        ),
                    }

                cur.execute('DELETE FROM user_roles WHERE user_id = %s', (uid,))
                cur.execute('DELETE FROM contract_sign_codes WHERE user_id = %s', (uid,))
                cur.execute('DELETE FROM max_login_codes WHERE user_id = %s', (uid,))
                cur.execute('DELETE FROM vacations WHERE user_id = %s', (uid,))
                cur.execute('DELETE FROM users WHERE id = %s', (uid,))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'unlock_salary':
                # Опытного работника берут сразу в дело — двухнедельная выдержка ему не
                # нужна. Админ открывает зарплату досрочно: ставим дату открытия «сейчас»,
                # и сотрудник сразу видит свой баланс.
                user_id = body_data.get('id')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                if (body_data.get('actorRole') or '') != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Открыть зарплату может только администратор'}, ensure_ascii=False),
                    }
                cur.execute(
                    "UPDATE users SET salary_unlock_at = now() WHERE id = %s RETURNING full_name",
                    (int(user_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'fullName': row[0]}, ensure_ascii=False),
                }

            if action == 'add_role':
                user_id = body_data.get('id')
                role = (body_data.get('role') or '').strip()
                approved = bool(body_data.get('approved', True))
                if not user_id or role not in ROLES:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}
                cur.execute(
                    'INSERT INTO user_roles (user_id, role, is_approved) VALUES (%s, %s, %s) '
                    'ON CONFLICT (user_id, role) DO UPDATE SET is_approved = EXCLUDED.is_approved',
                    (int(user_id), role, approved),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'approve_role':
                user_id = body_data.get('id')
                role = (body_data.get('role') or '').strip()
                password = (body_data.get('password') or '').strip()
                if not user_id or not role:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}

                cur.execute(
                    'UPDATE user_roles SET is_approved = true WHERE user_id = %s AND role = %s',
                    (int(user_id), role),
                )

                # Новичку даём 7 дней на загрузку документов. Отсчёт начинаем от момента
                # утверждения, а не регистрации: до утверждения человек в систему всё
                # равно не заходит, и срок сгорал бы впустую.
                # Срок ставим только тем, у кого документы ещё не проверены, — повторное
                # утверждение должности действующему сотруднику новый срок не назначает.
                cur.execute(
                    "UPDATE users SET docs_deadline = now() + interval '7 days' "
                    "WHERE id = %s AND docs_deadline IS NULL "
                    "AND personal_data_verified = false",
                    (int(user_id),),
                )

                # График новичку подставляем сразу, чтобы админу не вводить его руками:
                # цех работает 2/2 с 07:00 до 19:00, офисные должности — 5/2 с 08:00 до 17:00.
                # Если админ уже задал время вручную, не трогаем.
                schedule, t_from, t_to = default_schedule_for_role(role)
                if schedule:
                    # Производственные должности сажаем в Цех №1 — основной. Если админ
                    # уже выбрал цех вручную, оставляем его.
                    default_workshop = 'Цех №1' if schedule == '2/2' else None
                    cur.execute(
                        "UPDATE users SET work_schedule = COALESCE(work_schedule, %s), "
                        "shift_from = COALESCE(shift_from, %s::time), "
                        "shift_to = COALESCE(shift_to, %s::time), "
                        "workshop = COALESCE(NULLIF(workshop, ''), %s), "
                        "updated_at = now() "
                        "WHERE id = %s",
                        (schedule, t_from, t_to, default_workshop, int(user_id)),
                    )

                # При утверждении заявки админ задаёт сотруднику пароль — до этого момента
                # войти по паролю нельзя. Логин отдаём обратно, чтобы админ продиктовал
                # сотруднику обе части доступа сразу.
                if password:
                    if len(password) < 6:
                        return {
                            'statusCode': 400,
                            'headers': headers,
                            'body': json.dumps({'error': 'Пароль должен быть не короче 6 символов'}),
                        }
                    salt = secrets.token_hex(16)
                    cur.execute(
                        'UPDATE users SET password_hash = %s, password_salt = %s WHERE id = %s',
                        (hash_password(password, salt), salt, int(user_id)),
                    )

                cur.execute('SELECT login FROM users WHERE id = %s', (int(user_id),))
                login_row = cur.fetchone()
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'login': login_row[0] if login_row else None}),
                }

            if action == 'reject_role':
                # Отклонение заявки новичка: убираем запрошенную должность и отключаем
                # учётную запись. Человека не удаляем — он мог ошибиться с должностью,
                # админ увидит его в общем списке и при желании вернёт доступ.
                user_id = body_data.get('id')
                role = (body_data.get('role') or '').strip()
                if not user_id or not role:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}
                cur.execute('DELETE FROM user_roles WHERE user_id = %s AND role = %s', (int(user_id), role))
                cur.execute(
                    'UPDATE users SET is_active = false WHERE id = %s '
                    'AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = %s)',
                    (int(user_id), int(user_id)),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'remove_role':
                user_id = body_data.get('id')
                role = (body_data.get('role') or '').strip()
                if not user_id or not role:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}
                cur.execute('DELETE FROM user_roles WHERE user_id = %s AND role = %s', (int(user_id), role))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}