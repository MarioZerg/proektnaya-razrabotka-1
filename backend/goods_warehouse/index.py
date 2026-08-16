import json
import os
import urllib.request

import psycopg2


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
        "WHERE marketplace_code = 'ozon'"
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
      * OZON и WB подбираются поштучно, а заказ Яндекса — только целиком (см. ниже);
      * FIFO: сначала уходят вещи, дольше всех лежащие на полке.

    Возвращает список подобранных пар для журнала и уведомления кладовщику.
    """
    matched = []

    # Свободные вещи на полке: не зарезервированы, лежат в наличии.
    where_gw = "gw.status = 'in_stock' AND gw.reserved_order_id IS NULL"
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

    # Складываем свободные вещи по товару справочника: ключ — marketplace_item_id.
    # Нужен для Яндекса, где заказ закрывается только целиком по составу.
    by_item = {}
    # И отдельно — по НАЗВАНИЮ товара («Лен 300x245»). В названии материал и размер:
    # ровно то, чем вещи отличаются друг от друга на полке. Штучные заказы OZON и WB
    # подбираются по нему, а не по коду справочника: код заполнен не у всех вещей
    # (например, у возвратов и принятых вручную), и такие вещи автоподбор просто не
    # видел — заказ уходил в пошив, хотя готовый товар лежал на складе.
    by_product = {}
    for row_gw_id, item_id, product in free_stock:
        if item_id is not None:
            by_item.setdefault(int(item_id), []).append(int(row_gw_id))
        by_product.setdefault(product, []).append(int(row_gw_id))


    # --- 1. Яндекс: заказ покупателя закрывается ТОЛЬКО целиком -------------------
    # У Яндекса на весь заказ один ярлык, вещи едут вместе. Закрыть часть заказа со
    # склада нельзя: половина уедет, половина будет шиться, а ярлык один. Поэтому
    # берём связку только если на складе есть ВСЕ её вещи; иначе не трогаем склад —
    # заказ шьётся целиком, а вещи остаются свободны для других заказов.
    cur.execute(
        "SELECT group_key FROM orders "
        "WHERE marketplace = 'Yandex' AND group_key IS NOT NULL "
        f"AND sewing_status = '{NOT_STARTED_SEWING}' AND fulfilled_from_stock_id IS NULL "
        "AND COALESCE(status, '') <> 'Отменён' "
        "GROUP BY group_key ORDER BY min(created_at) ASC"
    )
    group_keys = [r[0] for r in cur.fetchall()]

    for gkey in group_keys:
        # SKIP LOCKED: строки, которые прямо сейчас забирает закройщик, не попадут в выборку.
        # Тогда связка окажется неполной и мы её просто пропустим — работу из цеха не отбираем.
        cur.execute(
            "SELECT id, marketplace_item_id FROM orders "
            "WHERE group_key = %s AND fulfilled_from_stock_id IS NULL "
            f"AND sewing_status = '{NOT_STARTED_SEWING}' "
            "AND COALESCE(status, '') <> 'Отменён' ORDER BY group_position, id "
            "FOR UPDATE SKIP LOCKED",
            (gkey,),
        )
        units = cur.fetchall()
        if not units:
            continue

        # Все вещи связки должны быть доступны: если часть заблокирована цехом или уже
        # закрыта, размер выборки не совпадёт с реальным размером заказа — не трогаем.
        cur.execute(
            "SELECT count(*) FROM orders WHERE group_key = %s "
            "AND COALESCE(status, '') <> 'Отменён'",
            (gkey,),
        )
        if len(units) != int(cur.fetchone()[0]):
            continue
        # Вся связка должна быть ещё не начата: если хоть одну вещь уже кроят, заказ
        # доделывает цех целиком.
        cur.execute(
            "SELECT count(*) FROM orders WHERE group_key = %s "
            f"AND sewing_status <> '{NOT_STARTED_SEWING}' AND COALESCE(status, '') <> 'Отменён'",
            (gkey,),
        )
        if int(cur.fetchone()[0]) > 0:
            continue

        # Хватит ли склада на ВСЮ связку: считаем потребность по каждому товару.
        need = {}
        for _, unit_item in units:
            if not unit_item:
                need = None
                break
            need[int(unit_item)] = need.get(int(unit_item), 0) + 1
        if not need:
            continue
        if any(len(by_item.get(k, [])) < n for k, n in need.items()):
            continue  # склад не покрывает заказ целиком — шьём всё, склад не трогаем

        for unit_id, unit_item in units:
            pick_id = by_item[int(unit_item)].pop(0)
            # Вещь ушла в связку Яндекса — вычёркиваем её и из списка по названию,
            # иначе тот же товар вторым проходом уйдёт ещё и в заказ OZON или WB.
            for pool_by_name in by_product.values():
                if pick_id in pool_by_name:
                    pool_by_name.remove(pick_id)
            cur.execute(
                # Подобранная вещь сразу переходит в «На сборке»: она больше не свободный
                # остаток на полке, а конкретное отправление, за которым идёт кладовщик.
                # Пока она числилась «На хранении», её было видно как доступный товар —
                # и её же могли переложить или посчитать свободной.
                "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now(), "
                "status = 'picking' WHERE id = %s",
                (int(unit_id), pick_id),
            )
            cur.execute(
                "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' "
                "WHERE id = %s",
                (pick_id, int(unit_id)),
            )
            matched.append({'gwId': pick_id, 'orderId': int(unit_id), 'groupKey': gkey})

    # --- 2. OZON и WB: вещи штучные, подбираем по одной ---------------------------
    if by_product:
        # SKIP LOCKED: заказы, которые прямо сейчас забирает закройщик, пропускаем —
        # вещь со склада под них подберётся в следующий раз, если они вернутся в очередь.
        names_csv = ','.join("'" + p.replace("'", "''") + "'" for p in by_product)
        cur.execute(
            "SELECT id, product FROM orders "
            "WHERE marketplace <> 'Yandex' AND group_key IS NULL "
            f"AND sewing_status = '{NOT_STARTED_SEWING}' AND fulfilled_from_stock_id IS NULL "
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
            # Вещь занята — убираем её и из списка по коду справочника, чтобы связка
            # Яндекса при следующем проходе не посчитала её свободной.
            for pool_by_item in by_item.values():
                if pick_id in pool_by_item:
                    pool_by_item.remove(pick_id)
            cur.execute(
                # Подобранная вещь сразу переходит в «На сборке»: она больше не свободный
                # остаток на полке, а конкретное отправление, за которым идёт кладовщик.
                # Пока она числилась «На хранении», её было видно как доступный товар —
                # и её же могли переложить или посчитать свободной.
                "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now(), "
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
    """Генерирует следующий штрихкод хранения вида GW-000001 (по максимальному текущему)."""
    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE storage_barcode LIKE 'GW-%'")
    max_seq = 0
    for (bc,) in cur.fetchall():
        suffix = bc.split('-', 1)[1] if '-' in bc else ''
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return f"GW-{max_seq + 1:06d}"


def handler(event: dict, context) -> dict:
    """Склад готового товара: изделия, сшитые и упакованные (статус заказа "Готовые"),
    попадают на склад товара на конкретную полку под уникальным штрихкодом хранения
    (storage_barcode), откуда далее уходят в поставку на маркетплейс.

    Статусы (status):
      - awaiting_shelf — отстикерован, ждёт, пока кладовщик отсканирует его на полку
      - in_stock  — на хранении (лежит на полке, ничего с ним не происходит)
      - picking   — на сборке (кладовщик отобрал его как нужный для будущей поставки FBS,
                     ещё не привязан к конкретной поставке)
      - reserved  — зарезервирован в конкретной поставке (marketplace_supply_items)
      - shipped   — отгружен на маркетплейс
      - lost      — утерян (с указанием причины), выбывает из активных статусов

    GET  /                          - список товаров (можно ?status=in_stock и т.д.)
        доп. фильтры: ?material=Вуаль, ?width=200, ?height=250, ?shelf_id=1
    GET  /?barcode=GW-000001         - найти товар по штрихкоду хранения (для сканера подбора
                                        и сканирования в поставку)
    POST /  { action: 'admin_receive', marketplaceItemId, shelfId? }
        - ручной приём администратором: вещь без заказа с маркетплейса (излишек производства,
          найденный товар). Под неё создаётся служебный заказ WH-00001 и запись склада с
          receive_reason='admin' — в списке видно, что товар принял админ вручную
    POST /  { action: 'place_on_shelf', barcode, shelfId }
        - кладовщик у себя на компьютере сканирует стикер хранения вещи, отменённой клиентом
          (статус awaiting_shelf), и кладёт её на конкретную полку → in_stock
    GET  /?pending_shelf=1
        - список отменённых вещей, отстикерованных упаковщиком, но ещё не положенных на полку
          (виджет на дашборде кладовщика)
    POST /  { action: 'receive_return', orderNumber }
        - приём возврата с маркетплейса по номеру заказа (ручной ввод, до появления API).
          Полка НЕ выбирается: вещь встаёт в статус awaiting_shelf и попадает на полку только
          сканированием стикера хранения (place_on_shelf) — так товар не окажется «не на месте».
          Если заказ уже был на складе, старый storage_barcode сохраняется
    POST /  { action: 'move_shelf_by_barcode', barcode, shelfId }
        - то же самое, но по штрихкоду хранения (для диалога "Смена полки" со сканером)
    POST /  { action: 'return_to_workshop', id }
        - возвращает товар в цех (например, брак при выходном контроле), статус заказа
          сбрасывается на "В работе", запись удаляется со склада
    POST /  { action: 'start_picking', barcode }
        - сканер подбора: находит товар по storage_barcode (должен быть in_stock),
          переводит в статус picking — отмечает "то, что нужно для будущей поставки FBS"
    POST /  { action: 'cancel_picking', id }
        - отмена подбора: возвращает товар из picking обратно в in_stock
    POST /  { action: 'mark_lost', id, reason }
        - отмечает товар утерянным (с любого активного статуса, кроме shipped/lost)

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над складом товара
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
        status = params.get('status')
        barcode = params.get('barcode')
        material = params.get('material')
        width = params.get('width')
        height = params.get('height')
        shelf_id_filter = params.get('shelf_id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Счётчик для кладовщика: сколько вещей на полках уже подобрано под заказы и
            # ждёт, чтобы он наклеил стикер отправления. По нему в меню горит значок.
            if params.get('pending_count'):
                # Этот счётчик висит в меню у каждого кладовщика весь день — самый
                # частый запрос во всей системе. Считаем оба числа ОДНИМ проходом по
                # таблице вместо двух запросов подряд: результат тот же, работы вдвое
                # меньше.
                #
                # Во втором числе — вся работа «на руках»: и отказы из цеха, ждущие
                # полки, и возвраты с маркетплейса, ждущие разбора. Значок в меню
                # показывает общий объём задач; куда именно идти, кладовщик видит
                # на самой странице склада — там это две разные плитки.
                #
                # Третьим числом отдаём ТОЛЬКО отказы из цеха (awaiting_shelf), без
                # возвратов с маркетплейса. По нему звучит сигнал «отменённый заказ
                # из цеха»: вещь уже застикерована складским стикером и лежит у
                # кладовщика на руках, её нужно унести на полку. Возвраты приезжают
                # своим потоком и звучать не должны — иначе сигнал теряет смысл.
                # Отказы из цеха считаем ТОЛЬКО застикерованные (storage_labeled_at).
                #
                # Раньше вещь попадала в счётчик в момент закрытия заказа на терминале —
                # до того, как упаковщица напечатала стикер. Кладовщик видел «6 штук»,
                # шёл в цех, а вещей там не было: печать могла не сработать, и вещь ещё
                # лежала у упаковщицы. Возвраты с маркетплейса (mp_return) приезжают
                # своим потоком, стикер на них уже есть — их условие не касается.
                cur.execute(
                    "SELECT "
                    " count(*) FILTER (WHERE status = 'mp_return' "
                    "                  OR (status = 'awaiting_shelf' AND storage_labeled_at IS NOT NULL)), "
                    " count(*) FILTER (WHERE status = 'awaiting_shelf' AND storage_labeled_at IS NOT NULL) "
                    "FROM goods_warehouse "
                    "WHERE status IN ('awaiting_shelf', 'mp_return')"
                )
                row = cur.fetchone()
                awaiting, from_workshop = int(row[0]), int(row[1])

                # Подбор считаем ТЕМ ЖЕ запросом, что и список на странице, иначе
                # цифры расходятся. Раньше счётчик брал только вещи БЕЗ стикера и
                # показывал «2», хотя в списке лежало 8 позиций: отстикерованные, но
                # не отправленные на поставку, он не видел — а работа по ним не
                # закончена.
                #
                # Заодно разбиваем по схеме: FBS собирают поштучно с ярлыком на
                # каждую вещь, FBO складывают коробкой на склад площадки. Это разная
                # работа, и кладовщик планирует день по двум числам, а не по одному.
                cur.execute(
                    "SELECT upper(coalesce(o.order_type, '')), count(*) "
                    "FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.reserved_order_id "
                    # Те же статусы, что и в списке подбора: вещь с напечатанным ярлыком,
                    # но ещё не уложенная в короб, остаётся работой кладовщика.
                    "WHERE gw.status IN ('picking', 'awaiting_supply') "
                    "  AND gw.reserved_order_id IS NOT NULL "
                    "  AND gw.shipped_at IS NULL "
                    "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                    "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                    "                  WHERE msi.goods_warehouse_id = gw.id "
                    "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                    f"  AND {RESERVE_ALIVE_SQL.replace('ro.', 'o.')} "
                    "GROUP BY 1"
                )
                by_scheme = {r[0]: int(r[1]) for r in cur.fetchall()}
                pending_fbo = by_scheme.get('FBO', 0)
                pending_fbs = by_scheme.get('FBS', 0)
                pending = sum(by_scheme.values())
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'pendingLabel': pending,
                        # Раздельно по схемам поставки — работа у них разная.
                        'pendingFbo': pending_fbo,
                        'pendingFbs': pending_fbs,
                        'awaitingShelf': awaiting,
                        # Отказы из цеха, ждущие полки — только они дают звуковой сигнал.
                        'cancelledFromWorkshop': from_workshop,
                    }),
                }

            # Заказы, пришедшие на подбор: их ещё не начали шить и под них не нашли
            # готовую вещь на складе. Кладовщик смотрит список и решает, что можно
            # закрыть остатками, а что уйдёт в цех.
            # Воронка осмотра возвратов: шесть счётчиков + список выбранного этапа.
            # Кладовщик видит, сколько вещей застряло на каждом шаге, и не теряет их
            # «где-то между цехом и складом».
            # Уведомления для панели администратора.
            if params.get('notifications'):
                cur.execute(
                    "SELECT id, kind, title, message, actor_name, link, created_at, is_read "
                    "FROM admin_notifications WHERE hidden_at IS NULL "
                    "ORDER BY created_at DESC LIMIT 100"
                )
                rows = cur.fetchall()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'items': [
                            {
                                'id': r[0],
                                'kind': r[1],
                                'title': r[2],
                                'message': r[3],
                                'actorName': r[4],
                                'link': r[5],
                                'createdAt': (r[6].isoformat() + 'Z') if r[6] else None,
                                'isRead': r[7],
                            }
                            for r in rows
                        ],
                        'unread': sum(1 for r in rows if not r[7]),
                    }, ensure_ascii=False),
                }

            if params.get('inspection'):
                stage = (params.get('stage') or '').strip()

                cur.execute(
                    "SELECT "
                    # Приехало с ПВЗ и лежит у кладовщика неразобранным: он ещё не решил,
                    # положить вещь на полку или отдать упаковщицам на осмотр.
                    "  COUNT(*) FILTER (WHERE status = 'mp_return'), "
                    "  COUNT(*) FILTER (WHERE status = 'checking'), "
                    "  COUNT(*) FILTER (WHERE status = 'repacking'), "
                    # «Осмотрено» и «Забрано с производства» слиты в один этап: для
                    # кладовщика это одна и та же работа — положить вещь на полку.
                    "  COUNT(*) FILTER (WHERE status IN ('inspected', 'taken')), "
                    "  COUNT(*) FILTER (WHERE status = 'taken'), "
                    "  COUNT(*) FILTER (WHERE status = 'to_dispose'), "
                    "  COUNT(*) FILTER (WHERE status = 'lost' AND disposed_at IS NOT NULL) "
                    "FROM goods_warehouse"
                )
                c = cur.fetchone()
                counts = {
                    'fromMarketplace': c[0],
                    'fromReturn': c[1],
                    'atPackers': c[2],
                    'inspected': c[3],
                    'taken': c[4],
                    'toDispose': c[5],
                    'disposed': c[6],
                }

                items = []
                stage_status = {
                    'fromMarketplace': 'mp_return',
                    'fromReturn': 'checking',
                    'atPackers': 'repacking',
                    'taken': 'taken',
                    'toDispose': 'to_dispose',
                }.get(stage)
                if stage == 'inspected':
                    # Один список: и осмотренные упаковщицей, и уже забранные из цеха —
                    # кладовщик кладёт на полку и те, и другие.
                    where_stage = "gw.status IN ('inspected', 'taken')"
                elif stage == 'disposed':
                    where_stage = "gw.status = 'lost' AND gw.disposed_at IS NOT NULL"
                elif stage == 'readyShelf':
                    # Всё, что кладовщик может прямо сейчас разложить по полкам: осмотренные
                    # упаковщицей и уже забранные им из цеха. Список нужен окну приёмки, чтобы
                    # проверять сканы в браузере и не дёргать сервер на каждый штрихкод.
                    where_stage = "gw.status IN ('inspected', 'taken')"
                elif stage_status:
                    where_stage = f"gw.status = '{stage_status}'"
                else:
                    where_stage = None

                if where_stage:
                    cur.execute(
                        "SELECT gw.id, gw.storage_barcode, gw.status, gw.received_at, "
                        "       gw.inspected_at, gw.taken_at, gw.dispose_reason, gw.lost_reason, "
                        "       o.order_number, o.product, o.material, o.width, o.height, "
                        "       o.marketplace, ins.full_name, tk.full_name, "
                        # Стикер возврата маркетплейса — то, что физически наклеено на
                        # пакете с ПВЗ. Кладовщик ищет вещь именно по нему: стикера
                        # хранения на возврате ещё нет, а название товара длинное и
                        # набирать его руками дольше, чем пикнуть код.
                        "       mr.return_barcode, mr.product_name "
                        "FROM goods_warehouse gw "
                        "LEFT JOIN orders o ON o.id = gw.order_id "
                        "LEFT JOIN marketplace_returns mr ON mr.goods_warehouse_id = gw.id "
                        "LEFT JOIN users ins ON ins.id = gw.inspected_by "
                        "LEFT JOIN users tk ON tk.id = gw.taken_by "
                        f"WHERE {where_stage} "
                        "ORDER BY gw.received_at ASC LIMIT 300"
                    )
                    items = [
                        {
                            'id': r[0],
                            'storageBarcode': r[1],
                            'status': r[2],
                            'receivedAt': (r[3].isoformat() + 'Z') if r[3] else None,
                            'inspectedAt': (r[4].isoformat() + 'Z') if r[4] else None,
                            'takenAt': (r[5].isoformat() + 'Z') if r[5] else None,
                            'disposeReason': r[6],
                            'lostReason': r[7],
                            'orderNumber': r[8],
                            'product': r[9],
                            'material': r[10],
                            'width': r[11],
                            'height': r[12],
                            'marketplace': r[13],
                            'inspectedByName': r[14],
                            'takenByName': r[15],
                            'returnBarcode': r[16],
                            'returnProductName': r[17],
                        }
                        for r in cur.fetchall()
                    ]

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'counts': counts, 'items': items}, ensure_ascii=False),
                }

            if params.get('picking_orders'):
                # Реальная работа на сегодня: вещи, которые система уже подобрала под
                # заказы и которые лежат на полке в ожидании стикера отправления.
                # Кладовщик идёт с этим списком к стеллажу и собирает их.
                #
                # Просто «новые заказы» тут показывать нельзя: их сотни, но закрыть
                # складом можно лишь те, под которые реально лежит нужная вещь.
                cur.execute(
                    "SELECT gw.id, o.order_number, o.product, o.material, o.width, o.height, "
                    "       gw.matched_at, o.marketplace, gw.storage_barcode, sh.name, "
                    "       gw.shipping_labeled_at, gw.status, "
                    # Схема поставки и кластер: по ним кладовщик сразу видит, куда поедет
                    # вещь. FBS клеится ярлык маркетплейса и едет отдельным пакетом,
                    # FBO уходит коробкой на склад площадки — работа разная.
                    "       o.order_type, o.cluster "
                    "FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.reserved_order_id "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    # Вещь остаётся в подборе, пока её физически не положили в короб.
                    #
                    # 'picking'         — отобрана под заказ, лежит на полке;
                    # 'awaiting_supply' — ярлык напечатан и нажато «На поставку», но в
                    #                     короб вещь ещё не отсканирована.
                    #
                    # Второй статус раньше из списка выпадал, и это был тупик: кладовщик
                    # открыл карточку, не держа вещь в руках, случайно напечатал стикер и
                    # отправил на поставку — строка тут же исчезла из подбора. Вещь лежит
                    # на полке среди сотен других, номера её полки на экране больше нет,
                    # и найти её без сканера почти невозможно.
                    #
                    # Пока вещь не в коробе — работа не закончена, и строка нужна.
                    # Из списка она уходит при сканировании в поставку (статус reserved).
                    "WHERE gw.status IN ('picking', 'awaiting_supply') "
                    "  AND gw.reserved_order_id IS NOT NULL "
                    "  AND gw.shipped_at IS NULL "
                    # Вещь уже лежит в живой поставке — она в коробе, искать её не надо.
                    # Завершённые поставки не считаем: вещь могла вернуться и снова уйти
                    # в подбор под новый заказ.
                    "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                    "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                    "                  WHERE msi.goods_warehouse_id = gw.id "
                    "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                    # Отправление уже уехало от нас или отменено — ярлык для него OZON
                    # больше не отдаёт, собрать такую вещь невозможно. Раньше она висела
                    # в подборе вечно: кладовщик шёл к стеллажу, а на печати получал
                    # «OZON готовит этикетку, нажмите ещё раз» — и так по кругу.
                    # Бронь должна быть живой: заказ не отменён, не отгружен, не уехал
                    # к покупателю и не ушёл на конвейер. Условие общее со сканером и
                    # со сменой полки — иначе экраны опять разойдутся между собой.
                    f"  AND {RESERVE_ALIVE_SQL.replace('ro.', 'o.')} "
                    "ORDER BY gw.matched_at ASC NULLS LAST, gw.id ASC"
                )
                orders_rows = cur.fetchall()

                # Сколько ТАКИХ ЖЕ вещей свободно лежит на складе и на каких полках.
                #
                # Кладовщик подходит к стеллажу за конкретной вещью, а её там нет:
                # ошиблись при инвентаризации, вещь переложили, забрали и не отметили.
                # Раньше на этом работа вставала — он не знал, есть ли на складе такая
                # же вещь и где её искать, и заказ уходил в цех шиться заново.
                #
                # Теперь рядом с каждой строкой показываем свободные остатки того же
                # товара по полкам: «Лен 300x265 — ещё 2 шт: Нижняя (1), Средняя (1)».
                cur.execute(
                    "SELECT src.product, sh.name, count(*) "
                    "FROM goods_warehouse gw "
                    "JOIN orders src ON src.id = gw.order_id "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    "WHERE gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
                    "  AND src.product IS NOT NULL "
                    "GROUP BY src.product, sh.name "
                    "ORDER BY count(*) DESC"
                )
                stock_by_product = {}
                for prod, shelf_name, cnt in cur.fetchall():
                    stock_by_product.setdefault(prod, []).append({
                        'shelfName': shelf_name or 'Полка не указана',
                        'count': int(cnt),
                    })

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps([
                        {
                            'id': r[0],
                            'orderNumber': r[1],
                            'product': r[2],
                            'material': r[3],
                            'width': r[4],
                            'height': r[5],
                            'createdAt': (r[6].isoformat() + 'Z') if r[6] else None,
                            'marketplace': r[7],
                            'storageBarcode': r[8],
                            'shelfName': r[9],
                            # Ярлык уже наклеен, а вещь ещё не отправлена: в списке она
                            # подсвечивается как «осталось отправить на поставку».
                            'shippingLabeledAt': (r[10].isoformat() + 'Z') if r[10] else None,
                            # Состояние работы по вещи: 'picking' — лежит на полке и
                            # ждёт стикера; 'awaiting_supply' — стикер наклеен, осталось
                            # отсканировать её в короб поставки.
                            'status': r[11],
                            'orderType': r[12],
                            'cluster': r[13],
                            # Свободные такие же вещи на складе — запасной вариант,
                            # если по своей полке вещи не оказалось.
                            'alsoOnShelves': stock_by_product.get(r[2], []),
                        }
                        for r in orders_rows
                    ], ensure_ascii=False),
                }

            # Карточка одной вещи: что это, где лежит, под какой заказ и вся история
            # её движения — кто принял, кто наклеил стикер, кто отправил.
            if params.get('card_id'):
                card_id = int(params['card_id'])
                cur.execute(
                    "SELECT gw.id, gw.status, gw.storage_barcode, gw.receive_reason, "
                    "       gw.received_at, gw.shipped_at, gw.shipping_labeled_at, gw.matched_at, "
                    "       sh.name, "
                    "       src.order_number, src.product, src.material, src.width, src.height, "
                    "       src.marketplace, "
                    "       res.id, res.order_number, res.marketplace, res.order_type, "
                    "       gw.lost_reason "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    "LEFT JOIN orders src ON src.id = gw.order_id "
                    "LEFT JOIN orders res ON res.id = gw.reserved_order_id "
                    "WHERE gw.id = %s",
                    (card_id,),
                )
                r = cur.fetchone()
                if not r:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}

                # Лежит ли вещь в АКТИВНОЙ поставке? Тогда кнопку «Отправить на поставку»
                # показывать не надо — она уже едет.
                #
                # Завершённые поставки в расчёт не берём: вещь могла вернуться к нам
                # (возврат, отказ покупателя) и снова попасть в подбор под новый заказ.
                # Из-за старой записи кладовщик видел «Вещь на поставке» и не мог
                # напечатать стикер на вещь, которая прямо сейчас лежит у него в подборе.
                cur.execute(
                    "SELECT s.id, s.status FROM marketplace_supply_items msi "
                    "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                    "WHERE msi.goods_warehouse_id = %s "
                    "  AND COALESCE(s.status, '') NOT IN ('Выполнена', 'Отменена') "
                    "ORDER BY msi.id DESC LIMIT 1",
                    (card_id,),
                )
                sup = cur.fetchone()

                # История: события и по самой вещи, и по заказам, с которыми она связана.
                # Так видно всю цепочку — от пошива до наклейки стикера.
                order_ids = [x for x in (r[15],) if x]
                cur.execute("SELECT order_id FROM goods_warehouse WHERE id = %s", (card_id,))
                own = cur.fetchone()
                if own and own[0]:
                    order_ids.append(own[0])
                ids_csv = ','.join(str(int(i)) for i in set(order_ids)) or '0'
                cur.execute(
                    "SELECT user_name, action, description, created_at FROM audit_log "
                    f"WHERE (entity_type = 'goods_warehouse' AND entity_id = {card_id}) "
                    f"   OR (entity_type = 'order' AND entity_id IN ({ids_csv})) "
                    "ORDER BY created_at DESC LIMIT 100"
                )
                history = [
                    {
                        'userName': h[0],
                        'action': h[1],
                        'description': h[2],
                        'createdAt': (h[3].isoformat() + 'Z') if h[3] else None,
                    }
                    for h in cur.fetchall()
                ]

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': r[0],
                        'status': r[1],
                        'storageBarcode': r[2],
                        'receiveReason': r[3],
                        'receivedAt': (r[4].isoformat() + 'Z') if r[4] else None,
                        'shippedAt': (r[5].isoformat() + 'Z') if r[5] else None,
                        'shippingLabeledAt': (r[6].isoformat() + 'Z') if r[6] else None,
                        'matchedAt': (r[7].isoformat() + 'Z') if r[7] else None,
                        'shelfName': r[8],
                        'sourceOrderNumber': r[9],
                        'product': r[10],
                        'material': r[11],
                        'width': r[12],
                        'height': r[13],
                        'sourceMarketplace': r[14],
                        'reservedOrderId': r[15],
                        'reservedOrderNumber': r[16],
                        'reservedMarketplace': r[17],
                        'reservedOrderType': r[18],
                        'lostReason': r[19],
                        'supplyId': sup[0] if sup else None,
                        'supplyStatus': sup[1] if sup else None,
                        'history': history,
                    }, ensure_ascii=False),
                }

            if barcode:
                barcode_esc = barcode.strip().replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.order_id, o.order_number, o.product, o.material, o.width, o.height, "
                    "gw.shelf_id, s.name, gw.status, gw.received_at, gw.shipped_at, gw.storage_barcode, "
                    "gw.lost_reason, gw.lost_at, gw.receive_reason, gw.shipping_labeled_at, "
                    # Резерв нужен сканеру подбора: по нему он отличает вещь, которую
                    # надо забрать в контейнер, от неликвида, просто лежащего на складе.
                    "gw.reserved_order_id, ro.order_number, "
                    # Вещь недоступна для подбора, если её заказ:
                    #   * забрали в цех (кроят или шьют) — отправление закроет то, что
                    #     выйдет с конвейера, а эта вещь остаётся на складе;
                    #   * отменён или уже уехал к покупателю — ярлык маркетплейс не отдаст.
                    # Условие один в один повторяет фильтр списка подбора, чтобы сканер
                    # и экран кладовщика никогда не расходились.
                    f"NOT {RESERVE_ALIVE_SQL} "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                    "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                    f"WHERE gw.storage_barcode = '{barcode_esc}'"
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар со штрихкодом {barcode} не найден'})}
                item = {
                    'id': row[0], 'orderId': row[1], 'orderNumber': row[2], 'product': row[3],
                    'material': row[4], 'width': row[5], 'height': row[6], 'shelfId': row[7],
                    'shelfName': row[8], 'status': row[9], 'receivedAt': row[10].isoformat() + 'Z',
                    'shippedAt': (row[11].isoformat() + 'Z') if row[11] else None, 'storageBarcode': row[12],
                    'lostReason': row[13], 'lostAt': (row[14].isoformat() + 'Z') if row[14] else None,
                    'receiveReason': row[15] or 'manual',
                    # Стикер отправления уже наклеен — вещь собрана, в подбор не идёт.
                    'shippingLabeledAt': (row[16].isoformat() + 'Z') if row[16] else None,
                    'reservedOrderId': row[17],
                    'reservedOrderNumber': row[18],
                    'orderInProduction': bool(row[19]) if row[17] else False,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'item': item})}

            conditions = []
            if status:
                status_esc = status.replace("'", "''")
                conditions.append(f"gw.status = '{status_esc}'")
                # Возвраты с маркетплейса: показываем только СВЕЖИЕ (за сегодня и вчера).
                #
                # Кладовщик открывает этот фильтр, чтобы разобрать привезённое сегодня,
                # а не изучать историю за всё время. Без ограничения сюда падали сотни
                # старых записей, среди которых сегодняшние 25 коробок терялись.
                # Захочет посмотреть старое — найдёт поиском по номеру или стикеру.
                if status == 'mp_return':
                    conditions.append("gw.received_at >= CURRENT_DATE - interval '1 day'")
            if material:
                material_esc = material.replace("'", "''")
                conditions.append(f"o.material = '{material_esc}'")
            if width:
                conditions.append(f"o.width = {int(width)}")
            if height:
                conditions.append(f"o.height = {int(height)}")
            if shelf_id_filter:
                conditions.append(f"gw.shelf_id = {int(shelf_id_filter)}")
            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"SELECT gw.id, gw.order_id, o.order_number, o.product, o.material, o.width, o.height, "
                f"gw.shelf_id, s.name, gw.status, gw.received_at, gw.shipped_at, gw.storage_barcode, "
                f"gw.lost_reason, gw.lost_at, gw.receive_reason, gw.reserved_order_id, ro.order_number, "
                f"gw.shipping_labeled_at, "
                # Куда вещь поедет: площадка и схема берутся у ЗАКРЕПЛЁННОГО заказа
                # (reserved), а если его нет — у заказа, в котором вещь сшили. Без этого
                # счётчик «Готово к сборке» показывал в каждой поставке весь склад разом:
                # вещи для OZON FBS считались готовыми и для поставки WB.
                f"COALESCE(ro.marketplace, o.marketplace), "
                f"COALESCE(ro.order_type, o.order_type), "
                f"COALESCE(ro.cluster, o.cluster), "
                # Кто списал вещь и отправил её в пошив. Админ во вкладке «Утерян»
                # должен видеть не только факт, но и ответственного: за списанием
                # стоят потраченная ткань и повторная работа цеха.
                f"(SELECT a.user_name FROM audit_log a "
                f" WHERE a.entity_type = 'goods_warehouse' AND a.entity_id = gw.id "
                f"   AND a.action IN ('send_to_sewing', 'mark_lost') "
                f" ORDER BY a.created_at DESC LIMIT 1), "
                # Вещь, уже лежащая в АКТИВНОЙ поставке, второй раз никуда не поедет.
                # Без этого она считалась «готовой к сборке» и в новой поставке тоже.
                # Завершённые поставки не учитываем: вещь могла вернуться к нам и снова
                # уйти в подбор — старая запись не должна её блокировать.
                f"(SELECT msi.supply_id FROM marketplace_supply_items msi "
                f" JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                f" WHERE msi.goods_warehouse_id = gw.id "
                f"   AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена') "
                f" ORDER BY msi.id DESC LIMIT 1), "
                # Заказ, под который вещь закреплена, уже забрали в цех: его кроят или
                # шьют. Стикер отправления на такую вещь не напечатать — отправление
                # закроет то, что выйдет с конвейера. Для склада вещь недоступна.
                f"COALESCE(ro.sewing_status, '') NOT IN ('Новый', 'Со склада'), "
                # Стикер хранения напечатан упаковщицей. Пока пусто — вещь ещё у неё
                # на руках, идти за ней в цех рано.
                f"gw.storage_labeled_at "
                f"FROM goods_warehouse gw "
                f"LEFT JOIN orders o ON o.id = gw.order_id "
                f"LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                f"LEFT JOIN shelves s ON s.id = gw.shelf_id "
                f"{where_clause} "
                f"ORDER BY gw.received_at DESC, gw.id DESC"
            )
            items = [
                {
                    'id': r[0],
                    'orderId': r[1],
                    'orderNumber': r[2],
                    'product': r[3],
                    'material': r[4],
                    'width': r[5],
                    'height': r[6],
                    'shelfId': r[7],
                    'shelfName': r[8],
                    'status': r[9],
                    'receivedAt': r[10].isoformat() + 'Z',
                    'shippedAt': (r[11].isoformat() + 'Z') if r[11] else None,
                    'storageBarcode': r[12],
                    'lostReason': r[13],
                    'lostAt': (r[14].isoformat() + 'Z') if r[14] else None,
                    'receiveReason': r[15] or 'manual',
                    'reservedOrderId': r[16],
                    'reservedOrderNumber': r[17],
                    'shippingLabeledAt': (r[18].isoformat() + 'Z') if r[18] else None,
                    # Назначение вещи: в какую поставку она должна попасть.
                    'marketplace': r[19],
                    'orderType': r[20],
                    'cluster': r[21],
                    'lostByName': r[22],
                    'supplyId': r[23],
                    # true — заказ ушёл на конвейер, вещь для подбора недоступна.
                    'orderInProduction': r[24],
                    # Стикер хранения напечатан — вещь готова к забору кладовщиком.
                    'storageLabeledAt': (r[25].isoformat() + 'Z') if r[25] else None,
                }
                for r in cur.fetchall()
            ]

            # Выбрасываем пустые поля: у вещи 23 поля, но у большинства половина пустая
            # (кластер, причина утери, привязанный заказ, полка у ещё не разложенных).
            # На 1176 вещах это сотни лишних килобайт, которые едут на планшет в цех
            # по мобильному интернету. Интерфейс везде проверяет значение на пустоту,
            # поэтому отсутствующее поле читается так же, как пустое.
            items = [
                {k: v for k, v in it.items() if v is not None and v != ''}
                for it in items
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'items': items})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'admin_receive':
                # Ручной приём администратором или кладовщиком: он находит товар в справочнике
                # по названию («Вуаль 300x250») и кладёт вещи на склад без заказа с маркетплейса —
                # например, излишек с производства или найденный на складе товар. Под каждую вещь
                # создаётся служебный заказ (source='manual'), а запись помечается
                # receive_reason='admin', чтобы в списке было видно: это принято вручную.
                #
                # Приём идёт ПАРТИЕЙ (quantity): раньше фронт слал отдельный запрос на каждую
                # штуку, и параллельные запросы разбирали один и тот же служебный номер заказа —
                # часть вещей падала на конфликте, и на складе оказывалось меньше вещей, чем
                # напечатано стикеров. Теперь вся партия заводится одним запросом в одной
                # транзакции: сколько стикеров — столько вещей.
                item_id = body_data.get('marketplaceItemId')
                shelf_id = body_data.get('shelfId')
                try:
                    quantity = int(body_data.get('quantity') or 1)
                except (TypeError, ValueError):
                    quantity = 1
                quantity = max(1, min(200, quantity))
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите товар'})}

                cur.execute(
                    "SELECT name, material, width, height, barcode, ozon_sku FROM marketplace_items WHERE id = %s",
                    (int(item_id),),
                )
                item_row = cur.fetchone()
                if not item_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}
                item_name, item_material, item_width, item_height, item_barcode, item_ozon_sku = item_row
                product = (
                    f"{item_material} {item_width}x{item_height}"
                    if item_material and item_width and item_height
                    else item_name
                )

                # Служебный номер заказа для складской вещи без заказа маркетплейса: WH-00001.
                cur.execute(
                    "SELECT order_number FROM orders WHERE order_number ~ '^WH-[0-9]+$' "
                    "ORDER BY (split_part(order_number, '-', 2))::int DESC LIMIT 1"
                )
                last_row = cur.fetchone()
                next_seq = (int(last_row[0].split('-')[1]) + 1) if last_row else 1

                # Полку можно указать сразу (вещь принимают осознанно), а если не указали —
                # вещь встанет в очередь «Ждёт полку» и ляжет на полку по скану.
                status_val = 'in_stock' if shelf_id not in (None, '') else 'awaiting_shelf'
                shelf_val = int(shelf_id) if shelf_id not in (None, '') else None

                created = []
                for n in range(quantity):
                    order_number = f"WH-{next_seq + n:05d}"
                    cur.execute(
                        "INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, "
                        "source, material, width, height, marketplace_item_id, product_barcode, product_ozon_sku, "
                        "sewing_status) "
                        "VALUES (%s, 'OZON', 'FBS', 'Новый', %s, 1, 'manual', %s, %s, %s, %s, %s, %s, 'Готовые') "
                        "RETURNING id",
                        (
                            order_number, product, item_material,
                            int(item_width) if item_width else None,
                            int(item_height) if item_height else None,
                            int(item_id), item_barcode or None, item_ozon_sku or None,
                        ),
                    )
                    new_order_id = cur.fetchone()[0]

                    storage_barcode = next_storage_barcode(cur)
                    cur.execute(
                        "INSERT INTO goods_warehouse (order_id, shelf_id, status, storage_barcode, receive_reason) "
                        "VALUES (%s, %s, %s, %s, 'admin') RETURNING id",
                        (new_order_id, shelf_val, status_val, storage_barcode),
                    )
                    new_gw_id = cur.fetchone()[0]
                    log_action(
                        cur, actor_id, actor_name, 'admin_receive', 'goods_warehouse', new_gw_id,
                        f'Принял товар вручную: {product} ({storage_barcode})',
                    )
                    created.append({
                        'id': new_gw_id,
                        'orderNumber': order_number,
                        'product': product,
                        'storageBarcode': storage_barcode,
                        'status': status_val,
                    })

                # Вещи уже на полке — вдруг их ждёт незапущенный заказ. Подбор делаем после
                # того, как заведена вся партия: иначе первая же вещь ушла бы в резерв,
                # а остальные считались бы отдельно и матчинг сработал бы вразнобой.
                if status_val == 'in_stock':
                    for row in created:
                        try_match_orders_from_stock(cur, gw_id=row['id'])

                    # Часть вещей подбор мог тут же забрать под ожидающие заказы — они
                    # уже «На сборке», а не «На хранении». Возвращаем РЕАЛЬНЫЙ статус
                    # каждой вещи: иначе принявший видит «принято 12», открывает склад
                    # с фильтром «На хранении», находит там 8 и считает, что приёмка
                    # сработала наполовину.
                    ids_csv = ','.join(str(int(r['id'])) for r in created)
                    cur.execute(
                        f"SELECT id, status FROM goods_warehouse WHERE id IN ({ids_csv})"
                    )
                    real_status = {int(r[0]): r[1] for r in cur.fetchall()}
                    for row in created:
                        row['status'] = real_status.get(row['id'], row['status'])

                conn.commit()
                first = created[0]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        # Одиночные поля — для совместимости со старым вызовом на одну вещь.
                        'id': first['id'],
                        'orderNumber': first['orderNumber'],
                        'product': product,
                        'storageBarcode': first['storageBarcode'],
                        'status': status_val,
                        'created': created,
                        'count': len(created),
                    }, ensure_ascii=False),
                }

            if action == 'find_item_by_code':
                # Поиск товара по отсканированному FBO-стикеру.
                #
                # Сложность в том, что стикеры печатаются по-разному, и в одном и том же
                # штрихкоде может лежать что угодно: код с префиксом (OZN1579985267),
                # тот же код без префикса (1579985267), артикул продавца или SKU WB /
                # Яндекса. Кладовщик не должен в этом разбираться — сверяем со всеми
                # колонками справочника сразу, а префикс OZN приписываем и отбрасываем
                # сами. Именно из-за него скан не срабатывал: в баркоде стикера префикса
                # нет, а в справочнике он есть.
                raw = (body_data.get('code') or '').strip()
                if not raw:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Пустой код'})}

                # Сканер иногда добавляет невидимые символы и ведущие нули — чистим.
                code = raw.strip().strip('\r\n\t ').upper()
                bare = code[3:] if code.startswith('OZN') else code
                variants = {code, bare, f'OZN{bare}', bare.lstrip('0')}
                variants = {v for v in variants if v}
                vals = ', '.join(
                    "'" + v.replace("'", "''") + "'" for v in variants
                )
                cur.execute(
                    "SELECT id, name, material, width, height, barcode, sku, ozon_sku, wb_sku, ym_sku "
                    "FROM marketplace_items WHERE "
                    f"upper(trim(coalesce(barcode, ''))) IN ({vals}) "
                    f"OR upper(trim(coalesce(sku, ''))) IN ({vals}) "
                    f"OR upper(trim(coalesce(ozon_sku, ''))) IN ({vals}) "
                    f"OR upper(trim(coalesce(wb_sku, ''))) IN ({vals}) "
                    f"OR upper(trim(coalesce(ym_sku, ''))) IN ({vals}) "
                    "LIMIT 1"
                )
                found_row = cur.fetchone()
                if not found_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'Товар по коду {raw} не найден в справочнике'},
                            ensure_ascii=False,
                        ),
                    }
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': found_row[0],
                        'name': found_row[1],
                        'material': found_row[2],
                        'width': found_row[3],
                        'height': found_row[4],
                    }, ensure_ascii=False),
                }

            if action == 'ship_label':
                # Кладовщик забрал с полки вещь, зарезервированную под новый заказ FBS,
                # наклеил на неё стикер отправления маркетплейса и сканирует стикер хранения
                # у себя на компьютере. После этого вещь готова к сканированию в поставку FBS.
                scan_barcode = (body_data.get('barcode') or '').strip()
                if not scan_barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте стикер хранения'})}

                bc_esc = scan_barcode.replace("'", "''")
                # Маркетплейс и тип заказа нужны, чтобы сразу напечатать стикер:
                # у WB он приходит картинкой, у OZON и Яндекса — файлом PDF.
                cur.execute(
                    "SELECT gw.id, gw.status, gw.reserved_order_id, ro.order_number, o.product, "
                    "s.name, ro.marketplace, ro.order_type "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                    "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                    f"WHERE gw.storage_barcode = '{bc_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Стикер {scan_barcode} не найден'})}
                (gw_id, gw_status, reserved_order_id, target_number, gw_product,
                 shelf_name, mp, order_type) = gw_row
                if not reserved_order_id:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Эта вещь не подобрана ни под один заказ — стикеровать её рано'}),
                    }
                if gw_status in ('shipped', 'lost'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Вещь уже уехала на маркетплейс (или числится утерянной) — '
                                     'стикер отправления ей больше не нужен.'
                        }, ensure_ascii=False),
                    }
                if gw_status not in ('in_stock', 'picking'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Вещь недоступна (статус: {gw_status})'}),
                    }

                # Заказ уже на конвейере: его кроят или шьют. Отправление закроет то,
                # что выйдет из цеха, — печатать стикер на складскую вещь нельзя, иначе
                # один и тот же заказ уедет дважды.
                cur.execute(
                    "SELECT sewing_status, fulfilled_from_stock_id FROM orders WHERE id = %s",
                    (int(reserved_order_id),),
                )
                sew_row = cur.fetchone()
                # Заказ считается закрытым складом, только если он сам указывает на ЭТУ
                # вещь. Статус «Новый» здесь недопустим: такой заказ стоит в очереди на
                # пошив, и цех сошьёт для него отдельный товар. Наклеив ярлык на складскую
                # вещь, мы получили бы два товара на одно отправление.
                if sew_row and (sew_row[0] != 'Со склада' or sew_row[1] != gw_id):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Заказ #{target_number} закрывается пошивом, а не этой '
                                     f'вещью. Стикеровать её нельзя — иначе на отправление '
                                     f'уедет два товара.'
                        }, ensure_ascii=False),
                    }
                if sew_row and sew_row[0] not in ('Новый', 'Со склада'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Заказ #{target_number} уже шьётся в цехе '
                                     f'(этап: {sew_row[0]}). Эта вещь остаётся на складе — '
                                     f'отправление закроет то, что выйдет с конвейера.'
                        }, ensure_ascii=False),
                    }

                # picking = отстикерована и готова к сканированию в поставку FBS.
                # Запоминаем и КТО наклеил ярлык: в поставке кладовщик видит имя рядом с
                # вещью, и при разборе «откуда взялась эта штука» есть кого спросить.
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'picking', shipping_labeled_at = now(), "
                    "shipping_labeled_by = %s, shipping_labeled_by_name = %s WHERE id = %s",
                    (actor_id, actor_name, int(gw_id)),
                )
                log_action(
                    cur, actor_id, actor_name, 'ship_label', 'goods_warehouse', gw_id,
                    f'Наклеил стикер отправления на заказ #{target_number} ({scan_barcode})',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': gw_id,
                        'orderId': reserved_order_id,
                        'orderNumber': target_number,
                        'product': gw_product,
                        'shelfName': shelf_name,
                        'storageBarcode': scan_barcode,
                        'marketplace': mp,
                        'orderType': order_type,
                    }, ensure_ascii=False),
                }

            if action == 'send_to_supply':
                # Вещь отстикерована ярлыком маркетплейса и готова ехать: переводим её
                # в «На поставку». После этого она появляется в счётчике поставки FBS
                # OZON, и кладовщик сканирует её в короб.
                gw_id = body_data.get('id')
                if not gw_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "SELECT gw.status, gw.shipping_labeled_at, o.order_number "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.reserved_order_id "
                    "WHERE gw.id = %s",
                    (int(gw_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}
                gw_status, labeled_at, target_number = row
                # Без ярлыка маркетплейса вещь на приёмке не опознают — не пускаем.
                if not labeled_at:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Сначала напечатайте стикер FBS и наклейте его на вещь'}, ensure_ascii=False),
                    }
                if gw_status == 'awaiting_supply':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Вещь уже отправлена на поставку'}, ensure_ascii=False),
                    }
                if gw_status not in ('in_stock', 'picking'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Вещь недоступна (статус: {gw_status})'}, ensure_ascii=False),
                    }
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'awaiting_supply' WHERE id = {int(gw_id)}"
                )
                log_action(
                    cur, actor_id, actor_name, 'send_to_supply', 'goods_warehouse', gw_id,
                    f'Отправил вещь на поставку по заказу #{target_number or "—"}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'place_on_shelf':
                # Кладовщик забрал из цеха вещь, отменённую клиентом (упаковщик уже наклеил
                # на неё стикер хранения), и сканирует её у себя на компьютере, укладывая на
                # конкретную полку. Работает только со сканера — вручную полки не путаем.
                scan_barcode = (body_data.get('barcode') or '').strip()
                shelf_id = body_data.get('shelfId')
                if not scan_barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте стикер хранения'})}
                if shelf_id in (None, ''):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите полку'})}

                bc_esc = scan_barcode.replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.status, o.order_number, o.product FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    f"WHERE gw.storage_barcode = '{bc_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': f'Стикер {scan_barcode} не найден — это не стикер хранения'}),
                    }
                gw_id, gw_status, gw_order_number, gw_product = gw_row
                if gw_status == 'in_stock':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар {gw_order_number or ""} уже лежит на полке'}),
                    }
                # taken — вещь, которую кладовщик забрал из цеха после осмотра: полку
                # он определяет здесь же, и на этом маршрут возврата заканчивается.
                #
                # mp_return сюда НЕ входит. Возврат от покупателя сначала проходит разбор
                # («Возвраты на осмотре»), где кладовщик решает: годная — на полку, мятая
                # или с дефектом — в цех на осмотр. Если разрешить укладку напрямую, это
                # решение подменяется сканированием, и бракованная вещь встаёт на полку
                # как годная — а потом уезжает покупателю.
                if gw_status not in ('awaiting_shelf', 'taken'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар {gw_order_number or ""} не ожидает укладки (статус: {gw_status})'}),
                    }

                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'in_stock', shelf_id = {int(shelf_id)}, "
                    f"received_at = now() WHERE id = {gw_id}"
                )
                cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                shelf_row = cur.fetchone()
                shelf_name = shelf_row[0] if shelf_row else None
                log_action(
                    cur, actor_id, actor_name, 'place_on_shelf', 'goods_warehouse', gw_id,
                    f'Положил на полку {shelf_name or shelf_id}: заказ #{gw_order_number} ({scan_barcode})',
                )
                # Вещь появилась на полке — сразу проверяем, не ждёт ли её какой-то заказ.
                # Если ждёт, заказ закрывается складом и не уходит в пошив.
                auto_matched = try_match_orders_from_stock(cur, gw_id=gw_id)
                if auto_matched:
                    log_action(
                        cur, actor_id, actor_name, 'auto_match', 'goods_warehouse', gw_id,
                        f'Вещь подобрана под заказ автоматически ({len(auto_matched)})',
                    )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': gw_id, 'orderNumber': gw_order_number,
                        'product': gw_product, 'shelfName': shelf_name,
                        'autoMatched': len(auto_matched),
                    }),
                }

            if action == 'place_inspected_batch':
                # Кладовщик забирает осмотренные возвраты с производства и раскладывает их
                # по полкам. Раскладка идёт «пачками»: выбрал полку, пикнул несколько вещей,
                # сменил полку, пикнул ещё — и один раз нажал «Положить на полки хранения».
                # Так вещи не путаются по местам, а сервер дёргается один раз вместо тридцати.
                groups = body_data.get('groups') or []
                if not groups:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте вещи'})}

                placed, errors = [], []
                for g in groups:
                    shelf_id = g.get('shelfId')
                    codes = g.get('barcodes') or []
                    if shelf_id in (None, '') or not codes:
                        continue
                    cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                    sh = cur.fetchone()
                    shelf_name = sh[0] if sh else str(shelf_id)

                    for code in codes:
                        bc = str(code).strip().replace("'", "''")
                        cur.execute(
                            "SELECT gw.id, gw.status, o.order_number, o.product "
                            "FROM goods_warehouse gw "
                            "LEFT JOIN orders o ON o.id = gw.order_id "
                            f"WHERE gw.storage_barcode = '{bc}'"
                        )
                        row = cur.fetchone()
                        if not row:
                            errors.append({'barcode': code, 'error': 'Стикер не найден'})
                            continue
                        gid, gstatus, gnum, gprod = row
                        # На полку кладём только реально осмотренное: 'inspected' —
                        # упаковщица закончила и наклеила стикер, 'taken' — кладовщик
                        # уже забрал вещь из цеха и держит в руках.
                        if gstatus not in ('inspected', 'taken'):
                            errors.append({
                                'barcode': code,
                                'error': f'{gnum or "Вещь"} не осмотрена (статус: {gstatus})',
                            })
                            continue
                        cur.execute(
                            f"UPDATE goods_warehouse SET status = 'in_stock', "
                            f"shelf_id = {int(shelf_id)}, taken_at = COALESCE(taken_at, now()), "
                            f"taken_by = COALESCE(taken_by, {int(actor_id) if actor_id else 'NULL'}), "
                            f"received_at = now() WHERE id = {gid}"
                        )
                        matched = try_match_orders_from_stock(cur, gw_id=gid)
                        placed.append({
                            'barcode': code,
                            'orderNumber': gnum,
                            'product': gprod,
                            'shelfName': shelf_name,
                            'autoMatched': len(matched),
                        })

                log_action(
                    cur, actor_id, actor_name, 'place_inspected_batch', 'goods_warehouse', None,
                    f'Разложил осмотренные возвраты по полкам: {len(placed)}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'placed': placed,
                        'errors': errors,
                        'total': len(placed),
                    }, ensure_ascii=False),
                }

            if action == 'scan_return':
                # Сканер возвратов: кладовщик пикает ярлык FBS на приехавшей вещи.
                # Возвращаем карточку товара с цепочкой исполнителей и причиной отказа,
                # либо объясняем, почему эту вещь принимать как возврат нельзя.
                scan = (body_data.get('barcode') or '').strip()
                if not scan:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте ярлык отправления'})}

                scan_esc = scan.replace("'", "''")
                cur.execute(
                    "SELECT id FROM orders WHERE order_number = %s OR ozon_posting_number = %s",
                    (scan, scan),
                )
                found = cur.fetchone()
                # Не нашли по номеру — возможно, отсканирован штрихкод с ярлыка OZON.
                if not found:
                    resolved = resolve_ozon_barcode(cur, scan)
                    if resolved:
                        cur.execute(
                            "SELECT id FROM orders WHERE order_number = %s OR ozon_posting_number = %s",
                            (resolved, resolved),
                        )
                        found = cur.fetchone()
                # Заказа с таким номером у нас нет — но возврат по нему мог приехать
                # с маркетплейса и лежать в списке возвратов. Вещь физически в руках у
                # кладовщика, разворачивать его нельзя.
                if not found:
                    cur.execute(
                        "SELECT order_id FROM marketplace_returns "
                        "WHERE posting_number = %s OR return_barcode = %s OR external_id = %s "
                        "ORDER BY id DESC LIMIT 1",
                        (scan, scan, scan),
                    )
                    ret_row = cur.fetchone()
                    if ret_row and ret_row[0]:
                        found = (ret_row[0],)
                    elif ret_row:
                        # Возврат приехал по заказу, которого у нас нет: он старше нашей
                        # системы или пришёл до подключения площадки. Вещь физически на
                        # руках у кладовщика — заводим заказ по данным возврата и
                        # принимаем её как обычно.
                        cur.execute(
                            "SELECT posting_number, product_name, marketplace, marketplace_item_id "
                            "FROM marketplace_returns "
                            "WHERE posting_number = %s OR return_barcode = %s OR external_id = %s "
                            "ORDER BY id DESC LIMIT 1",
                            (scan, scan, scan),
                        )
                        rp, rname, rmp, ritem = cur.fetchone()
                        cur.execute(
                            "INSERT INTO orders (order_number, ozon_posting_number, marketplace, "
                            "order_type, status, product, quantity, source, marketplace_item_id, "
                            "sewing_status) "
                            "VALUES (%s, %s, %s, 'FBS', 'Отменён', %s, 1, 'api', %s, 'Готовые') "
                            "RETURNING id",
                            (
                                rp or scan,
                                rp or scan,
                                rmp or 'OZON',
                                (rname or 'Возврат с маркетплейса')[:250],
                                int(ritem) if ritem else None,
                            ),
                        )
                        new_id = cur.fetchone()[0]
                        cur.execute(
                            "UPDATE marketplace_returns SET order_id = %s "
                            "WHERE posting_number = %s OR return_barcode = %s OR external_id = %s",
                            (new_id, scan, scan, scan),
                        )
                        conn.commit()
                        found = (new_id,)
                if not found:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': f'Отправление {scan} не найдено. Это ярлык FBS?'}, ensure_ascii=False),
                    }
                order_id = int(found[0])

                cur.execute(
                    "SELECT o.order_number, o.product, o.material, o.width, o.height, "
                    "       o.marketplace, o.ozon_status, o.status, o.created_at, o.cancelled_at, "
                    "       cu.full_name, su.full_name, pu.full_name, "
                    "       gw.id, gw.status "
                    "FROM orders o "
                    "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                    "LEFT JOIN users su ON su.id = o.sewer_user_id "
                    "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                    "LEFT JOIN goods_warehouse gw ON gw.order_id = o.id "
                    "WHERE o.id = %s",
                    (order_id,),
                )
                r = cur.fetchone()
                (order_number, product, material, width, height, marketplace,
                 ozon_status, order_status, created_at, cancelled_at,
                 cutter, sewer, packer, gw_id, gw_status) = r

                # Вещь ещё не у покупателя — принимать её как возврат нельзя.
                blocked = OZON_NOT_RETURNABLE.get((ozon_status or '').lower())
                if blocked:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Заказ {order_number} нельзя принять возвратом: он ещё '
                                     f'не был у покупателя (статус «{blocked}»)'
                        }, ensure_ascii=False),
                    }

                # Уже лежит на складе — второй раз тот же возврат не принимаем.
                if gw_id and gw_status in ('awaiting_shelf', 'checking', 'in_stock', 'mp_return'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Заказ {order_number} уже принят на склад'
                        }, ensure_ascii=False),
                    }

                # Причина возврата с маркетплейса: сначала смотрим таблицу возвратов.
                cur.execute(
                    "SELECT return_reason, mp_status FROM marketplace_returns "
                    "WHERE order_id = %s ORDER BY id DESC LIMIT 1",
                    (order_id,),
                )
                ret = cur.fetchone()
                raw_reason = (ret[0] if ret else None) or ''
                reason_text = OZON_CANCEL_REASONS.get(raw_reason.strip().lower(), raw_reason) or None

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'orderId': order_id,
                        'orderNumber': order_number,
                        'product': product,
                        'material': material,
                        'width': width,
                        'height': height,
                        'marketplace': marketplace,
                        'ozonStatus': ozon_status,
                        'orderStatus': order_status,
                        'createdAt': (created_at.isoformat() + 'Z') if created_at else None,
                        'cancelledAt': (cancelled_at.isoformat() + 'Z') if cancelled_at else None,
                        'cutterName': cutter,
                        'sewerName': sewer,
                        'packerName': packer,
                        'returnReason': reason_text,
                        'mpStatus': ret[1] if ret else None,
                    }, ensure_ascii=False),
                }

            if action == 'send_to_check':
                # Приём возврата на склад. Кладовщик решает прямо в карточке, куда вещь идёт:
                #   toPacker=False — «На разборе с маркетплейса» (checking): коробку принял,
                #     разберёт позже;
                #   toPacker=True  — сразу «На проверке» (repacking): вещь уходит упаковщице
                #     в цех одним нажатием, без промежуточного шага и лишнего сканирования.
                # После осмотра её либо перепакуют и вернут в продажу, либо спишут.
                order_id = body_data.get('orderId')
                to_packer = bool(body_data.get('toPacker'))
                new_status = 'repacking' if to_packer else 'checking'
                if not order_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите orderId'})}

                cur.execute("SELECT order_number FROM orders WHERE id = %s", (int(order_id),))
                o = cur.fetchone()
                if not o:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                num = o[0]

                cur.execute("SELECT id FROM goods_warehouse WHERE order_id = %s", (int(order_id),))
                exists = cur.fetchone()
                if exists:
                    gw_id = exists[0]
                    cur.execute(
                        f"UPDATE goods_warehouse SET status = '{new_status}', shelf_id = NULL, "
                        "shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
                        "reserved_order_id = NULL, shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, "
                        "receive_reason = 'return', received_at = now() "
                        f"WHERE id = {int(gw_id)}"
                    )
                else:
                    barcode_new = next_storage_barcode(cur)
                    cur.execute(
                        "INSERT INTO goods_warehouse (order_id, status, storage_barcode, "
                        "receive_reason, received_at) "
                        f"VALUES (%s, '{new_status}', %s, 'return', now()) RETURNING id",
                        (int(order_id), barcode_new),
                    )
                    gw_id = cur.fetchone()[0]

                log_action(
                    cur, actor_id, actor_name, 'send_to_check', 'goods_warehouse', gw_id,
                    f'Принял возврат #{num}: '
                    + ('передал упаковщице на осмотр' if to_packer else 'взял на разбор'),
                )
                conn.commit()
                cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE id = %s", (int(gw_id),))
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'id': gw_id,
                        'storageBarcode': cur.fetchone()[0],
                        'toPacker': to_packer,
                    }, ensure_ascii=False),
                }

            if action == 'dismiss_notification':
                # Админ убирает уведомление с панели. Физически запись не удаляем —
                # история решений по складу должна остаться целой.
                if not is_admin(cur, actor_id):
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Управлять уведомлениями может только администратор'}, ensure_ascii=False),
                    }
                ids = body_data.get('ids') or ([body_data['id']] if body_data.get('id') else [])
                if ids:
                    ids_csv = ','.join(str(int(i)) for i in ids)
                    cur.execute(
                        f"UPDATE admin_notifications SET hidden_at = now(), is_read = true "
                        f"WHERE id IN ({ids_csv}) AND hidden_at IS NULL RETURNING id"
                    )
                else:
                    # Без списка id — «очистить всё».
                    cur.execute(
                        "UPDATE admin_notifications SET hidden_at = now(), is_read = true "
                        "WHERE hidden_at IS NULL RETURNING id"
                    )
                removed = len(cur.fetchall())
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'removed': removed})}

            if action == 'move_to_workshop':
                # Кладовщик отобрал принятые возвраты и передал их упаковщицам на осмотр.
                # Работаем пачкой: обычно за раз уезжает целая тележка, а не одна вещь.
                ids = body_data.get('ids') or []
                if not ids:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите товары'})}
                ids_csv = ','.join(str(int(i)) for i in ids)
                # В цех уезжают и вещи прямо с ПВЗ (mp_return): кладовщик разбирает
                # привезённое и часть сразу отдаёт упаковщицам, не заводя промежуточный шаг.
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'repacking' "
                    f"WHERE id IN ({ids_csv}) AND status IN ('checking', 'mp_return') RETURNING id"
                )
                moved_rows = cur.fetchall()
                moved = len(moved_rows)

                # Возврат разобран — закрываем заявку.
                #
                # Кладовщик решил судьбу вещи: она уехала в цех на осмотр. Работа с
                # разбором окончена, дальше отвечает упаковщица. Раньше заявка
                # оставалась «Забран, ждёт разбора», и на складе висела плашка
                # «Непроверенные возвраты» — звала разбирать то, что уже в цехе.
                if moved_rows:
                    moved_ids = ','.join(str(int(r[0])) for r in moved_rows)
                    cur.execute(
                        "UPDATE marketplace_returns SET status = 'processed', outcome = 'repack' "
                        f"WHERE goods_warehouse_id IN ({moved_ids}) AND status = 'picked_up'"
                    )
                log_action(
                    cur, actor_id, actor_name, 'move_to_workshop', 'goods_warehouse', None,
                    f'Передал на осмотр упаковщицам вещей: {moved}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'moved': moved})}

            if action == 'to_shelf_from_inspection':
                # Вещь вернулась с маркетплейса в порядке — осматривать её в цехе незачем.
                #
                # Раньше с разбора был только один путь: «в цех на осмотр». Годную вещь
                # приходилось гонять к упаковщицам и ждать, пока её вернут, — лишний круг
                # по производству ради вещи, с которой всё хорошо. Теперь кладовщик кладёт
                # её на полку прямо здесь.
                #
                # Полку указывают ПРЯМО ЗДЕСЬ (shelfId) — вещь сразу встаёт на место.
                #
                # Раньше она уходила в 'awaiting_shelf' и попадала в виджет «Разложить по
                # полкам», где кладовщик заново сканировал её и выбирал полку. Двойная
                # работа на ровном месте: вещь уже у него в руках, и полку он знает.
                # Стикер хранения печатается сразу после этого действия.
                ids = body_data.get('ids') or []
                if not ids:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите товары'})}
                shelf_id = body_data.get('shelfId')
                if not shelf_id:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Выберите полку'}, ensure_ascii=False),
                    }
                cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                shelf_row = cur.fetchone()
                if not shelf_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Полка не найдена'}, ensure_ascii=False),
                    }

                ids_csv = ','.join(str(int(i)) for i in ids)
                # Сюда же приходят вещи с этапа «Осмотрено»: упаковщица закончила проверку
                # и наклеила стикер, кладовщику остаётся положить вещь на полку. Раньше
                # эти статусы здесь не принимались, и на «Осмотрено» кнопки укладки не
                # было вовсе — приходилось идти в отдельное окно раскладки.
                # 'taken' — вещи, забранные из цеха по старой схеме: их тоже кладём.
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'in_stock', shelf_id = {int(shelf_id)}, "
                    f"received_at = now(), "
                    f"taken_at = COALESCE(taken_at, now()), "
                    f"taken_by = COALESCE(taken_by, {int(actor_id) if actor_id else 'NULL'}) "
                    f"WHERE id IN ({ids_csv}) "
                    f"AND status IN ('checking', 'mp_return', 'inspected', 'taken') "
                    f"RETURNING id, storage_barcode, order_id"
                )
                placed_rows = cur.fetchall()
                moved = len(placed_rows)

                # Вещь легла на полку — она снова свободный остаток и может закрыть
                # заказ, который сейчас ждёт пошива. Проверяем сразу, чтобы не шить
                # то, что уже лежит на складе.
                for gw_id, _bc, _oid in placed_rows:
                    try_match_orders_from_stock(cur, gw_id=gw_id)

                # Возврат разобран — закрываем заявку.
                #
                # Раньше вещь ложилась на полку, а заявка возврата так и висела
                # «Забран, ждёт разбора»: кладовщик уже всё решил и определил место,
                # а список делал вид, что работа не сделана. Он открывал вкладку и
                # заново разбирал то, что стоит на полке.
                if placed_rows:
                    placed_ids = ','.join(str(int(r[0])) for r in placed_rows)
                    cur.execute(
                        "UPDATE marketplace_returns SET status = 'processed', outcome = 'stored' "
                        f"WHERE goods_warehouse_id IN ({placed_ids}) AND status = 'picked_up'"
                    )

                # Что печатать: стикеры хранения по каждой уложенной вещи.
                items_out = []
                if placed_rows:
                    placed_csv = ','.join(str(int(r[0])) for r in placed_rows)
                    cur.execute(
                        "SELECT gw.id, gw.storage_barcode, o.order_number, o.material, "
                        "       o.width, o.height, o.product "
                        "FROM goods_warehouse gw LEFT JOIN orders o ON o.id = gw.order_id "
                        f"WHERE gw.id IN ({placed_csv})"
                    )
                    items_out = [
                        {
                            'id': r[0],
                            'storageBarcode': r[1],
                            'orderNumber': r[2],
                            'material': r[3],
                            'width': r[4],
                            'height': r[5],
                            'product': r[6],
                        }
                        for r in cur.fetchall()
                    ]

                log_action(
                    cur, actor_id, actor_name, 'to_shelf_from_inspection', 'goods_warehouse', None,
                    f'Положил на полку «{shelf_row[0]}» вещей: {moved}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'moved': moved,
                        'shelfName': shelf_row[0],
                        'items': items_out,
                    }, ensure_ascii=False),
                }

            if action == 'take_from_workshop':
                # Кладовщик забирает осмотренную вещь из цеха: сканирует стикер хранения,
                # который наклеила упаковщица. Полку определит позже — сейчас вещь «на руках».
                scan = (body_data.get('barcode') or '').strip()
                if not scan:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте стикер хранения'})}
                bc = scan.replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.status, o.product, o.order_number FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    f"WHERE gw.storage_barcode = '{bc}'"
                )
                row = cur.fetchone()
                if not row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': f'Стикер {scan} не найден'}, ensure_ascii=False),
                    }
                gw_id, gw_status, gw_product, gw_number = row
                # Утилизированную вещь кладовщик тоже физически забирает и несёт старшему —
                # поэтому её сканирование разрешено, но статус остаётся утилизацией.
                if gw_status not in ('inspected', 'to_dispose'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Вещь ещё не осмотрена упаковщицей (статус: {gw_status})'
                        }, ensure_ascii=False),
                    }
                if gw_status == 'inspected':
                    cur.execute(
                        f"UPDATE goods_warehouse SET status = 'taken', taken_at = now(), "
                        f"taken_by = {int(actor_id) if actor_id else 'NULL'} WHERE id = {int(gw_id)}"
                    )
                log_action(
                    cur, actor_id, actor_name, 'take_from_workshop', 'goods_warehouse', gw_id,
                    f'Забрал из цеха вещь #{gw_number or "—"} ({scan})',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': gw_id,
                        'product': gw_product,
                        'orderNumber': gw_number,
                        'storageBarcode': scan,
                        'toDispose': gw_status == 'to_dispose',
                    }, ensure_ascii=False),
                }

            if action == 'send_to_dispose':
                # Решение забраковать вещь принимают двое: упаковщица в цехе (кнопкой
                # на терминале, вещь она держит в руках) и администратор. Кладовщику
                # это не положено — он вещь не осматривал. Раньше проверки не было, и
                # со склада можно было отправить в утиль что угодно мимо осмотра.
                if not is_admin(cur, actor_id):
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Отправить на утилизацию может только администратор. '
                                     'Брак отмечает упаковщица на терминале при осмотре'
                        }, ensure_ascii=False),
                    }
                # Причина обязательна: иначе через месяц никто не вспомнит, за что списали.
                ids = body_data.get('ids') or ([body_data['id']] if body_data.get('id') else [])
                reason = (body_data.get('reason') or '').strip()
                if not ids:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите товары'})}
                if not reason:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите причину утилизации'})}
                ids_csv = ','.join(str(int(i)) for i in ids)
                reason_esc = reason.replace("'", "''")
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'to_dispose', "
                    f"dispose_reason = '{reason_esc}', reserved_order_id = NULL, shelf_id = NULL "
                    f"WHERE id IN ({ids_csv}) RETURNING id"
                )
                moved = len(cur.fetchall())
                log_action(
                    cur, actor_id, actor_name, 'send_to_dispose', 'goods_warehouse', None,
                    f'Отправил на утилизацию вещей: {moved}. Причина: {reason}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'moved': moved})}

            if action == 'clear_disposed':
                # Чистка кладки утилизации — только администратор. Вещи не удаляем,
                # а помечаем списанными: история склада должна оставаться целой.
                if not is_admin(cur, actor_id):
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Чистить утилизацию может только администратор'}, ensure_ascii=False),
                    }
                ids = body_data.get('ids') or []
                where_ids = ''
                if ids:
                    where_ids = ' AND id IN (' + ','.join(str(int(i)) for i in ids) + ')'
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'lost', disposed_at = now(), "
                    f"disposed_by = {int(actor_id)}, "
                    f"lost_reason = COALESCE(dispose_reason, 'Утилизация') "
                    f"WHERE status = 'to_dispose'{where_ids} RETURNING id"
                )
                cleared = len(cur.fetchall())
                log_action(
                    cur, actor_id, actor_name, 'clear_disposed', 'goods_warehouse', None,
                    f'Списал утилизированные вещи: {cleared}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'cleared': cleared})}

            if action == 'receive_return':
                order_number = (body_data.get('orderNumber') or '').strip()
                if not order_number:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите номер заказа'})}

                order_number_esc = order_number.replace("'", "''")
                # Ищем и по номеру отправления маркетплейса: на ярлыке OZON напечатан
                # именно он, а у вещи в системе может быть внутренний номер с хвостом
                # (…-1-2) — наследство старого способа деления отправлений. Без этого
                # кладовщик сканировал возврат и получал «заказ не найден».
                cur.execute(
                    f"SELECT id FROM orders "
                    f"WHERE order_number = '{order_number_esc}' "
                    f"   OR ozon_posting_number = '{order_number_esc}' "
                    f"ORDER BY (order_number = '{order_number_esc}') DESC, id LIMIT 1"
                )
                order_row = cur.fetchone()
                if not order_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Заказ {order_number} не найден'})}
                order_id = order_row[0]

                # Полку вручную не выбираем: возврат принимается в статусе awaiting_shelf, а на
                # конкретную полку вещь кладётся ТОЛЬКО сканированием стикера хранения
                # (action place_on_shelf) — так на складе не бывает вещей «не на своём месте».

                # Заказ уже был на складе (в т.ч. отгружен раньше) — просто возвращаем
                # существующую запись обратно в "На хранении" с новой полкой, без дублирования
                # (order_id в таблице UNIQUE).
                cur.execute("SELECT id, storage_barcode FROM goods_warehouse WHERE order_id = %s", (order_id,))
                existing = cur.fetchone()
                if existing:
                    gw_id, storage_barcode = existing
                    cur.execute(
                        f"UPDATE goods_warehouse SET status = 'mp_return', shelf_id = NULL, "
                        f"shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
                        f"reserved_order_id = NULL, shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, "
                        f"receive_reason = 'return' WHERE id = {gw_id}"
                    )
                    log_action(cur, actor_id, actor_name, 'receive_return', 'goods_warehouse', gw_id, f'Принял возврат заказа #{order_number} повторно')
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': gw_id, 'storageBarcode': storage_barcode})}

                storage_barcode = next_storage_barcode(cur)
                cur.execute(
                    f"INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
                    f"VALUES ({order_id}, 'mp_return', '{storage_barcode}', 'return') RETURNING id"
                )
                new_id = cur.fetchone()[0]
                log_action(cur, actor_id, actor_name, 'receive_return', 'goods_warehouse', new_id, f'Принял возврат заказа #{order_number} ({storage_barcode})')
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id, 'storageBarcode': storage_barcode})}

            if action == 'move_shelf_batch':
                # Перенос пачкой: кладовщик набрал вещи в буфер у стеллажа и переносит их
                # одним действием. По одной вещи за запрос было бы N обращений к серверу —
                # на полусотне вещей это заметная задержка прямо посреди работы.
                barcodes = body_data.get('barcodes') or []
                shelf_id = body_data.get('shelfId')
                if not barcodes:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте вещи'})}
                if shelf_id in (None, ''):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите полку назначения'})}

                codes_csv = ','.join(
                    "'" + str(b).replace("'", "''") + "'" for b in barcodes
                )
                # Перенос пачкой, как и поштучный, НИЧЕГО не фильтрует: меняется только
                # полка. Раньше вещи с бронью или в сборке молча выпадали из переноса —
                # кладовщик перекладывал полсотни вещей, а система записывала половину,
                # и остальные числились на старых местах.
                cur.execute(
                    f"UPDATE goods_warehouse SET shelf_id = {int(shelf_id)} "
                    f"WHERE storage_barcode IN ({codes_csv}) "
                    f"RETURNING id"
                )
                moved = len(cur.fetchall())
                cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                nm = cur.fetchone()
                log_action(
                    cur, actor_id, actor_name, 'move_shelf_batch', 'goods_warehouse', None,
                    f'Переложил на полку {nm[0] if nm else shelf_id} вещей: {moved}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'moved': moved,
                        'skipped': len(barcodes) - moved,
                        'shelfName': nm[0] if nm else None,
                    }, ensure_ascii=False),
                }

            if action == 'move_shelf_by_barcode':
                barcode = (body_data.get('barcode') or '').strip()
                shelf_id = body_data.get('shelfId')
                if not barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте штрихкод хранения'})}
                barcode_esc = barcode.replace("'", "''")
                # Возвращаем товар и ПРЕЖНЮЮ полку: кладовщик раскладывает пачкой, глядя
                # на стеллаж, и по строке на экране сразу видит, что именно переложил
                # и откуда — так заметна случайная вещь из чужого ряда.
                cur.execute(
                    "SELECT gw.id, o.product, s.name, gw.shelf_id, gw.status, "
                    "       gw.reserved_order_id, ro.order_number "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                    "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                    f"WHERE gw.storage_barcode = '{barcode_esc}'"
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар со штрихкодом {barcode} не найден'})}
                (gw_id, gw_product, old_shelf_name, old_shelf_id,
                 gw_status, gw_reserved_id, gw_reserved_number) = row

                # Смена полки НИЧЕГО не проверяет и ничего не решает про подбор.
                #
                # Это чисто складская операция: вещь физически переехала с одного
                # стеллажа на другой, и система просто записывает новое место. Бронь,
                # статус, участие в подборе — всё остаётся как было: вещь не пропадает
                # из подбора и не меняет статус, у неё меняется ТОЛЬКО полка.
                #
                # Раньше здесь стояли запреты «забронирован» и «уже собран». На практике
                # они мешали работе: кладовщик физически переставил вещь на другую полку,
                # а система отказывалась это записать — и в ней оставалось старое место.
                # Сборщик потом шёл по неверному адресу. Запрет не удерживал вещь на
                # полке, он лишь ломал учёт.

                # Вещь уже лежит на этой полке — второй раз её не двигаем и честно
                # говорим об этом: иначе кладовщик думает, что переложил, а он повторился.
                if shelf_id not in (None, '') and old_shelf_id == int(shelf_id):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'{gw_product or "Товар"} уже лежит на полке {old_shelf_name or ""}'.strip()
                        }, ensure_ascii=False),
                    }

                shelf_sql = int(shelf_id) if shelf_id not in (None, '') else 'NULL'
                cur.execute(f"UPDATE goods_warehouse SET shelf_id = {shelf_sql} WHERE id = {gw_id}")
                new_shelf_name = None
                if shelf_id not in (None, ''):
                    cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                    nm = cur.fetchone()
                    new_shelf_name = nm[0] if nm else None
                log_action(
                    cur, actor_id, actor_name, 'move_shelf', 'goods_warehouse', gw_id,
                    f'Переложил {gw_product or barcode} с полки {old_shelf_name or "—"} '
                    f'на {new_shelf_name or "—"}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'id': gw_id,
                        'product': gw_product,
                        'fromShelf': old_shelf_name,
                        'toShelf': new_shelf_name,
                        'storageBarcode': barcode,
                    }, ensure_ascii=False),
                }

            if action == 'return_to_workshop':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT order_id, status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[1] not in ('in_stock', 'picking'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар уже зарезервирован/отгружен, вернуть нельзя'})}
                cur.execute(f"DELETE FROM goods_warehouse WHERE id = {int(item_id)}")
                cur.execute(f"UPDATE orders SET sewing_status = 'В работе' WHERE id = {int(row[0])}")
                log_action(cur, actor_id, actor_name, 'return_to_workshop', 'order', row[0], f'Вернул товар #{item_id} в цех')
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'verify_picking':
                # Проверка подбора: нужны ли ещё эти вещи.
                #
                # Заказ, под который вещь подобрали, мог за это время уехать к покупателю,
                # отмениться или закрыться сам. Ярлык для него маркетплейс уже не отдаёт —
                # собрать вещь физически невозможно. Раньше такая вещь висела в подборе
                # вечно: кладовщик шёл к стеллажу, упирался в ошибку печати и не понимал,
                # что делать. Снимаем резерв и возвращаем вещь на полку — она годная,
                # просто этот заказ ею уже не закрыть.
                #
                # gwId — проверить одну вещь (нажали «Напечатать стикер» в её карточке).
                # Без него проверяется весь подбор разом.
                gw_id = body_data.get('gwId')
                dead = "('delivering', 'delivered', 'cancelled', 'not_accepted', 'driver_pickup')"
                where_one = f' AND gw.id = {int(gw_id)}' if gw_id else ''
                cur.execute(
                    "SELECT gw.id, gw.storage_barcode, o.order_number, o.ozon_status, o.status "
                    "FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.reserved_order_id "
                    "WHERE gw.status IN ('picking', 'in_stock') "
                    "  AND gw.shipping_labeled_at IS NULL "
                    f"  AND (COALESCE(o.ozon_status, '') IN {dead} OR o.status = 'Отменён')"
                    + where_one
                )
                stale = cur.fetchall()

                released = []
                for sid, barcode_v, num, oz_status, o_status in stale:
                    cur.execute(
                        "UPDATE goods_warehouse SET status = 'in_stock', "
                        "reserved_order_id = NULL, matched_at = NULL WHERE id = %s",
                        (int(sid),),
                    )
                    released.append({
                        'id': sid,
                        'storageBarcode': barcode_v,
                        'orderNumber': num,
                        'reason': 'Заказ отменён' if (o_status == 'Отменён'
                                                      or oz_status == 'cancelled')
                        else 'Отправление уже уехало к покупателю',
                    })

                # Лечим рассинхрон: вещь закреплена за ЖИВЫМ заказом, но числится
                # «На хранении».
                #
                # Такая вещь выпадает из работы целиком: в списке «Товар к подбору» её нет
                # (туда попадают только «На сборке»), а на складе она выглядит свободной —
                # и её же система предлагает как остаток под другой заказ. Кладовщик пикает
                # её сканером, слышит «нужная», идёт клеить ярлык — и упирается в то, что
                # вещь уже принадлежит чужому отправлению.
                #
                # Возвращаем такую вещь в подбор: заказ живой, вещь на месте — работа
                # просто перестала быть видимой.
                cur.execute(
                    "UPDATE goods_warehouse gw SET status = 'picking' "
                    "FROM orders ro WHERE ro.id = gw.reserved_order_id "
                    "  AND gw.status = 'in_stock' "
                    "  AND gw.shipping_labeled_at IS NULL "
                    "  AND gw.shipped_at IS NULL "
                    # Связь должна быть ВЗАИМНОЙ: заказ тоже указывает на эту вещь.
                    # Односторонней ссылки мало — она бывает и у заказа, который стоит
                    # в очереди на пошив: тогда вещь вернулась бы в подбор, кладовщик
                    # наклеил бы на неё ярлык, а цех параллельно сшил бы второй экземпляр.
                    "  AND ro.fulfilled_from_stock_id = gw.id "
                    "  AND ro.sewing_status = 'Со склада' "
                    f"  AND {RESERVE_ALIVE_SQL} "
                    + (f" AND gw.id = {int(gw_id)}" if gw_id else "") +
                    " RETURNING gw.id, gw.storage_barcode, ro.order_number"
                )
                restored = cur.fetchall()
                if restored:
                    log_action(
                        cur, actor_id, actor_name, 'verify_picking', 'goods_warehouse', None,
                        f'Возвращено в подбор вещей: {len(restored)} '
                        f'(числились на хранении, но закреплены за живыми заказами)',
                    )

                if released:
                    log_action(
                        cur, actor_id, actor_name, 'verify_picking', 'goods_warehouse', None,
                        f'Проверка подбора: снят резерв с вещей {len(released)} '
                        f'(заказы отменены или уже уехали)',
                    )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'released': released,
                        'total': len(released),
                        # Сколько вещей вернулось в подбор из «зависшего» состояния.
                        'restored': len(restored),
                    }, ensure_ascii=False),
                }

            if action == 'rematch_stock':
                # Ручной перезапуск подбора по всему складу. Нужен как страховка: если
                # заказы пришли раньше, чем вещи легли на полку, или подбор пропустил
                # заказ из-за параллельной работы цеха — эта кнопка всё пересчитает.
                rematched = try_match_orders_from_stock(cur)
                if rematched:
                    log_action(
                        cur, actor_id, actor_name, 'rematch_stock', 'goods_warehouse', None,
                        f'Пересчёт подбора: закрыто складом заказов {len(rematched)}',
                    )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'matched': len(rematched)}),
                }

            if action == 'scan_picking':
                # Сканер подбора: ищем работу ПО РАЗМЕРУ ТОВАРА, а не по номеру стикера.
                #
                # Раньше сканер сверял именно тот GW-стикер, который система закрепила
                # за заказом. На практике вещи одного размера лежат на полке вперемешку
                # и физически ничем не отличаются: кладовщик берёт любую подходящую и
                # клеит на неё ярлык отправления. Если это оказалась «не та» коробка,
                # сканер отвечал «мимо» — при том что нужная вещь у человека в руках.
                # Хуже того, вещь с «правильным» стикером потом было не найти вовсе.
                #
                # Теперь логика простая и совпадает с реальностью склада: отсканировали
                # стикер хранения -> узнали, ЧТО это за товар -> ищем любой заказ в
                # подборе на такой же товар. Совпало — вещь нужная, и подбор
                # переключается на неё: ярлык уедет с той вещью, что реально в руках.
                barcode = (body_data.get('barcode') or '').strip()
                if not barcode:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Отсканируйте стикер хранения'},
                                               ensure_ascii=False)}
                bc_esc = barcode.replace("'", "''")

                # 1. Что за вещь в руках: товар берём у заказа, в котором её сшили.
                cur.execute(
                    "SELECT gw.id, gw.status, gw.reserved_order_id, gw.shipping_labeled_at, "
                    "       src.product, src.marketplace_item_id, sh.name, gw.shipped_at "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders src ON src.id = gw.order_id "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    f"WHERE gw.storage_barcode = '{bc_esc}'"
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers,
                            'body': json.dumps({'error': f'Стикер {barcode} не найден'},
                                               ensure_ascii=False)}
                (gw_id, gw_status, gw_reserved, gw_labeled, gw_product,
                 gw_item_id, gw_shelf, gw_shipped_at) = row

                # Вещь уже собрана или уехала — второй раз её не подбирают.
                # Вещь списали: не нашли на складе и отправили заказ в пошив заново.
                # В подбор она больше не возвращается — её физически нет.
                if gw_status == 'lost':
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                        'matched': False,
                        'reason': 'Вещь списана и отправлена в пошив — в подбор не идёт',
                        'product': gw_product,
                    }, ensure_ascii=False)}
                # Стикер уже наклеен, но вещь ещё НЕ отправлена на поставку — работа не
                # закончена, и вещь надо вернуть кладовщику, а не прятать.
                #
                # Так терялся товар: напечатал ярлык, случайно нажал «Назад», а дальше
                # вещь не найти ничем — из списка подбора она уже ушла (там только
                # неотстикерованные), а сканер отвечал «уже собрана». Вещь с наклеенным
                # ярлыком оставалась лежать в руках, и кнопку «На поставку» нажать было
                # неоткуда.
                #
                # Теперь такой скан открывает карточку: там кнопка «Отправить на
                # поставку» и возможность перепечатать ярлык.
                # Статус 'awaiting_supply' тоже сюда входит: «отправлена на поставку» —
                # это ещё НЕ отгружена. Вещь лежит на полке и ждёт, когда её положат в
                # короб. Кладовщик пикает её стикер, чтобы найти вещь и посмотреть полку,
                # а сканер отвечал «уже собрана» и прятал её — вещь выглядела пропавшей.
                if gw_status != 'shipped' and not gw_shipped_at and gw_reserved and gw_labeled:
                    cur.execute(
                        f"SELECT order_number FROM orders WHERE id = {int(gw_reserved)}"
                    )
                    lbl = cur.fetchone()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                        'matched': True, 'goodsId': gw_id, 'product': gw_product,
                        'shelfName': gw_shelf,
                        'orderNumber': lbl[0] if lbl else None,
                        # Экран покажет это отдельно: вещь уже с ярлыком, осталось
                        # нажать «Отправить на поставку».
                        'alreadyLabeled': True,
                        # Два разных шага, и подсказка должна быть точной, иначе
                        # кладовщик ищет кнопку, которой уже нет: вещь либо ещё надо
                        # отправить на поставку, либо она уже ждёт короба на полке.
                        'reason': (
                            'Стикер наклеен, вещь ждёт короба — отнесите её в поставку'
                            if gw_status == 'awaiting_supply'
                            else 'Стикер уже наклеен — осталось отправить на поставку'
                        ),
                    }, ensure_ascii=False)}
                if gw_labeled or gw_status in ('shipped', 'awaiting_supply'):
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                        'matched': False,
                        'reason': 'Вещь уже собрана: на ней стикер отправления',
                        'product': gw_product,
                    }, ensure_ascii=False)}
                if gw_status not in ('in_stock', 'picking'):
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                        'matched': False,
                        'reason': 'Вещь не лежит на складе',
                        'product': gw_product,
                    }, ensure_ascii=False)}

                # 2. Эта вещь уже закреплена за живым заказом — работа найдена сразу.
                if gw_reserved:
                    cur.execute(
                        "SELECT ro.order_number, ro.sewing_status, ro.fulfilled_from_stock_id "
                        f"FROM orders ro WHERE ro.id = {int(gw_reserved)} AND {RESERVE_ALIVE_SQL}"
                    )
                    own = cur.fetchone()
                    # Заказ жив, но вещь за ним не закреплена с его стороны — значит он
                    # стоит в очереди на пошив, а не закрыт складом. Стикеровать такую
                    # вещь нельзя: цех сошьёт вторую, и на одно отправление будет два
                    # товара. Освобождаем вещь — она уйдёт в свободный остаток.
                    if own and (own[1] != 'Со склада' or own[2] != gw_id):
                        cur.execute(
                            "UPDATE goods_warehouse SET reserved_order_id = NULL, "
                            f"matched_at = NULL, status = 'in_stock' WHERE id = {int(gw_id)}"
                        )
                        conn.commit()
                        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                            'matched': False,
                            'reason': f'Заказ #{own[0]} шьётся в цехе — эта вещь ему не '
                                      f'принадлежит. Вещь освобождена и снова на хранении',
                            'product': gw_product,
                        }, ensure_ascii=False)}
                    if own:
                        # Вещь закреплена за живым заказом, но числится «На хранении» —
                        # значит, где-то её вернули на полку, забыв снять резерв. В подборе
                        # такой вещи не видно, и кладовщик упирался в тупик: сканер её
                        # находит, а застикеровать нельзя. Возвращаем в сборку прямо здесь.
                        if gw_status == 'in_stock':
                            cur.execute(
                                f"UPDATE goods_warehouse SET status = 'picking' WHERE id = {int(gw_id)}"
                            )
                            log_action(
                                cur, actor_id, actor_name, 'scan_picking', 'goods_warehouse',
                                gw_id,
                                f'Вернул в подбор: вещь числилась на хранении, но закреплена '
                                f'за заказом #{own[0]}',
                            )
                            conn.commit()
                        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                            'matched': True, 'goodsId': gw_id, 'product': gw_product,
                            'shelfName': gw_shelf, 'orderNumber': own[0],
                            'reassigned': False,
                        }, ensure_ascii=False)}
                    # Заказ мёртвый (отменён/уехал), а вещь всё ещё за ним закреплена —
                    # освобождаем её, иначе она навсегда выпадет из оборота. Заодно
                    # убираем обратную ссылку у заказа: иначе он остаётся «закрытым
                    # складом» без вещи и просто исчезает из работы.
                    cur.execute(
                        "UPDATE orders SET fulfilled_from_stock_id = NULL "
                        f"WHERE id = {int(gw_reserved)} AND fulfilled_from_stock_id = {int(gw_id)}"
                    )
                    cur.execute(
                        "UPDATE goods_warehouse SET reserved_order_id = NULL, matched_at = NULL "
                        f"WHERE id = {int(gw_id)}"
                    )
                    gw_reserved = None

                # 3. Ищем НЕЗАКРЫТЫЙ заказ на такой же товар.
                #
                #    Ключевое правило: успех даём только если товар реально НЕДОСТАЁТ.
                #    Считаем не по совпадению размера, а по свободным заказам — сколько
                #    штук ещё не закрыто вещью, столько раз сканер и ответит «нужная».
                #
                #    Сравниваем ТОЛЬКО по названию товара («Лен 300x265») — в нём и
                #    материал, и ширина, и высота, то есть ровно то, чем вещи отличаются
                #    друг от друга на полке. Код товара справочника не сверяем вовсе:
                #    он заполнен не у всех вещей, и одинаковый товар с разными кодами
                #    считался разным — кладовщик держал в руках нужный размер, а сканер
                #    отвечал «не нужен в подбор».
                if not gw_product:
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                        'matched': False,
                        'reason': 'У вещи не указан размер — подобрать нельзя',
                        'product': gw_product,
                    }, ensure_ascii=False)}

                prod_esc = gw_product.replace("'", "''")

                # 3б. Ищем ОСИРОТЕВШИЙ заказ на такой же товар.
                #
                # Заказ считается закрытым складом и указывает на конкретную вещь, но та
                # вещь его уже не держит: её освободили, переложили или отдали под другое
                # отправление. Заказ при этом в цех не уходит (он «Со склада») и в подборе
                # не показывается — вещи-то за ним нет. Работа исчезает с обеих сторон:
                # на складе лежит подходящий товар, а система говорит «не нужен».
                #
                # Именно так вещь с нужным размером переставала сканироваться, хотя такой
                # же товар числился к поставке.
                #
                # ВАЖНО: это ЕДИНСТВЕННЫЙ способ добавить в подбор новую вещь со склада.
                # Свободный заказ — это реальная недостающая штука. Если свободных
                # заказов на такой размер нет, значит все они уже закрыты вещами, и
                # сканер обязан ответить «не нужен», сколько бы такого товара ни лежало
                # на полке.
                cur.execute(
                    "SELECT ro.id, ro.order_number FROM orders ro "
                    "LEFT JOIN goods_warehouse lost ON lost.id = ro.fulfilled_from_stock_id "
                    "WHERE ro.sewing_status = 'Со склада' "
                    f"  AND ro.product = '{prod_esc}' "
                    "  AND (lost.id IS NULL OR (lost.reserved_order_id IS DISTINCT FROM ro.id "
                    "       AND lost.shipped_at IS NULL)) "
                    # Заказ действительно брошен, только если его не держит НИ ОДНА
                    # вещь. Бывают «перекрёстные» пары: заказ ссылается на одну вещь,
                    # а держит его другая — работа при этом на месте, и выдавать под
                    # неё второй товар нельзя, иначе на отправление уедет две вещи.
                    "  AND NOT EXISTS (SELECT 1 FROM goods_warehouse held "
                    "     WHERE held.reserved_order_id = ro.id AND held.shipped_at IS NULL) "
                    f"  AND {RESERVE_ALIVE_SQL} "
                    "ORDER BY ro.created_at ASC, ro.id ASC LIMIT 1"
                )
                orphan = cur.fetchone()
                if orphan:
                    orphan_id, orphan_number = orphan
                    cur.execute(
                        "UPDATE goods_warehouse SET status = 'picking', "
                        "reserved_order_id = %s, matched_at = now() WHERE id = %s",
                        (int(orphan_id), int(gw_id)),
                    )
                    cur.execute(
                        "UPDATE orders SET fulfilled_from_stock_id = %s WHERE id = %s",
                        (int(gw_id), int(orphan_id)),
                    )
                    log_action(
                        cur, actor_id, actor_name, 'scan_picking', 'goods_warehouse',
                        gw_id,
                        f'Заказ #{orphan_number} остался без вещи — закрыт вещью {barcode}',
                    )
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                        'matched': True, 'goodsId': gw_id, 'product': gw_product,
                        'shelfName': gw_shelf, 'orderNumber': orphan_number,
                        'reassigned': True,
                    }, ensure_ascii=False)}

                # Свободных заказов на этот размер не осталось — потребность закрыта.
                #
                # Раньше здесь стоял перенос подбора с ДРУГОЙ такой же вещи на ту, что в
                # руках: сканер отвечал «нужная», а на полку вместо неё возвращалась
                # предыдущая. Количество в подборе при этом не менялось — работа просто
                # переезжала с вещи на вещь. Кладовщик шёл вдоль стеллажа, пикал десятый
                # «Лен 300x265» подряд и каждый раз слышал успех, хотя нужна была одна
                # штука: он насканировал 77 вещей, а в подборе так и осталось 50.
                #
                # Теперь потребность считается по заказам, а не по совпадению размера:
                # нет свободного заказа — «не нужен», даже если такой товар в подборе есть.
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                    'matched': False,
                    'reason': 'Этот размер уже набран — больше не нужен',
                    'product': gw_product,
                }, ensure_ascii=False)}

            if action == 'start_picking':
                barcode = (body_data.get('barcode') or '').strip()
                if not barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте штрихкод хранения'})}
                barcode_esc = barcode.replace("'", "''")
                cur.execute("SELECT id, status FROM goods_warehouse WHERE storage_barcode = %s", (barcode_esc,))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар со штрихкодом {barcode} не найден'})}
                gw_id, status = row
                if status != 'in_stock':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар не на хранении (статус: {status}), подобрать нельзя'}),
                    }
                # «На сборке» — статус ТОЛЬКО для вещи, закреплённой за заказом. Вручную
                # перевести туда свободный остаток нельзя: кладовщик увидел бы вещь в
                # списке подбора, пошёл за ней, а отправления за ней нет.
                # Подбор делает система сама, когда находит заказ под эту вещь.
                cur.execute("SELECT reserved_order_id FROM goods_warehouse WHERE id = %s", (int(gw_id),))
                res_row = cur.fetchone()
                if not res_row or not res_row[0]:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Вещь не подобрана ни под один заказ — в сборку она не идёт'
                        }, ensure_ascii=False),
                    }
                cur.execute(f"UPDATE goods_warehouse SET status = 'picking' WHERE id = {gw_id}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'id': gw_id})}

            if action == 'cancel_picking':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[0] != 'picking':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар не в статусе "На сборке"'})}
                # Снимаем И резерв, а не только статус. Раньше вещь возвращалась «На
                # хранение», но оставалась закреплённой за заказом: в подборе её больше
                # не видно, а на складе она выглядит свободной. Кладовщик пикал такую
                # вещь сканером и упирался в «товар принадлежит другому заказу».
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', reserved_order_id = NULL, "
                    f"matched_at = NULL, shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL WHERE id = {int(item_id)}"
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'not_found':
                # «Не нашёл» — вещи нет на полке, хотя система считает, что она там лежит.
                #
                # Без этой кнопки вещь висела в подборе вечно: кладовщик сканировал
                # 230 товаров, не находил её, уходил — а назавтра автоподбор предлагал
                # её снова. Так накопились 23 «мёртвых» позиции, две из которых искали
                # больше месяца, а заказы покупателей всё это время стояли.
                #
                # Списываем вещь со склада и возвращаем заказ в цех: его сошьют заново.
                # Логика та же, что у брака, но причина другая — вещь не испорчена, её
                # физически нет, и это сигнал о расхождении остатков.
                item_id = body_data.get('id')
                note = (body_data.get('note') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Укажите id'})}

                # Право решать есть только у админа и старшего кладовщика: за списанием
                # стоят потраченная ткань и повторная работа цеха. Проверяем на СЕРВЕРЕ —
                # спрятать кнопку в интерфейсе мало, запрос можно послать и мимо неё.
                if not is_admin_or_senior(cur, actor_id):
                    return {
                        'statusCode': 403, 'headers': headers,
                        'body': json.dumps(
                            {'error': 'Списать ненайденный товар может только старший '
                                      'кладовщик или администратор'},
                            ensure_ascii=False),
                    }

                cur.execute(
                    "SELECT gw.status, gw.reserved_order_id, gw.storage_barcode, "
                    "       o.order_number, o.product, o.material, o.width, o.height, "
                    "       sh.name, gw.received_at "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    "WHERE gw.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers,
                            'body': json.dumps({'error': 'Запись не найдена'})}
                (nf_status, nf_reserved, nf_barcode, nf_order, nf_product,
                 nf_material, nf_width, nf_height, nf_shelf, nf_received) = row

                if nf_status in ('shipped', 'lost'):
                    return {'statusCode': 409, 'headers': headers,
                            'body': json.dumps({'error': 'Вещь уже отгружена или списана'},
                                               ensure_ascii=False)}
                if nf_status == 'reserved':
                    return {
                        'statusCode': 409, 'headers': headers,
                        'body': json.dumps(
                            {'error': 'Вещь лежит в собранной поставке — сначала уберите её оттуда'},
                            ensure_ascii=False),
                    }

                # Сколько дней вещь числилась на складе. Чем дольше — тем серьёзнее
                # расхождение: месячный «висяк» админ должен увидеть отдельно.
                cur.execute(
                    "SELECT GREATEST(0, (CURRENT_DATE - %s::date))", (nf_received,)
                )
                days_row = cur.fetchone()
                days_on_shelf = int(days_row[0]) if days_row and days_row[0] is not None else 0

                shelf_txt = f'полка «{nf_shelf}»' if nf_shelf else 'полка не указана'
                note_esc = (f'{note}. ' if note else '')
                lost_reason = (
                    f'Не найден на складе ({shelf_txt}, числился {days_on_shelf} дн.). '
                    f'{note_esc}Заказ отправлен в пошив'
                ).replace("'", "''")

                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'lost', reserved_order_id = NULL, "
                    f"matched_at = NULL, shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                    f"shipping_labeled_by_name = NULL, "
                    f"lost_reason = '{lost_reason}', lost_at = now() "
                    f"WHERE id = {int(item_id)}"
                )

                # Заказ покупателя не должен зависнуть: снимаем его с подбора и
                # возвращаем в цех — иначе он будет ждать вещь, которой нет.
                returned_order = None
                if nf_reserved:
                    cur.execute(
                        "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый', "
                        "assigned_user_id = NULL, workshop_id = NULL WHERE id = %s "
                        "RETURNING order_number, group_key",
                        (int(nf_reserved),),
                    )
                    ret = cur.fetchone()
                    returned_order = ret[0] if ret else None

                    # Заказ Яндекса едет одним ярлыком: раз одной вещи связки нет,
                    # остальные её части освобождаем обратно в свободный остаток,
                    # иначе они застрянут в подборе под заказ, который уехал в цех.
                    group_key = ret[1] if ret else None
                    if group_key:
                        cur.execute(
                            "UPDATE goods_warehouse gw SET reserved_order_id = NULL, "
                            "matched_at = NULL, status = 'in_stock' "
                            "FROM orders o "
                            "WHERE o.id = gw.reserved_order_id AND o.group_key = %s "
                            "  AND gw.status = 'picking' AND gw.id <> %s",
                            (group_key, int(item_id)),
                        )

                item_txt = ' '.join(str(x) for x in [
                    nf_material,
                    f'{nf_width}×{nf_height}' if nf_width and nf_height else None,
                ] if x) or (nf_product or nf_order or 'Товар')

                log_action(
                    cur, actor_id, actor_name, 'not_found', 'goods_warehouse', item_id,
                    f'Товар {nf_barcode} ({item_txt}) не найден на складе, {shelf_txt}, '
                    f'числился {days_on_shelf} дн. Списан со склада'
                    + (f'. Заказ {returned_order} вернулся в производство' if returned_order else ''),
                )

                # Ненайденный товар — сигнал о расхождении остатков: где-то вещь ушла
                # мимо системы. Админ должен увидеть это на панели сразу, потому что
                # каждый такой случай стоит ткани и повторной работы цеха.
                notify_admin(
                    cur, 'not_found',
                    'Товар не найден на складе',
                    f'{item_txt} ({nf_barcode}), {shelf_txt}, числился {days_on_shelf} дн. '
                    + (f'{note}. ' if note else '')
                    + (f'Заказ {returned_order} вернулся на конвейер' if returned_order
                       else 'Заказ за вещью не закреплён'),
                    actor_id, actor_name,
                    link=f'/crm/inventory/goods/{int(item_id)}',
                    entity_type='goods_warehouse', entity_id=item_id,
                )
                conn.commit()
                return {
                    'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'success': True, 'returnedOrder': returned_order},
                                       ensure_ascii=False),
                }

            if action == 'send_to_sewing':
                # Вещь с полки испорчена (порвана, пятно, брак) — отгружать её нельзя.
                # Списываем вещь со склада и возвращаем заказ в производство: его сошьют заново.
                # Если вещь была подобрана под заказ, заказ снимается с подбора и уходит в цех,
                # иначе он завис бы в ожидании стикеровки навсегда.
                item_id = body_data.get('id')
                reason = (body_data.get('reason') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                if not reason:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите причину — почему вещь нельзя отгрузить'}, ensure_ascii=False),
                    }

                cur.execute(
                    "SELECT gw.status, gw.reserved_order_id, gw.storage_barcode, o.order_number, o.product "
                    "FROM goods_warehouse gw LEFT JOIN orders o ON o.id = gw.order_id "
                    "WHERE gw.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                gw_status, reserved_order_id, gw_barcode, gw_order_number, gw_product = row
                if gw_status in ('shipped', 'lost'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Вещь уже отгружена или списана'}, ensure_ascii=False),
                    }
                if gw_status == 'reserved':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Вещь уже лежит в собранной поставке — сначала уберите её оттуда'},
                            ensure_ascii=False,
                        ),
                    }

                # Списываем испорченную вещь со склада.
                reason_esc = reason.replace("'", "''")
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'lost', reserved_order_id = NULL, "
                    f"matched_at = NULL, shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, "
                    f"lost_reason = 'Брак, отправлен в пошив: {reason_esc}', lost_at = now() "
                    f"WHERE id = {int(item_id)}"
                )

                # Заказ покупателя, который закрывался этой вещью, возвращаем в производство.
                returned_order = None
                if reserved_order_id:
                    cur.execute(
                        "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый', "
                        "assigned_user_id = NULL, workshop_id = NULL WHERE id = %s "
                        "RETURNING order_number, group_key",
                        (int(reserved_order_id),),
                    )
                    ret = cur.fetchone()
                    returned_order = ret[0] if ret else None

                    # Заказ Яндекса едет одним ярлыком: если одна вещь связки испорчена,
                    # шить надо всю связку заново, иначе половина уедет, половина нет.
                    group_key = ret[1] if ret else None
                    if group_key:
                        cur.execute(
                            "SELECT gw.id FROM goods_warehouse gw "
                            "JOIN orders o ON o.id = gw.reserved_order_id "
                            "WHERE o.group_key = %s AND gw.status = 'picking'",
                            (group_key,),
                        )
                        sibling_ids = [r[0] for r in cur.fetchall()]
                        for sib in sibling_ids:
                            # Соседние вещи не испорчены — просто возвращаем их на полку
                            # свободными, они пригодятся другим заказам.
                            cur.execute(
                                # Освободилась — снова свободный остаток на полке.
                                "UPDATE goods_warehouse SET reserved_order_id = NULL, "
                                "status = 'in_stock', matched_at = NULL, "
                                "shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL WHERE id = %s",
                                (sib,),
                            )
                        cur.execute(
                            "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый', "
                            "assigned_user_id = NULL, workshop_id = NULL "
                            "WHERE group_key = %s AND COALESCE(status, '') <> 'Отменён'",
                            (group_key,),
                        )

                log_action(
                    cur, actor_id, actor_name, 'send_to_sewing', 'goods_warehouse', item_id,
                    f'Вещь {gw_barcode} ({gw_product or gw_order_number}) списана как брак и '
                    f'отправлена в пошив: {reason}'
                    + (f'. Заказ {returned_order} вернулся в производство' if returned_order else ''),
                )
                # Списание готовой вещи — деньги и лишняя работа цеха. Админ должен
                # увидеть это на панели сразу, а не откопать в журнале через неделю.
                notify_admin(
                    cur, 'send_to_sewing',
                    'Кладовщик отправил товар на пошив',
                    f'{gw_product or gw_order_number or "Товар"} ({gw_barcode}). Причина: {reason}'
                    + (f'. Заказ {returned_order} вернулся на конвейер' if returned_order else ''),
                    actor_id, actor_name,
                    link=f'/crm/inventory/goods/{int(item_id)}',
                    entity_type='goods_warehouse', entity_id=item_id,
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps(
                        {'success': True, 'returnedOrder': returned_order},
                        ensure_ascii=False,
                    ),
                }

            if action == 'restore_lost':
                # «Нашёлся» — списанная вещь обнаружилась и физически цела.
                #
                # Списание не всегда означает утрату: вещь могли переложить на соседнюю
                # полку, унести на осмотр и не отметить, или кладовщик просто не нашёл её
                # в тот день. Раньше такая запись оставалась мёртвой навсегда — приходилось
                # заводить вещь заново с новым стикером, и история движения обрывалась.
                #
                # Возвращаем вещь на полку хранения свободным остатком. Заказ, который
                # когда-то за ней стоял, НЕ трогаем: он уже уехал в цех и, скорее всего,
                # сшит заново — вернув бронь, мы отправили бы покупателю вторую вещь.
                # Вместо этого вещь становится свободной, и автоподбор сам закроет ею
                # ближайший подходящий заказ.
                item_id = body_data.get('id')
                shelf_id = body_data.get('shelfId')
                note = (body_data.get('note') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Укажите id'})}

                # Возврат в оборот меняет остатки склада — это работа администратора.
                # Проверяем на сервере: спрятать кнопку в интерфейсе недостаточно.
                if not is_admin(cur, actor_id):
                    return {
                        'statusCode': 403, 'headers': headers,
                        'body': json.dumps(
                            {'error': 'Вернуть списанный товар на склад может только администратор'},
                            ensure_ascii=False),
                    }

                cur.execute(
                    "SELECT gw.status, gw.storage_barcode, gw.lost_reason, "
                    "       o.order_number, o.product, o.material, o.width, o.height "
                    "FROM goods_warehouse gw LEFT JOIN orders o ON o.id = gw.order_id "
                    "WHERE gw.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers,
                            'body': json.dumps({'error': 'Запись не найдена'})}
                (rl_status, rl_barcode, rl_lost_reason, rl_order,
                 rl_product, rl_material, rl_width, rl_height) = row

                if rl_status != 'lost':
                    return {
                        'statusCode': 409, 'headers': headers,
                        'body': json.dumps(
                            {'error': 'Вернуть на полку можно только списанный товар'},
                            ensure_ascii=False),
                    }

                # Полку выбирает админ. Если не указал — оставляем прежнюю: вещь часто
                # находится ровно там, где и числилась, просто её проглядели.
                shelf_name = None
                if shelf_id:
                    cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                    sh_row = cur.fetchone()
                    if not sh_row:
                        return {'statusCode': 404, 'headers': headers,
                                'body': json.dumps({'error': 'Полка не найдена'},
                                                   ensure_ascii=False)}
                    shelf_name = sh_row[0]
                    cur.execute(
                        "UPDATE goods_warehouse SET status = 'in_stock', shelf_id = %s, "
                        "lost_reason = NULL, lost_at = NULL, shipped_at = NULL, "
                        "reserved_order_id = NULL, matched_at = NULL, "
                        "shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                        "shipping_labeled_by_name = NULL "
                        "WHERE id = %s",
                        (int(shelf_id), int(item_id)),
                    )
                else:
                    cur.execute(
                        "UPDATE goods_warehouse SET status = 'in_stock', "
                        "lost_reason = NULL, lost_at = NULL, shipped_at = NULL, "
                        "reserved_order_id = NULL, matched_at = NULL, "
                        "shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                        "shipping_labeled_by_name = NULL "
                        "WHERE id = %s",
                        (int(item_id),),
                    )
                    cur.execute(
                        "SELECT s.name FROM goods_warehouse gw "
                        "LEFT JOIN shelves s ON s.id = gw.shelf_id WHERE gw.id = %s",
                        (int(item_id),),
                    )
                    sh_row = cur.fetchone()
                    shelf_name = sh_row[0] if sh_row else None

                item_txt = ' '.join(str(x) for x in [
                    rl_material,
                    f'{rl_width}×{rl_height}' if rl_width and rl_height else None,
                ] if x) or (rl_product or rl_order or 'Товар')

                log_action(
                    cur, actor_id, actor_name, 'restore_lost', 'goods_warehouse', item_id,
                    f'Товар {rl_barcode} ({item_txt}) НАШЁЛСЯ и возвращён на хранение'
                    + (f', полка «{shelf_name}»' if shelf_name else '')
                    + (f'. {note}' if note else '')
                    + (f'. Было списано: {rl_lost_reason}' if rl_lost_reason else ''),
                )
                conn.commit()

                # Вещь снова свободна — сразу пробуем закрыть ею подходящий заказ,
                # чтобы она не пролежала на полке до следующего пересчёта подбора.
                matched = 0
                try:
                    matched = len(try_match_orders_from_stock(cur) or [])
                    conn.commit()
                except Exception:
                    conn.rollback()

                return {
                    'statusCode': 200, 'headers': headers,
                    'body': json.dumps(
                        {'success': True, 'shelfName': shelf_name, 'matched': matched},
                        ensure_ascii=False),
                }

            if action == 'delete_goods':
                # Удаление записи со склада. Доступно ТОЛЬКО администратору.
                #
                # Разрешены два состояния:
                #  - 'in_stock' — вещь спокойно лежит на полке;
                #  - 'awaiting_shelf' — вещь забрали с производства, но на полку ещё не
                #    положили. Сюда попадают ошибочные приёмки и вещи, которых по факту
                #    нет: без удаления они висели вечно, кладовщик каждый раз шёл искать
                #    несуществующий товар, а счётчик «разложить по полкам» не обнулялся.
                #
                # Остальные состояния не трогаем: там вещь в работе (едет в поставку,
                # на проверке у упаковщицы), и удаление порвало бы связь с заказом.
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                if not is_admin(cur, actor_id):
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Удалять товар со склада может только администратор'}, ensure_ascii=False),
                    }
                cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[0] not in ('in_stock', 'awaiting_shelf'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Удалить можно только товар на хранении или на разборе с производства'},
                            ensure_ascii=False,
                        ),
                    }
                cur.execute(
                    "SELECT 1 FROM marketplace_supply_items WHERE goods_warehouse_id = %s LIMIT 1",
                    (int(item_id),),
                )
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Товар добавлен в поставку — сначала уберите его оттуда'}, ensure_ascii=False),
                    }
                # Вещь уже подобрана под заказ покупателя — удалять нельзя: заказ
                # останется без товара, и на сборке кладовщик упрётся в пустоту.
                cur.execute(
                    "SELECT reserved_order_id FROM goods_warehouse WHERE id = %s", (int(item_id),)
                )
                reserved_row = cur.fetchone()
                if reserved_row and reserved_row[0]:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Вещь подобрана под заказ — сначала снимите её с заказа'},
                            ensure_ascii=False,
                        ),
                    }
                # Заказ, который ЗАКРЫЛИ этой вещью, тоже держит на неё ссылку
                # (fulfilled_from_stock_id). Раньше её не проверяли: после удаления вещи
                # заказ оставался в статусе «Со склада» и ждал товар, которого больше нет
                # — в цех он не возвращался, кладовщику подбирать было нечего, а на
                # терминале упаковщица упиралась в тупик. Так зависли 40 заказов.
                #
                # Теперь незакрытый заказ сначала возвращаем в производство, и только
                # потом отпускаем вещь. Для уже отгруженных заказов просто снимаем
                # ссылку: возвращать в цех нечего, товар уехал.
                cur.execute(
                    "SELECT id, order_number, status FROM orders "
                    "WHERE fulfilled_from_stock_id = %s",
                    (int(item_id),),
                )
                linked = cur.fetchall()
                for lnk_id, lnk_number, lnk_status in linked:
                    if (lnk_status or '') in ('Отгружен', 'Доставлен', 'Отменён'):
                        cur.execute(
                            "UPDATE orders SET fulfilled_from_stock_id = NULL WHERE id = %s",
                            (int(lnk_id),),
                        )
                    else:
                        cur.execute(
                            "UPDATE orders SET fulfilled_from_stock_id = NULL, "
                            "sewing_status = 'Новый' WHERE id = %s",
                            (int(lnk_id),),
                        )
                        log_action(
                            cur, actor_id, actor_name, 'return_to_sewing', 'orders', int(lnk_id),
                            f'Заказ #{lnk_number} вернулся в производство: вещь со склада '
                            f'#{int(item_id)} удалена',
                        )
                # В журнале сохраняем стикер и состояние: по одному номеру записи потом
                # не понять, что за вещь исчезла со склада и откуда её удалили.
                cur.execute(
                    "SELECT gw.storage_barcode, o.order_number FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id WHERE gw.id = %s",
                    (int(item_id),),
                )
                info = cur.fetchone()
                where = 'с разбора с производства' if row[0] == 'awaiting_shelf' else 'со склада'
                details = ', '.join(
                    part for part in (
                        f'стикер {info[0]}' if info and info[0] else '',
                        f'заказ {info[1]}' if info and info[1] else '',
                    ) if part
                )
                log_action(
                    cur, actor_id, actor_name, 'delete_goods', 'goods_warehouse', item_id,
                    f'Удалил товар #{item_id} {where}' + (f' ({details})' if details else ''),
                )
                cur.execute("DELETE FROM goods_warehouse WHERE id = %s", (int(item_id),))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'mark_lost':
                item_id = body_data.get('id')
                reason = (body_data.get('reason') or '').strip()
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
                if row[0] in ('shipped', 'lost'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар уже отгружен или помечен утерянным'})}
                reason_esc = reason.replace("'", "''")
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'lost', lost_reason = '{reason_esc}', lost_at = now() "
                    f"WHERE id = {int(item_id)}"
                )
                log_action(cur, actor_id, actor_name, 'mark_lost', 'goods_warehouse', item_id, f'Отметил товар #{item_id} утерянным: {reason}')
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}