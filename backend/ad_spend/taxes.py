"""Налоги с маркетплейсов: УСН «доходы» + НДС по пониженной ставке.

Считаем только магазин МЕГАТЮЛЬ и только площадки (без сайта).

БАЗА — выручка по отчётам площадок, а не поступления на расчётный счёт.
Доход — цена, по которой площадка продала вещь: деньги покупателя плюс то,
что площадка доплатила за свои скидки. Комиссия, логистика и хранение доход
не уменьшают. Переводы своих же денег на счёт сюда не попадают вовсе.

НДС 5% уже сидит внутри цены: НДС = выручка × 5 / 105. Доход для УСН берётся
без НДС: УСН = (выручка − НДС) × 6%.

НАЧИСЛЕНИЕ РАЗ В МЕСЯЦ. За закрытый месяц налог записывается в tax_accruals
один раз — как только отчёты площадки за него пришли (обычно 1-го числа) —
и дальше не меняется. Так баланс виджета двигается раз в месяц: видно,
сколько к уплате за прошлый месяц, а не плавающая цифра.

Источники по площадкам:
  * OZON — отчёт о выплатах (cash-flow statement): orders_amount за периоды
    месяца. Совпадает с отчётом о реализации до десятых процента, но готов
    сразу после конца месяца, а реализация — только через несколько дней;
  * WB — еженедельный отчёт о реализации, неделя идёт в месяц своего конца;
  * Яндекс Маркет — доставленные заказы из статистики заказов.
"""
import json
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

YM_API = 'https://api.partner.market.yandex.ru'

# До 01.07.2026 магазин был на АУСН: тот налог считала и выставляла сама
# налоговая по данным банка. УСН 6% + НДС 5% — с июля 2026, раньше не копим.
DEFAULTS = {'tax_usn_pct': '6', 'tax_vat_pct': '5', 'tax_start_month': '2026-07-01'}
MARKETPLACES = ('ozon', 'wildberries', 'yandex_market')
SHOP_ID = 1  # МЕГАТЮЛЬ


def _month(d):
    return d.replace(day=1)


def _next_month(d):
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def settings(cur):
    cur.execute("SELECT key, value FROM system_settings WHERE key IN %s", (tuple(DEFAULTS),))
    raw = {**DEFAULTS, **{k: v for k, v in cur.fetchall() if v}}
    return {
        'usnPct': float(raw['tax_usn_pct']),
        'vatPct': float(raw['tax_vat_pct']),
        'startMonth': datetime.strptime(str(raw['tax_start_month'])[:10], '%Y-%m-%d').date(),
    }


def months_to_load(cur):
    """Сколько месяцев назад тянуть отчёты, чтобы покрыть все неначисленные."""
    start = settings(cur)['startMonth']
    today = date.today()
    return max(1, min((today.year - start.year) * 12 + today.month - start.month, 12))


def _enabled(cur):
    cur.execute(
        "SELECT marketplace_code FROM marketplace_integrations "
        "WHERE shop_id = %s AND is_enabled AND marketplace_code IN %s",
        (SHOP_ID, MARKETPLACES),
    )
    return {r[0] for r in cur.fetchall()}


def _month_revenue(cur, code, month):
    """(выручка, возвраты) площадки за месяц или None, если отчёт ещё не готов.

    Готов — значит, данные площадки забирали уже после конца месяца: иначе
    в них нет последних дней, и начисление вышло бы заниженным навсегда.
    """
    end = _next_month(month)
    if code == 'ozon':
        cur.execute("SELECT max(synced_at) FROM marketplace_payouts WHERE marketplace_code = 'ozon'")
        synced = cur.fetchone()[0]
        if not synced or synced.date() < end:
            return None
        cur.execute(
            "SELECT COALESCE(sum(orders_amount), 0), COALESCE(-sum(returns_amount), 0) "
            "FROM marketplace_payouts WHERE marketplace_code = 'ozon' "
            "AND period_start >= %s AND period_start < %s",
            (month, end),
        )
    elif code == 'wildberries':
        cur.execute("SELECT max(synced_at) FROM marketplace_payouts WHERE marketplace_code = 'wildberries'")
        synced = cur.fetchone()[0]
        if not synced or synced.date() < end:
            return None
        cur.execute(
            "SELECT COALESCE(sum(orders_amount), 0), COALESCE(-sum(returns_amount), 0) "
            "FROM marketplace_payouts WHERE marketplace_code = 'wildberries' "
            "AND period_end >= %s AND period_end < %s",
            (month, end),
        )
    else:
        cur.execute(
            "SELECT revenue, returns FROM tax_revenue_monthly "
            "WHERE marketplace_code = %s AND month = %s AND synced_at >= %s",
            (code, month, end),
        )
    row = cur.fetchone()
    return (float(row[0] or 0), float(row[1] or 0)) if row else None


def accrue_missing(cur):
    """Начисляет налог за закрытые месяцы, по которым его ещё нет. Возвращает [(месяц, площадка, налог)]."""
    s = settings(cur)
    usn, vat = s['usnPct'], s['vatPct']
    this_month = _month(date.today())
    enabled = _enabled(cur)
    cur.execute("SELECT month, marketplace_code FROM tax_accruals")
    done = {(r[0], r[1]) for r in cur.fetchall()}

    added = []
    m = s['startMonth']
    while m < this_month:
        for code in MARKETPLACES:
            if code not in enabled or (m, code) in done:
                continue
            rr = _month_revenue(cur, code, m)
            if rr is None:
                continue
            revenue, returns = rr
            net = revenue - returns
            vat_sum = net * vat / (100 + vat) if vat else 0.0
            usn_sum = (net - vat_sum) * usn / 100
            cur.execute(
                "INSERT INTO tax_accruals (month, marketplace_code, revenue, returns, vat, usn, total) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (m, code, round(revenue, 2), round(returns, 2), round(vat_sum, 2),
                 round(usn_sum, 2), round(vat_sum + usn_sum, 2)),
            )
            added.append((str(m), code, round(vat_sum + usn_sum, 2)))
        m = _next_month(m)
    return added


def summary(cur):
    s = settings(cur)
    cur.execute(
        "SELECT marketplace_code, sum(total), sum(revenue - returns) FROM tax_accruals "
        "WHERE month >= %s GROUP BY 1",
        (s['startMonth'],),
    )
    by_mp = {code: {'tax': 0.0, 'net': 0.0} for code in MARKETPLACES}
    for code, total, net in cur.fetchall():
        by_mp[code] = {'tax': round(float(total), 2), 'net': round(float(net), 2)}
    accrued = sum(v['tax'] for v in by_mp.values())

    # Последний начисленный месяц — «сколько добавилось за прошлый месяц».
    cur.execute(
        "SELECT month, marketplace_code, total FROM tax_accruals "
        "WHERE month = (SELECT max(month) FROM tax_accruals WHERE month >= %s)",
        (s['startMonth'],),
    )
    last_rows = cur.fetchall()
    last = None
    if last_rows:
        last = {'month': str(last_rows[0][0]),
                'byMarketplace': {r[1]: float(r[2]) for r in last_rows},
                'total': round(sum(float(r[2]) for r in last_rows), 2)}

    # Закрытые месяцы, где отчёт какой-то площадки ещё не пришёл.
    enabled = _enabled(cur)
    cur.execute("SELECT month, marketplace_code FROM tax_accruals")
    done = {(r[0], r[1]) for r in cur.fetchall()}
    waiting = []
    m = s['startMonth']
    while m < _month(date.today()):
        missing = [c for c in MARKETPLACES if c in enabled and (m, c) not in done]
        if missing:
            waiting.append({'month': str(m), 'marketplaces': missing})
        m = _next_month(m)

    cur.execute(
        "SELECT id, amount, comment, created_at, created_by_name FROM tax_writeoffs "
        "WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20"
    )
    writeoffs = [{'id': r[0], 'amount': float(r[1]), 'comment': r[2],
                  'createdAt': r[3].isoformat() + 'Z', 'createdByName': r[4]}
                 for r in cur.fetchall()]
    cur.execute("SELECT COALESCE(sum(amount), 0) FROM tax_writeoffs WHERE deleted_at IS NULL")
    written = float(cur.fetchone()[0] or 0)

    return {
        'usnPct': s['usnPct'],
        'vatPct': s['vatPct'],
        'startMonth': str(s['startMonth']),
        'byMarketplace': by_mp,
        'accrued': round(accrued, 2),
        'paid': round(written, 2),
        'balance': round(accrued - written, 2),
        'lastMonth': last,
        'waiting': waiting,
        'writeoffs': writeoffs,
    }


def write_off(cur, body, actor_id, actor_name):
    try:
        amount = round(float(body.get('amount')), 2)
    except (TypeError, ValueError):
        raise ValueError('Сумма должна быть числом')
    if amount <= 0:
        raise ValueError('Сумма должна быть больше нуля')
    comment = (body.get('comment') or '').strip()[:500] or None
    cur.execute(
        "INSERT INTO tax_writeoffs (amount, comment, created_by, created_by_name) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (amount, comment, int(actor_id) if actor_id else None, (actor_name or '')[:200] or None),
    )
    return cur.fetchone()[0]


def delete_writeoff(cur, writeoff_id):
    cur.execute(
        "UPDATE tax_writeoffs SET deleted_at = now() WHERE id = %s AND deleted_at IS NULL RETURNING amount",
        (int(writeoff_id),),
    )
    row = cur.fetchone()
    return float(row[0]) if row else None


def _ym_post(url, api_key, payload):
    req = urllib.request.Request(url, method='POST', data=json.dumps(payload).encode('utf-8'))
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')[:300]
    except Exception as e:
        return 0, str(e)


def sync_ym_revenue(cur, creds, month_back=1):
    """Выручка Яндекс Маркета за месяц по доставленным заказам.

    Статистика заказов отдаёт JSON сразу: цену покупателя по каждой позиции,
    субсидии площадки за скидки и сколько штук вернули. Месяц — по дате
    последнего статуса (доставка или возврат).
    """
    api_key = (creds.get('apiKey') or '').strip()
    campaign = str(creds.get('campaignId') or '').strip()
    if not api_key or not campaign:
        return {'error': 'Не заполнены ключ или номер кампании Яндекса'}

    month = _month(date.today())
    for _ in range(int(month_back)):
        month = _month(month - timedelta(days=1))
    last_day = _next_month(month) - timedelta(days=1)

    revenue = returns = 0.0
    orders = 0
    token = ''
    for _ in range(50):
        url = f'{YM_API}/campaigns/{campaign}/stats/orders?limit=200'
        if token:
            url += f'&page_token={token}'
        st, d = _ym_post(url, api_key, {
            'updateFrom': str(month), 'updateTo': str(last_day),
            'statuses': ['DELIVERED', 'PARTIALLY_RETURNED', 'RETURNED'],
        })
        if st != 200 or not isinstance(d, dict):
            return {'error': f'Яндекс ответил {st}: {d}'}
        res = d.get('result') or {}
        for o in res.get('orders') or []:
            buyer_total = ret_total = 0.0
            for it in o.get('items') or []:
                cnt = int(it.get('count') or 1)
                buyer = 0.0
                for p in it.get('prices') or []:
                    if p.get('type') == 'BUYER':
                        buyer += float(p.get('total') or float(p.get('costPerItem') or 0) * cnt)
                returned = sum(int(x.get('itemCount') or 0) for x in (it.get('details') or [])
                               if x.get('itemStatus') == 'RETURNED')
                buyer_total += buyer
                ret_total += buyer / cnt * min(returned, cnt) if cnt else 0.0
            # Субсидии — доплата Яндекса за скидки покупателю: тоже выручка.
            subsidy = 0.0
            for s in o.get('subsidies') or []:
                amt = float(s.get('amount') or 0)
                subsidy += -amt if s.get('operationType') == 'DEDUCTION' else amt
            share = ret_total / buyer_total if buyer_total else 0.0
            revenue += buyer_total + subsidy
            returns += ret_total + subsidy * share
            orders += 1
        token = (res.get('paging') or {}).get('nextPageToken') or ''
        if not token:
            break

    cur.execute(
        "INSERT INTO tax_revenue_monthly (marketplace_code, month, revenue, returns, orders_count, synced_at) "
        "VALUES ('yandex_market', %s, %s, %s, %s, now()) "
        "ON CONFLICT (marketplace_code, month) DO UPDATE SET revenue = EXCLUDED.revenue, "
        "  returns = EXCLUDED.returns, orders_count = EXCLUDED.orders_count, synced_at = now()",
        (month, round(revenue, 2), round(returns, 2), orders),
    )
    return {'month': str(month), 'orders': orders, 'revenue': round(revenue, 2),
            'returns': round(returns, 2)}
