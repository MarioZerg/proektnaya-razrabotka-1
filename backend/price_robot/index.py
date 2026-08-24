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
        "       updated_at "
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
        "WHERE marketplace_code = %s AND decision IN ('raise', 'rollback') "
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
        "WHERE marketplace_code = %s AND decision IN ('raise', 'rollback') "
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
NOTIFY_ON = ('raise', 'rollback', 'stop')

DECISION_TITLE = {
    'raise': 'Робот поднял цены',
    'rollback': 'Робот откатил цены назад',
    'stop': 'Робот остановился — цель достигнута',
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
               'actorId': actor_id}
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
    now = _msk_now()
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

        # 3. Спрос: продажи после шага против равного периода до него.
        after_from = last['ranAt'].strftime('%Y-%m-%d')
        after_to = now.strftime('%Y-%m-%d')
        before_from = (last['ranAt'] - timedelta(days=step_days)).strftime('%Y-%m-%d')
        units_after = _units_in_period(cur, after_from, after_to)
        units_before = _units_in_period(cur, before_from, after_from)

        change = None
        if units_before > 0:
            change = round((units_after - units_before) / units_before * 100, 1)

        extra = {'unitsAfter': units_after, 'unitsBefore': units_before,
                 'unitsChange': change}

        # Откат: спрос просел сильнее порога после подъёма.
        if (change is not None and change <= -st['dropPercent']
                and last['decision'] == 'raise'):
            return {
                'decision': 'rollback', 'drift': drift,
                'step': -st['stepPercent'], **extra,
                'reason': f'Спрос упал на {abs(change)}% '
                          f'({units_before} → {units_after} шт) — '
                          f'подъём цены не окупился. Возвращаем цены на '
                          f'{st["stepPercent"]}% назад',
            }

        # Откат был, а спрос так и не вернулся — не давим дальше.
        if (last['decision'] == 'rollback' and change is not None
                and change <= -st['dropPercent']):
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


def _run(cur, mp, actor_id, force=False):
    """Один цикл робота: решить и, если нужно, сдвинуть цены."""
    st = _settings(cur, mp)
    if not st:
        return {'error': 'Робот не настроен'}
    if not st['isActive'] and not force:
        return {'ok': True, 'decision': 'off', 'reason': 'Робот выключен'}

    d = _decide(cur, st, mp)
    pushed = failed = 0

    if d['decision'] in ('raise', 'rollback'):
        items = _all_items(cur, mp)
        if not items:
            d = {**d, 'decision': 'hold',
                 'reason': 'Нет товаров с ценой — двигать нечего'}
        elif st['dryRun']:
            # РЕЖИМ НАБЛЮДЕНИЯ: считаем и пишем в журнал, витрину не трогаем.
            d = {**d, 'reason': d['reason'] + f'. Наблюдение: цены не менялись '
                                              f'(товаров было бы {len(items)})'}
        else:
            k = 1 + d['step'] / 100
            payload = [{'itemId': i['itemId'],
                        'newPrice': round(i['price'] * k, 2)} for i in items]
            res = _push(mp, payload, actor_id)
            pushed = int(res.get('pushed') or 0)
            failed = len(res.get('failed') or []) + len(res.get('skipped') or [])
            if res.get('error'):
                d = {**d, 'decision': 'hold',
                     'reason': f'Площадка не приняла цены: {res["error"]}'}

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
                "  max_total_percent = %s, updated_at = now(), updated_by = %s "
                "WHERE marketplace_code = %s",
                (bool(body.get('isActive')), bool(body.get('dryRun', True)),
                 step, max(1, int(body.get('stepDays') or 2)),
                 int(body.get('runHour') or 3),
                 float(body.get('targetTotalPercent') or 10),
                 float(body.get('dropPercent') or 30),
                 float(body.get('maxTotalPercent') or 20),
                 body.get('actorId'), mp))
            return _resp(200, {'ok': True, 'settings': _settings(cur, mp)})

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
            if by_cron and st and _msk_hour() != st['runHour']:
                return _resp(200, {'ok': True, 'decision': 'skip',
                                   'reason': 'Не час запуска'})
            return _resp(200, _run(cur, mp, actor_id,
                                   force=bool(body.get('force'))))

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        cur.close()
        conn.close()
