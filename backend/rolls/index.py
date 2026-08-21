import json
import os

import psycopg2

# Сколько рулонов отдаём в общий список. Больше на экране всё равно не смотрят:
# страница показывает по 20 с кнопкой «показать ещё», а конкретный рулон ищут
# по штрихкоду.
ROLLS_LIST_LIMIT = 800


def notify_admin(cur, kind, title, message, actor_id, actor_name, link=None,
                 entity_type=None, entity_id=None):
    """Кладёт событие на панель администратора.

    Недостача сверх нормы стоит денег, поэтому администратор должен увидеть её сразу
    после закрытия рулона, а не найти случайно через неделю.
    """
    cur.execute(
        "INSERT INTO admin_notifications (kind, title, message, actor_id, actor_name, "
        "link, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            kind, title, message,
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            link, entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
        ),
    )


def calc_shortage_penalty(cur, roll_id):
    """Считает штраф по рулону, НИЧЕГО не начисляя — для предпросмотра на дашборде.

    Возвращает словарь с суммой, превышением над нормой и списком сотрудников,
    которых коснётся удержание, либо причину, по которой штрафовать нельзя.
    """
    cur.execute(
        "SELECT r.initial_quantity, r.shortage_quantity, r.shortage_norm_percent, "
        "r.cost_per_unit, mt.name, r.barcode, m.name, m.unit, r.penalty_total, "
        # Сколько метров числилось на рулоне, когда закройщик назвал недостачу.
        # Без этой цифры администратор не может перепроверить заявленную недостачу.
        "r.remaining_at_close, r.closed_by_name, r.completed_at "
        "FROM rolls r "
        "JOIN materials m ON m.id = r.material_id "
        "LEFT JOIN material_types mt ON mt.id = m.type_id "
        "WHERE r.id = %s",
        (roll_id,),
    )
    row = cur.fetchone()
    if not row:
        return None

    initial_qty = float(row[0] or 0)
    declared_shortage = float(row[1] or 0)
    norm_percent = float(row[2]) if row[2] is not None else None
    cost_per_unit = float(row[3]) if row[3] is not None else 0.0
    type_name = row[4] or ''
    remaining_at_close = float(row[9]) if row[9] is not None else None

    # ЧТО СЧИТАЕТСЯ НЕДОСТАЧЕЙ.
    #
    # Недостача — это метраж, который числился на рулоне, но в изделия не ушёл.
    # То есть ВЕСЬ остаток на момент закрытия, а не та цифра, которую сотрудница
    # вписала в поле «недостача» на терминале.
    #
    # Почему так. Раньше считали строго по введённому числу, и рулон закрывали с
    # недостачей «0.53», когда по системе на нём висело ещё 15.85 п.м. Эти 15 метров
    # просто исчезали: штраф считался от полуметра, укладывался в норму, и рулон
    # уходил из очереди как чистый. Проверить это администратор не мог — на дашборд
    # выводилась заявленная цифра, а не фактический остаток.
    #
    # Теперь база для штрафа — фактический остаток при закрытии. Введённое число
    # оставляем как пояснение сотрудницы (сколько, по её мнению, недомотал
    # поставщик), но деньги считаем по факту.
    shortage = remaining_at_close if remaining_at_close is not None else declared_shortage

    info = {
        'rollId': roll_id,
        'barcode': row[5],
        'materialName': row[6],
        'unit': row[7],
        'initialQuantity': initial_qty,
        'shortage': round(shortage, 3),
        # Что сотрудница вписала руками — для сверки с фактом.
        'declaredShortage': round(declared_shortage, 3),
        'normPercent': norm_percent,
        'costPerUnit': cost_per_unit,
        'alreadyCharged': float(row[8]) if row[8] is not None else None,
        # Факт на момент закрытия: остаток, кто закрыл и когда.
        'remainingAtClose': float(row[9]) if row[9] is not None else None,
        'closedByName': row[10],
        'closedAt': (row[11].isoformat() + 'Z') if row[11] else None,
        'total': 0.0,
        'excess': 0.0,
        'users': [],
        'reason': None,
    }

    if shortage <= 0:
        info['reason'] = 'Недостачи нет'
        return info
    if norm_percent is None:
        info['reason'] = 'У поставщика не задана норма недостачи'
        return info
    if cost_per_unit <= 0:
        info['reason'] = 'У рулона нет себестоимости'
        return info

    allowed = initial_qty * norm_percent / 100
    excess = shortage - allowed
    info['allowed'] = round(allowed, 3)
    if excess <= 0:
        info['reason'] = 'Недостача в пределах нормы'
        return info

    info['excess'] = round(excess, 3)
    info['total'] = round(excess * cost_per_unit, 2)

    # Тесьма и упаковка — на швеях, ткань — на закройщицах.
    is_trim = type_name in ('Аксессуары', 'Упаковка')
    role_column = 'sewer_user_id' if is_trim else 'cutter_user_id'

    # Сразу считаем, сколько метража списал на себя каждый: по коробке тесьмы в 1500 м
    # работают семь швей, и администратору перед удержанием нужно видеть не просто
    # список фамилий, а кто сколько с неё отшил.
    cur.execute(
        f"SELECT o.{role_column}, u.full_name, COALESCE(SUM(omu.quantity), 0), COUNT(*) "
        f"FROM order_material_usage omu "
        f"JOIN orders o ON o.id = omu.order_id "
        f"LEFT JOIN users u ON u.id = o.{role_column} "
        f"WHERE omu.roll_id = %s AND o.{role_column} IS NOT NULL "
        f"GROUP BY o.{role_column}, u.full_name "
        f"ORDER BY 3 DESC",
        (roll_id,),
    )
    users = [
        {
            'id': r[0],
            'name': r[1] or 'Без имени',
            'usedQuantity': round(float(r[2] or 0), 2),
            'ordersCount': int(r[3] or 0),
        }
        for r in cur.fetchall()
    ]

    if not users:
        cur.execute(
            "SELECT r.closed_by_user_id, COALESCE(u.full_name, r.closed_by_name) "
            "FROM rolls r LEFT JOIN users u ON u.id = r.closed_by_user_id WHERE r.id = %s",
            (roll_id,),
        )
        closed_row = cur.fetchone()
        if closed_row and closed_row[0]:
            users = [{'id': closed_row[0], 'name': closed_row[1] or 'Без имени'}]

    if not users:
        info['reason'] = 'Не удалось определить, кто работал с рулоном'
        return info

    share = round(info['total'] / len(users), 2)
    for u in users:
        u['amount'] = share
    info['users'] = users
    info['perUser'] = share
    info['role'] = 'Швеи' if is_trim else 'Закройщицы'
    return info


def charge_shortage_penalty(cur, roll_id, shortage):
    """Штраф за недостачу в рулоне сверх нормы поставщика.

    Недостача — метраж, которого не оказалось в рулоне. Часть её нормальна (поставщик
    мотает с погрешностью) и задаётся нормой в его карточке. Штраф начисляется только
    за превышение нормы и только по себестоимости этого рулона.

    Кого штрафуем — зависит от материала:
      * ткань (Тюль) — закройщиц, которые реально кроили из этого рулона. Кто с рулоном
        не работал, тот не платит, даже если закрывал его кто-то другой;
      * тесьма и аксессуары — швей, работавших с рулоном: тесьму расходуют они.
    Сумма делится поровну между причастными.

    Возвращает словарь с итогом или None, если штрафовать не за что.
    """
    if not shortage or shortage <= 0:
        return None

    cur.execute(
        "SELECT r.initial_quantity, r.shortage_norm_percent, r.cost_per_unit, mt.name "
        "FROM rolls r "
        "JOIN materials m ON m.id = r.material_id "
        "LEFT JOIN material_types mt ON mt.id = m.type_id "
        "WHERE r.id = %s",
        (roll_id,),
    )
    row = cur.fetchone()
    if not row:
        return None

    initial_qty = float(row[0] or 0)
    norm_percent = float(row[1]) if row[1] is not None else None
    cost_per_unit = float(row[2]) if row[2] is not None else 0.0
    type_name = row[3] or ''

    # Норма не задана — только копим статистику, никого не штрафуем.
    if norm_percent is None or initial_qty <= 0 or cost_per_unit <= 0:
        return None

    allowed = initial_qty * norm_percent / 100
    excess = float(shortage) - allowed
    if excess <= 0:
        return None

    penalty_total = round(excess * cost_per_unit, 2)
    if penalty_total <= 0:
        return None

    # Тесьма и прочие аксессуары — на швеях, ткань — на закройщицах.
    is_trim = type_name in ('Аксессуары', 'Упаковка')
    role_column = 'sewer_user_id' if is_trim else 'cutter_user_id'

    cur.execute(
        f"SELECT DISTINCT o.{role_column} FROM order_material_usage omu "
        f"JOIN orders o ON o.id = omu.order_id "
        f"WHERE omu.roll_id = %s AND o.{role_column} IS NOT NULL",
        (roll_id,),
    )
    user_ids = [r[0] for r in cur.fetchall()]

    # Никто не отмечен на заказах — спрашиваем с того, кто закрыл рулон.
    if not user_ids:
        cur.execute("SELECT closed_by_user_id FROM rolls WHERE id = %s", (roll_id,))
        closed_row = cur.fetchone()
        if closed_row and closed_row[0]:
            user_ids = [closed_row[0]]

    if not user_ids:
        return None

    share = round(penalty_total / len(user_ids), 2)
    if share <= 0:
        return None

    cur.execute("SELECT barcode FROM rolls WHERE id = %s", (roll_id,))
    barcode = cur.fetchone()[0]

    for user_id in user_ids:
        cur.execute(
            "INSERT INTO salary_accruals (user_id, type, amount, roll_id, description) "
            "VALUES (%s, 'penalty', %s, %s, %s)",
            (
                int(user_id),
                -share,
                roll_id,
                f'Недостача по рулону {barcode}: сверх нормы {round(excess, 2)} '
                f'при норме {norm_percent}%',
            ),
        )

    cur.execute(
        "UPDATE rolls SET penalty_total = %s WHERE id = %s",
        (penalty_total, roll_id),
    )

    return {
        'total': penalty_total,
        'excess': round(excess, 3),
        'perUser': share,
        'users': len(user_ids),
    }


def handler(event: dict, context) -> dict:
    """Управляет рулонами материалов на складе и в цехах.

    Рулон — партия материала с уникальным штрихкодом. У рулона фиксируется начальный
    и текущий остаток (в единицах материала: п.м. или шт.), статус и привязка к смене/цеху.
    При списании через раскрой заказа остаток рулона уменьшается автоматически.

    Обязательное правило: рулон в статусе 'in_workshop' (в цехе) ДОЛЖЕН иметь и цех,
    и смену — "ничейных" рулонов в цехе быть не может (гарантируется CHECK-ограничением
    БД rolls_workshop_requires_shift + валидацией здесь). На складе (in_storage) цех и
    смена не нужны — это нормальная часть склада.

    GET  /                                 - список рулонов
    GET  /?material_id=1&status=in_storage - список рулонов с фильтром
    GET  /?forUserId=5                     - рулоны ТОЛЬКО цеха открытой смены сотрудника
                                             (для швеи/закройщика/упаковщика) И только
                                             своего типа материала: закройщик — Тюль,
                                             швея — Аксессуары (тесьма), упаковщик —
                                             Упаковка (пакеты, этикетки)
    GET  /?shortage_stats=1&from=&to=      - статистика недостач по закрытым рулонам:
        средний и максимальный процент недостачи по каждому материалу, сводка по закройщикам
        и список закрытых рулонов. Нужна, чтобы за месяц набрать реальные цифры и потом
        задать нормы недостачи (materials.shortage_norm_percent)
    POST /  { action: 'create', barcode, materialId, initialQuantity, workshopId?, shiftNumber? }
        - если указан workshopId, shiftNumber обязателен
    POST /  { action: 'update', id, status?, workshopId?, shiftNumber? }
        - если итоговый статус 'in_workshop', итоговые цех и смена обязательны
    POST /  { action: 'write_off', id, quantity, orderId? }
        - списывает quantity с остатка рулона, создаёт запись в order_material_usage если указан orderId
        - если остаток становится <= 0, статус рулона переводится в 'completed'
    POST /  { action: 'delete', id }

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над рулонами
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
        material_id = params.get('material_id')
        status = params.get('status')
        roll_id = params.get('id')

        # Статистика недостач по закрытым рулонам: сколько метров в среднем «не хватает»
        # в целом рулоне по каждому материалу. Нужна, чтобы за месяц набрать реальные цифры
        # и на их основе задать нормы недостачи. Пока никого не штрафуем — только считаем.
        # Закрытые рулоны с недостачей, по которым штраф ещё не начислен — очередь
        # на рассмотрение администратором. Решение он принимает вручную: недостача бывает
        # и не по вине сотрудника (поставщик недомотал, брак ткани).
        if params.get('shortage_pending'):
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                # Берём рулоны, где ЧТО-ТО осталось: либо сотрудница заявила недостачу,
                # либо на рулоне при закрытии числился остаток. Второе условие раньше
                # отсутствовало — и рулон, закрытый с 15 неизрасходованными метрами и
                # недостачей «0», в очередь к администратору не попадал вообще.
                cur.execute(
                    "SELECT r.id FROM rolls r "
                    "WHERE r.status = 'completed' AND r.penalty_total IS NULL "
                    "AND (r.shortage_quantity > 0 OR r.remaining_at_close > 0) "
                    "ORDER BY r.completed_at DESC LIMIT 100"
                )
                pending = [calc_shortage_penalty(cur, r[0]) for r in cur.fetchall()]
                pending = [p for p in pending if p]
            finally:
                conn.close()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'items': pending}, ensure_ascii=False, default=str),
            }

        # АНАЛИЗ ПО ЗАКРОЙЩИЦАМ.
        #
        # Показывает, кто чаще закрывает рулоны с недостачей. Берём ТОЛЬКО те рулоны,
        # где человек работал в одиночку от начала и до конца: если ткань кроили двое,
        # понять, чей именно метраж ушёл в никуда, невозможно — такой рулон никого не
        # характеризует и в личную статистику не идёт.
        #
        # Учитываем ВСЕ рулоны с недостачей, включая списанные администратором на
        # поставщика. Решение «виноват поставщик» снимает деньги, но не отменяет факт:
        # если у одной закройщицы такие рулоны идут раз за разом, дело не в поставщике.
        if params.get('cutter_analysis'):
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT "
                    # Кто работал с рулоном: одна закройщица на весь рулон.
                    "  cu.id, cu.full_name, r.shift_number, "
                    "  COUNT(*) AS rolls_total, "
                    # Метраж, не ушедший в изделия, и допуск по норме поставщика.
                    "  COALESCE(SUM(r.remaining_at_close), 0) AS lost_total, "
                    "  COALESCE(SUM(r.initial_quantity), 0) AS initial_total, "
                    "  COUNT(*) FILTER (WHERE r.shortage_norm_percent IS NOT NULL "
                    "     AND r.remaining_at_close > r.initial_quantity * r.shortage_norm_percent / 100) "
                    "     AS over_norm_rolls, "
                    # Деньги: сверх нормы × себестоимость. Считаем и по тем рулонам,
                    # что администратор простил, — иначе картина по человеку неполная.
                    "  COALESCE(SUM(GREATEST(r.remaining_at_close - "
                    "     r.initial_quantity * r.shortage_norm_percent / 100, 0) * r.cost_per_unit), 0) "
                    "     AS over_norm_money, "
                    # Сколько из них администратор списал на поставщика.
                    "  COUNT(*) FILTER (WHERE r.penalty_total = 0) AS forgiven_rolls "
                    "FROM rolls r "
                    "JOIN LATERAL ("
                    # Кому засчитываем рулон.
                    #
                    # Обычно это закройщица, отмеченная на заказах. Но часть рулонов
                    # закрывается вообще без записей раскроя — например, остаток ушёл
                    # в брак или рулон вели до появления учёта. Такие рулоны нельзя
                    # терять: именно среди них попадаются самые крупные недостачи.
                    # Для них считаем ответственной ту, кто закрыла рулон в цехе.
                    "  SELECT DISTINCT o.cutter_user_id AS uid FROM order_material_usage omu "
                    "  JOIN orders o ON o.id = omu.order_id "
                    "  WHERE omu.roll_id = r.id AND o.cutter_user_id IS NOT NULL "
                    "  UNION "
                    "  SELECT r.closed_by_user_id WHERE r.closed_by_user_id IS NOT NULL "
                    "    AND NOT EXISTS (SELECT 1 FROM order_material_usage omu3 "
                    "      JOIN orders o3 ON o3.id = omu3.order_id "
                    "      WHERE omu3.roll_id = r.id AND o3.cutter_user_id IS NOT NULL)"
                    ") w ON TRUE "
                    "JOIN users cu ON cu.id = w.uid "
                    "WHERE r.status = 'completed' "
                    "  AND r.remaining_at_close IS NOT NULL "
                    # Только рулоны, которые вёл ОДИН человек: если ткань кроили двое,
                    # чей метраж пропал — установить нельзя, и вина не персональна.
                    "  AND (SELECT COUNT(DISTINCT o2.cutter_user_id) FROM order_material_usage omu2 "
                    "       JOIN orders o2 ON o2.id = omu2.order_id "
                    "       WHERE omu2.roll_id = r.id AND o2.cutter_user_id IS NOT NULL) <= 1 "
                    "GROUP BY cu.id, cu.full_name, r.shift_number "
                    "ORDER BY over_norm_money DESC, rolls_total DESC"
                )
                rows = cur.fetchall()
                items = []
                for r in rows:
                    rolls_total = int(r[3] or 0)
                    over_norm = int(r[6] or 0)
                    items.append({
                        'userId': r[0],
                        'name': r[1] or 'Без имени',
                        'shiftNumber': r[2],
                        'rollsTotal': rolls_total,
                        'lostQuantity': round(float(r[4] or 0), 2),
                        'initialQuantity': round(float(r[5] or 0), 2),
                        'overNormRolls': over_norm,
                        'overNormMoney': round(float(r[7] or 0), 2),
                        'forgivenRolls': int(r[8] or 0),
                        # Доля рулонов с превышением нормы — главный показатель: у кого
                        # недостача системная, а у кого разовая.
                        'overNormShare': round(over_norm * 100.0 / rolls_total, 1) if rolls_total else 0.0,
                    })
            finally:
                conn.close()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'items': items}, ensure_ascii=False, default=str),
            }

        # Рулоны конкретной закройщицы — раскрытие строки в анализе. Те же правила:
        # только рулоны, где она работала одна.
        if params.get('cutter_rolls'):
            try:
                cutter_id = int(params.get('cutter_rolls'))
            except (TypeError, ValueError):
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Неверный сотрудник'}, ensure_ascii=False)}
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT r.id, r.barcode, m.name, r.shift_number, r.initial_quantity, "
                    "  r.remaining_at_close, r.shortage_quantity, r.shortage_norm_percent, "
                    "  r.cost_per_unit, r.penalty_total, r.completed_at, m.unit, s.name "
                    "FROM rolls r "
                    "JOIN materials m ON m.id = r.material_id "
                    "LEFT JOIN suppliers s ON s.id = r.supplier_id "
                    "WHERE r.status = 'completed' AND r.remaining_at_close IS NOT NULL "
                    "  AND (SELECT COUNT(DISTINCT o.cutter_user_id) FROM order_material_usage omu "
                    "       JOIN orders o ON o.id = omu.order_id "
                    "       WHERE omu.roll_id = r.id AND o.cutter_user_id IS NOT NULL) <= 1 "
                    # Либо она кроила по этому рулону, либо (когда раскрой не записан)
                    # она его закрывала — те же правила, что и в сводной таблице.
                    "  AND (EXISTS (SELECT 1 FROM order_material_usage omu2 "
                    "       JOIN orders o2 ON o2.id = omu2.order_id "
                    "       WHERE omu2.roll_id = r.id AND o2.cutter_user_id = %s) "
                    "   OR (r.closed_by_user_id = %s AND NOT EXISTS ("
                    "       SELECT 1 FROM order_material_usage omu3 "
                    "       JOIN orders o3 ON o3.id = omu3.order_id "
                    "       WHERE omu3.roll_id = r.id AND o3.cutter_user_id IS NOT NULL))) "
                    "ORDER BY r.completed_at DESC LIMIT 200",
                    (cutter_id, cutter_id),
                )
                items = []
                for r in cur.fetchall():
                    initial = float(r[4] or 0)
                    lost = float(r[5] or 0)
                    norm = float(r[7]) if r[7] is not None else None
                    cost = float(r[8] or 0)
                    allowed = initial * norm / 100 if norm is not None else None
                    excess = max(lost - allowed, 0) if allowed is not None else 0
                    items.append({
                        'rollId': r[0],
                        'barcode': r[1],
                        'materialName': r[2],
                        'shiftNumber': r[3],
                        'initialQuantity': round(initial, 2),
                        'lostQuantity': round(lost, 2),
                        'declaredShortage': round(float(r[6] or 0), 2),
                        'normPercent': norm,
                        'allowed': round(allowed, 2) if allowed is not None else None,
                        'excess': round(excess, 2),
                        'money': round(excess * cost, 2),
                        # Решение администратора: 0 — простил, число — удержал, null — не смотрел.
                        'penaltyTotal': float(r[9]) if r[9] is not None else None,
                        'closedAt': (r[10].isoformat() + 'Z') if r[10] else None,
                        'unit': r[11],
                        'supplierName': r[12],
                    })
            finally:
                conn.close()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'items': items}, ensure_ascii=False, default=str),
            }

        if params.get('stock_value'):
            # Сколько денег лежит в остатках материалов. Считаем по себестоимости КАЖДОГО
            # рулона: один материал у разных поставщиков стоит по-разному, плюс в цену
            # входят курс и логистика конкретной поставки. Показывается только админу.
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT m.id, m.name, m.unit, mt.name, "
                    "COALESCE(SUM(r.remaining_quantity), 0), "
                    "COALESCE(SUM(r.remaining_quantity * r.cost_per_unit), 0), "
                    "COUNT(*), "
                    "COUNT(*) FILTER (WHERE r.cost_per_unit IS NULL), "
                    "COALESCE(SUM(r.remaining_quantity) FILTER (WHERE r.status = 'in_storage'), 0), "
                    "COALESCE(SUM(r.remaining_quantity) FILTER (WHERE r.status = 'in_workshop'), 0), "
                    # Раньше было одно число на склад и цех вместе: кладовщик видел
                    # 55 рулонов бамбука, а на полке лежало 36 — остальные были в цехе.
                    "COUNT(*) FILTER (WHERE r.status = 'in_storage'), "
                    "COUNT(*) FILTER (WHERE r.status = 'in_workshop') "
                    "FROM rolls r "
                    "JOIN materials m ON m.id = r.material_id "
                    "LEFT JOIN material_types mt ON mt.id = m.type_id "
                    "WHERE r.status IN ('in_storage', 'in_workshop') AND r.remaining_quantity > 0 "
                    "GROUP BY m.id, m.name, m.unit, mt.name "
                    "ORDER BY 6 DESC"
                )
                by_material = [
                    {
                        'materialId': row[0],
                        'material': row[1],
                        'unit': row[2],
                        'materialType': row[3],
                        'remaining': float(row[4]),
                        'value': float(row[5]),
                        'rolls': row[6],
                        # Рулоны без себестоимости — их стоимость в сумму не попала.
                        'rollsWithoutCost': row[7],
                        'inStorage': float(row[8]),
                        'inWorkshop': float(row[9]),
                        'rollsInStorage': row[10],
                        'rollsInWorkshop': row[11],
                    }
                    for row in cur.fetchall()
                ]

                total_value = sum(m['value'] for m in by_material)
                without_cost = sum(m['rollsWithoutCost'] for m in by_material)
            finally:
                conn.close()

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'byMaterial': by_material,
                    'totalValue': total_value,
                    'rollsWithoutCost': without_cost,
                }, ensure_ascii=False),
            }

        if params.get('shortage_stats'):
            date_from = (params.get('from') or '').strip()
            date_to = (params.get('to') or '').strip()
            where = ["r.status = 'completed'", "r.initial_quantity > 0"]
            if date_from:
                where.append(f"r.completed_at >= '{date_from.replace(chr(39), chr(39)*2)}'")
            if date_to:
                where.append(f"r.completed_at < ('{date_to.replace(chr(39), chr(39)*2)}'::date + 1)")
            where_sql = ' AND '.join(where)

            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                # По каждому материалу: сколько рулонов закрыто, средняя/макс недостача в
                # процентах и во что она обошлась В ДЕНЬГАХ.
                #
                # Деньги считаем по себестоимости КАЖДОГО рулона (rolls.cost_per_unit), а не
                # по средней цене материала: один и тот же материал у разных поставщиков
                # стоит по-разному, плюс в себестоимость входит курс валюты и логистика
                # конкретной поставки. Только так сумма недостачи получается точной.
                # Цена берётся только с рулона: справочная цена материала убрана, все рулоны
                # получают себестоимость при приёмке от поставщика.
                cur.execute(
                    "SELECT m.id, m.name, m.unit, COALESCE(AVG(NULLIF(r.cost_per_unit, 0)), 0), "
                    "m.shortage_norm_percent, "
                    "COUNT(*), "
                    "COALESCE(SUM(r.shortage_quantity), 0), "
                    "COALESCE(AVG(r.shortage_quantity / r.initial_quantity * 100), 0), "
                    "COALESCE(MAX(r.shortage_quantity / r.initial_quantity * 100), 0), "
                    "COUNT(*) FILTER (WHERE r.shortage_quantity > 0), "
                    "COALESCE(SUM(r.shortage_quantity * COALESCE(r.cost_per_unit, 0)), 0), "
                    "COALESCE(AVG(NULLIF(r.cost_per_unit, 0)), 0) "
                    "FROM rolls r JOIN materials m ON m.id = r.material_id "
                    f"WHERE {where_sql} "
                    "GROUP BY m.id, m.name, m.unit, m.shortage_norm_percent "
                    "ORDER BY 8 DESC"
                )
                by_material = [
                    {
                        'materialId': row[0],
                        'material': row[1],
                        'unit': row[2],
                        'cost': float(row[3]),
                        'normPercent': float(row[4]) if row[4] is not None else None,
                        'rollsClosed': row[5],
                        'shortageTotal': float(row[6]),
                        'avgPercent': float(row[7]),
                        'maxPercent': float(row[8]),
                        'rollsWithShortage': row[9],
                        # Точная сумма недостачи — по себестоимости каждого рулона.
                        'costTotal': float(row[10]),
                        # Средняя себестоимость единицы по закрытым рулонам материала.
                        'avgCostPerUnit': float(row[11]),
                    }
                    for row in cur.fetchall()
                ]

                # По закройщикам: у кого недостача выше средней — это будущие кандидаты
                # на списание, когда нормы будут введены.
                cur.execute(
                    "SELECT r.closed_by_user_id, COALESCE(r.closed_by_name, 'Не указан'), "
                    "COUNT(*), COALESCE(SUM(r.shortage_quantity), 0), "
                    "COALESCE(AVG(r.shortage_quantity / r.initial_quantity * 100), 0), "
                    "COALESCE(SUM(r.shortage_quantity * COALESCE(r.cost_per_unit, 0)), 0) "
                    "FROM rolls r JOIN materials m ON m.id = r.material_id "
                    f"WHERE {where_sql} "
                    "GROUP BY r.closed_by_user_id, r.closed_by_name "
                    "ORDER BY 5 DESC"
                )
                by_user = [
                    {
                        'userId': row[0],
                        'userName': row[1],
                        'rollsClosed': row[2],
                        'shortageTotal': float(row[3]),
                        'avgPercent': float(row[4]),
                        'costTotal': float(row[5]),
                    }
                    for row in cur.fetchall()
                ]

                # Полный список закрытых рулонов — чтобы можно было посмотреть каждый случай.
                cur.execute(
                    "SELECT r.id, r.barcode, m.name, m.unit, r.initial_quantity, "
                    "r.shortage_quantity, "
                    "CASE WHEN r.initial_quantity > 0 "
                    "THEN r.shortage_quantity / r.initial_quantity * 100 ELSE 0 END, "
                    "COALESCE(r.closed_by_name, ''), r.completed_at, "
                    # Себестоимость именно этого рулона: раньше здесь бралась общая цена
                    # материала, из-за чего детализация расходилась с итоговой суммой.
                    "r.shortage_quantity * COALESCE(r.cost_per_unit, 0) "
                    "FROM rolls r JOIN materials m ON m.id = r.material_id "
                    f"WHERE {where_sql} "
                    "ORDER BY r.completed_at DESC LIMIT 500"
                )
                rolls_list = [
                    {
                        'id': row[0],
                        'barcode': row[1],
                        'material': row[2],
                        'unit': row[3],
                        'initialQuantity': float(row[4]),
                        'shortage': float(row[5]),
                        'shortagePercent': float(row[6]),
                        'closedBy': row[7],
                        'completedAt': (row[8].isoformat() + 'Z') if row[8] else None,
                        'cost': float(row[9]),
                    }
                    for row in cur.fetchall()
                ]

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'byMaterial': by_material,
                        'byUser': by_user,
                        'rolls': rolls_list,
                    }),
                }
            finally:
                conn.close()

        # Детальная карточка рулона: сам рулон + история движений (расход на заказы и
        # списание брака). Позволяет "провалиться" в рулон и увидеть, сколько осталось,
        # кто и когда использовал материал, включая списания брака (в т.ч. с терминала).
        if roll_id:
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT r.id, r.barcode, r.material_id, m.name, m.unit, r.workshop_id, w.name, "
                    "r.shift_number, r.initial_quantity, r.remaining_quantity, r.status, "
                    "r.created_at, r.completed_at, mt.name, "
                    "r.purchase_price, r.purchase_currency, r.purchase_rate, "
                    "r.logistics_per_unit, r.cost_per_unit, s.name, r.shipment_id "
                    "FROM rolls r "
                    "LEFT JOIN materials m ON m.id = r.material_id "
                    "LEFT JOIN material_types mt ON mt.id = m.type_id "
                    "LEFT JOIN workshops w ON w.id = r.workshop_id "
                    "LEFT JOIN suppliers s ON s.id = r.supplier_id "
                    "WHERE r.id = %s",
                    (int(roll_id),),
                )
                r = cur.fetchone()
                if not r:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                material_type = r[13]
                # За брак отвечает тот, кто физически работает с этим материалом:
                # Тюль (ткань) — закройщик, Аксессуары (тесьма) — швея, Упаковка — упаковщик.
                # Для незнакомого типа ответственного не назначаем, чтобы не обвинить не того.
                responsible_by_type = {
                    'Тюль': ('cutter', 'закройщик'),
                    'Аксессуары': ('sewer', 'швея'),
                    'Упаковка': ('packer', 'упаковщик'),
                }
                defect_role, defect_role_label = responsible_by_type.get(
                    material_type, (None, None)
                )
                is_fabric = (material_type == 'Тюль')
                roll = {
                    'id': r[0], 'barcode': r[1], 'materialId': r[2], 'materialName': r[3],
                    'unit': r[4], 'workshopId': r[5], 'workshopName': r[6], 'shiftNumber': r[7],
                    'initialQuantity': float(r[8]), 'remainingQuantity': float(r[9]),
                    'status': r[10], 'createdAt': r[11].isoformat() + 'Z',
                    'completedAt': (r[12].isoformat() + 'Z') if r[12] else None,
                    'materialType': material_type,
                    'kind': 'fabric' if is_fabric else 'trim',
                    'defectRole': defect_role,
                    'defectRoleLabel': defect_role_label,
                    # Себестоимость рулона: из чего сложилась цена единицы. Показывается
                    # ТОЛЬКО администратору — на фронте блок скрыт от остальных ролей.
                    'supplierName': r[19],
                    'shipmentId': r[20],
                    'purchasePrice': float(r[14]) if r[14] is not None else None,
                    'purchaseCurrency': r[15],
                    'purchaseRate': float(r[16]) if r[16] is not None else None,
                    'logisticsPerUnit': float(r[17]) if r[17] is not None else 0.0,
                    'costPerUnit': float(r[18]) if r[18] is not None else None,
                }

                history = []
                # Расход на заказы (раскрой / стикеровка). Для каждого движения строим «лесенку»
                # этапов заказа: кто раскроил → кто сшил → кто упаковал.
                cur.execute(
                    "SELECT omu.quantity, omu.created_at, o.order_number, "
                    "cu.full_name, su.full_name, pu.full_name, o.cut_at "
                    "FROM order_material_usage omu "
                    "JOIN orders o ON o.id = omu.order_id "
                    "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                    "LEFT JOIN users su ON su.id = o.sewer_user_id "
                    "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                    "WHERE omu.roll_id = %s",
                    (int(roll_id),),
                )
                for row in cur.fetchall():
                    stages = [
                        {'role': 'cutter', 'label': 'Раскрой',
                         'userName': row[3],
                         'at': (row[6].isoformat() + 'Z') if row[6] else None},
                        {'role': 'sewer', 'label': 'Пошив', 'userName': row[4], 'at': None},
                        {'role': 'packer', 'label': 'Упаковка', 'userName': row[5], 'at': None},
                    ]
                    history.append({
                        'kind': 'order',
                        'quantity': float(row[0]),
                        'createdAt': row[1].isoformat() + 'Z',
                        'orderNumber': row[2],
                        'userName': row[3] or row[4],
                        'comment': None,
                        'stages': stages,
                    })

                # Списание брака. Ответственный определён выше по типу материала. Пока
                # конкретного исполнителя нет — показываем создателя документа (в дальнейшем
                # при логине по штрих-коду на терминале подтянется реальный сотрудник).
                cur.execute(
                    "SELECT si.quantity, s.created_at, s.comment, cu.full_name, s.type "
                    "FROM shipment_items si "
                    "JOIN shipments s ON s.id = si.shipment_id "
                    "LEFT JOIN users cu ON cu.id = s.created_by "
                    "WHERE si.roll_id = %s AND s.type IN ('defect_writeoff', 'return_to_supplier', 'workshop_writeoff')",
                    (int(roll_id),),
                )
                for row in cur.fetchall():
                    is_defect = (row[4] == 'defect_writeoff')
                    history.append({
                        'kind': 'defect' if is_defect else row[4],
                        'quantity': float(row[0]) if row[0] is not None else 0.0,
                        'createdAt': row[1].isoformat() + 'Z',
                        'orderNumber': None,
                        'userName': row[3],
                        'comment': row[2],
                        'defectRole': defect_role if is_defect else None,
                        'defectRoleLabel': defect_role_label if is_defect else None,
                        'stages': None,
                    })

                # Закрытие рулона закройщиком. Остаток обнуляется целиком, но записи
                # об этом в истории не было — рулон выглядел израсходованным «сам собой».
                cur.execute(
                    "SELECT r.completed_at, r.shortage_quantity, r.closed_by_name, u.full_name "
                    "FROM rolls r LEFT JOIN users u ON u.id = r.closed_by_user_id "
                    "WHERE r.id = %s AND r.status = 'completed' AND r.completed_at IS NOT NULL",
                    (int(roll_id),),
                )
                c_row = cur.fetchone()
                if c_row and (c_row[2] or c_row[3]):
                    shortage_val = float(c_row[1] or 0)
                    history.append({
                        'kind': 'close',
                        'quantity': shortage_val,
                        'createdAt': c_row[0].isoformat() + 'Z',
                        'orderNumber': None,
                        'userName': c_row[3] or c_row[2],
                        'comment': (
                            f'Недостача {round(shortage_val, 2)}' if shortage_val > 0
                            else 'Рулон израсходован полностью'
                        ),
                        'stages': None,
                    })

                history.sort(key=lambda h: h['createdAt'], reverse=True)

                # Сколько материала подтверждено историей, а сколько ушло без следа.
                # Расхождение возникает у рулонов, перенесённых из старой системы: там
                # остались только итоговые остатки, без движений по заказам.
                tracked = sum(
                    h['quantity'] for h in history if h['kind'] != 'close'
                )
                used_total = float(roll['initialQuantity']) - float(roll['remainingQuantity'])
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({
                            'roll': roll,
                            'history': history,
                            'trackedQuantity': round(tracked, 3),
                            'untrackedQuantity': round(max(0.0, used_total - tracked), 3),
                        })}
            finally:
                conn.close()

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            conditions = []
            # Поиск по штрихкоду ищем в БАЗЕ, а не в загруженном списке: список
            # ограничен свежими рулонами, и закрытый рулон полугодовой давности
            # иначе бы не нашёлся вообще.
            search = (params.get('search') or '').strip()
            if search:
                search_esc = search.replace("'", "''").replace('%', '')
                conditions.append(f"r.barcode ILIKE '%{search_esc}%'")
            if material_id:
                conditions.append(f"r.material_id = {int(material_id)}")
            if status:
                status_esc = status.replace("'", "''")
                conditions.append(f"r.status = '{status_esc}'")

            # forUserId — производственная роль (швея/закройщик/упаковщик) смотрит рулоны:
            # показываем ТОЛЬКО рулоны цеха её текущей открытой смены. Склад и рулоны чужих
            # цехов ей не видны. Кладовщику и админу этот параметр не передаётся — они
            # видят всё. Без открытой смены список пустой.
            for_user_id = params.get('forUserId')
            session_shift = None
            session_workshop = None
            if for_user_id:
                cur.execute(
                    "SELECT ss.workshop_id, ss.shift_number, ss.role FROM shift_sessions ss "
                    "WHERE ss.user_id = %s AND ss.closed_at IS NULL "
                    "ORDER BY ss.opened_at DESC LIMIT 1",
                    (int(for_user_id),),
                )
                sess = cur.fetchone()
                if sess and sess[0]:
                    # Материал показываем по ЦЕХУ, где человек физически находится.
                    # Гость пришёл в чужой цех — работает с материалом ЭТОГО цеха, а
                    # свой домашний не видит совсем: иначе он выберет рулон, до которого
                    # не дотянется рукой, и списание уйдёт с коробки в другом помещении.
                    conditions.append(f"r.workshop_id = {int(sess[0])}")

                    # Сначала пробуем показать рулоны СВОЕЙ смены. Если в цехе нет
                    # ни одного подходящего рулона своей смены (частый случай у гостя:
                    # тесьма лежит на другой смене этого же цеха) — показываем весь цех,
                    # а рулоны чужой смены помечаем, чтобы швея видела, что берёт чужое.
                    session_shift = sess[1]
                    session_workshop = sess[0]
                else:
                    session_shift = None
                    conditions.append("1 = 0")

                # Каждая производственная роль работает со своим материалом, и лишние
                # рулоны в списке только мешают и провоцируют ошибки при списании:
                #   закройщик — тюль (полотно, которое он кроит);
                #   швея      — тесьма (аксессуары, которые она пришивает);
                #   упаковщик — пакеты и этикетки (упаковка).
                # Роль ищем в трёх местах по убыванию точности: что прислал экран,
                # что записано в открытой смене, что стоит в карточке сотрудника.
                # Приоритет — роль, ЯВНО присланная экраном: это должность, в
                # которой человек работает прямо сейчас. У совместителя (швея +
                # закройщик) в открытой смене может стоять другая должность —
                # тогда швее подбирался тюль вместо тесьмы, и выбрать рулон было
                # не из чего. Смена и карточка остаются запасными вариантами.
                actual_role = (params.get('forRole') or '').strip() or None
                if actual_role not in ('sewer', 'cutter', 'packer'):
                    actual_role = None
                if not actual_role and sess and len(sess) > 2 and sess[2]:
                    actual_role = sess[2]
                if not actual_role:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(for_user_id),))
                    role_row = cur.fetchone()
                    actual_role = role_row[0] if role_row else None
                role_types = {
                    'cutter': 'Тюль',
                    'sewer': 'Аксессуары',
                    'packer': 'Упаковка',
                }
                allowed_type = role_types.get(actual_role)
                if allowed_type:
                    type_esc = allowed_type.replace("'", "''")
                    conditions.append(
                        "m.type_id = (SELECT id FROM material_types WHERE name = "
                        f"'{type_esc}')"
                    )

            # Своя смена в приоритете: если в цехе есть подходящие рулоны своей смены,
            # чужие не показываем — иначе в списке мешанина. Если своих нет (гость пришёл
            # в цех, где нужный материал лежит на другой смене) — открываем весь цех.
            # Смена без собственного материала (в ней одни швеи) работает материалом
            # соседних смен цеха — сужать выборку до её номера нельзя вообще, иначе
            # список рулонов всегда пуст и тесьму не выбрать.
            shift_has_no_material = False
            if for_user_id and session_shift is not None and session_workshop:
                cur.execute(
                    "SELECT COALESCE(material_free_shifts, '[]'::jsonb) FROM workshops WHERE id = %s",
                    (int(session_workshop),),
                )
                mf_row = cur.fetchone()
                if mf_row:
                    mf = mf_row[0] if isinstance(mf_row[0], list) else json.loads(mf_row[0] or '[]')
                    shift_has_no_material = int(session_shift) in {int(x) for x in mf}

            if for_user_id and session_shift is not None and not shift_has_no_material:
                own_conditions = conditions + [f"r.shift_number = {int(session_shift)}"]
                cur.execute(
                    "SELECT COUNT(*) FROM rolls r "
                    "LEFT JOIN materials m ON m.id = r.material_id "
                    f"WHERE {' AND '.join(own_conditions)}"
                )
                if cur.fetchone()[0] > 0:
                    conditions = own_conditions

            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            # Если передан usedSinceUserId — отмечаем, по каким рулонам было движение материала
            # в ТЕКУЩЕЙ открытой смене этого сотрудника (терминал показывает такие рулоны
            # активными, а остальные — затуманенными, пока с ними не начали работать).
            used_roll_ids = set()
            used_since_user_id = (event.get('queryStringParameters') or {}).get('usedSinceUserId')
            if used_since_user_id:
                cur.execute(
                    "SELECT opened_at FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(used_since_user_id),),
                )
                s_row = cur.fetchone()
                if s_row:
                    cur.execute(
                        "SELECT DISTINCT roll_id FROM order_material_usage "
                        "WHERE roll_id IS NOT NULL AND created_at >= %s",
                        (s_row[0],),
                    )
                    used_roll_ids = {r[0] for r in cur.fetchall()}

            cur.execute(
                f"SELECT r.id, r.barcode, r.material_id, m.name, m.unit, r.workshop_id, w.name, "
                f"r.shift_number, r.initial_quantity, r.remaining_quantity, r.status, "
                f"r.created_at, r.completed_at, COALESCE(r.shortage_quantity, 0), r.accepted_at, "
                f"r.defect_flagged_at, r.defect_flagged_by_name, r.defect_reason, "
                # Сколько материала РЕАЛЬНО ушло в заказы и в брак по этому рулону.
                # Нужно закройщику и швее при закрытии: если система знает, что из
                # рулона израсходовано 470 из 500 м, то заявленная недостача в 300 м
                # физически невозможна — таких метров на рулоне уже не было.
                f"COALESCE((SELECT SUM(omu.quantity) FROM order_material_usage omu "
                f"          WHERE omu.roll_id = r.id), 0) "
                f"FROM rolls r "
                f"LEFT JOIN materials m ON m.id = r.material_id "
                f"LEFT JOIN workshops w ON w.id = r.workshop_id "
                f"{where_clause} "
                # Ограничиваем выборку: рулонов накопились тысячи, и 90% из них
                # закрыты — они грузились в браузер каждый раз впустую, по 2 МБ.
                # Список на странице всё равно показывает по 20 штук, а закрытые
                # ищут поиском по штрихкоду или фильтром по статусу.
                f"ORDER BY r.created_at DESC, r.id DESC LIMIT {ROLLS_LIST_LIMIT}"
            )
            rolls = [
                {
                    'id': r[0],
                    'barcode': r[1],
                    'materialId': r[2],
                    'materialName': r[3],
                    'unit': r[4],
                    'workshopId': r[5],
                    'workshopName': r[6],
                    'shiftNumber': r[7],
                    'initialQuantity': float(r[8]),
                    'remainingQuantity': float(r[9]),
                    'status': r[10],
                    'createdAt': r[11].isoformat() + 'Z',
                    'completedAt': (r[12].isoformat() + 'Z') if r[12] else None,
                    'shortageQuantity': float(r[13] or 0),
                    # Рулон отгружен в цех, но смена его ещё не приняла: работать с ним
                    # нельзя, пока заявку не подтвердят. Терминал помечает такие рулоны.
                    'pendingAcceptance': r[10] == 'in_workshop' and r[14] is None,
                    'usedInShift': r[0] in used_roll_ids,
                    # Рулон другой смены этого же цеха: гость работает с ним, потому что
                    # своего материала в цехе нет. Показываем пометку, чтобы человек
                    # понимал — берёт чужое, и расход запишется как работа за другую смену.
                    'foreignShift': (
                        session_shift is not None and r[7] is not None
                        and int(r[7]) != int(session_shift)
                    ),
                    # Закройщик отставил рулон из-за брака: в работу он не идёт и ждёт,
                    # когда кладовщик заберёт его на склад или откажет в заборе.
                    'defectFlaggedAt': (r[15].isoformat() + 'Z') if r[15] else None,
                    'defectFlaggedByName': r[16],
                    'defectReason': r[17],
                    # Фактический расход по заказам — по нему терминал проверяет недостачу.
                    'usedQuantity': float(r[18] or 0),
                }
                for r in cur.fetchall()
            ]

            # Выбрасываем пустые поля: отметки о браке и о чужой смене есть у единиц
            # рулонов, а место занимают в каждом из восьмисот. Интерфейс везде проверяет
            # значение на пустоту, поэтому отсутствующее поле читается так же, как пустое.
            rolls = [
                {k: v for k, v in roll.items() if v is not None and v != ''}
                for roll in rolls
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'rolls': rolls})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                # Рулоны появляются в системе ТОЛЬКО через приёмку от поставщика — так у
                # каждой партии есть документ прихода, поставщик и цена. Ручное создание
                # доступно лишь администратору (исправление данных), кладовщику — нет.
                actor_role = (body_data.get('actorRole') or '').strip()
                if actor_role and actor_role != 'admin':
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Рулоны заводятся приёмкой от поставщика '
                                     '(Отгрузки → Отгрузка от поставщика)'
                        }),
                    }

                barcode = (body_data.get('barcode') or '').strip()
                material_id = body_data.get('materialId')
                initial_quantity = body_data.get('initialQuantity')
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')

                if not barcode or not material_id or initial_quantity in (None, ''):
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите штрихкод, материал и начальное количество'}),
                    }

                # Метраж рулона всегда положительный: рулон «на минус метров» дал бы
                # отрицательный остаток материала на складе.
                if float(initial_quantity) <= 0:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Количество должно быть больше нуля'}, ensure_ascii=False
                        ),
                    }

                # Рулон, отправленный сразу в цех, обязан принадлежать конкретной смене —
                # "ничейных" рулонов в цехе быть не должно (проверяется и на уровне БД).
                if workshop_id not in (None, '') and shift_number in (None, ''):
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'При выборе цеха укажите смену'}),
                    }

                barcode_esc = barcode.replace("'", "''")
                cur.execute(f"SELECT id FROM rolls WHERE barcode = '{barcode_esc}'")
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Рулон со штрихкодом {barcode} уже существует'}),
                    }

                workshop_sql = int(workshop_id) if workshop_id not in (None, '') else 'NULL'
                shift_sql = int(shift_number) if shift_number not in (None, '') else 'NULL'
                status = 'in_workshop' if workshop_id not in (None, '') else 'in_storage'

                # Рулон, заведённый сразу в цех, считается принятым: подтверждать нечего —
                # его не везли заявкой, он уже лежит у смены. Отметка о приёмке нужна,
                # иначе такой рулон навсегда остаётся «не принят» и его нельзя закрыть.
                accepted_sql = 'now()' if status == 'in_workshop' else 'NULL'

                cur.execute(
                    f"INSERT INTO rolls (barcode, material_id, workshop_id, shift_number, "
                    f"initial_quantity, remaining_quantity, status, accepted_at) "
                    f"VALUES ('{barcode_esc}', {int(material_id)}, {workshop_sql}, {shift_sql}, "
                    f"{float(initial_quantity)}, {float(initial_quantity)}, '{status}', {accepted_sql}) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute(
                    "SELECT status, workshop_id, shift_number FROM rolls WHERE id = %s", (int(item_id),)
                )
                current_row = cur.fetchone()
                if not current_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                cur_status, cur_workshop_id, cur_shift_number = current_row

                new_status = body_data.get('status', cur_status)
                new_workshop_id = body_data['workshopId'] if 'workshopId' in body_data else cur_workshop_id
                new_shift_number = body_data['shiftNumber'] if 'shiftNumber' in body_data else cur_shift_number

                # Рулон в статусе "в цехе" обязан иметь и цех, и смену — та же гарантия,
                # что и на уровне БД (rolls_workshop_requires_shift), проверяем заранее,
                # чтобы вернуть понятную ошибку вместо сырого исключения psycopg2.
                if new_status == 'in_workshop' and (new_workshop_id in (None, '') or new_shift_number in (None, '')):
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Для статуса "в цехе" укажите и цех, и смену'}),
                    }

                fields = []
                if 'status' in body_data:
                    status_esc = str(body_data['status']).replace("'", "''")
                    fields.append(f"status = '{status_esc}'")
                    if body_data['status'] == 'completed':
                        fields.append("completed_at = now()")
                    # Рулон переводят в цех руками (не заявкой) — подтверждать доставку
                    # некому, поэтому сразу считаем его принятым и годным в работу.
                    if body_data['status'] == 'in_workshop':
                        fields.append("accepted_at = COALESCE(accepted_at, now())")
                if 'workshopId' in body_data:
                    val = body_data['workshopId']
                    fields.append(f"workshop_id = {int(val) if val not in (None, '') else 'NULL'}")
                if 'shiftNumber' in body_data:
                    val = body_data['shiftNumber']
                    fields.append(f"shift_number = {int(val) if val not in (None, '') else 'NULL'}")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE rolls SET {', '.join(fields)} WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'write_off':
                # Ручное списание метража с конкретного рулона.
                #
                # Нужно, когда материал уходит не в пошив: продали знакомому,
                # отрезали на образец, испортили при перемотке. Раньше такой
                # расход было некуда деть — остаток в системе расходился с тем,
                # что реально лежит на полке, и это всплывало на инвентаризации.
                #
                # Списывает только администратор: это движение денег в чистом
                # виде, и след о нём должен оставаться именной.
                item_id = body_data.get('id')
                quantity = body_data.get('quantity')
                order_id = body_data.get('orderId')
                actor_id = body_data.get('actorId')
                reason = (body_data.get('reason') or '').strip()

                if not item_id or quantity in (None, ''):
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Укажите рулон и количество'},
                                               ensure_ascii=False)}

                try:
                    qty = float(quantity)
                except (TypeError, ValueError):
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Количество должно быть числом'},
                                               ensure_ascii=False)}
                if qty <= 0:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Количество должно быть больше нуля'},
                                               ensure_ascii=False)}

                # Списание вручную доступно только администратору. Заказу
                # (order_id) списание приходит из терминала — там свои проверки.
                if not order_id:
                    if not actor_id:
                        return {'statusCode': 403, 'headers': headers,
                                'body': json.dumps({'error': 'Списывать материал может только администратор'},
                                                   ensure_ascii=False)}
                    cur.execute("SELECT role, full_name FROM users WHERE id = %s",
                                (int(actor_id),))
                    actor = cur.fetchone()
                    if not actor or actor[0] != 'admin':
                        return {'statusCode': 403, 'headers': headers,
                                'body': json.dumps({'error': 'Списывать материал может только администратор'},
                                                   ensure_ascii=False)}
                    if not reason:
                        return {'statusCode': 400, 'headers': headers,
                                'body': json.dumps({'error': 'Укажите причину списания — иначе в журнале '
                                                             'останется расход без объяснения'},
                                                   ensure_ascii=False)}

                cur.execute(
                    "SELECT remaining_quantity, material_id, status, accepted_at, barcode "
                    "FROM rolls WHERE id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}

                remaining, material_id, status, accepted_at, barcode = row

                # Рулон отгружен в цех, но смена его не приняла — материал мог не доехать
                # или приехать не в том количестве. Сначала приёмка, потом работа.
                if status == 'in_workshop' and accepted_at is None:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Рулон ещё не принят сменой. Подтвердите приёмку поставки, '
                                     'потом списывайте материал'
                        }, ensure_ascii=False),
                    }

                remaining = float(remaining or 0)
                # Больше, чем есть в рулоне, списать нельзя: иначе остаток уйдёт
                # в минус и склад начнёт показывать несуществующий материал.
                if qty > remaining + 0.001:
                    cur.execute("SELECT unit FROM materials WHERE id = %s", (material_id,))
                    u_row = cur.fetchone()
                    unit = u_row[0] if u_row else ''
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'В рулоне осталось {round(remaining, 2)} {unit} — '
                                     f'списать {round(qty, 2)} нельзя'
                        }, ensure_ascii=False),
                    }

                new_remaining = round(remaining - qty, 3)
                new_status_sql = (", status = 'completed', completed_at = now()"
                                  if new_remaining <= 0 else "")

                cur.execute(
                    f"UPDATE rolls SET remaining_quantity = %s{new_status_sql} WHERE id = %s",
                    (new_remaining, int(item_id)),
                )

                if order_id:
                    cur.execute(
                        "INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
                        "VALUES (%s, %s, %s, %s)",
                        (int(order_id), int(material_id), int(item_id), qty),
                    )
                else:
                    # Ручное списание попадает в журнал движений материала — туда
                    # же, где приход от поставщика и расход в производство. Иначе
                    # остаток «просто уменьшился», и на инвентаризации это
                    # выглядело бы как недостача без объяснения.
                    who = actor[1] if actor and actor[1] else 'Администратор'
                    cur.execute(
                        "INSERT INTO material_movements (material_id, quantity, "
                        "  movement_type, reference) VALUES (%s, %s, 'Списание', %s)",
                        (int(material_id), -qty,
                         f'рулон {barcode or item_id} · {reason} · {who}'),
                    )
                    cur.execute(
                        "INSERT INTO audit_log (category, user_id, user_name, action, "
                        "entity_type, entity_id, description) VALUES "
                        "('warehouse', %s, %s, 'roll_write_off', 'roll', %s, %s)",
                        (int(actor_id), who, int(item_id),
                         f'Списано {round(qty, 2)} с рулона {barcode or item_id}: {reason}'),
                    )

                conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'success': True,
                                            'remainingQuantity': new_remaining})}

            # Закрытие рулона в цехе (терминал): рулон физически закончился. Остаток списывается
            # полностью, а если ткани не хватило — дополнительно фиксируется недостача (метраж,
            # которого не оказалось в рулоне). Рулон переводится в статус completed.
            if action == 'close_roll':
                item_id = body_data.get('id')
                shortage = body_data.get('shortage') or 0
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                try:
                    shortage = float(shortage)
                except (TypeError, ValueError):
                    shortage = 0.0

                cur.execute(
                    "SELECT r.remaining_quantity, r.status, r.workshop_id, mt.name, "
                    "r.initial_quantity, "
                    # Фактический расход по заказам — им перепроверяем недостачу.
                    "COALESCE((SELECT SUM(omu.quantity) FROM order_material_usage omu "
                    "          WHERE omu.roll_id = r.id), 0) "
                    "FROM rolls r "
                    "LEFT JOIN materials m ON m.id = r.material_id "
                    "LEFT JOIN material_types mt ON mt.id = m.type_id "
                    "WHERE r.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                if row[1] == 'completed':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Рулон уже закрыт'})}

                # Рулон нельзя закрыть, пока на нём остаётся слишком много материала:
                # тюль — по настройке цеха min_remaining_to_close_fabric (по умолчанию 20 м),
                # тесьма/аксессуары — min_remaining_to_close_trim (по умолчанию 80 м).
                remaining_now = float(row[0] or 0)
                type_name = row[3] or ''
                setting_key = 'min_remaining_to_close_fabric' if type_name == 'Тюль' else 'min_remaining_to_close_trim'
                default_limit = 20.0 if type_name == 'Тюль' else 80.0
                limit = default_limit
                cur.execute(
                    "SELECT value FROM workshop_settings WHERE workshop_id = %s AND key = %s",
                    (row[2], setting_key),
                )
                s_row = cur.fetchone()
                if not s_row:
                    cur.execute("SELECT value FROM system_settings WHERE key = %s", (setting_key,))
                    s_row = cur.fetchone()
                if s_row and s_row[0] not in (None, ''):
                    try:
                        limit = float(s_row[0])
                    except (TypeError, ValueError):
                        limit = default_limit

                if remaining_now > limit:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Рулон нельзя закрыть: на нём ещё {round(remaining_now, 2)} м '
                                     f'(закрытие возможно при остатке до {round(limit, 2)} м)'
                        }),
                    }

                # Запоминаем, кто закрыл рулон: по этим данным копится статистика недостач
                # в разрезе закройщиков и тканей — она понадобится для будущих норм списания.
                closed_by_id = body_data.get('userId')
                closed_by_name = (body_data.get('userName') or '').strip()
                # Недостача не может превышать остаток: закройщик списывает то, чего не
                # хватило В САМОМ РУЛОНЕ, а не вообще. Если по системе на рулоне 5 м, а
                # недостача заявлена 90 м — это опечатка (лишний ноль, метры вместо
                # сантиметров). Раньше такие цифры проходили молча: в базе накопились
                # рулоны с недостачей до 100 000 м, и вся статистика по недостачам врала.
                if shortage > remaining_now:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Недостача {round(shortage, 2)} м больше остатка на рулоне '
                                     f'({round(remaining_now, 2)} м). Проверьте цифру: списать '
                                     f'можно только то, чего не хватило в самом рулоне.'
                        }, ensure_ascii=False),
                    }

                # Вторая проверка — по фактическому расходу. Остаток в рулоне система
                # ведёт сама, но при переносе данных и ручных правках он мог разъехаться
                # с реальностью. Расход по заказам — твёрдый факт: столько метров ушло
                # в сшитые вещи. Больше, чем «начальный метраж минус израсходованное»,
                # не хватать физически не может.
                #
                # Пример: коробка тесьмы 1500 м, в заказы ушло 1400 — заявить недостачу
                # 300 м нельзя, таких метров в коробке не оставалось.
                initial_qty = float(row[4] or 0)
                used_qty = float(row[5] or 0)
                if initial_qty > 0:
                    max_possible = initial_qty - used_qty
                    if shortage > max_possible + 0.001:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': (
                                    f'Недостача {round(shortage, 2)} больше, чем могло остаться. '
                                    f'В рулоне было {round(initial_qty, 2)}, из них уже ушло в заказы '
                                    f'{round(used_qty, 2)} — не хватать могло максимум '
                                    f'{round(max_possible, 2)}. Проверьте цифру.'
                                )
                            }, ensure_ascii=False),
                        }

                cur.execute(
                    "UPDATE rolls SET remaining_quantity = 0, status = 'completed', completed_at = now(), "
                    "shortage_quantity = %s, remaining_at_close = %s, "
                    "closed_by_user_id = %s, closed_by_name = %s WHERE id = %s",
                    (
                        shortage,
                        # Фиксируем, сколько метров числилось на рулоне В МОМЕНТ закрытия:
                        # без этого числа недостачу нечем перепроверить.
                        remaining_now,
                        int(closed_by_id) if closed_by_id else None,
                        closed_by_name or None,
                        int(item_id),
                    ),
                )

                # Штраф здесь НЕ начисляется. Недостача может быть и не виной сотрудника
                # (поставщик недомотал, брак ткани), поэтому решение принимает администратор
                # вручную на дашборде — там видно рулон, сумму и кого коснётся удержание.
                #
                # Но если недостача вышла за норму поставщика — сообщаем администратору
                # сразу. Иначе рулон просто ложился в общий список, и разбор откладывался
                # до случайного захода в раздел.
                penalty = calc_shortage_penalty(cur, int(item_id))
                over_norm = bool(penalty and penalty.get('total', 0) > 0)
                if over_norm:
                    notify_admin(
                        cur, 'roll_shortage',
                        f'Недостача сверх нормы: {penalty["materialName"]}',
                        f'Рулон {penalty["barcode"]}: в изделия не ушло '
                        f'{round(remaining_now, 2)} {penalty["unit"]} при норме '
                        f'{penalty["allowed"]} {penalty["unit"]} ({penalty["normPercent"]}% '
                        f'от {round(initial_qty, 2)}). Сверх нормы {penalty["excess"]} '
                        f'{penalty["unit"]} на {penalty["total"]} ₽. '
                        f'Сотрудница заявила недостачу {round(shortage, 2)} {penalty["unit"]}.',
                        closed_by_id, closed_by_name,
                        # Страница «Анализ недостач» — там админ решает судьбу
                        # рулона (удержать с сотрудницы или списать на поставщика).
                        # Раньше здесь стоял несуществующий адрес /crm/warehouse/rolls,
                        # и кнопка «Открыть» в уведомлении вела на страницу 404.
                        link='/crm/analytics/roll-shortage',
                        entity_type='roll', entity_id=int(item_id),
                    )

                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'shortage': shortage,
                        'remainingAtClose': remaining_now,
                        'overNorm': over_norm,
                    }),
                }

            # Закройщик встретил брак в начале рулона (больше 10 пог.м): резать дальше
            # нельзя. Рулон физически остаётся в цехе, но в работу больше не идёт, а у
            # кладовщика появляется задача забрать его на склад.
            if action == 'flag_defect':
                item_id = body_data.get('id')
                reason = (body_data.get('reason') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите рулон'})}
                if not reason:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Опишите, что не так с рулоном'}, ensure_ascii=False)}

                cur.execute(
                    "SELECT status, defect_flagged_at, remaining_quantity FROM rolls WHERE id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                if row[0] == 'completed':
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': 'Рулон уже закрыт'}, ensure_ascii=False)}
                if row[1]:
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': 'Рулон уже помечен бракованным — ждёт забора кладовщиком'},
                                               ensure_ascii=False)}

                flagged_by = body_data.get('actorId')
                cur.execute(
                    "UPDATE rolls SET defect_flagged_at = now(), defect_flagged_by = %s, "
                    "defect_flagged_by_name = %s, defect_reason = %s, "
                    "defect_declined_at = NULL, defect_declined_reason = NULL WHERE id = %s",
                    (
                        int(flagged_by) if flagged_by else None,
                        (body_data.get('actorName') or '').strip() or None,
                        reason,
                        int(item_id),
                    ),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'success': True}, ensure_ascii=False)}

            # Кладовщик забирает бракованный рулон из цеха — СКАНЕРОМ, по штрихкоду
            # рулона. Так видно, что рулон реально доехал до склада, а не остался лежать
            # в цехе после формального подтверждения.
            if action == 'receive_defect_roll':
                scan = (body_data.get('barcode') or '').strip()
                if not scan:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Отсканируйте штрихкод рулона'}, ensure_ascii=False)}

                bc_esc = scan.replace("'", "''")
                cur.execute(
                    "SELECT r.id, r.status, r.defect_flagged_at, m.name, r.remaining_quantity, "
                    "m.unit, r.defect_reason, r.defect_flagged_by_name "
                    "FROM rolls r JOIN materials m ON m.id = r.material_id "
                    f"WHERE r.barcode = '{bc_esc}'"
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers,
                            'body': json.dumps({'error': f'Рулон {scan} не найден'}, ensure_ascii=False)}
                if not row[2]:
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': f'Рулон {scan} не помечен бракованным'},
                                               ensure_ascii=False)}
                if row[1] == 'in_storage':
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': f'Рулон {scan} уже на складе'}, ensure_ascii=False)}

                # Рулон уехал из цеха на склад: снимаем цех и смену, иначе он остался бы
                # числиться за сменой, которая с ним уже не работает.
                cur.execute(
                    "UPDATE rolls SET status = 'in_storage', workshop_id = NULL, "
                    "shift_number = NULL, accepted_at = NULL WHERE id = %s",
                    (int(row[0]),),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({
                            'success': True,
                            'barcode': scan,
                            'materialName': row[3],
                            'remaining': float(row[4] or 0),
                            'unit': row[5],
                            'reason': row[6],
                            'flaggedBy': row[7],
                        }, ensure_ascii=False)}

            # Кладовщик осмотрел рулон и брак не подтвердился — отказывает в заборе.
            # Пометка снимается, рулон снова доступен для заказов.
            if action == 'decline_defect_roll':
                item_id = body_data.get('id')
                reason = (body_data.get('reason') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите рулон'})}
                if not reason:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Напишите, почему отказываете в заборе'},
                                               ensure_ascii=False)}

                cur.execute("SELECT defect_flagged_at FROM rolls WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                if not row[0]:
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': 'Рулон не помечен бракованным'}, ensure_ascii=False)}

                cur.execute(
                    "UPDATE rolls SET defect_flagged_at = NULL, defect_flagged_by = NULL, "
                    "defect_flagged_by_name = NULL, defect_reason = NULL, "
                    "defect_declined_at = now(), defect_declined_reason = %s WHERE id = %s",
                    (reason, int(item_id)),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'success': True}, ensure_ascii=False)}

            # Администратор рассмотрел недостачу и решил удержать деньги с сотрудников.
            if action == 'charge_penalty':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "SELECT shortage_quantity, penalty_total, remaining_at_close "
                    "FROM rolls WHERE id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                if row[1] is not None:
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': 'Штраф по этому рулону уже начислен'}, ensure_ascii=False)}
                # Удерживаем по ФАКТИЧЕСКОМУ остатку на момент закрытия — ровно по той
                # сумме, которую администратор видел на дашборде перед нажатием кнопки.
                # Раньше здесь бралось введённое сотрудницей число, и удержание
                # расходилось с показанным расчётом.
                base_shortage = float(row[2]) if row[2] is not None else float(row[0] or 0)
                penalty = charge_shortage_penalty(cur, int(item_id), base_shortage)
                if not penalty:
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': 'Начислять нечего: недостача в пределах нормы '
                                                         'или не заданы норма и себестоимость'}, ensure_ascii=False)}
                conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'success': True, 'penalty': penalty}, ensure_ascii=False)}

            # Администратор решил не штрафовать: недостача признана виной поставщика.
            # Помечаем нулём, чтобы рулон ушёл из очереди и не мозолил глаза.
            if action == 'dismiss_penalty':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "UPDATE rolls SET penalty_total = 0 WHERE id = %s AND penalty_total IS NULL",
                    (int(item_id),),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT id FROM order_material_usage WHERE roll_id = %s LIMIT 1", (int(item_id),))
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Нельзя удалить рулон — по нему уже есть списания на заказы'}),
                    }
                cur.execute(f"DELETE FROM rolls WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}