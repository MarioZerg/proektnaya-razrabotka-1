import json
import os
import tempfile
import urllib.error
import urllib.request

import certifi
import psycopg2
import requests

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Content-Type': 'application/json',
}

# Ссылка на функцию отправки цен: робот не пишет на витрину сам, а зовёт ту же
# проверенную функцию, что и кнопка на экране. Все её предохранители — сверка
# с базой, потолок шага, журнал — работают и для робота.
PRICE_PUSH_URL = (
    'https://functions.poehali.dev/fc1cfb34-b57c-41d4-97d9-fcee27c9af6a')


# Потолок одного нажатия: 3% — уже заметное движение для выдачи, а опечатка
# в поле «50» стоила бы витрины. Опускать этой кнопкой больше нельзя.
MAX_STEP_PERCENT = 3.0


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def _db():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _is_admin(cur, actor_id):
    """Цены двигает только владелец: это витрина и деньги."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _log_run(cur, mp, decision, reason, **kw):
    """Пишет шаг в журнал.

    dry_run всегда false: режима наблюдения больше нет — цены двигает владелец
    кнопкой, и каждый шаг настоящий. Колонка осталась ради старых записей.
    """
    cur.execute(
        "INSERT INTO price_robot_runs (marketplace_code, decision, reason, "
        "  step_percent, items_pushed, items_failed, dry_run) "
        "VALUES (%s, %s, %s, %s, %s, %s, false) RETURNING id",
        (mp, decision, reason, kw.get('step'),
         kw.get('pushed', 0), kw.get('failed', 0)))
    return (cur.fetchone() or [None])[0]


# ── УВЕДОМЛЕНИЯ АДМИНУ В MAX ────────────────────────────────────────────────
#
# Сдвиг цен могут запустить с любого устройства, а досыл остатка доделывает
# планировщик уже без человека. Сообщение в MAX — единственный способ узнать
# итог, не заходя в систему специально.

MAX_API_URL = 'https://platform-api2.max.ru'

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





def _send_max(max_user_id, text):
    """Сообщение в MAX. Токен — в заголовке, чтобы не попал в логи."""
    requests.post(
        f'{MAX_API_URL}/messages',
        params={'user_id': max_user_id},
        json={'text': text},
        headers={'Authorization': os.environ['MAX_BOT_TOKEN']},
        timeout=10,
        verify=_get_ca_bundle(),
    ).raise_for_status()


# О чём сообщаем, а о чём молчим.
#
# «Рано» и «выждали» происходят почти каждую ночь и ничего не меняют — слать
# их значит приучить владельца пролистывать сообщения робота не читая. Пишем
# только когда цены реально поехали или робот остановился.
DECISION_TITLE = {
    'manual': 'Цены сдвинуты вручную',
}


def _notify_admins(cur, decision, reason, pushed):
    """Пишет админам в MAX о сдвиге цен.

    Ошибку отправки глушим: если MAX недоступен, цены всё равно ушли, и валить
    из-за этого весь шаг нельзя.
    """
    cur.execute(
        "SELECT max_user_id FROM users "
        "WHERE role = 'admin' AND max_user_id IS NOT NULL")
    admins = [r[0] for r in cur.fetchall()]
    if not admins:
        return {'sent': 0, 'errors': ['Нет админов с привязанным MAX']}

    lines = [DECISION_TITLE.get(decision, 'Цены сдвинуты'), '', reason or '']
    if pushed:
        lines.append(f'Карточек изменено: {pushed}')

    text = '\n'.join(l for l in lines if l is not None)
    sent, errors = 0, []
    for uid in admins:
        try:
            _send_max(uid, text)
            sent += 1
        except Exception as e:
            errors.append(str(e)[:200])
    return {'sent': sent, 'errors': errors}


def _catalog(cur, mp='ozon'):
    """Ассортимент площадки с ценами — из него владелец набирает подъём.

    Отдаём вместе с материалом, размерами и магазином: подъём теперь не всегда
    идёт по всему магазину, и выбирать товары надо на экране, а не в SQL. По
    этим же полям на странице работает фильтр «только ширина 300» и подобные.
    """
    cur.execute(
        "SELECT mi.id, mi.name, mi.material, mi.width, mi.height, mi.sku, "
        "       mi.shop_id, s.name, mp2.price "
        "FROM marketplace_items mi "
        "JOIN marketplace_prices mp2 ON mp2.marketplace_item_id = mi.id "
        "  AND mp2.marketplace_code = %s "
        "LEFT JOIN shops s ON s.id = mi.shop_id "
        "WHERE mp2.price > 0 AND mi.sku IS NOT NULL "
        "ORDER BY mi.material, mi.width, mi.height", (mp,))
    return [{
        'itemId': int(r[0]), 'name': r[1], 'material': r[2],
        'width': int(r[3]) if r[3] is not None else None,
        'height': int(r[4]) if r[4] is not None else None,
        'sku': r[5],
        'shopId': int(r[6]) if r[6] is not None else None,
        'shopName': r[7],
        'price': float(r[8]),
    } for r in cur.fetchall()]


def _all_items(cur, mp='ozon', item_ids=None):
    """Товары площадки с ценой, которым можно двигать цену.

    item_ids — выбор владельца на экране (фильтр по материалу и размерам).
    Пересекаем его с тем, что реально есть в базе с живой ценой: список пришёл
    из браузера, и полагаться на него как на источник правды нельзя. Без
    выбора двигаем весь ассортимент — как было раньше.
    """
    sql = (
        "SELECT mi.id, mp2.price "
        "FROM marketplace_items mi "
        "JOIN marketplace_prices mp2 ON mp2.marketplace_item_id = mi.id "
        "  AND mp2.marketplace_code = %s "
        "WHERE mp2.price > 0 AND mi.sku IS NOT NULL")
    if item_ids:
        ids = ','.join(str(int(i)) for i in item_ids)
        sql += f" AND mi.id IN ({ids})"
    cur.execute(sql, (mp,))
    return [{'itemId': int(r[0]), 'price': float(r[1])} for r in cur.fetchall()]


def _push(mp, items, actor_id):
    """Отправляет цены через проверенную функцию отправки.

    Своей записи на витрину у робота нет специально: пусть работают те же
    предохранители, что и у кнопки владельца.
    """
    payload = {'action': 'push', 'marketplace': mp, 'items': items,
               'actorId': actor_id,
               # Присылаем «Вашу цену» — пересчитывать её не нужно.
               'sellerPrice': True}
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(PRICE_PUSH_URL, method='POST', data=body)
    req.add_header('Content-Type', 'application/json')
    # Ждать долго нечего: наш собственный вызов оборвётся раньше. Лучше
    # быстро вернуть ошибку и дослать пачку следующим кругом, чем висеть
    # до последнего и потерять весь прогресс вместе с ним.
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode('utf-8', errors='replace')[:300]}
    except Exception as e:
        return {'error': str(e)}


# Сколько карточек отправляем за один вызов.
#
# Здесь работает ЦЕПОЧКА ИЗ ДВУХ функций: робот вызывает функцию отправки, и
# обе живут по 5 секунд. То есть уложиться надо не в 5 секунд, а в остаток
# после похода на площадку и записи результатов — окно куда уже, чем кажется.
#
# Пачка в 60 карточек в него не влезала: вызов обрывался на середине, цены на
# витрине менялись, а у нас не сохранялись. Счётчик замирал на 120, и весь
# ассортимент так и не проходил — «обрыв после второго обхода».
#
# 25 — размер, который проходит с запасом даже когда Ozon отвечает медленно.
# Кругов больше, но каждый доходит до конца, а досыл идёт сам.
BATCH_SIZE = 25


def _start_step(cur, mp, step, decision, reason, actor_id, item_ids=None):
    """Начинает шаг: запоминает список товаров и отправляет первую пачку.

    item_ids — карточки, отобранные фильтром на экране. Список фиксируется
    здесь и лежит в price_robot_pending до конца шага: если между пачками
    кто-то заведёт новый товар, он в этот подъём не попадёт. Иначе владелец
    поднял бы не то, что видел на экране, когда нажимал кнопку.
    """
    items = _all_items(cur, mp, item_ids)
    if not items:
        return 0, 0, 0, ('Под фильтр не попал ни один товар с ценой'
                         if item_ids else
                         'Нет товаров с ценой — двигать нечего')
    cur.execute(
        "INSERT INTO price_robot_pending (marketplace_code, step_percent, "
        "  decision, reason, remaining_ids, started_by) "
        "VALUES (%s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (marketplace_code) DO UPDATE SET "
        "  step_percent = EXCLUDED.step_percent, "
        "  decision = EXCLUDED.decision, reason = EXCLUDED.reason, "
        "  remaining_ids = EXCLUDED.remaining_ids, pushed = 0, failed = 0, "
        "  started_at = now(), started_by = EXCLUDED.started_by",
        (mp, step, decision, reason,
         json.dumps([i['itemId'] for i in items]), actor_id))
    return _continue_step(cur, mp, actor_id)


def _continue_step(cur, mp, actor_id):
    """Отправляет очередную пачку цен незавершённого шага.

    Возвращает (отправлено, отклонено, осталось, ошибка). Пока осталось больше
    нуля, шаг не закончен и в журнал не пишется: незачем плодить записи об
    одном и том же движении цен.
    """
    cur.execute(
        "SELECT step_percent, remaining_ids, pushed, failed "
        "FROM price_robot_pending WHERE marketplace_code = %s", (mp,))
    row = cur.fetchone()
    if not row:
        return 0, 0, 0, 'Нет незавершённого шага'
    step = float(row[0])
    remaining = row[1] if isinstance(row[1], list) else json.loads(row[1] or '[]')
    pushed_total, failed_total = int(row[2] or 0), int(row[3] or 0)
    if not remaining:
        return pushed_total, failed_total, 0, None

    batch = remaining[:BATCH_SIZE]
    rest = remaining[len(batch):]

    # Цены берём из базы прямо сейчас: между пачками их мог поменять кто-то ещё.
    id_list = ','.join(str(int(i)) for i in batch)
    #
    # ДВИГАЕМ «ВАШУ ЦЕНУ» — нашу цену продавца из кабинета.
    #
    # Это основная цена товара: от неё площадка считает свою скидку для
    # покупателя. Поднять на 5% нужно именно её.
    #
    # Отправляем с пометкой sellerPrice, чтобы функция отправки взяла цену как
    # есть. Без пометки она считает присланное ценой покупателя и пересчитывает
    # ещё раз — 24 августа из-за этого вместо 0.5% магазин подорожал на 5-18%.
    cur.execute(
        "SELECT marketplace_item_id, price FROM marketplace_prices "
        f"WHERE marketplace_code = %s AND marketplace_item_id IN ({id_list}) "
        "  AND price > 0", (mp,))
    k = 1 + step / 100
    payload = [{'itemId': int(r[0]), 'newPrice': round(float(r[1]) * k, 2)}
               for r in cur.fetchall()]

    # ВЫЧЁРКИВАЕМ ПАЧКУ ДО ПОХОДА НА ПЛОЩАДКУ.
    #
    # Если функцию оборвёт по таймауту после отправки, но до записи прогресса,
    # эти же карточки уйдут повторно и подорожают дважды. Так и случилось:
    # 200 цен ушли на Ozon, а в очереди осталось 674 — следующий вызов поднял
    # бы их ещё раз. Лучше потерять пачку, чем сдвинуть её дважды: пропущенное
    # видно при сверке, а двойной подъём уже на витрине.
    cur.execute(
        "UPDATE price_robot_pending SET remaining_ids = %s "
        "WHERE marketplace_code = %s", (json.dumps(rest), mp))

    if payload:
        res = _push(mp, payload, actor_id)
        if res.get('error'):
            return pushed_total, failed_total, len(rest), \
                f'Площадка не приняла цены: {res["error"]}'
        pushed_total += int(res.get('pushed') or 0)
        failed_total += len(res.get('failed') or []) + len(res.get('skipped') or [])

    cur.execute(
        "UPDATE price_robot_pending SET pushed = %s, failed = %s "
        "WHERE marketplace_code = %s", (pushed_total, failed_total, mp))
    return pushed_total, failed_total, len(rest), None


def _finish_step(cur, mp):
    """Забирает итог завершённого шага и убирает его из очереди."""
    cur.execute(
        "SELECT step_percent, decision, reason, pushed, failed, started_by "
        "FROM price_robot_pending "
        "WHERE marketplace_code = %s AND remaining_ids = '[]'::jsonb", (mp,))
    row = cur.fetchone()
    if not row:
        return None
    cur.execute("DELETE FROM price_robot_pending WHERE marketplace_code = %s",
                (mp,))
    return {'step': float(row[0]), 'decision': row[1], 'reason': row[2],
            'pushed': int(row[3] or 0), 'failed': int(row[4] or 0),
            'actorId': row[5]}


def _pending_left(cur, mp):
    """Сколько карточек ждёт отправки в незавершённом шаге."""
    cur.execute(
        "SELECT jsonb_array_length(remaining_ids) FROM price_robot_pending "
        "WHERE marketplace_code = %s", (mp,))
    r = cur.fetchone()
    return int(r[0]) if r else 0


def _repair_to(cur, mp, actor_id, baseline_date, uplift, limit=200):
    """Выправляет цены к эталону: цена на дату baseline_date плюс uplift %.

    Нужна после сбоя: 24 августа шаг ушёл на площадку с двойным пересчётом,
    и часть магазина подорожала на 5-18% вместо 0.5%. Возвращаем каждую
    карточку к тому значению, которое и должно было получиться.
    """
    cur.execute(
        "SELECT mp.marketplace_item_id, round(h.price * %s, 2) "
        "FROM marketplace_prices mp "
        "JOIN price_history h ON h.marketplace_item_id = mp.marketplace_item_id "
        "  AND h.marketplace_code = %s AND h.captured_on = %s "
        "WHERE mp.marketplace_code = %s AND h.price > 0 "
        "  AND abs(round(h.price * %s, 2) - mp.price) > 0.5 "
        f"ORDER BY mp.marketplace_item_id LIMIT {int(limit)}",
        (1 + uplift / 100, mp, baseline_date, mp, 1 + uplift / 100))
    rows = cur.fetchall()
    if not rows:
        return 0, 0, 0
    payload = [{'itemId': int(r[0]), 'newPrice': float(r[1])} for r in rows]
    res = _push(mp, payload, actor_id)
    if res.get('error'):
        return 0, 0, len(rows)
    pushed = int(res.get('pushed') or 0)
    failed = len(res.get('failed') or []) + len(res.get('skipped') or [])
    return pushed, failed, len(rows)


def _manual_move(cur, mp, step, actor_id, note='', item_ids=None, scope=''):
    """СДВИГ ЦЕН ПО КНОПКЕ ВЛАДЕЛЬЦА — единственный способ двигать цены.

    Автоподъём по спросу убран: спрос считался по выгрузке продаж, а она может
    отстать. 28 августа выгрузка стояла с 23-го, робот увидел в базе ноль,
    счёл это обвалом и опустил 613 карточек, поднятых четырьмя днями раньше.
    Режима наблюдения тоже нет: раз цены двигает человек, каждый шаг настоящий.

    item_ids — карточки под фильтром «материал и размеры»: поднимать весь
    магазин разом нужно не всегда, чаще — только широкие полотна или один
    материал. scope описывает выбор словами и уходит в журнал: через месяц по
    записи «подняли на 1%» иначе не понять, что именно подорожало.
    """
    if not step or step <= 0:
        return {'error': 'Цены двигаются только вверх — укажите, на сколько процентов'}
    # Потолок на одно нажатие: разовый рывок по всему магазину опаснее всего,
    # а опечатка в поле «50» стоила бы витрины.
    if step > MAX_STEP_PERCENT:
        return {'error': f'За один раз не больше {MAX_STEP_PERCENT}% — '
                         f'слишком резко для витрины'}

    reason = (f'Ручной подъём: подняли цены на {step}%'
              + (f'. {scope}' if scope else '')
              + (f'. {note}' if note else ''))

    # Незаконченный шаг сначала дожимаем, а не отказываем: владелец нажал
    # кнопку и ждёт результата, а не сообщения «подождите».
    if _pending_left(cur, mp):
        pushed, failed, left, err = _continue_step(cur, mp, actor_id)
        # ОСЕЧКА НА ПАЧКЕ — НЕ КОНЕЦ ПРОГОНА.
        #
        # Ozon ограничивает частоту обращений и периодически отвечает отказом.
        # Раньше такой ответ возвращался как ошибка, продвижение падало и
        # вставало на середине ассортимента. Но очередь-то никуда не делась:
        # если карточки ещё остались, honest-ответ — «идём дальше», и
        # следующий круг просто повторит попытку.
        if err and left:
            return {'ok': True, 'inProgress': True, 'pushed': pushed,
                    'left': left,
                    'reason': f'Площадка притормозила, пробуем дальше: '
                              f'отправлено {pushed}, осталось {left}'}
        if err:
            return {'error': err}
        if left:
            return {'ok': True, 'inProgress': True, 'pushed': pushed,
                    'left': left,
                    'reason': f'Досылаем прошлый шаг: отправлено {pushed}, '
                              f'осталось {left}'}
        done = _finish_step(cur, mp)
        if done:
            reason = f'{done["reason"]}. Карточек изменено: {done["pushed"]}'
            run_id = _log_run(cur, mp, done['decision'], reason,
                              step=done['step'],
                              pushed=done['pushed'], failed=done['failed'])
            return {'ok': True, 'runId': run_id, 'step': done['step'],
                    'pushed': done['pushed'], 'reason': reason}

    # Отправка идёт пачками: весь магазин за один вызов не успевает.
    pushed, failed, left, err = _start_step(
        cur, mp, step, 'manual', reason, actor_id, item_ids)
    # Первая пачка не прошла, но очередь заведена — продолжаем кругами,
    # а не роняем весь прогон из-за одной осечки площадки.
    if err and left:
        return {'ok': True, 'inProgress': True, 'step': step,
                'pushed': pushed, 'left': left,
                'reason': f'{reason}. Площадка притормозила, '
                          f'осталось {left} — продолжаем'}
    if err:
        return {'error': err}
    if left:
        # Шаг не закончен: в журнал попадёт, когда уйдут все карточки.
        return {'ok': True, 'inProgress': True, 'step': step,
                'pushed': pushed, 'left': left,
                'reason': f'{reason}. Отправлено {pushed}, '
                          f'осталось {left} — продолжаем'}
    _finish_step(cur, mp)
    reason += f'. Карточек изменено: {pushed}'

    run_id = _log_run(cur, mp, 'manual', reason, step=step,
                      pushed=pushed, failed=failed)

    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, "
        "  entity_type, entity_id, description, details, created_at) "
        "VALUES (%s, 'Робот цен', 'prices', 'price_robot_manual', "
        "  'price_robot', %s, %s, %s, now())",
        (actor_id, run_id, reason[:500], json.dumps(
            {'step': step, 'pushed': pushed, 'scope': scope},
            ensure_ascii=False)))

    notify = _notify_admins(cur, 'manual', reason, pushed)
    return {'ok': True, 'runId': run_id, 'step': step, 'pushed': pushed,
            'failed': failed, 'reason': reason, 'notify': notify}


def _run(cur, mp, actor_id):
    """ДОСЫЛ НЕЗАКОНЧЕННОГО ШАГА — всё, что осталось от ночного цикла.

    Своих решений робот больше не принимает: цены двигает владелец кнопкой.
    Но одна работа для расписания есть. Шаг уходит пачками по 25 карточек, и
    если браузер закрыли на середине, магазин остаётся в разнобое — часть цен
    поднята, часть нет. Планировщик дёргает эту функцию раз в час и дожимает
    остаток, в какой бы час это ни случилось.
    """
    if not _pending_left(cur, mp):
        return {'ok': True, 'decision': 'idle',
                'reason': 'Незаконченных шагов нет. Цены двигаются только '
                          'вручную — кнопкой на странице продвижения'}

    pushed, failed, left, err = _continue_step(cur, mp, actor_id)
    if err:
        return {'ok': True, 'decision': 'hold', 'reason': err,
                'pushed': pushed, 'left': left}
    if left:
        return {'ok': True, 'decision': 'sending', 'pushed': pushed,
                'left': left,
                'reason': f'Досылаем цены: отправлено {pushed}, '
                          f'осталось {left}'}

    done = _finish_step(cur, mp)
    if not done:
        return {'ok': True, 'decision': 'idle', 'pushed': pushed,
                'reason': 'Остаток отправлен'}

    reason = f'{done["reason"]}. Карточек изменено: {done["pushed"]}'
    run_id = _log_run(cur, mp, done['decision'], reason, step=done['step'],
                      pushed=done['pushed'], failed=done['failed'])

    # Отметка в общем журнале: по ней экран «Планировщик» понимает, что задание
    # живо. Без неё оно выглядело бы там молчащим.
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, "
        "  entity_type, entity_id, description, details, created_at) "
        "VALUES (%s, 'Робот цен', 'prices', 'price_robot', 'price_robot', "
        "  %s, %s, %s, now())",
        (actor_id, run_id, reason[:500], json.dumps(
            {'decision': done['decision'], 'pushed': done['pushed']},
            ensure_ascii=False)))

    notify = _notify_admins(cur, done['decision'], reason, done['pushed'])
    return {'ok': True, 'runId': run_id, 'decision': done['decision'],
            'reason': reason, 'pushed': done['pushed'],
            'failed': done['failed'], 'notify': notify}


def handler(event: dict, context) -> dict:
    """Сдвиг цен на витрине по кнопке владельца.

    Автоматики здесь больше нет. Робот сам поднимал цены по спросу и откатывал
    их при просадке, но спрос он считал по выгрузке продаж — а она отстаёт: 28
    августа выгрузка стояла с 23-го, робот увидел ноль и опустил 613 карточек.
    Теперь решение всегда за человеком, а функция лишь исполняет его аккуратно:
    пачками по 25 карточек, с памятью о месте остановки.

    Поднимать весь магазин разом нужно не всегда, поэтому шаг принимает список
    карточек — их владелец отбирает на экране фильтром по материалу и размерам.

    GET  ?action=status&actorId=        — каталог с ценами, остаток, журнал
    POST { action: 'move', step, itemIds?, scope?, note? } — сдвинуть цены
    POST { action: 'run', cronSecret }  — дослать незаконченный шаг
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = _db()
    conn.autocommit = True
    cur = conn.cursor()
    try:
        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            if params.get('action') != 'status':
                return _resp(400, {'error': 'Неизвестное действие'})
            if not _is_admin(cur, params.get('actorId')):
                return _resp(403, {'error': 'Только для администратора'})

            mp = params.get('marketplace') or 'ozon'
            cur.execute(
                "SELECT ran_at, decision, reason, step_percent, items_pushed "
                "FROM price_robot_runs "
                "WHERE marketplace_code = %s ORDER BY ran_at DESC LIMIT 30",
                (mp,))
            runs = [{
                'ranAt': r[0], 'decision': r[1], 'reason': r[2],
                'stepPercent': float(r[3]) if r[3] is not None else None,
                'itemsPushed': r[4],
            } for r in cur.fetchall()]

            return _resp(200, {
                # Каталог отдаём целиком: фильтр по материалу и размерам живёт
                # на странице, и пересчитывать выбор походом на сервер после
                # каждой галочки незачем — карточек меньше тысячи.
                'catalog': _catalog(cur, mp),
                # Сколько карточек ждёт отправки: шаг идёт пачками.
                'pendingLeft': _pending_left(cur, mp),
                'maxStepPercent': MAX_STEP_PERCENT,
                'runs': runs,
            })

        if method != 'POST':
            return _resp(405, {'error': 'Метод не поддерживается'})

        body = json.loads(event.get('body') or '{}')
        action = body.get('action')
        mp = body.get('marketplace') or 'ozon'

        if action == 'repair':
            # Разовое выправление цен после сбоя 24 августа.
            if not _is_admin(cur, body.get('actorId')):
                return _resp(403, {'error': 'Только для администратора'})
            pushed, failed, total = _repair_to(
                cur, mp, body.get('actorId'),
                body.get('baseline') or '2026-08-20',
                # Ноль — законная надбавка «вернуть ровно к эталону».
                # Через `or` он превратился бы в 0.5 и вернул не туда.
                float(body.get('uplift') if body.get('uplift') is not None
                      else 0.5),
                int(body.get('limit') or 200))
            cur.execute(
                "SELECT count(*) FROM marketplace_prices mp "
                "JOIN price_history h "
                "  ON h.marketplace_item_id = mp.marketplace_item_id "
                "  AND h.marketplace_code = %s AND h.captured_on = %s "
                "WHERE mp.marketplace_code = %s AND h.price > 0 "
                "  AND abs(round(h.price * %s, 2) - mp.price) > 0.5",
                (mp, body.get('baseline') or '2026-08-20', mp,
                 1 + float(body.get('uplift') if body.get('uplift') is not None
                           else 0.5) / 100))
            left = int((cur.fetchone() or [0])[0] or 0)
            return _resp(200, {'ok': True, 'pushed': pushed, 'failed': failed,
                               'batch': total, 'left': left})

        if action == 'move':
            # Сдвиг цен по кнопке владельца — единственный способ их двигать.
            if not _is_admin(cur, body.get('actorId')):
                return _resp(403, {'error': 'Только для администратора'})
            # Карточки под фильтром. Пустой список и его отсутствие — разные
            # вещи: без фильтра двигаем весь магазин, а пустой выбор двигать
            # нечего, и молча поднять всё вместо ничего было бы худшим ответом.
            raw_ids = body.get('itemIds')
            if isinstance(raw_ids, list):
                item_ids = [int(i) for i in raw_ids if str(i).strip()]
                if not item_ids:
                    return _resp(400, {'error': 'Не выбрано ни одного товара'})
            else:
                item_ids = None
            res = _manual_move(cur, mp, float(body.get('step') or 0),
                               body.get('actorId'),
                               (body.get('note') or '').strip()[:200],
                               item_ids,
                               (body.get('scope') or '').strip()[:200])
            return _resp(400 if res.get('error') else 200, res)

        if action == 'run':
            # Досыл остатка. Часа запуска больше нет: своих решений робот не
            # принимает, а недосланный шаг оставляет магазин в разнобое — его
            # надо дожать при первой возможности, а не ждать назначенной ночи.
            secret = body.get('cronSecret')
            actor_id = body.get('actorId')
            by_cron = secret and secret == os.environ.get('CRON_SECRET')
            if not by_cron and not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Только для администратора'})
            return _resp(200, _run(cur, mp, actor_id))

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        cur.close()
        conn.close()
