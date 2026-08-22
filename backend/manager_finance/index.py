import json
import os
from datetime import datetime, timedelta

import psycopg2

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def _is_admin(cur, actor_id):
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    r = cur.fetchone()
    return bool(r and r[0] == 'admin')


def _settings(cur):
    """Ставка менеджера, срок холда и кому начисляем."""
    cur.execute(
        "SELECT percent, hold_days, user_id, is_active "
        "FROM manager_commission_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return None
    return {
        'percent': float(r[0] or 0),
        'holdDays': int(r[1] or 15),
        'userId': r[2],
        'isActive': bool(r[3]),
    }


def _accrue(cur):
    """Начисляет менеджеру процент за каждый закрытый недельный отчёт.

    База — деньги, ФАКТИЧЕСКИ ПЕРЕЧИСЛЕННЫЕ на расчётный счёт. Оборот, комиссия
    и услуги площадки в неё не входят: мы их не получаем, и платить с них
    процент не с чего.

    Штуки берём из наших заказов за тот же период — так видно, сколько денег
    пришлось на одну вещь. Отчёты без перечисления пропускаем: деньги ещё не
    дошли, начислять не с чего.
    """
    st = _settings(cur)
    if not st or not st['userId'] or not st['isActive']:
        return {'created': 0, 'skipped': 'Не задан сотрудник или расчёт выключен'}

    cur.execute(
        "SELECT id, period_start, period_end, transferred_amount "
        "FROM marketplace_payouts "
        "WHERE marketplace_code = 'ozon' "
        "  AND transferred_amount > 0 "
        "  AND NOT EXISTS ("
        "    SELECT 1 FROM manager_accruals a "
        "    WHERE a.user_id = %s AND a.period_start = marketplace_payouts.period_start "
        "      AND a.period_end = marketplace_payouts.period_end)",
        (st['userId'],),
    )
    rows = cur.fetchall()

    created = 0
    for payout_id, p_from, p_to, transferred in rows:
        base = float(transferred or 0)
        if base <= 0:
            continue

        # Сколько вещей закрыто этим периодом.
        #
        # Считаем по ДАННЫМ ПЛОЩАДКИ, а не по нашим заказам: в CRM они появились
        # позже, и за старые недели там пусто. На реальных данных выходило
        # «1 штука на 1,3 млн ₽ перечислений» — по такой цифре ни процент на
        # вещь не посчитать, ни отчёт менеджеру не показать.
        #
        # Площадка отдаёт штуки помесячно, поэтому долю недели берём по её весу
        # в перечислениях того же месяца: больше пришло денег — больше вещей.
        cur.execute(
            "SELECT sold_units FROM marketplace_ad_monthly "
            "WHERE marketplace_code = 'ozon' "
            "  AND month = date_trunc('month', %s::date)::date",
            (p_from,),
        )
        row = cur.fetchone()
        month_units = int(row[0] or 0) if row else 0

        cur.execute(
            "SELECT coalesce(sum(transferred_amount), 0) "
            "FROM marketplace_payouts "
            "WHERE marketplace_code = 'ozon' "
            "  AND date_trunc('month', period_start) "
            "      = date_trunc('month', %s::date)",
            (p_from,),
        )
        month_base = float(cur.fetchone()[0] or 0)

        if month_units and month_base > 0:
            units = int(round(month_units * base / month_base))
        else:
            # Запасной вариант: наши заказы. Для свежих недель они полные.
            cur.execute(
                "SELECT count(*) FROM orders "
                "WHERE marketplace = 'OZON' AND cancelled_at IS NULL "
                "  AND created_at::date >= %s AND created_at::date <= %s",
                (p_from, p_to),
            )
            units = int(cur.fetchone()[0] or 0)

        amount = round(base * st['percent'] / 100.0, 2)
        per_unit = round(amount / units, 4) if units else None
        hold_until = p_to + timedelta(days=st['holdDays'])

        cur.execute(
            "INSERT INTO manager_accruals (user_id, payout_id, period_start, "
            "  period_end, units, base_amount, percent, amount, per_unit, "
            "  status, hold_until) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'hold', %s) "
            "ON CONFLICT (user_id, marketplace_code, period_start, period_end) "
            "DO NOTHING",
            (st['userId'], payout_id, p_from, p_to, units, base,
             st['percent'], amount, per_unit, hold_until),
        )
        created += 1

    return {'created': created}


def _apply_returns(cur):
    """Уменьшает начисления на вернувшиеся вещи — но только внутри холда.

    Правило простое: пока идут 15 дней, возврат снимает свою долю начисления.
    После холда деньги закреплены за менеджером и не списываются, даже если
    покупатель вернул товар позже, — так и договаривались.
    """
    cur.execute(
        "SELECT id, period_start, period_end, per_unit, amount, hold_until "
        "FROM manager_accruals "
        "WHERE status = 'hold' AND per_unit IS NOT NULL"
    )
    rows = cur.fetchall()

    updated = 0
    for a_id, p_from, p_to, per_unit, amount, hold_until in rows:
        # Возвраты по заказам этого периода, зарегистрированные ДО конца холда.
        cur.execute(
            "SELECT count(*) FROM marketplace_returns r "
            "JOIN orders o ON o.ozon_posting_number = r.posting_number "
            "WHERE o.created_at::date >= %s AND o.created_at::date <= %s "
            "  AND r.mp_created_at::date <= %s",
            (p_from, p_to, hold_until),
        )
        returned = int(cur.fetchone()[0] or 0)
        if returned <= 0:
            continue

        back = round(float(per_unit) * returned, 2)
        # Больше начисленного не снимаем: иначе менеджер уйдёт в минус
        # из-за возвратов по заказам, попавшим в отчёт лишь частично.
        back = min(back, float(amount))

        cur.execute(
            "UPDATE manager_accruals SET returned_units = %s, "
            "  returned_amount = %s WHERE id = %s",
            (returned, back, a_id),
        )
        updated += 1

    return updated


def _confirm(cur):
    """Подтверждает начисления, у которых холд закончился.

    Если возвраты съели всё начисление, помечаем его аннулированным и пишем
    причину: пустая строка на нуль рублей человеку ничего не объясняет.
    """
    cur.execute(
        "UPDATE manager_accruals "
        "SET status = CASE WHEN amount - returned_amount <= 0 "
        "                  THEN 'cancelled' ELSE 'confirmed' END, "
        "    confirmed_at = CASE WHEN amount - returned_amount > 0 "
        "                        THEN now() END, "
        "    cancelled_at = CASE WHEN amount - returned_amount <= 0 "
        "                        THEN now() END, "
        "    cancel_reason = CASE WHEN amount - returned_amount <= 0 "
        "        THEN 'Все вещи периода вернули покупатели в течение холда' END "
        "WHERE status = 'hold' AND hold_until < now()::date"
    )
    return cur.rowcount


def _balance(cur, user_id):
    """Что менеджер видит в своих финансах."""
    cur.execute(
        "SELECT status, coalesce(sum(amount - returned_amount), 0), count(*) "
        "FROM manager_accruals WHERE user_id = %s GROUP BY status",
        (int(user_id),),
    )
    by_status = {r[0]: {'amount': float(r[1] or 0), 'count': int(r[2])}
                 for r in cur.fetchall()}

    cur.execute(
        "SELECT id, period_start, period_end, units, base_amount, percent, "
        "  amount, per_unit, status, hold_until, returned_units, "
        "  returned_amount, cancel_reason, confirmed_at "
        "FROM manager_accruals WHERE user_id = %s "
        "ORDER BY period_start DESC LIMIT 40",
        (int(user_id),),
    )
    items = []
    for r in cur.fetchall():
        items.append({
            'id': r[0],
            'periodStart': str(r[1]),
            'periodEnd': str(r[2]),
            'units': int(r[3] or 0),
            'baseAmount': float(r[4] or 0),
            'percent': float(r[5] or 0),
            'amount': float(r[6] or 0),
            'perUnit': float(r[7]) if r[7] is not None else None,
            'status': r[8],
            'holdUntil': str(r[9]),
            'returnedUnits': int(r[10] or 0),
            'returnedAmount': float(r[11] or 0),
            'cancelReason': r[12],
            'confirmedAt': str(r[13]) if r[13] else None,
            # Сколько осталось после возвратов — это и идёт в баланс.
            'net': round(float(r[6] or 0) - float(r[11] or 0), 2),
        })

    st = _settings(cur)
    return {
        'percent': st['percent'] if st else 0,
        'holdDays': st['holdDays'] if st else 15,
        # К выплате: подтверждённое.
        'confirmed': round(by_status.get('confirmed', {}).get('amount', 0), 2),
        # В холде: ещё проверяется, может уменьшиться при возврате.
        'hold': round(by_status.get('hold', {}).get('amount', 0), 2),
        'cancelled': round(by_status.get('cancelled', {}).get('amount', 0), 2),
        'items': items,
    }


def handler(event: dict, context) -> dict:
    """Финансы менеджера маркетплейсов: начисления с холдом и баланс.

    GET  /?action=balance&userId=5 — что показать менеджеру в его финансах:
         подтверждённая сумма, сумма в холде и список недельных отчётов.

    POST / { action: 'accrue', actorId } — пересчёт: создаёт начисления по
         новым отчётам, применяет возвраты и подтверждает те, у которых холд
         закончился. Только администратор.

    POST / { action: 'set_user', userId, actorId } — кому начислять процент.
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            action = params.get('action') or 'balance'
            user_id = params.get('userId')

            if action != 'balance':
                return _resp(400, {'error': 'Неизвестное действие'})
            if not user_id:
                return _resp(400, {'error': 'Укажите userId'})

            return _resp(200, _balance(cur, user_id))

        if method != 'POST':
            return _resp(405, {'error': 'Method not allowed'})

        body = json.loads(event.get('body') or '{}')
        action = body.get('action')

        if not _is_admin(cur, body.get('actorId')):
            return _resp(403, {'error': 'Доступно администратору'})

        if action == 'accrue':
            created = _accrue(cur)
            updated = _apply_returns(cur)
            confirmed = _confirm(cur)
            conn.commit()
            return _resp(200, {
                'ok': True,
                'created': created.get('created', 0),
                'returnsApplied': updated,
                'confirmed': confirmed,
            })

        if action == 'recalc':
            # Полный пересчёт: удаляет начисления и считает заново.
            # Нужен, когда поменялась ставка или способ подсчёта штук —
            # иначе старые строки остались бы с прежними цифрами.
            st = _settings(cur)
            if not st or not st['userId']:
                return _resp(400, {'error': 'Не задан сотрудник'})
            cur.execute("DELETE FROM manager_accruals WHERE user_id = %s",
                        (st['userId'],))
            created = _accrue(cur)
            updated = _apply_returns(cur)
            confirmed = _confirm(cur)
            conn.commit()
            return _resp(200, {
                'ok': True, 'created': created.get('created', 0),
                'returnsApplied': updated, 'confirmed': confirmed,
            })

        if action == 'set_user':
            cur.execute(
                "UPDATE manager_commission_settings SET user_id = %s, "
                "  hold_days = %s, updated_at = now(), updated_by = %s "
                "WHERE id = (SELECT id FROM manager_commission_settings "
                "            ORDER BY id LIMIT 1)",
                (body.get('userId'), int(body.get('holdDays') or 15),
                 body.get('actorId')),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()
