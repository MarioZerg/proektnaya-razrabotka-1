import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import psycopg2

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

# Выкупы: оттуда берём маржу FBS — ту самую, что видит владелец на экране.
BUYOUTS_URL = (
    'https://functions.poehali.dev/406daf92-dd75-4e27-946d-e90aa720fe70')

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
        "       target_margin, drop_percent, max_total_percent, updated_at "
        "FROM price_robot_settings WHERE marketplace_code = %s", (mp,))
    r = cur.fetchone()
    if not r:
        return None
    return {
        'isActive': bool(r[0]), 'dryRun': bool(r[1]),
        'stepPercent': float(r[2]), 'stepDays': int(r[3]),
        'runHour': int(r[4]), 'targetMargin': float(r[5]),
        'dropPercent': float(r[6]), 'maxTotalPercent': float(r[7]),
        'updatedAt': r[8],
    }


def _margin_fbs():
    """Маржа по схеме FBS за последние 30 дней — цель, к которой идём.

    Берём её из «Выкупов», а не считаем заново. Там уже учтено всё: фактическое
    удержание площадки из отчёта о реализации, себестоимость, реклама по факту
    из кабинета, налоги, услуги и обработка возвратов. Повторить эту арифметику
    здесь — значит однажды с ней разойтись, и робот целился бы в одну цифру,
    а владелец видел на экране другую.

    Окно скользящее, от сегодня назад. Календарный месяц в первых числах
    опирается на два-три дня продаж: цифра скакала бы так, что робот успевал бы
    и разогнаться, и остановиться на пустом месте.
    """
    d_from = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
    d_to = datetime.now().strftime('%Y-%m-%d')
    url = (f'{BUYOUTS_URL}?action=bought_feed&page=1&perPage=1'
           f'&dateFrom={d_from}&dateTo={d_to}&scheme=FBS')
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=25) as r:
            data = json.loads(r.read().decode())
    except Exception:
        return None
    totals = (data or {}).get('totals') or {}
    if not totals.get('revenue'):
        return None
    return float(totals.get('margin') or 0)


def _units_in_period(cur, d_from, d_to):
    """Сколько вещей FBS продано за отрезок — по нему судим о спросе."""
    cur.execute(
        "SELECT coalesce(sum(s.quantity), 0) FROM marketplace_sales s "
        "WHERE NOT s.is_return AND s.scheme = 'FBS' "
        f"  AND s.sold_at >= '{d_from}'::date "
        f"  AND s.sold_at < '{d_to}'::date")
    return int((cur.fetchone() or [0])[0] or 0)


def _last_run(cur, mp='ozon'):
    """Последний РЕЗУЛЬТАТИВНЫЙ шаг: подъём или откат.

    Прогоны с решением «рано» и «цель достигнута» цену не двигали, и отсчитывать
    паузу от них нельзя — иначе робот, запускаемый ежедневно, никогда бы не
    дождался своих двух дней.
    """
    cur.execute(
        "SELECT ran_at, decision, step_percent, units_after "
        "FROM price_robot_runs "
        "WHERE marketplace_code = %s AND decision IN ('raise', 'rollback') "
        "ORDER BY ran_at DESC LIMIT 1", (mp,))
    r = cur.fetchone()
    if not r:
        return None
    return {'ranAt': r[0], 'decision': r[1],
            'stepPercent': float(r[2] or 0), 'unitsAfter': int(r[3] or 0)}


def _total_drift(cur, mp='ozon'):
    """Насколько цены уже уехали от точки старта, %.

    Мелкие шаги копятся: двадцать подъёмов по 0.5% — это уже +10%. Без этого
    счётчика робот способен незаметно увести витрину далеко от разумного.
    """
    cur.execute(
        "SELECT coalesce(sum(step_percent), 0) FROM price_robot_runs "
        "WHERE marketplace_code = %s AND decision IN ('raise', 'rollback') "
        "  AND NOT dry_run", (mp,))
    return float((cur.fetchone() or [0])[0] or 0)


def _log_run(cur, mp, decision, reason, **kw):
    cur.execute(
        "INSERT INTO price_robot_runs (marketplace_code, decision, reason, "
        "  step_percent, margin_fbs, units_after, units_before, units_change, "
        "  items_pushed, items_failed, dry_run) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (mp, decision, reason, kw.get('step'), kw.get('margin'),
         kw.get('unitsAfter'), kw.get('unitsBefore'), kw.get('unitsChange'),
         kw.get('pushed', 0), kw.get('failed', 0), kw.get('dryRun', True)))
    return (cur.fetchone() or [None])[0]


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

    Логика по шагам:

    1. ЦЕЛЬ ДОСТИГНУТА. Маржа FBS за 30 дней дошла до целевой — робот
       останавливается сам. Ради этого он и работает.

    2. ПАУЗА НЕ ВЫШЛА. После шага нужно накопить продажи, иначе сравнивать
       не с чем. Ждём столько дней, сколько задал владелец.

    3. ПРОВЕРКА СПРОСА. Сравниваем продажи за period ПОСЛЕ шага с равным
       периодом ДО него. Упали сильнее порога — откатываем цену назад тем же
       шагом. Это главная защита: подъём цены не должен убить продажи.

    4. ПОТОЛОК. Если цены уже уехали от старта дальше предела — стоп.

    5. ИНАЧЕ — очередной шаг вверх.
    """
    margin = _margin_fbs()
    last = _last_run(cur, mp)
    now = datetime.now()

    if margin is None:
        return {'decision': 'hold',
                'reason': 'Нет данных о продажах FBS за 30 дней — считать не от чего',
                'margin': None}

    # 1. Цель достигнута — дальше не идём.
    if margin >= st['targetMargin']:
        return {'decision': 'stop', 'margin': margin,
                'reason': f'Цель достигнута: маржа FBS {margin}% — '
                          f'это не ниже целевых {st["targetMargin"]}%. '
                          f'Робот остановлен'}

    step_days = max(1, st['stepDays'])

    # 2. Пауза между шагами.
    if last:
        waited = (now - last['ranAt']).total_seconds() / 86400
        if waited < step_days:
            left = round(step_days - waited, 1)
            return {'decision': 'skip', 'margin': margin,
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

        # Откат: продажи просели сильнее порога, и последним шагом был подъём.
        if (change is not None and change <= -st['dropPercent']
                and last['decision'] == 'raise'):
            return {
                'decision': 'rollback', 'margin': margin,
                'step': -st['stepPercent'],
                'unitsAfter': units_after, 'unitsBefore': units_before,
                'unitsChange': change,
                'reason': f'Продажи упали на {abs(change)}% '
                          f'({units_before} → {units_after} шт) — '
                          f'подъём цены не окупился. Возвращаем цены на '
                          f'{st["stepPercent"]}% назад',
            }

        extra = {'unitsAfter': units_after, 'unitsBefore': units_before,
                 'unitsChange': change}
    else:
        extra = {}

    # 4. Предохранитель: как далеко цены уже уехали от старта.
    drift = _total_drift(cur, mp)
    if drift + st['stepPercent'] > st['maxTotalPercent']:
        return {'decision': 'hold', 'margin': margin, **extra,
                'reason': f'Достигнут предел: цены уже подняты на {drift}% '
                          f'от старта при пределе {st["maxTotalPercent"]}%. '
                          f'Поднимите предел вручную, если это осознанно'}

    # 5. Очередной шаг вверх.
    reason = (f'Маржа FBS {margin}% ниже цели {st["targetMargin"]}% — '
              f'поднимаем цены на {st["stepPercent"]}%')
    if extra.get('unitsChange') is not None:
        reason += (f'. Продажи после прошлого шага: '
                   f'{extra["unitsBefore"]} → {extra["unitsAfter"]} шт '
                   f'({extra["unitsChange"]:+}%)')
    return {'decision': 'raise', 'margin': margin,
            'step': st['stepPercent'], **extra, 'reason': reason}


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
                      step=d.get('step'), margin=d.get('margin'),
                      unitsAfter=d.get('unitsAfter'),
                      unitsBefore=d.get('unitsBefore'),
                      unitsChange=d.get('unitsChange'),
                      pushed=pushed, failed=failed, dryRun=st['dryRun'])

    # Цель достигнута — выключаем робота, чтобы он не гонял вхолостую.
    if d['decision'] == 'stop':
        cur.execute(
            "UPDATE price_robot_settings SET is_active = false "
            "WHERE marketplace_code = %s", (mp,))

    return {'ok': True, 'runId': run_id, 'pushed': pushed, 'failed': failed,
            'dryRun': st['dryRun'], **d}


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
                "SELECT ran_at, decision, reason, step_percent, margin_fbs, "
                "  units_after, units_before, units_change, items_pushed, "
                "  dry_run FROM price_robot_runs "
                "WHERE marketplace_code = %s ORDER BY ran_at DESC LIMIT 30",
                (mp,))
            runs = [{
                'ranAt': r[0], 'decision': r[1], 'reason': r[2],
                'stepPercent': float(r[3]) if r[3] is not None else None,
                'marginFbs': float(r[4]) if r[4] is not None else None,
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
                'marginFbs': _margin_fbs(),
                'driftPercent': round(_total_drift(cur, mp), 2),
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
                "  target_margin = %s, drop_percent = %s, "
                "  max_total_percent = %s, updated_at = now(), updated_by = %s "
                "WHERE marketplace_code = %s",
                (bool(body.get('isActive')), bool(body.get('dryRun', True)),
                 step, max(1, int(body.get('stepDays') or 2)),
                 int(body.get('runHour') or 3),
                 float(body.get('targetMargin') or 10),
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
