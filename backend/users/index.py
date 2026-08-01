import base64
import hashlib
import json
import os
import re
import secrets
import uuid

import boto3
import psycopg2


ROLES = {'sewer', 'cutter', 'packer', 'storekeeper', 'cleaner', 'admin'}


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
              avatarBase64?, isActive?, maxUserId? }
        - maxUserId: числовой ID пользователя в MAX, можно скорректировать вручную.
          Обычно заполняется автоматически, когда сотрудник делится номером в боте
    POST /  { action: 'delete', id }
    POST /  { action: 'add_role', id, role, approved? } — добавляет пользователю новую
        должность. approved (по умолчанию true) — сразу утверждённая или нет
    POST /  { action: 'approve_role', id, role } — утверждает ранее выбранную
        пользователем должность (после регистрации через MAX она ждёт подтверждения)
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
                "max_user_id, phone, registered_via_max "
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
                    'createdAt': r[11].isoformat(),
                    'updatedAt': r[12].isoformat(),
                    'shiftNumber': r[13],
                    'maxUserId': r[14],
                    'phone': r[15],
                    'registeredViaMax': r[16],
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

                full_name_esc = full_name.replace("'", "''")
                role_esc = role.replace("'", "''")
                workshop_esc = workshop.replace("'", "''")
                avatar_sql = f"'{avatar_url}'" if avatar_url else 'NULL'
                shift_from_sql = f"'{shift_from}'" if shift_from else 'NULL'
                shift_to_sql = f"'{shift_to}'" if shift_to else 'NULL'

                cur.execute(
                    f"INSERT INTO users (login, password_hash, password_salt, full_name, email, role, "
                    f"workshop, salary, shift_from, shift_to, avatar_url) "
                    f"VALUES ('{login_esc}', '{pwd_hash}', '{salt}', '{full_name_esc}', '{email_esc}', "
                    f"'{role_esc}', '{workshop_esc}', {float(salary)}, {shift_from_sql}, {shift_to_sql}, {avatar_sql}) "
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
                user_id = body_data.get('id')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(f"DELETE FROM users WHERE id = {int(user_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

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
                if not user_id or not role:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}
                cur.execute(
                    'UPDATE user_roles SET is_approved = true WHERE user_id = %s AND role = %s',
                    (int(user_id), role),
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