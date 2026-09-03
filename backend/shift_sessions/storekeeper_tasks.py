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

ОТСЕЧКА 15:00 — ГЛАВНОЕ ПРАВИЛО СПИСКА.
Раньше список был «живым»: работа падала в него до самого закрытия смены. В
половине шестого кладовщику прилетало ещё десять вещей в подбор, и он бежал
искать их по цеху, лишь бы закрыть смену. Список, который невозможно закрыть,
люди перестают выполнять.

Теперь в задания попадает только работа, ПОЯВИВШАЯСЯ ДО 15:00 по Москве. Всё
пришедшее позже кладовщик видит на рабочих страницах (счётчики там живые, ничего
не прячем) и разбирает, если успевает, — но смену это уже не держит. Не успел:
завтра утром эта работа сама попадёт в новый список.

Так у смены появляется финиш: после 15:00 список только уменьшается.
"""

from datetime import timedelta

# Время, после которого новая работа в задания смены больше НЕ попадает.
# 15:00 по Москве: до конца дня остаётся запас, чтобы спокойно доделать список.
TASKS_CUTOFF_HOUR = 15

# Задания, которые копятся до отсечки. Для них считаем только работу, появившуюся
# до 15:00 — по своему полю времени у каждого (когда работа возникла).
CUTOFF_TASKS = (
    'picking', 'cancelled_to_shelf', 'cancelled_labeled',
    'defect_rolls', 'repacked_to_shelf', 'returns',
)

# Порог, с которого рулоны с малым остатком становятся заданием: сходить в цех и
# напомнить закройщикам, что пора их закрывать. Меньше — обычная текучка, ходить
# из-за пары рулонов незачем.
ROLLS_REMINDER_THRESHOLD = 10

# Задания, которые кладовщик закрывает сам галочкой (см. пояснение выше).
MANUAL_TASKS = ('fabric_shipment', 'rolls_reminder')


def cutoff_moment(cur):
    """Граница «свежести» работы для заданий смены — в UTC, как хранятся данные.

    Возвращает момент, ПОЗЖЕ которого появившаяся работа в список смены уже не
    попадает, и признак того, что отсечка наступила.

    До 15:00 по Москве границы нет (None): список живой, всё падает в него сразу.
    После 15:00 граница — сегодняшние 15:00; работа, пришедшая позже, ждёт утра.

    Почему граница считается по МОСКОВСКОМУ времени, а сравнивается с UTC: в базе
    все отметки времени хранятся в UTC, а «15:00» для человека — это 15:00 у него
    на часах. Переводим один раз здесь, чтобы ниже в запросах об этом не думать.
    """
    cur.execute("SELECT (now() + interval '3 hours')")
    msk_now = cur.fetchone()[0]
    if msk_now.hour < TASKS_CUTOFF_HOUR:
        return None, False
    msk_cutoff = msk_now.replace(hour=TASKS_CUTOFF_HOUR, minute=0, second=0, microsecond=0)
    # Обратно в UTC: минус те же 3 часа.
    return msk_cutoff - timedelta(hours=3), True


def _cut(cutoff, column):
    """Кусок SQL «работа появилась до отсечки». До 15:00 — пустой, фильтра нет.

    NULL в поле времени считаем «появилось давно»: у старых записей отметки может
    не быть, и потерять их из списка нельзя — работа-то физически лежит.
    """
    if not cutoff:
        return ''
    return f"  AND ({column} IS NULL OR {column} <= '{cutoff.isoformat()}') "


def _claims(cur):
    """Кто какое задание взял на себя сегодня: {task_key: (user_id, имя)}.

    Кладовщики работают на своих аккаунтах и раньше дублировали работу — оба шли
    в цех за одними и теми же вещами. Метка показывает второму, что дело занято.

    День берём московский: рабочий день считается по местным часам.
    """
    cur.execute(
        "SELECT c.task_key, c.user_id, u.full_name "
        "FROM storekeeper_task_claims c "
        "LEFT JOIN users u ON u.id = c.user_id "
        "WHERE c.claim_date = (now() + interval '3 hours')::date"
    )
    return {r[0]: (r[1], r[2]) for r in cur.fetchall()}


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


def _shift_started_at(cur, session_id):
    """Когда началась смена. Без смены (демо-просмотр) — None."""
    if not session_id:
        return None
    cur.execute("SELECT opened_at FROM shift_sessions WHERE id = %s", (int(session_id),))
    row = cur.fetchone()
    return row[0] if row else None


def _had_returns(cur, session_id):
    """Приезжали ли за эту смену возвраты с ПВЗ.

    Нужно, чтобы отличить «работу сделали» от «работы не было». Пустой счётчик
    в начале смены — это не выполненное задание, а дело, которого ещё не
    появилось: такую строку показываем приглушённой и без галочки.
    """
    started = _shift_started_at(cur, session_id)
    if not started:
        return False
    cur.execute(
        "SELECT 1 FROM goods_warehouse "
        "WHERE COALESCE(receive_reason, '') <> 'cancelled_labeled' "
        "  AND received_at >= %s LIMIT 1",
        (started,),
    )
    return cur.fetchone() is not None


def _had_cancelled_labeled(cur, session_id):
    """Появлялись ли за смену отмены после стикеровки (вещи со стикером FBS)."""
    started = _shift_started_at(cur, session_id)
    if not started:
        return False
    cur.execute(
        "SELECT 1 FROM goods_warehouse "
        "WHERE receive_reason = 'cancelled_labeled' AND received_at >= %s LIMIT 1",
        (started,),
    )
    return cur.fetchone() is not None


def _had_repacked(cur, session_id):
    """Отдавали ли за смену перепакованные вещи из цеха."""
    started = _shift_started_at(cur, session_id)
    if not started:
        return False
    cur.execute(
        "SELECT 1 FROM goods_warehouse WHERE inspected_at >= %s LIMIT 1",
        (started,),
    )
    return cur.fetchone() is not None


def build_tasks(cur, session_id, user_id):
    """Собирает список заданий смены с текущим состоянием каждого.

    Возвращает список словарей: key, title, hint, done, count, link, manual.
      * done  — задание выполнено (галочка);
      * count — сколько работы осталось (0 = ничего не висит);
      * manual — закрывается галочкой вручную, смену не держит;
      * blocking — мешает закрыть смену, пока не выполнено.
    """
    manual = _manual_done(cur, session_id)
    # Граница отсечки: после 15:00 новая работа в список уже не добавляется.
    cutoff, after_cutoff = cutoff_moment(cur)
    claims = _claims(cur)
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
        + _cut(cutoff, 'gw.matched_at')
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
            # Эта работа есть всегда: подбор и отменённые копятся сами,
        # ручные задания кладовщик закрывает каждую смену.
        'idle': False,
    })

    # 2. ЗАБРАТЬ ИЗ ЦЕХА ОТМЕНЁННЫЕ ВЕЩИ.
    # Заказ отменили, вещь уже сшита и лежит в цехе со складским стикером —
    # её надо унести на полку, иначе товар выпадает из оборота.
    # Считаем только застикерованные: без стикера вещь ещё у упаковщицы,
    # кладовщику её пока не отдали.
    cur.execute(
        "SELECT count(*) FROM goods_warehouse "
        "WHERE status = 'awaiting_shelf' AND storage_labeled_at IS NOT NULL"
        + _cut(cutoff, 'storage_labeled_at')
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
            # Эта работа есть всегда: подбор и отменённые копятся сами,
        # ручные задания кладовщик закрывает каждую смену.
        'idle': False,
    })

    # 3. ОТМЕНЁННЫЕ ПОСЛЕ СТИКЕРОВКИ.
    # Вещь сшили, упаковали и заклеили ярлыком маркетплейса — и уже после этого
    # заказ отменили. К покупателю она не уезжала, осматривать её незачем: сразу
    # на полку со стикером хранения. Лежит в той же вкладке «Разобрать возвраты»,
    # но помечена синим — инструмент там тот же, а работа другая и быстрее.
    cur.execute(
        "SELECT count(*) FROM goods_warehouse "
        "WHERE status = 'mp_return' AND receive_reason = 'cancelled_labeled'"
        + _cut(cutoff, 'received_at')
    )
    cancelled_labeled = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'cancelled_labeled',
        'title': 'Отменённые после стикеровки',
        'hint': 'Отмена в цехе со стикером FBS — сразу на полку',
        'count': cancelled_labeled,
        'done': cancelled_labeled == 0,
        'link': '/crm/inventory/returns-inspection',
        'manual': False,
        'blocking': True,
        'idle': cancelled_labeled == 0 and not _had_cancelled_labeled(cur, session_id),
    })

    # 4. ОТСКАНИРОВАТЬ БРАК ИЗ ЦЕХА.
    # Упаковщица списала бракованный кусок на терминале в цехе и наклеила на него
    # стикер. Кусок лежит в контейнере и ждёт, пока кладовщик отсканирует его на
    # складе — это ровно то, что показывает вкладка «Приём брака из цеха».
    #
    # Держит смену: неотсканированный кусок нигде не числится. Он уже списан с
    # рулона, но на склад не принят — и если его потеряют, концов не найти.
    cur.execute(
        "SELECT count(*) FROM material_defects "
        "WHERE received_at IS NULL AND missing_at IS NULL"
        + _cut(cutoff, 'created_at')
    )
    defect_pieces = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'defect_rolls',
        'title': 'Отсканировать брак из цеха',
        'hint': 'Бракованные куски со стикерами — принять сканером на склад',
        'count': defect_pieces,
        'done': defect_pieces == 0,
        'link': '/crm/inventory/defect-receive',
        'manual': False,
        'blocking': True,
        # Куски копятся сами и ждут приёмки сколько угодно долго — в отличие от
        # поставок и возвратов, приглушать тут нечего: пока в контейнере
        # что-то лежит, это работа на сегодня.
        'idle': False,
    })

    # 5. ОТГРУЗИТЬ ПОСТАВКИ FBS.
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
        # ПОКА ПОСТАВОК НЕ СОЗДАВАЛИ — СТРОКА ПРИГЛУШЕНА, БЕЗ ГАЛОЧКИ.
        #
        # В начале смены отгружать нечего, и зачёркнутая строка сбивала бы с
        # толку: выглядит как сделанная работа, хотя её не было. Создал поставку
        # и отгрузил — строка становится выполненной. Создал ещё одну — снова
        # активная, пока не отгрузит.
        'idle': supplies_total == 0,
    })

    # 6. ОТГРУЗИТЬ ТКАНЬ НА ПРОИЗВОДСТВО.
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
            # Эта работа есть всегда: подбор и отменённые копятся сами,
        # ручные задания кладовщик закрывает каждую смену.
        'idle': False,
    })

    # 7. НАПОМНИТЬ ЗАКРОЙЩИКАМ ПРО РУЛОНЫ С МАЛЫМ ОСТАТКОМ.
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
                # Эта работа есть всегда: подбор и отменённые копятся сами,
        # ручные задания кладовщик закрывает каждую смену.
        'idle': False,
    })

    # 8. ЗАБРАТЬ ПЕРЕПАКОВАННЫЕ ИЗ ЦЕХА.
    # Упаковщица переупаковала вещь, наклеила стикер хранения и отдала её. Дальше
    # два шага: кладовщик забирает вещь из цеха (становится 'taken') и кладёт на
    # полку. Считаем ОБА состояния: забранная, но не разложенная вещь лежит в
    # тележке и в подбор не идёт — работа не закончена.
    cur.execute(
        "SELECT count(*) FROM goods_warehouse WHERE status IN ('inspected', 'taken')"
        + _cut(cutoff, 'inspected_at')
    )
    repacked_left = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'repacked_to_shelf',
        'title': 'Забрать перепакованные из цеха',
        'hint': 'Переупакованные вещи со стикером — унести на полки',
        'count': repacked_left,
        'done': repacked_left == 0,
        'link': '/crm/inventory/goods-warehouse',
        'manual': False,
        'blocking': True,
        'idle': repacked_left == 0 and not _had_repacked(cur, session_id),
    })

    # 9. РАЗОБРАТЬ ВОЗВРАТЫ С ПВЗ.
    # Вещи привезены с пункта выдачи и отсканированы, но не разобраны: кладовщик
    # ещё не решил, положить их на полку или отдать на осмотр. Пока они в этом
    # статусе, товар не считается проверенным и в подбор не идёт — поэтому
    # задание держит смену.
    #
    # Отмену после стикеровки сюда НЕ считаем: она лежит в той же вкладке, но это
    # другая работа (см. задание ниже), и смешивать их в одном счётчике нельзя —
    # кладовщик не поймёт, что именно ему разбирать.
    cur.execute(
        "SELECT count(*) FROM goods_warehouse "
        "WHERE status = 'mp_return' "
        "  AND COALESCE(receive_reason, '') <> 'cancelled_labeled'"
        + _cut(cutoff, 'received_at')
    )
    returns_left = int(cur.fetchone()[0] or 0)
    tasks.append({
        'key': 'returns',
        'title': 'Разобрать возвраты с ПВЗ',
        'hint': 'Привезённое с пункта выдачи — осмотреть и разложить',
        'count': returns_left,
        'done': returns_left == 0,
        'link': '/crm/inventory/returns-inspection',
        'manual': False,
        'blocking': True,
        # Работы не появлялось за смену — строка показывается приглушённой:
        # это не выполненное дело, а дело, которого сегодня не было.
        'idle': returns_left == 0 and not _had_returns(cur, session_id),
    })

    # ПОМЕТКА ПРО ОТСЕЧКУ.
    # Ставим её только тем заданиям, которые копятся до 15:00, — чтобы кладовщик
    # понимал: этот список конечен, новая работа сюда сегодня уже не придёт.
    # Показываем пометку и ДО 15:00 (как предупреждение «собери до трёх»), и
    # после (как объяснение, почему счётчик на странице больше, чем в задании).
    for t in tasks:
        if t['key'] in CUTOFF_TASKS:
            t['cutoff'] = True
            t['cutoffPassed'] = after_cutoff

    # КТО ВЗЯЛ ЗАДАНИЕ НА СЕБЯ.
    # Ручные задания (отгрузка ткани, напоминание про рулоны) не делим: там
    # галочка и так ставится руками, а взять «на себя» разговор в цехе нельзя.
    for t in tasks:
        if t['manual']:
            continue
        claim = claims.get(t['key'])
        if not claim:
            continue
        claim_user, claim_name = claim
        t['claimedBy'] = claim_user
        t['claimedByName'] = claim_name
        # Задание взял ДРУГОЙ человек — для текущего оно чужое: трогать нельзя
        # и смену оно ему не держит (см. blocking_tasks).
        t['claimedByOther'] = bool(user_id) and int(claim_user) != int(user_id)

    return tasks


def blocking_tasks(cur, session_id, user_id):
    """Задания, из-за которых нельзя закрыть смену. Пусто — можно закрывать."""
    # Приглушённые (idle) не держат: работы по ним за смену не появлялось,
    # держать человека из-за дела, которого не было, нельзя.
    #
    # Взятое ДРУГИМ кладовщиком (claimedByOther) тоже не держит: за него отвечает
    # тот, кто взял. Иначе двое запирали бы друг друга — первый не может уйти,
    # пока второй не доделает, и наоборот.
    return [
        t for t in build_tasks(cur, session_id, user_id)
        if t['blocking'] and not t['done'] and not t.get('idle')
        and not t.get('claimedByOther')
    ]