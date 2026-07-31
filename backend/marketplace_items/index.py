import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет товарами на маркетплейсе: карточка товара с артикулами (свой/OZON/WB)
    и расходом материалов на пошив (материал + количество на единицу товара).

    GET  /                        - получить список товаров
    GET  /?id=1                   - получить детальную карточку товара с расходом материалов
    POST /  { action: 'create', name, width?, height?, article?, ozonSku?, wbSku?, material?, barcode? }
    POST /  { action: 'update', id, name?, width?, height?, article?, ozonSku?, wbSku?, material?, barcode? }
    POST /  { action: 'delete', id }
        - запрещено, если по товару (material+width+height) уже есть заказы (движение)
    POST /  { action: 'set_materials', itemId, materials: [{materialId, quantity}] }
        - полностью заменяет список расходов материалов для товара

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
        item_id = params.get('id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if item_id:
                cur.execute(
                    "SELECT id, name, sku, width, height, ozon_sku, wb_sku, material, barcode, created_at, updated_at "
                    "FROM marketplace_items WHERE id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}

                cur.execute(
                    "SELECT im.id, im.material_id, m.name, m.unit, im.quantity "
                    "FROM marketplace_item_materials im "
                    "LEFT JOIN materials m ON m.id = im.material_id "
                    "WHERE im.marketplace_item_id = %s ORDER BY im.id",
                    (int(item_id),),
                )
                materials = [
                    {
                        'id': r[0],
                        'materialId': r[1],
                        'materialName': r[2],
                        'unit': r[3],
                        'quantity': float(r[4]),
                    }
                    for r in cur.fetchall()
                ]

                detail = {
                    'id': row[0],
                    'name': row[1],
                    'article': row[2],
                    'width': row[3],
                    'height': row[4],
                    'ozonSku': row[5],
                    'wbSku': row[6],
                    'material': row[7],
                    'barcode': row[8],
                    'createdAt': row[9].isoformat(),
                    'updatedAt': row[10].isoformat(),
                    'materials': materials,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'item': detail})}

            cur.execute(
                "SELECT id, name, sku, width, height, ozon_sku, wb_sku, material, barcode, created_at, updated_at "
                "FROM marketplace_items ORDER BY id DESC"
            )
            items = [
                {
                    'id': r[0],
                    'name': r[1],
                    'article': r[2],
                    'width': r[3],
                    'height': r[4],
                    'ozonSku': r[5],
                    'wbSku': r[6],
                    'material': r[7],
                    'barcode': r[8],
                    'createdAt': r[9].isoformat(),
                    'updatedAt': r[10].isoformat(),
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'items': items})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                article = (body_data.get('article') or '').strip()
                ozon_sku = (body_data.get('ozonSku') or '').strip()
                wb_sku = (body_data.get('wbSku') or '').strip()
                material = (body_data.get('material') or '').strip()
                barcode = (body_data.get('barcode') or '').strip()
                width = body_data.get('width')
                height = body_data.get('height')

                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название товара'})}

                name_esc = name.replace("'", "''")
                article_esc = article.replace("'", "''")
                ozon_sku_esc = ozon_sku.replace("'", "''")
                wb_sku_esc = wb_sku.replace("'", "''")
                material_esc = material.replace("'", "''")
                barcode_esc = barcode.replace("'", "''")
                width_sql = int(width) if width not in (None, '') else 'NULL'
                height_sql = int(height) if height not in (None, '') else 'NULL'

                cur.execute(
                    f"INSERT INTO marketplace_items (name, sku, width, height, ozon_sku, wb_sku, material, barcode) "
                    f"VALUES ('{name_esc}', '{article_esc}', {width_sql}, {height_sql}, '{ozon_sku_esc}', '{wb_sku_esc}', '{material_esc}', '{barcode_esc}') "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                fields = []
                if 'name' in body_data:
                    fields.append(f"name = '{str(body_data['name']).replace(chr(39), chr(39)*2)}'")
                if 'article' in body_data:
                    fields.append(f"sku = '{str(body_data['article']).replace(chr(39), chr(39)*2)}'")
                if 'ozonSku' in body_data:
                    fields.append(f"ozon_sku = '{str(body_data['ozonSku']).replace(chr(39), chr(39)*2)}'")
                if 'wbSku' in body_data:
                    fields.append(f"wb_sku = '{str(body_data['wbSku']).replace(chr(39), chr(39)*2)}'")
                if 'material' in body_data:
                    fields.append(f"material = '{str(body_data['material']).replace(chr(39), chr(39)*2)}'")
                if 'barcode' in body_data:
                    fields.append(f"barcode = '{str(body_data['barcode']).replace(chr(39), chr(39)*2)}'")
                if 'width' in body_data:
                    val = body_data['width']
                    fields.append(f"width = {int(val) if val not in (None, '') else 'NULL'}")
                if 'height' in body_data:
                    val = body_data['height']
                    fields.append(f"height = {int(val) if val not in (None, '') else 'NULL'}")
                fields.append("updated_at = now()")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE marketplace_items SET {', '.join(fields)} WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute(
                    "SELECT material, width, height FROM marketplace_items WHERE id = %s",
                    (int(item_id),),
                )
                item_row = cur.fetchone()
                if not item_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}

                item_material, item_width, item_height = item_row
                if item_material and item_width and item_height:
                    material_esc = item_material.replace("'", "''")
                    cur.execute(
                        f"SELECT COUNT(*) FROM orders WHERE material = '{material_esc}' "
                        f"AND width = {int(item_width)} AND height = {int(item_height)}"
                    )
                    orders_count = cur.fetchone()[0]
                    if orders_count > 0:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Нельзя удалить товар: по нему есть движение в заказах ({orders_count} шт.). '
                                         f'Удаление карточек с историей заказов запрещено.'
                            }),
                        }

                cur.execute(f"DELETE FROM marketplace_item_materials WHERE marketplace_item_id = {int(item_id)}")
                cur.execute(f"DELETE FROM marketplace_items WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'set_materials':
                item_id = body_data.get('itemId')
                materials = body_data.get('materials', [])
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите itemId'})}

                cur.execute(f"DELETE FROM marketplace_item_materials WHERE marketplace_item_id = {int(item_id)}")
                for m in materials:
                    material_id = m.get('materialId')
                    quantity = m.get('quantity', 0)
                    if not material_id:
                        continue
                    cur.execute(
                        f"INSERT INTO marketplace_item_materials (marketplace_item_id, material_id, quantity) "
                        f"VALUES ({int(item_id)}, {int(material_id)}, {float(quantity)})"
                    )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}