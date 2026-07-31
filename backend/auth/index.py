import hashlib
import json
import os
import re

import psycopg2


def handler(event: dict, context) -> dict:
    """Проверяет логин и пароль сотрудника и возвращает его данные: роль, имя,
    закреплённый цех (workshopId/workshopName) и номер смены (shiftNumber).
    Эти данные позволяют швее/закройщику создавать заявки на материал в свой
    цех без ручного выбора цеха и смены.

    POST { action: 'test_accounts' } — возвращает по одному активному сотруднику
    на каждую роль системы (без проверки пароля) для демо-режима "быстрый вход".

    Args:
        event: dict с httpMethod, body (json: login, password)
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с данными пользователя или ошибкой
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
        return {
            'statusCode': 405,
            'headers': headers,
            'body': json.dumps({'error': 'Method not allowed'}),
        }

    body_data = json.loads(event.get('body') or '{}')

    if body_data.get('action') == 'test_accounts':
        dsn = os.environ['DATABASE_URL']
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT DISTINCT ON (u.role) u.id, u.full_name, u.role, u.workshop, u.shift_number, w.id "
                "FROM users u "
                "LEFT JOIN workshops w ON w.name = u.workshop "
                "WHERE u.is_active = true "
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

    login = (body_data.get('login') or '').strip()
    password = body_data.get('password') or ''

    if not login or not password:
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'Введите логин и пароль'}),
        }

    if not re.match(r'^[A-Za-z0-9_.\-]{1,100}$', login):
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'Некорректный логин'}),
        }

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        login_escaped = login.replace("'", "''")
        cur.execute(
            f"SELECT u.id, u.password_hash, u.password_salt, u.full_name, u.role, u.is_active, "
            f"u.workshop, u.shift_number, w.id "
            f"FROM users u "
            f"LEFT JOIN workshops w ON w.name = u.workshop "
            f"WHERE u.login = '{login_escaped}'"
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': 'Неверный логин или пароль'}),
        }

    user_id, password_hash, password_salt, full_name, role, is_active, workshop_name, shift_number, workshop_id = row

    if not is_active:
        return {
            'statusCode': 403,
            'headers': headers,
            'body': json.dumps({'error': 'Учётная запись отключена'}),
        }

    computed_hash = hashlib.pbkdf2_hmac(
        'sha256', password.encode(), bytes.fromhex(password_salt), 100000
    ).hex()

    if computed_hash != password_hash:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': 'Неверный логин или пароль'}),
        }

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