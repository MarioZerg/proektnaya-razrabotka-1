"""Задания кладовщика на смену — чек-лист, который он проходит за день.

ЗАЧЕМ ЭТО НУЖНО.
Работа кладовщика состоит из нескольких дел, которые легко забыть под конец дня:
собрать вещи с полок под заказы, забрать из цеха отменённые, отгрузить поставки,
разобрать возвраты. Забытое всплывает наутро: маркетплейс не получил отправление,
вещи лежат в цехе, возврат не осмотрен и не идёт в подбор.

Чек-лист собирает эти дела в один список и не даёт закрыть смену, пока они не
сделаны. Пункты пересчитываются на лету: сделал работу — галочка встала сама.

ДВА ВИДА ЗАДАНИЙ.
Большинство система проверяет по данным — подбор пуст, отменённых в цехе нет,
возвраты разобраны. Но два задания по данным проверить нельзя, их закрывает сам
человек галочкой:
  * отгрузка ткани в цех — материала может не быть на складе, отгружать нечего;
  * напомнить закройщикам про рулоны — это разговор в цехе, в системе его нет.
Без ручной отметки кладовщик застрял бы на задании, которое от него не зависит.

БЛОКИРОВКА ЗАКРЫТИЯ СМЕНЫ.
Держат смену только те задания, где работа реально висит и её видно в системе.
Задания с ручной галочкой смену НЕ держат: иначе достаточно забыть нажать
галочку, чтобы человек не смог уйти домой.
"""

# Порог, с которого рулоны с малым остатком становятся заданием: сходить в цех и
# напомнить закройщикам, что пора их закрывать. Меньше — обычная текучка, ходить
# из-за пары рулонов незачем.
ROLLS_REMINDER_THRESHOLD = 10

# Задания, которые кладовщик закрывает сам галочкой (см. пояснение выше).
MANUAL_TASKS = ('fabric_shipment', 'rolls_reminder')


def _manual_done(cur, session_id):
    """Какие задания кладовщик уже отметил вручную в этой смене.

    Без смены (демо-просмотр у администратора) отметок нет: галочки хранятся
    по смене, а её в этом режиме не существует.
    """
    if not session_id:
        return set()
    cur.execute(
        "SELECT task_key FROM storekeeper_shift_tasks WHERE shift_session_id = %s",
        (int(session_id),),
    )
    return {r[0] for r in cur.fetchall()}


def build_tasks(cur, session_id, user_id):
    """Собирает список заданий смены с текущим состоянием каждого.

    Возвращает список словарей: key, title, hint, done, count, link, manual.
      * done  — задание выполнено (галочка);
      * count — сколько работы осталось (0 = ничего не висит);
      * manual — закрывается галочкой вручную, смену не держит;
      * blocking — мешает закрыть смену, пока не выполнено.
    """
    manual = _manual_done(cur, session_id)
    tasks = []

    # 1. СОБРАТЬ ВЕЩИ С ПОЛОК ПОД ЗАКАЗЫ.
    # Отправления, под которые уже подобрана вещь: её надо снять с полки,
    # отсканировать и наклеить ярлык. Пока висит — маркетплейс ждёт товар.
    # Считаем ровно тем же запросом, что и страница подбора, иначе кладовщик
    # видит в задании одно число, а в списке другое.
    cur.execute(
        "SELECT count(*) FROM goods_warehouse gw "
        "JOIN orders o ON o.id = gw.reserved_order_id "
        "WHERE gw.status IN ('picking', 'awaiting_supply') "
        "  AND gw.reserved_order_id IS NOT NULL "
        "  AND gw.shipped_at IS NULL "
        "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
        "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
        "                  WHERE msi.goods_warehouse_id = gw.id "
        "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
        "  AND COALESCE(o.sewing_status, '') IN ('Новый', 'Со склада') "
        "  AND COALESCE(o.status, '') NOT IN ('Отменён', 'Отгружен', 'Доставлен') "
        "  AND COALESCE(o.ozon_status, '') NOT IN "
        "      ('delivering', 'delivered', 'cancelled', 'not_accepted', 'driver_pickup')"
    )
    picking_left = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'picking',
        'title': 'Собрать товары с подбора',
        'hint': 'Снять вещи с полок под заказы и наклеить ярлыки',
        'count': picking_left,
        'done': picking_left == 0,
        'link': '/crm/inventory/goods-picking',
        'manual': False,
        'blocking': True,
    })

    # 2. ЗАБРАТЬ ИЗ ЦЕХА ОТМЕНЁННЫЕ ВЕЩИ.
    # Заказ отменили, вещь уже сшита и лежит в цехе со складским стикером —
    # её надо унести на полку, иначе товар выпадает из оборота.
    # Считаем только застикерованные: без стикера вещь ещё у упаковщицы,
    # кладовщику её пока не отдали.
    cur.execute(
        "SELECT count(*) FROM goods_warehouse "
        "WHERE status = 'awaiting_shelf' AND storage_labeled_at IS NOT NULL"
    )
    cancelled_left = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'cancelled_to_shelf',
        'title': 'Забрать из цеха отменённые',
        'hint': 'Вещи по отменённым заказам — унести из цеха на полки',
        'count': cancelled_left,
        'done': cancelled_left == 0,
        'link': '/crm/inventory/goods-warehouse',
        'manual': False,
        'blocking': True,
    })

    # 3. ОТГРУЗИТЬ ПОСТАВКИ FBS.
    # В задание попадают поставки, которые кладовщик создал В ЭТУ СМЕНУ. Пока
    # такая поставка не закрыта, смену закрыть нельзя: собранная поставка
    # останется до завтра, а маркетплейс ждёт её сегодня.
    #
    # Чужие и вчерашние поставки человека не держат — он за них не брался.
    if session_id:
        cur.execute(
            "SELECT count(*) FROM storekeeper_shift_supplies sss "
            "JOIN marketplace_supplies ms ON ms.id = sss.supply_id "
            "WHERE sss.shift_session_id = %s "
            "  AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')",
            (int(session_id),),
        )
        supplies_open = int(cur.fetchone()[0] or 0)
        cur.execute(
            "SELECT count(*) FROM storekeeper_shift_supplies WHERE shift_session_id = %s",
            (int(session_id),),
        )
        supplies_total = int(cur.fetchone()[0] or 0)
    else:
        # Демо-просмотр без смены: показываем НЕЗАКРЫТЫЕ поставки FBS вообще —
        # чтобы задание выглядело как в реальной работе, с живыми цифрами.
        cur.execute(
            "SELECT count(*) FROM marketplace_supplies "
            "WHERE type = 'FBS' AND COALESCE(is_accumulator, false) = false "
            "  AND COALESCE(status, '') NOT IN ('Выполнена', 'Отменена')"
        )
        supplies_open = int(cur.fetchone()[0] or 0)
        supplies_total = supplies_open
    tasks.append({
        'key': 'fbs_supplies',
        'title': 'Отгрузить поставки FBS',
        'hint': ('Поставки, созданные в эту смену: OZON, WB, Яндекс'
                 if supplies_total else 'Появится, когда создадите поставку FBS'),
        'count': supplies_open,
        # Поставок не создавали — отгружать нечего, задание не мешает.
        'done': supplies_open == 0,
        'link': '/crm/shipments/to-marketplace',
        'manual': False,
        'blocking': True,
    })

    # 4. ОТГРУЗИТЬ ТКАНЬ НА ПРОИЗВОДСТВО.
    # Ручное задание: материала может не быть на складе, и тогда отгружать
    # нечего. Показываем, сколько поставок в цех ещё не уехало — как подсказку,
    # но закрывает задание сам кладовщик.
    # Статус «Новый» — поставка собрана на складе, но со склада ещё не уехала.
    # Тип to_workshop: это именно поставки материала в цех, а не отгрузки на
    # маркетплейс, которые живут в той же таблице.
    cur.execute(
        "SELECT count(*) FROM shipments "
        "WHERE type = 'to_workshop' AND COALESCE(status, '') = 'Новый'"
    )
    fabric_left = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'fabric_shipment',
        'title': 'Отгрузить ткань на производство',
        'hint': 'Нет материала к отгрузке — отметьте галочкой',
        'count': fabric_left,
        'done': 'fabric_shipment' in manual,
        'link': '/crm/shipments/to-workshop',
        'manual': True,
        'blocking': False,
    })

    # 5. НАПОМНИТЬ ЗАКРОЙЩИКАМ ПРО РУЛОНЫ С МАЛЫМ ОСТАТКОМ.
    # Задание появляется, только когда таких рулонов много: из-за пары штук
    # ходить в цех незачем. Закрывает галочкой — разговор в цехе система не видит.
    cur.execute(
        "SELECT count(*) FROM rolls r "
        "LEFT JOIN materials m ON m.id = r.material_id "
        "WHERE r.status = 'in_workshop' AND r.remaining_quantity < 20 "
        "  AND LOWER(REPLACE(COALESCE(m.unit, ''), ' ', '')) NOT LIKE 'шт%' "
        "  AND LOWER(REPLACE(COALESCE(m.unit, ''), ' ', '')) NOT LIKE 'кг%'"
    )
    low_rolls = int(cur.fetchone()[0] or 0)
    if low_rolls >= ROLLS_REMINDER_THRESHOLD:
        tasks.append({
            'key': 'rolls_reminder',
            'title': 'Напомнить про рулоны с малым остатком',
            'hint': f'{low_rolls} рулонов в цехе заканчиваются — попросить закройщиков закрыть',
            'count': low_rolls,
            'done': 'rolls_reminder' in manual,
            'link': '/crm/inventory/rolls?low=1',
            'manual': True,
            'blocking': False,
        })

    # 6. РАЗОБРАТЬ ВОЗВРАТЫ С ПВЗ.
    # Вещи привезены с пункта выдачи и отсканированы, но не разобраны: кладовщик
    # ещё не решил, положить их на полку или отдать на осмотр. Пока они в этом
    # статусе, товар не считается проверенным и в подбор не идёт — поэтому
    # задание держит смену.
    cur.execute("SELECT count(*) FROM goods_warehouse WHERE status = 'mp_return'")
    returns_left = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'returns',
        'title': 'Разобрать возвраты с ПВЗ',
        'hint': 'Привезённое с пункта выдачи — осмотреть и разложить',
        'count': returns_left,
        'done': returns_left == 0,
        'link': '/crm/inventory/goods-warehouse',
        'manual': False,
        'blocking': True,
    })

    return tasks


def blocking_tasks(cur, session_id, user_id):
    """Задания, из-за которых нельзя закрыть смену. Пусто — можно закрывать."""
    return [
        t for t in build_tasks(cur, session_id, user_id)
        if t['blocking'] and not t['done']
    ]