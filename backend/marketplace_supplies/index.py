import json
import os

import psycopg2


VALID_STATUSES = ['Открытая', 'На сборке', 'Отгрузка', 'Выполнена']


def handler(event: dict, context) -> dict:
    """Поставки готового товара на маркетплейс (полный цикл, как на физическом складе):

    Жизненный цикл поставки:
      Открытая -> На сборке -> Отгрузка (в Газельку) -> Выполнена (принято маркетплейсом)

    Товар берётся со склада готового товара (goods_warehouse, статус in_stock).
    При добавлении в поставку товар резервируется (status='reserved'), при переводе
    поставки в статус "Отгрузка" — считается отгруженным (status='shipped').

    GET  /                       - список поставок, фильтры: ?status=, ?type=FBO|FBS,
                                     ?marketplace=OZON|WB|Yandex, ?date_from=, ?date_to=, ?search=
    GET  /?id=1                  - детальная карточка поставки с товарами

    POST /  { action: 'create', marketplace, type, comment?, createdBy? }
        - создаёт пустую поставку в статусе "Открытая" (без товаров)
    POST /  { action: 'add_items', supplyId, goodsWarehouseIds: [...] }
        - добавляет товары со склада в поставку, резервирует их (status='reserved')
    POST /  { action: 'remove_item', itemId }
        - убирает товар из поставки, возвращает его на склад (status='in_stock')
    POST /  { action: 'update', supplyId, supplyNumber?, supplyBarcode?, cluster?,
               gazelkaId?, comment?, shipToGazelkaAt?, shipToMarketplaceAt? }
        - обновляет служебные поля поставки (номер, штрихкод, кластер, id Газельки, даты)
    POST /  { action: 'move_status', supplyId, status }
        - переводит поставку на следующий статус жизненного цикла:
          "На сборке" — просто меняет статус;
          "Отгрузка" — фиксирует ship_to_gazelka_at и переводит все товары в 'shipped';
          "Выполнена" — фиксирует completed_at (и ship_to_marketplace_at, если не указана)
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

            if supply_id:
                cur.execute(
                    "SELECT s.id, s.marketplace, s.type, s.status, s.comment, s.created_at, "
                    "s.supply_number, s.supply_barcode, s.cluster, s.gazelka_id, "
                    "s.ship_to_gazelka_at, s.ship_to_marketplace_at, s.completed_at, "
                    "s.created_by, u.full_name "
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
                    "gw.status, gw.shipped_at "
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
                        'shippedAt': r[8].isoformat() if r[8] else None,
                    }
                    for r in cur.fetchall()
                ]

                detail = {
                    'id': row[0],
                    'marketplace': row[1],
                    'type': row[2],
                    'status': row[3],
                    'comment': row[4],
                    'createdAt': row[5].isoformat(),
                    'supplyNumber': row[6],
                    'supplyBarcode': row[7],
                    'cluster': row[8],
                    'gazelkaId': row[9],
                    'shipToGazelkaAt': row[10].isoformat() if row[10] else None,
                    'shipToMarketplaceAt': row[11].isoformat() if row[11] else None,
                    'completedAt': row[12].isoformat() if row[12] else None,
                    'createdBy': row[13],
                    'createdByName': row[14],
                    'items': items,
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
                f"u.full_name "
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
                    'createdAt': r[5].isoformat(),
                    'supplyNumber': r[6],
                    'supplyBarcode': r[7],
                    'cluster': r[8],
                    'gazelkaId': r[9],
                    'shipToGazelkaAt': r[10].isoformat() if r[10] else None,
                    'shipToMarketplaceAt': r[11].isoformat() if r[11] else None,
                    'completedAt': r[12].isoformat() if r[12] else None,
                    'itemsCount': r[13],
                    'createdByName': r[14],
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

                if not marketplace:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите маркетплейс'})}
                if supply_type not in ('FBO', 'FBS'):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Тип поставки должен быть FBO или FBS'})}

                marketplace_esc = marketplace.replace("'", "''")
                type_esc = supply_type.replace("'", "''")
                comment_esc = comment.replace("'", "''")
                created_by_sql = int(created_by) if created_by not in (None, '') else 'NULL'

                cur.execute(
                    f"INSERT INTO marketplace_supplies (marketplace, type, status, comment, created_by) "
                    f"VALUES ('{marketplace_esc}', '{type_esc}', 'Открытая', '{comment_esc}', {created_by_sql}) RETURNING id"
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
                cur.execute(f"DELETE FROM marketplace_supplies WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}