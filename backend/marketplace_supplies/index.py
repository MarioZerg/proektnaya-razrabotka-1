import base64
import json
import os
import uuid

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
    POST /  { action: 'add_items', supplyId, goodsWarehouseIds: [...] }
        - добавляет товары со склада в поставку, резервирует их (status='reserved')
        - используется для FBS (выбор товаров чекбоксами из списка)
    POST /  { action: 'scan_order', supplyId, orderNumber }
        - добавляет товар в поставку по ШТРИХКОДУ ХРАНЕНИЯ (параметр orderNumber по факту
          принимает storage_barcode из goods_warehouse — оставлено для совместимости фронтенда);
          используется для FBS: кладовщик заранее отбирает нужные товары на складе (раздел
          "Товар к подбору", action 'start_picking', статус picking), а здесь сканирует стикер
          хранения каждого отобранного товара, чтобы добавить его в конкретную поставку и
          перевести статус picking -> reserved
    POST /  { action: 'remove_item', itemId }
        - убирает товар из поставки, возвращает его на склад в статус 'picking' (он остаётся
          отобранным, но не привязанным к этой поставке)
    POST /  { action: 'create_box', supplyId }
        - создаёт новый короб в поставке (следующий по счёту номер), генерирует штрихкод
    POST /  { action: 'delete_box', boxId }
        - удаляет короб (разрешено только если в нём нет товаров)
    POST /  { action: 'add_order_to_box', boxId, orderNumber }
        - добавляет заказ в конкретный короб поставки: находит готовый товар на складе
          (goods_warehouse, status='in_stock') по номеру заказа, резервирует его и
          привязывает к коробу
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
          type='storekeeper_shift'). Ставка (salary_rates, role='storekeeper') берётся из
          тарифов цеха этой смены (workshop_id смены), либо из цеха профиля кладовщика, если
          у смены цех не указан. Не больше одного начисления на одну смену (shift_session_id)
    POST /  { action: 'force_complete', supplyId }
        - принудительное закрытие поставки в системе из любого статуса (кроме уже
          "Выполнена"): используется, если реальная поставка зависла на любом этапе
          из-за задержек API маркетплейса. Все товары переводятся в 'shipped',
          фиксируются все даты этапов, поставка сразу переходит в "Выполнена"
    POST /  { action: 'delete', id }
        - удаляет поставку (разрешено только для статуса "Открытая", товары возвращаются на склад)

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
                cur.execute(
                    "SELECT s.id, s.marketplace, s.type, s.status, s.comment, s.created_at, "
                    "s.supply_number, s.supply_barcode, s.cluster, s.gazelka_id, "
                    "s.ship_to_gazelka_at, s.ship_to_marketplace_at, s.completed_at, "
                    "s.created_by, u.full_name, s.total_quantity_marketplace, "
                    "s.pass_sticker_url, s.pass_sticker_name, "
                    "s.ozon_delivery_method, s.ozon_application_number, s.ozon_status, "
                    "s.supply_date, s.timeslot, s.shipment_type, s.packaging_type, "
                    "s.packaging_count, s.gazelka_pickup "
                    "FROM marketplace_supplies s "
                    "LEFT JOIN users u ON u.id = s.created_by "
                    "WHERE s.id = %s",
                    (int(supply_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}

                cur.execute(
                    "SELECT msi.id, msi.goods_warehouse_id, o.order_number, o.product, o.material, o.width, o.height, "
                    "gw.status, gw.shipped_at, msi.box_id "
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
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT id, box_number, barcode, created_at FROM marketplace_supply_boxes "
                    "WHERE supply_id = %s ORDER BY box_number",
                    (int(supply_id),),
                )
                boxes = [
                    {
                        'id': r[0],
                        'boxNumber': r[1],
                        'barcode': r[2],
                        'createdAt': r[3].isoformat() + 'Z',
                        'items': [it for it in items if it['boxId'] == r[0]],
                    }
                    for r in cur.fetchall()
                ]

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
                        "wso.wb_trbx_id, wso.sticker_url, wso.sticker_name, wso.scanned_at "
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
                        }
                        for r in cur.fetchall()
                    ]
                    # Готовые к отгрузке: готовые FBS-заказы WB, не привязанные ни к одной поставке.
                    cur.execute(
                        "SELECT COUNT(*) FROM orders o "
                        "WHERE o.marketplace = 'WB' AND o.order_type = 'FBS' AND o.sewing_status = 'Готовые' "
                        "AND NOT EXISTS (SELECT 1 FROM wb_supply_orders w WHERE w.order_id = o.id)"
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
                    'boxes': boxes,
                    'wbSupplyId': wb_supply_id,
                    'wbOrders': wb_orders,
                    'wbReadyCount': wb_ready_count,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'supply': detail})}

            status_filter = params.get('status')
            type_filter = params.get('type')
            marketplace_filter = params.get('marketplace')
            date_from = params.get('date_from')
            date_to = params.get('date_to')
            search = params.get('search')

            conditions = []
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
                f"u.full_name, s.ozon_delivery_method, s.ozon_application_number, s.ozon_status "
                f"FROM marketplace_supplies s "
                f"LEFT JOIN users u ON u.id = s.created_by "
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
                    'itemsCount': r[13],
                    'createdByName': r[14],
                    'ozonDeliveryMethod': r[15],
                    'ozonApplicationNumber': r[16],
                    'ozonStatus': r[17],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'supplies': supplies})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                marketplace = (body_data.get('marketplace') or '').strip()
                supply_type = (body_data.get('type') or 'FBS').strip()
                comment = (body_data.get('comment') or '').strip()
                created_by = body_data.get('createdBy')
                ozon_delivery_method = (body_data.get('ozonDeliveryMethod') or '').strip()

                if not marketplace:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите маркетплейс'})}
                if supply_type not in ('FBO', 'FBS'):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Тип поставки должен быть FBO или FBS'})}
                if marketplace == 'OZON' and supply_type == 'FBO' and ozon_delivery_method not in ('direct', 'cross_docking'):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите способ поставки: прямая или кросс-докинг'})}

                marketplace_esc = marketplace.replace("'", "''")
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

            if action == 'add_items':
                supply_id = body_data.get('supplyId')
                goods_ids = body_data.get('goodsWarehouseIds') or []
                if not supply_id or not goods_ids:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку и товары'})}

                cur.execute("SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if row[0] not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В эту поставку уже нельзя добавлять товары'})}

                for gid in goods_ids:
                    cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(gid),))
                    g_row = cur.fetchone()
                    if not g_row:
                        return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} не найден на складе'})}
                    if g_row[0] != 'in_stock':
                        return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} недоступен'})}
                    cur.execute(
                        f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id) VALUES ({int(supply_id)}, {int(gid)})"
                    )
                    cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {int(gid)}")

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

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
                cur.execute(
                    "SELECT gw.id, gw.status, o.order_number FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    f"WHERE gw.storage_barcode = '{barcode_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': f'Товар со штрихкодом {storage_barcode} не найден на складе'}),
                    }
                goods_id, goods_status, order_number = gw_row
                if goods_status != 'picking':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Товар {order_number or ""} не отобран к подбору (статус: {goods_status}) — '
                            'сначала отсканируйте его на складе в разделе "Товар к подбору"'
                        }),
                    }

                cur.execute(
                    "SELECT id FROM marketplace_supply_items WHERE supply_id = %s AND goods_warehouse_id = %s",
                    (int(supply_id), goods_id),
                )
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Заказ {order_number} уже в этой поставке'})}

                cur.execute(
                    f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id) VALUES ({int(supply_id)}, {goods_id})"
                )
                cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {goods_id}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'goodsWarehouseId': goods_id, 'orderNumber': order_number})}

            if action == 'remove_item':
                item_id = body_data.get('itemId')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите itemId'})}

                cur.execute(
                    "SELECT msi.goods_warehouse_id, s.status FROM marketplace_supply_items msi "
                    "JOIN marketplace_supplies s ON s.id = msi.supply_id WHERE msi.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
                goods_id, supply_status = row
                if supply_status not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Из этой поставки уже нельзя убрать товар'})}

                cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(item_id)}")
                cur.execute(f"UPDATE goods_warehouse SET status = 'picking' WHERE id = {int(goods_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

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

            if action == 'add_order_to_box':
                box_id = body_data.get('boxId')
                order_number = (body_data.get('orderNumber') or '').strip()
                if not box_id or not order_number:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите короб и номер заказа'})}

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

                order_number_esc = order_number.replace("'", "''")
                cur.execute(
                    "SELECT gw.id, gw.status FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.order_id "
                    f"WHERE o.order_number = '{order_number_esc}'"
                )
                gw_row = cur.fetchone()
                if not gw_row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': f'Заказ {order_number} не найден на складе готового товара (не готов или не принят)'}),
                    }
                goods_id, goods_status = gw_row
                if goods_status != 'in_stock':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Заказ {order_number} уже зарезервирован или отгружен'}),
                    }

                cur.execute(
                    "SELECT id FROM marketplace_supply_items WHERE supply_id = %s AND goods_warehouse_id = %s",
                    (supply_id, goods_id),
                )
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Заказ {order_number} уже в этой поставке'})}

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
                    "SELECT msi.goods_warehouse_id, s.status FROM marketplace_supply_items msi "
                    "JOIN marketplace_supplies s ON s.id = msi.supply_id WHERE msi.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
                goods_id, supply_status = row
                if supply_status not in ('Открытая', 'На сборке'):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Из этой поставки уже нельзя убрать товар'})}

                cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(item_id)}")
                cur.execute(f"UPDATE goods_warehouse SET status = 'in_stock' WHERE id = {int(goods_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

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

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нечего обновлять'})}

                cur.execute(f"UPDATE marketplace_supplies SET {', '.join(fields)} WHERE id = {int(supply_id)}")
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
                        if user_row and user_row[0] == 'storekeeper':
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
                                        "SELECT rate FROM salary_rates WHERE role = 'storekeeper' AND workshop_id = %s",
                                        (rate_workshop_id,),
                                    )
                                    rate_row = cur.fetchone()
                                    rate = float(rate_row[0]) if rate_row else 0
                                    if rate > 0:
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
                    f"ship_to_marketplace_at = COALESCE(ship_to_marketplace_at, now()) "
                    f"WHERE id = {int(supply_id)}"
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

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

                cur.execute(
                    "SELECT goods_warehouse_id FROM marketplace_supply_items WHERE supply_id = %s", (int(item_id),)
                )
                goods_ids = [r[0] for r in cur.fetchall()]
                for gid in goods_ids:
                    cur.execute(f"UPDATE goods_warehouse SET status = 'in_stock' WHERE id = {gid}")

                cur.execute(f"DELETE FROM marketplace_supply_items WHERE supply_id = {int(item_id)}")
                cur.execute(f"DELETE FROM marketplace_supply_boxes WHERE supply_id = {int(item_id)}")
                cur.execute(f"DELETE FROM wb_supply_orders WHERE supply_id = {int(item_id)}")
                cur.execute(f"DELETE FROM marketplace_supplies WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}