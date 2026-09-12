"""Склад готового товара — общие части: константы, справочники и функции,
которыми пользуются и чтение, и действия.

Вынесено из index.py: в одном файле было 4693 строки, и любая правка требовала
листать его целиком. Код перенесён КАК ЕСТЬ, логика не менялась.
"""

import json
import urllib.request


# ВАЖНО о времени: база живёт по UTC, а цех — по Москве (разница 3 часа).
#
# Все отметки времени отдаются с суффиксом 'Z' — это метка «время в UTC». По ней
# приложение само переводит момент в московский. Без 'Z' браузер считает время
# местным и показывает его на 3 часа раньше: кладовщик принимал возврат в 14:00,
# а в списке значилось 11:00, и найти свою же приёмку было невозможно.
#
# Если добавляете новое поле с датой — не забудьте про 'Z'.

# Статусы OZON, при которых вещь ФИЗИЧЕСКИ ещё не у покупателя и не может быть возвратом.
# Отсканировать такую вещь на приёмке возврата нельзя: она либо на нашем складе, либо
# едет к покупателю. Кладовщик по ошибке принял бы её как возврат и потерял отправление.
OZON_NOT_RETURNABLE = {
    'awaiting_packaging': 'ожидает сборки',
    'awaiting_deliver': 'ожидает отгрузки',
    'delivering': 'доставляется',
    'driver_pickup': 'у водителя',
    'acceptance_in_progress': 'идёт приёмка',
    'awaiting_approve': 'ожидает подтверждения',
    'awaiting_registration': 'ожидает регистрации',
    'not_accepted': 'не принят на сортировке',
}

# Причины возврата/отмены на OZON — как их присылает маркетплейс. Показываем кладовщику
# по-русски: в сыром виде это техническая строка, по которой ничего не понять.
OZON_CANCEL_REASONS = {
    'client_rejected_at_delivery': 'Отказался при вручении',
    'buyer_rejected': 'Отказался при вручении',
    'rejected_at_pickup': 'Отказался в пункте выдачи',
    'product_not_suitable': 'Товар не подошёл',
    'size_not_suitable': 'Не подошёл размер',
    'color_not_suitable': 'Не подошёл цвет',
    'found_cheaper': 'Нашёл дешевле',
    'quality_issue': 'Претензия к качеству',
    'defective': 'Брак',
    'damaged': 'Повреждён при доставке',
    'wrong_product': 'Прислали не тот товар',
    'no_longer_needed': 'Больше не нужен',
    'delivery_too_long': 'Долгая доставка',
    'not_delivered': 'Не доставлен покупателю',
    'buyer_not_come': 'Покупатель не забрал',
    'expired_storage': 'Истёк срок хранения в пункте выдачи',
    'cancelled_by_client': 'Отменён покупателем',
    'cancelled_by_seller': 'Отменён продавцом',
}

def resolve_ozon_barcode(cur, barcode):
    """Превращает штрихкод с ярлыка FBS в номер отправления.

    На ярлыке OZON крупно печатает свой штрихкод, а не номер отправления — сканер
    считывает именно его, и в нашей базе такого кода нет. Спрашиваем номер у OZON.
    """
    if not barcode.isdigit() or len(barcode) < 12:
        return None
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'ozon' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
    )
    row = cur.fetchone()
    if not row or not row[0] or not row[1]:
        return None
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1])
    client_id = (creds.get('clientId') or creds.get('client_id') or '').strip()
    api_key = (creds.get('apiKey') or creds.get('api_key') or '').strip()
    if not client_id or not api_key:
        return None
    req = urllib.request.Request(
        'https://api-seller.ozon.ru/v2/posting/fbs/get-by-barcode',
        method='POST',
        data=json.dumps({'barcode': str(barcode)}).encode('utf-8'),
    )
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode('utf-8') or '{}')
        return ((data.get('result') or {}).get('posting_number')) or None
    except Exception:
        return None


def is_admin(cur, actor_id) -> bool:
    """Роль берём из базы: в запросе её можно подменить, в базе — нет."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def is_admin_or_senior(cur, actor_id) -> bool:
    """Админ или СТАРШИЙ кладовщик.

    Списание вещи со склада — решение с ценой: вещь уходит в утиль, а заказ едет шиться
    заново, то есть ткань и работа цеха тратятся второй раз. Обычный кладовщик такое
    решение принимать не должен: не нашёл — зовёт старшего.
    """
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] in ('admin', 'senior_storekeeper'))


def notify_admin(cur, kind, title, message, actor_id, actor_name, link=None,
                 entity_type=None, entity_id=None):
    """Кладёт событие на панель администратора.

    Решения кладовщика, стоящие денег (списание готовой вещи, отправка в пошив заново),
    админ должен увидеть сразу, а не найти случайно в журнале через неделю.
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


def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description, details=None):
    """Пишет запись в журнал действий (audit_log) в той же транзакции перед commit()."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'warehouse',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


# Этапы, после которых вещь уже в производстве: ткань раскроена, потрачен труд.
# Такой заказ подбирать со склада поздно — иначе работа цеха пропадёт впустую.
NOT_STARTED_SEWING = 'Новый'

# Статусы заказа, при которых бронь на вещь СЧИТАЕТСЯ ЖИВОЙ: заказ всё ещё ждёт
# именно эту вещь с полки. Всё остальное — мёртвая бронь: заказ уже отгружен,
# отменён, уехал к покупателю или ушёл на конвейер и будет закрыт новой вещью.
# Мёртвая бронь не должна ни звать кладовщика в подбор, ни запрещать смену полки.
RESERVE_ALIVE_SQL = (
    "(COALESCE(ro.sewing_status, '') IN ('Новый', 'Со склада') "
    " AND COALESCE(ro.status, '') NOT IN ('Отменён', 'Отгружен', 'Доставлен') "
    " AND COALESCE(ro.ozon_status, '') NOT IN "
    "     ('delivering', 'delivered', 'cancelled', 'not_accepted', 'driver_pickup'))"
)


# Сколько вещей помещается на одну полку. Больше не кладём: полка забивается,
# вещи мнутся и кладовщик перестаёт находить нужную.
SHELF_CAPACITY = 50


def pick_shelf_for_item(cur, gw_id):
    """Сама выбирает полку, на которую лечь вещи. Кладовщик её больше не указывает.

    Раньше полку выбирал человек, и каждый делал по-своему: одинаковые шторы
    расползались по всему складу, а на подборе их приходилось искать по трём
    полкам сразу. Плюс полки набивались неравномерно — одна ломилась, соседняя
    пустовала.

    Правила простые и в таком порядке:
      1) Однотипный товар — вместе. Ищем полку, где уже лежит такая же ткань
         того же размера: собирать заказ с одной полки быстрее всего.
      2) Ходовой товар — ближе. Чем чаще ткань уходит в заказы, тем меньший
         номер полки ей достаётся: ходовое лежит в начале стеллажа, редкое —
         в глубине.
      3) Полка заполнена (50 вещей) — берём следующую свободную.

    Возвращает (shelf_id, shelf_name, reason) или (None, None, текст ошибки).
    """
    # Что за вещь кладём: ткань и размер берём из заказа.
    cur.execute(
        "SELECT o.material, o.width, o.height FROM goods_warehouse gw "
        "LEFT JOIN orders o ON o.id = gw.order_id WHERE gw.id = %s",
        (int(gw_id),),
    )
    row = cur.fetchone()
    material, width, height = (row or (None, None, None))

    # Занятость всех полок одним запросом: дальше выбираем только по этим числам.
    cur.execute(
        "SELECT s.id, s.name, "
        "  (SELECT COUNT(*) FROM goods_warehouse g "
        "     WHERE g.shelf_id = s.id AND g.status = 'in_stock') "
        "FROM shelves s ORDER BY s.name"
    )
    shelves = [{'id': r[0], 'name': r[1], 'count': int(r[2] or 0)} for r in cur.fetchall()]
    if not shelves:
        return None, None, 'На складе не заведено ни одной полки'

    free = [s for s in shelves if s['count'] < SHELF_CAPACITY]
    if not free:
        return None, None, (
            f'Все полки заполнены (по {SHELF_CAPACITY} вещей). '
            f'Освободите место или заведите новую полку'
        )

    # 1. Такой же товар уже где-то лежит — кладём туда же, пока есть место.
    if material and width and height:
        cur.execute(
            "SELECT gw.shelf_id, COUNT(*) FROM goods_warehouse gw "
            "JOIN orders o ON o.id = gw.order_id "
            "WHERE gw.status = 'in_stock' AND gw.shelf_id IS NOT NULL "
            "  AND o.material = %s AND o.width = %s AND o.height = %s "
            "GROUP BY gw.shelf_id ORDER BY COUNT(*) DESC",
            (material, width, height),
        )
        free_ids = {s['id']: s for s in free}
        for shelf_id, _cnt in cur.fetchall():
            same = free_ids.get(shelf_id)
            if same:
                return same['id'], same['name'], 'рядом с такими же'

    # 2. Ходовой товар — в начало стеллажа. Считаем, сколько раз эта ткань
    #    уходила в заказы за последние 60 дней: чем чаще, тем ближе полка.
    is_popular = False
    if material:
        cur.execute(
            "SELECT COUNT(*) FROM orders "
            "WHERE material = %s AND created_at > now() - interval '60 days'",
            (material,),
        )
        material_orders = int((cur.fetchone() or [0])[0] or 0)
        cur.execute(
            "SELECT COUNT(*) FROM orders WHERE created_at > now() - interval '60 days'"
        )
        all_orders = int((cur.fetchone() or [0])[0] or 0)
        # Ходовой — это ткань, дающая заметную долю всех заказов.
        is_popular = all_orders > 0 and (material_orders / all_orders) >= 0.15

    if is_popular:
        # Первая свободная по названию — она же ближняя на стеллаже.
        target = free[0]
        return target['id'], target['name'], 'ходовой товар, ближняя полка'

    # 3. Обычный товар — на самую свободную полку, чтобы склад набивался ровно.
    target = sorted(free, key=lambda s: (s['count'], s['name']))[0]
    return target['id'], target['name'], 'свободное место'


def log_return_history(cur, gw_id, order_id, actor_id, actor_name,
                       mp_return_id=None, return_reason=None, marketplace=None,
                       posting_number=None):
    """Записывает ВОЗВРАТ вещи в её историю.

    Кладовщик при разборе должен видеть, сколько раз эту вещь уже возвращали:
    вещь, приехавшая обратно в третий раз, почти наверняка с изъяном — её нужно
    осмотреть, а не класть на полку и отправлять следующему покупателю.

    Номер возврата считаем от того, что уже записано по этой вещи. Повторное
    сканирование той же коробки историю не задваивает: на пару «вещь + возврат
    маркетплейса» стоит уникальный индекс, и вторая запись просто не создаётся.
    """
    cur.execute(
        "SELECT COALESCE(MAX(return_number), 0) + 1 FROM goods_return_history "
        "WHERE goods_warehouse_id = %s",
        (int(gw_id),),
    )
    next_number = int(cur.fetchone()[0] or 1)

    order_number = None
    if order_id:
        cur.execute(
            "SELECT order_number, marketplace, ozon_posting_number FROM orders WHERE id = %s",
            (int(order_id),),
        )
        o_row = cur.fetchone()
        if o_row:
            order_number = o_row[0]
            marketplace = marketplace or o_row[1]
            posting_number = posting_number or o_row[2]

    cur.execute(
        "INSERT INTO goods_return_history (goods_warehouse_id, return_number, "
        "  order_id, order_number, posting_number, marketplace, return_reason, "
        "  marketplace_return_id, received_by, received_by_name) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT DO NOTHING",
        (int(gw_id), next_number, int(order_id) if order_id else None,
         order_number, posting_number, marketplace, return_reason,
         int(mp_return_id) if mp_return_id else None,
         int(actor_id) if actor_id else None, actor_name),
    )
    return next_number


def try_match_orders_from_stock(cur, gw_id=None):
    """Ищет заказы, которые можно закрыть вещами со склада, и резервирует их.

    Раньше подбор срабатывал ТОЛЬКО в момент прихода заказа с маркетплейса: если вещь
    появлялась на полке позже (швея дошила, вернули возврат, принял админ), заказ так и
    уходил в пошив, хотя на складе уже лежала готовая вещь.
    Теперь подбор запускается и в обратную сторону — когда вещь легла на полку.

    Правила:
      * берём только заказы, к которым ЕЩЁ НЕ ПРИСТУПИЛИ (sewing_status='Новый'):
        если закройщик уже взял заказ в раскрой, вещь со склада ему не подсунуть;
      * одна вещь — один заказ (reserved_order_id), двойного резерва не бывает;
      * подбираются только OZON и WB; заказы Яндекса всегда идут в пошив (см. ниже);
      * FIFO: сначала уходят вещи, дольше всех лежащие на полке.

    Возвращает список подобранных пар для журнала и уведомления кладовщику.
    """
    matched = []

    # Свободные вещи НА ПОЛКЕ: не зарезервированы, в наличии и РЕАЛЬНО ПРИНЯТЫ
    # кладовщиком на конкретную полку (shelf_id заполнен).
    #
    # ПОЧЕМУ ВАЖНА ПОЛКА.
    # Вещь из цеха по отменённому заказу упаковщица закрывает на терминале и
    # клеит на неё стикер хранения — но вещь при этом ещё лежит в цехе. Она
    # становится складским остатком только когда кладовщик отсканирует стикер
    # и положит её на полку.
    #
    # Раньше подбор брал любую вещь в статусе «в наличии», даже без полки:
    # система закрывала ею новый заказ, кладовщик шёл к стеллажу — а вещи там
    # нет, она всё ещё в цехе. Заказ числился собранным со склада, ярлык
    # печатать не с чего, и отправление зависало.
    #
    # Теперь пока кладовщик не принял вещь на полку — для подбора её не
    # существует.
    where_gw = ("gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
                "AND gw.shelf_id IS NOT NULL")
    if gw_id:
        where_gw += f" AND gw.id = {int(gw_id)}"
    # FOR UPDATE OF gw SKIP LOCKED: вещь, которую параллельно резервирует другой процесс,
    # пропускаем — так одна вещь физически не может уйти в два заказа сразу.
    cur.execute(
        "SELECT gw.id, src.marketplace_item_id, src.product FROM goods_warehouse gw "
        "JOIN orders src ON src.id = gw.order_id "
        f"WHERE {where_gw} AND src.product IS NOT NULL "
        "ORDER BY gw.received_at ASC "
        "FOR UPDATE OF gw SKIP LOCKED"
    )
    free_stock = cur.fetchall()
    if not free_stock:
        return matched

    # Складываем свободные вещи по НАЗВАНИЮ товара («Лен 300x245»). В названии материал и размер:
    # ровно то, чем вещи отличаются друг от друга на полке. Штучные заказы OZON и WB
    # подбираются по нему, а не по коду справочника: код заполнен не у всех вещей
    # (например, у возвратов и принятых вручную), и такие вещи автоподбор просто не
    # видел — заказ уходил в пошив, хотя готовый товар лежал на складе.
    by_product = {}
    for row_gw_id, _item_id, product in free_stock:
        by_product.setdefault(product, []).append(int(row_gw_id))


    # --- 1. Яндекс: со склада НЕ подбираем вовсе ----------------------------------
    #
    # Заказы Яндекса всегда уходят в пошив, даже если точно такой товар лежит на полке.
    #
    # Причина в устройстве самого Яндекса: на весь заказ покупателя выдаётся ОДИН ярлык,
    # и вещи обязаны уехать вместе. Любая попытка закрыть такой заказ складом упирается
    # в это: закрыть часть нельзя (половина уедет, половина будет шиться, а ярлык один),
    # а закрывать целиком — значит держать на полке готовыми сразу все позиции заказа и
    # выдёргивать их из свободного остатка, откуда их ждут штучные заказы OZON и WB.
    # На практике это чаще путало склад, чем экономило пошив.
    #
    # Поэтому подбор для Яндекса отключён полностью: заказ целиком идёт в цех, а вещи
    # на полке остаются свободны для OZON и WB. Ниже, в штучном подборе, заказы Яндекса
    # тоже исключены (marketplace <> 'Yandex').

    # --- 2. OZON и WB: вещи штучные, подбираем по одной ---------------------------
    if by_product:
        # SKIP LOCKED: заказы, которые прямо сейчас забирает закройщик, пропускаем —
        # вещь со склада под них подберётся в следующий раз, если они вернутся в очередь.
        names_csv = ','.join("'" + p.replace("'", "''") + "'" for p in by_product)
        cur.execute(
            "SELECT id, product FROM orders "
            "WHERE marketplace <> 'Yandex' AND group_key IS NULL "
            f"AND sewing_status = '{NOT_STARTED_SEWING}' AND fulfilled_from_stock_id IS NULL "
            # ЖЁСТКОЕ УСЛОВИЕ: заказ не должен быть закреплён НИ ЗА КЕМ.
            #
            # Статуса «Новый» мало. Заказ может числиться новым, но уже лежать у
            # конкретного человека: закройщица взяла стек и не отметила раскрой,
            # заказ вернули по конвейеру назад, админ переназначил исполнителя.
            # Вещь при этом закреплена за сотрудником, а подбор её всё равно
            # забирал — человек шёл искать работу, которой у него больше нет,
            # а раскроенный крой оставался висеть ничейным.
            #
            # Теперь подбор берёт ТОЛЬКО заказы, за которыми не стоит ни один
            # сотрудник и по которым цех не сделал ни одного движения.
            "AND assigned_user_id IS NULL "
            "AND cutter_user_id IS NULL "
            "AND sewer_user_id IS NULL "
            "AND packer_user_id IS NULL "
            "AND cut_at IS NULL AND taken_at IS NULL "
            # Ткань уже списана — значит крой физически сделан, вещь существует
            # в цехе. Подменять её складом нельзя: материал и работа пропадут.
            "AND NOT EXISTS (SELECT 1 FROM order_material_usage omu "
            "   WHERE omu.order_id = orders.id) "
            "AND COALESCE(status, '') <> 'Отменён' "
            # Подбирать со склада можно ТОЛЬКО отправления, которые маркетплейс ещё
            # ждёт от нас: у OZON это «ожидает упаковки» (awaiting_packaging).
            #
            # Если отправление уже в «ожидает отгрузки» (awaiting_deliver) или уехало,
            # маркетплейс считает его собранным: ярлык не выдаётся, в поставку вещь не
            # отсканировать, по конвейеру она тоже не пройдёт — упаковщице нечего
            # печатать. Раньше такие заказы падали в подбор, кладовщик шёл за товаром,
            # а на стикеровке упирался в тупик.
            #
            # У WB и Яндекса поле ozon_status пустое — условие их не касается.
            "AND COALESCE(ozon_status, '') NOT IN "
            "    ('awaiting_deliver', 'delivering', 'delivered', 'cancelled', "
            "     'not_accepted', 'driver_pickup') "
            # Соседи по ОТПРАВЛЕНИЮ уже в цехе — склад не трогаем.
            #
            # Многовещевое отправление OZON приходит к нам как несколько заданий с одним
            # номером посылки, и ярлык на него ОДИН. Если одну вещь уже кроят или шьют, а
            # вторую закрыть со склада, посылка разъезжается: часть уезжает с полки, часть
            # доделывает цех — и дошитая вещь остаётся никому не нужной. Именно так вещь,
            # уже взятая швеёй в работу, второй раз уходила в подбор, а потом висела на
            # терминале: заказ закрыт подменой, а стикеровать нечего.
            #
            # Поэтому подбираем только те отправления, где НИ ОДНА вещь ещё не пошла в
            # производство. Как только цех взялся за посылку — доделывает её целиком.
            "AND NOT EXISTS (SELECT 1 FROM orders sib "
            "   WHERE sib.ozon_posting_number IS NOT NULL "
            "     AND sib.ozon_posting_number = orders.ozon_posting_number "
            "     AND sib.id <> orders.id "
            "     AND COALESCE(sib.status, '') <> 'Отменён' "
            f"     AND sib.sewing_status NOT IN ('{NOT_STARTED_SEWING}', 'Со склада')) "
            # Ключ подбора — НАЗВАНИЕ товара, в нём материал и размер. Кладовщик на полке
            # различает вещи именно по ним, а не по коду справочника: код заполнен не у
            # всех вещей, и раньше такой товар автоподбор не видел вовсе.
            f"AND product IN ({names_csv}) "
            "ORDER BY (order_type = 'FBS') DESC, created_at ASC, id ASC "
            "FOR UPDATE SKIP LOCKED"
        )
        for order_id, order_product in cur.fetchall():
            pool = by_product.get(order_product)
            if not pool:
                continue
            pick_id = pool.pop(0)
            cur.execute(
                # Подобранная вещь сразу переходит в «На сборке»: она больше не свободный
                # остаток на полке, а конкретное отправление, за которым идёт кладовщик.
                # Пока она числилась «На хранении», её было видно как доступный товар —
                # и её же могли переложить или посчитать свободной.
                # Ярлык предыдущего отправления с вещи СНИМАЕМ.
                #
                # Вещь могла быть уже отстикерована под другой заказ, который потом
                # отменили на маркетплейсе. Ярлык при этом оставался в системе, и вещь
                # выглядела «уже собранной»: сканер подбора говорил «стикер наклеен,
                # неси в короб», хотя на пакете висела наклейка ОТМЕНЁННОГО заказа —
                # на приёмке такую вещь не берут. Новый заказ — новый ярлык.
                "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now(), "
                "shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                "shipping_labeled_by_name = NULL, "
                "status = 'picking' WHERE id = %s",
                (int(order_id), pick_id),
            )
            cur.execute(
                "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' "
                "WHERE id = %s",
                (pick_id, int(order_id)),
            )
            matched.append({'gwId': pick_id, 'orderId': int(order_id), 'groupKey': None})

    return matched


def next_storage_barcode(cur) -> str:
    """Следующий стикер хранения GW-XXXXXX — номер выдаёт САМА БАЗА.

    Раньше номер считали как «максимум плюс один»: читали все выданные коды,
    брали наибольший, прибавляли единицу. Код при этом обязан быть уникальным.

    Когда два терминала закрывали заказы одновременно, оба успевали прочитать
    базу до записи друг друга и получали ОДИН И ТОТ ЖЕ номер. Второй падал на
    уникальности — и обрывал всю операцию закрытия заказа: складская запись не
    создавалась, зарплата швее и упаковщице не начислялась, в журнале не
    оставалось следа. Упаковка при этом уже списана, статус «Готовые»
    проставлен: заказ выглядит закрытым, а люди за него денег не получили.

    Счётчик базы выдаёт номер атомарно — двум запросам одно значение достаться
    не может, сколько бы терминалов ни работало разом.
    """
    cur.execute("SELECT nextval('goods_warehouse_storage_seq')")
    return f"GW-{int(cur.fetchone()[0]):06d}"

