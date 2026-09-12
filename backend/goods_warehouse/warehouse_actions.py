"""Склад готового товара — действия: приёмка, полки, подбор, возвраты, списание.

Вынесено из index.py как есть: тело POST-ветки перенесено целиком, отступ снят
на один уровень. Логика, порядок проверок и тексты ответов не менялись.
"""

import json

import psycopg2

from shared import (
    OZON_CANCEL_REASONS,
    OZON_NOT_RETURNABLE,
    RESERVE_ALIVE_SQL,
    is_admin,
    is_admin_or_senior,
    log_action,
    log_return_history,
    next_storage_barcode,
    notify_admin,
    pick_shelf_for_item,
    resolve_ozon_barcode,
    try_match_orders_from_stock,
)
from exports import export_stock_ozon_xlsx, export_stock_wb_xlsx, export_stock_xlsx


def handle_post(event: dict, headers: dict, dsn: str) -> dict:
    """Действия склада: всё, что меняет состояние товара."""
    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    actor_id = body_data.get('actorId')
    actor_name = body_data.get('actorName')

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        # ВЫГРУЗКА ОТМЕЧЕННОГО ГАЛОЧКАМИ — методом POST, а не ссылкой.
        #
        # Менеджер отбирает на складе конкретные вещи (нужные размеры), и их
        # бывает несколько сотен. Список id такой длины в адресную строку не
        # влезает — часть браузеров и прокси режут её молча, и в файл попал бы
        # обрезанный отбор. В теле запроса ограничения нет.
        if action == 'export_stock':
            ids = body_data.get('ids') or []
            try:
                ids = [int(i) for i in ids]
            except (TypeError, ValueError):
                ids = []
            if not ids:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Отметьте товары галочками'}, ensure_ascii=False),
                }
            fmt = (body_data.get('format') or '').lower()
            if fmt == 'ozon':
                return export_stock_ozon_xlsx(cur, ids)
            if fmt == 'wb':
                return export_stock_wb_xlsx(cur, ids)
            return export_stock_xlsx(cur, body_data.get('marketplace') or '', ids)

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
                    # history_lost — вещь заведена руками, её прошлый путь
                    # системе неизвестен. Показывать по ней «возвратов: 0»
                    # нечестно: это не «новая вещь», а «мы не знаем».
                    # Кладовщик увидит пометку и осмотрит такую вещь.
                    "INSERT INTO goods_warehouse (order_id, shelf_id, status, storage_barcode, "
                    "receive_reason, history_lost) "
                    "VALUES (%s, %s, %s, %s, 'admin', TRUE) RETURNING id",
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
            # Полку здесь НЕ спрашиваем. Раньше стояла проверка «Выберите полку»,
            # оставшаяся от старого сценария, где вещь клали на полку в этот же
            # момент. Сейчас вещь уже лежит на своей полке и кладовщик просто
            # клеит на неё ярлык — полка в этом действии не участвует и нигде
            # ниже не используется.
            #
            # Из-за неё отметка о печати молча не проходила: кладовщик печатал
            # стикер, а сервер отвечал «Выберите полку». Ответ терялся, и на
            # «Отправить на поставку» вещь получала «Сначала напечатайте стикер
            # FBS» — замкнутый круг, из которого не было выхода (GW-724763).

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
            # Вещь без резерва — самая частая заминка на складе.
            #
            # На полке лежат две одинаковые вещи (один материал и размер), подбор
            # закрепил за заказом ОДНУ из них, а кладовщик снял с полки вторую. Вещи
            # неразличимы на глаз, и он честно сканирует ту, что взял, — а система
            # отвечает «стикеровать рано». Идти к полке и перебирать коды вслепую
            # бесполезно: какой именно код нужен, нигде не написано.
            #
            # Поэтому вместо отказа подсказываем: показываем код и полку той вещи,
            # которая ждёт этого заказа. Если такой товар ждёт заказ, а свободных
            # вещей больше нет — просто переносим резерв на отсканированную вещь:
            # физически они одинаковы, и заставлять человека искать «правильную»
            # смысла нет.
            if not reserved_order_id and gw_status in ('in_stock', 'picking'):
                cur.execute(
                    "SELECT gw.id, gw.storage_barcode, s.name, ro.order_number "
                    "FROM goods_warehouse gw "
                    "JOIN orders src ON src.id = gw.order_id "
                    "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                    "JOIN orders ro ON ro.id = gw.reserved_order_id "
                    "WHERE src.product = %s AND gw.reserved_order_id IS NOT NULL "
                    "  AND gw.status IN ('in_stock', 'picking') "
                    "  AND gw.shipping_labeled_at IS NULL "
                    # Вещь уже уехала бы в коробе — её резерв трогать нельзя.
                    "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                    "     JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                    "     WHERE msi.goods_warehouse_id = gw.id "
                    "       AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                    "ORDER BY gw.matched_at ASC LIMIT 1",
                    (gw_product,),
                )
                twin = cur.fetchone()
                if twin:
                    # Переносим резерв на вещь, которая У КЛАДОВЩИКА В РУКАХ.
                    #
                    # Гонять человека обратно к полке незачем: вещи одинаковые по
                    # материалу и размеру, покупателю уедет ровно то же самое. А вот
                    # тупик реальный: без переноса он не может отстикеровать ни ту,
                    # что взял (нет резерва), ни быстро найти нужную среди похожих.
                    twin_id, _tw_bc, _tw_shelf, twin_order = twin
                    cur.execute(
                        "UPDATE goods_warehouse SET reserved_order_id = NULL, "
                        "matched_at = NULL, status = 'in_stock' WHERE id = %s",
                        (twin_id,),
                    )
                    cur.execute(
                        "SELECT id FROM orders WHERE fulfilled_from_stock_id = %s",
                        (twin_id,),
                    )
                    wait_row = cur.fetchone()
                    wait_order_id = wait_row[0] if wait_row else None
                    cur.execute(
                        "UPDATE goods_warehouse SET reserved_order_id = %s, "
                        "matched_at = now() WHERE id = %s",
                        (wait_order_id, int(gw_id)),
                    )
                    if wait_order_id:
                        cur.execute(
                            "UPDATE orders SET fulfilled_from_stock_id = %s WHERE id = %s",
                            (int(gw_id), wait_order_id),
                        )
                    log_action(
                        cur, actor_id, actor_name, 'rematch', 'goods_warehouse', gw_id,
                        f'Перенёс заказ #{twin_order} на вещь в руках ({scan_barcode}) '
                        f'вместо равнозначной со склада',
                    )
                    conn.commit()
                    # Дальше идём обычным путём: вещь теперь подобрана под заказ,
                    # ярлык печатается как всегда.
                    reserved_order_id = wait_order_id
                    target_number = twin_order
                else:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Эта вещь не подобрана ни под один заказ — '
                                     'стикеровать её рано',
                        }, ensure_ascii=False),
                    }
            elif not reserved_order_id:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Эта вещь не подобрана ни под один заказ — '
                                 'стикеровать её рано',
                    }, ensure_ascii=False),
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

            # Вещь из СВЯЗКИ Яндекса получает свой стикер YM-… .
            #
            # У связки ярлык маркетплейса ОДИН на все вещи: на каждой наклейке
            # один и тот же номер грузоместа и «1/1». Отсканировать им четыре
            # разные вещи невозможно, поэтому связку собирают по этому коду —
            # он у каждой вещи свой.
            #
            # Отдельный код, а не складской GW-: складской означает «лежит на
            # полке хранения», и два похожих стикера на одной вещи кладовщик
            # путает. YM ни с чем не спутать — увидел, значит собираешь связку.
            bundle_barcode = None
            cur.execute(
                "SELECT o.group_key, COALESCE(o.group_size, 1), o.group_position "
                "FROM orders o WHERE o.id = %s",
                (reserved_order_id,),
            )
            g_row = cur.fetchone()
            if g_row and g_row[0] and g_row[1] > 1:
                cur.execute(
                    "SELECT bundle_barcode FROM goods_warehouse WHERE id = %s",
                    (int(gw_id),),
                )
                b_row = cur.fetchone()
                bundle_barcode = b_row[0] if b_row else None
                if not bundle_barcode:
                    # Код повторяет номер заказа и позицию вещи в нём:
                    # «YM-60603398529-2». По нему сразу видно, из какой связки
                    # вещь и какая она по счёту — это читается и глазами.
                    bundle_barcode = f"{g_row[0]}-{g_row[2] or 1}"
                    cur.execute(
                        "UPDATE goods_warehouse SET bundle_barcode = %s WHERE id = %s",
                        (bundle_barcode, int(gw_id)),
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
                    # Стикер связки: если он есть, терминал печатает его вторым —
                    # именно им кладовщик соберёт связку в поставку.
                    'bundleBarcode': bundle_barcode,
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
            if not scan_barcode:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте стикер хранения'})}

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

            # Полку выбирает система: однотипное кладём вместе, ходовое ближе,
            # заполненную полку (50 вещей) пропускаем. Кладовщику остаётся
            # только отсканировать стикер и отнести вещь туда, куда сказали.
            shelf_id, shelf_name, shelf_reason = pick_shelf_for_item(cur, gw_id)
            if not shelf_id:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': shelf_reason}, ensure_ascii=False),
                }

            cur.execute(
                f"UPDATE goods_warehouse SET status = 'in_stock', shelf_id = {int(shelf_id)}, "
                f"received_at = now() WHERE id = {gw_id}"
            )
            log_action(
                cur, actor_id, actor_name, 'place_on_shelf', 'goods_warehouse', gw_id,
                f'Положил на полку {shelf_name} ({shelf_reason}): '
                f'заказ #{gw_order_number} ({scan_barcode})',
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
                    'shelfReason': shelf_reason,
                    'autoMatched': len(auto_matched),
                }, ensure_ascii=False),
            }

        if action == 'place_inspected_batch':
            # Кладовщик забирает осмотренные возвраты с производства и раскладывает их
            # по полкам. Раскладка идёт «пачками»: выбрал полку, пикнул несколько вещей,
            # сменил полку, пикнул ещё — и один раз нажал «Положить на полки хранения».
            # Так вещи не путаются по местам, а сервер дёргается один раз вместо тридцати.
            # Полку кладовщик больше не выбирает — её назначает система. Сюда
            # приходит просто список отсканированных стикеров, а куда лечь каждой
            # вещи, решает pick_shelf_for_item: однотипное вместе, ходовое ближе,
            # заполненную полку (50 вещей) пропускаем.
            #
            # Старый формат groups=[{shelfId, barcodes}] поддерживаем на случай,
            # если у кладовщика открыта прежняя версия страницы: полку из него
            # игнорируем и берём только штрихкоды.
            codes = body_data.get('barcodes') or []
            if not codes:
                for g in (body_data.get('groups') or []):
                    codes.extend(g.get('barcodes') or [])
            if not codes:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте вещи'})}

            placed, errors = [], []
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

                shelf_id, shelf_name, shelf_reason = pick_shelf_for_item(cur, gid)
                if not shelf_id:
                    errors.append({'barcode': code, 'error': shelf_reason})
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
                    'shelfReason': shelf_reason,
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

            # ОТМЕНА ПОСЛЕ СТИКЕРОВКИ В ЦЕХ НЕ ЕДЕТ — ОНА ОТТУДА И ПРИШЛА.
            #
            # Вещь сшили, упаковали и заклеили ярлыком прямо в цехе, и уже после
            # этого покупатель отменил заказ. Осматривать у упаковщицы нечего: она
            # же её десять минут назад и собирала. Отправить такую «на осмотр» —
            # значит вернуть вещь туда, откуда её только что принесли, и потерять
            # день на пустой круг. Путь один: полка со стикером хранения.
            cur.execute(
                f"SELECT COUNT(*) FROM goods_warehouse "
                f"WHERE id IN ({ids_csv}) AND receive_reason = 'cancelled_labeled'"
            )
            cancelled_labeled_count = int(cur.fetchone()[0] or 0)
            if cancelled_labeled_count:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Отмена после стикеровки в цехе ({cancelled_labeled_count} шт.) '
                                 f'на осмотр не отправляется — вещь пришла из цеха и уже '
                                 f'упакована. Положите её на полку со стикером хранения'
                    }, ensure_ascii=False),
                }

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

            # ОТМЕНА ПОСЛЕ СТИКЕРОВКИ В УТИЛЬ НЕ ИДЁТ.
            #
            # Это наша собственная вещь: её сшили, упаковали и заклеили ярлыком
            # маркетплейса, и уже после этого покупатель отменил заказ. К нему она
            # не уезжала, руками её никто не мял — брака тут взяться неоткуда.
            # У такой вещи один путь: полка со стикером хранения, откуда её
            # подберут под следующий заказ. Списать её в утиль — просто выбросить
            # новый товар.
            cur.execute(
                f"SELECT COUNT(*) FROM goods_warehouse "
                f"WHERE id IN ({ids_csv}) AND receive_reason = 'cancelled_labeled'"
            )
            cancelled_labeled_count = int(cur.fetchone()[0] or 0)
            if cancelled_labeled_count:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Отмена после стикеровки в цехе ({cancelled_labeled_count} шт.) '
                                 f'на утилизацию не отправляется — вещь новая, к покупателю '
                                 f'не уезжала. Положите её на полку со стикером хранения'
                    }, ensure_ascii=False),
                }

            reason_esc = reason.replace("'", "''")
            cur.execute(
                f"UPDATE goods_warehouse SET status = 'to_dispose', "
                f"dispose_reason = '{reason_esc}', reserved_order_id = NULL, shelf_id = NULL "
                f"WHERE id IN ({ids_csv}) RETURNING id"
            )
            moved = len(cur.fetchall())
            # ЗАКРЫВАЕМ И САМУ ЗАЯВКУ ВОЗВРАТА.
            #
            # Раньше менялся только статус вещи на складе, а заявка возврата
            # оставалась как есть. В отчёте по возвратам такая вещь продолжала
            # числиться «на складе» или «на перепаковке», хотя её уже списали —
            # цифры расходились с реальностью, и было непонятно, сколько товара
            # мы на самом деле потеряли.
            cur.execute(
                "UPDATE marketplace_returns SET status = 'processed', "
                "outcome = 'utilized', outcome_at = now(), outcome_by = %s, "
                "damage_note = COALESCE(damage_note, %s) "
                f"WHERE goods_warehouse_id IN ({ids_csv})",
                (int(actor_id) if actor_id else None, reason),
            )
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
            # Тот же код без ведущей «*»: на стикере WB штрихкод печатается со
            # звёздочкой (*DWto4dQG), а сканеры в разных режимах отдают его то с
            # ней, то без. Ищем по обоим написаниям, чтобы кладовщик не разбирался.
            bare_esc = order_number.lstrip('*').replace("'", "''")

            # ПРИНИМАЕМ ВОЗВРАТ ЛЮБОЙ ПЛОЩАДКИ, А НЕ ТОЛЬКО OZON.
            #
            # Раньше искали лишь по нашему номеру заказа и номеру отправления OZON.
            # Возврат WB или Яндекса кладовщик отсканировать не мог: система
            # отвечала «заказ не найден», и такие вещи заводили руками или они
            # вовсе оставались вне учёта.
            #
            # Что печатается на возвратах:
            #   OZON   — номер отправления (ozon_posting_number);
            #   WB     — код стикера вида *DWto4dQG (wb_sticker_barcode) и
            #            номер сборочного задания цифрами (wb_order_id);
            #   Яндекс — номер заказа покупателя (ym_order_id), а у нас он лежит
            #            внутри своего номера: YM-61355128771-1.
            # Числовые поля сравниваем как текст: сканер отдаёт строку.
            #
            # ПОРЯДОК ВЫБОРА. Связка Яндекса — это несколько вещей с ОДНИМ номером
            # заказа, поэтому совпадений может быть много. Берём ту вещь, которая
            # ещё не принята как возврат: кладовщик сканирует один номер столько
            # раз, сколько вещей у него в руках, и каждый скан принимает следующую.
            cur.execute(
                f"SELECT o.id FROM orders o "
                f"LEFT JOIN goods_warehouse gw ON gw.order_id = o.id "
                f"WHERE o.order_number = '{order_number_esc}' "
                f"   OR o.ozon_posting_number = '{order_number_esc}' "
                f"   OR o.wb_sticker_barcode = '{order_number_esc}' "
                f"   OR o.wb_sticker_barcode = '{bare_esc}' "
                f"   OR o.wb_sticker_barcode = '*{bare_esc}' "
                f"   OR CAST(o.wb_order_id AS TEXT) = '{bare_esc}' "
                f"   OR CAST(o.ym_order_id AS TEXT) = '{bare_esc}' "
                # Сначала точное попадание в наш номер, затем ещё не принятые вещи.
                f"ORDER BY (o.order_number = '{order_number_esc}') DESC, "
                f"         (gw.id IS NULL OR gw.status <> 'mp_return') DESC, o.id "
                f"LIMIT 1"
            )
            order_row = cur.fetchone()
            if not order_row:
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Заказ {order_number} не найден. Отсканируйте номер '
                                 f'отправления OZON, код стикера WB или номер заказа '
                                 f'Яндекс Маркета'
                    }, ensure_ascii=False),
                }
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
                # Пишем возврат в историю вещи — по ней кладовщик поймёт,
                # что вещь ездит к покупателям не первый раз.
                times = log_return_history(
                    cur, gw_id, order_id, actor_id, actor_name,
                    mp_return_id=body_data.get('marketplaceReturnId'),
                    return_reason=body_data.get('returnReason'),
                )
                log_action(cur, actor_id, actor_name, 'receive_return', 'goods_warehouse', gw_id, f'Принял возврат заказа #{order_number} повторно (возврат №{times})')
                conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'id': gw_id, 'storageBarcode': storage_barcode,
                                            'returnCount': times})}

            storage_barcode = next_storage_barcode(cur)
            cur.execute(
                f"INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
                f"VALUES ({order_id}, 'mp_return', '{storage_barcode}', 'return') RETURNING id"
            )
            new_id = cur.fetchone()[0]
            times = log_return_history(
                cur, new_id, order_id, actor_id, actor_name,
                mp_return_id=body_data.get('marketplaceReturnId'),
                return_reason=body_data.get('returnReason'),
            )
            log_action(cur, actor_id, actor_name, 'receive_return', 'goods_warehouse', new_id, f'Принял возврат заказа #{order_number} ({storage_barcode})')
            conn.commit()
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'id': new_id, 'storageBarcode': storage_barcode,
                                        'returnCount': times})}

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
            cur.execute(
                "SELECT gw.order_id, gw.status, "
                "       (COALESCE(o.ozon_status, '') = 'cancelled' OR o.cancelled_at IS NOT NULL) "
                "FROM goods_warehouse gw LEFT JOIN orders o ON o.id = gw.order_id "
                "WHERE gw.id = %s",
                (int(item_id),),
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Запись не найдена'})}
            if row[1] not in ('in_stock', 'picking'):
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Товар уже зарезервирован/отгружен, вернуть нельзя'})}
            # ОТМЕНЁННЫЙ ЗАКАЗ В ЦЕХ НЕ ВОЗВРАЩАЕМ.
            #
            # Возврат сбрасывает заказ обратно в «В работе», и цех начинает шить
            # для покупателя, который уже отказался: тратится ткань и рабочее
            # время, а платить за вещь некому. Кнопку на складе мы спрятали, но
            # запрет должен стоять и здесь — на случай старой открытой вкладки.
            if row[2]:
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заказ отменён покупателем — возвращать вещь в цех нельзя. Оставьте её на полке: она уйдёт следующему заказу с такими же размерами'})}
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
                    # Эту вещь кладовщик держит в руках — помечаем подтверждённой,
                    # иначе сканер отдал бы её заказ следующей такой же вещи и
                    # выдал лишний успех на уже закрытую потребность.
                    cur.execute(
                        "UPDATE goods_warehouse SET picked_confirmed_at = now(), "
                        f"picked_confirmed_by = {int(actor_id) if actor_id else 'NULL'} "
                        f"WHERE id = {int(gw_id)} AND picked_confirmed_at IS NULL"
                    )
                    conn.commit()
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

            # 3а. Заказ ждёт такой же товар, но держит ДРУГУЮ вещь.
            #
            # Это главный случай на складе. Кладовщик идёт вдоль стеллажа с
            # нужным размером в руках, а система закрепила за заказом соседнюю,
            # физически неотличимую вещь. Раньше сканер отвечал «мимо» — и
            # человек шёл искать конкретный номер, хотя товар уже был у него.
            #
            # Теперь переносим подбор на вещь В РУКАХ. А чтобы это не
            # превратилось в бесконечный успех (подбор просто переезжал с вещи
            # на вещь, а количество не менялось), забираем работу ТОЛЬКО у
            # вещи, которую ещё не подтвердили сканером и не отстикеровали.
            # Нужно 2 штуки — сканер даст ровно 2 успеха, третий уже «мимо».
            cur.execute(
                "SELECT twin.id, ro.id, ro.order_number "
                "FROM goods_warehouse twin "
                "JOIN orders src ON src.id = twin.order_id "
                "JOIN orders ro ON ro.id = twin.reserved_order_id "
                f"WHERE src.product = '{prod_esc}' "
                f"  AND twin.id <> {int(gw_id)} "
                "  AND twin.status IN ('in_stock', 'picking') "
                # Вещь уже подтверждена кладовщиком или отстикерована — работа
                # на ней закончена, отбирать её нельзя.
                #
                # Подтверждение засчитываем, только если оно СВЕЖЕЕ последнего
                # закрепления (picked_confirmed_at >= matched_at). Так отметка
                # чистится сама: вещь освободили и позже подобрали под другой
                # заказ — matched_at обновился, старое подтверждение сгорело.
                # Иначе пришлось бы вручную сбрасывать отметку в двух десятках
                # мест, где вещь освобождается (списание, потеря, отмена,
                # разбор поставки), и одно забытое место навсегда выключило бы
                # вещь из подбора.
                "  AND (twin.picked_confirmed_at IS NULL "
                "       OR twin.matched_at IS NULL "
                "       OR twin.picked_confirmed_at < twin.matched_at) "
                "  AND twin.shipping_labeled_at IS NULL "
                "  AND twin.shipped_at IS NULL "
                # Вещь уже уехала бы в коробе — её резерв трогать нельзя.
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "     JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "     WHERE msi.goods_warehouse_id = twin.id "
                "       AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                "  AND ro.marketplace <> 'Yandex' "
                f"  AND {RESERVE_ALIVE_SQL} "
                "ORDER BY twin.matched_at ASC, twin.id ASC LIMIT 1"
            )
            twin = cur.fetchone()
            if twin:
                twin_id, twin_order_id, twin_order_number = twin
                # Прежняя вещь возвращается в свободный остаток.
                cur.execute(
                    "UPDATE goods_warehouse SET reserved_order_id = NULL, "
                    f"matched_at = NULL, status = 'in_stock' WHERE id = {int(twin_id)}"
                )
                # Работа переезжает на вещь в руках и сразу помечается
                # подтверждённой — второй раз этот заказ уже не отдадим.
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'picking', "
                    "reserved_order_id = %s, matched_at = now(), "
                    "picked_confirmed_at = now(), picked_confirmed_by = %s, "
                    "shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                    "shipping_labeled_by_name = NULL WHERE id = %s",
                    (int(twin_order_id), actor_id, int(gw_id)),
                )
                cur.execute(
                    "UPDATE orders SET fulfilled_from_stock_id = %s WHERE id = %s",
                    (int(gw_id), int(twin_order_id)),
                )
                log_action(
                    cur, actor_id, actor_name, 'scan_picking', 'goods_warehouse',
                    gw_id,
                    f'Заказ #{twin_order_number} перенесён на вещь в руках '
                    f'({barcode}) вместо равнозначной со склада',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                    'matched': True, 'goodsId': gw_id, 'product': gw_product,
                    'shelfName': gw_shelf, 'orderNumber': twin_order_number,
                    'reassigned': True,
                }, ensure_ascii=False)}

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
                # Заказы Яндекса складом не закрываются: у них один ярлык на весь
                # заказ, и подбор для них отключён. Сюда они попасть не должны даже
                # случайно — иначе вещь уедет под заказ, который шьётся в цехе.
                "  AND ro.marketplace <> 'Yandex' "
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
                    # Снимаем ярлык прошлого отправления: вещь уходит под НОВЫЙ
                    # заказ, и старая наклейка на ней недействительна.
                    "UPDATE goods_warehouse SET status = 'picking', "
                    "reserved_order_id = %s, matched_at = now(), "
                    "picked_confirmed_at = now(), picked_confirmed_by = %s, "
                    "shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                    "shipping_labeled_by_name = NULL WHERE id = %s",
                    (int(orphan_id), actor_id, int(gw_id)),
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
            # Отстикерованную вещь так списывать нельзя — см. пояснение в
            # send_to_sewing: ярлык маркетплейса живой, покупатель ждёт посылку.
            if nf_status == 'awaiting_supply':
                return {
                    'statusCode': 409, 'headers': headers,
                    'body': json.dumps(
                        {'error': 'Вещь отстикерована и ждёт поставки — сначала уберите её '
                                  'с поставки'},
                        ensure_ascii=False),
                }

            # Сколько дней вещь числилась на складе. Чем дольше — тем серьёзнее
            # расхождение: месячный «висяк» админ должен увидеть отдельно.
            cur.execute(
                "SELECT GREATEST(0, ((now() + interval '3 hours')::date - %s::date))",
                (nf_received,)
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
            # ВЕЩЬ УЖЕ ОТСТИКЕРОВАНА И ЕДЕТ В ПОСТАВКУ.
            #
            # На ней наклеен ярлык маркетплейса, покупатель ждёт посылку.
            # «Отправить в пошив» списывает вещь со склада и гонит заказ в цех
            # заново — то есть на руках у кладовщика остаётся пакет с живым
            # ярлыком, которого в системе больше нет, а цех шьёт второй товар
            # на то же отправление. Сначала надо снять вещь с поставки.
            if gw_status == 'awaiting_supply':
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Вещь отстикерована и ждёт поставки. Сначала уберите её '
                                  'с поставки, потом отправляйте в пошив'},
                        ensure_ascii=False,
                    ),
                }
            # ВЕЩЬ ПРОСТО ЛЕЖИТ НА ХРАНЕНИИ — ШИТЬ ЗАНОВО НЕЧЕГО.
            #
            # «Отправить в пошив» задумана для вещи, которую кладовщик держит
            # в руках при сборке заказа и видит на ней брак: вещь списывается,
            # а ЗАКАЗ уходит в цех шиться заново. У свободной вещи на полке
            # заказа нет — списание просто уничтожало бы товар со склада без
            # всякой замены, и остаток расходился с полкой.
            #
            # Свободный брак оформляется через утилизацию, а не через пошив.
            if not reserved_order_id and gw_status in ('in_stock', 'awaiting_shelf'):
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Вещь лежит на хранении и не подобрана под заказ — '
                                  'шить заново нечего. Бракованную вещь с полки '
                                  'отправляйте на утилизацию'},
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

        if action == 'release_stuck_cancelled':
            # Вернуть в оборот вещи, зависшие под отменёнными заказами.
            #
            # Заказ НЕ трогаем: он остаётся на конвейере и доводится до конца —
            # это рабочее правило. Работаем только с физической вещью: снимаем
            # ярлык недействительного отправления и возвращаем её в свободный
            # остаток, чтобы её подобрали под нового покупателя.
            #
            # Вещь с известной полкой сразу становится «На хранении». Если полка
            # неизвестна — вещь идёт в очередь на раскладку: ставить «На хранении»
            # без полки нельзя, иначе она числится на складе «нигде» и кладовщик
            # её не найдёт.
            ids = body_data.get('ids') or []
            if not ids:
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Выберите вещи'})}
            ids_csv = ','.join(str(int(i)) for i in ids)

            # Ещё раз проверяем условие зависания на стороне сервера: список на
            # экране мог устареть, а вещь за это время уехать под живой заказ.
            # Отдать её тогда в свободный остаток — сорвать чужое отправление.
            cur.execute(
                "SELECT gw.id, gw.shelf_id FROM goods_warehouse gw "
                "JOIN orders so ON so.id = gw.order_id "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                f"WHERE gw.id IN ({ids_csv}) "
                "  AND gw.status IN ('picking', 'awaiting_supply', 'reserved') "
                "  AND gw.shipped_at IS NULL "
                "  AND (COALESCE(so.ozon_status, '') LIKE 'cancel%' "
                "       OR COALESCE(so.ym_status, '') ILIKE 'cancel%' "
                "       OR COALESCE(so.status, '') = 'Отменён') "
                "  AND (gw.reserved_order_id IS NULL "
                "       OR COALESCE(ro.ozon_status, '') LIKE 'cancel%' "
                "       OR COALESCE(ro.ym_status, '') ILIKE 'cancel%' "
                "       OR COALESCE(ro.status, '') = 'Отменён') "
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "        JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "        WHERE msi.goods_warehouse_id = gw.id "
                "          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'))"
            )
            rows = cur.fetchall()
            if not rows:
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps(
                    {'released': 0, 'toShelf': 0, 'toSorting': 0}, ensure_ascii=False)}

            with_shelf = [str(int(r[0])) for r in rows if r[1] is not None]
            no_shelf = [str(int(r[0])) for r in rows if r[1] is None]

            if with_shelf:
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', "
                    "  reserved_order_id = NULL, matched_at = NULL, "
                    "  shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                    "  shipping_labeled_by_name = NULL "
                    f"WHERE id IN ({','.join(with_shelf)})"
                )
            if no_shelf:
                # СТАТУС 'mp_return' («Разобрать возвраты»), А НЕ 'inspected'.
                #
                # 'inspected' означает «упаковщица осмотрела вещь В ЦЕХЕ и наклеила
                # стикер хранения» — по нему собирается вкладка «Принять осмотренные
                # из цеха». Ставя его здесь, мы отправляли туда вещи, которых в цехе
                # нет и которые никто не осматривал: кладовщик шёл забирать тележку,
                # а забирать нечего.
                #
                # Это ОТМЕНА ПОСЛЕ СТИКЕРОВКИ: вещь уже сшита, упакована и заклеена
                # ярлыком маркетплейса, а заказ отменили. В цех она не возвращается —
                # кладовщик встречает её при сборке FBS. Дальше с ней делают ровно то
                # же, что с возвратом: кладут на полку и печатают стикер хранения.
                # Поэтому место ей во вкладке «Разобрать возвраты», где этот
                # инструмент уже есть.
                #
                # receive_reason помечает причину: кладовщик видит, что вещь не
                # приехала от покупателя, а отменилась у нас после стикеровки.
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'mp_return', "
                    "  receive_reason = 'cancelled_labeled', "
                    "  reserved_order_id = NULL, matched_at = NULL, "
                    "  shipping_labeled_at = NULL, shipping_labeled_by = NULL, "
                    "  shipping_labeled_by_name = NULL "
                    f"WHERE id IN ({','.join(no_shelf)})"
                )

            # Обратная ссылка у отменённого заказа больше не действительна: вещь
            # его не закрывает. Сам заказ при этом остаётся на конвейере.
            all_ids = ','.join(str(int(r[0])) for r in rows)
            cur.execute(
                f"UPDATE orders SET fulfilled_from_stock_id = NULL "
                f"WHERE fulfilled_from_stock_id IN ({all_ids})"
            )

            for r in rows:
                log_action(
                    cur, actor_id, actor_name, 'release_stuck', 'goods_warehouse', r[0],
                    'Возвращена в оборот: заказ отменён на маркетплейсе, '
                    'ярлык отправления снят',
                )
            # ДАННЫЕ ДЛЯ СТИКЕРОВ ХРАНЕНИЯ.
            #
            # На вещи висит ярлык маркетплейса, который мы только что
            # аннулировали, а складского стикера у неё нет. Без него вещь
            # ложится на полку неопознанной: отсканировать её в подбор
            # потом нечем. Кладовщик должен снять ярлык и наклеить стикер
            # хранения, поэтому отдаём всё нужное для печати ленты сразу.
            cur.execute(
                "SELECT gw.storage_barcode, o.product, o.material, o.width, o.height, "
                "       o.order_number "
                "FROM goods_warehouse gw LEFT JOIN orders o ON o.id = gw.order_id "
                f"WHERE gw.id IN ({all_ids}) ORDER BY gw.id"
            )
            stickers = [
                {
                    'storageBarcode': s[0],
                    'title': (f'{s[2]} {s[3]}x{s[4]}' if s[2] and s[3] and s[4] else s[1]),
                    'orderNumber': s[5],
                }
                for s in cur.fetchall()
            ]

            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                'released': len(rows),
                'toShelf': len(with_shelf),
                'toSorting': len(no_shelf),
                'stickers': stickers,
            }, ensure_ascii=False)}

        if action == 'close_shipped_stuck':
            # ЗАКРЫТЬ ВЕЩИ, КОТОРЫЕ УЖЕ УЕХАЛИ К КЛИЕНТУ.
            #
            # Отправление ушло со склада (курьер забрал, едет или доставлено), а у нас
            # вещь так и висит в подборе: её забыли отсканировать в короб. Искать её
            # на полке бессмысленно — физически она у покупателя.
            #
            # Помечаем вещь отгруженной: работа по ней закончена, из подбора она
            # уходит. Заказ не трогаем — он уже закрыт маркетплейсом.
            #
            # Решение принимает администратор или старший кладовщик: обычный
            # кладовщик не должен закрывать позиции, не подержав вещь в руках.
            if not is_admin_or_senior(cur, actor_id):
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps(
                    {'error': 'Закрывать уехавшие вещи может администратор '
                              'или старший кладовщик'}, ensure_ascii=False)}

            ids = body_data.get('ids') or []
            if not ids:
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Выберите вещи'}, ensure_ascii=False)}
            ids_csv = ','.join(str(int(i)) for i in ids)

            # Проверяем условие ещё раз на сервере: список на экране мог устареть,
            # а вещь за это время вернуться в работу. Закрыть живую позицию —
            # значит потерять вещь со склада.
            cur.execute(
                "SELECT gw.id FROM goods_warehouse gw "
                "JOIN orders o ON o.id = gw.reserved_order_id "
                f"WHERE gw.id IN ({ids_csv}) "
                "  AND gw.status IN ('picking', 'awaiting_supply') "
                "  AND gw.shipped_at IS NULL "
                "  AND (COALESCE(o.ozon_status, '') IN "
                "         ('delivering', 'delivered', 'driver_pickup') "
                "       OR COALESCE(o.status, '') IN ('Отгружен', 'Доставлен')) "
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "        JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "        WHERE msi.goods_warehouse_id = gw.id "
                "          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'))"
            )
            rows = cur.fetchall()
            if not rows:
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'closed': 0}, ensure_ascii=False)}

            ok_ids = ','.join(str(int(r[0])) for r in rows)
            cur.execute(
                "UPDATE goods_warehouse SET status = 'shipped', shipped_at = now() "
                f"WHERE id IN ({ok_ids})"
            )
            for r in rows:
                log_action(
                    cur, actor_id, actor_name, 'close_shipped', 'goods_warehouse', r[0],
                    'Закрыта вручную: отправление уже уехало к клиенту, '
                    'вещь не отсканирована в короб',
                )
            conn.commit()
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'closed': len(rows)}, ensure_ascii=False)}

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

            # Возвращаем и списанные, и отправленные на утилизацию.
            #
            # На утилизацию вещь нередко уходит не потому, что она бракованная, а
            # потому что её не могут найти: числится за складом, а на полке пусто.
            # Потом вещь находится — лежала не на своём месте или её отложили и
            # забыли. Раньше вернуть её было нечем: возврат работал только для
            # статуса «утеряно», и приходилось заводить вещь заново с новым
            # стикером, обрывая историю движения.
            if rl_status not in ('lost', 'to_dispose'):
                return {
                    'statusCode': 409, 'headers': headers,
                    'body': json.dumps(
                        {'error': 'Вернуть на полку можно только списанный товар '
                                  'или отправленный на утилизацию'},
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
                    # Снимаем и пометку утилизации: вещь вернулась в оборот
                    # целой, причина списания к ней больше не относится.
                    "dispose_reason = NULL, "
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
                    # Снимаем и пометку утилизации: вещь вернулась в оборот
                    # целой, причина списания к ней больше не относится.
                    "dispose_reason = NULL, "
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

            # Заявка возврата тоже возвращается в оборот: вещь нашлась и лежит
            # на полке, а в отчёте она значилась утилизированной. Иначе цифры
            # по возвратам остались бы завышенными на найденный товар.
            cur.execute(
                "UPDATE marketplace_returns SET outcome = 'stored', "
                "outcome_at = now(), outcome_by = %s, damage_note = NULL "
                "WHERE goods_warehouse_id = %s AND outcome = 'utilized'",
                (int(actor_id) if actor_id else None, int(item_id)),
            )

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

