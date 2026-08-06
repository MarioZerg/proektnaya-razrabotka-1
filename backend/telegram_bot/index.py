import hashlib
import json
import os
import random
import re
import secrets
from datetime import datetime, timedelta

import psycopg2
import requests


TELEGRAM_API_URL = 'https://api.telegram.org'
CODE_TTL_MINUTES = 5


def send_telegram_message(chat_id: str, text: str, with_contact_button: bool = False) -> None:
    """Отправляет сообщение пользователю в Telegram. Кнопка «Поделиться номером» —
    это reply-клавиатура с request_contact: обычные inline-кнопки номер прислать не могут."""
    token = os.environ['TELEGRAM_BOT_TOKEN']
    payload = {'chat_id': chat_id, 'text': text}
    if with_contact_button:
        payload['reply_markup'] = {
            'keyboard': [[{'text': '📱 Поделиться номером и войти', 'request_contact': True}]],
            'resize_keyboard': True,
            'one_time_keyboard': True,
        }
    else:
        # Убираем клавиатуру после успешного входа, чтобы она не висела в чате.
        payload['reply_markup'] = {'remove_keyboard': True}
    resp = requests.post(
        f'{TELEGRAM_API_URL}/bot{token}/sendMessage',
        json=payload,
        timeout=10,
    )
    resp.raise_for_status()


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


def extract_phone_from_message(message: dict) -> tuple[str | None, str]:
    """Достаёт номер из вложения-контакта (кнопка «Поделиться номером») или из текста
    сообщения — на случай, если сотрудник набрал номер руками. Возвращает
    (телефон_или_None, имя_из_контакта_если_нашлось)."""
    contact = message.get('contact') or {}
    if contact.get('phone_number'):
        name = ' '.join(filter(None, [contact.get('first_name'), contact.get('last_name')]))
        return contact['phone_number'], name

    text = message.get('text') or ''
    m = re.search(r'(\+?\d[\d\s\-()]{9,14}\d)', text)
    if m:
        return m.group(1), ''
    return None, ''


def handler(event: dict, context) -> dict:
    """Webhook-приёмник обновлений от бота МЕГАТЮЛЬ в Telegram.

    Полный сценарий входа (без логина и пароля, как и в MAX):
    1. Сотрудник открывает бота и жмёт /start → бот присылает приветствие с кнопкой
       «Поделиться номером».
    2. Сотрудник делится номером (или присылает его текстом).
       - Если номер найден среди сотрудников (поле phone) — привязываем этот
         Telegram-аккаунт к сотруднику (если ещё не привязан) и присылаем код входа.
       - Если номер новый — создаём пользователя без роли (registered_via_telegram=true)
         и тоже присылаем код. Должность он выберет на сайте после ввода кода.
    3. Код (6 цифр, живёт 5 минут) сотрудник вводит на сайте — см. backend/auth,
       action 'telegram_verify_code'.

    Также поддерживает служебное действие для однократной настройки после деплоя:
    POST { action: 'register_webhook', url } — регистрирует этот URL как webhook
    в Telegram Bot API (вызывается один раз администратором).

    Args:
        event: dict с httpMethod, body (JSON от Telegram или служебный action)
        context: объект с request_id

    Returns:
        dict: HTTP 200 с пустым телом (подтверждение получения webhook) либо
        результат служебного действия
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

    if method != 'POST':
        return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}

    body_data = json.loads(event.get('body') or '{}')

    if 'action' in body_data:
        action = body_data['action']

        if action == 'register_webhook':
            url = (body_data.get('url') or '').strip()
            if not url:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите url'})}
            token = os.environ['TELEGRAM_BOT_TOKEN']
            resp = requests.post(
                f'{TELEGRAM_API_URL}/bot{token}/setWebhook',
                json={'url': url, 'allowed_updates': ['message']},
                timeout=10,
            )
            ok = resp.status_code < 300
            return {
                'statusCode': 200 if ok else 502,
                'headers': headers,
                'body': json.dumps({'success': ok, 'status': resp.status_code}),
            }

        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}

    message = body_data.get('message') or {}
    if not message:
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    sender = message.get('from') or {}
    telegram_user_id = str(sender.get('id') or '').strip()
    chat_id = str((message.get('chat') or {}).get('id') or telegram_user_id).strip()
    sender_name = (
        ' '.join(filter(None, [sender.get('first_name'), sender.get('last_name')]))
        or sender.get('username')
        or 'Сотрудник'
    )

    if not telegram_user_id:
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    text = (message.get('text') or '').strip()
    if text.startswith('/start'):
        send_telegram_message(
            chat_id,
            'Здравствуйте! Это бот МЕГАТЮЛЬ. Нажмите кнопку ниже, чтобы поделиться '
            'номером телефона и получить код для входа в систему.',
            with_contact_button=True,
        )
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    phone_raw, contact_name = extract_phone_from_message(message)
    if contact_name:
        sender_name = contact_name

    if not phone_raw:
        send_telegram_message(
            chat_id,
            'Пожалуйста, нажмите кнопку «Поделиться номером» или отправьте номер телефона текстом.',
            with_contact_button=True,
        )
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    phone_norm = normalize_phone(phone_raw)
    if not phone_norm:
        send_telegram_message(chat_id, 'Не удалось распознать номер телефона, попробуйте ещё раз.')
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        cur.execute('SELECT id FROM users WHERE telegram_user_id = %s', (telegram_user_id,))
        row = cur.fetchone()

        if not row:
            # Тот же сотрудник мог раньше входить через MAX — тогда он уже есть в базе
            # по номеру телефона, и Telegram просто добавляется ему вторым способом входа.
            cur.execute('SELECT id, telegram_user_id FROM users WHERE phone = %s', (phone_norm,))
            row = cur.fetchone()
            if row and not row[1]:
                cur.execute(
                    'UPDATE users SET telegram_user_id = %s WHERE id = %s', (telegram_user_id, row[0])
                )

        if row:
            user_id = row[0]
        else:
            salt = secrets.token_hex(16)
            dummy_hash = hashlib.sha256(secrets.token_bytes(16)).hexdigest()
            login = f'tg{telegram_user_id}{secrets.token_hex(2)}'
            cur.execute(
                "INSERT INTO users (login, password_hash, password_salt, full_name, role, phone, "
                "telegram_user_id, registered_via_telegram, is_active) "
                "VALUES (%s, %s, %s, %s, '', %s, %s, true, true) RETURNING id",
                (login, dummy_hash, salt, sender_name[:200], phone_norm, telegram_user_id),
            )
            user_id = cur.fetchone()[0]

        code = f'{random.randint(0, 999999):06d}'
        expires_at = datetime.utcnow() + timedelta(minutes=CODE_TTL_MINUTES)
        cur.execute(
            'INSERT INTO telegram_auth_sessions (telegram_user_id, code, phone, full_name, expires_at) '
            'VALUES (%s, %s, %s, %s, %s)',
            (telegram_user_id, code, phone_norm, sender_name[:200], expires_at),
        )
        conn.commit()
    finally:
        conn.close()

    send_telegram_message(
        chat_id,
        f'Код для входа в МЕГАТЮЛЬ: {code}\nВведите его на сайте. Код действует {CODE_TTL_MINUTES} минут.',
    )
    return {'statusCode': 200, 'headers': headers, 'body': ''}
