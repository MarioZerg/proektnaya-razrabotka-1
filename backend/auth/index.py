import json
import os

import psycopg2


ROLES = {'sewer', 'cutter', 'packer', 'storekeeper', 'cleaner', 'admin', 'manager'}


def handler(event: dict, context) -> dict:
    """Авторизация сотрудников через мессенджеры MAX и Telegram (без логина/пароля).

    Полный сценарий входа:
    1. Сотрудник жмёт «Войти через MAX» или «Войти через Telegram» на сайте →
       открывается бот (backend/max_bot либо backend/telegram_bot обрабатывает
       webhook мессенджера и присылает код после того, как человек поделился
       номером телефона в боте).
    2. POST { action: 'max_verify_code' | 'telegram_verify_code', code } — сайт
       отправляет введённый код. Оба действия работают одинаково, отличается
       только таблица одноразовых сессий.
       Возвращает данные пользователя и список его ролей (роль + утверждена ли
       админом). Если ролей нет вообще — это новый человек, нужно выбрать желаемую
       должность (см. select_role). Если есть роли, но НИ ОДНА не утверждена —
       показываем экран ожидания. Если утверждена ровно одна — сразу входим в неё
       (это уже делает фронтенд, вызывая enter_role). Если утверждено несколько —
       фронтенд показывает выбор роли.
    3. POST { action: 'select_role', userId, role } — новый пользователь выбирает
       желаемую должность (один раз, пока у него нет ни одной роли). Создаёт
       запись в user_roles с is_approved = false — ждёт утверждения администратором.
    4. POST { action: 'enter_role', userId, role } — вход в конкретную утверждённую
       роль пользователя. Проверяет, что роль утверждена, возвращает полные данные
       сессии (id, name, role, workshopId, workshopName, shiftNumber).

    POST { action: 'bot_info' } — отдаёт публичные ссылки на ботов MAX и Telegram
    (кнопки входа на сайте открывают их в новой вкладке).

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
        tg_username = os.environ.get('TELEGRAM_BOT_USERNAME', '')
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {
                    'botUrl': f'https://max.ru/{username}' if username else None,
                    'telegramBotUrl': f'https://t.me/{tg_username}' if tg_username else None,
                }
            ),
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

    if action in ('max_verify_code', 'telegram_verify_code'):
        # Оба мессенджера работают одинаково: бот кладёт одноразовый код в свою таблицу
        # сессий, сайт его проверяет. Отличаются только названия таблицы и колонки.
        is_telegram = action == 'telegram_verify_code'
        sessions_table = 'telegram_auth_sessions' if is_telegram else 'max_auth_sessions'
        id_column = 'telegram_user_id' if is_telegram else 'max_user_id'

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
        if not user_id or role not in ROLES:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute('SELECT COUNT(*) FROM user_roles WHERE user_id = %s', (int(user_id),))
            has_roles = cur.fetchone()[0] > 0
            if has_roles:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Должность уже выбрана — дождитесь утверждения администратором'}),
                }

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