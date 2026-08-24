import json
import os
import urllib.request
from datetime import datetime

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
        "SELECT percent, user_id, is_active, accrue_from, skip_loss_items, "
        "       ym_withdraw_percent, ym_delay_weeks "
        "FROM manager_commission_settings ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return None
    return {
        'percent': float(r[0] or 0),
        'userId': r[1],
        'isActive': bool(r[2]),
        # Отчёты раньше этой даты владелец сверяет и оплачивает сам:
        # в них перерасчёты площадки, которые автоматике не разобрать.
        'accrueFrom': r[3],
        'skipLossItems': bool(r[4]) if len(r) > 4 else True,
        # Комиссия площадки за вывод денег: у Яндекса 1,6%.
        'ymWithdrawPercent': float(r[5] or 0) if len(r) > 5 else 1.6,
        'ymDelayWeeks': int(r[6] or 4) if len(r) > 6 else 4,
    }


# Себестоимость живёт в своей функции: там уже есть весь расчёт материалов,
# работы цеха и тарифов площадки. Считать его здесь во второй раз — значит
# гарантированно разойтись в цифрах при первой же правке.
PRODUCT_COST_URL = (
    'https://functions.poehali.dev/7e85cd3d-e5cd-44e2-a803-5ff07584de12'
)


def _loss_share(p_from, p_to, mp_code='ozon'):
    """Доля убыточных продаж за период — из расчёта себестоимости.

    Возвращает долю в ВЫРУЧКЕ (0..1) и количество вещей, проданных ниже
    затрат. На эту долю уменьшается база начисления: премировать за
    убыточную продажу не за что.

    Если расчёт недоступен, считаем, что убыточных нет: лучше начислить
    как раньше, чем срезать человеку выплату из-за сбоя связи.
    """
    try:
        url = (f'{PRODUCT_COST_URL}?action=loss_share'
               f'&from={p_from}&to={p_to}&marketplace={mp_code}')
        req = urllib.request.Request(url, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read())
        return {
            'lossUnits': int(d.get('lossUnits') or 0),
            'share': float(d.get('share') or 0),
            'avgMargin': d.get('avgMargin'),
            'details': d.get('details') or [],
        }
    except Exception:
        return {'lossUnits': 0, 'share': 0.0, 'avgMargin': None, 'details': []}


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

    # Берём отчёты ВСЕХ подключённых площадок, а не только OZON: менеджер
    # ведёт их одинаково, и правила начисления везде общие.
    cur.execute(
        "SELECT id, period_start, period_end, transferred_amount, "
        "       withdrawn_amount, compensation_amount, marketplace_code "
        "FROM marketplace_payouts "
        "WHERE transferred_amount > 0 "
        "  AND period_start >= %s "
        "  AND NOT EXISTS ("
        "    SELECT 1 FROM manager_accruals a "
        "    WHERE a.user_id = %s "
        "      AND a.marketplace_code = marketplace_payouts.marketplace_code "
        "      AND a.period_start = marketplace_payouts.period_start "
        "      AND a.period_end = marketplace_payouts.period_end) "
        "ORDER BY period_start",
        (st['accrueFrom'] or '2026-08-24', st['userId']),
    )
    rows = cur.fetchall()

    created = 0
    for (payout_id, p_from, p_to, transferred, withdrawn, compensation,
         mp_code) in rows:
        # Компенсации площадки — тоже выручка: возмещения за утерянный,
        # испорченный или бракованный товар и выкупы невозвратных позиций.
        # Деньги приходят на счёт, значит входят в базу вознаграждения.
        comp = float(compensation or 0)
        transferred = float(transferred or 0)

        # Комиссия площадки за перевод денег продавцу.
        #
        # У Яндекса это 1,6% от суммы вывода. Компания этих денег не получает,
        # поэтому вычитаем их ДО расчёта процента: иначе менеджеру платили бы
        # с суммы, которая до счёта не дошла.
        fee_pct = st['ymWithdrawPercent'] if mp_code == 'yandex_market' else 0.0
        withdraw_fee = round((transferred + comp) * fee_pct / 100.0, 2)

        base = round(transferred + comp - withdraw_fee, 2)
        if base <= 0:
            continue

        # Сколько вещей закрыто этим периодом.
        #
        # Считаем по своим заказам: начиная с новой недели они в системе полные,
        # каждая вещь проходит через цех и склад. Раньше приходилось брать долю
        # от месячных данных площадки — за старые недели заказов в CRM просто
        # не было, и выходило «1 штука на 1,3 млн ₽».
        # В заказах площадка записана своим именем — сопоставляем с кодом
        # отчёта, иначе по WB и Яндексу штуки считались бы нулями.
        mp_orders = {
            'ozon': 'OZON', 'wildberries': 'WB', 'yandex_market': 'Yandex',
        }.get(mp_code, mp_code.upper())
        cur.execute(
            "SELECT count(*) FROM orders "
            "WHERE marketplace = %s AND cancelled_at IS NULL "
            "  AND created_at::date >= %s AND created_at::date <= %s",
            (mp_orders, p_from, p_to),
        )
        units = int(cur.fetchone()[0] or 0)

        # Убыточные продажи из базы вычитаем: процент платится только с того,
        # что принесло доход. Долю берём по выручке, а не по штукам — дешёвая
        # позиция чаще уходит в минус, и по количеству её вес выглядит больше,
        # чем в деньгах.
        loss = _loss_share(p_from, p_to, mp_code) if st.get('skipLossItems') else {
            'lossUnits': 0, 'share': 0.0, 'avgMargin': None, 'details': [],
        }
        # Долю убыточных считаем от ПРОДАЖ, без компенсаций: компенсация —
        # это возмещение за конкретный испорченный товар, к прибыльности
        # ассортимента она отношения не имеет. Применив долю ко всей базе,
        # мы бы срезали часть возмещения ни за что.
        loss_amount = round(transferred * loss['share'], 2)
        payable = round(base - loss_amount, 2)

        amount = round(payable * st['percent'] / 100.0, 2)
        per_unit = round(amount / units, 4) if units else None

        # Срока проверки у вознаграждения нет.
        #
        # Раньше начисление держали 15 дней, чтобы успеть снять возвраты. Смысл
        # отпал: площадка вычитает возвраты сама, ещё в своём отчёте, и сумма к
        # перечислению приходит уже за их вычетом. Держать деньги второй раз —
        # значит наказывать менеджера за один возврат дважды.
        #
        # Единственное ожидание, которое осталось, — поступление денег от
        # площадки. Оно не срок, а факт: пришли деньги на счёт — можно платить.

        # Деньги ещё на балансе площадки — начисление ждёт.
        #
        # Отчёт менеджер видит сразу: работа сделана, сумма посчитана. Но в
        # баланс «к выплате» она попадёт только когда деньги уйдут в банк
        # получателя — иначе мы обещаем то, чего у компании ещё нет.
        # Признак поступления: по неделе появился вывод с баланса площадки.
        # Поступлением считаем вывод, сопоставимый с суммой к переводу:
        # мелкие технические движения по балансу выплатой не являются.
        money_arrived = float(withdrawn or 0) >= base * 0.5
        status = 'confirmed' if money_arrived else 'pending'

        cur.execute(
            "INSERT INTO manager_accruals (user_id, payout_id, period_start, "
            "  period_end, units, base_amount, percent, amount, per_unit, "
            # hold_until — историческое поле от 15-дневной проверки, которой
            # больше нет. Колонка обязательная, поэтому пишем в неё конец
            # отчётной недели: на расчёт это не влияет, а смысл сохраняется —
            # «начисление относится к этому периоду».
            "  status, hold_until, confirmed_at, "
            "  loss_units, loss_amount, payable_base, compensation_amount, "
            "  marketplace_code, withdraw_fee, avg_margin, loss_details) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
            "        CASE WHEN %s = 'confirmed' THEN now() END, "
            "        %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (user_id, marketplace_code, period_start, period_end) "
            "DO NOTHING",
            (st['userId'], payout_id, p_from, p_to, units, base,
             st['percent'], amount, per_unit, status, p_to, status,
             loss['lossUnits'], loss_amount, payable, comp,
             mp_code, withdraw_fee, loss.get('avgMargin'),
             json.dumps(loss.get('details') or [], ensure_ascii=False)),
        )
        created += 1

    return {'created': created}


def _release_pending(cur):
    """Переводит ожидающие начисления к выплате, когда деньги дошли до счёта.

    Начисление создаётся сразу после отчёта, но висит в 'pending', пока сумма
    лежит на балансе площадки. Как только синхронизация увидела вывод денег на
    расчётный счёт — вознаграждение сразу готово к выплате.

    Срока проверки больше нет: возвраты площадка вычитает сама, ещё в своём
    отчёте, и держать деньги второй раз незачем.
    """
    cur.execute(
        "UPDATE manager_accruals a "
        "SET paid_out_at = coalesce(p.transferred_at, now()), "
        "    status = 'confirmed', "
        "    confirmed_at = now() "
        "FROM marketplace_payouts p "
        "WHERE p.marketplace_code = 'ozon' "
        "  AND p.period_start = a.period_start "
        "  AND p.period_end = a.period_end "
        "  AND a.status = 'pending' "
        "  AND coalesce(p.withdrawn_amount, 0) "
        "      >= coalesce(p.transferred_amount, 0) * 0.5 "
        "  AND coalesce(p.transferred_amount, 0) > 0"
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
        "  amount, per_unit, status, returned_units, "
        "  returned_amount, cancel_reason, confirmed_at, "
        "  loss_units, loss_amount, payable_base, paid_out_at, "
        "  compensation_amount, paid_at, marketplace_code, withdraw_fee, "
        "  avg_margin, loss_details "
        "FROM manager_accruals WHERE user_id = %s "
        "ORDER BY period_start DESC LIMIT 40",
        (int(user_id),),
    )
    null_margin = None
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
            'returnedUnits': int(r[9] or 0),
            'returnedAmount': float(r[10] or 0),
            'cancelReason': r[11],
            'confirmedAt': str(r[12]) if r[12] else None,
            # К выплате за период. Равно начисленному: возвраты площадка
            # вычла ещё в сумме к перечислению, из которой мы взяли процент.
            # Вычитать их здесь ещё раз — значит удержать с менеджера дважды.
            'net': round(float(r[6] or 0), 2),
            # Убыточные продажи: сколько вещей ушло в минус и на какую сумму
            # уменьшена база. Показываем обе цифры — иначе непонятно, почему
            # процент взят не со всей суммы к перечислению.
            'lossUnits': int(r[13] or 0),
            'lossAmount': float(r[14] or 0),
            'payableBase': float(r[15]) if r[15] is not None else None,
            # Когда деньги за период дошли до расчётного счёта.
            'paidOutAt': str(r[16]) if r[16] else None,
            # Сколько в базе пришло компенсациями площадки.
            'compensation': float(r[17] or 0),
            # Передано в зарплату — повторно выплатить уже нельзя.
            'paidAt': str(r[18]) if r[18] else None,
            # По какой площадке начислено и сколько она удержала за вывод.
            'marketplace': r[19] or 'ozon',
            'withdrawFee': float(r[20] or 0),
            # Средняя маржа за период и разбор убыточных позиций: менеджеру
            # нужен не сухой вычет, а список, с которым можно работать.
            'avgMargin': float(r[21]) if r[21] is not None else null_margin,
            'lossDetails': r[22] or [],
        })

    st = _settings(cur)
    return {
        'percent': st['percent'] if st else 0,
        # С какой даты считает система: до неё отчёты сверяются вручную,
        # и человек должен понимать, почему в списке пусто.
        'accrueFrom': str(st['accrueFrom']) if st and st['accrueFrom'] else None,
        # К выплате: деньги от площадки пришли, вознаграждение готово.
        'confirmed': round(by_status.get('confirmed', {}).get('amount', 0), 2),
        'cancelled': round(by_status.get('cancelled', {}).get('amount', 0), 2),
        # Посчитано, но деньги ещё на балансе площадки. В сумму к выплате
        # не входит: обещать то, чего компания не получила, нельзя.
        'pending': round(by_status.get('pending', {}).get('amount', 0), 2),
        'items': items,
    }


UNIT_ECONOMICS_URL = (
    'https://functions.poehali.dev/4ebd72ad-8ca4-456c-840c-d2db30ce04cd')

# Статусы, означающие «покупатель забрал товар».
#
# У каждой площадки своё слово для одного и того же события. OZON пишет
# delivered, Яндекс — DELIVERED, а Wildberries отдельного признака выкупа не
# присылает вовсе: там «Отгружен» значит, что заказ уехал к покупателю.
BOUGHT_STATUSES = {
    'OZON': ('delivered',),
    'Yandex': ('DELIVERED',),
}


def _share(unit, key):
    """Какую долю цены занимает расход — чтобы пересчитать под любую цену.

    В юнит-экономике расходы посчитаны от своей цены. Продажа могла пройти
    дешевле: в акции, со скидкой площадки. Комиссия и налог при этом падают
    вместе с ценой, поэтому храним долю, а не рубли.
    """
    price = float(unit.get('price') or 0)
    if price <= 0:
        return 0.0
    return round(float(unit.get(key) or 0) / price, 6)


def _fact_pnl(cur, month=None):
    """Прибыль по ОФИЦИАЛЬНОМУ отчёту OZON, а не по нашему расчёту.

    Три источника давали три разные цифры, и ни одна не была правдой:

    Юнит-экономика считает по карточкам и даёт среднюю по ассортименту —
    245 рублей с вещи. Но размер, проданный девяносто раз, весит в этой
    средней столько же, сколько ни разу не проданный. Умножать её на
    количество продаж бессмысленно.

    Лента выкупов берёт цену из финансовых операций и раскладывает расходы
    по долям из юнит-экономики — то есть опять по тарифам, а не по факту.

    Отчёт о реализации — документ, по которому площадка платит. В нём по
    каждой позиции: сколько начислено, какая комиссия, сколько баллов
    компенсировано и что причитается продавцу. Спорить с ним нельзя.

    Себестоимость и налог добавляем свои: их площадка не знает.
    """
    cur.execute(
        "SELECT coalesce(max(period_month), CURRENT_DATE) FROM ozon_realization"
        + (" WHERE period_month = %s" if month else ""),
        (month,) if month else None)
    m = cur.fetchone()[0]

    cur.execute(
        "SELECT coalesce(sum(quantity), 0), coalesce(sum(amount), 0), "
        "       coalesce(sum(commission), 0), coalesce(sum(bonus), 0), "
        "       coalesce(sum(bank_coinvestment), 0), "
        "       coalesce(sum(total), 0) "
        "FROM ozon_realization WHERE period_month = %s", (m,))
    units, amount, commission, bonus, bank, total = [
        float(v or 0) for v in cur.fetchone()]
    units = int(units)
    if units <= 0:
        return None

    # Себестоимость: считаем по размерам из отчёта — так учитывается, что
    # продавалось на самом деле, а не «в среднем по каталогу».
    cur.execute(
        "SELECT r.material, r.width, r.height, sum(r.quantity) "
        "FROM ozon_realization r WHERE r.period_month = %s "
        "  AND r.material IS NOT NULL "
        "GROUP BY 1, 2, 3", (m,))
    sold_mix = cur.fetchall()
    margins = _margin_index()
    production = 0.0
    matched = 0
    for material, width, height, qty in sold_mix:
        mm = margins.get((material, width, height)) or {}
        cost = float(mm.get('production') or 0)
        if cost:
            production += cost * int(qty or 0)
            matched += int(qty or 0)
    # Размеры без себестоимости добираем по средней: иначе прибыль выйдет
    # завышенной ровно на их долю.
    if matched and units > matched:
        production += production / matched * (units - matched)

    # Услуги площадки и реклама за тот же месяц: в отчёт о реализации они
    # не входят, а деньги забирают.
    cur.execute(
        # Подписку Premium исключаем: она уже сидит в себестоимости
        # отдельной статьёй расходов владельца.
        "SELECT coalesce(sum(amount), 0) FROM marketplace_fees_monthly "
        "WHERE marketplace_code = 'ozon' AND month = %s "
        "  AND fee_name NOT ILIKE '%%Premium%%' "
        "  AND fee_name NOT ILIKE '%%подписк%%'", (m,))
    fees = float((cur.fetchone() or [0])[0] or 0)

    cur.execute(
        "SELECT coalesce(sum(ad_spend), 0) FROM marketplace_ad_spend "
        "WHERE marketplace_code = 'ozon' AND marketplace_item_id IS NULL")
    ad = float((cur.fetchone() or [0])[0] or 0)

    cur.execute(
        "SELECT tax_percent, vat_percent FROM unit_economics_settings "
        "ORDER BY id LIMIT 1")
    ts = cur.fetchone()
    tax_pct = float(ts[0] or 0) if ts else 0.0
    vat_pct = float(ts[1] or 0) if ts else 0.0

    # ОБОРОТ ПО ЧЕКАМ = amount + bonus + bank.
    #
    # amount в отчёте — это то, что осталось от цены ПОСЛЕ скидки по баллам,
    # а bonus — компенсация этой скидки от площадки. Покупатель заплатил
    # сумму целиком, просто часть баллами. Считать оборотом один amount
    # значит недосчитаться половины: по июлю это 10 млн вместо 20 млн, и
    # маржа выходила фантастические 35%.
    #
    # Проверено по отчёту: total = amount + bonus + bank − комиссия,
    # сходится до трёхсот рублей на четырёх тысячах строк.
    revenue = amount + bonus + bank

    # Налоги считаем от оборота — так же, как в юнит-экономике.
    vat = round(revenue * vat_pct / (100 + vat_pct), 2) if vat_pct else 0.0
    tax = round((revenue - vat) * tax_pct / 100, 2)

    profit = round(total - fees - ad - production - tax - vat, 2)

    return {
        'month': str(m),
        'units': units,
        # Оборот по чекам покупателей: с учётом оплаченного баллами.
        'revenue': round(revenue, 2),
        'commission': round(commission, 2),
        # БАЛЛЫ И СОФИНАНСИРОВАНИЕ — не расход, а поступление.
        #
        # Покупатель платит часть цены баллами Ozon, а площадка возмещает эту
        # часть продавцу: строки bonus и bank_coinvestment в отчёте идут со
        # знаком плюс. По июлю это 10,2 млн — половина оборота.
        #
        # Пока их не учитывали, оборот выходил вдвое меньше настоящего, и
        # любая маржа считалась от половины выручки.
        'bonus': round(bonus, 2),
        'bankCoinvestment': round(bank, 2),
        # Начислено деньгами, без баллов: для сверки с движением по счёту.
        'accrued': round(amount, 2),
        # Причитается по отчёту — до вычета услуг и рекламы.
        'realizationTotal': round(total, 2),
        'fees': round(fees, 2),
        'ad': round(ad, 2),
        'production': round(production, 2),
        'tax': tax,
        'vat': vat,
        'profit': profit,
        'perUnit': round(profit / units, 2),
        'margin': round(profit / revenue * 100, 2) if revenue else 0,
    }


def _bonus_in_period(cur, d_from, d_to):
    """Сколько покупатели заплатили баллами Ozon, а площадка возместила нам.

    Это не расход и не подарок: часть цены покупатель гасит баллами, а
    продавец получает эти деньги от площадки — строки bonus и
    bank_coinvestment в отчёте идут со знаком плюс.

    Показываем отдельно, потому что цифра огромная: по июлю 10,2 миллиона
    при обороте 20,2. Пока её не видно, непонятно, почему начисление
    деньгами вдвое меньше оборота по чекам.
    """
    cur.execute(
        "SELECT coalesce(sum(bonus), 0), coalesce(sum(bank_coinvestment), 0) "
        "FROM ozon_realization WHERE 1 = 1"
        + (f" AND period_month >= date_trunc('month', '{d_from}'::date)"
           if d_from else '')
        + (f" AND period_month <= date_trunc('month', '{d_to}'::date)"
           if d_to else ''))
    r = cur.fetchone() or (0, 0)
    return {'points': round(float(r[0] or 0), 2),
            'bank': round(float(r[1] or 0), 2)}


def _profit_at(m, price, fee_share=None):
    """Прибыль и маржа при ЦЕНЕ, ПО КОТОРОЙ ВЕЩЬ РЕАЛЬНО КУПИЛИ.

    Раньше прибыль считалась пропорцией: цена продажи умножалась на процент
    маржи из экономики. Это неверно, и ошибка была не в пользу правды.

    При падении цены комиссия, реклама и налог падают вместе с ней — они
    считаются процентом. А себестоимость, логистика и эквайринг остаются
    прежними: ткань и доставка стоят одинаково, за сколько бы вещь ни ушла.
    Значит прибыль падает БЫСТРЕЕ цены, а пропорция это скрывала.

    Товар, проданный со скидкой по акции, выглядел прибыльным, хотя на деле
    уходил в минус. Поэтому считаем по составляющим.
    """
    if not price or not m or m.get('margin') is None:
        return None, None
    shares = m.get('shares') or {}
    if fee_share is not None:
        # Комиссия по факту, а логистика и эквайринг отдельно НЕ вычитаются:
        # площадка удерживает их одной строкой вместе с комиссией.
        var_share = fee_share + sum(
            float(v or 0) for k, v in shares.items() if k != 'commission')
        fixed = float(m.get('production') or 0)
    else:
        var_share = sum(float(v or 0) for v in shares.values())
        fixed = float(m.get('production') or 0) + sum(
            float(v or 0) for v in (m.get('fixed') or {}).values())
    profit = round(price * (1 - var_share) - fixed, 2)
    return profit, round(profit / price * 100, 1)


def _margin_index():
    """Маржа по каждому размеру: {sku: {margin, profit, price}}.

    Берём из юнит-экономики, а не считаем заново: там уже учтены комиссия,
    логистика, реклама, налог, себестоимость и процент выкупа. Дублировать
    эту арифметику здесь — значит рано или поздно разойтись с основным
    расчётом и показывать в финансах одну маржу, а в экономике другую.
    """
    # Ключ — «ткань + ширина + высота», а не артикул.
    #
    # В юнит-экономике размеры лежат под нашим внутренним артикулом
    # (bambuk2_240), а в заказе хранится номер товара OZON (1579985239). Это
    # разные системы обозначений, и напрямую они не сходятся. Размер же
    # одинаков в обеих: по нему и связываем.
    out = {}
    for scheme in ('FBS', 'FBO'):
        try:
            req = urllib.request.Request(
                f'{UNIT_ECONOMICS_URL}?marketplace=ozon&scheme={scheme}')
            with urllib.request.urlopen(req, timeout=25) as r:
                data = json.loads(r.read().decode())
        except Exception:
            continue
        for row in (data or {}).get('rows', []):
            for h in (row.get('heights') or []):
                u = h.get('unit') or {}
                if u.get('price') and row.get('material'):
                    key = (row['material'], row.get('width'), h.get('height'))
                    # FBS считаем основным: по этой схеме шьём сами.
                    out.setdefault(key, {
                        'margin': u.get('margin'),
                        'profit': u.get('profit'),
                        'unitPrice': u.get('price'),
                        # Доли расходов от цены — чтобы разложить выручку по
                        # статьям при любой цене продажи. Хранить рубли нельзя:
                        # в акции вещь ушла дешевле, и суммы будут не те.
                        # ПЕРЕМЕННЫЕ — считаются процентом от цены и падают
                        # вместе с ней: комиссия, эквайринг, реклама, налоги.
                        'shares': {
                            'commission': _share(u, 'commission'),
                            'acquiring': _share(u, 'acquiring'),
                            'promo': _share(u, 'promo'),
                            'tax': _share(u, 'tax'),
                            'vat': _share(u, 'vat'),
                        },
                        # ПОСТОЯННЫЕ — рубли за вещь, от цены не зависят:
                        # доставка стоит одинаково, за сколько бы вещь ни
                        # ушла. На скидке они съедают прибыль быстрее всего.
                        'fixed': {
                            'logistics': float(u.get('logistics') or 0),
                            'storage': float(u.get('storage') or 0),
                            'returnCost': float(u.get('returnCost') or 0),
                            'acceptance': float(u.get('acceptance') or 0),
                        },
                        # Себестоимость в рублях: она от цены не зависит —
                        # ткань и работа стоят одинаково при любой скидке.
                        'production': float(u.get('productionCost') or 0),
                        # Цена карточки — чтобы показать СПП: скидку,
                        # которую площадка даёт покупателю за свой счёт.
                        # Цена карточки лежит на уровне размера, а не внутри
                        # расчёта единицы.
                        'cardPrice': float(h.get('cardPrice') or 0),
                    })
    return out


AD_SPEND_URL = (
    'https://functions.poehali.dev/29442dba-b5a9-4e15-b9ba-5fdc52eef574')


def _refresh_sales(months=1):
    """Просит выгрузку подтянуть свежие продажи с площадки.

    Отчёт обновляется планировщиком дважды в сутки, но при разборе «сколько
    мы заработали вчера» ждать полсуток незачем. Кнопка на странице запускает
    ту же цепочку вручную.

    Ответа не ждём: выгрузка идёт страницами несколько минут и продолжает
    себя сама. Наше дело — дать ей старт.
    """
    secret = os.environ.get('CRON_SECRET', '')
    if not secret:
        return False
    for m in range(max(1, min(4, months))):
        req = urllib.request.Request(
            AD_SPEND_URL,
            data=json.dumps({'action': 'sync_sales', 'page': 1,
                             'monthBack': m, 'cronSecret': secret}).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            urllib.request.urlopen(req, timeout=1)
        except Exception:
            # Обрыв по таймауту — норма: запрос принят, выгрузка работает.
            pass
    return True


def _ad_fact(cur, d_from=None, d_to=None, mp_code='ozon'):
    """Фактические траты на рекламу за период — из кабинета площадки.

    Раньше реклама считалась долей от цены по нормативу из юнит-экономики.
    Норматив — это план, а тратим мы по факту: в июле план дал 2 258 327 ₽,
    а кабинет показал 2 292 239 ₽. Разница небольшая, но она каждый месяц
    своя, и прибыль от неё гуляет.

    Берём то, что реально списано. Расход общий на весь оборот — по вещам
    он не разложен, поэтому в разбор идёт одной суммой.
    """
    where = f"WHERE marketplace_code = '{mp_code}'"
    if d_from:
        where += f" AND month >= date_trunc('month', '{d_from}'::date)"
    if d_to:
        where += f" AND month <= date_trunc('month', '{d_to}'::date)"
    cur.execute(
        f"SELECT coalesce(sum(ad_spend), 0) FROM marketplace_ad_monthly {where}")
    return float((cur.fetchone() or [0])[0] or 0)


def _fee_shares(cur, d_from=None, d_to=None):
    """Доля удержания площадки ПО ВЕЩИ И СХЕМЕ + средние по каждой схеме.

    Тут две ошибки, которые долго прятались одна за другой.

    Сначала на все товары шла ОДНА средняя доля по всей таблице реализации.
    Она не менялась ни от месяца, ни от схемы: на экране всегда стояли одни
    и те же 43.6%.

    Потом выяснилось главное: ставка зависит не от товара, а от СХЕМЫ. Один
    и тот же размер «Бамбук 200×240» встречается в отчёте и с 42%, и с 46%,
    и с 48% — со склада площадки (FBO) удержание 42%, со своего склада (FBS)
    46-48%. Разница в пять процентных пунктов: со своего склада мы платим
    площадке заметно больше, потому что доставку она делает сама.

    Схемы в отчёте о реализации нет, но ставка её и определяет: 42% — FBO,
    46% и 48% — FBS. Сверка по количеству это подтвердила: 11597 вещей с
    42% против 11767 проданных по FBO, 5434 с 46-48% против 5470 по FBS.

    Поэтому доля считается отдельно по каждой связке «размер + схема», а
    средняя — своя для FBO и своя для FBS: подставлять общую нельзя, она
    занизит удержание для FBS и завысит для FBO.
    """
    where = "WHERE commission IS NOT NULL"
    if d_from:
        where += (" AND period_month >= date_trunc('month', "
                  f"'{d_from}'::date)")
    if d_to:
        where += (" AND period_month <= date_trunc('month', "
                  f"'{d_to}'::date)")
    # Схему определяем по самой ставке: в отчёте о реализации её нет, а
    # тарифы площадки для FBO и FBS различаются — этим и пользуемся.
    cur.execute(
        "SELECT material, width, height, "
        "       CASE WHEN commission_ratio <= 0.44 THEN 'FBO' ELSE 'FBS' END, "
        "       sum(commission), sum(amount + bonus + bank_coinvestment) "
        f"FROM ozon_realization {where} "
        "GROUP BY 1, 2, 3, 4")
    by_item = {}
    tot = {'FBO': [0.0, 0.0], 'FBS': [0.0, 0.0]}
    for material, width, height, sch, comm, base in cur.fetchall():
        c = float(comm or 0)
        b = float(base or 0)
        if sch in tot:
            tot[sch][0] += c
            tot[sch][1] += b
        if b > 0:
            by_item[(material, width, height, sch)] = c / b
    avg_by_scheme = {
        k: (v[0] / v[1]) if v[1] > 0 else None for k, v in tot.items()}
    all_comm = sum(v[0] for v in tot.values())
    all_base = sum(v[1] for v in tot.values())
    avg_all = all_comm / all_base if all_base > 0 else None
    return by_item, avg_by_scheme, avg_all


def _bought_feed(cur, page=1, per_page=10, date_from=None, date_to=None,
                 marketplace=None, scheme=None):
    """Лента выкупов: что покупатели забрали, почём и сколько мы заработали.

    Источник — отчёт площадки, а не заказы цеха. Это принципиально: заказы
    показывают только схему FBS, то есть вещи, которые мы шьём и отправляем
    сами. А FBO-продажи (со склада площадки, куда товар отвозится партиями)
    в заказы не попадают вовсе — там торгует сама площадка.

    За месяц по данным OZON выкуплено под семь тысяч вещей, и почти половина
    из них — FBO. Пока лента строилась по заказам, эта половина выручки была
    не видна, а цифра расходилась с отчётом по себестоимости вдвое.

    Возвраты в ленту не берём: вещь приехала обратно, деньги вернулись
    покупателю — продажи не было.
    """
    page = max(1, int(page or 1))
    per_page = min(50, max(1, int(per_page or 10)))

    def _clean_date(v):
        v = (v or '').strip()[:10]
        return v if len(v) == 10 and v[4] == '-' and v[7] == '-' else None

    d_from = _clean_date(date_from)
    d_to = _clean_date(date_to)

    where = "WHERE NOT s.is_return AND s.sale_price > 0"
    if d_from:
        where += f" AND s.sold_at >= '{d_from}'::date"
    if d_to:
        # Верхняя граница включительно: выбрав «по 21 августа», человек ждёт,
        # что продажи этого дня войдут в отчёт.
        where += f" AND s.sold_at < '{d_to}'::date + interval '1 day'"

    # Площадка и схема: смотреть можно и общую картину, и любой срез.
    mp = (marketplace or '').strip().lower()
    if mp in ('ozon', 'wildberries', 'yandex_market'):
        where += f" AND s.marketplace_code = '{mp}'"
    sch = (scheme or '').strip().upper()
    # Отбор БЕЗ схемы — по нему считаем сравнение FBO и FBS. Оно должно быть
    # на экране всегда: выбрав FBS, человек как раз и хочет видеть, насколько
    # он хуже FBO, а не терять вторую цифру из виду.
    where_all_schemes = where
    if sch in ('FBO', 'FBS'):
        where += f" AND s.scheme = '{sch}'"

    # Считаем ВЕЩИ, а не строки: две одинаковые шторы одним заказом лежат
    # в одной строке с количеством два.
    cur.execute(
        f"SELECT COALESCE(sum(s.quantity), 0) FROM marketplace_sales s {where}")
    total = int(cur.fetchone()[0] or 0)

    cur.execute(
        "SELECT s.id, s.posting_number, s.marketplace_code, s.scheme, "
        "       s.material, s.width, s.height, s.quantity, s.sold_at, "
        "       s.sku, s.sale_price, s.product_name "
        f"FROM marketplace_sales s {where} "
        # Свежие продажи сверху: лента читается сверху вниз.
        "ORDER BY s.sold_at DESC, s.id DESC "
        f"LIMIT {per_page} OFFSET {(page - 1) * per_page}"
    )
    rows = cur.fetchall()
    margins = _margin_index()

    # Фактическая доля удержания площадки — из отчёта о реализации. Нужна и
    # строкам ленты, и итогам: считать по-разному нельзя.
    #
    # Берём долю ПО КАЖДОЙ ВЕЩИ и только за выбранный период: у площадки
    # разные ставки на разные товары, и одна средняя на всех искажала прибыль
    # каждой строки.
    fee_by_item, fee_avg_scheme, fact_fee_share = _fee_shares(cur, d_from, d_to)

    def _fee_for(material, width, height, sch):
        """Ставка удержания для вещи с учётом СХЕМЫ продажи.

        Порядок отступления: точная ставка этого размера по этой схеме →
        средняя по схеме → общая средняя. Схему не теряем ни на одном шаге:
        у FBO и FBS удержание различается на пять пунктов, и подстановка
        общей средней сама по себе даёт ошибку в прибыли.
        """
        sch = sch if sch in ('FBO', 'FBS') else None
        if sch:
            v = fee_by_item.get((material, width, height, sch))
            if v is not None:
                return v
            v = fee_avg_scheme.get(sch)
            if v is not None:
                return v
        return fact_fee_share

    items = []
    for r in rows:
        price = float(r[10] or 0)
        m = margins.get((r[4], r[5], r[6])) or {}
        profit, margin = _profit_at(
            m, price, _fee_for(r[4], r[5], r[6], r[3]))
        items.append({
            'id': r[0],
            'orderNumber': r[1],
            'marketplace': r[2],
            'scheme': r[3],
            'material': r[4] or (r[11] or '')[:40] or None,
            'width': r[5],
            'height': r[6],
            'quantity': float(r[7] or 1),
            'soldAt': r[8].isoformat() if r[8] else None,
            'sku': r[9],
            'price': round(price, 2),
            'margin': margin,
            'profit': profit,
            # Цена на витрине и СПП — скидка Озон Картой. Покупатель видит
            # одну цену, платит меньше, а разницу площадка возмещает нам.
            # Без этой строки непонятно, почему начислено меньше карточки.
            'cardPrice': round(m.get('cardPrice') or 0, 2) or None,
        })

    # ИТОГ ЗА ПЕРИОД — по всему отбору, а не по видимой странице.
    cur.execute(
        "SELECT s.material, s.width, s.height, s.sale_price, s.quantity, "
        "       s.scheme "
        f"FROM marketplace_sales s {where}"
    )
    revenue = 0.0
    profit_sum = 0.0
    # КУДА УХОДИТ ВЫРУЧКА.
    #
    # «Заработали 2,5 млн с оборота 72 млн» — цифра без объяснения. Показываем
    # разбор: сколько забрала площадка, сколько стоило производство, сколько
    # ушло государству. Тогда видно, на что можно повлиять.
    # ЛОГИСТИКУ, ЭКВАЙРИНГ И ВОЗВРАТЫ ОТДЕЛЬНО НЕ СЧИТАЕМ.
    #
    # OZON удерживает всё это ОДНОЙ строкой — standard_fee, те самые 44% от
    # цены. Туда уже входят и доставка, и обработка возвратов, и приём
    # платежа: чистая комиссия за продажу в категории «Шторы» около 20%,
    # остальное — услуги.
    #
    # Юнит-экономика расписывает их по отдельности, потому что считает по
    # тарифам. Если сложить и то и другое, расходы задвоятся: по июлю это
    # два миллиона лишних вычетов, и прибыль падала с 2,3 млн до 295 тысяч.
    parts = {'commission': 0.0, 'promo': 0.0,
             'tax': 0.0, 'vat': 0.0, 'production': 0.0, 'fees': 0.0,
             # Себестоимость вернувшихся вещей: труд и материал потрачены,
             # а денег за них не будет.
             'returns': 0.0,
             # Приём платежа. Вычитался из прибыли, но в разборе его не было —
             # выручка не сходилась со статьями на 227 тысяч по июлю.
             'acquiring': 0.0}
    known = 0.0
    # Средний процент удержания для шапки считаем ПО ЭТОМУ ЖЕ ОТБОРУ, а не по
    # всей таблице: выбрав май или схему FBS, человек ждёт процент по маю и по
    # FBS. Раньше там всегда стояла одна общая цифра.
    fee_rev = 0.0
    fee_amt = 0.0
    # Реклама по нормативу — сколько её заложено в уже посчитанную прибыль.
    # Ниже вычтем норматив и подставим факт из кабинета площадки.
    promo_plan = 0.0
    # ТО ЖЕ САМОЕ, НО ОТДЕЛЬНО ПО КАЖДОЙ СХЕМЕ.
    #
    # FBO и FBS — это два разных бизнеса под одной вывеской. Со склада
    # площадки удержание 42%, со своего 47% — и маржа отличается почти вдвое.
    # Общая цифра усредняет их в одну и прячет главное: где мы зарабатываем,
    # а где работаем почти в ноль.
    by_scheme = {}

    def _slot(name):
        return by_scheme.setdefault(name, {
            'revenue': 0.0, 'profit': 0.0, 'known': 0.0,
            'feeRev': 0.0, 'feeAmt': 0.0, 'qty': 0, 'promoPlan': 0.0,
        })

    for material, width, height, price, qty, sch in cur.fetchall():
        n = int(qty or 1)
        pr = float(price or 0) * n
        if not pr:
            continue
        revenue += pr
        sl = _slot(sch if sch in ('FBO', 'FBS') else 'Прочее')
        sl['revenue'] += pr
        sl['qty'] += n
        mm = margins.get((material, width, height)) or {}
        if mm.get('margin') is None:
            continue
        # Прибыль по составляющим, а не пропорцией: постоянные расходы от
        # цены не зависят, и на скидке они съедают больше, чем кажется.
        item_fee = _fee_for(material, width, height, sch)
        unit_profit, _ = _profit_at(mm, float(price or 0), item_fee)
        if unit_profit is None:
            continue
        profit_sum += unit_profit * n
        known += pr
        sl['profit'] += unit_profit * n
        sl['known'] += pr
        # Расходы от цены пересчитываем по долям, себестоимость берём
        # в рублях: ткань и работа стоят одинаково при любой скидке.
        # Переменные считаем от фактической цены, постоянные берём рублями:
        # так разбор сходится с прибылью до копейки.
        # Рекламу здесь НЕ считаем: норматив из юнит-экономики — это план,
        # а ниже подставляется факт из кабинета площадки.
        for k, share in (mm.get('shares') or {}).items():
            if k in parts and k not in ('commission', 'promo'):
                parts[k] += pr * float(share)
        # Плановая реклама — её ниже заменим фактом из кабинета. Копим, чтобы
        # знать, сколько норматива уже сидит внутри посчитанной прибыли.
        promo_plan_item = pr * float((mm.get('shares') or {}).get('promo') or 0)
        promo_plan += promo_plan_item
        sl['promoPlan'] += promo_plan_item
        # Комиссию берём по факту: тарифная занижена, в удержание площадки
        # входит больше, чем один процент за продажу.
        parts['commission'] += pr * (
            item_fee if item_fee is not None
            else float((mm.get('shares') or {}).get('commission') or 0))
        # Выручка, по которой удержание известно по факту, — из неё считаем
        # средний процент для шапки. Иначе он снова стал бы «средним по всему».
        if item_fee is not None:
            fee_rev += pr
            fee_amt += pr * item_fee
            sl['feeRev'] += pr
            sl['feeAmt'] += pr * item_fee
        parts['production'] += float(mm.get('production') or 0) * n

    # Срезы по площадкам и схемам — для переключателей в шапке.
    cur.execute(
        "SELECT s.marketplace_code, s.scheme, sum(s.quantity) "
        "FROM marketplace_sales s "
        "WHERE NOT s.is_return AND s.sale_price > 0 "
        + (f" AND s.sold_at >= '{d_from}'::date" if d_from else '')
        + (f" AND s.sold_at < '{d_to}'::date + interval '1 day'"
           if d_to else '')
        + " GROUP BY 1, 2"
    )
    breakdown = [{'marketplace': a, 'scheme': b, 'count': int(c)}
                 for a, b, c in cur.fetchall()]

    # УСЛУГИ ПЛОЩАДКИ СВЕРХ КОМИССИИ.
    #
    # Подписка Premium Plus, отгрузка в нерекомендованный слот, страхование,
    # упаковка партнёрами, бейдж «Оригинал». В отчёт о реализации они не
    # входят и в тарифы юнит-экономики тоже: это отдельные списания, которые
    # площадка делает раз в месяц. По июлю — 422 тысячи.
    #
    # Раскладываем их на выручку периода: расход общий, а не по товарам.
    # ПОДПИСКУ PREMIUM ИСКЛЮЧАЕМ — она уже в себестоимости.
    #
    # Владелец завёл её отдельной статьёй расходов: 50 000 ₽ в месяц
    # раскладываются на все проданные вещи и входят в себестоимость каждой.
    # А площадка списывает ту же подписку строкой «Premium Plus» в отчёте об
    # удержаниях — 24 990 ₽ в месяц.
    #
    # Считать оба раза значит вычесть подписку дважды. Оставляем ту, что в
    # себестоимости: там она разложена по вещам и видна владельцу.
    cur.execute(
        "SELECT coalesce(sum(f.amount), 0) "
        "FROM marketplace_fees_monthly f "
        "WHERE f.marketplace_code = 'ozon' "
        "  AND f.fee_name NOT ILIKE '%Premium%' "
        "  AND f.fee_name NOT ILIKE '%подписк%'"
        + (f" AND f.month >= date_trunc('month', '{d_from}'::date)"
           if d_from else '')
        + (f" AND f.month <= date_trunc('month', '{d_to}'::date)"
           if d_to else ''))
    fees_total = round(float((cur.fetchone() or [0])[0] or 0), 2)

    # БАЛЛЫ — НЕ ДОХОД И НЕ СКИДКА, А СПОСОБ ОПЛАТЫ.
    #
    # Разбор строки отчёта расставил всё по местам. Вуаль 200×240:
    #   цена продавца      2050 ₽
    #   деньгами           1169 ₽
    #   баллами             869 ₽
    #   вознаграждение 42%  861 ₽ — берётся от ПОЛНОЙ цены 2050
    #   к выплате          1189 ₽ = 2050 − 861
    #
    # То есть покупатель платит одну и ту же цену, просто часть баллами.
    # Выручка — вся цена целиком, и она уже посчитана: цена в ленте выкупов
    # и есть эта сумма.
    #
    # Поэтому баллы НЕ добавляются к прибыли и НЕ гасят наши расходы: они
    # внутри цены, а вознаграждение площадки уже вычтено из неё. Считать их
    # ещё и зачётом услуг — задваивать одни и те же деньги.
    #
    # Услуги площадки платятся живыми деньгами и вычитаются полностью.
    bonus_info = _bonus_in_period(cur, d_from, d_to)

    # РЕКЛАМА — ПО ФАКТУ ИЗ КАБИНЕТА, А НЕ ПО НОРМАТИВУ.
    #
    # Норматив из юнит-экономики — это план на вещь. Тратим мы по факту, и
    # каждый месяц по-своему: в июле план дал 2 258 327 ₽, кабинет — 2 292 239.
    # Убираем норматив из прибыли и ставим вместо него живые деньги.
    ad_all = _ad_fact(cur, d_from, d_to)
    ad_share = ad_all
    if sch in ('FBO', 'FBS') and ad_all:
        cur.execute(
            "SELECT coalesce(sum(s.sale_price * s.quantity), 0) "
            f"FROM marketplace_sales s {where_all_schemes}")
        rev_all_sch = float((cur.fetchone() or [0])[0] or 0)
        ad_share = ad_all * (revenue / rev_all_sch) if rev_all_sch > 0 else 0.0
    parts['promo'] = round(ad_share, 2)
    profit_sum += promo_plan - ad_share
    for sl in by_scheme.values():
        sl['profit'] += sl['promoPlan']
    if ad_all and revenue > 0 and sch not in ('FBO', 'FBS'):
        for sl in by_scheme.values():
            sl['profit'] -= ad_all * (sl['revenue'] / revenue)

    # ВОЗВРАТЫ — ГЛАВНАЯ ПОТЕРЯ, КОТОРОЙ В РАСЧЁТЕ НЕ БЫЛО.
    #
    # Вещь уехала к покупателю и вернулась: деньги ему возвращены, продажи не
    # было. Но ткань раскроена, швея отшила, упаковщица собрала — эти рубли
    # потрачены и назад не придут. Вернувшийся товар едет на склад и чаще
    # всего продаётся снова, но труд и материал первого круга уже потеряны.
    #
    # В июле вернулось 529 вещей из 7213 — это 7.3% и примерно 300 тысяч
    # себестоимости, которых в прибыли не хватало.
    ret_where = where.replace('NOT s.is_return', 's.is_return')
    cur.execute(
        "SELECT s.material, s.width, s.height, sum(s.quantity) "
        f"FROM marketplace_sales s {ret_where} "
        "GROUP BY 1, 2, 3")
    returns_cost = 0.0
    returns_qty = 0
    for material, width, height, qty in cur.fetchall():
        n = int(qty or 0)
        mm = margins.get((material, width, height)) or {}
        returns_qty += n
        returns_cost += float(mm.get('production') or 0) * n
    parts['returns'] = round(returns_cost, 2)
    profit_sum -= returns_cost
    # Потери на возвратах — тоже по схемам: у FBS их больше, и прибыль там
    # без этого выглядела бы лучше, чем есть.
    if returns_cost and revenue > 0 and sch not in ('FBO', 'FBS'):
        for sl in by_scheme.values():
            sl['profit'] -= returns_cost * (sl['revenue'] / revenue)

    # УСЛУГИ ПЛОЩАДКИ — РАСХОД НА ВЕСЬ ОБОРОТ, А НЕ НА ВЫБРАННУЮ СХЕМУ.
    #
    # Подписка, слоты, страхование приходят одной суммой за месяц по всему
    # кабинету. Выбрав FBO, нельзя вычесть их целиком из него: FBO-продажи
    # тогда платят и за себя, и за FBS, а прибыль среза занижается.
    #
    # Берём долю по выручке: сколько этот срез весит в обороте — столько
    # услуг на него и приходится.
    if sch in ('FBO', 'FBS') and fees_total:
        cur.execute(
            "SELECT coalesce(sum(s.sale_price * s.quantity), 0) "
            f"FROM marketplace_sales s {where_all_schemes}")
        total_rev_all = float((cur.fetchone() or [0])[0] or 0)
        fees_share = (fees_total * (revenue / total_rev_all)
                      if total_rev_all > 0 else 0.0)
    else:
        fees_share = fees_total
    parts['fees'] = round(fees_share, 2)
    profit_sum -= fees_share

    # Услуги площадки — общий расход на всё, отдельной схемы у них нет.
    # Раскладываем по выручке: иначе прибыль FBS оказалась бы завышена, а
    # сумма двух схем не сошлась бы с общим итогом.
    if fees_total and revenue > 0 and sch not in ('FBO', 'FBS'):
        for sl in by_scheme.values():
            sl['profit'] -= fees_total * (sl['revenue'] / revenue)

    # СРАВНЕНИЕ СХЕМ — по отбору БЕЗ схемы, но с тем же периодом и площадкой.
    #
    # Когда выбран конкретный срез, цикл выше посчитал только его. Чтобы обе
    # схемы всё равно стояли рядом, проходим продажи ещё раз без этого условия.
    if sch in ('FBO', 'FBS'):
        by_scheme = {}
        cur.execute(
            "SELECT s.material, s.width, s.height, s.sale_price, s.quantity, "
            "       s.scheme "
            f"FROM marketplace_sales s {where_all_schemes}")
        all_rev = 0.0
        for material, width, height, price, qty, s_sch in cur.fetchall():
            n = int(qty or 1)
            pr = float(price or 0) * n
            if not pr:
                continue
            all_rev += pr
            sl = _slot(s_sch if s_sch in ('FBO', 'FBS') else 'Прочее')
            sl['revenue'] += pr
            sl['qty'] += n
            mm = margins.get((material, width, height)) or {}
            if mm.get('margin') is None:
                continue
            item_fee = _fee_for(material, width, height, s_sch)
            unit_profit, _ = _profit_at(mm, float(price or 0), item_fee)
            if unit_profit is None:
                continue
            sl['profit'] += unit_profit * n
            sl['known'] += pr
            # Плановая реклама сидит внутри unit_profit — возвращаем её, ниже
            # вместо неё вычтем факт из кабинета.
            sl['profit'] += pr * float((mm.get('shares') or {}).get('promo') or 0)
            if item_fee is not None:
                sl['feeRev'] += pr
                sl['feeAmt'] += pr * item_fee
        # Себестоимость возвратов по схемам — за тот же период, но без
        # ограничения по схеме: сравнение должно быть полным.
        ret_all_where = where_all_schemes.replace(
            'NOT s.is_return', 's.is_return')
        cur.execute(
            "SELECT s.material, s.width, s.height, s.scheme, sum(s.quantity) "
            f"FROM marketplace_sales s {ret_all_where} "
            "GROUP BY 1, 2, 3, 4")
        for material, width, height, s_sch, qty in cur.fetchall():
            mm = margins.get((material, width, height)) or {}
            sl = by_scheme.get(s_sch if s_sch in ('FBO', 'FBS') else 'Прочее')
            if sl:
                sl['profit'] -= float(mm.get('production') or 0) * int(qty or 0)
        if all_rev > 0:
            for sl in by_scheme.values():
                part = sl['revenue'] / all_rev
                sl['profit'] -= fees_total * part
                sl['profit'] -= ad_all * part

    schemes = []
    for name, v in sorted(by_scheme.items(), key=lambda x: -x[1]['revenue']):
        schemes.append({
            'scheme': name,
            'quantity': v['qty'],
            'revenue': round(v['revenue'], 2),
            'profit': round(v['profit'], 2),
            'margin': (round(v['profit'] / v['revenue'] * 100, 1)
                       if v['revenue'] else 0),
            # Удержание площадки по этой схеме — та самая цифра, ради которой
            # схемы и разделили: 42% против 47%.
            'feeShare': (round(v['feeAmt'] / v['feeRev'] * 100, 1)
                         if v['feeRev'] > 0 else None),
        })

    return {
        'items': items,
        'page': page,
        'perPage': per_page,
        'total': total,
        'pages': max(1, (total + per_page - 1) // per_page),
        'totals': {
            'revenue': round(revenue, 2),
            'profit': round(profit_sum, 2),
            'margin': round(profit_sum / revenue * 100, 1) if revenue else 0,
            # Выручка, по которой удалось разложить расходы. Если размера нет
            # в юнит-экономике, его продажа в разбор не попадает — показываем
            # это честно, а не подмешиваем нули.
            'knownRevenue': round(known, 2),
            'breakdown': {k: round(v, 2) for k, v in parts.items()},
            # Фактическая доля удержания площадки — из отчёта о реализации,
            # взвешенная по выручке ЭТОГО отбора: процент меняется вместе с
            # выбранным месяцем, площадкой и схемой.
            'feeShare': round(
                (fee_amt / fee_rev * 100) if fee_rev > 0
                else (fact_fee_share or 0) * 100, 1),
            # ИТОГИ ПО КАЖДОЙ СХЕМЕ — считаются всегда, даже когда выбран
            # один срез: сравнивать FBO и FBS нужно рядом, а не переключаясь
            # между вкладками и запоминая цифры.
            'schemes': schemes,
            # БАЛЛЫ ПЛОЩАДКИ за период: часть цены покупатель платит баллами,
            # а площадка возмещает эту часть продавцу. Половина оборота.
            'bonus': bonus_info,
        },
        'breakdown': breakdown,
    }


def handler(event: dict, context) -> dict:
    """Финансы менеджера маркетплейсов: начисления с холдом и баланс.

    GET  /?action=bought_feed&page=1 — лента выкупленных заказов: цена
         покупки и маржа по каждому.

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

            if action == 'fact_pnl':
                # Прибыль по официальному отчёту площадки.
                return _resp(200, _fact_pnl(cur, params.get('month')) or {})

            if action == 'bought_feed':
                # Лента выкупленных заказов: доступна любому, кто видит
                # финансы, — отдельных прав тут не нужно.
                return _resp(200, _bought_feed(
                    cur, params.get('page'), params.get('perPage'),
                    params.get('dateFrom'), params.get('dateTo'),
                    params.get('marketplace'), params.get('scheme')))

            if action != 'balance':
                return _resp(400, {'error': 'Неизвестное действие'})
            if not user_id:
                return _resp(400, {'error': 'Укажите userId'})

            return _resp(200, _balance(cur, user_id))

        if method != 'POST':
            return _resp(405, {'error': 'Method not allowed'})

        body = json.loads(event.get('body') or '{}')
        action = body.get('action')

        if action == 'refresh_sales':
            # Обновить продажи прямо сейчас, не дожидаясь планировщика.
            return _resp(200, {
                'started': _refresh_sales(int(body.get('months') or 1))})

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
                    f"дождались денег: {max(0, released)}",
                    json.dumps({
                        'created': created.get('created', 0),
                        'released': max(0, released),
                    }, ensure_ascii=False),
                ),
            )
            conn.commit()
            return _resp(200, {
                'ok': True,
                'created': created.get('created', 0),
                # Сколько начислений дождались денег от площадки.
                'released': max(0, released),
            })

        if action == 'recalc':
            # Пересчёт незакрытых начислений.
            #
            # ВЫПЛАЧЕННОЕ НЕ ТРОГАЕМ. Отчёт закрыт по тем ценам и той
            # себестоимости, что действовали в ту неделю. Если позже мы опустим
            # цены и товар станет убыточным, это уже другой период работы —
            # удерживать деньги задним числом нельзя.
            #
            # Пересчитываем только то, что ещё не ушло в зарплату: там ставка
            # или способ подсчёта штук могли поменяться.
            st = _settings(cur)
            if not st or not st['userId']:
                return _resp(400, {'error': 'Не задан сотрудник'})
            cur.execute(
                "DELETE FROM manager_accruals "
                "WHERE user_id = %s AND paid_at IS NULL",
                (st['userId'],),
            )
            created = _accrue(cur)
            released = _release_pending(cur)
            conn.commit()
            return _resp(200, {
                'ok': True, 'created': created.get('created', 0),
                'released': released,
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
                "  updated_at = now(), updated_by = %s "
                "WHERE id = (SELECT id FROM manager_commission_settings "
                "            ORDER BY id LIMIT 1)",
                (body.get('userId'), body.get('actorId')),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()