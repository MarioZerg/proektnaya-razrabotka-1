import json
import os
import urllib.request
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
        "SELECT percent, hold_days, user_id, is_active, accrue_from, skip_loss_items "
        "FROM manager_commission_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return None
    return {
        'percent': float(r[0] or 0),
        # Ноль — законное значение: «подтверждать сразу». Через «or 15» он
        # превращался в 15 дней, и начисления упорно вставали в холд.
        'holdDays': int(r[1]) if r[1] is not None else 15,
        'userId': r[2],
        'isActive': bool(r[3]),
        # Отчёты раньше этой даты владелец сверяет и оплачивает сам:
        # в них перерасчёты площадки, которые автоматике не разобрать.
        'accrueFrom': r[4],
        'skipLossItems': bool(r[5]) if len(r) > 5 else True,
    }


# Себестоимость живёт в своей функции: там уже есть весь расчёт материалов,
# работы цеха и тарифов площадки. Считать его здесь во второй раз — значит
# гарантированно разойтись в цифрах при первой же правке.
PRODUCT_COST_URL = (
    'https://functions.poehali.dev/7e85cd3d-e5cd-44e2-a803-5ff07584de12'
)


def _loss_share(p_from, p_to):
    """Доля убыточных продаж за период — из расчёта себестоимости.

    Возвращает долю в ВЫРУЧКЕ (0..1) и количество вещей, проданных ниже
    затрат. На эту долю уменьшается база начисления: премировать за
    убыточную продажу не за что.

    Если расчёт недоступен, считаем, что убыточных нет: лучше начислить
    как раньше, чем срезать человеку выплату из-за сбоя связи.
    """
    try:
        url = f'{PRODUCT_COST_URL}?action=loss_share&from={p_from}&to={p_to}'
        req = urllib.request.Request(url, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read())
        return {
            'lossUnits': int(d.get('lossUnits') or 0),
            'share': float(d.get('share') or 0),
        }
    except Exception:
        return {'lossUnits': 0, 'share': 0.0}


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
        "SELECT id, period_start, period_end, transferred_amount, "
        "       withdrawn_amount, compensation_amount "
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
    for payout_id, p_from, p_to, transferred, withdrawn, compensation in rows:
        # Компенсации площадки — тоже выручка: возмещения за утерянный,
        # испорченный или бракованный товар и выкупы невозвратных позиций.
        # Деньги приходят на счёт, значит входят в базу вознаграждения.
        comp = float(compensation or 0)
        base = float(transferred or 0) + comp
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

        # Убыточные продажи из базы вычитаем: процент платится только с того,
        # что принесло доход. Долю берём по выручке, а не по штукам — дешёвая
        # позиция чаще уходит в минус, и по количеству её вес выглядит больше,
        # чем в деньгах.
        loss = _loss_share(p_from, p_to) if st.get('skipLossItems') else {
            'lossUnits': 0, 'share': 0.0,
        }
        # Долю убыточных считаем от ПРОДАЖ, без компенсаций: компенсация —
        # это возмещение за конкретный испорченный товар, к прибыльности
        # ассортимента она отношения не имеет. Применив долю ко всей базе,
        # мы бы срезали часть возмещения ни за что.
        loss_amount = round(float(transferred or 0) * loss['share'], 2)
        payable = round(base - loss_amount, 2)

        amount = round(payable * st['percent'] / 100.0, 2)
        per_unit = round(amount / units, 4) if units else None
        # Срок проверки. Ноль — подтверждаем сразу: возвраты площадка вычла
        # ещё в своём отчёте, и снимать их повторно нечего.
        hold_days = int(st['holdDays'] or 0)
        hold_until = p_to + timedelta(days=hold_days)

        # Деньги ещё на балансе площадки — начисление ждёт.
        #
        # Отчёт менеджер видит сразу: работа сделана, сумма посчитана. Но в
        # баланс «к выплате» она попадёт только когда деньги уйдут в банк
        # получателя — иначе мы обещаем то, чего у компании ещё нет.
        # Признак поступления: по неделе появился вывод с баланса площадки.
        # Поступлением считаем вывод, сопоставимый с суммой к переводу:
        # мелкие технические движения по балансу выплатой не являются.
        money_arrived = float(withdrawn or 0) >= base * 0.5
        if not money_arrived:
            status = 'pending'
        elif hold_days > 0:
            status = 'hold'
        else:
            status = 'confirmed'

        cur.execute(
            "INSERT INTO manager_accruals (user_id, payout_id, period_start, "
            "  period_end, units, base_amount, percent, amount, per_unit, "
            "  status, hold_until, confirmed_at, "
            "  loss_units, loss_amount, payable_base, compensation_amount) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
            "        CASE WHEN %s = 'confirmed' THEN now() END, %s, %s, %s, %s) "
            "ON CONFLICT (user_id, marketplace_code, period_start, period_end) "
            "DO NOTHING",
            (st['userId'], payout_id, p_from, p_to, units, base,
             st['percent'], amount, per_unit, status, hold_until, status,
             loss['lossUnits'], loss_amount, payable, comp),
        )
        created += 1

    return {'created': created}


def _release_pending(cur):
    """Переводит ожидающие начисления в работу, когда деньги дошли до счёта.

    Начисление создаётся сразу после отчёта, но висит в 'pending', пока сумма
    лежит на балансе площадки. Как только синхронизация увидела вывод денег
    на расчётный счёт — начисление становится обычным: либо сразу к выплате,
    либо на проверку, если срок холда задан.
    """
    cur.execute("SELECT hold_days FROM manager_commission_settings LIMIT 1")
    r = cur.fetchone()
    hold_days = int(r[0]) if r and r[0] is not None else 0

    cur.execute(
        "UPDATE manager_accruals a "
        "SET paid_out_at = coalesce(p.transferred_at, now()), "
        "    status = CASE WHEN %s > 0 THEN 'hold' ELSE 'confirmed' END, "
        "    hold_until = a.period_end + (%s || ' days')::interval, "
        "    confirmed_at = CASE WHEN %s = 0 THEN now() END "
        "FROM marketplace_payouts p "
        "WHERE p.marketplace_code = 'ozon' "
        "  AND p.period_start = a.period_start "
        "  AND p.period_end = a.period_end "
        "  AND a.status = 'pending' "
        "  AND coalesce(p.withdrawn_amount, 0) "
        "      >= coalesce(p.transferred_amount, 0) * 0.5 "
        "  AND coalesce(p.transferred_amount, 0) > 0",
        (hold_days, hold_days, hold_days),
    )
    return cur.rowcount


def _confirm(cur):
    """Подтверждает начисления, у которых срок проверки истёк.

    Нужна, только если холд включён обратно: при нулевом сроке начисление
    подтверждается сразу при создании и сюда не попадает.

    Возвраты здесь НЕ вычитаются: площадка уже уменьшила на них сумму
    к перечислению в своём отчёте, и снимать их повторно означало бы
    наказать менеджера дважды за один возврат.
    """
    cur.execute(
        "UPDATE manager_accruals "
        "SET status = 'confirmed', confirmed_at = now() "
        "WHERE status = 'hold' AND hold_until < now()::date"
    )
    return cur.rowcount


def _balance(cur, user_id):
    """Что менеджер видит в своих финансах."""
    cur.execute(
        # Берём начисленное как есть: возвраты уже сидят в сумме
        # к перечислению, из которой этот процент и посчитан.
        # Выплаченное в баланс не входит: деньги уже ушли в зарплату.
        "SELECT status, coalesce(sum(amount), 0), count(*) "
        "FROM manager_accruals WHERE user_id = %s AND paid_at IS NULL "
        "GROUP BY status",
        (int(user_id),),
    )
    by_status = {r[0]: {'amount': float(r[1] or 0), 'count': int(r[2])}
                 for r in cur.fetchall()}

    cur.execute(
        "SELECT id, period_start, period_end, units, base_amount, percent, "
        "  amount, per_unit, status, hold_until, returned_units, "
        "  returned_amount, cancel_reason, confirmed_at, "
        "  loss_units, loss_amount, payable_base, paid_out_at, "
        "  compensation_amount, paid_at "
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
            # К выплате за период. Равно начисленному: возвраты площадка
            # вычла ещё в сумме к перечислению, из которой мы взяли процент.
            # Вычитать их здесь ещё раз — значит удержать с менеджера дважды.
            'net': round(float(r[6] or 0), 2),
            # Убыточные продажи: сколько вещей ушло в минус и на какую сумму
            # уменьшена база. Показываем обе цифры — иначе непонятно, почему
            # процент взят не со всей суммы к перечислению.
            'lossUnits': int(r[14] or 0),
            'lossAmount': float(r[15] or 0),
            'payableBase': float(r[16]) if r[16] is not None else None,
            # Когда деньги за период дошли до расчётного счёта.
            'paidOutAt': str(r[17]) if r[17] else None,
            # Сколько в базе пришло компенсациями площадки.
            'compensation': float(r[18] or 0),
            # Передано в зарплату — повторно выплатить уже нельзя.
            'paidAt': str(r[19]) if r[19] else None,
        })

    st = _settings(cur)
    return {
        'percent': st['percent'] if st else 0,
        'holdDays': st['holdDays'] if st else 0,
        # С какой даты считает система: до неё отчёты сверяются вручную,
        # и человек должен понимать, почему в списке пусто.
        'accrueFrom': str(st['accrueFrom']) if st and st['accrueFrom'] else None,
        # К выплате: подтверждённое.
        'confirmed': round(by_status.get('confirmed', {}).get('amount', 0), 2),
        # В холде: ещё проверяется, может уменьшиться при возврате.
        'hold': round(by_status.get('hold', {}).get('amount', 0), 2),
        'cancelled': round(by_status.get('cancelled', {}).get('amount', 0), 2),
        # Посчитано, но деньги ещё на балансе площадки. В сумму к выплате
        # не входит: обещать то, чего компания не получила, нельзя.
        'pending': round(by_status.get('pending', {}).get('amount', 0), 2),
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
            released = _release_pending(cur)
            confirmed = _confirm(cur)
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
                        'confirmed': max(0, confirmed),
                    }, ensure_ascii=False),
                ),
            )
            conn.commit()
            return _resp(200, {
                'ok': True,
                'created': created.get('created', 0),
                'confirmed': max(0, confirmed),
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
            released = _release_pending(cur)
            confirmed = _confirm(cur)
            conn.commit()
            return _resp(200, {
                'ok': True, 'created': created.get('created', 0),
                'released': released, 'confirmed': confirmed,
            })

        if action == 'pay':
            # Выплата по конкретному отчёту.
            #
            # Вознаграждение уходит в зарплату обычным начислением: дальше оно
            # проходит через кассу тем же путём, что и оплата труда цеха.
            # Отдельного кошелька у менеджера нет — иначе деньги пришлось бы
            # сверять в двух местах.
            a_id = body.get('accrualId')
            if not a_id:
                return _resp(400, {'error': 'Укажите accrualId'})

            cur.execute(
                "SELECT user_id, amount, period_start, period_end, status, "
                "       paid_at "
                "FROM manager_accruals WHERE id = %s",
                (int(a_id),),
            )
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Начисление не найдено'})

            m_user, amount, p_from, p_to, status, paid_at = row
            if paid_at:
                return _resp(409, {'error': 'По этому отчёту уже выплачено'})
            if status != 'confirmed':
                return _resp(409, {
                    'error': 'Выплатить можно только подтверждённое начисление. '
                             'Сейчас оно ждёт поступления денег от площадки',
                })
            if float(amount or 0) <= 0:
                return _resp(409, {'error': 'Нечего выплачивать'})

            # Начисление в зарплате датируем последним днём отчётной недели —
            # тогда выплата за период находит его по тем же границам, что и
            # остальные начисления сотрудника.
            cur.execute(
                "INSERT INTO salary_accruals (user_id, type, amount, "
                "  description, accrued_for, created_by) "
                "VALUES (%s, 'manager_commission', %s, %s, %s, %s) "
                "RETURNING id",
                (int(m_user), float(amount),
                 f'Вознаграждение за отчёт {p_from} — {p_to}',
                 p_to, body.get('actorId')),
            )
            sal_id = cur.fetchone()[0]

            cur.execute(
                "UPDATE manager_accruals "
                "SET paid_at = now(), salary_accrual_id = %s WHERE id = %s",
                (sal_id, int(a_id)),
            )
            conn.commit()
            return _resp(200, {'ok': True, 'salaryAccrualId': sal_id,
                               'amount': float(amount)})

        if action == 'set_user':
            cur.execute(
                "UPDATE manager_commission_settings SET user_id = %s, "
                "  hold_days = %s, updated_at = now(), updated_by = %s "
                "WHERE id = (SELECT id FROM manager_commission_settings "
                "            ORDER BY id LIMIT 1)",
                (body.get('userId'),
                 int(body.get('holdDays')) if body.get('holdDays') is not None
                 else 0,
                 body.get('actorId')),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()
