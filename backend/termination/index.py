"""Расторжение договора ГПХ по инициативе сотрудника.

Порядок ровно как в разделе 5 договора:

  1. сотрудник подаёт заявление в личном кабинете. Дата прекращения считается
     системой — ровно через 14 дней (п. 5.2), выбрать раньше нельзя;
  2. система собирает Акт о расторжении и сотрудник подписывает его кодом
     из MAX — той же подписью, что и сам договор;
  3. администратор подтверждает или отклоняет с причиной;
  4. после подтверждения доступ закрывается (п. 5.7), аккаунт остаётся.

Аккаунт НЕ удаляется принципиально: по договору прекращение доступа — это
техническая мера защиты данных, а не отказ от денежных обязательств. История
работы нужна, чтобы досчитать и выплатить заработанное.
"""
import base64
import json
import os
import random
import tempfile
import uuid
from datetime import date, datetime, timedelta

import boto3
import certifi
import psycopg2
import requests

from termination_pdf import build_termination_pdf

MAX_API_URL = 'https://platform-api2.max.ru'

# Срок предупреждения по пункту 5.2 договора. Меньше нельзя: сокращение срока
# запускает пункт 5.5 — расчёт частями по 10% раз в неделю, а это уже другой
# документ и другой разговор с сотрудником.
NOTICE_DAYS = 14

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Content-Type': 'application/json',
}

# Сертификат Минцифры: MAX подписан российским корневым центром, которого нет
# в стандартном наборе Python. Без него запрос к мессенджеру обрывается на
# проверке сертификата — код сотруднику не уходит.
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

_CA_PATH = None


def _ca_bundle():
    """Стандартные сертификаты плюс российский корневой — иначе MAX недоступен."""
    global _CA_PATH
    if _CA_PATH and os.path.exists(_CA_PATH):
        return _CA_PATH
    combined = tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False)
    with open(certifi.where(), 'r', encoding='utf-8') as f:
        combined.write(f.read())
    combined.write('\n')
    combined.write(RUSSIAN_TRUSTED_CA)
    combined.close()
    _CA_PATH = combined.name
    return _CA_PATH


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def send_max(max_user_id: str, text: str) -> None:
    """Сообщение сотруднику в MAX. Токен в заголовке, чтобы не попал в логи."""
    resp = requests.post(
        f'{MAX_API_URL}/messages',
        params={'user_id': max_user_id},
        json={'text': text},
        headers={'Authorization': os.environ['MAX_BOT_TOKEN']},
        timeout=10,
        verify=_ca_bundle(),
    )
    resp.raise_for_status()


def upload_pdf(binary: bytes, name: str) -> str:
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'terminations/{uuid.uuid4().hex}.pdf'
    s3.put_object(Bucket='files', Key=key, Body=binary,
                  ContentType='application/pdf')
    return (f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}"
            f"/bucket/{key}")


def _is_admin(cur, actor_id):
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _unfinished_orders(cur, user_id):
    """Заказы, которые сотрудник взял и не сдал.

    По пункту 5.3 договора Исполнитель обязан завершить принятые задания. Пока
    на нём висит незакрытая работа, заявление не принимаем: иначе крой останется
    на вешалке, а по системе человек уже ушёл.
    """
    cur.execute(
        "SELECT id, order_number, material, width, height, sewing_status "
        "FROM orders WHERE assigned_user_id = %s AND cancelled_at IS NULL "
        "  AND sewing_status IN ('На раскрое', 'В работе') "
        "ORDER BY id LIMIT 50",
        (int(user_id),),
    )
    return [{'id': r[0], 'orderNumber': r[1],
             'title': f'{r[2]} {r[3]}×{r[4]}', 'status': r[5]}
            for r in cur.fetchall()]


def _employee(cur, user_id):
    cur.execute(
        "SELECT full_name, passport_series, passport_number, registration_address, "
        "  snils, sbp_phone, max_user_id, phone, role "
        "FROM users WHERE id = %s",
        (int(user_id),),
    )
    r = cur.fetchone()
    if not r:
        return None
    return {'fullName': r[0], 'passportSeries': r[1], 'passportNumber': r[2],
            'registrationAddress': r[3], 'snils': r[4], 'sbpPhone': r[5],
            'maxUserId': r[6], 'phone': r[7], 'role': r[8]}


def _company(cur):
    cur.execute(
        "SELECT key, value FROM system_settings WHERE key IN "
        "('company_name','company_ogrnip','company_inn','company_address',"
        "'company_phone','company_city')"
    )
    s = {k: v for k, v in cur.fetchall()}
    return {'name': s.get('company_name'), 'ogrnip': s.get('company_ogrnip'),
            'inn': s.get('company_inn'), 'address': s.get('company_address'),
            'phone': s.get('company_phone'), 'city': s.get('company_city')}


def handler(event: dict, context) -> dict:
    """Расторжение договора: заявление сотрудника, подпись, решение админа.

    GET  /?userId=5              - своё заявление (личный кабинет)
    GET  /?pending=1&actorId=1   - заявления на подтверждение (у админа)
    POST /  { action: 'request', userId, reason }      - подать заявление
    POST /  { action: 'send_code', terminationId, userId }
    POST /  { action: 'sign', terminationId, userId, code }
    POST /  { action: 'cancel', terminationId, userId } - передумал до подписи
    POST /  { action: 'confirm', terminationId, actorId }
    POST /  { action: 'reject', terminationId, actorId, reason }
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = False
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}

            if params.get('pending'):
                if not _is_admin(cur, params.get('actorId')):
                    return _resp(403, {'error': 'Доступно администратору'})
                cur.execute(
                    "SELECT t.id, t.user_id, u.full_name, u.role, t.status, "
                    "  t.termination_date, t.reason, t.created_at, t.signed_at, "
                    "  t.file_url, t.file_name "
                    "FROM contract_terminations t "
                    "JOIN users u ON u.id = t.user_id "
                    "WHERE t.status = 'pending_admin' ORDER BY t.signed_at"
                )
                items = [{
                    'id': r[0], 'userId': r[1], 'fullName': r[2], 'role': r[3],
                    'status': r[4], 'terminationDate': r[5], 'reason': r[6],
                    'createdAt': r[7], 'signedAt': r[8],
                    'fileUrl': r[9], 'fileName': r[10],
                } for r in cur.fetchall()]
                return _resp(200, {'items': items})

            user_id = params.get('userId')
            if not user_id:
                return _resp(400, {'error': 'Укажите сотрудника'})

            cur.execute(
                "SELECT id, status, termination_date, reason, created_at, "
                "  signed_at, reject_reason, rejected_at, confirmed_at, file_name "
                "FROM contract_terminations WHERE user_id = %s "
                "ORDER BY id DESC LIMIT 1",
                (int(user_id),),
            )
            row = cur.fetchone()
            current = None
            if row:
                current = {
                    'id': row[0], 'status': row[1], 'terminationDate': row[2],
                    'reason': row[3], 'createdAt': row[4], 'signedAt': row[5],
                    'rejectReason': row[6], 'rejectedAt': row[7],
                    'confirmedAt': row[8], 'fileName': row[9],
                }

            # Сколько работы висит на сотруднике: пока есть незакрытые задания,
            # кнопку в личном кабинете не показываем (п. 5.3 договора).
            unfinished = _unfinished_orders(cur, user_id)
            return _resp(200, {
                'current': current,
                'unfinishedOrders': unfinished,
                'noticeDays': NOTICE_DAYS,
                'plannedDate': (date.today() + timedelta(days=NOTICE_DAYS)),
            })

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        if action == 'request':
            user_id = body_data.get('userId')
            if not user_id:
                return _resp(400, {'error': 'Укажите сотрудника'})

            cur.execute(
                "SELECT id FROM contract_terminations WHERE user_id = %s "
                "AND status IN ('pending_sign', 'pending_admin')",
                (int(user_id),),
            )
            if cur.fetchone():
                return _resp(409, {'error': 'Заявление уже подано'})

            unfinished = _unfinished_orders(cur, user_id)
            if unfinished:
                return _resp(409, {
                    'error': f'Сначала завершите работу: у вас {len(unfinished)} '
                             f'незакрытых заказов. По договору принятые задания '
                             f'нужно сдать до расторжения',
                    'unfinishedOrders': unfinished,
                })

            emp = _employee(cur, user_id)
            if not emp:
                return _resp(404, {'error': 'Сотрудник не найден'})
            if not emp['maxUserId']:
                return _resp(400, {
                    'error': 'К вашему профилю не привязан MAX — без него нельзя '
                             'подписать документ'})

            # Договор, который расторгаем.
            cur.execute(
                "SELECT id, created_at FROM contracts WHERE user_id = %s "
                "AND status = 'signed' ORDER BY id DESC LIMIT 1",
                (int(user_id),),
            )
            c_row = cur.fetchone()
            if not c_row:
                return _resp(400, {
                    'error': 'У вас нет подписанного договора — расторгать нечего'})

            term_date = date.today() + timedelta(days=NOTICE_DAYS)
            reason = (body_data.get('reason') or '').strip()[:500] or None

            company = _company(cur)
            tmp = os.path.join(tempfile.gettempdir(), f'{uuid.uuid4().hex}.pdf')
            build_termination_pdf(
                tmp, emp, company, emp['role'], term_date,
                contract_number=c_row[0],
                contract_date=c_row[1].date() if c_row[1] else None,
                reason=reason,
            )
            with open(tmp, 'rb') as fh:
                pdf = fh.read()
            os.remove(tmp)

            file_name = f'akt-rastorzheniya-{int(user_id)}.pdf'
            file_url = upload_pdf(pdf, file_name)

            cur.execute(
                "INSERT INTO contract_terminations (user_id, contract_id, status, "
                "  termination_date, reason, file_url, file_name) "
                "VALUES (%s, %s, 'pending_sign', %s, %s, %s, %s) RETURNING id",
                (int(user_id), c_row[0], term_date, reason, file_url, file_name),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return _resp(200, {'id': new_id, 'terminationDate': term_date,
                               'fileName': file_name})

        if action == 'send_code':
            term_id = body_data.get('terminationId')
            user_id = body_data.get('userId')
            if not term_id or not user_id:
                return _resp(400, {'error': 'Некорректный запрос'})

            cur.execute(
                "SELECT t.status, u.max_user_id FROM contract_terminations t "
                "JOIN users u ON u.id = t.user_id "
                "WHERE t.id = %s AND t.user_id = %s",
                (int(term_id), int(user_id)),
            )
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Заявление не найдено'})
            if row[0] != 'pending_sign':
                return _resp(409, {'error': 'Этот документ уже подписан'})
            if not row[1]:
                return _resp(400, {'error': 'К профилю не привязан MAX'})

            code = f'{random.randint(0, 999999):06d}'
            cur.execute(
                "INSERT INTO termination_sign_codes (termination_id, user_id, "
                "  code, expires_at) VALUES (%s, %s, %s, %s)",
                (int(term_id), int(user_id), code,
                 datetime.utcnow() + timedelta(minutes=15)),
            )
            try:
                send_max(
                    row[1],
                    f'Код для подписания Акта о расторжении договора: {code}\n'
                    f'Код действует 15 минут. Никому его не сообщайте.\n\n'
                    f'Если вы не подавали заявление на расторжение — '
                    f'просто не вводите код и сообщите администратору.',
                )
            except Exception as e:
                # Показываем, что именно ответил мессенджер: «не удалось» без
                # причины невозможно чинить — виноват может быть и токен, и то,
                # что человек не открыл чат с ботом.
                detail = ''
                r = getattr(e, 'response', None)
                if r is not None:
                    detail = f' ({r.status_code}: {r.text[:150]})'
                return _resp(502, {
                    'error': f'Не удалось отправить код в MAX{detail}'})
            conn.commit()
            return _resp(200, {'sent': True})

        if action == 'sign':
            term_id = body_data.get('terminationId')
            user_id = body_data.get('userId')
            code = (body_data.get('code') or '').strip()
            if not term_id or not user_id or not code:
                return _resp(400, {'error': 'Введите код из MAX'})

            cur.execute(
                "SELECT id FROM termination_sign_codes WHERE termination_id = %s "
                "AND user_id = %s AND code = %s AND used_at IS NULL "
                "AND expires_at > now() ORDER BY id DESC LIMIT 1",
                (int(term_id), int(user_id), code),
            )
            code_row = cur.fetchone()
            if not code_row:
                return _resp(401, {'error': 'Неверный или устаревший код'})
            cur.execute(
                "UPDATE termination_sign_codes SET used_at = now() WHERE id = %s",
                (code_row[0],),
            )

            cur.execute("SELECT phone FROM users WHERE id = %s", (int(user_id),))
            ph = cur.fetchone()
            src_ip = ((event.get('requestContext') or {})
                      .get('identity') or {}).get('sourceIp')

            cur.execute(
                "UPDATE contract_terminations SET status = 'pending_admin', "
                "  signed_at = now(), signed_code = %s, signed_phone = %s, "
                "  signed_ip = %s "
                "WHERE id = %s AND user_id = %s AND status = 'pending_sign' "
                "RETURNING termination_date",
                (code, ph[0] if ph else None, src_ip, int(term_id), int(user_id)),
            )
            signed = cur.fetchone()
            if not signed:
                return _resp(409, {'error': 'Документ уже подписан'})

            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, "
                "entity_type, entity_id, description) "
                "SELECT 'staff', id, full_name, 'termination_signed', "
                "  'termination', %s, 'Подписан Акт о расторжении договора' "
                "FROM users WHERE id = %s",
                (int(term_id), int(user_id)),
            )
            conn.commit()
            return _resp(200, {'success': True, 'terminationDate': signed[0]})

        if action == 'cancel':
            # Передумал до подписания — заявление снимается без следа в кадрах.
            term_id = body_data.get('terminationId')
            user_id = body_data.get('userId')
            cur.execute(
                "UPDATE contract_terminations SET status = 'cancelled' "
                "WHERE id = %s AND user_id = %s AND status = 'pending_sign' "
                "RETURNING id",
                (int(term_id), int(user_id)),
            )
            if not cur.fetchone():
                return _resp(409, {
                    'error': 'Отозвать можно только неподписанное заявление'})
            conn.commit()
            return _resp(200, {'success': True})

        if action == 'confirm':
            term_id = body_data.get('terminationId')
            actor_id = body_data.get('actorId')
            if not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Подтверждает только администратор'})

            cur.execute(
                "UPDATE contract_terminations SET status = 'confirmed', "
                "  confirmed_at = now(), confirmed_by = %s "
                "WHERE id = %s AND status = 'pending_admin' "
                "RETURNING user_id, termination_date",
                (int(actor_id), int(term_id)),
            )
            row = cur.fetchone()
            if not row:
                return _resp(409, {'error': 'Заявление не ждёт подтверждения'})
            emp_id, term_date = row

            # Закрываем доступ, но аккаунт оставляем: по пункту 5.7 договора это
            # техническая мера защиты данных, а не отказ от расчётов. История
            # работы нужна, чтобы досчитать и выплатить заработанное.
            cur.execute(
                "UPDATE users SET contract_terminated_at = now() WHERE id = %s",
                (emp_id,),
            )

            # Открытую смену закрываем: человек больше не работает, а незакрытая
            # смена продолжала бы копить часы и попала бы в расчёт зарплаты.
            cur.execute(
                "UPDATE shift_sessions SET closed_at = now() "
                "WHERE user_id = %s AND closed_at IS NULL",
                (emp_id,),
            )

            cur.execute("SELECT max_user_id, full_name FROM users WHERE id = %s",
                        (emp_id,))
            u = cur.fetchone()
            if u and u[0]:
                try:
                    send_max(
                        u[0],
                        f'Расторжение договора подтверждено.\n'
                        f'Договор прекращает действие {term_date.strftime("%d.%m.%Y")}.\n\n'
                        f'Доступ в систему закрыт. Заработанное будет выплачено '
                        f'в обычные сроки — по договору прекращение доступа не '
                        f'влияет на расчёты.',
                    )
                except Exception:
                    pass

            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, "
                "entity_type, entity_id, description) VALUES "
                "('staff', %s, (SELECT full_name FROM users WHERE id = %s), "
                "'termination_confirmed', 'termination', %s, %s)",
                (int(actor_id), int(actor_id), int(term_id),
                 f'Подтверждено расторжение договора: {u[1] if u else emp_id}'),
            )
            conn.commit()
            return _resp(200, {'success': True})

        if action == 'reject':
            term_id = body_data.get('terminationId')
            actor_id = body_data.get('actorId')
            reason = (body_data.get('reason') or '').strip()
            if not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Отклоняет только администратор'})
            if not reason:
                return _resp(400, {
                    'error': 'Укажите причину отказа — сотрудник должен понимать, '
                             'что не так'})

            cur.execute(
                "UPDATE contract_terminations SET status = 'rejected', "
                "  rejected_at = now(), rejected_by = %s, reject_reason = %s "
                "WHERE id = %s AND status = 'pending_admin' RETURNING user_id",
                (int(actor_id), reason[:1000], int(term_id)),
            )
            row = cur.fetchone()
            if not row:
                return _resp(409, {'error': 'Заявление не ждёт решения'})

            cur.execute("SELECT max_user_id FROM users WHERE id = %s", (row[0],))
            u = cur.fetchone()
            if u and u[0]:
                try:
                    send_max(
                        u[0],
                        f'Заявление о расторжении договора отклонено.\n'
                        f'Причина: {reason}\n\n'
                        f'Обратитесь к администратору, чтобы решить вопрос.',
                    )
                except Exception:
                    pass
            conn.commit()
            return _resp(200, {'success': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()