import json
import os
from datetime import date, timedelta

import psycopg2

# Бонусная программа швей: сколько метров нужно сдать на стикеровку за календарный
# месяц и сколько за это платим. Первый расчётный период — сентябрь 2026.
BONUS_METERS_TARGET = 5000
BONUS_AMOUNT = 10000


def _esc_date(value: str) -> str:
    """Проверяет дату из фильтра: ждём строго ГГГГ-ММ-ДД.

    Дата подставляется в запрос текстом, поэтому пропускаем только настоящую дату —
    ничего постороннего в запрос попасть не должно.
    """
    return date.fromisoformat(str(value)[:10]).isoformat()


def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description, details=None):
    """Пишет запись в журнал действий (audit_log) в той же транзакции перед commit()."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'finance',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


def handler(event: dict, context) -> dict:
    """Зарплаты сотрудников: тарифы по ролям, начисления за выполненную работу, выплаты,
    ручные начисления/штрафы админом.

    Тарифы (salary_rates) полностью РАЗДЕЛЬНЫЕ по цехам (workshop_id) — у каждого цеха своя
    независимая таблица ставок, общего/дефолтного значения нет:
      - cutter (закройщик)     — ставка за 1 пог.м. по каждому материалу типа "Тюль" (material_id)
      - sewer (швея)           — фиксированная ставка за штуку по ширине товара (width)
      - packer (упаковщик)     — ставка за пог.м. на стикеровке (общая по цеху, material_id/width = NULL)
      - storekeeper (кладовщик)— оклад за смену (общая ставка по цеху)
      - cleaner (уборщица)     — оклад за смену (общая ставка по цеху)
      - admin (администратор)  — оклад за день (общая ставка по цеху; берётся по цеху из профиля
                                   администратора users.workshop, если не указан — по первому цеху)

    Начисления (salary_accruals) создаются другими backend-функциями при наступлении события
    (раскрой заказа, закрытие стикеровки, закрытие смены и т.д.) — эта функция лишь читает и
    показывает их, а также позволяет админу создавать ручные начисления/штрафы и удалять
    начисления за заказы. Дневной оклад администратора создаётся здесь же при каждом GET-запросе
    (аналогично автозаказу материалов — нет отдельного cron).

    GET  /                                  - сводка для админа: totalToAccrue (сумма
                                               ПОЛОЖИТЕЛЬНЫХ невыплаченных остатков — считается
                                               ПО КАЖДОМУ сотруднику отдельно, затем суммируется,
                                               чтобы штраф одного не компенсировал незаметно
                                               премию другого) и totalDebts (сумма ОТРИЦАТЕЛЬНЫХ
                                               остатков — суммарный долг сотрудников компании),
                                               начисления за период 1-19 и 20-конец текущего
                                               месяца — ТОЛЬКО невыплаченные (в контексте выплаты
                                               в СЛЕДУЮЩЕМ месяце 10 и 25 числа), список последних
                                               операций
        ?userId=1                            - фильтр по сотруднику
        ?dateFrom=2026-08-01&dateTo=2026-08-15 - период начислений (по дате, ЗА которую
                                               начислено). Отдаёт filteredTotal — сумму
                                               по всем записям фильтра, не только страницы
        ?type=salary|manual|penalty|all       - фильтр по типу начисления
        ?page=1                              - пагинация (по 50 записей)
    GET  /?my=1&userId=1                     - для сотрудника: его начисления (с указанием
                                               заказа) и список последних выплат.
                                               Дополнительно возвращает salaryLocked/daysLeft/
                                               unlockAt: у новичков баланс закрыт первые
                                               14 дней после регистрации и открывается сам
    GET  /?rates=1&workshopId=1               - список тарифов (salary_rates) конкретного цеха
                                               (workshopId обязателен для корректной фильтрации;
                                               без него возвращаются тарифы всех цехов подряд)
                                               с названиями материалов и названием цеха.
                                               Перед выборкой автоматически создаёт (ставка 0)
                                               недостающие тарифы закройщика для каждой новой
                                               комбинации материал+ширина среди товаров на
                                               маркетплейсе — аналогично дневному окладу админа
    GET  /?payouts=1&userId=1                 - история выплат (все или по сотруднику)
    GET  /?cashBox=1                          - касса компании: текущий баланс (сумма всех
                                               операций cash_box_transactions) и последние
                                               100 операций (пополнения — amount>0, списания
                                               на выплаты зарплаты — amount<0)

    POST /  { action: 'update_rate', id, rate }
        - админ меняет ставку тарифа
    POST /  { action: 'manual_accrual', userId, amount, description }
        - ручное начисление средств за выполненную работу (admin)
    POST /  { action: 'penalty', userId, amount, description }
        - штраф сотруднику: создаёт начисление с отрицательной суммой (type='penalty')
    POST /  { action: 'update_accrual', id, amount, description }
        - админ редактирует сумму/описание ЛЮБОГО (автоматического или ручного) начисления,
          пока оно не выплачено (409, если уже выплачено)
    POST /  { action: 'delete_accrual', id }
        - админ удаляет начисление поштучно (только пока не выплачено)
    POST /  { action: 'payout', userId }
        - выплачивает сотруднику ВСЕ его невыплаченные начисления целиком: создаёт запись в
          salary_payouts на сумму остатка, помечает все accruals paid_at=now()/payout_id.
          Сумма СПИСЫВАЕТСЯ из кассы компании (cash_box_transactions, amount<0) — если в
          кассе недостаточно средств, выплата отклоняется (409) ДО создания записей
    POST /  { action: 'delete_payout', id }
        - админ удаляет выплату (ошибка при выдаче и т.п.): все связанные с ней начисления
          возвращаются в невыплаченные (paid_at/payout_id = NULL), списанная сумма
          возвращается в кассу компании (cash_box_transactions, amount>0)
    POST /  { action: 'cash_deposit', amount, description }
        - админ пополняет кассу компании вручную (например, внёс выручку из банка) —
          создаёт запись cash_box_transactions с положительной суммой

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со сводкой/списком начислений/результатом операции
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        params = event.get('queryStringParameters') or {}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Дневной оклад администратора — создаём один раз в день при любом заходе сюда.
            # Тариф берётся по цеху, указанному в профиле админа (users.workshop -> workshops.name);
            # если цех не указан — берём тариф первого по списку цеха как запасной вариант.
            cur.execute(
                "SELECT u.id, COALESCE(w.id, (SELECT id FROM workshops ORDER BY id LIMIT 1)) "
                "FROM users u LEFT JOIN workshops w ON w.name = u.workshop "
                "WHERE u.role = 'admin' AND u.is_active = true"
            )
            admin_workshop_rows = cur.fetchall()
            admin_rows = []
            for admin_user_id, admin_workshop_id in admin_workshop_rows:
                if admin_workshop_id is None:
                    continue
                cur.execute(
                    "SELECT rate FROM salary_rates WHERE role = 'admin' AND workshop_id = %s",
                    (admin_workshop_id,),
                )
                rate_row = cur.fetchone()
                if rate_row and float(rate_row[0]) > 0:
                    admin_rows.append((float(rate_row[0]), admin_user_id))
            for rate, admin_user_id in admin_rows:
                cur.execute(
                    "SELECT id FROM salary_accruals WHERE user_id = %s AND type = 'admin_daily' AND accrued_for = CURRENT_DATE",
                    (admin_user_id,),
                )
                if cur.fetchone():
                    continue
                cur.execute(
                    f"INSERT INTO salary_accruals (user_id, type, amount, description, accrued_for) "
                    f"VALUES ({admin_user_id}, 'admin_daily', {float(rate)}, 'Оклад администратора за день', CURRENT_DATE)"
                )
            if admin_rows:
                conn.commit()

            # --- Бонусная программа швей ------------------------------------------
            # 5000 пог.м., сданных на стикеровку за календарный месяц, дают +10 000 ₽.
            # Первый расчётный период — сентябрь 2026.
            #
            # Начисление за прошедший месяц происходит САМО при первом обращении к
            # зарплате в новом месяце: планировщика задач у платформы нет, а привязка
            # к чьему-то входу надёжнее ручной кнопки — премию невозможно забыть
            # начислить. От повторов защищает уникальный индекс в sewer_monthly_bonus.
            bonus_month_start = date.today().replace(day=1)
            # Месяц, за который считаем: предыдущий по отношению к текущему.
            if bonus_month_start.month == 1:
                prev_month = date(bonus_month_start.year - 1, 12, 1)
            else:
                prev_month = date(bonus_month_start.year, bonus_month_start.month - 1, 1)

            # Программа стартует с сентября 2026 — за более ранние месяцы не платим.
            if prev_month >= date(2026, 9, 1):
                cur.execute(
                    "SELECT 1 FROM sewer_monthly_bonus WHERE period_month = %s LIMIT 1",
                    (prev_month,),
                )
                if not cur.fetchone():
                    # Метраж считаем по дате сдачи на стикеровку (sewn_at) — именно так
                    # звучит условие программы: «как швея скинула на стикеровку».
                    cur.execute(
                        "SELECT o.sewer_user_id, SUM(o.width) / 100.0 AS meters "
                        "FROM orders o "
                        "WHERE o.sewer_user_id IS NOT NULL AND o.sewn_at >= %s "
                        "  AND o.sewn_at < %s AND COALESCE(o.status, '') <> 'Отменён' "
                        "GROUP BY o.sewer_user_id HAVING SUM(o.width) / 100.0 >= %s",
                        (prev_month, bonus_month_start, BONUS_METERS_TARGET),
                    )
                    for bonus_user_id, bonus_meters in cur.fetchall():
                        cur.execute(
                            "INSERT INTO salary_accruals (user_id, type, amount, description, accrued_for) "
                            "VALUES (%s, 'bonus', %s, %s, %s) RETURNING id",
                            (
                                bonus_user_id,
                                BONUS_AMOUNT,
                                f'Бонус за выработку {round(float(bonus_meters))} пог.м. '
                                f'за {prev_month.strftime("%m.%Y")}',
                                bonus_month_start,
                            ),
                        )
                        bonus_accrual_id = cur.fetchone()[0]
                        cur.execute(
                            "INSERT INTO sewer_monthly_bonus "
                            "(user_id, period_month, meters, amount, accrual_id) "
                            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (user_id, period_month) DO NOTHING",
                            (bonus_user_id, prev_month, round(float(bonus_meters), 2),
                             BONUS_AMOUNT, bonus_accrual_id),
                        )
                    conn.commit()

            if params.get('sewerBonus'):
                # Прогресс швей по бонусной программе — для виджета на главной.
                bonus_from = date(2026, 9, 1)
                bonus_to = date(2026, 10, 1)
                today = date.today()
                # До старта программы показываем предупреждение, во время — прогресс,
                # после — итог месяца.
                if today < bonus_from:
                    period_from, period_to = bonus_from, bonus_to
                    state = 'upcoming'
                elif today < bonus_to:
                    period_from, period_to = bonus_from, bonus_to
                    state = 'active'
                else:
                    period_from, period_to = bonus_from, bonus_to
                    state = 'finished'

                cur.execute(
                    "SELECT u.id, u.full_name, "
                    "  COALESCE(SUM(o.width) / 100.0, 0) AS meters "
                    "FROM users u "
                    "LEFT JOIN orders o ON o.sewer_user_id = u.id "
                    "  AND o.sewn_at >= %s AND o.sewn_at < %s "
                    "  AND COALESCE(o.status, '') <> 'Отменён' "
                    "WHERE u.is_active = true AND EXISTS ("
                    "  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'sewer'"
                    ") "
                    "GROUP BY u.id, u.full_name ORDER BY meters DESC, u.full_name",
                    (period_from, period_to),
                )
                rows = [
                    {
                        'userId': r[0],
                        'userName': r[1],
                        'meters': round(float(r[2]), 1),
                    }
                    for r in cur.fetchall()
                ]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'state': state,
                        'periodFrom': period_from.isoformat(),
                        'periodTo': (bonus_to - timedelta(days=1)).isoformat(),
                        'target': BONUS_METERS_TARGET,
                        'amount': BONUS_AMOUNT,
                        'sewers': rows,
                    }, ensure_ascii=False),
                }

            if params.get('rates'):
                workshop_id_filter = params.get('workshopId')

                # Автосоздание недостающих тарифов закройщика (role='cutter') — ПО ОДНОМУ
                # на каждую ткань (материалы типа "Тюль" среди товаров маркетплейса). Раньше
                # строка заводилась на каждую пару «ткань + ширина» (56 полей на цех при
                # одинаковой ставке внутри ткани); ширина учитывается в расчёте метража, а
                # не в самой ставке. Работает так же,
                # как автоматически создаётся дневной оклад администратора выше. Новая ставка
                # создаётся со значением 0 — admin сам вписывает нужную сумму на этой странице,
                # раскрой при этом не блокируется (0 просто не начисляется).
                if workshop_id_filter:
                    cur.execute(
                        "SELECT DISTINCT mim.material_id FROM marketplace_items mi "
                        "JOIN marketplace_item_materials mim ON mim.marketplace_item_id = mi.id "
                        "JOIN materials m ON m.id = mim.material_id "
                        "JOIN material_types mt ON mt.id = m.type_id "
                        "WHERE mt.name = 'Тюль'"
                    )
                    needed_materials = cur.fetchall()
                    for (material_id,) in needed_materials:
                        cur.execute(
                            "INSERT INTO salary_rates (role, material_id, width, rate, workshop_id) "
                            "VALUES ('cutter', %s, NULL, 0, %s) "
                            "ON CONFLICT (workshop_id, role, COALESCE(material_id, 0), COALESCE(width, 0)) DO NOTHING",
                            (material_id, int(workshop_id_filter)),
                        )
                    if needed_materials:
                        conn.commit()

                    # Страховка: тариф перепаковки возвратов у упаковщицы (за штуку, размер
                    # не важен). Создаём со значением 0, если его в цехе ещё нет — например,
                    # цех завели раньше, чем появился этот вид оплаты.
                    cur.execute(
                        "INSERT INTO salary_rates (role, material_id, width, rate, workshop_id) "
                        "VALUES ('packer_repack', NULL, NULL, 0, %s) "
                        "ON CONFLICT (workshop_id, role, COALESCE(material_id, 0), COALESCE(width, 0)) "
                        "DO NOTHING",
                        (int(workshop_id_filter),),
                    )
                    conn.commit()

                where_clause = f"WHERE sr.workshop_id = {int(workshop_id_filter)}" if workshop_id_filter else ""
                cur.execute(
                    f"SELECT sr.id, sr.role, sr.material_id, m.name, sr.width, sr.rate, sr.workshop_id, w.name "
                    f"FROM salary_rates sr LEFT JOIN materials m ON m.id = sr.material_id "
                    f"JOIN workshops w ON w.id = sr.workshop_id "
                    f"{where_clause} "
                    f"ORDER BY sr.workshop_id, sr.role, sr.width NULLS FIRST, m.sort_order NULLS FIRST"
                )
                rates = [
                    {
                        'id': r[0],
                        'role': r[1],
                        'materialId': r[2],
                        'materialName': r[3],
                        'width': r[4],
                        'rate': float(r[5]),
                        'workshopId': r[6],
                        'workshopName': r[7],
                    }
                    for r in cur.fetchall()
                ]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'rates': rates})}

            if params.get('missedAccruals'):
                # Кто отработал, но денег не получил.
                #
                # Начисление создаётся в момент завершения этапа. Если в этот момент
                # чего-то не хватило (у заказа не проставлен цех, не заведена ставка),
                # начисление молча НЕ создаётся: ошибки нет, человек просто остаётся
                # без денег, а в отчётах выглядит как не работавший. Так Привезенцева
                # Елена отшила 23 заказа и не получила ничего — заметили случайно.
                # Этот запрос ищет такие дыры сам.
                #
                # Осознанные исключения, которые НЕ являются дырой:
                #  - раскрой заказов, перенесённых из старой системы (source='import'):
                #    их кроили до переезда, деньги за них уже выплачены;
                #  - вещи, взятые готовыми со склада (sewing_status='Со склада'):
                #    их никто не шил в этот раз.
                missed = []

                cur.execute(
                    "SELECT u.id, u.full_name, count(*), min(o.cut_at)::date, max(o.cut_at)::date "
                    "FROM orders o JOIN users u ON u.id = o.cutter_user_id "
                    "WHERE o.cut_at IS NOT NULL AND COALESCE(o.source, '') <> 'import' "
                    "  AND NOT EXISTS (SELECT 1 FROM salary_accruals a "
                    "                  WHERE a.order_id = o.id AND a.type = 'cutter_cut') "
                    "GROUP BY u.id, u.full_name ORDER BY count(*) DESC LIMIT 50"
                )
                for r in cur.fetchall():
                    missed.append({
                        'userId': r[0], 'userName': r[1], 'stage': 'Раскрой',
                        'count': int(r[2]),
                        'dateFrom': (r[3].isoformat() + 'Z') if r[3] else None,
                        'dateTo': (r[4].isoformat() + 'Z') if r[4] else None,
                    })

                cur.execute(
                    "SELECT u.id, u.full_name, count(*), min(o.created_at)::date, max(o.created_at)::date "
                    "FROM orders o JOIN users u ON u.id = o.assigned_user_id "
                    "WHERE o.sewing_status = 'Готовые' AND COALESCE(o.sewing_status, '') <> 'Со склада' "
                    "  AND NOT EXISTS (SELECT 1 FROM salary_accruals a "
                    "                  WHERE a.order_id = o.id AND a.type = 'sewer_piece') "
                    "GROUP BY u.id, u.full_name ORDER BY count(*) DESC LIMIT 50"
                )
                for r in cur.fetchall():
                    missed.append({
                        'userId': r[0], 'userName': r[1], 'stage': 'Пошив',
                        'count': int(r[2]),
                        'dateFrom': (r[3].isoformat() + 'Z') if r[3] else None,
                        'dateTo': (r[4].isoformat() + 'Z') if r[4] else None,
                    })

                cur.execute(
                    "SELECT u.id, u.full_name, count(*), min(o.created_at)::date, max(o.created_at)::date "
                    "FROM orders o JOIN users u ON u.id = o.packer_user_id "
                    "WHERE o.sewing_status = 'Готовые' "
                    "  AND NOT EXISTS (SELECT 1 FROM salary_accruals a "
                    "                  WHERE a.order_id = o.id AND a.type = 'packer_stickering') "
                    "GROUP BY u.id, u.full_name ORDER BY count(*) DESC LIMIT 50"
                )
                for r in cur.fetchall():
                    missed.append({
                        'userId': r[0], 'userName': r[1], 'stage': 'Стикеровка',
                        'count': int(r[2]),
                        'dateFrom': (r[3].isoformat() + 'Z') if r[3] else None,
                        'dateTo': (r[4].isoformat() + 'Z') if r[4] else None,
                    })

                missed.sort(key=lambda x: x['count'], reverse=True)
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'missed': missed}, ensure_ascii=False),
                }

            if params.get('cashBox'):
                cur.execute("SELECT COALESCE(SUM(amount), 0) FROM cash_box_transactions")
                balance = float(cur.fetchone()[0])

                cur.execute(
                    "SELECT ct.id, ct.amount, ct.description, ct.payout_id, u.full_name, ct.created_at "
                    "FROM cash_box_transactions ct LEFT JOIN users u ON u.id = ct.created_by "
                    "ORDER BY ct.created_at DESC LIMIT 100"
                )
                transactions = [
                    {
                        'id': r[0],
                        'amount': float(r[1]),
                        'description': r[2],
                        'payoutId': r[3],
                        'createdByName': r[4],
                        'createdAt': r[5].isoformat() + 'Z',
                    }
                    for r in cur.fetchall()
                ]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'balance': balance, 'transactions': transactions}),
                }

            if params.get('payouts'):
                user_id_filter = params.get('userId')
                cond = f"WHERE sp.user_id = {int(user_id_filter)}" if user_id_filter else ""
                cur.execute(
                    f"SELECT sp.id, sp.user_id, u.full_name, sp.amount, sp.paid_at, sp.period_from, sp.period_to "
                    f"FROM salary_payouts sp JOIN users u ON u.id = sp.user_id "
                    f"{cond} ORDER BY sp.paid_at DESC LIMIT 100"
                )
                payouts = [
                    {
                        'id': r[0],
                        'userId': r[1],
                        'userName': r[2],
                        'amount': float(r[3]),
                        'paidAt': r[4].isoformat() + 'Z',
                        'periodFrom': (r[5].isoformat() + 'Z') if r[5] else None,
                        'periodTo': (r[6].isoformat() + 'Z') if r[6] else None,
                    }
                    for r in cur.fetchall()
                ]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'payouts': payouts})}

            if params.get('my'):
                user_id = params.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                # Вместе с начислением отдаём смену, за которую оно сделано (цех, номер,
                # время). Нужно для окладов: если сотрудник за день отработал две смены —
                # свою и гостевую в чужом цехе — по отчёту сразу видно, что оклад
                # начислен один раз и за какую именно смену.
                cur.execute(
                    "SELECT sa.id, sa.type, sa.amount, sa.description, o.order_number, "
                    "sa.accrued_for, sa.created_at, sa.paid_at, "
                    "w.name, ss.shift_number, ss.opened_at "
                    "FROM salary_accruals sa LEFT JOIN orders o ON o.id = sa.order_id "
                    "LEFT JOIN shift_sessions ss ON ss.id = sa.shift_session_id "
                    "LEFT JOIN workshops w ON w.id = ss.workshop_id "
                    "WHERE sa.user_id = %s ORDER BY sa.created_at DESC LIMIT 200",
                    (int(user_id),),
                )
                accruals = [
                    {
                        'id': r[0],
                        'type': r[1],
                        'amount': float(r[2]),
                        'description': r[3],
                        'orderNumber': r[4],
                        'accruedFor': r[5].isoformat(),
                        'createdAt': r[6].isoformat() + 'Z',
                        'paidAt': (r[7].isoformat() + 'Z') if r[7] else None,
                        'shiftWorkshopName': r[8],
                        'shiftNumber': r[9],
                        'shiftOpenedAt': (r[10].isoformat() + 'Z') if r[10] else None,
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT COALESCE(SUM(amount), 0) FROM salary_accruals WHERE user_id = %s AND paid_at IS NULL",
                    (int(user_id),),
                )
                balance = float(cur.fetchone()[0])

                cur.execute(
                    "SELECT id, amount, paid_at FROM salary_payouts WHERE user_id = %s "
                    "ORDER BY paid_at DESC LIMIT 20",
                    (int(user_id),),
                )
                payouts = [
                    {'id': r[0], 'amount': float(r[1]), 'paidAt': r[2].isoformat() + 'Z'}
                    for r in cur.fetchall()
                ]

                # Новичкам баланс открывается через 2 недели после регистрации: первые дни
                # человек только учится, суммы скачут, и раннее сравнение зарплат
                # демотивирует. Считаем на сервере — дату на телефоне подкрутить нельзя.
                cur.execute(
                    "SELECT salary_unlock_at, "
                    "CEIL(GREATEST(0, EXTRACT(EPOCH FROM (salary_unlock_at - now())) / 86400))::int "
                    "FROM users WHERE id = %s",
                    (int(user_id),),
                )
                u_row = cur.fetchone()
                days_left = int(u_row[1]) if u_row and u_row[1] is not None else 0
                salary_locked = days_left > 0
                unlock_at = (u_row[0].isoformat() + 'Z') if u_row and u_row[0] else None

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'accruals': accruals,
                        'balance': balance,
                        'payouts': payouts,
                        'salaryLocked': salary_locked,
                        'daysLeft': days_left,
                        'unlockAt': unlock_at,
                    }),
                }

            user_id_filter = params.get('userId')
            type_filter = params.get('type')
            page = int(params.get('page') or 1)
            per_page = 15
            offset = (page - 1) * per_page

            conditions = []
            if user_id_filter:
                conditions.append(f"sa.user_id = {int(user_id_filter)}")
            if type_filter and type_filter != 'all':
                type_esc = type_filter.replace("'", "''")
                conditions.append(f"sa.type = '{type_esc}'")

            # Период начислений: смотрят «сколько человек заработал с 1 по 15 число».
            # Фильтруем по дате, ЗА которую начислено (accrued_for), а не по дате записи:
            # начисление могли внести позже, и по дате записи оно попало бы в чужой период.
            date_from = params.get('dateFrom')
            date_to = params.get('dateTo')
            try:
                if date_from:
                    conditions.append(f"sa.accrued_for >= '{_esc_date(date_from)}'")
                if date_to:
                    conditions.append(f"sa.accrued_for <= '{_esc_date(date_to)}'")
            except ValueError:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Неверная дата периода'}, ensure_ascii=False),
                }

            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(f"SELECT COUNT(*) FROM salary_accruals sa {where_clause}")
            total_count = cur.fetchone()[0]

            cur.execute(
                f"SELECT sa.id, sa.user_id, u.full_name, sa.type, sa.amount, sa.description, "
                f"o.order_number, sa.accrued_for, sa.created_at, sa.paid_at, "
                f"w.name, ss.shift_number, ss.opened_at, u.workshop "
                f"FROM salary_accruals sa JOIN users u ON u.id = sa.user_id "
                f"LEFT JOIN orders o ON o.id = sa.order_id "
                f"LEFT JOIN shift_sessions ss ON ss.id = sa.shift_session_id "
                f"LEFT JOIN workshops w ON w.id = ss.workshop_id "
                f"{where_clause} "
                f"ORDER BY sa.created_at DESC LIMIT {per_page} OFFSET {offset}"
            )
            operations = [
                {
                    'id': r[0],
                    'userId': r[1],
                    'userName': r[2],
                    'type': r[3],
                    'amount': float(r[4]),
                    'description': r[5],
                    'orderNumber': r[6],
                    'accruedFor': r[7].isoformat(),
                    'createdAt': r[8].isoformat() + 'Z',
                    'paidAt': (r[9].isoformat() + 'Z') if r[9] else None,
                    'shiftWorkshopName': r[10],
                    'shiftNumber': r[11],
                    'shiftOpenedAt': (r[12].isoformat() + 'Z') if r[12] else None,
                    # Оклад начислен за смену в чужом цехе — сотрудник работал гостем.
                    'shiftIsGuest': bool(r[10] and r[13] and r[10] != r[13]),
                }
                for r in cur.fetchall()
            ]

            # "К выплате" разбито на два числа, чтобы штраф одного сотрудника не
            # компенсировал незаметно премию другого в общей сумме:
            #   totalToAccrue — сумма ПОЛОЖИТЕЛЬНЫХ остатков (посчитанных ПО КАЖДОМУ
            #                   сотруднику отдельно) — сколько реально нужно выплатить
            #   totalDebts    — сумма ОТРИЦАТЕЛЬНЫХ остатков (тоже по сотрудникам) —
            #                   суммарный долг сотрудников компании (штрафы превысили начисления)
            cur.execute(
                "SELECT COALESCE(SUM(GREATEST(user_balance, 0)), 0), "
                "COALESCE(SUM(LEAST(user_balance, 0)), 0) FROM ("
                "  SELECT user_id, SUM(amount) as user_balance FROM salary_accruals "
                "  WHERE paid_at IS NULL GROUP BY user_id"
                ") sub"
            )
            total_to_accrue_row = cur.fetchone()
            total_to_accrue = float(total_to_accrue_row[0])
            total_debts = float(total_to_accrue_row[1])

            today = date.today()
            if today.day >= 20:
                period1_from = today.replace(day=20)
                if today.month == 12:
                    period1_to = date(today.year + 1, 1, 1)
                else:
                    period1_to = date(today.year, today.month + 1, 1)
            else:
                if today.month == 1:
                    period1_from = date(today.year - 1, 12, 20)
                else:
                    period1_from = date(today.year, today.month - 1, 20)
                period1_to = today.replace(day=1)

            period2_from = today.replace(day=1)
            period2_to = today.replace(day=20)

            # За период считаются ТОЛЬКО ещё невыплаченные начисления (paid_at IS NULL) —
            # иначе сюда попадали бы уже выплаченные суммы прошлых периодов, искажая цифру
            # предстоящей выплаты.
            cur.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM salary_accruals "
                "WHERE accrued_for >= %s AND accrued_for < %s AND paid_at IS NULL",
                (period1_from, period1_to),
            )
            period1_total = float(cur.fetchone()[0])

            cur.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM salary_accruals "
                "WHERE accrued_for >= %s AND accrued_for < %s AND paid_at IS NULL",
                (period2_from, period2_to),
            )
            period2_total = float(cur.fetchone()[0])

            # Итог по выбранным фильтрам: сколько начислено за период конкретному
            # сотруднику. Считается по ВСЕМ подходящим записям, а не только по текущей
            # странице, иначе цифра менялась бы при листании.
            cur.execute(
                f"SELECT COALESCE(SUM(sa.amount), 0) FROM salary_accruals sa {where_clause}"
            )
            filtered_total = float(cur.fetchone()[0])
        finally:
            conn.close()

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'operations': operations,
                'totalCount': total_count,
                'totalPages': max(1, (total_count + per_page - 1) // per_page),
                'filteredTotal': filtered_total,
                'totalToAccrue': total_to_accrue,
                'totalDebts': total_debts,
                'period1Total': period1_total,
                'period2Total': period2_total,
            }),
        }

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'update_rate':
                rate_id = body_data.get('id')
                rate = body_data.get('rate')
                if not rate_id or rate in (None, ''):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id и rate'})}

                cur.execute(f"UPDATE salary_rates SET rate = {float(rate)}, updated_at = now() WHERE id = {int(rate_id)}")
                log_action(
                    cur, actor_id, actor_name, 'update_rate', 'salary_rate', rate_id,
                    f'Изменил тариф #{rate_id} на {rate}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'manual_accrual':
                user_id = body_data.get('userId')
                amount = body_data.get('amount')
                description = (body_data.get('description') or '').strip()
                if not user_id or amount in (None, '') or not description:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите сотрудника, сумму и описание'}),
                    }

                description_esc = description.replace("'", "''")
                actor_id_sql = int(actor_id) if actor_id not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO salary_accruals (user_id, type, amount, description, created_by) "
                    f"VALUES ({int(user_id)}, 'manual', {float(amount)}, '{description_esc}', {actor_id_sql}) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                log_action(
                    cur, actor_id, actor_name, 'manual_accrual', 'salary_accrual', new_id,
                    f'Ручное начисление сотруднику #{user_id}: {amount} ({description})',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'penalty':
                user_id = body_data.get('userId')
                amount = body_data.get('amount')
                description = (body_data.get('description') or '').strip()
                if not user_id or amount in (None, '') or not description:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите сотрудника, сумму и описание'}),
                    }

                penalty_amount = -abs(float(amount))
                description_esc = description.replace("'", "''")
                actor_id_sql = int(actor_id) if actor_id not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO salary_accruals (user_id, type, amount, description, created_by) "
                    f"VALUES ({int(user_id)}, 'penalty', {penalty_amount}, '{description_esc}', {actor_id_sql}) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                log_action(
                    cur, actor_id, actor_name, 'penalty', 'salary_accrual', new_id,
                    f'Штраф сотруднику #{user_id}: {penalty_amount} ({description})',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update_accrual':
                accrual_id = body_data.get('id')
                amount = body_data.get('amount')
                description = (body_data.get('description') or '').strip()
                if not accrual_id or amount in (None, '') or not description:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите id, сумму и описание'}),
                    }

                cur.execute("SELECT paid_at FROM salary_accruals WHERE id = %s", (int(accrual_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Начисление не найдено'})}
                if row[0] is not None:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Нельзя редактировать уже выплаченное начисление'})}

                description_esc = description.replace("'", "''")
                cur.execute(
                    f"UPDATE salary_accruals SET amount = {float(amount)}, description = '{description_esc}' "
                    f"WHERE id = {int(accrual_id)}"
                )
                log_action(
                    cur, actor_id, actor_name, 'update_accrual', 'salary_accrual', accrual_id,
                    f'Изменил начисление #{accrual_id}: сумма {amount}, описание "{description}"',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete_accrual':
                accrual_id = body_data.get('id')
                if not accrual_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute("SELECT paid_at FROM salary_accruals WHERE id = %s", (int(accrual_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Начисление не найдено'})}
                if row[0] is not None:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Нельзя удалить уже выплаченное начисление'})}

                cur.execute("DELETE FROM salary_accruals WHERE id = %s", (int(accrual_id),))
                log_action(
                    cur, actor_id, actor_name, 'delete_accrual', 'salary_accrual', accrual_id,
                    f'Удалил начисление #{accrual_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'payout':
                user_id = body_data.get('userId')
                if not user_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

                cur.execute(
                    "SELECT COALESCE(SUM(amount), 0) FROM salary_accruals WHERE user_id = %s AND paid_at IS NULL",
                    (int(user_id),),
                )
                balance = float(cur.fetchone()[0])
                if balance <= 0:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Нет начислений к выплате'})}

                # Выплата списывается из кассы компании — если денег в кассе недостаточно,
                # выплата блокируется полностью (частичных выплат нет).
                cur.execute("SELECT COALESCE(SUM(amount), 0) FROM cash_box_transactions")
                cash_balance = float(cur.fetchone()[0])
                if cash_balance < balance:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Недостаточно средств в кассе: доступно {cash_balance}, нужно {balance}'}),
                    }

                actor_id_sql = int(actor_id) if actor_id not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO salary_payouts (user_id, amount, paid_by) "
                    f"VALUES ({int(user_id)}, {balance}, {actor_id_sql}) RETURNING id, paid_at"
                )
                payout_id, paid_at = cur.fetchone()

                cur.execute(
                    f"UPDATE salary_accruals SET paid_at = '{paid_at.isoformat()}', payout_id = {payout_id} "
                    f"WHERE user_id = {int(user_id)} AND paid_at IS NULL"
                )

                cur.execute(
                    f"INSERT INTO cash_box_transactions (amount, description, payout_id, created_by) "
                    f"VALUES ({-balance}, 'Выплата зарплаты сотруднику #{int(user_id)}', {payout_id}, {actor_id_sql})"
                )

                log_action(
                    cur, actor_id, actor_name, 'payout', 'salary_payout', payout_id,
                    f'Выплатил сотруднику #{user_id} {balance}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': payout_id, 'amount': balance})}

            if action == 'delete_payout':
                payout_id = body_data.get('id')
                if not payout_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute("SELECT user_id, amount FROM salary_payouts WHERE id = %s", (int(payout_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Выплата не найдена'})}
                payout_user_id, payout_amount = row

                # Начисления, входившие в эту выплату, возвращаются в невыплаченные — снова
                # появятся в "К выплате", сотруднику можно будет выплатить заново корректно.
                cur.execute(
                    "UPDATE salary_accruals SET paid_at = NULL, payout_id = NULL WHERE payout_id = %s",
                    (int(payout_id),),
                )

                # Списанная на эту выплату сумма возвращается в кассу.
                actor_id_sql = int(actor_id) if actor_id not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO cash_box_transactions (amount, description, created_by) "
                    f"VALUES ({float(payout_amount)}, 'Отмена выплаты #{int(payout_id)} сотруднику #{payout_user_id}', {actor_id_sql})"
                )

                # Историческую запись списания этой выплаты из кассы отвязываем от payout_id
                # (саму транзакцию НЕ удаляем — касса должна сохранить полную историю), иначе
                # foreign key не даст удалить строку из salary_payouts.
                cur.execute(
                    "UPDATE cash_box_transactions SET payout_id = NULL WHERE payout_id = %s",
                    (int(payout_id),),
                )

                cur.execute("DELETE FROM salary_payouts WHERE id = %s", (int(payout_id),))
                log_action(
                    cur, actor_id, actor_name, 'delete_payout', 'salary_payout', payout_id,
                    f'Удалил выплату #{payout_id} сотруднику #{payout_user_id} на сумму {payout_amount}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'cash_deposit':
                amount = body_data.get('amount')
                description = (body_data.get('description') or '').strip()
                if amount in (None, '') or float(amount) <= 0 or not description:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите положительную сумму и описание'}),
                    }

                description_esc = description.replace("'", "''")
                actor_id_sql = int(actor_id) if actor_id not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO cash_box_transactions (amount, description, created_by) "
                    f"VALUES ({float(amount)}, '{description_esc}', {actor_id_sql}) RETURNING id"
                )
                new_id = cur.fetchone()[0]
                log_action(
                    cur, actor_id, actor_name, 'cash_deposit', 'cash_box_transaction', new_id,
                    f'Пополнил кассу на {amount} ({description})',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}