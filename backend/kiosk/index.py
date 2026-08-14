import json
import os
import re
from datetime import datetime, timedelta

import psycopg2


def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description, details=None):
    """Пишет запись в журнал действий (audit_log) в той же транзакции перед commit()."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'production',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


def next_storage_barcode(cur) -> str:
    """Генерирует следующий штрихкод хранения вида GW-000001 (по максимальному текущему)."""
    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE storage_barcode LIKE 'GW-%'")
    max_seq = 0
    for (bc,) in cur.fetchall():
        suffix = bc.split('-', 1)[1] if '-' in bc else ''
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return f"GW-{max_seq + 1:06d}"


def get_setting(cur, workshop_id, key, default=None):
    """Значение настройки: сначала переопределение цеха, потом глобальное, потом default."""
    if workshop_id:
        cur.execute(
            "SELECT value FROM workshop_settings WHERE workshop_id = %s AND key = %s",
            (int(workshop_id), key),
        )
        row = cur.fetchone()
        if row and row[0] not in (None, ''):
            return row[0]
    cur.execute("SELECT value FROM system_settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if row and row[0] not in (None, ''):
        return row[0]
    return default


def write_off_packaging(cur, order_id: int) -> str | None:
    """Списывает упаковку заказа (пакет, этикетка на пакет) в момент стикеровки.

    Упаковка физически расходуется именно здесь, на терминале упаковщика, а не при раскрое.
    Берём нужные материалы типа «Упаковка» из состава товара и списываем по FIFO
    (сначала самые старые рулоны) со склада или из цеха. Повторное закрытие заказа
    ничего не спишет второй раз. Возвращает текст ошибки при нехватке, иначе None.
    """
    cur.execute("SELECT id FROM material_types WHERE name = 'Упаковка'")
    pack_type_row = cur.fetchone()
    if not pack_type_row:
        return None
    pack_type_id = pack_type_row[0]

    cur.execute(
        "SELECT material, width, height FROM orders WHERE id = %s",
        (order_id,),
    )
    o = cur.fetchone()
    if not o or not (o[0] and o[1] and o[2]):
        return None

    cur.execute(
        "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
        (o[0], o[1], o[2]),
    )
    item_row = cur.fetchone()
    if not item_row:
        return None

    cur.execute(
        "SELECT mim.material_id, mim.quantity FROM marketplace_item_materials mim "
        "JOIN materials m ON m.id = mim.material_id "
        "WHERE mim.marketplace_item_id = %s AND m.type_id = %s",
        (item_row[0], pack_type_id),
    )
    needed = cur.fetchall()
    if not needed:
        return None

    shortages = []
    write_offs = []
    for material_id, qty_needed in needed:
        qty_needed = float(qty_needed)
        # Этот материал по заказу уже списан — второй раз не списываем.
        cur.execute(
            "SELECT 1 FROM order_material_usage WHERE order_id = %s AND material_id = %s LIMIT 1",
            (order_id, material_id),
        )
        if cur.fetchone():
            continue

        cur.execute(
            "SELECT id, remaining_quantity FROM rolls "
            "WHERE material_id = %s AND status IN ('in_storage', 'in_workshop') AND remaining_quantity > 0 "
            "ORDER BY created_at ASC",
            (material_id,),
        )
        available_rolls = cur.fetchall()
        total_available = sum(float(r[1]) for r in available_rolls)
        if total_available < qty_needed:
            cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
            mat_name, mat_unit = cur.fetchone()
            shortages.append(
                f"{mat_name}: нужно {round(qty_needed, 2)} {mat_unit}, "
                f"доступно {round(total_available, 2)} {mat_unit}"
            )
            continue

        remaining_to_take = qty_needed
        for roll_id, roll_remaining in available_rolls:
            if remaining_to_take <= 0:
                break
            take = min(float(roll_remaining), remaining_to_take)
            write_offs.append((roll_id, material_id, take))
            remaining_to_take -= take

    if shortages:
        return 'Недостаточно упаковки: ' + '; '.join(shortages)

    for roll_id, material_id, take in write_offs:
        cur.execute("SELECT remaining_quantity FROM rolls WHERE id = %s", (roll_id,))
        roll_remaining = float(cur.fetchone()[0])
        new_remaining = roll_remaining - take
        new_status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
        cur.execute(
            f"UPDATE rolls SET remaining_quantity = {new_remaining}{new_status_sql} WHERE id = {int(roll_id)}"
        )
        cur.execute(
            "INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
            "VALUES (%s, %s, %s, %s)",
            (order_id, int(material_id), int(roll_id), take),
        )
    return None



# Брак ведём только по ТКАНИ и ТЕСЬМЕ. Пакеты и этикетки не считаем: их брак копеечный, а
# время сотрудника на оформление дороже самой потери.
DEFECT_REASONS = {
    # Тюль — полотно: дефекты видны при раскрое.
    'Тюль': [
        {'code': 'fabric_snags', 'label': 'Затяжки'},
        {'code': 'fabric_stripes', 'label': 'Полосы'},
        {'code': 'fabric_holes', 'label': 'Дырки'},
        {'code': 'fabric_weight', 'label': 'Брак утяжелителя'},
    ],
    # Аксессуары — тесьма: дефекты видны при пошиве.
    'Аксессуары': [
        {'code': 'trim_loops', 'label': 'Брак петель'},
        {'code': 'trim_factory', 'label': 'Заводской брак'},
    ],
    # Упаковка — пакеты и этикетки: дефекты видит упаковщица, когда фасует готовый товар.
    'Упаковка': [
        {'code': 'pack_torn', 'label': 'Порван пакет'},
        {'code': 'pack_dirty', 'label': 'Грязный пакет'},
        {'code': 'pack_no_glue', 'label': 'Не клеится этикетка'},
        {'code': 'pack_misprint', 'label': 'Брак печати'},
        {'code': 'pack_factory', 'label': 'Заводской брак'},
    ],
}

# Какие материалы доступны роли на экране «Брак из рулона».
# Упаковщица фасует готовый товар — её брак это пакеты и этикетки, ткань и тесьму она
# в руках не держит. Швея и закройщик наоборот: работают с полотном и тесьмой.
DEFECT_TYPES_BY_ROLE = {
    'packer': ['Упаковка'],
    'sewer': ['Тюль', 'Аксессуары'],
    'cutter': ['Тюль', 'Аксессуары'],
}
ALL_DEFECT_TYPES = ['Тюль', 'Аксессуары', 'Упаковка']


def defect_reason_label(material_type, code):
    """Название причины по её коду — чтобы в отчёте не тянуть справочник каждый раз."""
    for r in DEFECT_REASONS.get(material_type, []):
        if r['code'] == code:
            return r['label']
    return None


def next_defect_barcode(cur):
    """Штрихкод стикера брака DF-000001 — по нему кладовщик принимает брак на склад."""
    cur.execute("SELECT nextval('material_defect_barcode_seq')")
    return f'DF-{int(cur.fetchone()[0]):06d}'


# Статусы OZON, при которых отправление уже ушло от нас: ярлык на него маркетплейс
# больше не выдаёт. Вещь, дошитая под такой заказ, покупателю не поедет — её кладут
# на склад хранения. Без этого списка упаковщица упиралась в ошибку «ярлык не нужен»
# и не могла закрыть заказ: он навсегда висел в очереди стикеровки.
OZON_SHIPMENT_GONE = ('delivering', 'delivered', 'cancelled', 'not_accepted', 'driver_pickup')


def is_label_gone(marketplace, ozon_status) -> bool:
    """Ярлык отправления уже не получить: вещь идёт на склад, а не покупателю."""
    return (marketplace or '').upper() == 'OZON' and (ozon_status or '') in OZON_SHIPMENT_GONE


def handler(event: dict, context) -> dict:
    """Терминал упаковщицы (kiosk) — упрощённый экран для завершения стикеровки.

    Упаковщица находит заказ со статусом "Стикеровка" по номеру заказа, проверяет его и
    нажимает "Закрыть заказ" — заказ переходит в статус "Готовые" (после этого доступен для
    приёмки на склад готового товара). Тарифы (salary_rates) полностью раздельные по цехам.
    При закрытии начисляется зарплата:
      - швее (assignedUserId заказа) — фиксированная ставка за штуку по ширине товара
        (salary_rates, role='sewer', width), берётся из тарифов ЦЕХА ЗАКАЗА (workshop_id заказа).
        Именно на этом шаге, а не раньше, чтобы не начислять за заказ, который швея не успела
        дошить (мог быть отправлен на стикеровку по ошибке)
      - упаковщице (та, что закрывает заказ) — ставка за пог.м. на стикеровке
        (salary_rates, role='packer'), берётся из тарифов ЦЕХА САМОЙ УПАКОВЩИЦЫ (users.workshop
        её профиля, а не цеха заказа), метраж = ширина заказа в пог.метрах (width / 100)

    GET  /?orderNumber=XXX  - найти заказ по номеру (для проверки перед закрытием),
                               возвращает базовую информацию, только если заказ в
                               статусе "Стикеровка"

    POST /  { action: 'login_by_code', code }
        - вход на терминал по личному QR-коду сотрудника формата
          "{userId}-{shiftNumber}-{ГГГГММДД}" (например 3-20-20250513). Возвращает сотрудника
          и состояние его смены (открыта/закрыта) — пароль на терминале не нужен

    POST /  { action: 'repack_list' }
        - вещи на перепаковке в этом цехе (вернулись годными, но с мятой упаковкой)
    POST /  { action: 'repack_done', id, outcome, newBag?, note? }
        - решение упаковщика по вещи на перепаковке: outcome='repacked' — переупакована,
          печатается стикер хранения и вещь уходит на склад; outcome='utilized' — при
          вскрытии обнаружен брак, вещь списывается (note обязателен).
          При outcome='repacked' обязателен newBag (да/нет — брала ли новый пакет): это
          учёт расхода упаковки по возвратам. За годную перепаковку упаковщице начисляется
          фиксированная ставка за штуку (salary_rates, role='packer_repack', размер не
          важен). За списанный брак оплаты НЕТ

    POST /  { action: 'find_stickering', sewerId?, width?, height?, material?, workshopId? }
        - поиск заказов на стикеровке вручную, когда сканер не работает: по размеру,
          швее, материалу. Возвращает список заказов для выбора

    POST /  { action: 'find_unlabeled', sewerId?, width?, height? }
        - кладовщик ищет вещь без стикера хранения (упаковщица не наклеила / стикер потерян)
          среди отменённых заказов, ожидающих укладки на полку — по швее и/или размеру
    POST /  { action: 'sewers_list' }
        - швеи, у которых есть вещи, ожидающие укладки на полку (для поиска выше)

    POST /  { action: 'close_order', orderId, packerId }
        - переводит заказ в статус "Готовые", создаёт начисления швее и упаковщице.
          Фиксирует packer_user_id = packerId — отдельное поле на заказе, аналогично
          cutter_user_id/sewer_user_id, чтобы история "кто упаковал" была видна на карточке

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с данными заказа/результатом закрытия
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

        # Статистика брака по сотрудникам за все смены. Нужна, чтобы увидеть, кто
        # списывает брака заметно больше остальных: причиной может быть и неаккуратная
        # работа, и попытка вынести материал под видом брака.
        if params.get('defect_stats'):
            date_from = (params.get('from') or '').strip()
            date_to = (params.get('to') or '').strip()
            where = ['1=1']
            if date_from:
                where.append(f"d.created_at >= '{date_from.replace(chr(39), '')}'")
            if date_to:
                where.append(f"d.created_at < '{date_to.replace(chr(39), '')}'::date + 1")
            where_sql = ' AND '.join(where)

            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                # По сотрудникам: сколько раз оформлял брак, на сколько метров и денег.
                # Деньги — по себестоимости рулона, с которого списан брак.
                cur.execute(
                    "SELECT d.user_id, COALESCE(d.user_name, 'Не указан'), COALESCE(d.user_role, ''), "
                    "COUNT(*), COALESCE(SUM(d.quantity), 0), "
                    "COALESCE(SUM(d.quantity * COALESCE(r.cost_per_unit, 0)), 0), "
                    "COUNT(DISTINCT d.shift_session_id), "
                    "MIN(d.created_at), MAX(d.created_at) "
                    "FROM material_defects d "
                    "LEFT JOIN rolls r ON r.id = d.roll_id "
                    f"WHERE {where_sql} "
                    "GROUP BY d.user_id, d.user_name, d.user_role "
                    "ORDER BY 6 DESC"
                )
                by_user = []
                for r in cur.fetchall():
                    shifts = r[6] or 0
                    qty = float(r[4])
                    by_user.append({
                        'userId': r[0],
                        'userName': r[1],
                        'role': r[2],
                        'times': r[3],
                        'quantity': qty,
                        'costTotal': float(r[5]),
                        'shifts': shifts,
                        # Средний брак за смену — с ним видно, кто выбивается из общего ряда.
                        'perShift': round(qty / shifts, 3) if shifts else qty,
                        'firstAt': r[7].isoformat() + 'Z' if r[7] else None,
                        'lastAt': r[8].isoformat() + 'Z' if r[8] else None,
                    })

                # По причинам: на что чаще всего ссылаются.
                cur.execute(
                    "SELECT d.reason_label, COUNT(*), COALESCE(SUM(d.quantity), 0), "
                    "COALESCE(SUM(d.quantity * COALESCE(r.cost_per_unit, 0)), 0) "
                    "FROM material_defects d "
                    "LEFT JOIN rolls r ON r.id = d.roll_id "
                    f"WHERE {where_sql} "
                    "GROUP BY d.reason_label ORDER BY 4 DESC"
                )
                by_reason = [
                    {'reason': r[0], 'times': r[1], 'quantity': float(r[2]), 'costTotal': float(r[3])}
                    for r in cur.fetchall()
                ]

                # Список оформлений: чтобы посмотреть конкретные случаи.
                cur.execute(
                    "SELECT d.barcode, d.created_at, COALESCE(d.user_name, ''), COALESCE(d.user_role, ''), "
                    "m.name, m.unit, d.quantity, d.reason_label, COALESCE(d.comment, ''), "
                    "d.quantity * COALESCE(r.cost_per_unit, 0), COALESCE(w.name, ''), "
                    "d.received_at IS NOT NULL "
                    "FROM material_defects d "
                    "JOIN materials m ON m.id = d.material_id "
                    "LEFT JOIN rolls r ON r.id = d.roll_id "
                    "LEFT JOIN workshops w ON w.id = d.workshop_id "
                    f"WHERE {where_sql} "
                    "ORDER BY d.created_at DESC LIMIT 500"
                )
                items = [
                    {
                        'barcode': r[0],
                        'createdAt': r[1].isoformat() + 'Z' if r[1] else None,
                        'userName': r[2],
                        'role': r[3],
                        'materialName': r[4],
                        'unit': r[5],
                        'quantity': float(r[6]),
                        'reason': r[7],
                        'comment': r[8],
                        'cost': float(r[9] or 0),
                        'workshop': r[10],
                        'received': r[11],
                    }
                    for r in cur.fetchall()
                ]
            finally:
                conn.close()

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(
                    {'byUser': by_user, 'byReason': by_reason, 'items': items},
                    ensure_ascii=False,
                ),
            }

        order_number = (params.get('orderNumber') or '').strip()
        if not order_number:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите orderNumber'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            order_number_esc = order_number.replace("'", "''")
            # Номер без последнего хвоста: «47971098-0677-1-1» -> «47971098-0677-1».
            # Отсекаем ровно один сегмент и только если он короткий (1-2 цифры) —
            # это наш внутренний порядковый номер вещи, а не часть номера OZON.
            base_number = order_number
            _parts = order_number.rsplit('-', 1)
            if len(_parts) == 2 and _parts[1].isdigit() and len(_parts[1]) <= 2:
                base_number = _parts[0]
            base_number_esc = base_number.replace("'", "''")

            # Корень отправления: «47971098-0677-1-2» -> «47971098-0677».
            #
            # Когда OZON делит отправление, он выдаёт вещам СВОИ номера с разными
            # хвостами: «-1» и «-3». Старая наклейка «-1-2» не совпадает ни с одним из
            # них, а отсечение одного хвоста даёт «-1» — уже застикерованную вещь.
            # Поэтому ищем ещё и по корню: все вещи одного отправления начинаются с
            # него, и среди них найдётся та, что сейчас на стикеровке.
            root_number = base_number
            _rparts = base_number.rsplit('-', 1)
            if len(_rparts) == 2 and _rparts[1].isdigit() and len(_rparts[1]) <= 2:
                root_number = _rparts[0]
            root_like_esc = root_number.replace("'", "''").replace('%', '') + '-%'
            cur.execute(
                "SELECT o.id, o.order_number, o.product, o.material, o.width, o.height, "
                "o.sewing_status, o.assigned_user_id, u.full_name, o.status, o.ozon_status, "
                "o.marketplace, o.group_key, o.group_size, o.group_position, o.order_type, "
                "o.is_legal_entity, o.legal_company_name, o.cluster, cu.full_name, su.full_name "
                "FROM orders o LEFT JOIN users u ON u.id = o.assigned_user_id "
                "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                "LEFT JOIN users su ON su.id = o.sewer_user_id "
                # Ищем по номеру заказа ИЛИ по номеру отправления маркетплейса.
                #
                # На ярлыке OZON напечатан номер ОТПРАВЛЕНИЯ (0152210646-0165-1), а в
                # системе у вещи может быть внутренний номер с хвостом (…-1-2) — так
                # мы дробили многовещевые отправления до того, как научились делить их
                # на стороне OZON. Упаковщица сканировала ярлык и получала «заказ не
                # найден»: точного совпадения нет, хотя вещь лежит у неё в руках.
                #
                # Если под номером отправления несколько вещей, берём ту, что дальше
                # всех по конвейеру и ещё не закрыта: именно её сейчас стикеруют.
                #
                # Обратный случай: на QR-коде внутри упаковки напечатан СТАРЫЙ номер с
                # хвостом (47971098-0677-1-1), а заказ в системе уже переименован в
                # настоящий номер отправления OZON (47971098-0677-1). Так вышло, когда
                # мы разделили накопившиеся отправления на стороне OZON: наклейки в
                # цехе остались со старыми номерами. Поэтому пробуем ещё и номер без
                # последнего хвоста — упаковщице не нужно знать про переименования.
                f"WHERE o.order_number = '{order_number_esc}' "
                f"   OR o.ozon_posting_number = '{order_number_esc}' "
                f"   OR o.order_number = '{base_number_esc}' "
                f"   OR o.ozon_posting_number = '{base_number_esc}' "
                # Соседи по отправлению: OZON мог выдать вещам номера «-1» и «-3».
                f"   OR o.ozon_posting_number LIKE '{root_like_esc}' "
                #
                # ПОРЯДОК ВАЖЕН: сначала берём вещь, которую сейчас реально стикеруют,
                # и только потом смотрим на точность совпадения номера.
                #
                # Почему так: отправление 47971098-0677-1-1/-1-2 OZON разделил на два
                # СВОИХ номера — «-1» и «-3». Первую вещь уже застикеровали (стала
                # «Готовые»), вторая ждёт очереди под номером «-3». Упаковщица пикает
                # старую наклейку «-1-2», а система по приоритету точности отдавала
                # закрытую «-1» и отвечала «уже застикерован». Работа вставала, хотя
                # незакрытая вещь того же отправления лежала рядом.
                "ORDER BY CASE o.sewing_status "
                "    WHEN 'Стикеровка' THEN 1 WHEN 'В работе' THEN 2 "
                "    WHEN 'Раскроено' THEN 3 WHEN 'На раскрое' THEN 4 "
                "    WHEN 'Новый' THEN 5 ELSE 6 END, "
                f"  (o.order_number = '{order_number_esc}') DESC, "
                f"  (o.ozon_posting_number = '{order_number_esc}') DESC, o.id "
                "LIMIT 1"
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Заказ {order_number} не найден'})}
            if row[6] != 'Стикеровка':
                # Уже застикерованный заказ на терминал не пускаем: иначе на вещь наклеят
                # второй ярлык. Говорим прямо, что работа по нему закончена.
                #
                # Но у упаковщицы физически ОСТАЛАСЬ вещь, и деть её некуда. Так бывает,
                # когда заказ закрыли вещью со склада (подбор), а швея тем временем дошила
                # свою: заказ отгружен, а вещь лежит в цехе «ничья». Раньше терминал просто
                # отвечал «уже закрыт», и вещь оставалась на столе.
                #
                # Поэтому вместе с отказом отдаём саму вещь: терминал предложит напечатать
                # стикер хранения и сдать её кладовщику как свободный остаток.
                msg = (
                    f'Заказ {order_number} уже застикерован и закрыт'
                    if row[6] == 'Готовые'
                    else f'Заказ {order_number} не на стикеровке (статус: {row[6]})'
                )
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': msg,
                        'canStoreSpare': True,
                        'order': {
                            'id': row[0],
                            'orderNumber': row[1],
                            'product': row[2],
                            'material': row[3],
                            'width': row[4],
                            'height': row[5],
                            'sewingStatus': row[6],
                        },
                    }, ensure_ascii=False),
                }

            order = {
                'id': row[0],
                'orderNumber': row[1],
                'product': row[2],
                'material': row[3],
                'width': row[4],
                'height': row[5],
                'sewingStatus': row[6],
                'assignedUserId': row[7],
                'assignedUserName': row[8],
                # Заказ отменён клиентом: вещь всё равно дошивается, но уходит не покупателю,
                # а на склад хранения — упаковщик клеит стикер ХРАНЕНИЯ вместо отправления.
                'isCancelled': row[9] == 'Отменён' or 'cancel' in (row[10] or '').lower(),
                # Отправление уже уехало к покупателю (или отменено на стороне OZON) —
                # ярлык не выдадут. Вещь закрывают со стикером хранения, как отменённую.
                'labelGone': is_label_gone(row[11], row[10]),
                'marketplace': row[11],
                # Заказ покупателя из нескольких вещей (Яндекс Маркет). Ярлык у КАЖДОЙ
                # вещи свой, с номером грузоместа «1 из 2» — печатать один на всю связку
                # нельзя. Связка нужна, чтобы упаковщица собрала вещи заказа вместе.
                'groupKey': row[12],
                'groupSize': row[13],
                'groupPosition': row[14],
                # FBS/FBO: у FBS ярлык отправления выдаёт маркетплейс по API, у FBO мы
                # печатаем свой стикер товара — терминал выбирает по этому полю.
                'orderType': row[15],
                # Покупатель — компания: упаковщица должна видеть это на терминале.
                'isLegalEntity': bool(row[16]),
                'legalCompanyName': row[17],
                # Кластер FBO — город назначения поставки. Упаковщица видит, куда уедет
                # вещь, и не смешивает товар из разных поставок.
                'cluster': row[18],
                # Кто кроил и кто шил — по ним разбирают брак и возвраты.
                'cutterName': row[19],
                'sewerName': row[20],
            }
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'order': order})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Вход на терминал по QR-коду сотрудника формата "{userId}-{shiftNumber}-{ГГГГММДД}"
            # (например 3-20-20250513). Пароль не нужен — терминал стоит в цехе, вход по личному
            # QR с бейджа. Возвращаем сотрудника и состояние его смены.
            if action == 'login_by_code':
                code = (body_data.get('code') or '').strip()
                # Сканер мог передать полную ссылку из QR, причём при русской раскладке на
                # терминале латиница превращается в кириллицу, а цифры остаются целыми.
                # Поэтому сначала ищем сам код по шаблону "{id}-{смена}-{дата}".
                m = re.search(r'(\d{1,6}-\d{1,3}-\d{6,8})', code)
                if m:
                    code = m.group(1)
                elif 'barcode=' in code:
                    code = code.split('barcode=')[1].split('&')[0].strip()
                parts = code.split('-')
                if len(parts) < 1 or not parts[0].isdigit():
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неверный код сотрудника'})}
                user_id = int(parts[0])
                shift_from_code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None

                cur.execute(
                    "SELECT u.id, u.full_name, u.role, u.is_active, w.id "
                    "FROM users u LEFT JOIN workshops w ON w.name = u.workshop WHERE u.id = %s",
                    (user_id,),
                )
                u_row = cur.fetchone()
                if not u_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}
                if not u_row[3]:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник неактивен'})}

                cur.execute(
                    "SELECT id, opened_at, workshop_id, shift_number, role FROM shift_sessions "
                    "WHERE user_id = %s AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
                    (user_id,),
                )
                s_row = cur.fetchone()

                # Во сколько сотрудник сможет закрыть смену: отсчёт от фактического
                # прихода, длительность — по графику из профиля. Терминал показывает
                # это время и до него держит кнопку закрытия неактивной.
                can_close_at = None
                if s_row:
                    cur.execute(
                        "SELECT shift_from, shift_to FROM users WHERE id = %s", (user_id,)
                    )
                    sch = cur.fetchone()
                    if sch and sch[0] and sch[1]:
                        opened = s_row[1]
                        start_dt = datetime.combine(opened.date(), sch[0])
                        end_dt = datetime.combine(opened.date(), sch[1])
                        if end_dt <= start_dt:
                            end_dt += timedelta(days=1)
                        base = opened if opened > start_dt else start_dt
                        can_close_at = (base + (end_dt - start_dt)).isoformat() + 'Z'

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'user': {
                            'id': u_row[0],
                            'name': u_row[1],
                            'role': u_row[2],
                            'shiftFromCode': shift_from_code,
                            'homeWorkshopId': u_row[4],
                        },
                        'shift': {
                            'isOpen': bool(s_row),
                            'openedAt': (s_row[1].isoformat() + 'Z') if s_row else None,
                            'workshopId': s_row[2] if s_row else None,
                            'shiftNumber': s_row[3] if s_row else None,
                            'canCloseAt': can_close_at,
                            # Роль ИМЕННО этой смены: в гостевом режиме человек выходит
                            # в чужой цех и может работать другой ролью. По ней терминал
                            # подбирает материал, с которым ему разрешено работать.
                            'role': (s_row[4] if s_row else None) or u_row[2],
                        },
                    }),
                }

            if action == 'close_order':
                order_id = body_data.get('orderId')
                packer_id = body_data.get('packerId')
                if not order_id or not packer_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите orderId и packerId'})}

                cur.execute(
                    "SELECT sewing_status, width, assigned_user_id, order_number, workshop_id, "
                    "status, ozon_status, order_type, material, height, product, "
                    "group_key, group_size, group_position, marketplace FROM orders WHERE id = %s",
                    (int(order_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                (sewing_status, width, assigned_user_id, order_number, order_workshop_id,
                 order_status, order_ozon_status, order_type, order_material,
                 order_height, order_product, group_key, group_size, group_position,
                 order_marketplace) = row
                # Отправление уже уехало к покупателю — ярлык не выдадут, и вещь ему не
                # поедет. Для цеха и склада это то же самое, что отмена: вещь получает
                # стикер хранения и ложится на полку, а не в поставку.
                #
                # ИСКЛЮЧЕНИЕ: упаковщица только что РЕАЛЬНО напечатала ярлык. В посылке
                # из нескольких вещей ярлык один на всех: стикеровка первой вещи метит
                # отправление «уехавшим», но ярлык на него ещё выдаётся, и остальные
                # вещи докладываются в ту же посылку. Без этой проверки такая вещь
                # уезжала бы к покупателю с ярлыком и одновременно числилась у нас на
                # складе хранения.
                label_printed = bool(body_data.get('labelPrinted'))
                label_gone = is_label_gone(order_marketplace, order_ozon_status)
                is_cancelled = (
                    order_status == 'Отменён'
                    or 'cancel' in (order_ozon_status or '').lower()
                    or (label_gone and not label_printed)
                )

                # Заказы, перенесённые из старой системы, приехали без цеха: их не раскраивал
                # закройщик, и проставить цех было неоткуда. Все ставки зарплаты привязаны к
                # цеху, поэтому без этой подстановки швея и упаковщица за такой заказ не
                # получили бы НИЧЕГО — начисление молча считалось бы нулевым.
                # Берём цех из открытой смены того, кто сейчас работает с заказом.
                if not order_workshop_id:
                    cur.execute(
                        "SELECT workshop_id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                        "ORDER BY opened_at DESC LIMIT 1",
                        (int(packer_id),),
                    )
                    ws_row = cur.fetchone()
                    if ws_row and ws_row[0]:
                        order_workshop_id = ws_row[0]
                    elif assigned_user_id:
                        cur.execute(
                            "SELECT workshop_id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                            "ORDER BY opened_at DESC LIMIT 1",
                            (int(assigned_user_id),),
                        )
                        ws_row = cur.fetchone()
                        if ws_row and ws_row[0]:
                            order_workshop_id = ws_row[0]
                    # Проставляем цех и самому заказу — чтобы он попал в отчёты по цеху
                    # и дальше вёл себя как обычный заказ.
                    if order_workshop_id:
                        cur.execute(
                            "UPDATE orders SET workshop_id = %s WHERE id = %s AND workshop_id IS NULL",
                            (order_workshop_id, int(order_id)),
                        )
                # Индивидуальный пошив не едет на маркетплейс: у него нет стикера
                # маркетплейса, и вещь до выдачи клиенту лежит на полке. Поэтому ему
                # тоже заводим складской штрихкод и печатаем свой стикер.
                is_individual = (order_type or '') == 'Индивидуальный'
                # Заказ УЖЕ закрыт этой же стикеровкой. Такое бывает, когда связь моргнула
                # или упаковщица нажала «Завершить» второй раз: работа выполнена, а окно
                # на терминале осталось висеть и повторное нажатие упиралось в ошибку
                # «заказ не на стикеровке». Отвечаем успехом — окно закроется, вещь уже
                # в «Готовых». Повторных начислений не будет: ниже они не выполняются.
                if sewing_status == 'Готовые':
                    cur.execute(
                        "SELECT storage_barcode FROM goods_warehouse WHERE order_id = %s",
                        (int(order_id),),
                    )
                    gw_done = cur.fetchone()
                    conn.commit()
                    return {
                        'statusCode': 200,
                        'headers': headers,
                        'body': json.dumps({
                            'success': True,
                            'alreadyClosed': True,
                            'isCancelled': is_cancelled,
                            'isIndividual': (order_type or '') == 'Индивидуальный',
                            'storageBarcode': gw_done[0] if gw_done else None,
                            'orderNumber': order_number,
                            'material': order_material,
                            'width': width,
                            'height': order_height,
                            'product': order_product,
                        }, ensure_ascii=False),
                    }

                if sewing_status != 'Стикеровка':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Заказ не на стикеровке (статус: {sewing_status})'}),
                    }

                # Пока в цехе на смене есть упаковщик — стикеровать может только он. Швеи и
                # закройщики допускаются к стикеровке лишь после закрытия его смены.
                cur.execute(
                    "SELECT COALESCE(ss.role, u.role) FROM shift_sessions ss "
                    "JOIN users u ON u.id = ss.user_id "
                    "WHERE ss.user_id = %s AND ss.closed_at IS NULL ORDER BY ss.opened_at DESC LIMIT 1",
                    (int(packer_id),),
                )
                pr = cur.fetchone()
                packer_shift_role = pr[0] if pr else None
                if packer_shift_role == 'sewer' and order_workshop_id:
                    # Швея упаковывает сама только если цех это разрешил. Иначе вещи
                    # идут через упаковщицу, даже когда её смена уже закрыта.
                    if get_setting(
                        cur, order_workshop_id, 'sewer_packing_after_packer_shift', 'false'
                    ) != 'true':
                        return {
                            'statusCode': 403,
                            'headers': headers,
                            'body': json.dumps({
                                'error': 'Упаковка швеёй не разрешена в вашем цехе — заказ упакует упаковщица'
                            }),
                        }

                if packer_shift_role and packer_shift_role != 'packer' and order_workshop_id:
                    # Пока упаковщица на смене — упаковывает она. Швея подключается
                    # только после того, как упаковщица ЗАКРЫЛА смену (closed_at).
                    cur.execute(
                        "SELECT u.full_name FROM shift_sessions ss JOIN users u ON u.id = ss.user_id "
                        "WHERE ss.closed_at IS NULL AND ss.workshop_id = %s "
                        "AND COALESCE(ss.role, u.role) = 'packer' LIMIT 1",
                        (order_workshop_id,),
                    )
                    active_packer = cur.fetchone()
                    if active_packer:
                        return {
                            'statusCode': 403,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'В цехе на смене упаковщик ({active_packer[0]}) — стикеровку '
                                         f'выполняет он. Вы сможете стикеровать после закрытия его смены'
                            }),
                        }

                # packer_user_id фиксирует, КТО именно закрыл заказ (упаковщица) — отдельное
                # поле, аналогично cutter_user_id/sewer_user_id, чтобы история исполнителей на
                # каждом этапе была видна на карточке товара (раньше сохранялось только в
                # salary_accruals для зарплаты и нигде на самом заказе не фиксировалось).
                # Режим стикеровки для роли из настроек цеха (sticking_otk — упаковщик,
                # sticking_seamstress — швея): 'forbidden' полностью запрещает роли
                # стикеровать в этом цехе. 'scanner'/'manual' различаются только способом
                # поиска заказа на терминале и закрытию не мешают.
                mode_key = 'sticking_seamstress' if packer_shift_role == 'sewer' else 'sticking_otk'
                sticking_mode = get_setting(cur, order_workshop_id, mode_key, 'scanner')
                if sticking_mode == 'forbidden':
                    who = 'швеям' if mode_key == 'sticking_seamstress' else 'упаковщикам'
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': f'В настройках цеха стикеровка {who} запрещена'}),
                    }

                # Упаковка расходуется именно на стикеровке — списываем её здесь. Если пакетов
                # или этикеток не хватает, заказ не закрываем и показываем чего именно нет.
                pack_err = write_off_packaging(cur, int(order_id))
                if pack_err:
                    conn.rollback()
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': pack_err})}

                # packed_at — момент, когда вещь реально упакована. По нему считается
                # акция дня: метры засчитываются за упакованное, а не за сданное на
                # стикеровку, иначе вещь могла зачесться и пролежать неупакованной.
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Готовые', packer_user_id = {int(packer_id)}, "
                    f"packed_at = COALESCE(packed_at, now()) "
                    f"WHERE id = {int(order_id)}"
                )

                # Заказ отменён клиентом — вещь не поедет покупателю. Сразу заводим её на складе
                # в статусе awaiting_shelf: упаковщик клеит стикер хранения, а кладовщик потом
                # заберёт вещь из цеха и отсканирует на конкретную полку у себя на компьютере.
                storage_barcode = None
                if is_cancelled or is_individual:
                    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE order_id = %s", (int(order_id),))
                    gw_existing = cur.fetchone()
                    if gw_existing:
                        storage_barcode = gw_existing[0]
                    else:
                        storage_barcode = next_storage_barcode(cur)
                        reason = 'cancelled' if is_cancelled else 'individual'
                        cur.execute(
                            "INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
                            "VALUES (%s, 'awaiting_shelf', %s, %s)",
                            (int(order_id), storage_barcode, reason),
                        )
                elif (order_type or '') == 'FBS':
                    # Обычный FBS-заказ: вещь сшита, застикерована ярлыком маркетплейса и
                    # лежит в контейнере — ждёт, когда кладовщик отсканирует её в поставку.
                    # Заводим складскую запись в статусе 'awaiting_supply': она не на полке,
                    # а «на поставку». Раньше записи не было совсем, и сканирование ярлыка
                    # в поставку падало с «не найдено среди собранных с полок».
                    cur.execute(
                        "SELECT id FROM goods_warehouse WHERE order_id = %s", (int(order_id),)
                    )
                    if not cur.fetchone():
                        cur.execute(
                            "INSERT INTO goods_warehouse (order_id, status, storage_barcode, "
                            "receive_reason, shipping_labeled_at) "
                            "VALUES (%s, 'awaiting_supply', %s, 'fbs_ready', now())",
                            (int(order_id), next_storage_barcode(cur)),
                        )

                # Швея получает фиксированную ставку за штуку по ширине товара — именно сейчас,
                # когда заказ реально дошит и прошёл стикеровку (не раньше). Ставка берётся из
                # тарифов цеха, в котором выполняется заказ (order_workshop_id).
                # Цех для ставки: у заказа, если проставлен, иначе штатный цех самой швеи.
                # Без этой подстраховки заказ без цеха (FBO приходит в пошив мимо раскроя)
                # давал нулевую ставку, и начисление молча не создавалось — швея работала
                # смену бесплатно, а в отчётах выглядела как «не работавшая».
                sewer_workshop_for_rate = order_workshop_id
                if assigned_user_id and not sewer_workshop_for_rate:
                    cur.execute(
                        "SELECT w.id FROM users u JOIN workshops w ON w.name = u.workshop "
                        "WHERE u.id = %s",
                        (int(assigned_user_id),),
                    )
                    sw_row = cur.fetchone()
                    sewer_workshop_for_rate = sw_row[0] if sw_row else None

                if assigned_user_id and width and sewer_workshop_for_rate:
                    cur.execute(
                        "SELECT rate FROM salary_rates WHERE role = 'sewer' AND width = %s AND workshop_id = %s",
                        (int(width), sewer_workshop_for_rate),
                    )
                    rate_row = cur.fetchone()
                    sewer_rate = float(rate_row[0]) if rate_row else 0
                    if sewer_rate > 0:
                        cur.execute(
                            f"INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                            f"VALUES ({int(assigned_user_id)}, 'sewer_piece', {sewer_rate}, {int(order_id)}, "
                            f"'Пошив заказа #{order_number} ({width} см)') "
                            f"ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING"
                        )

                # Упаковщица получает ставку за пог.м. на стикеровке — берётся из тарифов ЕЁ
                # СОБСТВЕННОГО цеха (users.workshop её профиля), а не цеха заказа.
                cur.execute(
                    "SELECT w.id FROM users u JOIN workshops w ON w.name = u.workshop WHERE u.id = %s",
                    (int(packer_id),),
                )
                packer_workshop_row = cur.fetchone()
                packer_workshop_id = packer_workshop_row[0] if packer_workshop_row else None
                # Если стикерует швея/закройщик (упаковщика на смене нет) — оплата всё равно
                # идёт по тарифу упаковщицы; при отсутствии штатного цеха берём цех заказа.
                if not packer_workshop_id:
                    packer_workshop_id = order_workshop_id

                packer_rate = 0.0
                if packer_workshop_id:
                    cur.execute(
                        # Ставка упаковщика одна на цех. Основная строка — без ткани и
                        # ширины, но если её забыли заполнить (а значение вбито в старые
                        # строки по тканям), берём максимальную заполненную по цеху.
                        # Иначе расчёт молча даёт ноль и человек остаётся без денег.
                        "SELECT MAX(rate) FROM salary_rates WHERE role = 'packer' "
                        "AND workshop_id = %s",
                        (packer_workshop_id,),
                    )
                    packer_rate_row = cur.fetchone()
                    packer_rate = float(packer_rate_row[0]) if packer_rate_row else 0
                if packer_rate > 0 and width:
                    meters = round(float(width) / 100, 2)
                    amount = round(meters * packer_rate, 2)
                    # Если стикеровал не упаковщик (упаковщика на смене не было), помечаем это
                    # в описании начисления — админу видно, кто подменял упаковщицу.
                    role_labels = {'sewer': 'швея', 'cutter': 'закройщик', 'packer': 'упаковщик'}
                    instead_note = ''
                    if packer_shift_role and packer_shift_role != 'packer':
                        instead_note = f' (стикеровал {role_labels.get(packer_shift_role, packer_shift_role)} вместо упаковщицы)'
                    cur.execute(
                        "INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                        "VALUES (%s, 'packer_stickering', %s, %s, %s) "
                        "ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING",
                        (
                            int(packer_id), amount, int(order_id),
                            f'Стикеровка заказа #{order_number} - {meters} п.м.{instead_note}',
                        ),
                    )

                log_action(
                    cur, actor_id, actor_name, 'close_order', 'order', order_id,
                    f'Закрыл заказ #{order_number} после стикеровки'
                    + (' (отменён клиентом — на склад хранения)' if is_cancelled else ''),
                )
                # Связка Яндекса: считаем, сколько вещей заказа ещё не застикеровано.
                # Каждая вещь стикеруется по очереди и своим ярлыком — запрещать закрытие
                # нельзя, иначе первую вещь вообще не получится обработать. Вместо этого
                # показываем упаковщице, сколько осталось, чтобы она не унесла пакет
                # раньше времени и не отправила связку по частям.
                group_left = 0
                if group_key and (group_size or 0) > 1:
                    cur.execute(
                        "SELECT COUNT(*) FROM orders WHERE group_key = %s "
                        "AND sewing_status <> 'Готовые'",
                        (group_key,),
                    )
                    left_row = cur.fetchone()
                    group_left = int(left_row[0]) if left_row else 0

                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'isCancelled': is_cancelled,
                        'isIndividual': is_individual,
                        'storageBarcode': storage_barcode,
                        # Данные связки: сколько вещей заказа ещё ждут стикеровки.
                        'groupSize': group_size,
                        'groupPosition': group_position,
                        'groupLeft': group_left,
                        # Данные для стикера индивидуального заказа
                        'orderNumber': order_number,
                        'material': order_material,
                        'width': width,
                        'height': order_height,
                        'product': order_product,
                    }, ensure_ascii=False),
                }

            if action == 'repack_list':
                # Вещи, вернувшиеся от покупателя годными, но с помятой упаковкой: кладовщик
                # отправил их в цех, упаковщик переупаковывает и возвращает на склад.
                cur.execute(
                    "SELECT gw.id, gw.storage_barcode, o.order_number, o.product, o.material, "
                    "o.width, o.height, mr.return_reason, mr.marketplace "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN marketplace_returns mr ON mr.id = gw.repack_return_id "
                    "WHERE gw.status = 'repacking' ORDER BY gw.received_at ASC LIMIT 100"
                )
                items = [
                    {
                        'id': r[0],
                        'storageBarcode': r[1],
                        'orderNumber': r[2],
                        'product': r[3],
                        'material': r[4],
                        'width': r[5],
                        'height': r[6],
                        'returnReason': r[7],
                        'marketplace': r[8],
                    }
                    for r in cur.fetchall()
                ]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'items': items})}

            if action == 'repack_done':
                # Упаковщик осмотрел вещь и решил её судьбу:
                #   repacked  — переупакована, годна: печатает стикер хранения и вещь едет
                #               на склад, кладовщик по этому стикеру кладёт её на полку;
                #   utilized  — при вскрытии обнаружен брак: вещь списывается, на склад не
                #               попадает, причина уходит в отчёт админу.
                gw_id = body_data.get('id')
                outcome = (body_data.get('outcome') or 'repacked').strip()
                note = (body_data.get('note') or '').strip()
                # Новый пакет при перепаковке: упаковщица отвечает на киоске. Нужен, чтобы
                # видеть реальный расход упаковки по возвратам — иногда вещь перекладывают
                # в тот же пакет, и новый пакет не тратится.
                new_bag = body_data.get('newBag')
                if not gw_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id вещи'})}
                if outcome not in ('repacked', 'utilized'):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное решение'})}
                if outcome == 'repacked' and new_bag is None:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Ответьте, использовали ли вы новый пакет'}, ensure_ascii=False
                        ),
                    }
                if outcome == 'utilized' and not note:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Опишите брак — администратор должен видеть причину списания'}),
                    }

                cur.execute(
                    "SELECT storage_barcode, status, repack_return_id FROM goods_warehouse WHERE id = %s",
                    (int(gw_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Вещь не найдена'})}
                if row[1] != 'repacking':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Эта вещь не на перепаковке'})}

                if outcome == 'utilized':
                    # Упаковщица нашла брак. Вещь НЕ списываем сразу: кладовщик всё равно
                    # физически забирает её из цеха и несёт старшему кладовщику. Ставим
                    # «На утилизацию» — оттуда кладку чистит только админ.
                    cur.execute(
                        "UPDATE goods_warehouse SET status = 'to_dispose', "
                        "dispose_reason = %s, inspected_at = now(), inspected_by = %s, "
                        "repack_return_id = NULL WHERE id = %s",
                        (f'Брак при перепаковке: {note}',
                         int(actor_id) if actor_id else None, int(gw_id)),
                    )
                    if row[2]:
                        cur.execute(
                            "UPDATE marketplace_returns SET outcome = 'utilized', outcome_at = now(), "
                            "outcome_by = %s, damage_note = %s WHERE id = %s",
                            (int(actor_id) if actor_id else None, note, int(row[2])),
                        )
                    log_action(
                        cur, actor_id, actor_name, 'repack_utilized', 'goods_warehouse', gw_id,
                        f'Вещь {row[0]} списана при перепаковке: {note}',
                    )
                    conn.commit()
                    # Отдаём штрихкод: упаковщица клеит стикер и на бракованную вещь.
                    # Раньше здесь стоял None — вещь уезжала из цеха безымянной, и на
                    # складе её нельзя было опознать среди утиля: кладовщик не знал,
                    # что за товар и за что списан. Стикер держит вещь связанной с
                    # карточкой до самого решения администратора.
                    return {
                        'statusCode': 200,
                        'headers': headers,
                        'body': json.dumps({
                            'success': True,
                            'outcome': 'utilized',
                            'storageBarcode': row[0],
                            'disposeReason': note,
                        }, ensure_ascii=False),
                    }

                # Вещь осмотрена и годна: упаковщица наклеила стикер хранения. Теперь она
                # ждёт, пока кладовщик заберёт её из цеха — это виджет «Уже осмотрено».
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'inspected', repack_return_id = NULL, "
                    "inspected_at = now(), inspected_by = %s, repack_new_bag = %s WHERE id = %s",
                    (int(actor_id) if actor_id else None, bool(new_bag), int(gw_id)),
                )
                if row[2]:
                    cur.execute(
                        "UPDATE marketplace_returns SET outcome = 'stored' WHERE id = %s",
                        (int(row[2]),),
                    )

                # Оплата за перепаковку: фиксированная сумма за штуку, размер не важен.
                # Начисляем ТОЛЬКО за годную переупакованную вещь — за списанный брак
                # и несоответствие оплаты нет (там ветка utilized, она выходит выше).
                repack_amount = 0.0
                if actor_id:
                    cur.execute(
                        "SELECT w.id FROM users u JOIN workshops w ON w.name = u.workshop "
                        "WHERE u.id = %s",
                        (int(actor_id),),
                    )
                    pw_row = cur.fetchone()
                    packer_workshop_id = pw_row[0] if pw_row else None
                    if not packer_workshop_id:
                        # Цех не указан в профиле — берём цех открытой смены сотрудника.
                        cur.execute(
                            "SELECT workshop_id FROM shift_sessions WHERE user_id = %s "
                            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1",
                            (int(actor_id),),
                        )
                        sh_row = cur.fetchone()
                        packer_workshop_id = sh_row[0] if sh_row else None

                    if packer_workshop_id:
                        cur.execute(
                            # Перепаковка — фиксировано за штуку, размер не важен. Берём
                            # максимальную заполненную ставку по цеху: значение могло
                            # остаться в старых строках по ширинам.
                            "SELECT MAX(rate) FROM salary_rates WHERE role = 'packer_repack' "
                            "AND workshop_id = %s",
                            (packer_workshop_id,),
                        )
                        rate_row = cur.fetchone()
                        repack_amount = float(rate_row[0]) if rate_row else 0.0

                    if repack_amount > 0:
                        # Привязываем начисление к заказу вещи: один и тот же возврат не
                        # оплатится дважды (уникальный индекс по order_id + type).
                        cur.execute(
                            "SELECT order_id FROM goods_warehouse WHERE id = %s", (int(gw_id),)
                        )
                        gw_order = cur.fetchone()
                        cur.execute(
                            "INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                            "VALUES (%s, 'packer_repack', %s, %s, %s) "
                            "ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING "
                            "RETURNING id",
                            (
                                int(actor_id), repack_amount,
                                int(gw_order[0]) if gw_order and gw_order[0] else None,
                                f'Перепаковка возврата {row[0]}'
                                + (' (новый пакет)' if new_bag else ' (пакет прежний)'),
                            ),
                        )
                        # Оплата за этот возврат уже была (вещь перепаковывают повторно) —
                        # второй раз не платим и в ответе показываем 0, чтобы упаковщица не
                        # ждала лишних денег.
                        if not cur.fetchone():
                            repack_amount = 0.0

                log_action(
                    cur, actor_id, actor_name, 'repack_done', 'goods_warehouse', gw_id,
                    f'Вещь {row[0]} переупакована — отправлена на склад'
                    + (', новый пакет' if new_bag else ', пакет прежний')
                    + (f' ({note})' if note else ''),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'outcome': 'repacked',
                        'storageBarcode': row[0],
                        'newBag': bool(new_bag),
                        'accrued': repack_amount,
                    }),
                }

            if action == 'terminal_settings':
                # Настройки цеха, влияющие на вид терминала: показывать ли ручной
                # поиск заказа и можно ли швее упаковывать самой.
                ws_id = body_data.get('workshopId')
                manual = 'false'
                sewer_after = 'false'
                if ws_id not in (None, ''):
                    manual = get_setting(cur, int(ws_id), 'manual_stickering', 'false')
                    sewer_after = get_setting(
                        cur, int(ws_id), 'sewer_packing_after_packer_shift', 'false'
                    )
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'manualStickering': manual == 'true',
                        'sewerPackingAfterPackerShift': sewer_after == 'true',
                    }),
                }

            if action == 'find_stickering':
                # Сканер сломался или штрихкод не читается — упаковщик ищет заказ на
                # стикеровке вручную: по размеру (ширина/высота), швее или материалу.
                # Возвращает те же заказы, что и поиск по номеру, только списком.
                sewer_id = body_data.get('sewerId')
                width = body_data.get('width')
                height = body_data.get('height')
                material = (body_data.get('material') or '').strip()
                workshop_id = body_data.get('workshopId')

                conditions = ["o.sewing_status = 'Стикеровка'"]
                if sewer_id not in (None, ''):
                    conditions.append(
                        f"(o.assigned_user_id = {int(sewer_id)} OR o.sewer_user_id = {int(sewer_id)})"
                    )
                if width not in (None, ''):
                    conditions.append(f"o.width = {int(width)}")
                if height not in (None, ''):
                    conditions.append(f"o.height = {int(height)}")
                if material:
                    conditions.append(f"o.material = '{material.replace(chr(39), chr(39) * 2)}'")
                if workshop_id not in (None, ''):
                    conditions.append(f"o.workshop_id = {int(workshop_id)}")
                where_sql = ' AND '.join(conditions)

                if workshop_id not in (None, ''):
                    # Ручной поиск — обход сканера: сотрудник находит заказ по размеру и
                    # закрывает его, не сканируя QR закройщика. Так легко закрыть чужой
                    # заказ, поэтому по умолчанию он выключен и включается настройкой цеха.
                    if get_setting(cur, int(workshop_id), 'manual_stickering', 'false') != 'true':
                        return {
                            'statusCode': 403,
                            'headers': headers,
                            'body': json.dumps({'error': 'Ручной поиск заказа отключён. Отсканируйте QR-код с листка закройщика'}),
                        }
                    # Стикеровка для роли может быть запрещена совсем.
                    role_key = 'sticking_seamstress' if body_data.get('role') == 'sewer' else 'sticking_otk'
                    mode = get_setting(cur, int(workshop_id), role_key, 'scanner')
                    if mode == 'forbidden':
                        return {
                            'statusCode': 403,
                            'headers': headers,
                            'body': json.dumps({'error': 'В настройках цеха стикеровка для вашей роли запрещена'}),
                        }

                cur.execute(
                    "SELECT o.id, o.order_number, o.product, o.material, o.width, o.height, "
                    "o.sewing_status, COALESCE(o.sewer_user_id, o.assigned_user_id), "
                    "su.full_name, o.status, o.ozon_status, o.marketplace "
                    "FROM orders o "
                    "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    f"WHERE {where_sql} "
                    "ORDER BY o.id ASC LIMIT 100"
                )
                orders_found = [
                    {
                        'id': r[0],
                        'orderNumber': r[1],
                        'product': r[2],
                        'material': r[3],
                        'width': r[4],
                        'height': r[5],
                        'sewingStatus': r[6],
                        'assignedUserId': r[7],
                        'assignedUserName': r[8],
                        'isCancelled': r[9] == 'Отменён' or 'cancel' in (r[10] or '').lower(),
                        # Ярлык уже не получить — вещь пойдёт на полку хранения.
                        'labelGone': is_label_gone(r[11], r[10]),
                        'marketplace': r[11],
                    }
                    for r in cur.fetchall()
                ]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'orders': orders_found}),
                }

            if action == 'find_unlabeled':
                # Кладовщик нашёл в цехе вещь без стикера хранения (упаковщица забыла наклеить
                # или стикер потерялся) и ищет, чей это товар: по швее и/или размеру среди
                # отменённых заказов, которые ждут укладки на полку. Показывает кандидатов —
                # кладовщик выбирает нужный и печатает стикер заново.
                sewer_id = body_data.get('sewerId')
                width = body_data.get('width')
                height = body_data.get('height')

                conditions = ["gw.status = 'awaiting_shelf'"]
                if sewer_id not in (None, ''):
                    conditions.append(
                        f"(o.assigned_user_id = {int(sewer_id)} OR o.sewer_user_id = {int(sewer_id)})"
                    )
                if width not in (None, ''):
                    conditions.append(f"o.width = {int(width)}")
                if height not in (None, ''):
                    conditions.append(f"o.height = {int(height)}")
                where_sql = ' AND '.join(conditions)

                cur.execute(
                    "SELECT gw.id, gw.storage_barcode, o.order_number, o.product, o.material, "
                    "o.width, o.height, su.full_name, pu.full_name, o.marketplace, gw.received_at "
                    "FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                    f"WHERE {where_sql} "
                    "ORDER BY gw.received_at DESC LIMIT 50"
                )
                candidates = [
                    {
                        'id': r[0],
                        'storageBarcode': r[1],
                        'orderNumber': r[2],
                        'product': r[3],
                        'material': r[4],
                        'width': r[5],
                        'height': r[6],
                        'sewerName': r[7],
                        'packerName': r[8],
                        'marketplace': r[9],
                        'receivedAt': r[10].isoformat() + 'Z' if r[10] else None,
                    }
                    for r in cur.fetchall()
                ]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'candidates': candidates}),
                }

            if action == 'reprint_report':
                # Отчёт админу: сколько стикеров хранения пришлось перепечатывать и по чьей
                # вине (упаковщик, который должен был наклеить стикер в цехе).
                days = int(body_data.get('days') or 30)
                cur.execute(
                    "SELECT COALESCE(details->>'packerName', 'Не указан') AS packer, "
                    "COUNT(*) AS cnt, MAX(created_at) AS last_at "
                    "FROM audit_log WHERE action = 'reprint_storage_label' "
                    f"AND created_at >= now() - interval '{days} days' "
                    "GROUP BY 1 ORDER BY cnt DESC"
                )
                by_packer = [
                    {'packerName': r[0], 'count': r[1], 'lastAt': r[2].isoformat() + 'Z' if r[2] else None}
                    for r in cur.fetchall()
                ]
                cur.execute(
                    "SELECT created_at, user_name, details->>'orderNumber', details->>'product', "
                    "details->>'packerName', details->>'sewerName' "
                    "FROM audit_log WHERE action = 'reprint_storage_label' "
                    f"AND created_at >= now() - interval '{days} days' "
                    "ORDER BY created_at DESC LIMIT 100"
                )
                events = [
                    {
                        'createdAt': r[0].isoformat() + 'Z',
                        'actorName': r[1],
                        'orderNumber': r[2],
                        'product': r[3],
                        'packerName': r[4],
                        'sewerName': r[5],
                    }
                    for r in cur.fetchall()
                ]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'total': sum(p['count'] for p in by_packer),
                        'byPacker': by_packer,
                        'events': events,
                        'days': days,
                    }),
                }

            if action == 'store_spare':
                # Вещь, оставшаяся у упаковщицы по УЖЕ ЗАКРЫТОМУ заказу: покупателю она
                # не поедет (заказ закрыли вещью со склада), но выбрасывать её нельзя —
                # это готовый товар. Заводим складской штрихкод и отдаём на полку как
                # свободный остаток: дальше её подберут под следующий такой же заказ.
                order_id = body_data.get('orderId')
                if not order_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите orderId'})}

                cur.execute(
                    "SELECT order_number, product, material, width, height, sewing_status "
                    "FROM orders WHERE id = %s",
                    (int(order_id),),
                )
                sp = cur.fetchone()
                if not sp:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                (sp_number, sp_product, sp_material, sp_width, sp_height, sp_sewing) = sp

                # Вещь на этот заказ уже заводили — отдаём тот же штрихкод, чтобы на складе
                # не появилось два товара на одну физическую вещь.
                cur.execute(
                    "SELECT storage_barcode FROM goods_warehouse WHERE order_id = %s",
                    (int(order_id),),
                )
                sp_exist = cur.fetchone()
                if sp_exist:
                    sp_barcode = sp_exist[0]
                else:
                    sp_barcode = next_storage_barcode(cur)
                    cur.execute(
                        "INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
                        "VALUES (%s, 'awaiting_shelf', %s, 'spare_after_stock_match')",
                        (int(order_id), sp_barcode),
                    )
                    log_action(
                        cur, actor_id, actor_name, 'store_spare', 'orders', int(order_id),
                        f'Сдал на склад лишнюю вещь по закрытому заказу #{sp_number} '
                        f'(стикер хранения {sp_barcode})',
                    )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'storageBarcode': sp_barcode,
                        'orderNumber': sp_number,
                        'product': sp_product,
                        'material': sp_material,
                        'width': sp_width,
                        'height': sp_height,
                    }, ensure_ascii=False),
                }

            if action == 'reprint_label':
                # Кладовщик перепечатал стикер хранения вместо упаковщицы. Фиксируем факт с
                # виновником (упаковщик заказа), чтобы админ видел, кто чаще пропускает стикер.
                gw_id = body_data.get('goodsId')
                if not gw_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите goodsId'})}

                cur.execute(
                    "SELECT gw.storage_barcode, o.id, o.order_number, o.product, o.workshop_id, "
                    "o.packer_user_id, pu.full_name, COALESCE(o.sewer_user_id, o.assigned_user_id), su.full_name "
                    "FROM goods_warehouse gw JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                    "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    "WHERE gw.id = %s",
                    (int(gw_id),),
                )
                r = cur.fetchone()
                if not r:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}
                (barcode_val, ord_id, ord_number, ord_product, ord_workshop,
                 packer_id_val, packer_name_val, sewer_id_val, sewer_name_val) = r

                log_action(
                    cur, actor_id, actor_name, 'reprint_storage_label', 'goods_warehouse', int(gw_id),
                    f'Перепечатал стикер хранения {barcode_val} для заказа #{ord_number} '
                    f'(упаковщик: {packer_name_val or "не указан"})',
                    {
                        'orderId': ord_id,
                        'orderNumber': ord_number,
                        'product': ord_product,
                        'workshopId': ord_workshop,
                        'packerId': packer_id_val,
                        'packerName': packer_name_val,
                        'sewerId': sewer_id_val,
                        'sewerName': sewer_name_val,
                        'storageBarcode': barcode_val,
                    },
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'sewers_list':
                # Список швей для выпадающего списка поиска: только те, у кого есть вещи,
                # ожидающие укладки на полку — искать среди всех сотрудников бессмысленно.
                cur.execute(
                    "SELECT DISTINCT u.id, u.full_name FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.order_id "
                    "JOIN users u ON u.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    "WHERE gw.status = 'awaiting_shelf' ORDER BY u.full_name"
                )
                sewers = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'sewers': sewers})}

            if action == 'defect_report':
                # Статистика брака: кто сколько находит и по каким причинам.
                # Смысл отчёта — увидеть НЕ только тех, кто много бракует, но и тех, кто не
                # оформляет брак вообще: брак есть у всех, и нулевая строка обычно значит,
                # что человек молча выбрасывает обрезки, а не работает идеально.
                months = int(body_data.get('months') or 6)

                cur.execute(
                    "SELECT to_char(d.created_at, 'YYYY-MM') AS ym, "
                    "coalesce(d.user_name, 'Не указан'), d.user_role, "
                    "count(*), coalesce(sum(d.quantity), 0), "
                    "count(*) FILTER (WHERE d.received_at IS NULL) "
                    "FROM material_defects d "
                    f"WHERE d.created_at >= date_trunc('month', now()) - interval '{int(months)} months' "
                    "GROUP BY ym, d.user_name, d.user_role "
                    "ORDER BY ym DESC, sum(d.quantity) DESC"
                )
                by_user = [
                    {
                        'month': r[0],
                        'userName': r[1],
                        'role': r[2],
                        'count': int(r[3]),
                        'quantity': float(r[4]),
                        'pending': int(r[5]),
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT d.reason_label, count(*), coalesce(sum(d.quantity), 0) "
                    "FROM material_defects d "
                    f"WHERE d.created_at >= date_trunc('month', now()) - interval '{int(months)} months' "
                    "GROUP BY d.reason_label ORDER BY sum(d.quantity) DESC"
                )
                by_reason = [
                    {'reason': r[0], 'count': int(r[1]), 'quantity': float(r[2])}
                    for r in cur.fetchall()
                ]

                # Сотрудники цехов, которые НЕ оформили ни одного брака за период — именно их
                # и нужно проверить в первую очередь.
                cur.execute(
                    "SELECT u.full_name, u.role FROM users u "
                    "WHERE u.is_active AND u.role IN ('sewer', 'cutter') "
                    "AND NOT EXISTS (SELECT 1 FROM material_defects d WHERE d.user_id = u.id "
                    f"       AND d.created_at >= date_trunc('month', now()) - interval '{int(months)} months') "
                    "ORDER BY u.role, u.full_name"
                )
                never = [{'userName': r[0], 'role': r[1]} for r in cur.fetchall()]

                cur.execute(
                    "SELECT count(*), coalesce(sum(quantity), 0) FROM material_defects "
                    "WHERE received_at IS NULL"
                )
                p_cnt, p_qty = cur.fetchone()

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'byUser': by_user,
                        'byReason': by_reason,
                        'neverReported': never,
                        'pendingCount': int(p_cnt),
                        'pendingQuantity': float(p_qty or 0),
                        'months': months,
                    }, ensure_ascii=False),
                }

            if action == 'defect_pending':
                # Брак, который лежит в контейнерах и ещё не доехал до склада.
                # Тянем сразу рулон и поставщика: отрезанные куски поставщик обратно не
                # берёт, но статистику «какой брак из какого рулона» мы ему показываем —
                # это единственный рычаг в разговоре о качестве партии.
                cur.execute(
                    "SELECT d.barcode, m.name, m.unit, d.quantity, d.reason_label, d.user_name, "
                    "w.name, d.created_at, d.user_role, r.barcode, s.name, d.comment "
                    "FROM material_defects d "
                    "JOIN materials m ON m.id = d.material_id "
                    "LEFT JOIN workshops w ON w.id = d.workshop_id "
                    "LEFT JOIN rolls r ON r.id = d.roll_id "
                    "LEFT JOIN suppliers s ON s.id = r.supplier_id "
                    "WHERE d.received_at IS NULL ORDER BY d.created_at"
                )
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'items': [
                        {
                            'barcode': r[0], 'materialName': r[1], 'unit': r[2],
                            'quantity': float(r[3]), 'reasonLabel': r[4], 'userName': r[5],
                            'workshopName': r[6], 'createdAt': r[7].isoformat() + 'Z',
                            'userRole': r[8],
                            'rollBarcode': r[9],
                            'supplierName': r[10],
                            'comment': r[11],
                            # Кусок от 2 пог.м — крупный: такой кладовщик осматривает
                            # тщательно, из него ещё может получиться изделие.
                            'isLarge': float(r[3]) >= 2 and 'м' in (r[2] or ''),
                        }
                        for r in cur.fetchall()
                    ]}, ensure_ascii=False),
                }

            if action == 'defect_history':
                # Принятый брак за период: по нему видно, из каких рулонов и от каких
                # поставщиков идёт плохая ткань. Куски поставщик не забирает, но такую
                # выборку ему показывают как претензию по качеству партии.
                days = int(body_data.get('days') or 30)
                cur.execute(
                    "SELECT d.barcode, m.name, m.unit, d.quantity, d.reason_label, d.user_name, "
                    "d.user_role, r.barcode, s.name, d.received_at, d.received_by_name, d.comment "
                    "FROM material_defects d "
                    "JOIN materials m ON m.id = d.material_id "
                    "LEFT JOIN rolls r ON r.id = d.roll_id "
                    "LEFT JOIN suppliers s ON s.id = r.supplier_id "
                    "WHERE d.received_at IS NOT NULL "
                    f"AND d.received_at >= now() - interval '{days} days' "
                    "ORDER BY d.received_at DESC LIMIT 500"
                )
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'items': [
                        {
                            'barcode': r[0], 'materialName': r[1], 'unit': r[2],
                            'quantity': float(r[3]), 'reasonLabel': r[4], 'userName': r[5],
                            'userRole': r[6], 'rollBarcode': r[7], 'supplierName': r[8],
                            'receivedAt': r[9].isoformat() + 'Z' if r[9] else None,
                            'receivedByName': r[10], 'comment': r[11],
                        }
                        for r in cur.fetchall()
                    ]}, ensure_ascii=False),
                }

            if action == 'defect_receive':
                # Кладовщик сканирует стикер брака из контейнера — брак приходит на склад.
                # Пока не отсканирован, он числится «в контейнере» в цехе: так видно, что
                # реально доехало до склада, а что потерялось по дороге.
                barcode = (body_data.get('barcode') or '').strip().upper()
                if not barcode:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Отсканируйте стикер брака'}, ensure_ascii=False)}
                cur.execute(
                    "SELECT d.id, d.received_at, d.quantity, d.reason_label, m.name, m.unit, d.user_name "
                    "FROM material_defects d JOIN materials m ON m.id = d.material_id "
                    "WHERE d.barcode = %s",
                    (barcode,),
                )
                d_row = cur.fetchone()
                if not d_row:
                    return {'statusCode': 404, 'headers': headers,
                            'body': json.dumps({'error': f'Брак {barcode} не найден'}, ensure_ascii=False)}
                if d_row[1]:
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': f'Брак {barcode} уже принят на склад'}, ensure_ascii=False)}

                cur.execute(
                    "UPDATE material_defects SET received_at = now(), received_by = %s, "
                    "received_by_name = %s WHERE id = %s",
                    (int(actor_id) if actor_id else None, actor_name, d_row[0]),
                )
                log_action(
                    cur, actor_id, actor_name, 'defect_received', 'material_defect', d_row[0],
                    f'Принял брак {barcode} на склад: {d_row[4]} {d_row[2]} {d_row[5] or ""}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'barcode': barcode,
                        'materialName': d_row[4],
                        'quantity': float(d_row[2]),
                        'unit': d_row[5],
                        'reasonLabel': d_row[3],
                        'foundBy': d_row[6],
                    }, ensure_ascii=False),
                }

            if action == 'open_shift_options':
                # Куда сотрудник может выйти сегодня: активные цеха и их активные смены.
                # Нужно для терминала — производственные роли (швея, закройщик, упаковщица)
                # работают гибко и могут открыть смену в любом цехе, а не только в своём.
                # Без этого списка терминал подставлял цех «по адресу» и смену не указывал,
                # из-за чего открыть смену в чужом цехе было невозможно.
                cur.execute(
                    "SELECT w.id, w.name, s.shift_number "
                    "FROM workshops w JOIN shifts s ON s.workshop_id = w.id "
                    "WHERE w.is_active = true AND s.is_active = true "
                    "ORDER BY w.id, s.shift_number"
                )
                by_workshop = {}
                for w_id, w_name, s_num in cur.fetchall():
                    entry = by_workshop.setdefault(
                        w_id, {'id': w_id, 'name': w_name, 'shifts': []}
                    )
                    entry['shifts'].append(s_num)
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'workshops': list(by_workshop.values())}, ensure_ascii=False),
                }

            if action == 'defect_reasons':
                # Рулоны цеха, по которым можно оформить брак, и причины для каждого.
                # Отдаём вместе: терминалу нужен и список рулонов, и подходящие причины —
                # у ткани и тесьмы они разные.
                workshop_id = body_data.get('workshopId')
                # Показываем только те материалы, с которыми роль реально работает:
                # упаковщице — пакеты и этикетки, швее и закройщику — ткань и тесьму.
                # Иначе в списке из десятков рулонов легко выбрать чужой по ошибке.
                role = (body_data.get('role') or '').strip()
                allowed_types = DEFECT_TYPES_BY_ROLE.get(role, ALL_DEFECT_TYPES)
                type_placeholders = ','.join(['%s'] * len(allowed_types))
                cur.execute(
                    "SELECT r.id, r.barcode, m.name, m.unit, mt.name, r.remaining_quantity "
                    "FROM rolls r "
                    "JOIN materials m ON m.id = r.material_id "
                    "JOIN material_types mt ON mt.id = m.type_id "
                    # Рулон, помеченный бракованным, из работы исключаем: пока кладовщик
                    # его не заберёт (или не откажет), резать из него нельзя.
                    "WHERE r.status = 'in_workshop' AND r.remaining_quantity > 0 "
                    "AND r.defect_flagged_at IS NULL "
                    f"AND mt.name IN ({type_placeholders}) "
                    "AND (%s IS NULL OR r.workshop_id = %s) "
                    "ORDER BY mt.name, m.name, r.barcode",
                    (*allowed_types, workshop_id, workshop_id),
                )
                rolls = [
                    {
                        'id': r[0],
                        'barcode': r[1],
                        'materialName': r[2],
                        'unit': r[3],
                        'materialType': r[4],
                        'remaining': float(r[5] or 0),
                        'reasons': DEFECT_REASONS.get(r[4], []),
                    }
                    for r in cur.fetchall()
                ]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'rolls': rolls}, ensure_ascii=False),
                }

            if action == 'defect_writeoff':
                # Списание брака прямо на терминале: сотрудник сканирует СВОЙ штрихкод, и если
                # он штатный работник цеха этого рулона — брак списывается (в том числе за
                # гостевых работников, которым списание в чужом цехе запрещено).
                code = (body_data.get('code') or '').strip()
                roll_id = body_data.get('rollId')
                quantity = body_data.get('quantity')
                comment = (body_data.get('comment') or '').strip()
                reason_code = (body_data.get('reasonCode') or '').strip()
                if not code or not roll_id or quantity in (None, ''):
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Отсканируйте штрихкод, выберите рулон и укажите метраж'})}
                if not reason_code:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Укажите причину брака'}, ensure_ascii=False)}

                m = re.search(r'(\d{1,6}-\d{1,3}-\d{6,8})', code)
                if m:
                    code = m.group(1)
                elif 'barcode=' in code:
                    code = code.split('barcode=')[1].split('&')[0].strip()
                actor_uid = code.split('-')[0]
                if not actor_uid.isdigit():
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный штрихкод'})}

                cur.execute(
                    "SELECT u.full_name, u.role, w.id, u.is_active FROM users u "
                    "LEFT JOIN workshops w ON w.name = u.workshop WHERE u.id = %s",
                    (int(actor_uid),),
                )
                au = cur.fetchone()
                if not au:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}
                if not au[3]:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник неактивен'})}

                cur.execute(
                    "SELECT r.workshop_id, r.remaining_quantity, w.name, m.unit, mt.name, "
                    "r.material_id, r.shift_number "
                    "FROM rolls r "
                    "LEFT JOIN workshops w ON w.id = r.workshop_id "
                    "LEFT JOIN materials m ON m.id = r.material_id "
                    "LEFT JOIN material_types mt ON mt.id = m.type_id WHERE r.id = %s",
                    (int(roll_id),),
                )
                rr = cur.fetchone()
                if not rr:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}

                material_type = rr[4]
                # Брак ведём по ткани, тесьме и упаковке — по остальному материалу нет.
                if material_type not in DEFECT_REASONS:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'По материалу «{material_type}» брак не ведётся'},
                            ensure_ascii=False),
                    }
                reason_label = defect_reason_label(material_type, reason_code)
                if not reason_label:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Причина не подходит к этому материалу'}, ensure_ascii=False),
                    }

                if au[1] not in ('admin', 'storekeeper', 'senior_storekeeper', 'manager') and rr[0] and rr[0] != au[2]:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({
                        'error': f'{au[0]} не относится к цеху «{rr[2]}» — брак может списать только '
                                 f'штатный сотрудник этого цеха'})}

                qty = float(quantity)
                if qty <= 0:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Метраж должен быть больше нуля'})}
                if qty > float(rr[1] or 0):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({
                        'error': f'На рулоне осталось {round(float(rr[1] or 0), 2)} {rr[3] or "м"}'})}

                cur.execute(
                    "INSERT INTO shipments (type, status, comment, completed_at, created_by) "
                    "VALUES ('defect_writeoff', 'Завершено', %s, now(), %s) RETURNING id",
                    (f'{reason_label}. {comment}'.strip('. ') or None, int(actor_uid)),
                )
                shipment_id = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO shipment_items (shipment_id, material_id, roll_id, quantity) "
                    "VALUES (%s, %s, %s, %s)",
                    (shipment_id, rr[5], int(roll_id), qty),
                )
                new_remaining = float(rr[1] or 0) - qty
                if new_remaining <= 0:
                    cur.execute(
                        "UPDATE rolls SET remaining_quantity = 0, status = 'completed', completed_at = now() "
                        "WHERE id = %s", (int(roll_id),))
                else:
                    cur.execute("UPDATE rolls SET remaining_quantity = %s WHERE id = %s",
                                (new_remaining, int(roll_id)))

                # Отдельная запись брака: по ней печатается стикер, кладовщик принимает брак
                # на склад, и по ней же строится статистика — кто сколько брака находит.
                defect_barcode = next_defect_barcode(cur)
                cur.execute(
                    "SELECT id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(actor_uid),),
                )
                sess = cur.fetchone()
                cur.execute(
                    "INSERT INTO material_defects (barcode, roll_id, material_id, user_id, user_name, "
                    "user_role, workshop_id, shift_number, shift_session_id, quantity, reason_code, "
                    "reason_label, comment, shipment_id) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (
                        defect_barcode, int(roll_id), rr[5], int(actor_uid), au[0], au[1],
                        rr[0], rr[6], sess[0] if sess else None, qty, reason_code,
                        reason_label, comment or None, shipment_id,
                    ),
                )
                defect_id = cur.fetchone()[0]

                log_action(
                    cur, int(actor_uid), au[0], 'defect_writeoff', 'shipment', shipment_id,
                    f'Списал брак на терминале: рулон #{roll_id}, {qty} — {reason_label}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'id': shipment_id,
                        'defectId': defect_id,
                        'defectBarcode': defect_barcode,
                        'reasonLabel': reason_label,
                        'materialType': material_type,
                        'unit': rr[3],
                        'actorName': au[0],
                        # На стикере печатается ID, а не фамилия: наклейка маленькая, длинные
                        # ФИО в неё не влезают, а по ID сотрудника всегда видно в системе.
                        'actorId': int(actor_uid),
                    }, ensure_ascii=False),
                }

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}