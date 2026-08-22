import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2

OZON_API = 'https://api-seller.ozon.ru'
WB_ADVERT_API = 'https://advert-api.wildberries.ru'
WB_STATS_API = 'https://statistics-api.wildberries.ru'
WB_CONTENT_API = 'https://content-api.wildberries.ru'

# За сколько дней считаем долю рекламы. 30 дней сглаживают случайные всплески
# (день распродажи, разовый тест кампании), но остаются свежими: решения по
# рекламе, принятые месяц назад, уже видны в цифре.
PERIOD_DAYS = 30

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Content-Type': 'application/json',
}


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def _http(url, method='GET', headers=None, payload=None, timeout=20):
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = r.read().decode('utf-8')
            return r.status, (json.loads(d) if d else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')[:300]
    except Exception as e:
        return 0, str(e)


def _credentials(cur, code):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = %s",
        (code,),
    )
    row = cur.fetchone()
    if not row:
        return {}, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds, bool(row[0])


def _is_admin(cur, actor_id):
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] in ('admin', 'manager'))


def _save_item_spend(cur, code, item_id, spend, revenue):
    """Расход и выручка одного товара за период."""
    pct = round(spend / revenue * 100, 2) if revenue > 0 else None
    cur.execute(
        "INSERT INTO marketplace_ad_spend (marketplace_code, marketplace_item_id, "
        "  period_days, ad_spend, revenue, ad_percent, calculated_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, now()) "
        "ON CONFLICT (marketplace_code, marketplace_item_id) "
        "  WHERE marketplace_item_id IS NOT NULL "
        "DO UPDATE SET ad_spend = EXCLUDED.ad_spend, revenue = EXCLUDED.revenue, "
        "  ad_percent = EXCLUDED.ad_percent, period_days = EXCLUDED.period_days, "
        "  calculated_at = now()",
        (code, item_id, PERIOD_DAYS, round(spend, 2), round(revenue, 2), pct),
    )


def _save_total(cur, code, spend, revenue):
    """Расход на всю площадку — когда разбивки по товарам нет."""
    pct = round(spend / revenue * 100, 2) if revenue > 0 else None
    cur.execute(
        "INSERT INTO marketplace_ad_spend (marketplace_code, marketplace_item_id, "
        "  period_days, ad_spend, revenue, ad_percent, calculated_at) "
        "VALUES (%s, NULL, %s, %s, %s, %s, now()) "
        "ON CONFLICT (marketplace_code) WHERE marketplace_item_id IS NULL "
        "DO UPDATE SET ad_spend = EXCLUDED.ad_spend, revenue = EXCLUDED.revenue, "
        "  ad_percent = EXCLUDED.ad_percent, period_days = EXCLUDED.period_days, "
        "  calculated_at = now()",
        (code, PERIOD_DAYS, round(spend, 2), round(revenue, 2), pct),
    )
    cur.execute(
        "UPDATE marketplace_tariffs SET promo_fact_percent = %s, "
        "  promo_synced_at = now() WHERE marketplace_code = %s",
        (pct, code),
    )
    return pct


def _sync_ozon(cur, creds, date_from=None, date_to=None, dry_run=False):
    """Реклама OZON: сколько списали за клики и какая была выручка.

    OZON списывает «Оплату за клик» ОБЩИМИ суммами — в операции нет ни товара,
    ни артикула. Разнести по позициям физически не из чего, поэтому считаем
    один процент на всю площадку и применяем ко всем товарам одинаково.
    """
    headers = {'Client-Id': (creds.get('clientId') or '').strip(),
               'Api-Key': (creds.get('apiKey') or '').strip()}
    # По умолчанию — скользящие 30 дней. Даты можно задать явно: тогда цифру
    # можно сверить с кабинетом OZON за тот же месяц, что смотрит человек.
    today = datetime.now(timezone.utc).date()
    since = today - timedelta(days=PERIOD_DAYS)
    if date_from and date_to:
        since = datetime.strptime(date_from, '%Y-%m-%d').date()
        today = datetime.strptime(date_to, '%Y-%m-%d').date()

    spend = 0.0
    revenue = 0.0
    # Расход и оборот ПО МЕСЯЦАМ: {'2026-06-01': [расход, оборот]}.
    #
    # Общая цифра за 30 дней отвечает на вопрос «сколько сейчас», а помесячная —
    # на вопрос «куда движемся». Второй важнее: по одному числу нельзя понять,
    # реклама подорожала или спрос упал.
    by_month = {}
    # Транзакции приходят страницами по 1000 — за месяц их бывает несколько.
    for page in range(1, 6):
        st, d = _http(
            f'{OZON_API}/v3/finance/transaction/list', 'POST', headers,
            {'filter': {'date': {'from': f'{since}T00:00:00.000Z',
                                 'to': f'{today}T23:59:59.000Z'},
                        'operation_type': [], 'transaction_type': 'all'},
             'page': page, 'page_size': 1000},
            timeout=25,
        )
        if st != 200 or not isinstance(d, dict):
            break
        ops = ((d.get('result') or {}).get('operations')) or []
        if not ops:
            break
        for o in ops:
            name = (o.get('operation_type_name') or '')
            amount = float(o.get('amount') or 0)
            low = name.lower()
            # Месяц операции: по нему копим историю.
            op_date = (o.get('operation_date') or '')[:10]
            mkey = (op_date[:7] + '-01') if len(op_date) >= 7 else None
            if mkey and mkey not in by_month:
                by_month[mkey] = [0.0, 0.0]

            # Всё, что относится к продвижению: клики, бустинг, баннеры.
            if 'клик' in low or 'продвижен' in low or 'реклам' in low:
                spend += abs(amount)
                if mkey:
                    by_month[mkey][0] += abs(amount)
            elif 'Доставка покупателю' in name:
                # Выручка — это accruals_for_sale, СТОИМОСТЬ ТОВАРА по чеку.
                #
                # Раньше сюда брали amount, и процент выходил завышенным почти
                # вдвое: amount — это не выручка, а то, что ОСТАЁТСЯ продавцу
                # после удержания комиссии площадки. На примере из данных OZON:
                # товар продан за 3705 ₽ (accruals_for_sale), комиссия 1778 ₽,
                # amount = 1699 ₽. Деля рекламу на 1699 вместо 3705, мы получали
                # 18,9% вместо реальных, и цифра расходилась с кабинетом OZON.
                #
                # ДРР во всех кабинетах считают от ОБОРОТА, а не от того, что
                # осталось после вычетов, — иначе показатели несопоставимы.
                sale = float(o.get('accruals_for_sale') or 0)
                revenue += sale
                if mkey:
                    by_month[mkey][1] += sale
            # Возвраты из оборота НЕ вычитаем — намеренно.
            #
            # ДРР в кабинете OZON считается от ВАЛОВОГО оборота: сколько товара
            # продано, столько и в знаменателе. Если вычитать возвраты, наш
            # процент перестанет совпадать с кабинетом, и сверять цифры станет
            # невозможно. Потери от возвратов видны в юнит-экономике отдельно —
            # через выкуп, там им и место.
        if len(ops) < 1000:
            break

    if revenue <= 0:
        return {'ok': False, 'error': 'Нет данных о выручке за период'}

    # Сверочный запуск за прошлый период в базу не пишем: там должен лежать
    # актуальный процент за последние 30 дней, а не срез старого месяца.
    if dry_run:
        pct = round(spend / revenue * 100, 2) if revenue > 0 else None
        return {'ok': True, 'spend': round(spend, 2), 'revenue': round(revenue, 2),
                'percent': pct, 'byItem': 0, 'from': str(since), 'to': str(today)}

    # Складываем историю по месяцам.
    #
    # Пишем ТОЛЬКО те месяцы, которые попали в запрошенный период ЦЕЛИКОМ.
    # Обычный запуск берёт скользящие 30 дней (например, 23 июля — 22 августа):
    # операций июля там всего девять дней. Записав их как «весь июль», мы
    # затрём полные данные месяца огрызком — именно так и случилось при первой
    # проверке: 11,54% превратились в 9,38%.
    #
    # Текущий месяц — исключение: он ещё идёт, и его цифра законно неполная.
    # Она обновляется при каждом запуске и застынет сама, когда месяц закончится.
    this_month = datetime.now(timezone.utc).date().replace(day=1)
    for mkey, (m_spend, m_rev) in by_month.items():
        if m_rev <= 0 and m_spend <= 0:
            continue
        m_start = datetime.strptime(mkey, '%Y-%m-%d').date()
        # Последний день месяца: прибавляем 4 дня к 28-му и откатываемся к 1-му.
        m_end = (m_start.replace(day=28) + timedelta(days=4)).replace(day=1) \
            - timedelta(days=1)
        covered = since <= m_start and today >= m_end
        if not covered and m_start != this_month:
            continue
        m_pct = round(m_spend / m_rev * 100, 2) if m_rev > 0 else None
        cur.execute(
            "INSERT INTO marketplace_ad_monthly (marketplace_code, month, "
            "  ad_spend, revenue, ad_percent, calculated_at) "
            "VALUES ('ozon', %s, %s, %s, %s, now()) "
            "ON CONFLICT (marketplace_code, month) DO UPDATE SET "
            "  ad_spend = EXCLUDED.ad_spend, revenue = EXCLUDED.revenue, "
            "  ad_percent = EXCLUDED.ad_percent, calculated_at = now()",
            (mkey, round(m_spend, 2), round(m_rev, 2), m_pct),
        )

    pct = _save_total(cur, 'ozon', spend, revenue)
    return {'ok': True, 'spend': round(spend, 2), 'revenue': round(revenue, 2),
            'percent': pct, 'byItem': 0, 'months': len(by_month)}


def _wb_nm_map(cur):
    """Наши товары по номеру WB: {nmID: id товара}."""
    cur.execute(
        "SELECT wb_nm_id, id FROM marketplace_items WHERE wb_nm_id IS NOT NULL"
    )
    return {int(r[0]): r[1] for r in cur.fetchall()}


def _sync_wb_nm_ids(cur, api_key, start_cursor=None):
    """Забирает номера товаров WB (nmID) из карточек — ПО ОДНОЙ СТРАНИЦЕ.

    Реклама WB привязана к nmID, а у нас хранился только баркод — с рекламой он
    не сходится. Номер приходит в карточке рядом с артикулом, по артикулу и
    связываем со своим товаром.

    Страница за вызов: карточек почти тысяча, а у функции пять секунд. Экран
    вызывает загрузку по кругу и передаёт курсор, пока каталог не кончится.
    """
    headers = {'Authorization': api_key}
    cur.execute("SELECT sku, id FROM marketplace_items WHERE sku IS NOT NULL")
    by_sku = {str(r[0]).strip(): r[1] for r in cur.fetchall()}

    cursor = dict(start_cursor) if start_cursor else {}
    cursor['limit'] = 100
    st, data = _http(
        f'{WB_CONTENT_API}/content/v2/get/cards/list', 'POST', headers,
        {'settings': {'cursor': cursor, 'filter': {'withPhoto': -1}}},
        timeout=15,
    )
    if st != 200 or not isinstance(data, dict):
        return 0, None, True

    cards = data.get('cards') or []
    saved = 0
    for c in cards:
        code = (c.get('vendorCode') or '').strip()
        nm = c.get('nmID')
        item_id = by_sku.get(code)
        if item_id and nm:
            cur.execute(
                "UPDATE marketplace_items SET wb_nm_id = %s WHERE id = %s",
                (int(nm), item_id),
            )
            saved += 1

    nxt = data.get('cursor') or {}
    if len(cards) < 100 or not nxt.get('updatedAt'):
        return saved, None, True
    return saved, {'updatedAt': nxt.get('updatedAt'), 'nmID': nxt.get('nmID')}, False


def _wb_stage_spend(cur, headers, since, today, step):
    """Шаг 1: расход по кампаниям и по товарам внутри них.

    Кампаний за месяц набирается несколько десятков, и каждая — отдельный
    запрос к площадке. За пять секунд все не успевают, поэтому берём их
    порциями: шаг за шагом, накапливая результат в базе.
    """
    st, upd = _http(
        f'{WB_ADVERT_API}/adv/v1/upd?from={since}&to={today}', 'GET', headers,
        timeout=25,
    )
    if st != 200 or not isinstance(upd, list):
        return None, f'WB не отдал расходы (код {st})'

    advert_ids = []
    total_spend = 0.0
    for x in upd:
        total_spend += float(x.get('updSum') or 0)
        a = x.get('advertId')
        if a and a not in advert_ids:
            advert_ids.append(a)

    # Порция кампаний на этот заход.
    chunk = advert_ids[step * 20:(step + 1) * 20]
    spend_by_nm = {}
    if chunk:
        ids = ','.join(str(a) for a in chunk)
        st2, stats = _http(
            f'{WB_ADVERT_API}/adv/v3/fullstats?ids={ids}'
            f'&beginDate={since}&endDate={today}', 'GET', headers, timeout=25,
        )
        if st2 == 200 and isinstance(stats, list):
            for camp in stats:
                for day in (camp.get('days') or []):
                    for app in (day.get('apps') or []):
                        for n in (app.get('nms') or []):
                            nm = n.get('nmId')
                            if nm:
                                spend_by_nm[int(nm)] = round(
                                    spend_by_nm.get(int(nm), 0)
                                    + float(n.get('sum') or 0), 2)

    # Расход копим в самой таблице: выручку добавит следующий шаг.
    nm_map = _wb_nm_map(cur)
    saved = 0
    for nm, spend in spend_by_nm.items():
        item_id = nm_map.get(nm)
        if not item_id:
            continue
        cur.execute(
            "INSERT INTO marketplace_ad_spend (marketplace_code, "
            "  marketplace_item_id, period_days, ad_spend, revenue) "
            "VALUES ('wildberries', %s, %s, %s, 0) "
            "ON CONFLICT (marketplace_code, marketplace_item_id) "
            "  WHERE marketplace_item_id IS NOT NULL "
            "DO UPDATE SET ad_spend = EXCLUDED.ad_spend, calculated_at = now()",
            (item_id, PERIOD_DAYS, spend),
        )
        saved += 1

    done = (step + 1) * 20 >= len(advert_ids)
    return {'totalSpend': round(total_spend, 2), 'campaigns': len(advert_ids),
            'savedItems': saved, 'done': done}, None


def _wb_stage_revenue(cur, total_spend):
    """Шаг 2: выручка по товарам — знаменатель для процента.

    Только теперь можно посчитать долю рекламы: расход уже лежит в базе,
    осталось разделить его на выручку того же товара за тот же период.
    """
    # Выручку берём из СВОИХ заказов, а не из отчёта площадки: отчёт продаж WB
    # отдаётся десятки секунд и упирается в лимит функции, а у нас те же заказы
    # уже загружены и связаны с товарами — считается одним запросом.
    cur.execute(
        "UPDATE marketplace_ad_spend s SET revenue = v.revenue, "
        "  ad_percent = CASE WHEN v.revenue > 0 "
        "    THEN round(s.ad_spend / v.revenue * 100, 2) END, "
        "  calculated_at = now() "
        "FROM ("
        "  SELECT o.marketplace_item_id AS item_id, "
        "    sum(mp.price_with_marketplace_discount) AS revenue "
        "  FROM orders o "
        "  JOIN marketplace_prices mp ON mp.marketplace_item_id = o.marketplace_item_id "
        "    AND mp.marketplace_code = 'wildberries' "
        f"  WHERE o.marketplace = 'WB' AND o.cancelled_at IS NULL "
        f"    AND o.created_at >= now() - interval '{PERIOD_DAYS} days' "
        "  GROUP BY o.marketplace_item_id"
        ") v "
        "WHERE s.marketplace_code = 'wildberries' "
        "  AND s.marketplace_item_id = v.item_id"
    )
    by_item = cur.rowcount

    cur.execute(
        "SELECT COALESCE(sum(mp.price_with_marketplace_discount), 0) "
        "FROM orders o "
        "JOIN marketplace_prices mp ON mp.marketplace_item_id = o.marketplace_item_id "
        "  AND mp.marketplace_code = 'wildberries' "
        "WHERE o.marketplace = 'WB' AND o.cancelled_at IS NULL "
        f"  AND o.created_at >= now() - interval '{PERIOD_DAYS} days'"
    )
    total_revenue = float(cur.fetchone()[0] or 0)

    pct = None
    if total_revenue > 0 and total_spend is not None:
        pct = _save_total(cur, 'wildberries', total_spend, total_revenue)

    return {'ok': True, 'revenue': round(total_revenue, 2), 'percent': pct,
            'byItem': by_item}, None


def handler(event: dict, context) -> dict:
    """Фактические расходы на рекламу с площадок для юнит-экономики.

    Раньше процент продвижения задавался руками и был занижен: OZON тратит
    около 22% выручки при учтённых 10%, WB — сотни тысяч в месяц при нулевой
    настройке. Из-за этого маржа считалась завышенной.

    POST /  { action: 'sync', marketplace }  - загрузить расходы
    POST /  { action: 'sync_nm_ids' }        - подтянуть номера товаров WB
    GET  /?action=status                     - что сейчас известно о рекламе
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
            if not _is_admin(cur, params.get('actorId')):
                return _resp(403, {'error': 'Раздел доступен администратору'})

            cur.execute(
                "SELECT marketplace_code, ad_spend, revenue, ad_percent, "
                "  period_days, calculated_at FROM marketplace_ad_spend "
                "WHERE marketplace_item_id IS NULL ORDER BY marketplace_code"
            )
            totals = [{
                'marketplaceCode': r[0], 'adSpend': float(r[1] or 0),
                'revenue': float(r[2] or 0),
                'adPercent': float(r[3]) if r[3] is not None else None,
                'periodDays': r[4],
                'calculatedAt': r[5].isoformat() + 'Z' if r[5] else None,
            } for r in cur.fetchall()]

            cur.execute(
                "SELECT marketplace_code, count(*) FROM marketplace_ad_spend "
                "WHERE marketplace_item_id IS NOT NULL GROUP BY marketplace_code"
            )
            by_item = {r[0]: r[1] for r in cur.fetchall()}
            return _resp(200, {'totals': totals, 'itemsWithSpend': by_item})

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        secret = os.environ.get('CRON_SECRET', '')
        if body_data.get('cronSecret'):
            if not secret or body_data['cronSecret'] != secret:
                return _resp(403, {'error': 'Неверный ключ планировщика'})
        elif not _is_admin(cur, body_data.get('actorId')):
            return _resp(403, {'error': 'Доступно администратору'})

        if action == 'sync_nm_ids':
            creds, enabled = _credentials(cur, 'wildberries')
            if not enabled:
                return _resp(400, {'error': 'Интеграция WB не подключена'})
            saved, cursor, done = _sync_wb_nm_ids(
                cur, (creds.get('apiKey') or '').strip(),
                body_data.get('cursor'),
            )
            conn.commit()
            return _resp(200, {'ok': True, 'saved': saved,
                               'cursor': cursor, 'done': done})

        if action == 'sync':
            code = body_data.get('marketplace')
            # Планировщик дёргает функцию без параметров: он не умеет ходить по
            # площадкам сам. Тогда берём OZON — он считается одним запросом, а
            # WB требует нескольких заходов и запускается с экрана.
            if not code and body_data.get('cronSecret'):
                code = 'ozon'
            if code not in ('ozon', 'wildberries'):
                return _resp(400, {'error': 'Неизвестный маркетплейс'})
            creds, enabled = _credentials(cur, code)
            if not enabled:
                return _resp(400, {'error': 'Интеграция не подключена'})

            if code == 'ozon':
                res = _sync_ozon(
                    cur, creds,
                    body_data.get('dateFrom'), body_data.get('dateTo'),
                    bool(body_data.get('dryRun')),
                )
            else:
                # WB считается в два приёма: сначала расход по кампаниям
                # (порциями, их десятки), потом выручка и сам процент.
                headers = {'Authorization': (creds.get('apiKey') or '').strip()}
                today = datetime.now(timezone.utc).date()
                since = today - timedelta(days=PERIOD_DAYS)
                stage = body_data.get('stage') or 'spend'

                if stage == 'spend':
                    step = int(body_data.get('step') or 0)
                    res, err = _wb_stage_spend(cur, headers, since, today, step)
                    if err:
                        return _resp(200, {'ok': False, 'error': err})
                    conn.commit()
                    return _resp(200, {
                        'ok': True, 'stage': 'spend', 'step': step,
                        'done': res['done'], 'nextStep': step + 1,
                        'spend': res['totalSpend'], 'campaigns': res['campaigns'],
                        'savedItems': res['savedItems'],
                    })

                res, err = _wb_stage_revenue(cur, body_data.get('totalSpend'))
                if err:
                    return _resp(200, {'ok': False, 'error': err})
                res['spend'] = body_data.get('totalSpend')

            if res.get('ok'):
                cur.execute(
                    "INSERT INTO audit_log (category, user_id, user_name, action, "
                    "entity_type, description) VALUES ('integration', NULL, "
                    "'Планировщик', 'ad_spend_sync', 'economics', %s)",
                    (f"Реклама {code}: {res.get('percent')}% "
                     f"({res.get('spend')} ₽ из {res.get('revenue')} ₽)",),
                )
                conn.commit()
            return _resp(200, res)

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()