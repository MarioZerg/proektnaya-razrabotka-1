import base64
import json
import os
import random
import tempfile
import uuid
from datetime import datetime, timedelta

import boto3
import certifi
import psycopg2
import requests

import templates
from pdf_builder import build_contract_pdf


MAX_API_URL = 'https://platform-api2.max.ru'
# Доступ к чужим договорам закрыт: все документы видит только администратор.
ACCESS_RULES_VERSION = 2
# Код на подпись живёт дольше кода входа: человек читает документ, прежде чем подписать.
CODE_TTL_MINUTES = 15


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




def send_max_message(max_user_id: str, text: str) -> None:
    """Отправляет сообщение в MAX. Токен — в заголовке, чтобы не попадал в логи."""
    resp = requests.post(
        f'{MAX_API_URL}/messages',
        params={'user_id': max_user_id},
        json={'text': text},
        headers={'Authorization': os.environ['MAX_BOT_TOKEN']},
        timeout=10,
        verify=_get_ca_bundle(),
    )
    resp.raise_for_status()


def upload_contract_file(base64_data: str, file_name: str) -> str:
    """Кладёт файл договора в хранилище и возвращает постоянную ссылку на него."""
    _, _, data = base64_data.partition(',')
    binary = base64.b64decode(data)
    ext = (file_name.rsplit('.', 1)[-1] if '.' in file_name else 'pdf').lower()[:8]
    content_types = {
        'pdf': 'application/pdf',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'contracts/{uuid.uuid4().hex}.{ext}'
    s3.put_object(
        Bucket='files',
        Key=key,
        Body=binary,
        ContentType=content_types.get(ext, 'application/octet-stream'),
    )
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def handler(event: dict, context) -> dict:
    """Договоры сотрудников: загрузка админом и подписание кодом из MAX.

    Пока у сотрудника есть неподписанный договор, система для него закрыта — на входе
    он видит документ и подписывает его кодом, который бот присылает в MAX.

    GET  /?userId=5           - договоры сотрудника (его личная вкладка «Договоры»)
    GET  /?all=1&actorId=1    - все договоры всех сотрудников. Только для администратора:
                                роль проверяется в базе по actorId, поэтому подменить её
                                в запросе нельзя. Остальные роли видят только свои договоры
    GET  /?pending=1&userId=5 - есть ли у сотрудника неподписанные договоры (блокировка входа)

    POST / { action: 'create', userId, title, fileBase64, fileName, actorId, actorName }
        - админ загружает договор на сотрудника. Документ сразу становится обязательным
          к подписанию: сотрудник не сможет работать, пока не подпишет
    POST / { action: 'send_code', contractId, userId }
        - сотрудник просит код подписи: бот отправляет 6 цифр ему в MAX
    POST / { action: 'sign', contractId, userId, code }
        - подпись договора кодом. Код одноразовый и живёт 15 минут
    POST / { action: 'cancel', id, actorRole }
        - админ отзывает ошибочно загруженный договор (снимает блокировку)

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком договоров или результатом операции
    """
    method = event.get('httpMethod', 'GET')
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
        'Content-Type': 'application/json',
    }

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': {**headers, 'Access-Control-Max-Age': '86400'}, 'body': ''}

    dsn = os.environ['DATABASE_URL']
    params = event.get('queryStringParameters') or {}

    if method == 'GET':
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if params.get('company'):
                # Реквизиты ИП для подстановки в договоры. Отдаём только администратору:
                # это данные заказчика, сотрудникам они в настройках не нужны.
                actor_id = params.get('actorId')
                cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),) if actor_id else (0,))
                actor = cur.fetchone()
                if not actor or actor[0] != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Реквизиты доступны только администратору'}, ensure_ascii=False),
                    }
                cur.execute(
                    "SELECT key, value FROM system_settings WHERE key IN "
                    "('company_name','company_ogrnip','company_inn','company_address',"
                    "'company_phone','company_city')"
                )
                s = {k: v for k, v in cur.fetchall()}
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'name': s.get('company_name') or '',
                        'ogrnip': s.get('company_ogrnip') or '',
                        'inn': s.get('company_inn') or '',
                        'address': s.get('company_address') or '',
                        'phone': s.get('company_phone') or '',
                        'city': s.get('company_city') or '',
                    }, ensure_ascii=False),
                }

            if params.get('pending'):
                # Быстрая проверка для блокировки входа: есть ли что подписывать.
                user_id = params.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}
                cur.execute(
                    "SELECT count(*) FROM contracts WHERE user_id = %s AND status = 'pending'",
                    (int(user_id),),
                )
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'pending': int(cur.fetchone()[0])}),
                }

            if params.get('all'):
                # Все договоры видит ТОЛЬКО администратор. Роль берём из базы по
                # actorId, а не из параметра запроса: параметр можно подделать, а запись
                # в базе — нет. Иначе любой сотрудник увидел бы документы коллег.
                actor_id = params.get('actorId')
                if not actor_id:
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Нет доступа к чужим документам'}, ensure_ascii=False),
                    }
                cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                actor_row = cur.fetchone()
                if not actor_row or actor_row[0] != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Договоры сотрудников доступны только администратору'}, ensure_ascii=False),
                    }
                cur.execute(
                    "SELECT c.id, c.user_id, u.full_name, c.title, c.file_url, c.file_name, "
                    "c.status, c.created_at, c.signed_at, c.signed_phone "
                    "FROM contracts c JOIN users u ON u.id = c.user_id "
                    "ORDER BY c.created_at DESC"
                )
            else:
                user_id = params.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}
                cur.execute(
                    "SELECT c.id, c.user_id, u.full_name, c.title, c.file_url, c.file_name, "
                    "c.status, c.created_at, c.signed_at, c.signed_phone "
                    "FROM contracts c JOIN users u ON u.id = c.user_id "
                    "WHERE c.user_id = %s ORDER BY c.created_at DESC",
                    (int(user_id),),
                )

            items = [
                {
                    'id': r[0],
                    'userId': r[1],
                    'userName': r[2],
                    'title': r[3],
                    'fileUrl': r[4],
                    'fileName': r[5],
                    'status': r[6],
                    'createdAt': r[7].isoformat() + 'Z',
                    'signedAt': (r[8].isoformat() + 'Z') if r[8] else None,
                    'signedPhone': r[9],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'contracts': items})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                if (body_data.get('actorRole') or '') != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Загружать договоры может только администратор'}, ensure_ascii=False),
                    }
                user_id = body_data.get('userId')
                title = (body_data.get('title') or '').strip()
                file_base64 = body_data.get('fileBase64') or ''
                file_name = (body_data.get('fileName') or 'contract.pdf').strip()
                if not user_id or not title or not file_base64:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите сотрудника, название и файл договора'}, ensure_ascii=False),
                    }

                file_url = upload_contract_file(file_base64, file_name)
                cur.execute(
                    "INSERT INTO contracts (user_id, title, file_url, file_name, created_by) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (
                        int(user_id),
                        title[:300],
                        file_url,
                        file_name[:300],
                        body_data.get('actorId'),
                    ),
                )
                new_id = cur.fetchone()[0]

                # Сообщаем сотруднику в MAX, что появился документ на подпись — иначе он
                # узнает об этом только при следующем входе в систему.
                cur.execute("SELECT max_user_id FROM users WHERE id = %s", (int(user_id),))
                mu = cur.fetchone()
                if mu and mu[0]:
                    try:
                        send_max_message(
                            mu[0],
                            f'Вам направлен документ на подпись: {title}\n'
                            f'Зайдите в систему МЕГАТЮЛЬ, раздел «Договоры», чтобы ознакомиться и подписать.',
                        )
                    except Exception:
                        # Уведомление не критично: документ уже создан и ждёт в системе.
                        pass

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id, 'fileUrl': file_url})}

            if action == 'save_company':
                # Реквизиты ИП подставляются в каждый договор. Пустой адрес или город
                # оставляют в документе прочерк, поэтому их правит администратор здесь,
                # а не в тексте готового договора.
                actor_id = body_data.get('actorId')
                cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),) if actor_id else (0,))
                actor = cur.fetchone()
                if not actor or actor[0] != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Менять реквизиты может только администратор'}, ensure_ascii=False),
                    }

                fields = {
                    'company_name': body_data.get('name'),
                    'company_ogrnip': body_data.get('ogrnip'),
                    'company_inn': body_data.get('inn'),
                    'company_address': body_data.get('address'),
                    'company_phone': body_data.get('phone'),
                    'company_city': body_data.get('city'),
                }
                for key, value in fields.items():
                    cur.execute(
                        "INSERT INTO system_settings (key, value) VALUES (%s, %s) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
                        "updated_at = now()",
                        (key, (value or '').strip()[:500]),
                    )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True}),
                }

            if action in ('preview_generated', 'send_generated'):
                # Договор собирается системой из шаблона роли и персональных данных,
                # которые администратор сверил со сканами. Предпросмотр и отправка —
                # это один и тот же документ: админ сначала смотрит, потом отправляет,
                # и в подпись уходит ровно то, что он видел.
                actor_id = body_data.get('actorId')
                cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),) if actor_id else (0,))
                actor = cur.fetchone()
                if not actor or actor[0] != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Формировать договоры может только администратор'}, ensure_ascii=False),
                    }

                user_id = body_data.get('userId')
                if not user_id:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите сотрудника'}, ensure_ascii=False),
                    }

                cur.execute(
                    "SELECT full_name, role, passport_series, passport_number, "
                    "passport_issued_by, passport_issued_date, passport_department_code, "
                    "birth_date, registration_address, snils, inn, sbp_phone, sbp_bank, "
                    "sbp_confirmed, personal_data_verified, max_user_id "
                    "FROM users WHERE id = %s",
                    (int(user_id),),
                )
                u = cur.fetchone()
                if not u:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Сотрудник не найден'}, ensure_ascii=False),
                    }

                role = body_data.get('role') or u[1]
                if not templates.has_template(role):
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Для этой должности готового шаблона пока нет — '
                                     'загрузите документ файлом'
                        }, ensure_ascii=False),
                    }

                # Реквизиты ИП нужны до проверок: без адреса и города в договоре
                # встанут прочерки, поэтому это тоже блокировка.
                cur.execute(
                    "SELECT key, value FROM system_settings WHERE key IN "
                    "('company_name','company_ogrnip','company_inn','company_address',"
                    "'company_phone','company_city')"
                )
                s_row = {k: v for k, v in cur.fetchall()}
                company = {
                    'name': s_row.get('company_name'),
                    'ogrnip': s_row.get('company_ogrnip'),
                    'inn': s_row.get('company_inn'),
                    'address': s_row.get('company_address'),
                    'phone': s_row.get('company_phone'),
                    'city': s_row.get('company_city'),
                }

                # Договор с пустой графой паспорта или с неподтверждённым номером для
                # выплат отправлять нельзя: первый недействителен, по второму деньги
                # уйдут на чужой счёт. Поэтому проверки жёсткие, а не предупреждения.
                blockers = []
                if not u[14]:
                    blockers.append('паспортные данные не проверены администратором')
                if not company.get('name') or not company.get('address') \
                        or not company.get('city'):
                    blockers.append(
                        'не заполнены реквизиты ИП в настройках (ФИО, адрес и город)'
                    )
                if not u[11]:
                    blockers.append('сотрудник не указал номер телефона для выплат по СБП')
                elif not u[13]:
                    blockers.append('реквизиты СБП не подтверждены администратором')
                if blockers:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Договор не сформировать: ' + ', '.join(blockers),
                            'blockers': blockers,
                        }, ensure_ascii=False),
                    }

                emp = {
                    'fullName': u[0],
                    'passportSeries': u[2],
                    'passportNumber': u[3],
                    'passportIssuedBy': u[4],
                    'passportIssuedDate': u[5],
                    'passportDepartmentCode': u[6],
                    'birthDate': u[7],
                    'registrationAddress': u[8],
                    'snils': u[9],
                    'inn': u[10],
                    'sbpPhone': u[11],
                    'sbpBank': u[12],
                }

                # Номер договора — сквозной по сотруднику, чтобы перевыпуск был виден.
                cur.execute(
                    "SELECT count(*) + 1 FROM contracts WHERE user_id = %s", (int(user_id),)
                )
                emp['contractNumber'] = str(cur.fetchone()[0])

                title = f'Договор возмездного оказания услуг {templates.ROLE_TITLES[role]}'
                tmp_path = os.path.join(tempfile.gettempdir(), f'{uuid.uuid4().hex}.pdf')
                build_contract_pdf(tmp_path, emp, company, role)
                with open(tmp_path, 'rb') as fh:
                    pdf_bytes = fh.read()
                os.unlink(tmp_path)

                file_name = f'dogovor-{role}-{int(user_id)}.pdf'
                file_url = upload_contract_file(
                    'data:application/pdf;base64,'
                    + base64.b64encode(pdf_bytes).decode(),
                    file_name,
                )

                if action == 'preview_generated':
                    # Предпросмотр ничего не создаёт в системе: админ просто смотрит,
                    # что попало в документ, и может вернуться и поправить данные.
                    return {
                        'statusCode': 200,
                        'headers': headers,
                        'body': json.dumps({
                            'fileUrl': file_url,
                            'title': title,
                            'preview': True,
                        }, ensure_ascii=False),
                    }

                cur.execute(
                    "INSERT INTO contracts (user_id, title, file_url, file_name, created_by) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (int(user_id), title[:300], file_url, file_name[:300], int(actor_id)),
                )
                new_id = cur.fetchone()[0]

                if u[15]:
                    try:
                        send_max_message(
                            u[15],
                            f'Вам направлен документ на подпись: {title}\n'
                            f'Зайдите в систему МЕГАТЮЛЬ, раздел «Договоры», чтобы '
                            f'ознакомиться и подписать.',
                        )
                    except Exception:
                        pass

                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'id': new_id, 'fileUrl': file_url, 'title': title},
                                       ensure_ascii=False),
                }

            if action == 'send_code':
                contract_id = body_data.get('contractId')
                user_id = body_data.get('userId')
                if not contract_id or not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите договор'})}

                cur.execute(
                    "SELECT c.status, u.max_user_id, u.phone FROM contracts c "
                    "JOIN users u ON u.id = c.user_id WHERE c.id = %s AND c.user_id = %s",
                    (int(contract_id), int(user_id)),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Договор не найден'})}
                if row[0] != 'pending':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Этот договор уже подписан'}, ensure_ascii=False),
                    }
                if not row[1]:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'К вашему профилю не привязан MAX — войдите через бота, чтобы подписывать документы'},
                            ensure_ascii=False,
                        ),
                    }

                code = f'{random.randint(0, 999999):06d}'
                expires_at = datetime.utcnow() + timedelta(minutes=CODE_TTL_MINUTES)
                cur.execute(
                    "INSERT INTO contract_sign_codes (contract_id, user_id, code, expires_at) "
                    "VALUES (%s, %s, %s, %s)",
                    (int(contract_id), int(user_id), code, expires_at),
                )
                send_max_message(
                    row[1],
                    f'Код для подписания документа: {code}\n'
                    f'Вводя код, вы подписываете документ. Код действует {CODE_TTL_MINUTES} минут.',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'sent': True})}

            if action == 'sign':
                contract_id = body_data.get('contractId')
                user_id = body_data.get('userId')
                code = (body_data.get('code') or '').strip()
                if not contract_id or not user_id or not code:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Введите код из MAX'}, ensure_ascii=False)}

                cur.execute(
                    "SELECT id FROM contract_sign_codes WHERE contract_id = %s AND user_id = %s "
                    "AND code = %s AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1",
                    (int(contract_id), int(user_id), code),
                )
                code_row = cur.fetchone()
                if not code_row:
                    return {
                        'statusCode': 401,
                        'headers': headers,
                        'body': json.dumps({'error': 'Неверный или устаревший код'}, ensure_ascii=False),
                    }
                cur.execute("UPDATE contract_sign_codes SET used = true WHERE id = %s", (code_row[0],))

                cur.execute("SELECT phone FROM users WHERE id = %s", (int(user_id),))
                phone_row = cur.fetchone()
                source_ip = ((event.get('requestContext') or {}).get('identity') or {}).get('sourceIp')

                cur.execute(
                    "UPDATE contracts SET status = 'signed', signed_at = now(), signed_code = %s, "
                    "signed_phone = %s, signed_ip = %s "
                    "WHERE id = %s AND user_id = %s AND status = 'pending' RETURNING title",
                    (
                        code,
                        phone_row[0] if phone_row else None,
                        source_ip,
                        int(contract_id),
                        int(user_id),
                    ),
                )
                signed = cur.fetchone()
                if not signed:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Договор уже подписан'}, ensure_ascii=False),
                    }
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'title': signed[0]}, ensure_ascii=False),
                }

            if action == 'cancel':
                if (body_data.get('actorRole') or '') != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Отзывать документы может только администратор'}, ensure_ascii=False),
                    }
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "UPDATE contracts SET status = 'cancelled' WHERE id = %s AND status = 'pending' RETURNING id",
                    (int(item_id),),
                )
                if not cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Отозвать можно только неподписанный документ'}, ensure_ascii=False),
                    }
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}