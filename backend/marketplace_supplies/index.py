import base64
import json
import os
import uuid
from datetime import datetime

import boto3
import psycopg2


VALID_STATUSES = ['Открытая', 'На сборке', 'Отгрузка', 'Выполнена']

# Черновые (незавершённые) этапы пошива — заказ ещё "в работе" на производстве.
IN_PROGRESS_SEWING_STATUSES = ('На раскрое', 'Раскроено', 'В работе', 'Стикеровка')


def upload_pass_sticker(base64_data: str, file_name: str) -> str:
    """Загружает PDF стикера пропуска (WB) в S3, возвращает публичный CDN URL."""
    _, _, data = base64_data.partition(',')
    binary = base64.b64decode(data)

    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    safe_name = ''.join(c for c in (file_name or 'sticker.pdf') if c.isalnum() or c in ('.', '_', '-')) or 'sticker.pdf'
    key = f'pass-stickers/{uuid.uuid4().hex}-{safe_name}'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType='application/pdf')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def compute_order_status(sewing_status: str, box_number) -> str:
    """Мапит производственный статус заказа + принадлежность к коробу в статус для дропдауна:
    Новый / В работе / На поставку / В коробе №N."""
    if box_number:
        return f'В коробе №{box_number}'
    if sewing_status == 'Готовые':
        return 'На поставку'
    if sewing_status in IN_PROGRESS_SEWING_STATUSES:
        return 'В работе'
    return 'Новый'




def deny_manager_fbs(cur, supply_id=None, supply_type=None, actor_role=None):
    """Проверяет, что менеджер не правит FBS-поставку.

    FBS-поставку собирает кладовщик: он сканирует товары со своих полок на складе. Менеджер
    такую поставку только НАБЛЮДАЕТ в реальном времени — иначе состав поставки можно менять
    из-за стола, пока кладовщик физически собирает другой набор вещей, и данные разъедутся
    с реальностью. FBO-поставки менеджера это не касается — там состав ведёт именно он.

    Возвращает текст ошибки или None, если действие разрешено.
    """
    if (actor_role or '') != 'manager':
        return None
    if supply_type is None and supply_id:
        cur.execute("SELECT type FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
        row = cur.fetchone()
        supply_type = row[0] if row else None
    if supply_type == 'FBS':
        return ('FBS-поставку собирает кладовщик — вам доступен только просмотр '
                'хода сборки в реальном времени')
    return None




def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description):
    """Запись в журнал действий — чтобы было видно, кто и что делал с поставкой."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'supply',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
        ),
    )


# Сколько поставка остаётся «занятой» без обновления от кладовщика.
# Страница шлёт сигнал «я здесь» каждую минуту; 5 минут тишины — значит человек
# закрыл вкладку, ушёл со смены или у него сел планшет. После этого поставку
# может взять другой, иначе она осталась бы заблокированной навсегда.
SUPPLY_LOCK_TTL_MINUTES = 5


def release_stale_supply_locks(cur):
    """Снимает блокировки, по которым давно нет признаков жизни."""
    cur.execute(
        "UPDATE marketplace_supplies SET locked_by = NULL, locked_at = NULL "
        f"WHERE locked_by IS NOT NULL AND locked_at < now() - interval '{SUPPLY_LOCK_TTL_MINUTES} minutes'"
    )


def get_supply_lock(cur, supply_id):
    """Кто сейчас занимает поставку: (id сотрудника, имя) или (None, None)."""
    cur.execute(
        "SELECT s.locked_by, u.full_name FROM marketplace_supplies s "
        "LEFT JOIN users u ON u.id = s.locked_by WHERE s.id = %s",
        (int(supply_id),),
    )
    r = cur.fetchone()
    return (r[0], r[1]) if r else (None, None)


def deny_if_locked_by_other(cur, supply_id, actor_id):
    """Текст ошибки, если поставку собирает другой сотрудник, иначе None.

    Проверяем на КАЖДОМ действии сборки, а не только при входе: без этого двое
    кладовщиков, открывших страницу одновременно, продолжали бы раскладывать
    заказы по чужим коробам.
    """
    if not actor_id:
        return None
    release_stale_supply_locks(cur)
    locked_by, locked_name = get_supply_lock(cur, supply_id)
    if locked_by and int(locked_by) != int(actor_id):
        return f'Поставку уже собирает {locked_name or "другой сотрудник"}'
    return None


def find_cancelled_items(cur, supply_id):
    """Товары поставки, чьи заказы отменены маркетплейсом.

    Заказ могут отменить в любой момент — в том числе когда вещь уже сшита, застикерована
    и лежит в собранной поставке. Отгружать её нельзя: на маркетплейсе заказа больше нет.
    Такая вещь должна уехать на полку хранения и ждать нового покупателя, а поставку с ней
    внутри закрывать запрещено.

    Возвращает список словарей: id позиции, штрихкод хранения, номер заказа, связка.
    """
    cur.execute(
        "SELECT msi.id, gw.storage_barcode, o.order_number, o.group_key "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "JOIN orders o ON o.id = gw.order_id "
        "WHERE msi.supply_id = %s AND ("
        "  o.status = 'Отменён' "
        "  OR lower(coalesce(o.ozon_status, '')) LIKE '%%cancel%%' "
        "  OR lower(coalesce(o.ym_status, '')) LIKE '%%cancel%%')",
        (int(supply_id),),
    )
    direct = [
        {'itemId': r[0], 'storageBarcode': r[1], 'orderNumber': r[2], 'groupKey': r[3],
         'reason': 'cancelled'}
        for r in cur.fetchall()
    ]

    # Связка Яндекса едет по ОДНОМУ общему ярлыку. Если отменили хотя бы одну вещь заказа,
    # отправлять остаток нельзя — покупателю уедет неполная посылка по ярлыку на весь заказ.
    # Поэтому на полку уходит вся связка целиком, а не только отменённая вещь.
    broken_keys = {c['groupKey'] for c in direct if c['groupKey']}
    if not broken_keys:
        return direct

    keys_csv = ','.join("'" + k.replace("'", "''") + "'" for k in broken_keys)
    cur.execute(
        "SELECT msi.id, gw.storage_barcode, o.order_number, o.group_key "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "JOIN orders o ON o.id = gw.order_id "
        f"WHERE msi.supply_id = %s AND o.group_key IN ({keys_csv})",
        (int(supply_id),),
    )
    known = {c['itemId'] for c in direct}
    for r in cur.fetchall():
        if r[0] not in known:
            direct.append({
                'itemId': r[0], 'storageBarcode': r[1], 'orderNumber': r[2],
                'groupKey': r[3],
                # Сама вещь не отменена — но её заказ уже неполный, ехать ей некуда.
                'reason': 'broken_group',
            })
    return direct


def check_fbo_underfilled(cur, supply_id):
    """Проверяет, собрана ли поставка FBO полностью.

    В заявке на маркетплейс указано, сколько единиц мы обещали привезти. Если отгрузить
    меньше, маркетплейс засчитает недовоз: заявка закроется частично, а остаток товара
    зависнет на складе до следующей поставки. Поэтому недособранную поставку не отдаём.

    Возвращает (собрано, план) — или None, если план не указан и проверять нечего.
    """
    cur.execute(
        "SELECT type, total_quantity_marketplace FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    row = cur.fetchone()
    if not row:
        return None
    supply_type, planned = row
    # Проверка только для FBO: в FBS каждая вещь едет по своему ярлыку, и отгрузить
    # часть отправлений — нормальная ситуация.
    if supply_type != 'FBO' or not planned:
        return None

    cur.execute(
        "SELECT COUNT(*) FROM marketplace_supply_items WHERE supply_id = %s",
        (int(supply_id),),
    )
    collected = int(cur.fetchone()[0])
    if collected >= int(planned):
        return None
    return collected, int(planned)


def check_incomplete_groups(cur, supply_id):
    """Ищет в поставке заказы Яндекса, собранные не полностью.

    На заказ покупателя из нескольких вещей Яндекс выдаёт ОДИН ярлык. Если отгрузить часть
    такого заказа, вторая половина останется на складе, а покупатель получит неполную
    посылку — маркетплейс засчитает это как недовоз. Поэтому заказ едет только целиком.

    Возвращает список словарей с ключами groupKey, inSupply, total.
    """
    cur.execute(
        "SELECT o.group_key, count(*) AS in_supply, max(o.group_size) AS total "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "JOIN orders o ON o.id = gw.order_id "
        "WHERE msi.supply_id = %s AND o.group_key IS NOT NULL "
        "GROUP BY o.group_key HAVING count(*) < max(o.group_size)",
        (int(supply_id),),
    )
    return [
        {'groupKey': r[0], 'inSupply': int(r[1]), 'total': int(r[2] or 0)}
        for r in cur.fetchall()
    ]


def handler(event: dict, context) -> dict:
    """Поставки готового товара на маркетплейс (полный цикл, как на физическом складе):

    Жизненный цикл поставки:
      Открытая -> На сборке -> Отгрузка (в Газельку) -> Выполнена (принято маркетплейсом)

    Товар берётся со склада готового товара (goods_warehouse, статус in_stock).
    При добавлении в поставку товар резервируется (status='reserved'), при переводе
    поставки в статус "Отгрузка" — считается отгруженным (status='shipped').

    Для FBO поставок сборка идёт через короба: кладовщик создаёт короб кнопкой
    "Добавить короб", затем добавляет в него заказы (готовый товар резервируется и
    привязывается к конкретному коробу). Каждый короб получает свой номер и штрихкод.

    GET  /                       - список поставок, фильтры: ?status=, ?type=FBO|FBS,
                                     ?marketplace=OZON|WB|Yandex, ?date_from=, ?date_to=, ?search=
    GET  /?id=1                  - детальная карточка поставки с товарами и коробами
    GET  /?id=1&candidates=1     - список заказов, которые должны быть в этой FBO поставке
                                     (тот же маркетплейс, тип FBO, тот же кластер что и у
                                     поставки), с их статусом движения по производству:
                                     Новый / В работе / На поставку / В коробе №N

    POST /  { action: 'create', marketplace, type, comment?, createdBy?, ozonDeliveryMethod? }
        - создаёт пустую поставку в статусе "Открытая" (без товаров).
          Для OZON FBO обязателен ozonDeliveryMethod: 'direct' (прямая поставка) или
          'cross_docking' (кросс-докинг) — без него создание отклоняется (400).
          У такой поставки автоматически ozon_status = 'Заполнение данных'
        - добавляет товары со склада в поставку, резервирует их (status='reserved')
        - используется для FBS (выбор товаров чекбоксами из списка)
    POST /  { action: 'scan_order', supplyId, orderNumber }
        - добавляет товар в поставку по ШТРИХКОДУ ХРАНЕНИЯ (параметр orderNumber по факту
          принимает storage_barcode из goods_warehouse — оставлено для совместимости фронтенда);
          используется для FBS: кладовщик заранее отбирает нужные товары на складе (раздел
          "Товар к подбору", action 'start_picking', статус picking), а здесь сканирует стикер
          хранения каждого отобранного товара, чтобы добавить его в конкретную поставку и
          перевести статус picking -> reserved
    POST /  { action: 'cancelled_to_shelf', itemId, shelfId }
        - отменённый заказ убирается из поставки на полку хранения (status='in_stock').
          Для связки Яндекса на полку уходит ВСЯ связка — ярлык на неё общий, неполный
          заказ отгружать нельзя
    POST /  { action: 'remove_item', itemId }
        - убирает товар из поставки, возвращает его на склад в статус 'picking' (он остаётся
          отобранным, но не привязанным к этой поставке)
    POST /  { action: 'create_box', supplyId }
        - создаёт новый короб в поставке (следующий по счёту номер), генерирует штрихкод
    POST /  { action: 'delete_box', boxId }
        - удаляет короб (разрешено только если в нём нет товаров)
    POST /  { action: 'add_order_to_box', boxId, orderNumber }
        - кладёт товар в конкретный короб поставки. В orderNumber передаётся ШТРИХКОД
          ХРАНЕНИЯ (GW-XXXXXX) — параметр назван так для обратной совместимости фронтенда.
          Только сканирование: номер заказа маркетплейса руками не вводится, поэтому в
          поставку не попадёт вещь, которую кладовщик физически не держал в руках
    POST /  { action: 'remove_box_item', itemId }
        - убирает товар из короба и из поставки, возвращает его на склад (status='in_stock')
    POST /  { action: 'update', supplyId, supplyNumber?, supplyBarcode?, cluster?,
               gazelkaId?, comment?, shipToGazelkaAt?, shipToMarketplaceAt?,
               totalQuantityMarketplace?, passStickerBase64?, passStickerName?,
               ozonApplicationNumber?, ozonStatus?, supplyDate?, timeslot?,
               shipmentType?, packagingType?, packagingCount?, gazelkaPickup? }
        - обновляет служебные поля поставки (номер, штрихкод, кластер, id Газельки, даты,
          общее кол-во товаров с маркетплейса, PDF стикера пропуска для WB).
          Для OZON FBO дополнительно: номер заявки OZON, статус на стороне OZON
          (Заполнение данных/Сформирована), дата поставки/таймслот, тип отгрузки,
          тип упаковки (короба/палеты) и их количество, забор Газелькой (да/нет)
    POST /  { action: 'move_status', supplyId, status }
        - переводит поставку на следующий статус жизненного цикла:
          "На сборке" — просто меняет статус;
          "Отгрузка" — фиксирует ship_to_gazelka_at и переводит все товары в 'shipped';
          "Выполнена" — фиксирует completed_at (и ship_to_marketplace_at, если не указана).
          При переходе в "На сборке"/"Отгрузка": если создатель поставки (created_by) —
          кладовщик с открытой сменой, начисляет ему оклад за смену (salary_accruals,
          type='storekeeper_shift'). Ставка (salary_rates) берётся по фактической роли
          сотрудника — 'storekeeper' или 'senior_storekeeper' — из
          тарифов цеха этой смены (workshop_id смены), либо из цеха профиля кладовщика, если
          у смены цех не указан. Не больше одного начисления на одну смену (shift_session_id)
    POST /  { action: 'force_complete', supplyId, confirmIncomplete? }
        - принудительное закрытие поставки в системе из любого статуса (кроме уже
          "Выполнена"): используется, если реальная поставка зависла на любом этапе
          из-за задержек API маркетплейса. Все товары переводятся в 'shipped',
          фиксируются все даты этапов, поставка сразу переходит в "Выполнена"
    POST /  { action: 'delete', id }
        - удаляет поставку (разрешено только для статуса "Открытая", товары возвращаются на склад)
    POST /  { action: 'lock_supply', supplyId, actorId }
        - занимает поставку под сборку: пока её собирает один кладовщик, второй не может
          менять её состав. Кто зашёл первым — тот и собирает. Страница повторяет запрос
          раз в минуту, продлевая блокировку; после 5 минут тишины (закрыли вкладку,
          разрядился планшет) поставка освобождается сама. Если занята другим — 409
    POST /  { action: 'unlock_supply', supplyId, actorId }
        - освобождает поставку при уходе со страницы сборки. Снять блокировку может
          только тот, кто её поставил

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/детальными данными/результатом операции
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
        supply_id = params.get('id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Сводка отгрузок FBO для дашборда: что собирается, что уехало в газельку,
            # что сдано на воротах маркетплейса. Кладовщик по ней видит, не забыл ли
            # отметить отгрузку — машина уехала, а в системе поставка висит на сборке.
            if params.get('fbo_board'):
                cur.execute(
                    "SELECT s.id, s.supply_number, s.marketplace, s.cluster, s.status, "
                    "s.ship_to_gazelka_at, s.ship_to_marketplace_at, s.gazelka_pickup, "
                    "s.supply_date, s.timeslot, s.completed_at, "
                    "(SELECT COUNT(*) FROM marketplace_supply_items msi WHERE msi.supply_id = s.id), "
                    "s.gazelka_shipped_at "
                    "FROM marketplace_supplies s "
                    "WHERE s.type = 'FBO' AND s.status <> 'Выполнена' "
                    "ORDER BY COALESCE(s.ship_to_gazelka_at, s.supply_date::timestamp) NULLS LAST, s.id DESC "
                    "LIMIT 50"
                )
                items = []
                for r in cur.fetchall():
                    ship_gazelka = r[5]
                    shipped_fact = r[12]
                    # Плановое время отгрузки прошло, а факта нет — кладовщик, скорее
                    # всего, забыл отметить. Спрашиваем прямо.
                    needs_confirm = bool(
                        ship_gazelka
                        and not shipped_fact
                        and ship_gazelka <= datetime.now()
                        and r[4] in ('Открытая', 'На сборке', 'Отгрузка')
                    )
                    items.append({
                        'id': r[0],
                        'supplyNumber': r[1],
                        'marketplace': r[2],
                        'cluster': r[3],
                        'status': r[4],
                        # План отгрузки и факт — разные вещи: план мог сдвинуться.
                        'shipToGazelkaAt': (ship_gazelka.isoformat() + 'Z') if ship_gazelka else None,
                        'gazelkaShippedAt': (shipped_fact.isoformat() + 'Z') if shipped_fact else None,
                        'shipToMarketplaceAt': (r[6].isoformat() + 'Z') if r[6] else None,
                        # Забирает газелька с нашего склада или везём до склада сами.
                        'gazelkaPickup': bool(r[7]),
                        'supplyDate': r[8].isoformat() if r[8] else None,
                        'timeslot': r[9],
                        'completedAt': (r[10].isoformat() + 'Z') if r[10] else None,
                        'ordersCount': r[11],
                        'needsShipConfirm': needs_confirm,
                    })
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'items': items}, ensure_ascii=False),
                }

            if supply_id and params.get('candidates'):
                cur.execute(
                    "SELECT marketplace, type, cluster FROM marketplace_supplies WHERE id = %s",
                    (int(supply_id),),
                )
                srow = cur.fetchone()
                if not srow:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                marketplace, supply_type, cluster = srow
                if supply_type != 'FBO':
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Список кандидатов доступен только для FBO'})}

                marketplace_esc = marketplace.replace("'", "''")
                cluster_cond = ""
                if cluster:
                    cluster_esc = cluster.replace("'", "''")
                    cluster_cond = f"AND o.cluster = '{cluster_esc}'"

                cur.execute(
                    f"SELECT o.id, o.order_number, o.product, o.sewing_status, "
                    f"msi.id, mb.box_number "
                    f"FROM orders o "
                    f"LEFT JOIN goods_warehouse gw ON gw.order_id = o.id "
                    f"LEFT JOIN marketplace_supply_items msi ON msi.goods_warehouse_id = gw.id AND msi.supply_id = {int(supply_id)} "
                    f"LEFT JOIN marketplace_supply_boxes mb ON mb.id = msi.box_id "
                    f"WHERE o.marketplace = '{marketplace_esc}' AND o.order_type = 'FBO' {cluster_cond} "
                    f"ORDER BY o.created_at DESC"
                )
                candidates = [
                    {
                        'orderId': r[0],
                        'orderNumber': r[1],
                        'product': r[2],
                        'sewingStatus': r[3],
                        'supplyItemId': r[4],
                        'boxNumber': r[5],
                        'status': compute_order_status(r[3], r[5]),
                    }
                    for r in cur.fetchall()
                ]
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'candidates': candidates})}

            if supply_id:
                # Снимаем блокировки, по которым давно нет активности, чтобы поставка
                # не осталась «занятой» после закрытой вкладки.
                release_stale_supply_locks(cur)
                conn.commit()
                cur.execute(
                    "SELECT s.id, s.marketplace, s.type, s.status, s.comment, s.created_at, "
                    "s.supply_number, s.supply_barcode, s.cluster, s.gazelka_id, "
                    "s.ship_to_gazelka_at, s.ship_to_marketplace_at, s.completed_at, "
                    "s.created_by, u.full_name, s.total_quantity_marketplace, "
                    "s.pass_sticker_url, s.pass_sticker_name, "
                    "s.ozon_delivery_method, s.ozon_application_number, s.ozon_status, "
                    "s.supply_date, s.timeslot, s.shipment_type, s.packaging_type, "
                    "s.packaging_count, s.gazelka_pickup, s.ozon_supply_order_id, s.ozon_cargo_type, "
                    "s.gazelka_plan_id, s.gazelka_ids, s.gazelka_idm, "
                    "s.locked_by, lu.full_name, s.locked_at "
                    "FROM marketplace_supplies s "
                    "LEFT JOIN users u ON u.id = s.created_by "
                    "LEFT JOIN users lu ON lu.id = s.locked_by "
                    "WHERE s.id = %s",
                    (int(supply_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}

                cur.execute(
                    "SELECT msi.id, msi.goods_warehouse_id, o.order_number, o.product, o.material, o.width, o.height, "
                    "gw.status, gw.shipped_at, msi.box_id, o.group_key, o.group_size, o.group_position, "
                    "o.status, o.ozon_status, o.ym_status, gw.storage_barcode, gw.shelf_id "
                    "FROM marketplace_supply_items msi "
                    "LEFT JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    "WHERE msi.supply_id = %s ORDER BY msi.id",
                    (int(supply_id),),
                )
                items = [
                    {
                        'id': r[0],
                        'goodsWarehouseId': r[1],
                        'orderNumber': r[2],
                        'product': r[3],
                        'material': r[4],
                        'width': r[5],
                        'height': r[6],
                        'goodsStatus': r[7],
                        'shippedAt': (r[8].isoformat() + 'Z') if r[8] else None,
                        'boxId': r[9],
                        # Заказ покупателя из нескольких вещей (Яндекс) — ярлык на них общий.
                        'groupKey': r[10],
                        'groupSize': r[11],
                        'groupPosition': r[12],
                        # Заказ могли отменить уже после стикеровки, когда вещь физически
                        # готова и лежит в поставке. Такую вещь отгружать НЕЛЬЗЯ — она должна
                        # уехать на полку хранения, а поставка не должна закрыться с ней внутри.
                        'isCancelled': (
                            r[13] == 'Отменён'
                            or 'cancel' in (r[14] or '').lower()
                            or 'cancel' in (r[15] or '').lower()
                        ),
                        'storageBarcode': r[16],
                        'shelfId': r[17],
                    }
                    for r in cur.fetchall()
                ]

                # Сводка по связкам: какие заказы с общим ярлыком собраны полностью, а каким
                # ещё не хватает вещей. Кладовщик должен видеть это прямо во время сборки, а не
                # упереться в блокировку при отгрузке.
                cur.execute(
                    "SELECT o.group_key, max(o.group_size) AS total, "
                    "count(DISTINCT msi.id) FILTER (WHERE msi.supply_id = %s) AS in_supply, "
                    "string_agg(DISTINCT o.order_number, ', ') AS numbers "
                    "FROM orders o "
                    "LEFT JOIN goods_warehouse gw ON gw.order_id = o.id "
                    "LEFT JOIN marketplace_supply_items msi ON msi.goods_warehouse_id = gw.id "
                    "WHERE o.group_key IS NOT NULL AND o.group_key IN ("
                    "  SELECT o2.group_key FROM marketplace_supply_items m2 "
                    "  JOIN goods_warehouse g2 ON g2.id = m2.goods_warehouse_id "
                    "  JOIN orders o2 ON o2.id = g2.order_id "
                    "  WHERE m2.supply_id = %s AND o2.group_key IS NOT NULL) "
                    "GROUP BY o.group_key ORDER BY o.group_key",
                    (int(supply_id), int(supply_id)),
                )
                groups = [
                    {
                        'groupKey': r[0],
                        'total': int(r[1] or 0),
                        'inSupply': int(r[2] or 0),
                        'isComplete': int(r[2] or 0) >= int(r[1] or 0),
                        'orderNumbers': r[3],
                    }
                    for r in cur.fetchall()
                ]

                # Заказы на пошив по этой поставке: менеджеру нужно видеть, что уже сшито,
                # а что ещё в работе, и догружать недостающее прямо из карточки поставки.
                cur.execute(
                    "SELECT o.id, o.order_number, o.product, o.material, o.width, o.height, "
                    "o.sewing_status, o.status, o.source, o.marketplace_item_id "
                    "FROM orders o WHERE o.supply_id = %s ORDER BY o.id",
                    (int(supply_id),),
                )
                sewing_orders = [
                    {
                        'id': r[0],
                        'orderNumber': r[1],
                        'product': r[2],
                        'material': r[3],
                        'width': r[4],
                        'height': r[5],
                        'sewingStatus': r[6],
                        'isCancelled': r[7] == 'Отменён',
                        'source': r[8],
                        'marketplaceItemId': r[9],
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT id, box_number, barcode, created_at, ozon_cargo_id, closed_at, "
                    "sticker_url, sticker_name FROM marketplace_supply_boxes "
                    "WHERE supply_id = %s ORDER BY box_number",
                    (int(supply_id),),
                )
                boxes = [
                    {
                        'id': r[0],
                        'boxNumber': r[1],
                        'barcode': r[2],
                        'createdAt': r[3].isoformat() + 'Z',
                        'ozonCargoId': r[4],
                        'closedAt': (r[5].isoformat() + 'Z') if r[5] else None,
                        'stickerUrl': r[6],
                        'stickerName': r[7],
                        'items': [it for it in items if it['boxId'] == r[0]],
                    }
                    for r in cur.fetchall()
                ]

                cur.execute("SELECT id, name FROM shelves ORDER BY name")
                shelves = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]

                # WB FBS-специфичные данные: id поставки на WB, отсканированные готовые
                # заказы WB (со стикерами коробов), и счётчик готовых кандидатов на складе
                # производства (готовые WB FBS-заказы, ещё не в поставке).
                cur.execute("SELECT wb_supply_id FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                wb_supply_id = (cur.fetchone() or [None])[0]

                wb_orders = []
                wb_ready_count = 0
                if row[1] == 'WB' and row[2] == 'FBS':
                    cur.execute(
                        "SELECT wso.id, wso.order_id, o.order_number, o.product, "
                        "wso.wb_trbx_id, wso.sticker_url, wso.sticker_name, wso.scanned_at, "
                        "COALESCE(o.status, '') "
                        "FROM wb_supply_orders wso JOIN orders o ON o.id = wso.order_id "
                        "WHERE wso.supply_id = %s ORDER BY wso.scanned_at",
                        (int(supply_id),),
                    )
                    wb_orders = [
                        {
                            'id': r[0],
                            'orderId': r[1],
                            'orderNumber': r[2],
                            'product': r[3],
                            'wbTrbxId': r[4],
                            'stickerUrl': r[5],
                            'stickerName': r[6],
                            'scannedAt': (r[7].isoformat() + 'Z') if r[7] else None,
                            # Покупатель отказался, пока вещь шла в короб: везти её
                            # нельзя — кладовщик убирает её из поставки на полку.
                            'isCancelled': r[8] == 'Отменён',
                        }
                        for r in cur.fetchall()
                    ]
                    # Готово к сборке: вещи, которые упаковщица уже отстикеровала — они
                    # лежат в контейнере на производстве и ждут, когда кладовщик их
                    # отсканирует в свою поставку. Это и есть накопительный буфер.
                    cur.execute(
                        "SELECT COUNT(*) FROM wb_supply_orders wso "
                        "JOIN marketplace_supplies acc ON acc.id = wso.supply_id "
                        "WHERE acc.is_accumulator = true "
                        "AND acc.status IN ('Открытая', 'На сборке')"
                    )
                    wb_ready_count = cur.fetchone()[0]

                detail = {
                    'id': row[0],
                    'marketplace': row[1],
                    'type': row[2],
                    'status': row[3],
                    'comment': row[4],
                    'createdAt': row[5].isoformat() + 'Z',
                    'supplyNumber': row[6],
                    'supplyBarcode': row[7],
                    'cluster': row[8],
                    'gazelkaId': row[9],
                    'shipToGazelkaAt': (row[10].isoformat() + 'Z') if row[10] else None,
                    'shipToMarketplaceAt': (row[11].isoformat() + 'Z') if row[11] else None,
                    'completedAt': (row[12].isoformat() + 'Z') if row[12] else None,
                    'createdBy': row[13],
                    'createdByName': row[14],
                    'totalQuantityMarketplace': row[15],
                    'passStickerUrl': row[16],
                    'passStickerName': row[17],
                    'ozonDeliveryMethod': row[18],
                    'ozonApplicationNumber': row[19],
                    'ozonStatus': row[20],
                    'supplyDate': row[21].isoformat() if row[21] else None,
                    'timeslot': row[22],
                    'shipmentType': row[23],
                    'packagingType': row[24],
                    'packagingCount': row[25],
                    'gazelkaPickup': row[26],
                    'items': items,
                    'groups': groups,
                    # Заказы на пошив по поставке: сколько сшито, сколько ещё в работе.
                    'sewingOrders': sewing_orders,
                    # Полки склада — чтобы кладовщик мог отправить отменённый заказ на
                    # хранение прямо из строки поставки, не уходя в другой раздел.
                    'shelves': shelves,
                    'boxes': boxes,
                    'wbSupplyId': wb_supply_id,
                    'wbOrders': wb_orders,
                    'wbReadyCount': wb_ready_count,
                    'ozonSupplyOrderId': row[27],
                    'ozonCargoType': row[28],
                    'gazelkaPlanId': row[29],
                    'gazelkaIds': row[30],
                    'gazelkaIdm': row[31],
                    # Кто сейчас собирает поставку: фронт по этим полям решает,
                    # показать рабочий экран или предупреждение «занято».
                    'lockedBy': row[32],
                    'lockedByName': row[33],
                    'lockedAt': (row[34].isoformat() + 'Z') if row[34] else None,
                }
                # Реквизиты клиента для упаковочного листа Газельки — общие настройки.
                cur.execute(
                    "SELECT key, value FROM system_settings WHERE key IN ('gazelka_client_name', 'gazelka_client_phone')"
                )
                gz_settings = {r[0]: r[1] for r in cur.fetchall()}
                detail['gazelkaClientName'] = gz_settings.get('gazelka_client_name') or ''
                detail['gazelkaClientPhone'] = gz_settings.get('gazelka_client_phone') or ''
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'supply': detail})}

            status_filter = params.get('status')
            type_filter = params.get('type')
            marketplace_filter = params.get('marketplace')
            date_from = params.get('date_from')
            date_to = params.get('date_to')
            search = params.get('search')

            # Снимаем протухшие блокировки перед показом списка: иначе поставка,
            # оставленная в закрытой вкладке, вечно числилась бы занятой.
            release_stale_supply_locks(cur)
            conn.commit()

            # Накопительная поставка — служебный буфер, куда падают вещи при стикеровке.
            # В списке поставок её быть не должно: кладовщик работает только со своими
            # сборками, а буфер он видит счётчиком «готово к сборке».
            conditions = ["COALESCE(s.is_accumulator, false) = false"]
            if status_filter:
                status_esc = status_filter.replace("'", "''")
                conditions.append(f"s.status = '{status_esc}'")
            if type_filter:
                type_esc = type_filter.replace("'", "''")
                conditions.append(f"s.type = '{type_esc}'")
            if marketplace_filter:
                mp_esc = marketplace_filter.replace("'", "''")
                conditions.append(f"s.marketplace = '{mp_esc}'")
            if date_from:
                date_from_esc = date_from.replace("'", "''")
                conditions.append(f"s.created_at >= '{date_from_esc}'::date")
            if date_to:
                date_to_esc = date_to.replace("'", "''")
                conditions.append(f"s.created_at < '{date_to_esc}'::date + interval '1 day'")
            if search:
                search_esc = search.replace("'", "''")
                conditions.append(
                    f"(s.supply_number ILIKE '%{search_esc}%' OR s.supply_barcode ILIKE '%{search_esc}%' OR s.id::text = '{search_esc}')"
                )
            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"SELECT s.id, s.marketplace, s.type, s.status, s.comment, s.created_at, "
                f"s.supply_number, s.supply_barcode, s.cluster, s.gazelka_id, "
                f"s.ship_to_gazelka_at, s.ship_to_marketplace_at, s.completed_at, "
                f"(SELECT COUNT(*) FROM marketplace_supply_items msi WHERE msi.supply_id = s.id), "
                f"u.full_name, s.ozon_delivery_method, s.ozon_application_number, s.ozon_status, "
                f"(SELECT COUNT(*) FROM wb_supply_orders wso WHERE wso.supply_id = s.id), "
                # Прогресс пошива по поставке: всего изделий в производстве и сколько уже
                # готово. Считаем подзапросами, чтобы список грузился одним обращением к базе.
                f"(SELECT COUNT(*) FROM orders o WHERE o.supply_id = s.id "
                f" AND COALESCE(o.status, '') <> 'Отменён'), "
                f"(SELECT COUNT(*) FROM orders o WHERE o.supply_id = s.id "
                f" AND COALESCE(o.status, '') <> 'Отменён' "
                f" AND o.sewing_status IN ('Готовые', 'Со склада')), "
                # Кто сейчас собирает поставку — чтобы кладовщик видел занятость
                # прямо в списке и не заходил внутрь впустую.
                f"s.locked_by, lu.full_name, "
                # Сколько единиц обещали привезти по заявке: по нему видно недобор
                # прямо в списке, ещё до попытки отгрузить поставку.
                f"s.total_quantity_marketplace "
                f"FROM marketplace_supplies s "
                f"LEFT JOIN users u ON u.id = s.created_by "
                f"LEFT JOIN users lu ON lu.id = s.locked_by "
                f"{where_clause} "
                f"ORDER BY s.created_at DESC, s.id DESC"
            )
            supplies = [
                {
                    'id': r[0],
                    'marketplace': r[1],
                    'type': r[2],
                    'status': r[3],
                    'comment': r[4],
                    'createdAt': r[5].isoformat() + 'Z',
                    'supplyNumber': r[6],
                    'supplyBarcode': r[7],
                    'cluster': r[8],
                    'gazelkaId': r[9],
                    'shipToGazelkaAt': (r[10].isoformat() + 'Z') if r[10] else None,
                    'shipToMarketplaceAt': (r[11].isoformat() + 'Z') if r[11] else None,
                    'completedAt': (r[12].isoformat() + 'Z') if r[12] else None,
                    # Для WB FBS заказы лежат в wb_supply_orders (не в supply_items),
                    # поэтому в itemsCount отдаём именно их количество.
                    'itemsCount': (r[18] if (r[1] == 'WB' and r[2] == 'FBS') else r[13]),
                    'createdByName': r[14],
                    'ozonDeliveryMethod': r[15],
                    'ozonApplicationNumber': r[16],
                    'ozonStatus': r[17],
                    'wbOrdersCount': r[18],
                    # Пошив по поставке: сколько изделий всего и сколько уже сшито.
                    'sewingTotal': int(r[19] or 0),
                    'sewingDone': int(r[20] or 0),
                    'lockedBy': r[21],
                    'lockedByName': r[22],
                    # План по заявке маркетплейса — для FBO это то количество,
                    # без которого поставку не выпустят в отгрузку.
                    'plannedQuantity': r[23],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'supplies': supplies})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_role = (body_data.get('actorRole') or '').strip()
        actor_id = body_data.get('actorId')

        # Действия, меняющие FBS-поставку. Менеджеру они закрыты: FBS собирает кладовщик,
        # сканируя товар со своих полок, а менеджер только наблюдает за ходом сборки.
        FBS_WRITE_ACTIONS = (
            'scan_order', 'remove_item', 'create_box', 'delete_box', 'close_box',
            'add_order_to_box', 'remove_box_item', 'move_status', 'force_complete',
            'update', 'delete', 'add_sewing_orders',
        )

        # Действия сборки: пока поставку держит один кладовщик, второй их выполнить
        # не может. 'move_status'/'force_complete'/'delete' сюда НЕ входят намеренно —
        # это решения по поставке целиком, их принимает администратор.
        ASSEMBLY_ACTIONS = (
            'scan_order', 'remove_item', 'create_box', 'delete_box', 'close_box',
            'add_order_to_box', 'remove_box_item', 'cancelled_to_shelf', 'add_sewing_orders',
        )

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if actor_role == 'manager' and action in FBS_WRITE_ACTIONS:
                target_supply = (
                    body_data.get('supplyId') or body_data.get('id')
                )
                if not target_supply and body_data.get('boxId'):
                    cur.execute(
                        "SELECT supply_id FROM marketplace_supply_boxes WHERE id = %s",
                        (int(body_data['boxId']),),
                    )
                    b_row = cur.fetchone()
                    target_supply = b_row[0] if b_row else None
                if not target_supply and body_data.get('itemId'):
                    cur.execute(
                        "SELECT supply_id FROM marketplace_supply_items WHERE id = %s",
                        (int(body_data['itemId']),),
                    )
                    i_row = cur.fetchone()
                    target_supply = i_row[0] if i_row else None
                denied = deny_manager_fbs(cur, supply_id=target_supply, actor_role=actor_role)
                if denied:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': denied}, ensure_ascii=False)}

            # Поставку собирает кто-то другой — любое изменение её состава отклоняем.
            # Проверяем на сервере, а не только на экране: два планшета могли открыть
            # страницу одновременно, до того как блокировка появилась.
            if action in ASSEMBLY_ACTIONS and actor_id:
                lock_supply = body_data.get('supplyId') or body_data.get('id')
                if not lock_supply and body_data.get('boxId'):
                    cur.execute(
                        "SELECT supply_id FROM marketplace_supply_boxes WHERE id = %s",
                        (int(body_data['boxId']),),
                    )
                    lb = cur.fetchone()
                    lock_supply = lb[0] if lb else None
                if not lock_supply and body_data.get('itemId'):
                    cur.execute(
                        "SELECT supply_id FROM marketplace_supply_items WHERE id = %s",
                        (int(body_data['itemId']),),
                    )
                    li = cur.fetchone()
                    lock_supply = li[0] if li else None
                if lock_supply:
                    lock_err = deny_if_locked_by_other(cur, lock_supply, actor_id)
                    conn.commit()
                    if lock_err:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({'error': lock_err}, ensure_ascii=False),
                        }

            # Захват поставки: кладовщик открыл экран сборки. Кто первый — тот и собирает.
            # Страница повторяет запрос раз в минуту, продлевая блокировку (heartbeat).
            if action == 'lock_supply':
                lock_supply_id = body_data.get('supplyId')
                if not lock_supply_id or not actor_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку и сотрудника'})}
                release_stale_supply_locks(cur)
                # Ставим блокировку одним запросом: условие в WHERE не даст двум
                # одновременным нажатиям перехватить поставку друг у друга.
                cur.execute(
                    "UPDATE marketplace_supplies SET locked_by = %s, locked_at = now() "
                    "WHERE id = %s AND (locked_by IS NULL OR locked_by = %s) "
                    "RETURNING locked_by",
                    (int(actor_id), int(lock_supply_id), int(actor_id)),
                )
                got = cur.fetchone()
                conn.commit()
                if not got:
                    _, holder_name = get_supply_lock(cur, lock_supply_id)
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'Поставку уже собирает {holder_name or "другой сотрудник"}',
                             'lockedByName': holder_name},
                            ensure_ascii=False,
                        ),
                    }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'locked': True})}

            # Освобождение: кладовщик ушёл со страницы сборки.
            if action == 'unlock_supply':
                unlock_id = body_data.get('supplyId')
                if not unlock_id or not actor_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку и сотрудника'})}
                # Снять блокировку может только тот, кто её поставил, — иначе один
                # кладовщик мог бы «выбить» другого прямо во время сборки.
                cur.execute(
                    "UPDATE marketplace_supplies SET locked_by = NULL, locked_at = NULL "
                    "WHERE id = %s AND locked_by = %s",
                    (int(unlock_id), int(actor_id)),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'unlocked': True})}

            if action == 'create':
                marketplace = (body_data.get('marketplace') or '').strip()
                supply_type = (body_data.get('type') or 'FBS').strip()
                comment = (body_data.get('comment') or '').strip()
                created_by = body_data.get('createdBy')
                ozon_delivery_method = (body_data.get('ozonDeliveryMethod') or '').strip()

                if not marketplace:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите маркетплейс'})}
                denied = deny_manager_fbs(cur, supply_type=supply_type, actor_role=actor_role)
                if denied:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': denied}, ensure_ascii=False)}
                if supply_type not in ('FBO', 'FBS'):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Тип поставки должен быть FBO или FBS'})}
                if marketplace == 'OZON' and supply_type == 'FBO' and ozon_delivery_method not in ('direct', 'cross_docking'):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите способ поставки: прямая или кросс-докинг'})}

                marketplace_esc = marketplace.replace("'", "''")

                # Сборка FBS может быть только одна на маркетплейс. Две открытые сборки
                # означают, что вещи из одного контейнера расходятся по разным коробам —
                # на маркетплейсе это разные поставки, и часть заказов уедет не туда.
                if supply_type == 'FBS' and marketplace in ('WB', 'OZON'):
                    cur.execute(
                        "SELECT id FROM marketplace_supplies "
                        f"WHERE marketplace = '{marketplace_esc}' AND type = 'FBS' "
                        "AND COALESCE(is_accumulator, false) = false "
                        "AND status IN ('Открытая', 'На сборке') LIMIT 1"
                    )
                    active = cur.fetchone()
                    if active:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Сборка #{active[0]} ещё не завершена. Передайте её '
                                         f'в доставку — потом создавайте новую',
                                'activeSupplyId': active[0],
                            }, ensure_ascii=False),
                        }

                type_esc = supply_type.replace("'", "''")
                comment_esc = comment.replace("'", "''")
                created_by_sql = int(created_by) if created_by not in (None, '') else 'NULL'
                ozon_delivery_method_sql = f"'{ozon_delivery_method}'" if ozon_delivery_method else 'NULL'
                ozon_status_sql = "'Заполнение данных'" if (marketplace == 'OZON' and supply_type == 'FBO') else 'NULL'

                cur.execute(
                    f"INSERT INTO marketplace_supplies (marketplace, type, status, comment, created_by, "
                    f"ozon_delivery_method, ozon_status) "
                    f"VALUES ('{marketplace_esc}', '{type_esc}', 'Открытая', '{comment_esc}', {created_by_sql}, "
                    f"{ozon_delivery_method_sql}, {ozon_status_sql}) RETURNING id"
                )
                supply_id = cur.fetchone()[0]

                goods_ids = body_data.get('goodsWarehouseIds') or []
                for gid in goods_ids:
                    cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(gid),))
                    row = cur.fetchone()
                    if not row:
                        return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} не найден на складе'})}
                    if row[0] != 'in_stock':
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} недоступен'})}
                    cur.execute(
                        f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id) VALUES ({supply_id}, {int(gid)})"
                    )
                    cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {int(gid)}")

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': supply_id})}

            if action == 'scan_order':
                # Сканируется ШТРИХКОД ХРАНЕНИЯ товара (storage_barcode из goods_warehouse),
                # а не номер заказа маркетплейса — кладовщик заранее отбирает товары к подбору
                # на складе (action 'start_picking' в backend/goods_warehouse, статус picking),
                # а здесь только подтверждает добавление конкретного отобранного товара в
                # конкретную поставку. Параметр называется orderNumber для обратной
                # совместимости фронтенда, но по факту принимает штрихкод хранения.
                supply_id = body_data.get('supplyId')
                storage_barcode = (body_data.get('orderNumber') or '').strip()
                if not supply_id or not storage_barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку и штрихкод хранения товара'})}

                cur.execute("SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if row[0] not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В эту поставку уже нельзя добавлять заказы'})}

                barcode_esc = storage_barcode.replace("'", "''")

                # В поставку принимается ТОЛЬКО стикер маркетплейса (номер отправления).
                # Складской стикер хранения здесь не работает: по нему кладовщик может
                # лишь застикеровать вещь на складе. Иначе в короб уезжала вещь без
                # ярлыка маркетплейса — на приёмке её не опознают.
                cur.execute(
                    "SELECT gw.id, gw.storage_barcode FROM goods_warehouse gw "
                    f"WHERE gw.storage_barcode = '{barcode_esc}'"
                )
                storage_hit = cur.fetchone()
                if storage_hit:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Это складской стикер хранения. В поставку сканируйте '
                                     'стикер маркетплейса (ярлык отправления), наклеенный '
                                     'на вещь при сборке с полок'
                        }, ensure_ascii=False),
                    }

                # Ищем вещь по номеру отправления маркетплейса: именно он напечатан на
                # ярлыке, который кладовщик клеит при сборке с полок.
                cur.execute(
                    "SELECT gw.id, gw.status, o.order_number, gw.shipping_labeled_at "
                    "FROM orders o "
                    "JOIN goods_warehouse gw ON gw.id = o.fulfilled_from_stock_id "
                    f"WHERE o.order_number = '{barcode_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Отправление {storage_barcode} не найдено среди собранных '
                                     f'с полок. Соберите и отстикеруйте вещь в разделе '
                                     f'«Сборка товара с полок»'
                        }, ensure_ascii=False),
                    }
                goods_id, goods_status, order_number, labeled_at = gw_row

                # Ярлык маркетплейса ещё не наклеен: вещь лежит на полке, в короб её
                # класть нельзя — на приёмке маркетплейса её не опознают.
                if not labeled_at:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'На вещь {order_number} ещё не наклеен ярлык маркетплейса. '
                                     f'Соберите её с полки и отстикеруйте в разделе '
                                     f'«Сборка товара с полок»'
                        }, ensure_ascii=False),
                    }

                # Сначала смотрим, не лежит ли товар УЖЕ в поставке. Добавленный товар
                # становится 'reserved', и проверка статуса ниже принимала его за
                # неотобранный — кладовщик видел «сначала отсканируйте на складе»,
                # хотя вещь была у него в руках и давно в этой же поставке.
                cur.execute(
                    "SELECT si.id, si.supply_id, s.status FROM marketplace_supply_items si "
                    "JOIN marketplace_supplies s ON s.id = si.supply_id "
                    "WHERE si.goods_warehouse_id = %s",
                    (goods_id,),
                )
                exists = cur.fetchone()
                if exists:
                    if exists[1] == int(supply_id):
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Товар {order_number or ""} уже добавлен в эту поставку'
                            }, ensure_ascii=False),
                        }
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Товар {order_number or ""} уже в поставке #{exists[1]} '
                                     f'({exists[2]}) — уберите его оттуда, если он нужен здесь'
                        }, ensure_ascii=False),
                    }

                if goods_status != 'picking':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Товар {order_number or ""} не отобран к подбору (статус: {goods_status}) — '
                            'сначала отсканируйте его на складе в разделе "Сборка товара с полок"'
                        }),
                    }

                cur.execute(
                    f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id) VALUES ({int(supply_id)}, {goods_id})"
                )
                cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {goods_id}")

                # Если товар из заказа с общим ярлыком (Яндекс) — сразу подсказываем, сколько
                # вещей этого заказа ещё нужно отсканировать. Лучше сказать об этом здесь, чем
                # заблокировать всю поставку в конце сборки.
                cur.execute(
                    "SELECT o.group_key, o.group_size FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.order_id WHERE gw.id = %s",
                    (goods_id,),
                )
                g_row = cur.fetchone()
                group_hint = None
                if g_row and g_row[0] and (g_row[1] or 0) > 1:
                    cur.execute(
                        "SELECT count(*) FROM marketplace_supply_items msi "
                        "JOIN goods_warehouse gw2 ON gw2.id = msi.goods_warehouse_id "
                        "JOIN orders o2 ON o2.id = gw2.order_id "
                        "WHERE msi.supply_id = %s AND o2.group_key = %s",
                        (int(supply_id), g_row[0]),
                    )
                    in_supply = int(cur.fetchone()[0])
                    group_hint = {
                        'groupKey': g_row[0],
                        'inSupply': in_supply,
                        'total': int(g_row[1]),
                        'remaining': max(0, int(g_row[1]) - in_supply),
                    }

                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'goodsWarehouseId': goods_id,
                        'orderNumber': order_number,
                        'group': group_hint,
                    }, ensure_ascii=False),
                }

            if action == 'cancelled_to_shelf':
                # Отменённый заказ уезжает не на маркетплейс, а на полку хранения: вещь
                # физически готова, но покупателя у неё больше нет. Убираем её из поставки и
                # кладём на выбранную полку — оттуда её потом подберут под новый заказ.
                # Для связки Яндекса отправляем на полку ВСЮ связку: ярлык на неё общий,
                # поэтому неполный заказ отгружать нельзя.
                item_id = body_data.get('itemId')
                shelf_id = body_data.get('shelfId')
                if not item_id or not shelf_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите позицию и полку'})}

                cur.execute(
                    "SELECT msi.supply_id, msi.goods_warehouse_id, s.status, o.group_key "
                    "FROM marketplace_supply_items msi "
                    "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                    "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                    "JOIN orders o ON o.id = gw.order_id "
                    "WHERE msi.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
                supply_id_of_item, goods_id, supply_status, group_key = row
                if supply_status not in ('Открытая', 'На сборке'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Поставка уже закрыта — товар из неё убрать нельзя'}, ensure_ascii=False),
                    }

                targets = [(int(item_id), goods_id)]
                if group_key:
                    cur.execute(
                        "SELECT msi.id, msi.goods_warehouse_id FROM marketplace_supply_items msi "
                        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                        "JOIN orders o ON o.id = gw.order_id "
                        "WHERE msi.supply_id = %s AND o.group_key = %s",
                        (int(supply_id_of_item), group_key),
                    )
                    targets = [(r[0], r[1]) for r in cur.fetchall()] or targets

                for t_item_id, t_goods_id in targets:
                    cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(t_item_id)}")
                    cur.execute(
                        "UPDATE goods_warehouse SET status = 'in_stock', shelf_id = %s, "
                        "reserved_order_id = NULL WHERE id = %s",
                        (int(shelf_id), int(t_goods_id)),
                    )

                cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                sh_row = cur.fetchone()
                shelf_name = sh_row[0] if sh_row else str(shelf_id)

                log_action(
                    cur, body_data.get('actorId'), body_data.get('actorName'),
                    'cancelled_to_shelf', 'marketplace_supply', supply_id_of_item,
                    f'Отменённый заказ убран из поставки на полку {shelf_name}: {len(targets)} шт.'
                    + (f' (связка {group_key})' if group_key else ''),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'movedCount': len(targets),
                        'shelfName': shelf_name,
                        'groupKey': group_key,
                    }, ensure_ascii=False),
                }

            if action == 'remove_item':
                item_id = body_data.get('itemId')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите itemId'})}

                cur.execute(
                    "SELECT msi.goods_warehouse_id, s.status, gw.storage_barcode, "
                    "o.order_number, gw.shelf_id, sh.name, src.product "
                    "FROM marketplace_supply_items msi "
                    "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                    "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                    "LEFT JOIN orders o ON o.id = gw.reserved_order_id "
                    "LEFT JOIN orders src ON src.id = gw.order_id "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    "WHERE msi.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
                (goods_id, supply_status, storage_barcode, reserved_order_number,
                 shelf_id, shelf_name, product) = row
                if supply_status not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Из этой поставки уже нельзя убрать товар'})}

                cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(item_id)}")

                # Вещь вынули из короба — она едет обратно на полку. Снимаем отметку о
                # наклеенном ярлыке маркетплейса: этот ярлык больше не действует, вещь
                # снова обычный складской остаток. Раньше отметка оставалась, и вещь
                # висела «собранной», но в поставку уже не сканировалась — кладовщик
                # видел «отправление не найдено среди собранных с полок».
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', "
                    "shipping_labeled_at = NULL, reserved_order_id = NULL, matched_at = NULL "
                    f"WHERE id = {int(goods_id)}"
                )
                # Заказ, под который вещь резервировали, снова ждёт подбора: система
                # подберёт под него другую вещь или отправит его в пошив. Правим строго
                # тот заказ, что был привязан к этой вещи.
                cur.execute(
                    "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый' "
                    "WHERE fulfilled_from_stock_id = %s",
                    (int(goods_id),),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        # По этим данным интерфейс печатает стикер хранения: без него
                        # вещь уедет на полку без опознавательного знака.
                        'storageBarcode': storage_barcode,
                        'orderNumber': reserved_order_number,
                        'product': product,
                        'shelfName': shelf_name,
                    }, ensure_ascii=False),
                }

            if action == 'create_box':
                supply_id = body_data.get('supplyId')
                if not supply_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите supplyId'})}

                cur.execute("SELECT status, type FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if row[1] != 'FBO':
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Короба доступны только для FBO'})}
                if row[0] not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В эту поставку уже нельзя добавлять короба'})}

                cur.execute(
                    "SELECT COALESCE(MAX(box_number), 0) FROM marketplace_supply_boxes WHERE supply_id = %s",
                    (int(supply_id),),
                )
                next_number = cur.fetchone()[0] + 1
                barcode = f"SUPPLY{supply_id}-BOX{next_number:03d}"

                cur.execute(
                    f"INSERT INTO marketplace_supply_boxes (supply_id, box_number, barcode) "
                    f"VALUES ({int(supply_id)}, {next_number}, '{barcode}') RETURNING id, created_at"
                )
                box_id, created_at = cur.fetchone()
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'id': box_id,
                        'boxNumber': next_number,
                        'barcode': barcode,
                        'createdAt': created_at.isoformat() + 'Z',
                    }),
                }

            if action == 'delete_box':
                box_id = body_data.get('boxId')
                if not box_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите boxId'})}

                cur.execute(
                    "SELECT COUNT(*) FROM marketplace_supply_items WHERE box_id = %s", (int(box_id),)
                )
                if cur.fetchone()[0] > 0:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В коробе есть товары — сначала уберите их'})}

                cur.execute("DELETE FROM marketplace_supply_boxes WHERE id = %s", (int(box_id),))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'close_box':
                # Закрытие короба внутри нашей системы (для WB FBO): фиксируем факт закрытия,
                # после чего кладовщик печатает стикер короба. Короб должен быть непустым.
                box_id = body_data.get('boxId')
                if not box_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите boxId'})}

                cur.execute(
                    "SELECT COUNT(*) FROM marketplace_supply_items WHERE box_id = %s", (int(box_id),)
                )
                if cur.fetchone()[0] == 0:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Короб пустой — сначала добавьте товары'})}

                cur.execute(
                    "UPDATE marketplace_supply_boxes SET closed_at = NOW() "
                    "WHERE id = %s AND closed_at IS NULL RETURNING closed_at",
                    (int(box_id),),
                )
                row = cur.fetchone()
                conn.commit()
                closed_at = (row[0].isoformat() + 'Z') if row and row[0] else None
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'closedAt': closed_at})}

            if action == 'add_order_to_box':
                box_id = body_data.get('boxId')
                order_number = (body_data.get('orderNumber') or '').strip()
                if not box_id or not order_number:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите короб и отсканируйте стикер хранения'})}

                cur.execute(
                    "SELECT mb.supply_id, s.status FROM marketplace_supply_boxes mb "
                    "JOIN marketplace_supplies s ON s.id = mb.supply_id WHERE mb.id = %s",
                    (int(box_id),),
                )
                box_row = cur.fetchone()
                if not box_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Короб не найден'})}
                supply_id, supply_status = box_row
                if supply_status not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В эту поставку уже нельзя добавлять товары'})}

                # В короб товар кладётся ТОЛЬКО сканированием стикера хранения (GW-XXXXXX).
                # Номер заказа маркетплейса руками не вводится: так в поставку не попадёт
                # вещь, которую кладовщик физически не держал в руках.
                scan_esc = order_number.replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.status, o.order_number FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    f"WHERE gw.storage_barcode = '{scan_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Стикер {order_number} не найден. Сканируйте стикер хранения '
                                     f'товара (GW-...), а не номер заказа'
                        }),
                    }
                goods_id, goods_status, goods_order_number = gw_row
                order_number = goods_order_number or order_number

                # «Уже в поставке» проверяем ПЕРЕД статусом: добавленный товар становится
                # 'reserved', и иначе кладовщик получал невнятное «уже зарезервирован»
                # вместо понятного «этот товар уже в коробе».
                cur.execute(
                    "SELECT si.id, si.supply_id FROM marketplace_supply_items si "
                    "WHERE si.goods_warehouse_id = %s",
                    (goods_id,),
                )
                exists = cur.fetchone()
                if exists:
                    if exists[1] == supply_id:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Товар {order_number or ""} уже добавлен в эту поставку'
                            }, ensure_ascii=False),
                        }
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Товар {order_number or ""} уже в поставке #{exists[1]}'
                        }, ensure_ascii=False),
                    }

                if goods_status == 'awaiting_shelf':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар {goods_order_number or ""} ещё не положен на полку'}),
                    }
                if goods_status not in ('in_stock', 'picking'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар {goods_order_number or ""} уже зарезервирован или отгружен'}),
                    }

                cur.execute(
                    f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id, box_id) "
                    f"VALUES ({supply_id}, {goods_id}, {int(box_id)}) RETURNING id"
                )
                item_id = cur.fetchone()[0]
                cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {goods_id}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'itemId': item_id, 'goodsWarehouseId': goods_id})}

            if action == 'remove_box_item':
                item_id = body_data.get('itemId')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите itemId'})}

                cur.execute(
                    "SELECT msi.goods_warehouse_id, s.status, gw.storage_barcode, "
                    "o.order_number, sh.name, src.product "
                    "FROM marketplace_supply_items msi "
                    "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                    "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                    "LEFT JOIN orders o ON o.id = gw.reserved_order_id "
                    "LEFT JOIN orders src ON src.id = gw.order_id "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    "WHERE msi.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
                (goods_id, supply_status, storage_barcode, reserved_order_number,
                 shelf_name, product) = row
                if supply_status not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Из этой поставки уже нельзя убрать товар'})}

                cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(item_id)}")
                # Вещь вынули из короба — ярлык маркетплейса на ней больше не действует.
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', "
                    "shipping_labeled_at = NULL, reserved_order_id = NULL, matched_at = NULL "
                    f"WHERE id = {int(goods_id)}"
                )
                cur.execute(
                    "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый' "
                    "WHERE fulfilled_from_stock_id = %s",
                    (int(goods_id),),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'storageBarcode': storage_barcode,
                        'orderNumber': reserved_order_number,
                        'product': product,
                        'shelfName': shelf_name,
                    }, ensure_ascii=False),
                }

            if action == 'update':
                supply_id = body_data.get('supplyId')
                if not supply_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите supplyId'})}

                def sql_str_or_null(column: str, value) -> str:
                    v = (value or '').strip().replace("'", "''")
                    return f"{column} = NULL" if not v else f"{column} = '{v}'"

                def sql_ts_or_null(column: str, value) -> str:
                    v = (value or '').strip().replace("'", "''")
                    return f"{column} = NULL" if not v else f"{column} = '{v}'::timestamp"

                def sql_date_or_null(column: str, value) -> str:
                    v = (value or '').strip().replace("'", "''")
                    return f"{column} = NULL" if not v else f"{column} = '{v}'::date"

                fields = []
                if 'supplyNumber' in body_data:
                    fields.append(sql_str_or_null('supply_number', body_data['supplyNumber']))
                if 'supplyBarcode' in body_data:
                    fields.append(sql_str_or_null('supply_barcode', body_data['supplyBarcode']))
                if 'cluster' in body_data:
                    fields.append(sql_str_or_null('cluster', body_data['cluster']))
                if 'gazelkaId' in body_data:
                    fields.append(sql_str_or_null('gazelka_id', body_data['gazelkaId']))
                if 'comment' in body_data:
                    comment_val = (body_data['comment'] or '').strip().replace("'", "''")
                    fields.append(f"comment = '{comment_val}'")
                if 'shipToGazelkaAt' in body_data:
                    fields.append(sql_ts_or_null('ship_to_gazelka_at', body_data['shipToGazelkaAt']))
                if 'shipToMarketplaceAt' in body_data:
                    fields.append(sql_ts_or_null('ship_to_marketplace_at', body_data['shipToMarketplaceAt']))
                if 'totalQuantityMarketplace' in body_data:
                    qty = body_data['totalQuantityMarketplace']
                    fields.append(f"total_quantity_marketplace = {int(qty)}" if qty not in (None, '') else "total_quantity_marketplace = NULL")
                if body_data.get('passStickerBase64'):
                    sticker_name = (body_data.get('passStickerName') or 'sticker.pdf').strip()
                    sticker_url = upload_pass_sticker(body_data['passStickerBase64'], sticker_name)
                    sticker_name_esc = sticker_name.replace("'", "''")
                    fields.append(f"pass_sticker_url = '{sticker_url}'")
                    fields.append(f"pass_sticker_name = '{sticker_name_esc}'")
                if 'ozonApplicationNumber' in body_data:
                    fields.append(sql_str_or_null('ozon_application_number', body_data['ozonApplicationNumber']))
                if 'ozonStatus' in body_data:
                    fields.append(sql_str_or_null('ozon_status', body_data['ozonStatus']))
                if 'supplyDate' in body_data:
                    fields.append(sql_date_or_null('supply_date', body_data['supplyDate']))
                if 'timeslot' in body_data:
                    fields.append(sql_str_or_null('timeslot', body_data['timeslot']))
                if 'shipmentType' in body_data:
                    fields.append(sql_str_or_null('shipment_type', body_data['shipmentType']))
                if 'packagingType' in body_data:
                    fields.append(sql_str_or_null('packaging_type', body_data['packagingType']))
                if 'packagingCount' in body_data:
                    pc = body_data['packagingCount']
                    fields.append(f"packaging_count = {int(pc)}" if pc not in (None, '') else "packaging_count = NULL")
                if 'gazelkaPickup' in body_data:
                    fields.append(f"gazelka_pickup = {'true' if body_data['gazelkaPickup'] else 'false'}")
                if 'ozonCargoType' in body_data:
                    # Тип грузоместа OZON FBO: только BOX или PALLET (защита от произвольных значений).
                    ct = (body_data['ozonCargoType'] or 'BOX').strip().upper()
                    if ct not in ('BOX', 'PALLET'):
                        ct = 'BOX'
                    fields.append(f"ozon_cargo_type = '{ct}'")
                if 'gazelkaPlanId' in body_data:
                    gp = body_data['gazelkaPlanId']
                    fields.append(f"gazelka_plan_id = {int(gp)}" if gp not in (None, '') else "gazelka_plan_id = NULL")
                if 'gazelkaIds' in body_data:
                    gi = body_data['gazelkaIds']
                    fields.append(f"gazelka_ids = {int(gi)}" if gi not in (None, '') else "gazelka_ids = 0")
                if 'gazelkaIdm' in body_data:
                    gm = body_data['gazelkaIdm']
                    fields.append(f"gazelka_idm = {int(gm)}" if gm not in (None, '') else "gazelka_idm = 0")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нечего обновлять'})}

                cur.execute(f"UPDATE marketplace_supplies SET {', '.join(fields)} WHERE id = {int(supply_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            # Кладовщик отвечает на вопрос дашборда «поставка уехала в газельку?».
            # Да — фиксируем факт отгрузки. Нет — переносим напоминание, чтобы система
            # спросила снова: поставка могла задержаться, но забывать про неё нельзя.
            if action == 'confirm_gazelka_ship':
                supply_id = body_data.get('supplyId')
                if not supply_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку'})}
                shipped = bool(body_data.get('shipped'))

                cur.execute(
                    "SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),)
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}

                if shipped:
                    # Отмечаем факт отгрузки. Статус двигаем в «Отгрузка», если поставка
                    # ещё собиралась: машина уехала — сборка закончена.
                    status_sql = ", status = 'Отгрузка'" if row[0] in ('Открытая', 'На сборке') else ""
                    cur.execute(
                        f"UPDATE marketplace_supplies SET gazelka_shipped_at = now(){status_sql}, "
                        f"locked_by = NULL, locked_at = NULL WHERE id = {int(supply_id)}"
                    )
                else:
                    # Не уехала — сдвигаем плановую дату на завтра, чтобы напоминание
                    # не висело постоянно, но и не потерялось.
                    cur.execute(
                        "UPDATE marketplace_supplies "
                        "SET ship_to_gazelka_at = ship_to_gazelka_at + interval '1 day' "
                        "WHERE id = %s",
                        (int(supply_id),),
                    )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'move_status':
                supply_id = body_data.get('supplyId')
                new_status = body_data.get('status')
                if not supply_id or new_status not in VALID_STATUSES:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный статус'})}

                cur.execute("SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                current_status = row[0]
                current_idx = VALID_STATUSES.index(current_status) if current_status in VALID_STATUSES else -1
                new_idx = VALID_STATUSES.index(new_status)
                if new_idx != current_idx + 1:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Нельзя перевести поставку из статуса "{current_status}" в "{new_status}"'}),
                    }

                extra_sql = ""
                if new_status == 'Отгрузка':
                    # Отменённые заказы отгружать нельзя: на маркетплейсе их больше нет.
                    # Кладовщик должен сначала отправить такие вещи на полку хранения —
                    # прямо из строки поставки, кнопкой «На полку».
                    cancelled = find_cancelled_items(cur, supply_id)
                    if cancelled:
                        nums = ', '.join(c['orderNumber'] or c['storageBarcode'] for c in cancelled[:10])
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'В поставке {len(cancelled)} отменённых заказов — '
                                         f'отправьте их на полку хранения: {nums}',
                                'cancelledItems': cancelled,
                            }, ensure_ascii=False),
                        }

                    # Заказ Яндекса из нескольких вещей отгружается по одному общему ярлыку.
                    # Отгрузить его наполовину нельзя: остаток застрянет на складе, а
                    # покупателю уедет неполная посылка — маркетплейс засчитает недовоз.
                    incomplete = check_incomplete_groups(cur, supply_id)
                    if incomplete:
                        parts = '; '.join(
                            f"{g['groupKey']}: собрано {g['inSupply']} из {g['total']}"
                            for g in incomplete
                        )
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': 'В поставке есть заказы, собранные не полностью — '
                                         'у них общий ярлык, отгружать можно только целиком. '
                                         + parts,
                                'incompleteGroups': incomplete,
                            }, ensure_ascii=False),
                        }
                    # Поставка FBO едет по заявке: привезти меньше обещанного нельзя —
                    # маркетплейс засчитает недовоз, а остаток зависнет на складе.
                    underfilled = check_fbo_underfilled(cur, supply_id)
                    if underfilled:
                        collected, planned = underfilled
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Поставка собрана не полностью: {collected} из '
                                         f'{planned} шт. по заявке. Дособерите товар или '
                                         f'уменьшите количество в заявке.',
                                'collected': collected,
                                'planned': planned,
                            }, ensure_ascii=False),
                        }

                    extra_sql = ", ship_to_gazelka_at = COALESCE(ship_to_gazelka_at, now())"
                    cur.execute(
                        "SELECT goods_warehouse_id FROM marketplace_supply_items WHERE supply_id = %s",
                        (int(supply_id),),
                    )
                    goods_ids = [r[0] for r in cur.fetchall()]
                    for gid in goods_ids:
                        cur.execute(f"UPDATE goods_warehouse SET status = 'shipped', shipped_at = now() WHERE id = {gid}")
                elif new_status == 'Выполнена':
                    extra_sql = ", completed_at = now(), ship_to_marketplace_at = COALESCE(ship_to_marketplace_at, now())"

                # Поставка ушла со сборки — снимаем блокировку, иначе она осталась бы
                # висеть на кладовщике и мешала бы вернуться к поставке при исправлении.
                if new_status in ('Отгрузка', 'Выполнена'):
                    extra_sql += ", locked_by = NULL, locked_at = NULL"

                cur.execute(f"UPDATE marketplace_supplies SET status = '{new_status}'{extra_sql} WHERE id = {int(supply_id)}")

                # Кладовщик получает оклад за смену, если он открыл смену И довёл хотя бы одну
                # поставку FBS/FBO до статуса "На сборке" или "Отгрузка" (salary_rates,
                # role='storekeeper'). Разово за смену — привязывается к его открытой shift_session.
                if new_status in ('На сборке', 'Отгрузка'):
                    cur.execute("SELECT created_by FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                    creator_row = cur.fetchone()
                    creator_id = creator_row[0] if creator_row else None
                    if creator_id:
                        cur.execute("SELECT role, workshop FROM users WHERE id = %s", (creator_id,))
                        user_row = cur.fetchone()
                        if user_row and user_row[0] in ('storekeeper', 'senior_storekeeper'):
                            cur.execute(
                                "SELECT id, workshop_id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                                "ORDER BY opened_at DESC LIMIT 1",
                                (creator_id,),
                            )
                            session_row = cur.fetchone()
                            if session_row:
                                session_id, session_workshop_id = session_row
                                # Ставка берётся из тарифов цеха этой смены (workshop_id смены);
                                # если у смены цех не указан — из цеха профиля кладовщика.
                                rate_workshop_id = session_workshop_id
                                if not rate_workshop_id and user_row[1]:
                                    cur.execute("SELECT id FROM workshops WHERE name = %s", (user_row[1],))
                                    w_row = cur.fetchone()
                                    rate_workshop_id = w_row[0] if w_row else None
                                if rate_workshop_id:
                                    cur.execute(
                                        "SELECT rate FROM salary_rates WHERE role = %s AND workshop_id = %s",
                                        (user_row[0], rate_workshop_id),
                                    )
                                    rate_row = cur.fetchone()
                                    rate = float(rate_row[0]) if rate_row else 0
                                    if rate > 0:
                                        # Оклад за смену — один раз в день. Две смены за день
                                        # (своя и гостевая в другом цехе) — это разные записи
                                        # смен, защита по смене их не ловит. От задвоения
                                        # спасает дневной уникальный индекс, но он бьёт
                                        # ошибкой и рвёт сборку поставки, поэтому проверяем
                                        # день заранее.
                                        cur.execute(
                                            "SELECT 1 FROM salary_accruals WHERE user_id = %s "
                                            "AND type = 'storekeeper_shift' "
                                            "AND accrued_for = CURRENT_DATE",
                                            (int(creator_id),),
                                        )
                                        if not cur.fetchone():
                                            cur.execute(
                                                f"INSERT INTO salary_accruals (user_id, type, amount, shift_session_id, description) "
                                                f"VALUES ({creator_id}, 'storekeeper_shift', {rate}, {session_id}, "
                                                f"'Оклад за смену (сборка поставки #{supply_id})') "
                                                f"ON CONFLICT (shift_session_id, type) WHERE shift_session_id IS NOT NULL DO NOTHING"
                                            )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'force_complete':
                supply_id = body_data.get('supplyId')
                if not supply_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите supplyId'})}

                cur.execute("SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if row[0] == 'Выполнена':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Поставка уже выполнена'})}

                # Принудительное закрытие — аварийный инструмент, поэтому неполный заказ с общим
                # ярлыком он не запрещает наглухо, но требует осознанного подтверждения: иначе
                # половина заказа молча уедет как отгруженная, а вторая зависнет на складе.
                incomplete = check_incomplete_groups(cur, supply_id)
                if incomplete and not body_data.get('confirmIncomplete'):
                    parts = '; '.join(
                        f"{g['groupKey']}: собрано {g['inSupply']} из {g['total']}"
                        for g in incomplete
                    )
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'В поставке есть заказы, собранные не полностью (общий ярлык): '
                                     + parts + '. Подтвердите закрытие, если поставка реально уехала.',
                            'incompleteGroups': incomplete,
                            'needsConfirm': True,
                        }, ensure_ascii=False),
                    }

                cur.execute(
                    "SELECT goods_warehouse_id FROM marketplace_supply_items WHERE supply_id = %s",
                    (int(supply_id),),
                )
                goods_ids = [r[0] for r in cur.fetchall()]
                for gid in goods_ids:
                    cur.execute(f"UPDATE goods_warehouse SET status = 'shipped', shipped_at = COALESCE(shipped_at, now()) WHERE id = {gid}")

                cur.execute(
                    f"UPDATE marketplace_supplies SET status = 'Выполнена', "
                    f"ship_to_gazelka_at = COALESCE(ship_to_gazelka_at, now()), "
                    f"completed_at = now(), "
                    f"locked_by = NULL, locked_at = NULL, "
                    f"ship_to_marketplace_at = COALESCE(ship_to_marketplace_at, now()) "
                    f"WHERE id = {int(supply_id)}"
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'add_sewing_orders':
                # Догрузка товаров на пошив в уже существующую поставку. Нужна, когда состав
                # заявки на маркетплейсе дополнили, или менеджер решил довезти ещё товара.
                # Каждая штука — отдельный заказ на конвейере (1 заказ = 1 изделие).
                target_supply = body_data.get('supplyId')
                lines = body_data.get('items') or []
                if not target_supply:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку'})}
                if not lines:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите товары'})}

                cur.execute(
                    "SELECT status, marketplace, type, cluster FROM marketplace_supplies WHERE id = %s",
                    (int(target_supply),),
                )
                s_row = cur.fetchone()
                if not s_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                s_status, s_marketplace, s_type, s_cluster = s_row
                if s_status in ('Отгрузка', 'Выполнена'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Поставка уже уехала — догрузить товар в неё нельзя'},
                            ensure_ascii=False,
                        ),
                    }

                # Номера ручных заказов идут сквозным счётчиком 00000-01, 00000-02 — тем же,
                # что и при добавлении заказа вручную, чтобы нумерация в системе была единой.
                cur.execute(
                    "SELECT order_number FROM orders WHERE order_number ~ '^00000-[0-9]+$' "
                    "ORDER BY (split_part(order_number, '-', 2))::int DESC LIMIT 1"
                )
                last_row = cur.fetchone()
                next_seq = (int(last_row[0].split('-')[1]) + 1) if last_row else 1

                created = 0
                from_stock = 0
                for line in lines:
                    mp_item_id = line.get('marketplaceItemId')
                    qty = int(line.get('quantity') or 1)
                    if not mp_item_id or qty < 1:
                        continue
                    cur.execute(
                        "SELECT name, material, width, height, barcode, ozon_sku "
                        "FROM marketplace_items WHERE id = %s",
                        (int(mp_item_id),),
                    )
                    i_row = cur.fetchone()
                    if not i_row:
                        continue
                    i_name, i_material, i_width, i_height, i_barcode, i_ozon_sku = i_row
                    product = (
                        f"{i_material} {i_width}x{i_height}"
                        if i_material and i_width and i_height else i_name
                    )

                    # Сначала смотрим на полки: если такая вещь уже лежит готовой, шить её
                    # заново не нужно — резервируем со склада. Берём те, что дольше всех лежат
                    # (FIFO), и не больше, чем нужно в поставку.
                    # SKIP LOCKED — вещь, которую параллельно резервирует подбор FBS,
                    # пропускаем, чтобы одна вещь не ушла в два места.
                    cur.execute(
                        "SELECT gw.id FROM goods_warehouse gw "
                        "JOIN orders src ON src.id = gw.order_id "
                        "WHERE gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
                        "AND src.marketplace_item_id = %s "
                        "ORDER BY gw.received_at ASC LIMIT %s "
                        "FOR UPDATE OF gw SKIP LOCKED",
                        (int(mp_item_id), qty),
                    )
                    stock_ids = [r[0] for r in cur.fetchall()]

                    for gw_pick in stock_ids:
                        cur.execute(
                            "INSERT INTO orders (order_number, marketplace, order_type, status, "
                            "cluster, product, quantity, source, material, width, height, "
                            "marketplace_item_id, product_barcode, product_ozon_sku, supply_id, "
                            "fulfilled_from_stock_id, sewing_status) "
                            "VALUES (%s, %s, %s, 'Новый', %s, %s, 1, 'manual', %s, %s, %s, %s, %s, %s, %s, "
                            "%s, 'Со склада') "
                            "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                            (
                                f"00000-{next_seq:02d}", s_marketplace, s_type or 'FBO',
                                s_cluster or '', product, i_material,
                                int(i_width) if i_width else None,
                                int(i_height) if i_height else None,
                                int(mp_item_id), i_barcode or None, i_ozon_sku or None,
                                int(target_supply), int(gw_pick),
                            ),
                        )
                        new_row = cur.fetchone()
                        next_seq += 1
                        if not new_row:
                            continue
                        cur.execute(
                            "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() "
                            "WHERE id = %s",
                            (int(new_row[0]), int(gw_pick)),
                        )
                        created += 1
                        from_stock += 1

                    # Остаток, которого не хватило на складе, уходит в пошив.
                    qty -= len(stock_ids)
                    for _ in range(max(0, qty)):
                        cur.execute(
                            "INSERT INTO orders (order_number, marketplace, order_type, status, "
                            "cluster, product, quantity, source, material, width, height, "
                            "marketplace_item_id, product_barcode, product_ozon_sku, supply_id) "
                            "VALUES (%s, %s, %s, 'Новый', %s, %s, 1, 'manual', %s, %s, %s, %s, %s, %s, %s) "
                            "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                            (
                                f"00000-{next_seq:02d}", s_marketplace, s_type or 'FBO',
                                s_cluster or '', product, i_material,
                                int(i_width) if i_width else None,
                                int(i_height) if i_height else None,
                                int(mp_item_id), i_barcode or None, i_ozon_sku or None,
                                int(target_supply),
                            ),
                        )
                        if cur.fetchone():
                            created += 1
                        next_seq += 1

                log_action(
                    cur, body_data.get('actorId'), body_data.get('actorName'),
                    'supply_add_orders', 'supply', int(target_supply),
                    f'Догрузил в поставку #{target_supply}: всего {created}, '
                    f'из них со склада {from_stock}, в пошив {created - from_stock}',
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'created': created,
                        'fromStock': from_stock,
                        'toSewing': created - from_stock,
                    }),
                }

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute("SELECT status FROM marketplace_supplies WHERE id = %s", (int(item_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if row[0] != 'Открытая':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Удалить можно только открытую поставку'})}

                # Заказы на пошив по этой поставке. Удалять поставку можно, только пока их не
                # начали шить: если по заказу уже кроили или шили, значит потрачены ткань и
                # труд — такую поставку убирать нельзя, иначе работа пропадёт из учёта.
                cur.execute(
                    "SELECT sewing_status, count(*) FROM orders WHERE supply_id = %s "
                    "GROUP BY sewing_status",
                    (int(item_id),),
                )
                by_status = {r[0]: int(r[1]) for r in cur.fetchall()}
                # «Со склада» — заказ закрыт готовой вещью с полки, в цехе по нему не работали.
                # Такой заказ удалению не мешает: вещь просто вернётся на полку свободной.
                started = {st: n for st, n in by_status.items() if st not in ('Новый', 'Со склада')}
                if started:
                    parts = ', '.join(f'{st.lower()} — {n}' for st, n in started.items())
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'По поставке уже начали шить ({parts}). Удалить нельзя — '
                                      f'сначала отмените или доработайте эти заказы'},
                            ensure_ascii=False,
                        ),
                    }

                cur.execute(
                    "SELECT goods_warehouse_id FROM marketplace_supply_items WHERE supply_id = %s", (int(item_id),)
                )
                goods_ids = [r[0] for r in cur.fetchall()]
                for gid in goods_ids:
                    cur.execute(f"UPDATE goods_warehouse SET status = 'in_stock' WHERE id = {gid}")

                # Вещи, зарезервированные с полок под заказы этой поставки, возвращаем в
                # свободные — иначе они навсегда остались бы занятыми под удалённый заказ.
                cur.execute(
                    "UPDATE goods_warehouse SET reserved_order_id = NULL, matched_at = NULL, "
                    "shipping_labeled_at = NULL "
                    "WHERE reserved_order_id IN (SELECT id FROM orders WHERE supply_id = %s) "
                    "RETURNING id",
                    (int(item_id),),
                )
                freed_stock = len(cur.fetchall())

                # Несшитые заказы этой поставки удаляем вместе с ней: они существуют только
                # ради неё и без поставки повисли бы в конвейере мусором. Заказы «Со склада»
                # тоже удаляем — вещь уже освобождена выше и снова доступна другим заказам.
                cur.execute(
                    f"DELETE FROM orders WHERE supply_id = {int(item_id)} "
                    f"AND sewing_status IN ('Новый', 'Со склада')"
                )
                # rowcount может прийти -1, если удалять было нечего — приводим к нулю,
                # иначе в интерфейсе покажется «удалено -1 заказов».
                deleted_orders = max(0, cur.rowcount)

                cur.execute(f"DELETE FROM marketplace_supply_items WHERE supply_id = {int(item_id)}")
                cur.execute(f"DELETE FROM marketplace_supply_boxes WHERE supply_id = {int(item_id)}")
                cur.execute(f"DELETE FROM wb_supply_orders WHERE supply_id = {int(item_id)}")
                cur.execute(f"DELETE FROM marketplace_supplies WHERE id = {int(item_id)}")
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'deletedOrders': deleted_orders,
                        'freedFromStock': freed_stock,
                    }),
                }

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}