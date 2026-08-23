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


def _profit_at(m, price):
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
    var_share = sum(float(v or 0) for v in (m.get('shares') or {}).values())
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

    items = []
    for r in rows:
        price = float(r[10] or 0)
        m = margins.get((r[4], r[5], r[6])) or {}
        profit, margin = _profit_at(m, price)
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
        "SELECT s.material, s.width, s.height, s.sale_price, s.quantity "
        f"FROM marketplace_sales s {where}"
    )
    revenue = 0.0
    profit_sum = 0.0
    # КУДА УХОДИТ ВЫРУЧКА.
    #
    # «Заработали 2,5 млн с оборота 72 млн» — цифра без объяснения. Показываем
    # разбор: сколько забрала площадка, сколько стоило производство, сколько
    # ушло государству. Тогда видно, на что можно повлиять.
    parts = {'commission': 0.0, 'logistics': 0.0, 'acquiring': 0.0,
             'promo': 0.0, 'storage': 0.0, 'returnCost': 0.0,
             'acceptance': 0.0, 'tax': 0.0, 'vat': 0.0, 'production': 0.0}
    known = 0.0

    for material, width, height, price, qty in cur.fetchall():
        n = int(qty or 1)
        pr = float(price or 0) * n
        if not pr:
            continue
        revenue += pr
        mm = margins.get((material, width, height)) or {}
        if mm.get('margin') is None:
            continue
        # Прибыль по составляющим, а не пропорцией: постоянные расходы от
        # цены не зависят, и на скидке они съедают больше, чем кажется.
        unit_profit, _ = _profit_at(mm, float(price or 0))
        if unit_profit is None:
            continue
        profit_sum += unit_profit * n
        known += pr
        # Расходы от цены пересчитываем по долям, себестоимость берём
        # в рублях: ткань и работа стоят одинаково при любой скидке.
        # Переменные считаем от фактической цены, постоянные берём рублями:
        # так разбор сходится с прибылью до копейки.
        for k, share in (mm.get('shares') or {}).items():
            parts[k] += pr * float(share)
        for k, val in (mm.get('fixed') or {}).items():
            parts[k] += float(val or 0) * n
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
