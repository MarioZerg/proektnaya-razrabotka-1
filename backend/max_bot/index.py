import hashlib
import json
import os
import random
import re
import secrets
import tempfile
from datetime import datetime, timedelta

import certifi
import psycopg2
import requests


MAX_API_URL = 'https://platform-api2.max.ru'
CODE_TTL_MINUTES = 5

ROLES = {'sewer', 'cutter', 'packer', 'storekeeper', 'senior_storekeeper', 'cleaner', 'admin'}

# Сайт MAX (platform-api2.max.ru) использует сертификат, выпущенный российским
# удостоверяющим центром (Минцифры РФ), которого нет в стандартном хранилище
# доверенных CA (certifi). Поэтому к обычному bundle certifi добавляем корневой
# и промежуточный сертификаты Минцифры (встроены как константа, а не отдельный
# файл — отдельные не-.py файлы не всегда попадают в деплой cloud-функции).
RUSSIAN_TRUSTED_CA = """-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD
4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9
G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBH
BLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sX
ePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRqa
OiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIHQjCCBSqgAwIBAgICEAIwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAyMTEyNTE5WhcNMjcwMzA2MTEyNTE5WjBvMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMR8wHQYDVQQDDBZSdXNzaWFuIFRydXN0ZWQgU3Vi
IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9YPqBKOk19NFymrE
wehzrhBEgT2atLezpduB24mQ7CiOa/HVpFCDRZzdxqlh8drku408/tTmWzlNH/br
HuQhZ/miWKOf35lpKzjyBd6TPM23uAfJvEOQ2/dnKGGJbsUo1/udKSvxQwVHpVv3
S80OlluKfhWPDEXQpgyFqIzPoxIQTLZ0deirZwMVHarZ5u8HqHetRuAtmO2ZDGQn
vVOJYAjls+Hiueq7Lj7Oce7CQsTwVZeP+XQx28PAaEZ3y6sQEt6rL06ddpSdoTMp
BnCqTbxW+eWMyjkIn6t9GBtUV45yB1EkHNnj2Ex4GwCiN9T84QQjKSr+8f0psGrZ
vPbCbQAwNFJjisLixnjlGPLKa5vOmNwIh/LAyUW5DjpkCx004LPDuqPpFsKXNKpa
L2Dm6uc0x4Jo5m+gUTVORB6hOSzWnWDj2GWfomLzzyjG81DRGFBpco/O93zecsIN
3SL2Ysjpq1zdoS01CMYxie//9zWvYwzI25/OZigtnpCIrcd2j1Y6dMUFQAzAtHE+
qsXflSL8HIS+IJEFIQobLlYhHkoE3avgNx5jlu+OLYe0dF0Ykx1PGNjbwqvTX37R
Cn32NMjlotW2QcGEZhDKj+3urZizp5xdTPZitA+aEjZM/Ni71VOdiOP0igbw6asZ
2fxdozZ1TnSSYNYvNATwthNmZysCAwEAAaOCAeUwggHhMBIGA1UdEwEB/wQIMAYB
Af8CAQAwDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBTR4XENCy2BTm6KSo9MI7NM
XqtpCzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzCBxwYIKwYBBQUH
AQEEgbowgbcwOwYIKwYBBQUHMAKGL2h0dHA6Ly9yb3N0ZWxlY29tLnJ1L2NkcC9y
b290Y2Ffc3NsX3JzYTIwMjIuY3J0MDsGCCsGAQUFBzAChi9odHRwOi8vY29tcGFu
eS5ydC5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNydDA7BggrBgEFBQcwAoYv
aHR0cDovL3JlZXN0ci1wa2kucnUvY2RwL3Jvb3RjYV9zc2xfcnNhMjAyMi5jcnQw
gbAGA1UdHwSBqDCBpTA1oDOgMYYvaHR0cDovL3Jvc3RlbGVjb20ucnUvY2RwL3Jv
b3RjYV9zc2xfcnNhMjAyMi5jcmwwNaAzoDGGL2h0dHA6Ly9jb21wYW55LnJ0LnJ1
L2NkcC9yb290Y2Ffc3NsX3JzYTIwMjIuY3JsMDWgM6Axhi9odHRwOi8vcmVlc3Ry
LXBraS5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNybDANBgkqhkiG9w0BAQsF
AAOCAgEARBVzZls79AdiSCpar15dA5Hr/rrT4WbrOfzlpI+xrLeRPrUG6eUWIW4v
Sui1yx3iqGLCjPcKb+HOTwoRMbI6ytP/ndp3TlYua2advYBEhSvjs+4vDZNwXr/D
anbwIWdurZmViQRBDFebpkvnIvru/RpWud/5r624Wp8voZMRtj/cm6aI9LtvBfT9
cfzhOaexI/99c14dyiuk1+6QhdwKaCRTc1mdfNQmnfWNRbfWhWBlK3h4GGE9JK33
Gk8ZS8DMrkdAh0xby4xAQ/mSWAfWrBmfzlOqGyoB1U47WTOeqNbWkkoAP2ys94+s
Jg4NTkiDVtXRF6nr6fYi0bSOvOFg0IQrMXO2Y8gyg9ARdPJwKtvWX8VPADCYMiWH
h4n8bZokIrImVKLDQKHY4jCsND2HHdJfnrdL2YJw1qFskNO4cSNmZydw0Wkgjv9k
F+KxqrDKlB8MZu2Hclph6v/CZ0fQ9YuE8/lsHZ0Qc2HyiSMnvjgK5fDc3TD4fa8F
E8gMNurM+kV8PT8LNIM+4Zs+LKEV8nqRWBaxkIVJGekkVKO8xDBOG/aN62AZKHOe
GcyIdu7yNMMRihGVZCYr8rYiJoKiOzDqOkPkLOPdhtVlgnhowzHDxMHND/E2WA5p
ZHuNM/m0TXt2wTTPL7JH2YC0gPz/BvvSzjksgzU5rLbRyUKQkgU=
-----END CERTIFICATE-----
"""

_CA_BUNDLE_PATH = None


def _get_ca_bundle() -> str:
    global _CA_BUNDLE_PATH
    if _CA_BUNDLE_PATH and os.path.exists(_CA_BUNDLE_PATH):
        return _CA_BUNDLE_PATH
    combined = tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False)
    with open(certifi.where(), 'r', encoding='utf-8') as f:
        combined.write(f.read())
    combined.write('\n')
    combined.write(RUSSIAN_TRUSTED_CA)
    combined.close()
    _CA_BUNDLE_PATH = combined.name
    return _CA_BUNDLE_PATH


def send_max_message(max_user_id: str, text: str, with_contact_button: bool = False) -> None:
    """Отправляет сообщение пользователю MAX. Токен — в заголовке Authorization,
    чтобы не попадал в URL/логи."""
    token = os.environ['MAX_BOT_TOKEN']
    payload = {'text': text}
    if with_contact_button:
        payload['attachments'] = [
            {
                'type': 'inline_keyboard',
                'payload': {
                    'buttons': [[{'type': 'request_contact', 'text': '📱 Поделиться номером и войти'}]]
                },
            }
        ]
    resp = requests.post(
        f'{MAX_API_URL}/messages',
        params={'user_id': max_user_id},
        json=payload,
        headers={'Authorization': token},
        timeout=10,
        verify=_get_ca_bundle(),
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
    """Достаёт номер телефона из вложения-контакта (разные варианты схемы MAX)
    или из текста сообщения (fallback, если кнопка не сработала). Возвращает
    (телефон_или_None, имя_отправителя_если_нашлось)."""
    body = message.get('body') or {}
    name = ''
    for att in body.get('attachments') or []:
        if att.get('type') == 'contact':
            payload = att.get('payload') or {}
            phone = (
                payload.get('phone')
                or payload.get('vcf_phone')
                or payload.get('contact_phone')
                or payload.get('phone_number')
            )
            name = payload.get('name') or ''
            if not phone:
                vcf = payload.get('vcf_info') or ''
                m = re.search(r'TEL[^:]*:([+\d][\d\s\-()]{8,14}\d)', vcf)
                if m:
                    phone = m.group(1)
            if phone:
                return phone, name

    text = body.get('text') or ''
    m = re.search(r'(\+?\d[\d\s\-()]{9,14}\d)', text)
    if m:
        return m.group(1), name
    return None, name


def issue_code(cur, max_user_id: str, phone_norm: str, sender_name: str, login_token: str | None) -> str:
    """Создаёт код входа и, если вкладка сайта ждёт его по метке, кладёт код в метку.

    Код по-прежнему уходит человеку сообщением: метка может протухнуть, а чат с ботом
    остаётся под рукой. Но при обычном сценарии код заберёт сама вкладка, и вводить
    его руками не придётся.
    """
    code = f'{random.randint(0, 999999):06d}'
    expires_at = datetime.utcnow() + timedelta(minutes=CODE_TTL_MINUTES)
    cur.execute(
        'INSERT INTO max_auth_sessions (max_user_id, code, phone, full_name, expires_at) '
        'VALUES (%s, %s, %s, %s, %s)',
        (max_user_id, code, phone_norm, sender_name[:200], expires_at),
    )
    if login_token:
        cur.execute(
            "UPDATE max_login_tokens SET code = %s, max_user_id = %s, awaiting_contact = false "
            "WHERE token = %s AND expires_at > now()",
            (code, max_user_id, login_token),
        )
    return code


def find_pending_token(cur, max_user_id: str) -> str | None:
    """Метка вкладки, которая сейчас ждёт входа этого человека.

    Нужна на втором шаге: человек пришёл по ссылке, бот попросил номер, и в ответном
    сообщении с контактом метки уже нет — MAX передаёт payload только при старте.
    Поэтому метку запоминаем за пользователем и достаём по нему.
    """
    cur.execute(
        "SELECT token FROM max_login_tokens WHERE max_user_id = %s AND code IS NULL "
        "AND expires_at > now() ORDER BY id DESC LIMIT 1",
        (max_user_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def extract_start_payload(body_data: dict) -> str | None:
    """Метка входа из ссылки вида https://max.ru/bot?start=<метка>.

    Ключ у MAX отличается между версиями API, поэтому проверяем известные варианты.
    """
    for key in ('payload', 'start_payload', 'startPayload'):
        val = body_data.get(key)
        if val:
            return str(val).strip()[:64]
    message = body_data.get('message') or {}
    body = message.get('body') or {}
    text = (body.get('text') or '').strip()
    # Запасной путь: некоторые клиенты присылают payload как «/start <метка>».
    m = re.match(r'^/start[ =]+(\S+)$', text)
    if m:
        return m.group(1)[:64]
    return None


def handler(event: dict, context) -> dict:
    """Webhook-приёмник обновлений от бота МЕГАТЮЛЬ в мессенджере MAX.

    Основной сценарий (вход в систему без логина/пароля):
    1. Пользователь открывает бота и жмёт /start → update_type='bot_started' →
       бот присылает приветствие с кнопкой «Поделиться номером».
    2. Пользователь делится номером (или присылает его текстом) →
       update_type='message_created' с вложением-контактом или текстом.
       - Если номер найден среди сотрудников (поле phone) — привязываем этот
         MAX-аккаунт к сотруднику (если ещё не привязан) и присылаем код входа.
       - Если номер новый — создаём нового пользователя без роли (registered_via_max=true)
         и тоже присылаем код. Роль он выберет на сайте после ввода кода.
    3. Код (6 цифр, живёт 5 минут) пользователь вводит на сайте — see backend/auth,
       action 'max_verify_code'.

    Также поддерживает служебное действие для однократной настройки после деплоя:
    POST { action: 'register_webhook', url } — регистрирует этот URL как webhook
    в MAX Bot API (вызывается один раз администратором/разработчиком).

    Args:
        event: dict с httpMethod, body (JSON от MAX или служебный action)
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
            token = os.environ['MAX_BOT_TOKEN']
            resp = requests.post(
                f'{MAX_API_URL}/subscriptions',
                json={'url': url, 'update_types': ['bot_started', 'message_created']},
                headers={'Authorization': token},
                timeout=10,
                verify=_get_ca_bundle(),
            )
            ok = resp.status_code < 300
            return {
                'statusCode': 200 if ok else 502,
                'headers': headers,
                'body': json.dumps({'success': ok, 'status': resp.status_code}),
            }

        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}

    update_type = body_data.get('update_type')

    if update_type == 'bot_started':
        user = body_data.get('user') or {}
        max_user_id = str(user.get('user_id') or body_data.get('chat_id') or '').strip()
        if not max_user_id:
            return {'statusCode': 200, 'headers': headers, 'body': ''}

        # Метка вкладки, с которой человек пришёл: она в ссылке на бота.
        login_token = extract_start_payload(body_data)

        # ТОТ, КТО УЖЕ ВХОДИЛ, номер second раз не присылает: его MAX-аккаунт давно
        # привязан к сотруднику. Сразу выдаём код — вкладка на сайте заберёт его сама,
        # и человеку остаётся только вернуться на неё.
        dsn = os.environ['DATABASE_URL']
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                'SELECT id, full_name, phone FROM users WHERE max_user_id = %s AND is_active = true',
                (max_user_id,),
            )
            known = cur.fetchone()

            if login_token:
                # Привязываем метку к человеку заранее: если он всё-таки новый и будет
                # слать контакт, на втором шаге мы найдём его вкладку по этой записи.
                cur.execute(
                    "UPDATE max_login_tokens SET max_user_id = %s, awaiting_contact = %s "
                    "WHERE token = %s AND expires_at > now()",
                    (max_user_id, known is None, login_token),
                )

            if known:
                code = issue_code(cur, max_user_id, known[2] or '', known[1] or 'Сотрудник', login_token)
                conn.commit()
            else:
                conn.commit()
                code = None
        finally:
            conn.close()

        if code:
            send_max_message(
                max_user_id,
                f'Код для входа в МЕГАТЮЛЬ: {code}\n'
                'Можно просто вернуться на сайт — код подставится сам. '
                f'Код действует {CODE_TTL_MINUTES} минут.',
            )
        else:
            send_max_message(
                max_user_id,
                'Здравствуйте! Это бот МЕГАТЮЛЬ. Нажмите кнопку ниже, чтобы поделиться '
                'номером телефона и войти в систему.',
                with_contact_button=True,
            )
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    if update_type == 'message_created':
        message = body_data.get('message') or {}
        sender = message.get('sender') or {}
        max_user_id = str(sender.get('user_id') or '').strip()
        sender_name = (
            sender.get('name')
            or ' '.join(filter(None, [sender.get('first_name'), sender.get('last_name')]))
            or 'Сотрудник'
        )

        # Фото профиля из MAX. Люди уже поставили себе аватар в мессенджере — берём
        # его, чтобы в чате и списках сотрудник узнавался по лицу, а не по инициалам.
        # Ключ у MAX менялся между версиями API, поэтому смотрим оба варианта.
        sender_avatar = (sender.get('avatar_url') or sender.get('photo_url') or '').strip()

        phone_raw, contact_name = extract_phone_from_message(message)
        if contact_name:
            sender_name = contact_name

        if not max_user_id:
            return {'statusCode': 200, 'headers': headers, 'body': ''}

        if not phone_raw:
            send_max_message(
                max_user_id,
                'Пожалуйста, нажмите кнопку «Поделиться номером» или отправьте номер телефона текстом.',
                with_contact_button=True,
            )
            return {'statusCode': 200, 'headers': headers, 'body': ''}

        phone_norm = normalize_phone(phone_raw)
        if not phone_norm:
            send_max_message(max_user_id, 'Не удалось распознать номер телефона, попробуйте ещё раз.')
            return {'statusCode': 200, 'headers': headers, 'body': ''}

        dsn = os.environ['DATABASE_URL']
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            cur.execute('SELECT id FROM users WHERE max_user_id = %s', (max_user_id,))
            row = cur.fetchone()

            if not row:
                cur.execute('SELECT id, max_user_id FROM users WHERE phone = %s', (phone_norm,))
                row = cur.fetchone()
                if row and not row[1]:
                    cur.execute('UPDATE users SET max_user_id = %s WHERE id = %s', (max_user_id, row[0]))

            if row:
                user_id = row[0]
                # Обновляем фото при каждом входе: сменил аватар в MAX — сменится
                # и в системе. Пишем в отдельное поле, чтобы не затереть фото,
                # загруженное администратором вручную: оно главнее.
                if sender_avatar:
                    cur.execute(
                        "UPDATE users SET max_avatar_url = %s WHERE id = %s",
                        (sender_avatar, user_id),
                    )
            else:
                salt = secrets.token_hex(16)
                dummy_hash = hashlib.sha256(secrets.token_bytes(16)).hexdigest()
                login = f'max{max_user_id}{secrets.token_hex(2)}'
                cur.execute(
                    "INSERT INTO users (login, password_hash, password_salt, full_name, role, phone, "
                    "max_user_id, registered_via_max, is_active, max_avatar_url) "
                    "VALUES (%s, %s, %s, %s, '', %s, %s, true, true, %s) RETURNING id",
                    (login, dummy_hash, salt, sender_name[:200], phone_norm, max_user_id,
                     sender_avatar or None),
                )
                user_id = cur.fetchone()[0]

            # Вкладка, с которой человек ушёл в бота: код положим прямо в неё,
            # чтобы не заставлять переписывать шесть цифр руками.
            login_token = find_pending_token(cur, max_user_id)
            code = issue_code(cur, max_user_id, phone_norm, sender_name, login_token)
            conn.commit()
        finally:
            conn.close()

        hint = (
            'Можно просто вернуться на сайт — код подставится сам.'
            if login_token
            else 'Введите его на сайте.'
        )
        send_max_message(
            max_user_id,
            f'Код для входа в МЕГАТЮЛЬ: {code}\n{hint} Код действует {CODE_TTL_MINUTES} минут.',
        )
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    return {'statusCode': 200, 'headers': headers, 'body': ''}
