import json
import os
import uuid
from datetime import datetime, timedelta

import boto3
import psycopg2

from report_pdf import build_weekly_report

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
        "SELECT percent, hold_days, user_id, is_active, accrue_from "
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
        # Отчёты раньше этой даты владелец сверяет и оплачивает сам:
        # в них перерасчёты площадки, которые автоматике не разобрать.
        'accrueFrom': r[4],
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
        "  AND period_start >= %s "
        "  AND NOT EXISTS ("
        "    SELECT 1 FROM manager_accruals a "
        "    WHERE a.user_id = %s AND a.period_start = marketplace_payouts.period_start "
        "      AND a.period_end = marketplace_payouts.period_end)",
        (st['accrueFrom'] or '2026-08-24', st['userId']),
    )
    rows = cur.fetchall()

    created = 0
    for payout_id, p_from, p_to, transferred in rows:
        base = float(transferred or 0)
        if base <= 0:
            continue

        # Сколько вещей закрыто этим периодом.
        #
        # Считаем по своим заказам: начиная с новой недели они в системе полные,
        # каждая вещь проходит через цех и склад. Раньше приходилось брать долю
        # от месячных данных площадки — за старые недели заказов в CRM просто
        # не было, и выходило «1 штука на 1,3 млн ₽».
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
            "  returned_amount = %s, "
            # Сумма изменилась — старый PDF ей уже противоречит. Сбрасываем
            # ссылку, документ пересоберётся с актуальными цифрами.
            "  report_url = NULL "
            "WHERE id = %s AND returned_amount IS DISTINCT FROM %s",
            (returned, back, a_id, back),
        )
        updated += max(0, cur.rowcount)

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
        "        THEN 'Все вещи периода вернули покупатели в течение холда' END, "
        # Статус в документе меняется с «на проверке» на «подтверждено»,
        # поэтому отчёт нужно выпустить заново.
        "    report_url = NULL "
        "WHERE status = 'hold' AND hold_until < now()::date"
    )
    return cur.rowcount


def _upload_pdf(binary, name):
    """Кладёт готовый отчёт в облако и возвращает ссылку."""
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'manager-reports/{name}-{uuid.uuid4().hex[:8]}.pdf'
    s3.put_object(Bucket='files', Key=key, Body=binary,
                  ContentType='application/pdf')
    return (f"https://cdn.poehali.dev/projects/"
            f"{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}")


def _build_reports(cur, only_id=None):
    """Формирует PDF по неделям, у которых его ещё нет.

    Пересобираем документ, если начисление изменилось после его выпуска:
    возврат мог уменьшить сумму, и старый файл начал бы противоречить экрану.
    """
    where = "a.report_url IS NULL"
    args = []
    if only_id:
        where = "a.id = %s"
        args = [int(only_id)]

    cur.execute(
        "SELECT a.id, a.period_start, a.period_end, a.units, a.base_amount, "
        "  a.percent, a.amount, a.per_unit, a.status, a.hold_until, "
        "  a.returned_units, a.returned_amount, a.cancel_reason, u.full_name "
        "FROM manager_accruals a "
        "JOIN users u ON u.id = a.user_id "
        f"WHERE {where} "
        "ORDER BY a.period_start DESC LIMIT 20",
        args,
    )
    rows = cur.fetchall()

    built = 0
    for r in rows:
        data = {
            'userName': r[13] or 'Менеджер',
            'periodStart': r[1],
            'periodEnd': r[2],
            'units': int(r[3] or 0),
            'baseAmount': float(r[4] or 0),
            'percent': float(r[5] or 0),
            'amount': float(r[6] or 0),
            'perUnit': float(r[7]) if r[7] is not None else None,
            'status': r[8],
            'holdUntil': r[9],
            'returnedUnits': int(r[10] or 0),
            'returnedAmount': float(r[11] or 0),
            'cancelReason': r[12],
            'net': round(float(r[6] or 0) - float(r[11] or 0), 2),
        }
        pdf = build_weekly_report(data)
        url = _upload_pdf(pdf, f"{r[1]}-{r[2]}")
        cur.execute(
            "UPDATE manager_accruals SET report_url = %s, "
            "  report_built_at = now() WHERE id = %s",
            (url, r[0]),
        )
        built += 1

    return built


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
        "  returned_amount, cancel_reason, confirmed_at, report_url "
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
            'reportUrl': r[14],
        })

    st = _settings(cur)
    return {
        'percent': st['percent'] if st else 0,
        'holdDays': st['holdDays'] if st else 15,
        # С какой даты считает система: до неё отчёты сверяются вручную,
        # и человек должен понимать, почему в списке пусто.
        'accrueFrom': str(st['accrueFrom']) if st and st['accrueFrom'] else None,
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

        # Планировщик ходит по ключу, а не от имени человека: холды должны
        # закрываться сами, без того чтобы кто-то каждый день нажимал кнопку.
        secret = os.environ.get('CRON_SECRET', '')
        by_cron = bool(body.get('cronSecret'))
        if by_cron:
            if not secret or body['cronSecret'] != secret:
                return _resp(403, {'error': 'Неверный ключ планировщика'})
        elif not _is_admin(cur, body.get('actorId')):
            return _resp(403, {'error': 'Доступно администратору'})

        if action == 'accrue':
            created = _accrue(cur)
            updated = _apply_returns(cur)
            confirmed = _confirm(cur)
            # Отчёты формируем сразу: менеджер должен увидеть документ вместе
            # с начислением, а не ждать отдельной кнопки.
            reports = _build_reports(cur)

            # Запись в журнал — по ней страница «Планировщик» понимает, что
            # задание живо. Без неё молчащий планировщик выглядел бы рабочим,
            # а начисления просто перестали бы появляться.
            cur.execute(
                "INSERT INTO audit_log (user_id, user_name, category, action, "
                "  entity_type, description, details) "
                "VALUES (%s, %s, 'finance', 'manager_accrue', "
                "        'manager_accrual', %s, %s)",
                (
                    None if by_cron else body.get('actorId'),
                    'Планировщик' if by_cron else None,
                    f"Начислено отчётов: {created.get('created', 0)}, "
                    f"закрыто холдов: {max(0, confirmed)}",
                    json.dumps({
                        'created': created.get('created', 0),
                        'returnsApplied': updated,
                        'confirmed': max(0, confirmed),
                    }, ensure_ascii=False),
                ),
            )
            conn.commit()
            return _resp(200, {
                'ok': True,
                'created': created.get('created', 0),
                'returnsApplied': updated,
                'confirmed': max(0, confirmed),
                'reports': reports,
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
