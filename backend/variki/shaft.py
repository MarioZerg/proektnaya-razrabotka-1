"""Угольная шахта: общий мешок и премия для швеи в шляпе.

Мешок растёт на 10 за каждый заказ, закрытый в «Готовые» после запуска шахты.
Потолок держится только на сервере и клиенту не отдаётся.
Швея со шляпой заглядывает 15, 16 и 17 числа с 17:00 до 18:00 по Москве.
За все три вечера — один заход. Опоздала на вечер — он сгорает, оставшиеся
ещё можно успеть. Заглянула — мешок для неё закрыт до следующего месяца.
В час окна ей виден процент 10–15 от текущего мешка.
Заглянула — процент списывается с мешка и встаёт в очередь «Премия шахты»:
это живые рубли, их платит администратор отдельной кассовой транзакцией,
не зарплатой и не вариками.
Без шляпы мешок завязан, но накопленная сумма всё равно видна.
"""

import random
from datetime import datetime
from datetime import timedelta
from datetime import timezone as dt_timezone

SHAFT_DAYS = (15, 16, 17)
HOUR_FROM = 17
HOUR_TO = 18
BAG_CAP = 72355
FILL_PER_ORDER = 10
PERCENT_MIN = 10
PERCENT_MAX = 15


_SHAFT_SCHEMA_READY = False


def ensure_shaft_tables(cur):
    global _SHAFT_SCHEMA_READY
    if _SHAFT_SCHEMA_READY:
        return
    _create_shaft_schema(cur)
    _SHAFT_SCHEMA_READY = True


def _create_shaft_schema(cur):
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS bubble_hat VARCHAR(40)")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hat_boost_until TIMESTAMPTZ")
    cur.execute(
        "CREATE TABLE IF NOT EXISTS shaft_bag ("
        "  id INTEGER PRIMARY KEY DEFAULT 1,"
        "  amount INTEGER NOT NULL DEFAULT 0,"
        "  started_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    )
    cur.execute(
        "INSERT INTO shaft_bag (id, amount) VALUES (1, 0) ON CONFLICT (id) DO NOTHING"
    )
    cur.execute(
        "CREATE TABLE IF NOT EXISTS shaft_contributions ("
        "  order_id INTEGER PRIMARY KEY,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    )
    cur.execute(
        "CREATE TABLE IF NOT EXISTS shaft_claims ("
        "  id SERIAL PRIMARY KEY,"
        "  user_id INTEGER NOT NULL,"
        "  user_name TEXT,"
        "  claim_date DATE NOT NULL,"
        "  percent INTEGER NOT NULL,"
        "  payout INTEGER NOT NULL,"
        "  bag_before INTEGER NOT NULL,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  UNIQUE (user_id, claim_date)"
        ")"
    )
    cur.execute(
        "CREATE TABLE IF NOT EXISTS shaft_preview ("
        "  user_id INTEGER NOT NULL,"
        "  claim_date DATE NOT NULL,"
        "  percent INTEGER NOT NULL,"
        "  PRIMARY KEY (user_id, claim_date)"
        ")"
    )
    cur.execute("ALTER TABLE shaft_claims ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ")
    cur.execute("ALTER TABLE shaft_claims ADD COLUMN IF NOT EXISTS paid_by INTEGER")
    cur.execute("ALTER TABLE shaft_claims ADD COLUMN IF NOT EXISTS cash_tx_id INTEGER")


def _moscow_now(cur):
    return datetime.now(dt_timezone.utc).replace(tzinfo=None) + timedelta(hours=3)


def _iso_msk(moment):
    if not moment:
        return None
    return moment.strftime('%Y-%m-%dT%H:%M:%S') + '+03:00'


def _hat_alive(hat, until, now_utc_aware):
    if not hat or not until:
        return False
    if getattr(until, 'tzinfo', None) is None:
        return False
    return until > now_utc_aware


def _in_window(now):
    return now.day in SHAFT_DAYS and HOUR_FROM <= now.hour < HOUR_TO


def _next_open(now, claimed=False):
    if claimed:
        month = 1 if now.month == 12 else now.month + 1
        year = now.year + 1 if now.month == 12 else now.year
        return datetime(year, month, SHAFT_DAYS[0], HOUR_FROM, 0, 0)
    if _in_window(now):
        return None
    for day in SHAFT_DAYS:
        start = now.replace(day=day, hour=HOUR_FROM, minute=0, second=0, microsecond=0)
        if now < start:
            return start
    month = 1 if now.month == 12 else now.month + 1
    year = now.year + 1 if now.month == 12 else now.year
    return datetime(year, month, SHAFT_DAYS[0], HOUR_FROM, 0, 0)


def _bag_from_ledger(cur):
    """Сколько в мешке по записанным монетам и уже унесённым горстям."""
    cur.execute("SELECT COUNT(*) FROM shaft_contributions")
    gross = min(BAG_CAP, int(cur.fetchone()[0]) * FILL_PER_ORDER)
    cur.execute("SELECT COALESCE(SUM(payout), 0) FROM shaft_claims")
    taken = int(cur.fetchone()[0])
    return max(0, gross - taken)


def _reconcile(cur):
    """Новые «Готовые» с момента запуска шахты кладут в мешок по 10, не выше потолка.

    Число вставленных строк берём из RETURNING, не из cur.rowcount.
    На INSERT…SELECT rowcount здесь приходит -1, а -1 * 10 списывало
    десятку при каждом открытии страницы.
    """
    cur.execute("SELECT amount, started_at FROM shaft_bag WHERE id = 1 FOR UPDATE")
    amount, started_at = cur.fetchone()
    cur.execute(
        "INSERT INTO shaft_contributions (order_id) "
        "SELECT o.id FROM orders o "
        "WHERE o.sewing_status = 'Готовые' AND o.packed_at IS NOT NULL "
        "  AND o.packed_at >= %s "
        "  AND NOT EXISTS (SELECT 1 FROM shaft_contributions c WHERE c.order_id = o.id) "
        "RETURNING order_id",
        (started_at,),
    )
    added = len(cur.fetchall()) * FILL_PER_ORDER
    if int(amount) < 0:
        amount = _bag_from_ledger(cur)
        cur.execute("UPDATE shaft_bag SET amount = %s WHERE id = 1", (amount,))
    elif added:
        cur.execute(
            "UPDATE shaft_bag SET amount = LEAST(%s, amount + %s) WHERE id = 1 RETURNING amount",
            (BAG_CAP, added),
        )
        amount = cur.fetchone()[0]
    return int(amount)


def _claims_this_month(cur, user_id, today):
    start = today.replace(day=1)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    cur.execute(
        "SELECT claim_date, percent, payout, created_at, paid_at FROM shaft_claims "
        "WHERE user_id = %s AND claim_date >= %s AND claim_date < %s "
        "ORDER BY claim_date",
        (int(user_id), start, end),
    )
    return cur.fetchall()


def _day_states(now, claimed_days):
    """Один заход на все три вечера. Прошедший пустой вечер сгорает,
    после захода остальные вечера для этой швеи закрыты."""
    used = bool(claimed_days)
    states = []
    for day in SHAFT_DAYS:
        past = now.day > day or (now.day == day and now.hour >= HOUR_TO)
        if day in claimed_days:
            status = 'taken'
        elif used and not past:
            status = 'spent'
        elif past:
            status = 'missed'
        elif now.day == day and _in_window(now):
            status = 'open'
        else:
            status = 'waiting'
        states.append({'day': day, 'status': status})
    return states


def _diggers(cur, today):
    """Кто в этом месяце уже зачерпнул. Один человек — один кружок."""
    start = today.replace(day=1)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    cur.execute(
        "SELECT DISTINCT ON (c.user_id) c.user_id, "
        "  COALESCE(NULLIF(c.user_name, ''), u.full_name, ''), "
        "  NULLIF(COALESCE(u.avatar_url, u.max_avatar_url), ''), "
        "  c.created_at "
        "FROM shaft_claims c "
        "LEFT JOIN users u ON u.id = c.user_id "
        "WHERE c.claim_date >= %s AND c.claim_date < %s "
        "ORDER BY c.user_id, c.created_at DESC",
        (start, end),
    )
    rows = list(cur.fetchall())
    rows.sort(key=lambda row: row[3].timestamp() if row[3] else 0, reverse=True)
    return [
        {'id': row[0], 'name': row[1], 'avatarUrl': row[2]}
        for row in rows
    ]


def _preview_percent(cur, user_id, today, should_roll):
    cur.execute(
        "SELECT percent FROM shaft_preview WHERE user_id = %s AND claim_date = %s",
        (int(user_id), today),
    )
    row = cur.fetchone()
    if row:
        return int(row[0])
    if not should_roll:
        return None
    percent = random.randint(PERCENT_MIN, PERCENT_MAX)
    cur.execute(
        "INSERT INTO shaft_preview (user_id, claim_date, percent) VALUES (%s, %s, %s) "
        "ON CONFLICT (user_id, claim_date) DO NOTHING",
        (int(user_id), today, percent),
    )
    cur.execute(
        "SELECT percent FROM shaft_preview WHERE user_id = %s AND claim_date = %s",
        (int(user_id), today),
    )
    stored = cur.fetchone()
    return int(stored[0]) if stored else percent


def desk(cur, user_id):
    ensure_shaft_tables(cur)
    cur.execute(
        "SELECT full_name, role, NULLIF(bubble_hat, ''), hat_boost_until "
        "FROM users WHERE id = %s",
        (int(user_id),),
    )
    me = cur.fetchone()
    if not me:
        return 404, {'error': 'Сотрудник не найден'}
    name, role, hat, until = me
    cur.execute("SELECT now()")
    now_utc = cur.fetchone()[0]
    has_hat = role == 'sewer' and _hat_alive(hat, until, now_utc)
    now = _moscow_now(cur)
    today = now.date()
    amount = _reconcile(cur)
    claimed_rows = _claims_this_month(cur, user_id, today)
    claimed_days = {row[0].day for row in claimed_rows}
    days = _day_states(now, claimed_days)
    window = _in_window(now)
    claimed_month = bool(claimed_rows)
    percent = None
    preview = None
    if has_hat and window and not claimed_month and amount:
        percent = _preview_percent(cur, user_id, today, True)
        preview = amount * percent // 100
    block = ''
    can = False
    if role != 'sewer' or not has_hat:
        block = 'Верёвка затянута. Шахта открывается только в шляпе'
    elif claimed_month:
        block = 'В эти три дня горсть уже унесли. Следующий заход — в следующем месяце'
    elif not window:
        block = 'Мешок дремлет до своего часа'
    elif not amount:
        block = 'В мешке пока тишина'
    elif not preview:
        block = 'На дне одна пыль — зачёрпывать нечего'
    else:
        can = True
    closes = now.replace(hour=HOUR_TO, minute=0, second=0, microsecond=0) if window else None
    claims = [
        {
            'day': row[0].day,
            'percent': row[1],
            'payout': row[2],
            'at': row[3].isoformat() if row[3] else None,
            'paid': bool(row[4]),
        }
        for row in claimed_rows
    ]
    return 200, {
        'hasHat': has_hat,
        'name': name,
        'bag': int(amount),
        'full': amount >= BAG_CAP,
        'tied': not has_hat,
        'days': days,
        'windowOpen': bool(has_hat and window and not claimed_month),
        'closesAt': _iso_msk(closes),
        'nextOpenAt': _iso_msk(_next_open(now, claimed_month)),
        'percent': percent,
        'previewPayout': preview,
        'canClaim': can,
        'blockReason': block,
        'claims': claims,
        'diggers': _diggers(cur, today),
    }


def claim(cur, user_id):
    ensure_shaft_tables(cur)
    if not str(user_id or '').isdigit():
        return 400, {'error': 'Укажите сотрудника'}
    cur.execute(
        "SELECT full_name, role, NULLIF(bubble_hat, ''), hat_boost_until "
        "FROM users WHERE id = %s FOR UPDATE",
        (int(user_id),),
    )
    me = cur.fetchone()
    if not me:
        return 404, {'error': 'Сотрудник не найден'}
    name, role, hat, until = me
    cur.execute("SELECT now()")
    now_utc = cur.fetchone()[0]
    if role != 'sewer' or not _hat_alive(hat, until, now_utc):
        return 409, {'error': 'Мешок завязан: без шляпы в шахту нельзя'}
    now = _moscow_now(cur)
    if not _in_window(now):
        return 409, {'error': 'Этот час уже закрыт или ещё не наступил'}
    today = now.date()
    if _claims_this_month(cur, user_id, today):
        return 409, {'error': 'В эти три дня мешок уже открывали. Следующий заход — в следующем месяце'}
    amount = _reconcile(cur)
    percent = _preview_percent(cur, user_id, today, True)
    payout = amount * percent // 100
    if payout < 1:
        return 409, {'error': 'В мешке слишком мало, заглядывать нечего'}
    cur.execute(
        "INSERT INTO shaft_claims (user_id, user_name, claim_date, percent, payout, bag_before) "
        "VALUES (%s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (user_id, claim_date) DO NOTHING RETURNING id",
        (int(user_id), name, today, percent, payout, amount),
    )
    if not cur.fetchone():
        return 409, {'error': 'В эти три дня мешок уже открывали'}
    cur.execute(
        "UPDATE shaft_bag SET amount = GREATEST(0, amount - %s) WHERE id = 1",
        (payout,),
    )
    cur.execute(
        "INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description) "
        "VALUES ('variki', %s, %s, 'shaft_premium', 'shaft', %s, %s)",
        (int(user_id), name, int(user_id),
         f'Премия шахты: {payout} ₽, {percent}% мешка'),
    )
    return 200, {
        'payout': payout,
        'percent': percent,
        'title': 'Премия шахты',
    }


def _admin(cur, actor_id):
    if not str(actor_id or '').isdigit():
        return False, ''
    cur.execute("SELECT role, full_name FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    if not row or row[0] != 'admin':
        return False, ''
    return True, row[1] or ''


def finance_list(cur, actor_id):
    ensure_shaft_tables(cur)
    ok, _name = _admin(cur, actor_id)
    if not ok:
        return 403, {'error': 'Премии шахты видит только администратор'}
    cur.execute(
        "SELECT c.id, c.user_id, COALESCE(c.user_name, u.full_name), c.claim_date, "
        "  c.percent, c.payout, c.created_at "
        "FROM shaft_claims c "
        "LEFT JOIN users u ON u.id = c.user_id "
        "WHERE c.paid_at IS NULL "
        "ORDER BY c.created_at"
    )
    claims = [
        {
            'id': row[0],
            'userId': row[1],
            'userName': row[2],
            'day': row[3].day if row[3] else None,
            'percent': row[4],
            'payout': row[5],
            'at': row[6].isoformat() if row[6] else None,
        }
        for row in cur.fetchall()
    ]
    return 200, {
        'claims': claims,
        'total': sum(item['payout'] for item in claims),
    }


def pay_claim(cur, actor_id, claim_id):
    ensure_shaft_tables(cur)
    ok, actor_name = _admin(cur, actor_id)
    if not ok:
        return 403, {'error': 'Выплатить премию может только администратор'}
    if not str(claim_id or '').isdigit():
        return 400, {'error': 'Не указана премия'}
    cur.execute(
        "SELECT id, user_id, user_name, payout, claim_date, paid_at "
        "FROM shaft_claims WHERE id = %s FOR UPDATE",
        (int(claim_id),),
    )
    row = cur.fetchone()
    if not row:
        return 404, {'error': 'Премия не найдена'}
    if row[5]:
        return 409, {'error': 'Эту премию уже выплатили'}
    payout = int(row[3])
    who = row[2] or f'сотрудник #{row[1]}'
    day = row[4].day if row[4] else ''
    cur.execute(
        "INSERT INTO cash_box_transactions (amount, description, payout_id, created_by) "
        "VALUES (%s, %s, NULL, %s) RETURNING id",
        (-payout, f'Премия шахты · {who} · {day} числа', int(actor_id)),
    )
    tx_id = cur.fetchone()[0]
    cur.execute(
        "UPDATE shaft_claims SET paid_at = now(), paid_by = %s, cash_tx_id = %s WHERE id = %s",
        (int(actor_id), tx_id, int(claim_id)),
    )
    cur.execute(
        "INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description) "
        "VALUES ('finance', %s, %s, 'shaft_payout', 'shaft_claim', %s, %s)",
        (int(actor_id), actor_name, int(claim_id),
         f'Выплатил премию шахты {payout} ₽ · {who}'),
    )
    return 200, {'id': int(claim_id), 'payout': payout, 'cashTxId': tx_id}


def handle_shaft_get(cur, params):
    if params.get('shaftFinance'):
        return finance_list(cur, params.get('actorId'))
    if not params.get('shaft'):
        return None
    user_id = params.get('userId')
    if not str(user_id or '').isdigit():
        return 400, {'error': 'Укажите сотрудника'}
    return desk(cur, user_id)


def handle_shaft_post(cur, action, body):
    if action == 'shaft_claim':
        return claim(cur, body.get('userId'))
    if action == 'shaft_pay':
        return pay_claim(cur, body.get('actorId'), body.get('claimId'))
    return None