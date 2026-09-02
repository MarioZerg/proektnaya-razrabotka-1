"""Чтение поставок: список, карточка, кандидаты в поставку и сводка для дашборда.

Вынесено из index.py без изменений. Чтение отделено от действий намеренно: запросы
здесь только читают, и при разборе ошибки сборки этот файл можно не открывать вовсе.
"""

import json
from datetime import datetime

import psycopg2

from shared import (
    GOODS_READY_FOR_SUPPLY_SQL,
    compute_order_status,
    release_stale_supply_locks,
)


def handle_get(event: dict, headers: dict, dsn: str) -> dict:
    """Обрабатывает GET-запросы модуля поставок."""
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
                    'supplyDate': (r[8].isoformat() + 'Z') if r[8] else None,
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

            # Показываем номер ТОГО заказа, под который вещь реально едет
            # (reserved_order_id), а не заказа, в котором её когда-то сшили.
            # Вещь с полки закрывает новый заказ покупателя: кладовщик сканирует
            # её ярлык, а в списке видел старый номер — казалось, что товара
            # в поставке нет, хотя он там был.
            cur.execute(
                "SELECT msi.id, msi.goods_warehouse_id, "
                "COALESCE(ro.order_number, o.order_number), "
                "COALESCE(ro.product, o.product), COALESCE(ro.material, o.material), "
                "COALESCE(ro.width, o.width), COALESCE(ro.height, o.height), "
                "gw.status, gw.shipped_at, msi.box_id, "
                "COALESCE(ro.group_key, o.group_key), "
                "COALESCE(ro.group_size, o.group_size), "
                "COALESCE(ro.group_position, o.group_position), "
                "COALESCE(ro.status, o.status), "
                "COALESCE(ro.ozon_status, o.ozon_status), "
                "COALESCE(ro.ym_status, o.ym_status), gw.storage_barcode, gw.shelf_id, "
                "COALESCE(ro.marketplace, o.marketplace), gw.shipping_labeled_by_name, "
                # Стикер связки — им вещь сканируют в поставку.
                "gw.bundle_barcode "
                "FROM marketplace_supply_items msi "
                "LEFT JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                "LEFT JOIN orders o ON o.id = gw.order_id "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
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
                    # Статус вещи НА САМОЙ ПЛОЩАДКЕ: по нему видно, куда движется
                    # отправление — в отгрузку или в отмену. Раньше кладовщик видел
                    # только наш внутренний статус и узнавал об отмене слишком поздно.
                    'marketplace': r[18],
                    'mpStatus': r[14] or r[15],
                    # Кто наклеил ярлык отправления на эту вещь.
                    'labeledByName': r[19],
                    # Стикер связки: им вещь сканируется в поставку, потому что
                    # ярлык маркетплейса у связки один на все вещи.
                    'bundleBarcode': r[20],
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
                # Берём связки, у которых хотя бы одна вещь уже в поставке ЛИБО
                # ждёт сканирования (застикерована и свободна). Раньше учитывались
                # только попавшие в поставку — и пока кладовщик не отсканировал
                # первую вещь, связки для него не существовало: остальные три
                # лежали в чек-листе врозь, как отдельные заказы.
                "WHERE o.group_key IS NOT NULL AND o.group_key IN ("
                "  SELECT o2.group_key FROM marketplace_supply_items m2 "
                "  JOIN goods_warehouse g2 ON g2.id = m2.goods_warehouse_id "
                "  JOIN orders o2 ON o2.id = g2.order_id "
                "  WHERE m2.supply_id = %s AND o2.group_key IS NOT NULL "
                "  UNION "
                "  SELECT o3.group_key FROM goods_warehouse g3 "
                "  JOIN orders o3 ON o3.id = COALESCE(g3.reserved_order_id, g3.order_id) "
                "  WHERE o3.group_key IS NOT NULL "
                "    AND g3.status IN ('picking', 'awaiting_supply') "
                "    AND g3.shipping_labeled_at IS NOT NULL "
                "    AND g3.shipped_at IS NULL "
                "    AND o3.marketplace = (SELECT marketplace FROM marketplace_supplies "
                "                          WHERE id = %s)) "
                "GROUP BY o.group_key ORDER BY o.group_key",
                (int(supply_id), int(supply_id), int(supply_id)),
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

            # Наклеен ли на коробку общий ярлык связки — второй шаг сборки.
            # Без него связка собрана, но коробка не подписана: на приёмке её
            # не опознают, и заказ зависнет.
            cur.execute(
                "SELECT group_key, scanned_at, scanned_by_name "
                "FROM supply_bundle_labels WHERE supply_id = %s",
                (int(supply_id),),
            )
            labeled = {r[0]: r for r in cur.fetchall()}
            for g in groups:
                # Отдельное имя, а не row: row выше — это сама поставка, и её
                # затирание ломало весь ответ функции.
                lbl = labeled.get(g['groupKey'])
                g['labelScanned'] = bool(lbl)
                g['labelScannedAt'] = (lbl[1].isoformat() + 'Z') if lbl else None
                g['labelScannedByName'] = lbl[2] if lbl else None

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
            wb_awaiting = []
            if row[1] == 'WB' and row[2] == 'FBS':
                cur.execute(
                    "SELECT wso.id, wso.order_id, o.order_number, o.product, "
                    "wso.wb_trbx_id, wso.sticker_url, wso.sticker_name, wso.scanned_at, "
                    "COALESCE(o.status, ''), o.material, o.width, o.height, "
                    "gw.shipping_labeled_by_name "
                    "FROM wb_supply_orders wso JOIN orders o ON o.id = wso.order_id "
                    "LEFT JOIN goods_warehouse gw ON gw.reserved_order_id = o.id "
                    "     AND gw.shipped_at IS NULL "
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
                        'material': r[9],
                        'width': r[10],
                        'height': r[11],
                        # Кто наклеил ярлык отправления на эту вещь.
                        'labeledByName': r[12],
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

                # Тот же буфер, но списком: материал, размер и кто застикеровал.
                # Кладовщик видит прямо в поставке, что ему предстоит принести, и
                # отмечает строки сканером — вместо голого числа «ожидают отгрузки».
                #
                # Берём только застикерованное: в резервную поставку вещь попадает
                # уже с ярлыком, незастикерованный товар сюда не доходит.
                cur.execute(
                    "SELECT wso.id, o.order_number, o.product, o.material, "
                    "       o.width, o.height, gw.shipping_labeled_by_name, "
                    "       gw.storage_barcode, sh.name "
                    "FROM wb_supply_orders wso "
                    "JOIN marketplace_supplies acc ON acc.id = wso.supply_id "
                    "JOIN orders o ON o.id = wso.order_id "
                    "LEFT JOIN goods_warehouse gw ON gw.reserved_order_id = o.id "
                    "     AND gw.shipped_at IS NULL "
                    "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                    "WHERE acc.is_accumulator = true "
                    "AND acc.status IN ('Открытая', 'На сборке') "
                    "ORDER BY wso.scanned_at"
                )
                wb_awaiting = [
                    {
                        'id': r[0],
                        'orderNumber': r[1],
                        'product': r[2],
                        'material': r[3],
                        'width': r[4],
                        'height': r[5],
                        'labeledByName': r[6],
                        'storageBarcode': r[7],
                        'shelfName': r[8],
                        'labeledAt': None,
                    }
                    for r in cur.fetchall()
                ]

            # СВЕРКА С МАРКЕТПЛЕЙСОМ (только OZON FBS).
            #
            # Кладовщик закрывает поставку и сверяет её с кабинетом OZON, а числа
            # не сходятся: OZON пишет «114», у нас «152». Причина не в ошибке —
            # OZON считает ОТПРАВЛЕНИЯ, а мы ВЕЩИ. Одно отправление бывает на семь
            # штук: OZON покажет одну строку, а швеи отшили семь и кладовщик ищет
            # на складе семь. Поэтому показываем обе единицы сразу и раскладываем,
            # где вещи находятся — тогда видно, чего именно не хватает до закрытия.
            # Сколько вещей ждёт отгрузки на маркетплейсе — простое число вместо
            # прежней сверки с кабинетом.
            #
            # Это товар, который прошёл конвейер (или снят с полок), застикерован
            # ярлыком отправления и лежит на складе, но ещё не отсканирован ни в
            # одну поставку. Кладовщик видит, сколько ему предстоит отсканировать
            # именно сюда.
            #
            # Число «переносится» на следующую поставку само собой: то, что не
            # успели отсканировать сегодня, останется несобранным и попадёт в
            # счётчик новой поставки, как только её создадут.
            cur.execute(
                "SELECT COUNT(*) FROM goods_warehouse gw "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                "LEFT JOIN orders so ON so.id = gw.order_id "
                "WHERE gw.status IN ('picking', 'awaiting_supply') "
                "  AND gw.shipping_labeled_at IS NOT NULL "
                "  AND gw.shipped_at IS NULL "
                "  AND COALESCE(ro.marketplace, so.marketplace) = %s "
                "  AND COALESCE(ro.order_type, so.order_type) = %s "
                "  AND (%s <> 'FBO' OR %s IS NULL "
                "       OR COALESCE(ro.cluster, so.cluster) = %s) "
                # Заказ должен быть живым: отменённые и уже уехавшие в короб не идут.
                f"  AND {GOODS_READY_FOR_SUPPLY_SQL} "
                # Учитываем только ЖИВЫЕ поставки. Запись о завершённой поездке
                # не должна прятать вещь: она могла вернуться к нам и снова быть
                # подобрана под новый заказ. Раньше такая вещь навсегда пропадала
                # из списка «ждут поставки» и ни в один короб не попадала.
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi2 "
                "                  JOIN marketplace_supplies s2 ON s2.id = msi2.supply_id "
                "                  WHERE msi2.goods_warehouse_id = gw.id "
                "                    AND COALESCE(s2.status, '') NOT IN ('Выполнена', 'Отменена'))",
                (row[1], row[2], row[2], row[8], row[8]),
            )
            awaiting_ship = int(cur.fetchone()[0] or 0)

            # Тот же самый набор вещей, что дал счётчик выше, но списком: материал,
            # размер и кто наклеил ярлык. Кладовщик видит перечень прямо в поставке
            # и отмечает строки сканером, вместо того чтобы держать список в голове
            # или сверяться со «Складом товара» в соседней вкладке.
            #
            # Незастикерованный товар сюда не попадает — ровно как в счётчике:
            # без ярлыка отправления вещь в поставку не принимается.
            cur.execute(
                "SELECT gw.id, gw.storage_barcode, gw.bundle_barcode, "
                "       COALESCE(ro.order_number, so.order_number), "
                "       COALESCE(ro.product, so.product), "
                "       COALESCE(ro.material, so.material), "
                "       COALESCE(ro.width, so.width), "
                "       COALESCE(ro.height, so.height), "
                "       gw.shipping_labeled_by_name, gw.shipping_labeled_at, "
                "       sh.name, "
                # Кто делал вещь и когда её упаковали. Нужно для печатного листа
                # недостачи: если вещь не нашли в коробе, по этому листу сразу видно,
                # с кого спрашивать — кто кроил, кто шил, кто упаковывал и в какой
                # день. Иначе поиск виноватого превращается в опрос всей смены.
                "       cu.full_name, su.full_name, pu.full_name, "
                "       COALESCE(ro.packed_at, so.packed_at), "
                # Связка: заказ Яндекса из нескольких вещей с одним общим
                # ярлыком. Нужна и у НЕсобранных вещей — иначе в чек-листе
                # связку не показать целиком: часть строк уехала бы в общий
                # список, и кладовщик снова не понял бы, что вещи связаны.
                "       COALESCE(ro.group_key, so.group_key), "
                "       COALESCE(ro.group_size, so.group_size), "
                "       COALESCE(ro.group_position, so.group_position) "
                "FROM goods_warehouse gw "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                "LEFT JOIN orders so ON so.id = gw.order_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                # Исполнителей берём у заказа, в котором вещь СШИЛИ (so): подобранная
                # с полки вещь физически сделана под свой первоначальный заказ, а не
                # под тот, который ею закрыли. Если вещь шили прямо под этот заказ —
                # so и ro совпадают, и разницы нет.
                "LEFT JOIN users cu ON cu.id = COALESCE(so.cutter_user_id, ro.cutter_user_id) "
                "LEFT JOIN users su ON su.id = COALESCE(so.sewer_user_id, ro.sewer_user_id) "
                "LEFT JOIN users pu ON pu.id = COALESCE(so.packer_user_id, ro.packer_user_id) "
                "WHERE gw.status IN ('picking', 'awaiting_supply') "
                "  AND gw.shipping_labeled_at IS NOT NULL "
                "  AND gw.shipped_at IS NULL "
                "  AND COALESCE(ro.marketplace, so.marketplace) = %s "
                "  AND COALESCE(ro.order_type, so.order_type) = %s "
                "  AND (%s <> 'FBO' OR %s IS NULL "
                "       OR COALESCE(ro.cluster, so.cluster) = %s) "
                # Заказ должен быть живым: отменённые и уже уехавшие в короб не идут.
                f"  AND {GOODS_READY_FOR_SUPPLY_SQL} "
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi2 "
                "                  JOIN marketplace_supplies s2 ON s2.id = msi2.supply_id "
                "                  WHERE msi2.goods_warehouse_id = gw.id "
                "                    AND COALESCE(s2.status, '') NOT IN ('Выполнена', 'Отменена')) "
                "ORDER BY gw.shipping_labeled_at ASC",
                (row[1], row[2], row[2], row[8], row[8]),
            )
            awaiting_items = [
                {
                    'id': r[0],
                    'storageBarcode': r[1],
                    # Стикер связки: им вещь сканируют в поставку.
                    'bundleBarcode': r[2],
                    'orderNumber': r[3],
                    'product': r[4],
                    'material': r[5],
                    'width': r[6],
                    'height': r[7],
                    'labeledByName': r[8],
                    'labeledAt': (r[9].isoformat() + 'Z') if r[9] else None,
                    'shelfName': r[10],
                    # Кто делал вещь — для печатного листа недостачи.
                    'cutterName': r[11],
                    'sewerName': r[12],
                    'packerName': r[13],
                    'packedAt': (r[14].isoformat() + 'Z') if r[14] else None,
                    # Связка Яндекса: по ней чек-лист сводит вещи в одну строку.
                    'groupKey': r[15],
                    'groupSize': r[16],
                    'groupPosition': r[17],
                }
                for r in cur.fetchall()
            ]

            detail = {
                # Что ещё предстоит отсканировать в эту поставку — списком.
                'awaitingItems': awaiting_items,
                # Ждёт отгрузки: застикеровано и лежит на складе, но ещё не
                # отсканировано ни в одну поставку.
                'awaitingShipCount': awaiting_ship,
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
                'supplyDate': (row[21].isoformat() + 'Z') if row[21] else None,
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
                # Что лежит в резервной поставке и ждёт сканирования — списком.
                'wbAwaitingItems': wb_awaiting,
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
            f"s.total_quantity_marketplace, "
            # Сколько вещей УЖЕ готово уехать в эту поставку: застикеровано и
            # лежит на складе, но ни в одну поставку ещё не отсканировано.
            #
            # Без этого числа только что созданная поставка выглядела пустой
            # («0 из 0»), хотя контейнер застикерованного товара стоял рядом.
            # Кладовщик не понимал, есть ли смысл заходить внутрь.
            #
            # Считаем строго «своё»: та же площадка и та же схема (FBS/FBO), а для
            # FBO — ещё и свой кластер. Площадку берём у закреплённого заказа, а
            # если его нет — у заказа, в котором вещь сшили.
            #
            # У WB СВОЙ учёт. Там застикерованный заказ уходит в резервную
            # («накопительную») поставку на стороне маркетплейса, а не остаётся
            # вещью на складе. Поэтому для WB FBS считаем заказы в накопителе —
            # ровно то же число, что показано внутри поставки.
            #
            # Без этого список показывал «ждёт сканирования 82», а внутри поставки
            # было 29: снаружи считались вещи склада, внутри — заказы накопителя.
            f"(CASE WHEN s.marketplace = 'WB' AND s.type = 'FBS' THEN ("
            f"   SELECT COUNT(*) FROM wb_supply_orders wso "
            f"   JOIN marketplace_supplies acc ON acc.id = wso.supply_id "
            f"   WHERE acc.is_accumulator = true "
            f"     AND acc.status IN ('Открытая', 'На сборке')"
            f" ) ELSE ("
            f"SELECT COUNT(*) FROM goods_warehouse gw "
            f" LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
            f" LEFT JOIN orders so ON so.id = gw.order_id "
            f" WHERE gw.status IN ('picking', 'awaiting_supply') "
            f"   AND gw.shipping_labeled_at IS NOT NULL "
            f"   AND gw.shipped_at IS NULL "
            f"   AND COALESCE(ro.marketplace, so.marketplace) = s.marketplace "
            f"   AND COALESCE(ro.order_type, so.order_type) = s.type "
            f"   AND (s.type <> 'FBO' OR s.cluster IS NULL "
            f"        OR COALESCE(ro.cluster, so.cluster) = s.cluster) "
            # Заказ должен быть живым: отменённые и уже уехавшие в короб не идут.
            f"   AND {GOODS_READY_FOR_SUPPLY_SQL} "
            # Только живые поставки: запись о завершённой поездке вещь не блокирует.
            f"   AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi2 "
            f"                   JOIN marketplace_supplies s2 ON s2.id = msi2.supply_id "
            f"                   WHERE msi2.goods_warehouse_id = gw.id "
            f"                     AND COALESCE(s2.status, '') NOT IN ('Выполнена', 'Отменена'))) END) "
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
                # Готово уехать в эту поставку: застикеровано, но ещё не сканировано.
                'readyToScanCount': r[24],
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
