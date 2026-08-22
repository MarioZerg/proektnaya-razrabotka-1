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


def _save_total(cur, code, spend, revenue, units=None):
    """Расход на всю площадку — когда разбивки по товарам нет."""
    pct = round(spend / revenue * 100, 2) if revenue > 0 else None
    u_all, u_fbo, u_fbs, u_deliv, u_ret = units or (None,) * 5
    cur.execute(
        "INSERT INTO marketplace_ad_spend (marketplace_code, marketplace_item_id, "
        "  period_days, ad_spend, revenue, ad_percent, "
        "  sold_units, sold_units_fbo, sold_units_fbs, "
        "  delivered_units, returned_units, calculated_at) "
        "VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, now()) "
        "ON CONFLICT (marketplace_code) WHERE marketplace_item_id IS NULL "
        "DO UPDATE SET ad_spend = EXCLUDED.ad_spend, revenue = EXCLUDED.revenue, "
        "  ad_percent = EXCLUDED.ad_percent, period_days = EXCLUDED.period_days, "
        "  sold_units = EXCLUDED.sold_units, "
        "  sold_units_fbo = EXCLUDED.sold_units_fbo, "
        "  sold_units_fbs = EXCLUDED.sold_units_fbs, "
        "  delivered_units = EXCLUDED.delivered_units, "
        "  returned_units = EXCLUDED.returned_units, "
        "  calculated_at = now()",
        (code, PERIOD_DAYS, round(spend, 2), round(revenue, 2), pct,
         u_all, u_fbo, u_fbs, u_deliv, u_ret),
    )
    cur.execute(
        "UPDATE marketplace_tariffs SET promo_fact_percent = %s, "
        "  promo_synced_at = now() WHERE marketplace_code = %s",
        (pct, code),
    )
    return pct


# Куда отнести статью удержания в отчёте. Ключ — кусок названия от площадки.
#
# Группы нужны, чтобы владелец видел не список из 25 строк, а четыре понятных
# блока: за что платим складу, за что логистике, за сервисы и за нарушения.
FEE_CATEGORIES = (
    ('размещени', 'storage'),
    ('хранени', 'storage'),
    ('слот', 'logistics'),
    ('грузомест', 'logistics'),
    ('упаковк', 'logistics'),
    ('вывоз', 'logistics'),
    ('досрочн', 'service'),
    ('подписк', 'service'),
    ('страхован', 'service'),
    ('обработк', 'service'),
    ('бронирован', 'service'),
    ('бейдж', 'marketing'),
    ('звёздн', 'marketing'),
    ('превышение индекса', 'penalty'),
    ('жалоб', 'penalty'),
    ('брак', 'penalty'),
    ('потеря', 'penalty'),
)

# Статьи, которые в отчёт по удержаниям НЕ идут: они уже учтены в другом месте
# и попали бы в расчёт дважды.
FEE_SKIP = (
    'доставка покупателю',      # это выручка
    'оплата за клик',           # реклама, считается отдельно как ДРР
    'получение возврата',       # возвраты, учтены в штуках и выкупе
    'доставка и обработка возврата',
    'оплата эквайринга',        # уже сидит в юнитке товара
)


def _fee_category(name):
    """К какой группе отнести статью удержания."""
    low = name.lower()
    for key, cat in FEE_CATEGORIES:
        if key in low:
            return cat
    return 'other'


def _is_fee(name):
    """Это удержание, которое нужно показать отдельно?"""
    low = name.lower()
    return not any(skip in low for skip in FEE_SKIP)


def _sync_payouts(cur, creds, months=6):
    """Отчёты OZON о выплатах: сколько начислено и сколько реально пришло.

    Нужны для двух вещей: посчитать вознаграждение менеджера (процент с
    поступлений) и увидеть, сколько денег забрали досрочные выплаты.

    В отчёте площадка отдаёт продажи и все свои удержания за неделю.
    Начислено к выплате = заказы − возвраты − комиссия − услуги − логистика.
    Фактически пришедшее меньше на сумму досрочных выплат, если мы их брали.
    """
    headers = {'Client-Id': (creds.get('clientId') or '').strip(),
               'Api-Key': (creds.get('apiKey') or '').strip()}
    today = datetime.now(timezone.utc).date()
    since = (today.replace(day=1) - timedelta(days=31 * months)).replace(day=1)

    saved = 0
    for page in range(1, 8):
        st, d = _http(
            f'{OZON_API}/v1/finance/cash-flow-statement/list', 'POST', headers,
            {'date': {'from': f'{since}T00:00:00.000Z',
                      'to': f'{today}T23:59:59.000Z'},
             'page': page, 'page_size': 100, 'with_details': True},
            timeout=25,
        )
        if st != 200 or not isinstance(d, dict):
            break
        flows = ((d.get('result') or {}).get('cash_flows')) or []
        if not flows:
            break

        for f in flows:
            period = f.get('period') or {}
            p_from = (period.get('begin') or '')[:10]
            p_to = (period.get('end') or '')[:10]
            if not p_from or not p_to:
                continue

            orders = float(f.get('orders_amount') or 0)
            returns = float(f.get('returns_amount') or 0)
            commission = float(f.get('commission_amount') or 0)
            services = float(f.get('services_amount') or 0)
            delivery = float(f.get('item_delivery_and_return_amount') or 0)

            # Суммы удержаний приходят отрицательными — просто складываем.
            accrued = orders + returns + commission + services + delivery

            cur.execute(
                "INSERT INTO marketplace_payouts (marketplace_code, "
                "  period_start, period_end, orders_amount, returns_amount, "
                "  commission_amount, services_amount, delivery_amount, "
                "  accrued_amount, synced_at) "
                "VALUES ('ozon', %s, %s, %s, %s, %s, %s, %s, %s, now()) "
                "ON CONFLICT (marketplace_code, period_start, period_end) "
                "DO UPDATE SET orders_amount = EXCLUDED.orders_amount, "
                "  returns_amount = EXCLUDED.returns_amount, "
                "  commission_amount = EXCLUDED.commission_amount, "
                "  services_amount = EXCLUDED.services_amount, "
                "  delivery_amount = EXCLUDED.delivery_amount, "
                "  accrued_amount = EXCLUDED.accrued_amount, synced_at = now()",
                (p_from, p_to, round(orders, 2), round(returns, 2),
                 round(commission, 2), round(services, 2), round(delivery, 2),
                 round(accrued, 2)),
            )
            saved += 1

        if len(flows) < 100:
            break

    # Досрочные выплаты. Площадка удерживает их из перевода, поэтому на счёт
    # приходит меньше, чем начислено. На процент менеджера это не влияет, но
    # знать сумму нужно: это реальные деньги, ушедшие из поступления.
    #
    # Статьи удержаний собраны ПО МЕСЯЦАМ, а периоды выплат — недельные.
    # Поэтому месячную сумму раскладываем на недели ПРОПОРЦИОНАЛЬНО их доле
    # в обороте месяца: записав в каждую неделю весь месяц, мы завысили бы
    # удержания в четыре раза.
    cur.execute(
        "UPDATE marketplace_payouts p SET "
        "  early_payout_amount = round(f.amount * p.accrued_amount / f.total, 2), "
        "  paid_amount = p.accrued_amount "
        "    - round(f.amount * p.accrued_amount / f.total, 2) "
        "FROM ("
        "  SELECT fm.month, sum(fm.amount) AS amount, "
        "    (SELECT sum(accrued_amount) FROM marketplace_payouts p2 "
        "     WHERE p2.marketplace_code = 'ozon' "
        "       AND date_trunc('month', p2.period_start) = fm.month) AS total "
        "  FROM marketplace_fees_monthly fm "
        "  WHERE fm.marketplace_code = 'ozon' "
        "    AND fm.fee_name ILIKE '%досрочн%' "
        "  GROUP BY fm.month"
        ") f "
        "WHERE p.marketplace_code = 'ozon' "
        "  AND date_trunc('month', p.period_start) = f.month "
        "  AND f.total > 0"
    )

    return saved


def _sync_stocks(cur, creds):
    """Остатки на складах площадки — чтобы разнести хранение по товарам.

    Площадка отдаёт по строке на каждый склад, а нам нужен остаток по позиции
    целиком: хранение считается от общего количества, а не от того, где оно
    лежит. Поэтому строки одного SKU складываем.
    """
    headers = {'Client-Id': (creds.get('clientId') or '').strip(),
               'Api-Key': (creds.get('apiKey') or '').strip()}

    by_sku = {}
    for offset in range(0, 10000, 1000):
        st, d = _http(
            f'{OZON_API}/v2/analytics/stock_on_warehouses', 'POST', headers,
            {'limit': 1000, 'offset': offset, 'warehouse_type': 'ALL'},
            timeout=25,
        )
        if st != 200 or not isinstance(d, dict):
            break
        rows = ((d.get('result') or {}).get('rows')) or []
        if not rows:
            break
        for r in rows:
            sku = str(r.get('sku') or '')
            if not sku:
                continue
            cur_row = by_sku.setdefault(sku, {
                'offer_id': r.get('item_code'),
                'name': r.get('item_name'),
                'free': 0, 'reserved': 0, 'warehouses': 0,
            })
            cur_row['free'] += int(r.get('free_to_sell_amount') or 0)
            cur_row['reserved'] += int(r.get('reserved_amount') or 0)
            cur_row['warehouses'] += 1
        if len(rows) < 1000:
            break

    if not by_sku:
        return 0

    # Сопоставляем с нашими товарами по артикулу продавца.
    # Артикул продавца у нас лежит в sku, а ozon_sku — это номер карточки
    # на площадке. Сопоставляем по обоим: часть товаров заведена только с одним.
    cur.execute("SELECT sku, ozon_sku, id FROM marketplace_items")
    items = {}
    for sku_val, ozon_sku, item_id in cur.fetchall():
        if sku_val:
            items[str(sku_val)] = item_id
        if ozon_sku:
            items[str(ozon_sku)] = item_id

    for sku, v in by_sku.items():
        cur.execute(
            "INSERT INTO marketplace_stocks (marketplace_code, sku, offer_id, "
            "  product_name, marketplace_item_id, free_amount, "
            "  reserved_amount, warehouses, synced_at) "
            "VALUES ('ozon', %s, %s, %s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (marketplace_code, sku) DO UPDATE SET "
            "  offer_id = EXCLUDED.offer_id, "
            "  product_name = EXCLUDED.product_name, "
            "  marketplace_item_id = EXCLUDED.marketplace_item_id, "
            "  free_amount = EXCLUDED.free_amount, "
            "  reserved_amount = EXCLUDED.reserved_amount, "
            "  warehouses = EXCLUDED.warehouses, synced_at = now()",
            (sku, v['offer_id'], v['name'],
             items.get(str(v['offer_id'])) or items.get(sku),
             v['free'], v['reserved'], v['warehouses']),
        )

    return len(by_sku)


def _load_progress(cur, code):
    """Где остановились в прошлый раз и что успели накопить.

    Нужно, чтобы после обрыва не читать 29 страниц заново: продолжаем
    с той страницы, на которой закончили.
    """
    cur.execute(
        "SELECT next_page, ad_spend, revenue, delivered_fbo, delivered_fbs, "
        "  by_month, returned_fbo, returned_fbs, fees "
        "FROM marketplace_sync_progress WHERE marketplace_code = %s",
        (code,),
    )
    r = cur.fetchone()
    if not r:
        return 1, None
    return int(r[0] or 1), {
        'spend': float(r[1] or 0),
        'revenue': float(r[2] or 0),
        'deliv_fbo': int(r[3] or 0),
        'deliv_fbs': int(r[4] or 0),
        'by_month': r[5] or {},
        'ret_fbo': int(r[6] or 0),
        'ret_fbs': int(r[7] or 0),
        'fees': r[8] or {},
    }


def _save_progress(cur, code, next_page, acc):
    """Откладываем промежуточный итог до следующей порции."""
    cur.execute(
        "INSERT INTO marketplace_sync_progress (marketplace_code, next_page, "
        "  ad_spend, revenue, delivered_fbo, delivered_fbs, by_month, "
        "  returned_fbo, returned_fbs, fees, updated_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now()) "
        "ON CONFLICT (marketplace_code) DO UPDATE SET "
        "  next_page = EXCLUDED.next_page, ad_spend = EXCLUDED.ad_spend, "
        "  revenue = EXCLUDED.revenue, "
        "  delivered_fbo = EXCLUDED.delivered_fbo, "
        "  delivered_fbs = EXCLUDED.delivered_fbs, "
        "  returned_fbo = EXCLUDED.returned_fbo, "
        "  returned_fbs = EXCLUDED.returned_fbs, "
        "  by_month = EXCLUDED.by_month, fees = EXCLUDED.fees, "
        "  updated_at = now()",
        (code, int(next_page), acc['spend'], acc['revenue'],
         acc['deliv_fbo'], acc['deliv_fbs'], json.dumps(acc['by_month']),
         acc['ret_fbo'], acc['ret_fbs'], json.dumps(acc.get('fees') or {})),
    )


def _clear_progress(cur, code):
    """Период дочитан — накопитель больше не нужен."""
    cur.execute(
        "DELETE FROM marketplace_sync_progress WHERE marketplace_code = %s",
        (code,),
    )


# Сколько страниц операций читаем за один вызов функции.
#
# У площадки за месяц бывает 29 000 операций — 29 страниц по 1000. Все сразу
# не прочитать: не хватит таймаута. Раньше стоял жёсткий предел в 5 страниц,
# и мы видели 17% данных — отсюда 1234 проданных штуки вместо примерно 5000.
# Теперь читаем порциями за несколько вызовов, накапливая итог в базе.
PAGES_PER_CALL = 8


def _sync_ozon(cur, creds, date_from=None, date_to=None, dry_run=False,
               start_page=1, acc=None):
    """Реклама OZON: сколько списали за клики, какая выручка и сколько штук.

    OZON списывает «Оплату за клик» ОБЩИМИ суммами — в операции нет ни товара,
    ни артикула. Разнести по позициям физически не из чего, поэтому считаем
    один процент на всю площадку и применяем ко всем товарам одинаково.

    Читает ПОРЦИЮ страниц начиная с start_page и возвращает накопленный итог
    вместе с номером следующей страницы. Пока страницы не кончились, вызов
    повторяется — иначе за один заход данные не помещаются.
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

    # Продолжаем с того, что накоплено прошлыми порциями.
    acc = acc or {}
    spend = float(acc.get('spend') or 0)
    revenue = float(acc.get('revenue') or 0)
    # Доставки и возвраты копим ОТДЕЛЬНО: так видно, из чего сложился итог,
    # и можно проверить, вычтены ли возвраты. По одному чистому числу этого
    # не понять, а на него делятся все постоянные расходы.
    deliv_fbo = int(acc.get('deliv_fbo') or 0)
    deliv_fbs = int(acc.get('deliv_fbs') or 0)
    ret_fbo = int(acc.get('ret_fbo') or 0)
    ret_fbs = int(acc.get('ret_fbs') or 0)
    # Удержания площадки по статьям и месяцам:
    # {'2026-07-01': {'Подписка Premium Plus': [сумма, сколько раз]}}
    fees = {k: {n: list(v) for n, v in m.items()}
            for k, m in (acc.get('fees') or {}).items()}
    total_pages = 0
    last_page = start_page + PAGES_PER_CALL - 1
    # Расход и оборот ПО МЕСЯЦАМ: {'2026-06-01': [расход, оборот]}.
    #
    # Общая цифра за 30 дней отвечает на вопрос «сколько сейчас», а помесячная —
    # на вопрос «куда движемся». Второй важнее: по одному числу нельзя понять,
    # реклама подорожала или спрос упал.
    by_month = {k: list(v[:2]) for k, v in (acc.get('by_month') or {}).items()}
    units_by_month = {k: int(v[2]) for k, v in (acc.get('by_month') or {}).items()
                      if len(v) > 2}
    # ШТУКИ, за которые получены деньги. Нужны себестоимости: на это число
    # делятся оклады и прочие постоянные расходы.
    #
    # Считать их по нашим заказам нельзя: в системе живут только FBS-отправления.
    # FBO-продажи (товар лежит на складе OZON и уходит покупателю без нашего
    # участия) в заказы не попадают вовсе. А здесь, в финансовых операциях,
    # видно обе схемы — и за каждую заплачено.
    # Транзакции приходят страницами по 1000 — за месяц их бывает несколько.
    for page in range(start_page, start_page + PAGES_PER_CALL):
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
        if page == start_page:
            total_pages = int((d.get('result') or {}).get('page_count') or 0)
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

            # Удержания площадки: всё, что она забрала сверх комиссии и рекламы.
            # Копим по названию — так цифру можно сверить с отчётом в кабинете.
            if amount < 0 and mkey and _is_fee(name):
                bucket = fees.setdefault(mkey, {})
                row = bucket.setdefault(name[:200], [0.0, 0])
                row[0] += abs(amount)
                row[1] += 1

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

                # Сколько вещей уехало этим отправлением и по какой схеме.
                qty = len(o.get('items') or []) or 1
                schema = ((o.get('posting') or {}).get('delivery_schema') or '').upper()
                if schema == 'FBO':
                    deliv_fbo += qty
                else:
                    deliv_fbs += qty
                if mkey:
                    units_by_month[mkey] = units_by_month.get(mkey, 0) + qty
            elif name.startswith('Получение возврата'):
                # ТОЛЬКО «Получение возврата, отмены, невыкупа от покупателя» —
                # это сам факт того, что вещь приехала обратно.
                #
                # Строку «Доставка и обработка возврата» брать НЕЛЬЗЯ: это плата
                # за услугу обработки, она начисляется отдельно и по тем же
                # отправлениям. Считая обе, мы вычитали возвраты дважды — из
                # 1365 проданных штук оставалось 49, а FBO обнулялся полностью.
                back = len(o.get('items') or []) or 1
                schema = ((o.get('posting') or {}).get('delivery_schema') or '').upper()
                if schema == 'FBO':
                    ret_fbo += back
                else:
                    ret_fbs += back
                if mkey:
                    units_by_month[mkey] = units_by_month.get(mkey, 0) - back

            # Возвраты из ОБОРОТА не вычитаем — намеренно.
            #
            # ДРР в кабинете OZON считается от ВАЛОВОГО оборота: сколько товара
            # продано, столько и в знаменателе. Если вычитать возвраты, наш
            # процент перестанет совпадать с кабинетом, и сверять цифры станет
            # невозможно. Потери от возвратов видны в юнит-экономике отдельно —
            # через выкуп, там им и место.
        last_page = page
        if len(ops) < 1000:
            total_pages = page
            break

    # Собираем накопленное в один свёрток: он вернётся сюда же следующим вызовом.
    merged = {}
    for k in set(by_month) | set(units_by_month):
        sp, rv = by_month.get(k, [0.0, 0.0])
        merged[k] = [round(sp, 2), round(rv, 2), units_by_month.get(k, 0)]
    acc_out = {
        'spend': round(spend, 2),
        'revenue': round(revenue, 2),
        'deliv_fbo': deliv_fbo,
        'deliv_fbs': deliv_fbs,
        'ret_fbo': ret_fbo,
        'ret_fbs': ret_fbs,
        'by_month': merged,
        'fees': fees,
    }

    next_page = last_page + 1
    done = total_pages > 0 and next_page > total_pages

    # Страницы ещё есть — отдаём промежуточный итог и просим позвать снова.
    # В базу пока ничего не пишем: неполные цифры там хуже вчерашних полных.
    if not done:
        return {'ok': True, 'inProgress': True, 'nextPage': next_page,
                'totalPages': total_pages, 'acc': acc_out,
                'spend': round(spend, 2), 'revenue': round(revenue, 2)}

    if revenue <= 0:
        return {'ok': False, 'error': 'Нет данных о выручке за период'}

    # Сверочный запуск за прошлый период в базу не пишем: там должен лежать
    # актуальный процент за последние 30 дней, а не срез старого месяца.
    if dry_run:
        pct = round(spend / revenue * 100, 2) if revenue > 0 else None
        return {'ok': True, 'spend': round(spend, 2), 'revenue': round(revenue, 2),
                'percent': pct, 'byItem': 0, 'from': str(since), 'to': str(today),
                'soldUnits': max(0, deliv_fbo + deliv_fbs - ret_fbo - ret_fbs),
                'soldFbo': max(0, deliv_fbo - ret_fbo),
                'soldFbs': max(0, deliv_fbs - ret_fbs),
                'delivered': deliv_fbo + deliv_fbs,
                'returned': ret_fbo + ret_fbs}

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
            "  ad_spend, revenue, ad_percent, sold_units, calculated_at) "
            "VALUES ('ozon', %s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (marketplace_code, month) DO UPDATE SET "
            "  ad_spend = EXCLUDED.ad_spend, revenue = EXCLUDED.revenue, "
            "  ad_percent = EXCLUDED.ad_percent, "
            "  sold_units = EXCLUDED.sold_units, calculated_at = now()",
            (mkey, round(m_spend, 2), round(m_rev, 2), m_pct,
             max(0, units_by_month.get(mkey, 0))),
        )

        # Статьи удержаний этого же месяца. Пишем только для месяцев, покрытых
        # периодом целиком, — по той же причине, что и остальные цифры: кусок
        # месяца, записанный как весь месяц, затрёт полные данные огрызком.
        month_fees = fees.get(mkey) or {}
        if month_fees:
            cur.execute(
                "DELETE FROM marketplace_fees_monthly "
                "WHERE marketplace_code = 'ozon' AND month = %s",
                (mkey,),
            )
            for fee_name, (fee_sum, fee_cnt) in month_fees.items():
                if fee_sum <= 0:
                    continue
                cur.execute(
                    "INSERT INTO marketplace_fees_monthly (marketplace_code, "
                    "  month, fee_name, amount, operations, category) "
                    "VALUES ('ozon', %s, %s, %s, %s, %s)",
                    (mkey, fee_name, round(fee_sum, 2), int(fee_cnt),
                     _fee_category(fee_name)),
                )

    net_fbo = max(0, deliv_fbo - ret_fbo)
    net_fbs = max(0, deliv_fbs - ret_fbs)
    units_total = net_fbo + net_fbs

    # Строку «за последние 30 дней» обновляем ТОЛЬКО обычным запуском.
    #
    # Расчёт за конкретный месяц (dateFrom/dateTo) нужен, чтобы дозаполнить
    # историю, и трогать текущие цифры он не должен: иначе пересчёт мая молча
    # подменяет собой данные за последние 30 дней — и в себестоимости вместо
    # свежего числа продаж оказывается майское.
    if date_from and date_to:
        pct = round(spend / revenue * 100, 2) if revenue > 0 else None
        return {'ok': True, 'spend': round(spend, 2), 'revenue': round(revenue, 2),
                'percent': pct, 'byItem': 0, 'months': len(by_month),
                'soldUnits': units_total, 'soldFbo': net_fbo,
                'soldFbs': net_fbs, 'delivered': deliv_fbo + deliv_fbs,
                'returned': ret_fbo + ret_fbs, 'historyOnly': True}

    pct = _save_total(cur, 'ozon', spend, revenue,
                      (units_total, net_fbo, net_fbs,
                       deliv_fbo + deliv_fbs, ret_fbo + ret_fbs))
    return {'ok': True, 'spend': round(spend, 2), 'revenue': round(revenue, 2),
            'percent': pct, 'byItem': 0, 'months': len(by_month),
            'soldUnits': units_total, 'soldFbo': net_fbo, 'soldFbs': net_fbs,
            'delivered': deliv_fbo + deliv_fbs, 'returned': ret_fbo + ret_fbs}


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

        if action == 'sync_stocks':
            # Остатки: нужны, чтобы разнести хранение по товарам.
            creds, enabled = _credentials(cur, 'ozon')
            if not enabled:
                return _resp(400, {'error': 'Интеграция OZON не подключена'})
            saved = _sync_stocks(cur, creds)
            conn.commit()
            return _resp(200, {'ok': True, 'items': saved})

        if action == 'sync_payouts':
            # Отчёты о выплатах: база для вознаграждения менеджера.
            creds, enabled = _credentials(cur, 'ozon')
            if not enabled:
                return _resp(400, {'error': 'Интеграция OZON не подключена'})
            saved = _sync_payouts(cur, creds, int(body_data.get('months') or 6))
            conn.commit()
            return _resp(200, {'ok': True, 'periods': saved})

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
                # Операций за месяц около 29 000 — за один вызов не прочитать.
                # Читаем порциями: страницу продолжения и накопленный итог
                # передаёт сам вызывающий, а промежуточный результат мы храним
                # в базе, чтобы после обрыва не начинать с первой страницы.
                start_page = int(body_data.get('page') or 0)
                acc = body_data.get('acc')
                if not start_page:
                    saved_page, saved_acc = _load_progress(cur, 'ozon')
                    start_page = saved_page
                    acc = acc or saved_acc

                res = _sync_ozon(
                    cur, creds,
                    body_data.get('dateFrom'), body_data.get('dateTo'),
                    bool(body_data.get('dryRun')),
                    start_page, acc,
                )
                if res.get('inProgress'):
                    _save_progress(cur, 'ozon', res['nextPage'], res['acc'])
                    conn.commit()
                else:
                    _clear_progress(cur, 'ozon')
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