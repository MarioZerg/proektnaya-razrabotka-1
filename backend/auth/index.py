import json
import os
import re

import psycopg2


ROLES = {'sewer', 'cutter', 'packer', 'storekeeper', 'cleaner', 'admin', 'manager'}


def normalize_phone(raw: str) -> str | None:
    """Приводит номер к формату +7XXXXXXXXXX. Возвращает None, если не похоже на телефон."""
    digits = re.sub(r'\D', '', raw or '')
    if len(digits) == 11 and digits[0] in ('7', '8'):
        digits = '7' + digits[1:]
    elif len(digits) == 10:
        digits = '7' + digits
    else:
        return None
    return '+' + digits


def handler(event: dict, context) -> dict:
    """Авторизация сотрудников через мессенджер MAX (без логина/пароля).

    Полный сценарий входа:
    1. Сотрудник жмёт «Войти через MAX» на сайте → открывается бот (backend/max_bot
       обрабатывает webhook MAX, присылает код после того как человек поделился
       номером телефона в боте).
    2. POST { action: 'max_verify_code', code } — сайт отправляет введённый код.
       Возвращает данные пользователя и список его ролей (роль + утверждена ли
       админом). Если ролей нет вообще — это новый человек, нужно выбрать желаемую
       должность (см. select_role). Если есть роли, но НИ ОДНА не утверждена —
       показываем экран ожидания. Если утверждена ровно одна — сразу входим в неё
       (это уже делает фронтенд, вызывая enter_role). Если утверждено несколько —
       фронтенд показывает выбор роли.
    3. POST { action: 'select_role', userId, role, fullName, email, phone } — новый
       пользователь заполняет анкету: ФИО, должность, почта для восстановления
       доступа и телефон. Данные пишутся в его профиль, а в user_roles создаётся
       запись с is_approved = false — заявка ждёт утверждения администратором.
    4. POST { action: 'enter_role', userId, role } — вход в конкретную утверждённую
       роль пользователя. Проверяет, что роль утверждена, возвращает полные данные
       сессии (id, name, role, workshopId, workshopName, shiftNumber).

    POST { action: 'bot_info' } — отдаёт публичную ссылку на бота MAX (кнопка
    «Войти через MAX» на сайте открывает её в новой вкладке).

    POST { action: 'test_accounts' } — демо-вход: по одному активному сотруднику
    на каждую основную роль (без проверки кода), для ознакомительного режима.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с данными пользователя/ролей или ошибкой
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

    if method != 'POST':
        return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    dsn = os.environ['DATABASE_URL']

    if action == 'bot_info':
        username = os.environ.get('MAX_BOT_USERNAME', '')
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'botUrl': f'https://max.ru/{username}' if username else None}),
        }

    if action == 'test_accounts':
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT DISTINCT ON (u.role) u.id, u.full_name, u.role, u.workshop, u.shift_number, w.id "
                "FROM users u "
                "LEFT JOIN workshops w ON w.name = u.workshop "
                "WHERE u.is_active = true AND u.role <> '' "
                "ORDER BY u.role, u.id"
            )
            rows = cur.fetchall()
        finally:
            conn.close()

        accounts = [
            {
                'id': r[0],
                'name': r[1],
                'role': r[2],
                'workshopName': r[3],
                'shiftNumber': r[4],
                'workshopId': r[5],
            }
            for r in rows
        ]
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'accounts': accounts})}

    if action == 'max_verify_code':
        sessions_table = 'max_auth_sessions'
        id_column = 'max_user_id'

        code = (body_data.get('code') or '').strip()
        if not code:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Введите код'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT id, {id_column} FROM {sessions_table} "
                "WHERE code = %s AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1",
                (code,),
            )
            session_row = cur.fetchone()
            if not session_row:
                return {'statusCode': 401, 'headers': headers, 'body': json.dumps({'error': 'Неверный или устаревший код'})}

            session_id, messenger_user_id = session_row
            cur.execute(f'UPDATE {sessions_table} SET used = true WHERE id = %s', (session_id,))

            cur.execute(
                "SELECT id, full_name, is_active, workshop, shift_number, phone "
                f"FROM users WHERE {id_column} = %s",
                (messenger_user_id,),
            )
            user_row = cur.fetchone()
            if not user_row:
                conn.commit()
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Пользователь не найден'})}

            user_id, full_name, is_active, workshop_name, shift_number, phone = user_row
            if not is_active:
                conn.commit()
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Учётная запись отключена'})}

            cur.execute('SELECT role, is_approved FROM user_roles WHERE user_id = %s ORDER BY id', (user_id,))
            roles = [{'role': r[0], 'isApproved': r[1]} for r in cur.fetchall()]

            conn.commit()
        finally:
            conn.close()

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {
                    'id': user_id,
                    'name': full_name,
                    'phone': phone,
                    'roles': roles,
                }
            ),
        }

    if action == 'select_role':
        user_id = body_data.get('userId')
        role = (body_data.get('role') or '').strip()
        full_name = (body_data.get('fullName') or '').strip()
        email = (body_data.get('email') or '').strip().lower()
        phone = normalize_phone(body_data.get('phone') or '')

        if not user_id or role not in ROLES:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}
        if len(full_name) < 3:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите фамилию, имя и отчество'})}
        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный адрес почты'})}
        if not phone:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный номер телефона'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute('SELECT COUNT(*) FROM user_roles WHERE user_id = %s', (int(user_id),))
            has_roles = cur.fetchone()[0] > 0
            if has_roles:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Анкета уже отправлена — дождитесь утверждения администратором'}),
                }

            # Почта нужна для восстановления доступа, поэтому она должна быть уникальной:
            # иначе по одному адресу нельзя понять, чей аккаунт восстанавливать.
            cur.execute('SELECT id FROM users WHERE lower(email) = %s AND id <> %s', (email, int(user_id)))
            if cur.fetchone():
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Эта почта уже занята другим сотрудником'}),
                }

            # Телефон из анкеты может отличаться от того, которым человек вошёл в боте
            # (личный и рабочий), но он тоже должен остаться уникальным.
            cur.execute('SELECT id FROM users WHERE phone = %s AND id <> %s', (phone, int(user_id)))
            if cur.fetchone():
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Этот номер телефона уже занят'}),
                }

            cur.execute(
                'UPDATE users SET full_name = %s, email = %s, phone = %s WHERE id = %s',
                (full_name[:200], email, phone, int(user_id)),
            )
            cur.execute(
                'INSERT INTO user_roles (user_id, role, is_approved) VALUES (%s, %s, false)',
                (int(user_id), role),
            )
            conn.commit()
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

    if action == 'enter_role':
        user_id = body_data.get('userId')
        role = (body_data.get('role') or '').strip()
        if not user_id or not role:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT u.id, u.full_name, u.is_active, u.workshop, u.shift_number, w.id, ur.is_approved "
                "FROM users u "
                "LEFT JOIN workshops w ON w.name = u.workshop "
                "LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.role = %s "
                "WHERE u.id = %s",
                (role, int(user_id)),
            )
            row = cur.fetchone()
        finally:
            conn.close()

        if not row:
            return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Пользователь не найден'})}

        user_id, full_name, is_active, workshop_name, shift_number, workshop_id, is_approved = row
        if not is_active:
            return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Учётная запись отключена'})}
        if not is_approved:
            return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Эта должность ещё не утверждена администратором'})}

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {
                    'id': user_id,
                    'name': full_name,
                    'role': role,
                    'workshopId': workshop_id,
                    'workshopName': workshop_name,
                    'shiftNumber': shift_number,
                }
            ),
        }

    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}