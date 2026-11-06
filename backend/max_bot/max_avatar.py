"""Фото профиля из MAX: скачиваем к себе и ставим сотруднику.

В MAX нет метода «дай данные пользователя по id» (GET /users отдаёт 404, список
чатов GET /chats отключён в июне 2026). Фото есть только в описании ЛИЧНОГО
чата с ботом: GET /chats/{chat_id} -> dialog_with_user.avatar_url. Номер этого
чата приходит в каждом событии бота (старт по ссылке входа, сообщение), поэтому
запоминаем его в users.max_chat_id и при входе освежаем фото.

Картинку копируем в своё хранилище: ссылки MAX временные, а кружок на сайте
показывает только фото с нашего сервера. Фото, которое сотрудник поставил сам,
не трогаем: avatar_url меняется, только если он пустой или в нём прошлая копия
из MAX.
"""

import os
import tempfile
import uuid

import boto3
import certifi
import requests

MAX_API_URL = 'https://platform-api2.max.ru'
AVATAR_MAX_BYTES = 2 * 1024 * 1024
# Чаще раза в 6 часов к MAX за фото одного человека не ходим.
RECHECK_HOURS = 6

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


def _ca_bundle() -> str:
    global _CA_PATH
    if _CA_PATH and os.path.exists(_CA_PATH):
        return _CA_PATH
    f = tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False)
    with open(certifi.where(), 'r', encoding='utf-8') as src:
        f.write(src.read())
    f.write('\n')
    f.write(RUSSIAN_TRUSTED_CA)
    f.close()
    _CA_PATH = f.name
    return _CA_PATH


def _dialog_avatar(chat_id: str, max_user_id: str) -> str | None:
    """Ссылка на фото собеседника в личном чате с ботом (только если это он)."""
    token = (os.environ.get('MAX_BOT_TOKEN') or '').strip()
    if not token or not chat_id:
        return None
    resp = requests.get(
        f'{MAX_API_URL}/chats/{chat_id}',
        headers={'Authorization': token},
        timeout=10,
        verify=_ca_bundle(),
    )
    if resp.status_code != 200:
        return None
    user = (resp.json() or {}).get('dialog_with_user') or {}
    # Фото берём, только если чат и правда с этим человеком: иначе снимок
    # мог бы попасть на чужую карточку.
    if str(user.get('user_id') or '') != str(max_user_id):
        return None
    return (user.get('full_avatar_url') or user.get('avatar_url') or '').strip() or None


def _store_copy(src_url: str) -> str | None:
    """Скачивает картинку и кладёт в наше хранилище. Возвращает нашу ссылку."""
    resp = requests.get(src_url, timeout=15, verify=_ca_bundle(), stream=True)
    if resp.status_code != 200:
        return None
    ctype = (resp.headers.get('Content-Type') or '').split(';')[0].strip().lower()
    if not ctype.startswith('image/'):
        return None
    data = resp.raw.read(AVATAR_MAX_BYTES + 1, decode_content=True)
    if not data or len(data) > AVATAR_MAX_BYTES:
        return None
    ext = {'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'}.get(ctype, 'jpg')
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'avatars/max-{uuid.uuid4().hex}.{ext}'
    s3.put_object(Bucket='files', Key=key, Body=data, ContentType=ctype)
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def refresh_max_avatar(cur, max_user_id: str, chat_id: str | None = None, force: bool = False) -> str:
    """Освежает фото сотрудника из MAX. Возвращает 'updated' / 'same' / 'skip' / 'none'.

    chat_id — номер личного чата из события бота; запоминаем его за сотрудником,
    чтобы потом обновлять фото и без нового входа (кнопка в «Пользователях»).
    """
    max_user_id = str(max_user_id or '').strip()
    if not max_user_id:
        return 'skip'
    cur.execute(
        "SELECT id, max_chat_id, max_avatar_src, "
        "       max_avatar_checked_at > now() - make_interval(hours => %s) "
        "FROM users WHERE max_user_id = %s ORDER BY is_active DESC, id LIMIT 1",
        (RECHECK_HOURS, max_user_id),
    )
    row = cur.fetchone()
    if not row:
        return 'skip'
    user_id, known_chat, prev_src, fresh = row
    chat_id = str(chat_id or '').strip() or (known_chat or '')
    if chat_id and chat_id != (known_chat or ''):
        cur.execute('UPDATE users SET max_chat_id = %s WHERE id = %s', (chat_id, user_id))
    if not chat_id or (fresh and not force):
        return 'skip'
    cur.execute('UPDATE users SET max_avatar_checked_at = now() WHERE id = %s', (user_id,))
    src = _dialog_avatar(chat_id, max_user_id)
    if not src:
        return 'none'
    if src == prev_src:
        return 'same'
    copy = _store_copy(src)
    if not copy:
        return 'none'
    # Правая часть SET видит СТАРЫЕ значения: avatar_url заменяем, только если
    # он пустой или в нём лежала прошлая копия из MAX (своё фото главнее).
    cur.execute(
        "UPDATE users SET "
        "  avatar_url = CASE WHEN COALESCE(avatar_url, '') = '' "
        "                      OR avatar_url = max_avatar_url THEN %s ELSE avatar_url END, "
        "  max_avatar_url = %s, max_avatar_src = %s, updated_at = now() "
        "WHERE id = %s",
        (copy, copy, src, user_id),
    )
    return 'updated'
