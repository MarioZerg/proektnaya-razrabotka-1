import hashlib
import json
import logging
import os
import random
import re
import tempfile
from datetime import datetime, timedelta

import certifi
import psycopg2
import requests


MAX_API_URL = 'https://platform-api2.max.ru'
CODE_TTL_MINUTES = 5

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


def send_max_message(user_id: str, text: str) -> None:
    """Отправляет текстовое сообщение пользователю MAX через Bot API.

    Токен передаётся в заголовке Authorization (а не в query-параметре),
    чтобы он не попадал в URL и, соответственно, не оседал в логах.
    """
    token = os.environ['MAX_BOT_TOKEN']
    url = f'{MAX_API_URL}/messages'
    resp = requests.post(
        url,
        params={'user_id': user_id},
        json={'text': text},
        headers={'Authorization': token},
        timeout=10,
        verify=_get_ca_bundle(),
    )
    resp.raise_for_status()


def handler(event: dict, context) -> dict:
    """Авторизация сотрудников по логину/паролю и через мессенджер MAX (код в личном чате бота).

    Проверяет логин и пароль сотрудника и возвращает его данные: роль, имя,
    закреплённый цех (workshopId/workshopName) и номер смены (shiftNumber).

    POST { action: 'test_accounts' } — возвращает по одному активному сотруднику
    на каждую роль системы (без проверки пароля) для демо-режима "быстрый вход".

    POST { action: 'max_send_code', login } — находит сотрудника по логину, генерирует
    6-значный код (действует 5 минут), отправляет его сообщением в MAX-бот на привязанный
    maxUserId сотрудника (карточка сотрудника должна содержать этот ID, вводится администратором).
    Если у сотрудника не привязан MAX ID — возвращает ошибку.

    POST { action: 'max_verify_code', login, code } — проверяет код, при успехе возвращает
    те же данные пользователя, что и обычный логин по паролю. Код одноразовый.

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
    action = body_data.get('action')
    dsn = os.environ['DATABASE_URL']

    if action == 'test_accounts':
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

    if action == 'max_send_code':
        login = (body_data.get('login') or '').strip()
        if not login:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Введите логин'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            login_esc = login.replace("'", "''")
            cur.execute(
                f"SELECT id, max_user_id, is_active FROM users WHERE login = '{login_esc}'"
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник с таким логином не найден'})}

            user_id, max_user_id, is_active = row
            if not is_active:
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Учётная запись отключена'})}
            if not max_user_id:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'К этому сотруднику не привязан MAX — обратитесь к администратору'}),
                }

            code = f'{random.randint(0, 999999):06d}'
            expires_at = datetime.utcnow() + timedelta(minutes=CODE_TTL_MINUTES)
            cur.execute(
                f"INSERT INTO max_login_codes (user_id, code, expires_at) VALUES ({int(user_id)}, '{code}', %s)",
                (expires_at,),
            )
            conn.commit()

            try:
                send_max_message(max_user_id, f'Код для входа в МЕГАТЮЛЬ: {code}\nДействителен {CODE_TTL_MINUTES} минут.')
            except requests.exceptions.RequestException as e:
                # Не показываем пользователю детали исключения — requests включает в текст
                # ошибки полный URL запроса с access_token, это нельзя отдавать в ответ API.
                # Логируем без query-параметров, чтобы токен не попал и в логи.
                logging.error('MAX send message failed: %s', type(e).__name__)
                return {
                    'statusCode': 502,
                    'headers': headers,
                    'body': json.dumps({'error': 'Не удалось отправить код в MAX — попробуйте позже'}),
                }
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

    if action == 'max_verify_code':
        login = (body_data.get('login') or '').strip()
        code = (body_data.get('code') or '').strip()
        if not login or not code:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Введите логин и код'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            login_esc = login.replace("'", "''")
            cur.execute(
                f"SELECT u.id, u.full_name, u.role, u.is_active, u.workshop, u.shift_number, w.id "
                f"FROM users u LEFT JOIN workshops w ON w.name = u.workshop "
                f"WHERE u.login = '{login_esc}'"
            )
            user_row = cur.fetchone()
            if not user_row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}

            user_id, full_name, role, is_active, workshop_name, shift_number, workshop_id = user_row
            if not is_active:
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Учётная запись отключена'})}

            code_esc = code.replace("'", "''")
            cur.execute(
                "SELECT id FROM max_login_codes WHERE user_id = %s AND code = %s "
                "AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1",
                (int(user_id), code_esc),
            )
            code_row = cur.fetchone()
            if not code_row:
                return {'statusCode': 401, 'headers': headers, 'body': json.dumps({'error': 'Неверный или устаревший код'})}

            cur.execute(f"UPDATE max_login_codes SET used = true WHERE id = {code_row[0]}")
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
                    'role': role,
                    'workshopId': workshop_id,
                    'workshopName': workshop_name,
                    'shiftNumber': shift_number,
                }
            ),
        }

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