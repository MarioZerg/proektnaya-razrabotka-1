import json
import os
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timedelta

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


# Робот двигает цены всего ассортимента разом, поэтому шаг ограничен жёстко:
# 3% за раз по всему магазину — уже заметное движение для выдачи.
MAX_STEP_PERCENT = 3.0


# Москва — UTC+3. Сервер работает по UTC, владелец думает по-московски.
MSK_OFFSET = timedelta(hours=3)


def _msk_now():
    """Текущее московское время: в нём владелец задаёт час запуска."""
    return datetime.utcnow() + MSK_OFFSET


def _utc_now():
    """Время в том же счёте, что и метки в базе.

    База пишет now() по UTC, и сравнивать её метки с московским временем
    нельзя: разница в три часа превратилась бы в «прошло 3 часа» сразу после
    шага, и робот двинул бы цены раньше срока.
    """
    return datetime.utcnow()


def _msk_hour():
    return _msk_now().hour


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def _db():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _is_admin(cur, actor_id):
    """Настройки робота меняет только владелец: это витрина и деньги."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _settings(cur, mp='ozon'):
    cur.execute(
        "SELECT is_active, dry_run, step_percent, step_days, run_hour, "
        "       target_total_percent, drop_percent, max_total_percent, "
        "       updated_at, demand_window_days, require_second_signal "
        "FROM price_robot_settings WHERE marketplace_code = %s", (mp,))
    r = cur.fetchone()
    if not r:
        return None
    return {
        'isActive': bool(r[0]), 'dryRun': bool(r[1]),
        'stepPercent': float(r[2]), 'stepDays': int(r[3]),
        'runHour': int(r[4]),
        # ЦЕЛЬ: на сколько всего поднять цены. Не маржа — просто процент.
        'targetTotalPercent': float(r[5]),
        'dropPercent': float(r[6]), 'maxTotalPercent': float(r[7]),
        'updatedAt': r[8],
        # Сколько дней продаж сравнивать. Короткое окно шумит: один слабый
        # день даёт минус 30% и откат цены на ровном месте.
        'demandWindowDays': max(3, int(r[9] or 3)),
        # Откатывать только после второго падения подряд.
        'requireSecondSignal': bool(r[10]),
    }


def _units_in_period(cur, d_from, d_to):
    """Сколько вещей FBS продано за отрезок — по нему судим о спросе."""
    cur.execute(
        "SELECT coalesce(sum(s.quantity), 0) FROM marketplace_sales s "
        "WHERE NOT s.is_return AND s.scheme = 'FBS' "
        f"  AND s.sold_at >= '{d_from}'::date "
        f"  AND s.sold_at < '{d_to}'::date")
    return int((cur.fetchone() or [0])[0] or 0)


def _last_run(cur, mp='ozon', dry_run=False):
    """Последний РЕЗУЛЬТАТИВНЫЙ шаг: подъём или откат.

    Прогоны с решением «рано» и «цель достигнута» цену не двигали, и отсчитывать
    паузу от них нельзя — иначе робот, запускаемый ежедневно, никогда бы не
    дождался своих двух дней.

    Режим тоже разделён: шаги наблюдения и боевые живут отдельными дорожками.
    """
    cur.execute(
        "SELECT ran_at, decision, step_percent, units_after "
        "FROM price_robot_runs "
        # Ручной сдвиг — тоже шаг: после него роботу нужно выждать паузу и
        # посмотреть на спрос, иначе он ночью двинет цены поверх свежей ручной
        # правки, не дав ей проявиться.
        "WHERE marketplace_code = %s "
        "  AND decision IN ('raise', 'rollback', 'manual') "
        "  AND dry_run = %s "
        "ORDER BY ran_at DESC LIMIT 1", (mp, bool(dry_run)))
    r = cur.fetchone()
    if not r:
        return None
    return {'ranAt': r[0], 'decision': r[1],
            'stepPercent': float(r[2] or 0), 'unitsAfter': int(r[3] or 0)}


def _total_drift(cur, mp='ozon', dry_run=False):
    """Насколько цены уже уехали от точки старта, %.

    Мелкие шаги копятся: двадцать подъёмов по 0.5% — это уже +10%. По этому
    счётчику робот понимает, дошёл ли до цели, и не даёт себе уйти дальше
    предела.

    Считаем ОТДЕЛЬНО для наблюдения и для боевого режима. В наблюдении цены
    не двигались, но робот должен вести себя как настоящий: иначе счётчик
    стоял бы на нуле, и он вечно повторял бы первый шаг, а владелец так и не
    увидел бы, как робот доходит до цели и останавливается. При этом смешивать
    их нельзя — переключившись в бой, робот считал бы уже поднятыми те
    проценты, которых на витрине никогда не было.
    """
    cur.execute(
        "SELECT coalesce(sum(step_percent), 0) FROM price_robot_runs "
        # Ручной сдвиг двигал те же цены, что и робот, поэтому считается
        # наравне: опустили руками на 2% — роботу до цели снова дальше.
        "WHERE marketplace_code = %s "
        "  AND decision IN ('raise', 'rollback', 'manual') "
        "  AND dry_run = %s", (mp, bool(dry_run)))
    return round(float((cur.fetchone() or [0])[0] or 0), 2)


def _log_run(cur, mp, decision, reason, **kw):
    cur.execute(
        "INSERT INTO price_robot_runs (marketplace_code, decision, reason, "
        "  step_percent, drift_percent, units_after, units_before, units_change, "
        "  items_pushed, items_failed, dry_run) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (mp, decision, reason, kw.get('step'), kw.get('drift'),
         kw.get('unitsAfter'), kw.get('unitsBefore'), kw.get('unitsChange'),
         kw.get('pushed', 0), kw.get('failed', 0), kw.get('dryRun', True)))
    return (cur.fetchone() or [None])[0]


# ── УВЕДОМЛЕНИЯ АДМИНУ В MAX ────────────────────────────────────────────────
#
# Робот работает ночью и без спроса. Владелец должен узнавать о его шагах
# сразу, а не когда откроет систему через неделю и обнаружит уехавшие цены.

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
NOTIFY_ON = ('raise', 'rollback', 'stop', 'manual')

DECISION_TITLE = {
    'raise': 'Робот поднял цены',
    'rollback': 'Робот откатил цены назад',
    'stop': 'Робот остановился — цель достигнута',
    'manual': 'Цены сдвинуты вручную',
}


def _notify_admins(cur, decision, d, pushed, dry_run):
    """Пишет админам в MAX о шаге робота.

    Ошибку отправки глушим: если MAX недоступен, робот всё равно отработал,
    и валить из-за этого весь цикл нельзя.
    """
    if decision not in NOTIFY_ON:
        return {'sent': 0, 'errors': []}
    cur.execute(
        "SELECT max_user_id FROM users "
        "WHERE role = 'admin' AND max_user_id IS NOT NULL")
    admins = [r[0] for r in cur.fetchall()]
    if not admins:
        return {'sent': 0, 'errors': ['Нет админов с привязанным MAX']}

    head = DECISION_TITLE.get(decision, 'Робот цен')
    if dry_run:
        head += ' (наблюдение)'

    lines = [head, '', d.get('reason') or '']
    if d.get('drift') is not None:
        lines.append(f'Цены подняты на {d["drift"]}% от старта')
    if d.get('unitsChange') is not None:
        lines.append(
            f'Продажи: {d.get("unitsBefore")} → {d.get("unitsAfter")} шт '
            f'({d["unitsChange"]:+}%)')
    if pushed:
        lines.append(f'Карточек изменено: {pushed}')
    if dry_run and decision in ('raise', 'rollback'):
        lines.append('')
        lines.append('Цены на витрине НЕ менялись — робот в режиме наблюдения')

    text = '\n'.join(l for l in lines if l is not None)
    sent, errors = 0, []
    for uid in admins:
        try:
            _send_max(uid, text)
            sent += 1
        except Exception as e:
            errors.append(str(e)[:200])
    return {'sent': sent, 'errors': errors}


def _all_items(cur, mp='ozon'):
    """Весь ассортимент площадки с текущими ценами.

    Робот двигает магазин целиком, а не отдельные карточки: смысл в том, чтобы
    поднять общий уровень цен и посмотреть, как отреагирует спрос.
    """
    cur.execute(
        "SELECT mi.id, mp2.price "
        "FROM marketplace_items mi "
        "JOIN marketplace_prices mp2 ON mp2.marketplace_item_id = mi.id "
        "  AND mp2.marketplace_code = %s "
        "WHERE mp2.price > 0 AND mi.sku IS NOT NULL", (mp,))
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
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode('utf-8', errors='replace')[:300]}
    except Exception as e:
        return {'error': str(e)}


def _weak_before(cur, mp, dry_run, hours=20):
    """Было ли падение спроса замечено и на прошлой проверке.

    По этой отметке робот отличает случайный провал от настоящего падения:
    решение «ждём подтверждения» пишется в журнал, и если спрос просел снова,
    второй сигнал уже приводит к откату.

    Отметка должна быть не свежее указанного числа часов: замер скользящий,
    и два прогона подряд с разницей в минуту дали бы одни и те же цифры —
    подтверждением это считать нельзя.
    """
    cur.execute(
        "SELECT decision, reason, "
        "  extract(epoch from (now() - ran_at)) / 3600 "
        "FROM price_robot_runs "
        "WHERE marketplace_code = %s AND dry_run = %s "
        "  AND decision IN ('raise', 'rollback', 'manual', 'hold') "
        "ORDER BY ran_at DESC LIMIT 1", (mp, bool(dry_run)))
    r = cur.fetchone()
    return bool(r and r[0] == 'hold'
                and 'Ждём подтверждения' in (r[1] or '')
                and float(r[2] or 0) >= hours)


def _decide(cur, st, mp='ozon'):
    """РЕШЕНИЕ РОБОТА: поднимать, откатывать или ждать.

    Ориентир один — СПРОС. Не маржа, не юнит-экономика: там своя длинная
    арифметика, которая ломается, стоит площадке задержать отчёт. Спрос —
    вещь прямая: сколько штук продали за столько же дней до и после шага.

    Логика по шагам:

    1. ЦЕЛЬ ВЗЯТА. Цены подняты на заданный процент — робот останавливается.

    2. ПАУЗА НЕ ВЫШЛА. После шага нужно накопить продажи, иначе сравнивать
       не с чем. Ждём столько дней, сколько задал владелец.

    3. СПРОС УПАЛ. Сравниваем продажи за период ПОСЛЕ шага с равным периодом
       ДО него. Просели сильнее порога — откатываем цену назад тем же шагом.
       Это главная защита: подъём не должен убить продажи.

    4. СПРОС ДЕРЖИТСЯ — идём дальше вверх.

    Откат не «стирает» цель: подняли на 3%, откатили до 2.5% — до цели снова
    не хватает, и робот попробует ещё раз, когда спрос восстановится.
    """
    drift = _total_drift(cur, mp, st['dryRun'])
    last = _last_run(cur, mp, st['dryRun'])
    # Метки шагов в базе — по UTC, поэтому и «сейчас» берём по UTC.
    # Иначе разница часовых поясов дала бы роботу лишние три часа.
    now = _utc_now()
    target = st['targetTotalPercent']

    # 1. Цель взята.
    if drift >= target - 0.001:
        return {'decision': 'stop', 'drift': drift,
                'reason': f'Цель достигнута: цены подняты на {drift}% '
                          f'при цели {target}%. Робот остановлен'}

    step_days = max(1, st['stepDays'])
    extra = {}

    if last:
        waited = (now - last['ranAt']).total_seconds() / 86400
        if waited < step_days:
            left = round(step_days - waited, 1)
            return {'decision': 'skip', 'drift': drift,
                    'reason': f'Рано: после прошлого шага прошло '
                              f'{waited:.1f} дн. из {step_days}. '
                              f'Ждём ещё {left} дн.'}

        # 3. СПРОС: одинаковые отрезки до и после шага.
        #
        # Окно шире шага и не короче трёх дней. При шаге в 2 дня сравнение
        # «двое суток против двух» слишком шумное: 12 августа продали 82
        # штуки, 13-го — 141. Такой провал давал минус 30% и откат цены,
        # хотя со спросом ничего не случилось.
        #
        # Окно ждём целиком: пока после шага не набралось нужных дней,
        # сравнивать не с чем — цену не трогаем.
        win = st['demandWindowDays']
        if waited < win:
            left = round(win - waited, 1)
            return {'decision': 'skip', 'drift': drift,
                    'reason': f'Копим данные о спросе: прошло '
                              f'{waited:.1f} дн. из {win}. '
                              f'Ждём ещё {left} дн.'}

        # ЭТАЛОН — окно ДО шага: как продавалось на прежней цене. Он
        # неподвижен, с ним и сравниваем.
        #
        # СВЕЖИЙ ЗАМЕР — последние win дней от сегодня. Он скользит: каждую
        # ночь это новые данные. Если бы окно после шага было фиксированным,
        # завтрашняя проверка вернула бы ровно тот же результат, и ждать
        # подтверждения было бы бессмысленно — второй сигнал повторял бы
        # первый слово в слово.
        shift_day = last['ranAt']
        before_from = (shift_day - timedelta(days=win)).strftime('%Y-%m-%d')
        before_to = shift_day.strftime('%Y-%m-%d')
        after_from = (now - timedelta(days=win)).strftime('%Y-%m-%d')
        after_to = now.strftime('%Y-%m-%d')
        units_after = _units_in_period(cur, after_from, after_to)
        units_before = _units_in_period(cur, before_from, before_to)

        change = None
        if units_before > 0:
            change = round((units_after - units_before) / units_before * 100, 1)

        extra = {'unitsAfter': units_after, 'unitsBefore': units_before,
                 'unitsChange': change}

        # Откат: спрос просел сильнее порога после подъёма.
        # Откатываем и после ручного подъёма: если владелец сам поднял цены,
        # а спрос от этого умер, робот должен вернуть их так же, как после
        # своего шага. Опускать после ручного СНИЖЕНИЯ бессмысленно — падение
        # спроса тогда вызвано не ценой.
        raised = last['decision'] == 'raise' or (
            last['decision'] == 'manual' and last['stepPercent'] > 0)
        if change is not None and change <= -st['dropPercent'] and raised:
            # ПОДТВЕРЖДЕНИЕ ПАДЕНИЯ.
            #
            # Одного сигнала мало: спрос гуляет сам по себе, и цена не должна
            # прыгать туда-сюда из-за пары слабых дней. Первое падение — это
            # пауза без подъёма: ждём следующего замера и смотрим, повторится
            # ли. Повторилось — откатываем.
            #
            # Резкое падение — вдвое глубже порога — откатываем сразу: тут
            # уже не шум, и ждать подтверждения значит терять продажи.
            sharp = change <= -st['dropPercent'] * 2
            # Второй сигнал засчитываем не раньше следующих суток: замер
            # скользящий, и за пару часов данные почти не меняются.
            confirmed = _weak_before(cur, mp, st['dryRun'], hours=20)
            if st['requireSecondSignal'] and not sharp and not confirmed:
                return {'decision': 'hold', 'drift': drift, **extra,
                        'reason': f'Спрос упал на {abs(change)}% '
                                  f'({units_before} → {units_after} шт). '
                                  f'Ждём подтверждения: цену не поднимаем, '
                                  f'но и не откатываем — один слабый замер '
                                  f'ещё не падение спроса'}
            return {
                'decision': 'rollback', 'drift': drift,
                'step': -st['stepPercent'], **extra,
                'reason': (f'Спрос упал на {abs(change)}% '
                           f'({units_before} → {units_after} шт)'
                           + (' — падение резкое' if sharp
                              else ' второй раз подряд')
                           + f'. Возвращаем цены на {st["stepPercent"]}% назад'),
            }

        # Откат был, а спрос так и не вернулся — не давим дальше.
        if (last['decision'] in ('rollback', 'manual') and change is not None
                and change <= -st['dropPercent'] and not raised):
            return {'decision': 'hold', 'drift': drift, **extra,
                    'reason': f'Спрос всё ещё падает ({change}%) — '
                              f'после отката ждём восстановления, '
                              f'цену не трогаем'}

    # 4. Предохранитель: как далеко цены уже уехали от старта.
    if drift + st['stepPercent'] > st['maxTotalPercent']:
        return {'decision': 'hold', 'drift': drift, **extra,
                'reason': f'Достигнут предел: цены подняты на {drift}% '
                          f'при пределе {st["maxTotalPercent"]}%. '
                          f'Поднимите предел вручную, если это осознанно'}

    # Последний шаг подгоняем, чтобы не перескочить цель.
    step = min(st['stepPercent'], round(target - drift, 2))

    reason = (f'Спрос держится — поднимаем цены на {step}%. '
              f'Сейчас {drift}% от старта, цель {target}%')
    if extra.get('unitsChange') is not None:
        reason = (f'Спрос {extra["unitsChange"]:+}% '
                  f'({extra["unitsBefore"]} → {extra["unitsAfter"]} шт) — '
                  f'поднимаем цены на {step}%. '
                  f'Сейчас {drift}% от старта, цель {target}%')
    return {'decision': 'raise', 'drift': drift, 'step': step, **extra,
            'reason': reason}


# Сколько карточек отправляем за один вызов.
#
# Функции отведено 5 секунд, и в них должен уложиться поход на площадку.
# Пачка в 200 карточек не укладывалась: Ozon отвечал 5-9 секунд, вызов
# обрывался, и магазин оставался в разнобое. Пачка в 60 проходит с запасом.
BATCH_SIZE = 60


def _start_step(cur, mp, step, decision, reason, actor_id):
    """Начинает шаг: запоминает список товаров и отправляет первую пачку."""
    items = _all_items(cur, mp)
    if not items:
        return 0, 0, 0, 'Нет товаров с ценой — двигать нечего'
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


def _manual_move(cur, mp, step, actor_id, note=''):
    """РУЧНОЙ СДВИГ ЦЕН — по кнопке владельца, вне расписания робота.

    Бывает, что двинуть цены нужно прямо сейчас и по своей воле: площадка
    режет выдачу, конкурент уронил цену, началась распродажа. Ждать ночного
    запуска робота в такой момент неправильно.

    Сдвиг попадает в тот же журнал и в тот же счётчик пути к цели: если руками
    опустили на 2%, роботу до цели снова дальше, и он это учтёт. Иначе две
    силы двигали бы цены, не зная друг о друге.
    """
    st = _settings(cur, mp)
    if not st:
        return {'error': 'Робот не настроен'}
    if not step:
        return {'error': 'Укажите, на сколько процентов двигать'}
    # Тот же потолок, что и у робота: разовый рывок по всему магазину опаснее
    # всего, а опечатка в поле «-50» стоила бы витрины.
    if abs(step) > MAX_STEP_PERCENT:
        return {'error': f'За один раз не больше {MAX_STEP_PERCENT}% — '
                         f'слишком резко для всего ассортимента'}

    drift = _total_drift(cur, mp, st['dryRun'])
    direction = 'подняли' if step > 0 else 'опустили'
    reason = (f'Ручной сдвиг: {direction} цены на {abs(step)}%'
              + (f'. {note}' if note else ''))

    # Незаконченный шаг сначала дожимаем, а не отказываем: владелец нажал
    # кнопку и ждёт результата, а не сообщения «подождите».
    if _pending_left(cur, mp):
        pushed, failed, left, err = _continue_step(cur, mp, actor_id)
        if err:
            return {'error': err}
        if left:
            return {'ok': True, 'inProgress': True, 'pushed': pushed,
                    'left': left,
                    'reason': f'Досылаем прошлый шаг: отправлено {pushed}, '
                              f'осталось {left}. Нажмите ещё раз'}
        done = _finish_step(cur, mp)
        if done:
            drift = _total_drift(cur, mp, st['dryRun']) + done['step']
            reason = f'{done["reason"]}. Карточек изменено: {done["pushed"]}'
            run_id = _log_run(cur, mp, done['decision'], reason,
                              step=done['step'], drift=round(drift, 2),
                              pushed=done['pushed'], failed=done['failed'],
                              dryRun=st['dryRun'])
            return {'ok': True, 'runId': run_id, 'step': done['step'],
                    'pushed': done['pushed'], 'reason': reason,
                    'drift': round(drift, 2)}

    pushed = failed = 0
    if st['dryRun']:
        reason += '. Наблюдение: цены на витрине не менялись'
    else:
        # Отправка идёт пачками: весь магазин за один вызов не успевает.
        pushed, failed, left, err = _start_step(
            cur, mp, step, 'manual', reason, actor_id)
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
                      drift=round(drift + step, 2),
                      pushed=pushed, failed=failed, dryRun=st['dryRun'])

    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, "
        "  entity_type, entity_id, description, details, created_at) "
        "VALUES (%s, 'Робот цен', 'prices', 'price_robot_manual', "
        "  'price_robot', %s, %s, %s, now())",
        (actor_id, run_id, reason[:500], json.dumps(
            {'step': step, 'pushed': pushed, 'dryRun': st['dryRun']},
            ensure_ascii=False)))

    notify = _notify_admins(cur, 'manual',
                            {'reason': reason, 'drift': round(drift + step, 2)},
                            pushed, st['dryRun'])
    return {'ok': True, 'runId': run_id, 'step': step, 'pushed': pushed,
            'failed': failed, 'dryRun': st['dryRun'], 'reason': reason,
            'drift': round(drift + step, 2), 'notify': notify}


def _run(cur, mp, actor_id, force=False):
    """Один цикл робота: решить и, если нужно, сдвинуть цены."""
    st = _settings(cur, mp)
    if not st:
        return {'error': 'Робот не настроен'}
    if not st['isActive'] and not force:
        return {'ok': True, 'decision': 'off', 'reason': 'Робот выключен'}

    # СНАЧАЛА ДОСЫЛАЕМ НЕЗАКОНЧЕННЫЙ ШАГ.
    #
    # Магазин не должен оставаться в разнобое: часть цен поднята, часть нет.
    # Пока остаток не ушёл, новых решений не принимаем.
    if _pending_left(cur, mp):
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
        if done:
            reason = f'{done["reason"]}. Карточек изменено: {done["pushed"]}'
            drift = _total_drift(cur, mp, st['dryRun']) + done['step']
            run_id = _log_run(cur, mp, done['decision'], reason,
                              step=done['step'], drift=round(drift, 2),
                              pushed=done['pushed'], failed=done['failed'],
                              dryRun=st['dryRun'])
            notify = _notify_admins(cur, done['decision'],
                                    {'reason': reason, 'drift': round(drift, 2)},
                                    done['pushed'], st['dryRun'])
            return {'ok': True, 'runId': run_id, 'decision': done['decision'],
                    'reason': reason, 'pushed': done['pushed'],
                    'failed': done['failed'], 'drift': round(drift, 2),
                    'notify': notify}

    d = _decide(cur, st, mp)
    pushed = failed = 0

    if d['decision'] in ('raise', 'rollback'):
        if st['dryRun']:
            # РЕЖИМ НАБЛЮДЕНИЯ: считаем и пишем в журнал, витрину не трогаем.
            items = _all_items(cur, mp)
            d = {**d, 'reason': d['reason'] + f'. Наблюдение: цены не менялись '
                                              f'(товаров было бы {len(items)})'}
        else:
            pushed, failed, left, err = _start_step(
                cur, mp, d['step'], d['decision'], d['reason'], actor_id)
            if err:
                d = {**d, 'decision': 'hold', 'reason': err}
            elif left:
                # Не успели за один вызов — остаток уйдёт следующим запуском.
                return {'ok': True, 'decision': 'sending', 'pushed': pushed,
                        'left': left,
                        'reason': f'{d["reason"]}. Отправлено {pushed}, '
                                  f'осталось {left} — продолжаем'}
            else:
                _finish_step(cur, mp)
                d = {**d, 'reason': d['reason'] +
                     f'. Карточек изменено: {pushed}'}

    run_id = _log_run(cur, mp, d['decision'], d['reason'],
                      step=d.get('step'), drift=d.get('drift'),
                      unitsAfter=d.get('unitsAfter'),
                      unitsBefore=d.get('unitsBefore'),
                      unitsChange=d.get('unitsChange'),
                      pushed=pushed, failed=failed, dryRun=st['dryRun'])

    # Цель достигнута — выключаем робота, чтобы он не гонял вхолостую.
    if d['decision'] == 'stop':
        cur.execute(
            "UPDATE price_robot_settings SET is_active = false "
            "WHERE marketplace_code = %s", (mp,))

    # Отметка в общем журнале: по ней экран «Планировщик» понимает, что задание
    # живо. Без неё робот выглядел бы там молчащим, даже когда исправно
    # отрабатывает каждую ночь.
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, "
        "  entity_type, entity_id, description, details, created_at) "
        "VALUES (%s, 'Робот цен', 'prices', 'price_robot', 'price_robot', "
        "  %s, %s, %s, now())",
        (actor_id, run_id, d['reason'][:500], json.dumps(
            {'decision': d['decision'], 'reason': d['reason'],
             'pushed': pushed, 'dryRun': st['dryRun']}, ensure_ascii=False)))

    # Сообщаем владельцу в MAX — робот работает ночью, и узнавать о сдвиге цен
    # он должен сразу, а не когда откроет систему через неделю.
    notify = _notify_admins(cur, d['decision'], d, pushed, st['dryRun'])

    return {'ok': True, 'runId': run_id, 'pushed': pushed, 'failed': failed,
            'dryRun': st['dryRun'], 'notify': notify, **d}


def handler(event: dict, context) -> dict:
    """Робот подъёма цен: ведёт маржу FBS к цели и сам себя останавливает.

    Зачем: поднимать цены по всему магазину руками невозможно — восемьсот
    карточек, и после каждого подъёма надо смотреть, не умерли ли продажи.
    Робот делает это мелкими шагами с паузой и откатывает цену назад, если
    спрос просел.

    GET  ?action=status&actorId=       — настройки, журнал, текущая маржа
    POST { action: 'save', ... }       — сохранить настройки
    POST { action: 'run', cronSecret } — цикл робота (планировщик)
    POST { action: 'run', actorId, force: true } — прогон вручную
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
            st = _settings(cur, mp)
            cur.execute(
                "SELECT ran_at, decision, reason, step_percent, drift_percent, "
                "  units_after, units_before, units_change, items_pushed, "
                "  dry_run FROM price_robot_runs "
                "WHERE marketplace_code = %s ORDER BY ran_at DESC LIMIT 30",
                (mp,))
            runs = [{
                'ranAt': r[0], 'decision': r[1], 'reason': r[2],
                'stepPercent': float(r[3]) if r[3] is not None else None,
                # В этой колонке теперь сдвиг цен от старта, а не маржа.
                'driftPercent': float(r[4]) if r[4] is not None else None,
                'unitsAfter': r[5], 'unitsBefore': r[6],
                'unitsChange': float(r[7]) if r[7] is not None else None,
                'itemsPushed': r[8], 'dryRun': r[9],
            } for r in cur.fetchall()]

            cur.execute(
                "SELECT count(*) FROM marketplace_prices "
                "WHERE marketplace_code = %s AND price > 0", (mp,))
            items_count = int((cur.fetchone() or [0])[0] or 0)

            return _resp(200, {
                'settings': st,
                # Сдвиг показываем для того режима, в котором робот сейчас.
                'driftPercent': _total_drift(cur, mp, st['dryRun'] if st else False),
                'itemsCount': items_count,
                # Сколько карточек ждёт отправки: шаг идёт пачками.
                'pendingLeft': _pending_left(cur, mp),
                'runs': runs,
            })

        if method != 'POST':
            return _resp(405, {'error': 'Метод не поддерживается'})

        body = json.loads(event.get('body') or '{}')
        action = body.get('action')
        mp = body.get('marketplace') or 'ozon'

        if action == 'save':
            if not _is_admin(cur, body.get('actorId')):
                return _resp(403, {'error': 'Только для администратора'})
            step = min(float(body.get('stepPercent') or 0.5), MAX_STEP_PERCENT)
            cur.execute(
                "UPDATE price_robot_settings SET is_active = %s, dry_run = %s, "
                "  step_percent = %s, step_days = %s, run_hour = %s, "
                "  target_total_percent = %s, drop_percent = %s, "
                "  max_total_percent = %s, demand_window_days = %s, "
                "  require_second_signal = %s, "
                "  updated_at = now(), updated_by = %s "
                "WHERE marketplace_code = %s",
                (bool(body.get('isActive')), bool(body.get('dryRun', True)),
                 step, max(1, int(body.get('stepDays') or 2)),
                 int(body.get('runHour') or 3),
                 float(body.get('targetTotalPercent') or 10),
                 float(body.get('dropPercent') or 30),
                 float(body.get('maxTotalPercent') or 20),
                 # Окно короче трёх дней не пускаем: слишком шумно.
                 max(3, int(body.get('demandWindowDays') or 3)),
                 bool(body.get('requireSecondSignal', True)),
                 body.get('actorId'), mp))
            return _resp(200, {'ok': True, 'settings': _settings(cur, mp)})

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
            # Ручной сдвиг цен — вне расписания, по кнопке владельца.
            if not _is_admin(cur, body.get('actorId')):
                return _resp(403, {'error': 'Только для администратора'})
            res = _manual_move(cur, mp, float(body.get('step') or 0),
                               body.get('actorId'),
                               (body.get('note') or '').strip()[:200])
            return _resp(400 if res.get('error') else 200, res)

        if action == 'run':
            secret = body.get('cronSecret')
            actor_id = body.get('actorId')
            by_cron = secret and secret == os.environ.get('CRON_SECRET')
            if not by_cron and not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Только для администратора'})

            st = _settings(cur, mp)
            # Час запуска: планировщик может дёргать чаще, но работаем только
            # в назначенное владельцем время. Ночью витрина спокойнее.
            #
            # Владелец задаёт час по Москве, а сервер живёт по UTC — без
            # поправки «3:00» означало бы 6 утра по Москве.
            # Незаконченный шаг досылаем в любой час: магазин не должен
            # висеть в разнобое до следующей ночи.
            if (by_cron and st and _msk_hour() != st['runHour']
                    and not _pending_left(cur, mp)):
                return _resp(200, {'ok': True, 'decision': 'skip',
                                   'reason': 'Не час запуска'})
            return _resp(200, _run(cur, mp, actor_id,
                                   force=bool(body.get('force'))))

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        cur.close()
        conn.close()
