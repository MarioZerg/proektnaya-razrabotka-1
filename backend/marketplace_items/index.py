import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет товарами на маркетплейсе: карточка товара с артикулом и расходом
    материалов по цехам на выполнение заказа.

    GET  /                        - получить список товаров с их расходом материалов
    GET  /?id=1                   - получить детальную карточку товара
    POST /  { action: 'create', name, sku?, material?, width?, height? }
    POST /  { action: 'update', id, name?, sku?, material?, width?, height? }
    POST /  { action: 'delete', id }
    POST /  { action: 'set_materials', itemId, materials: [{workshopId, materialId, quantity}] }
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
                    "SELECT id, name, sku, material, width, height, created_at, updated_at "
                    "FROM marketplace_items WHERE id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}

                cur.execute(
                    "SELECT im.id, im.workshop_id, w.name, im.material_id, m.name, im.quantity "
                    "FROM marketplace_item_materials im "
                    "LEFT JOIN workshops w ON w.id = im.workshop_id "
                    "LEFT JOIN materials m ON m.id = im.material_id "
                    "WHERE im.marketplace_item_id = %s ORDER BY im.id",
                    (int(item_id),),
                )
                materials = [
                    {
                        'id': r[0],
                        'workshopId': r[1],
                        'workshopName': r[2],
                        'materialId': r[3],
                        'materialName': r[4],
                        'quantity': float(r[5]),
                    }
                    for r in cur.fetchall()
                ]

                detail = {
                    'id': row[0],
                    'name': row[1],
                    'sku': row[2],
                    'material': row[3],
                    'width': row[4],
                    'height': row[5],
                    'createdAt': row[6].isoformat(),
                    'updatedAt': row[7].isoformat(),
                    'materials': materials,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'item': detail})}

            cur.execute(
                "SELECT id, name, sku, material, width, height, created_at, updated_at "
                "FROM marketplace_items ORDER BY id DESC"
            )
            items = [
                {
                    'id': r[0],
                    'name': r[1],
                    'sku': r[2],
                    'material': r[3],
                    'width': r[4],
                    'height': r[5],
                    'createdAt': r[6].isoformat(),
                    'updatedAt': r[7].isoformat(),
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
                sku = (body_data.get('sku') or '').strip()
                material = (body_data.get('material') or '').strip()
                width = body_data.get('width')
                height = body_data.get('height')

                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название товара'})}

                name_esc = name.replace("'", "''")
                sku_esc = sku.replace("'", "''")
                material_esc = material.replace("'", "''")
                width_sql = int(width) if width not in (None, '') else 'NULL'
                height_sql = int(height) if height not in (None, '') else 'NULL'

                cur.execute(
                    f"INSERT INTO marketplace_items (name, sku, material, width, height) "
                    f"VALUES ('{name_esc}', '{sku_esc}', '{material_esc}', {width_sql}, {height_sql}) "
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
                if 'sku' in body_data:
                    fields.append(f"sku = '{str(body_data['sku']).replace(chr(39), chr(39)*2)}'")
                if 'material' in body_data:
                    fields.append(f"material = '{str(body_data['material']).replace(chr(39), chr(39)*2)}'")
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
                    workshop_id = m.get('workshopId')
                    material_id = m.get('materialId')
                    quantity = m.get('quantity', 0)
                    workshop_sql = int(workshop_id) if workshop_id else 'NULL'
                    material_sql = int(material_id) if material_id else 'NULL'
                    cur.execute(
                        f"INSERT INTO marketplace_item_materials (marketplace_item_id, workshop_id, material_id, quantity) "
                        f"VALUES ({int(item_id)}, {workshop_sql}, {material_sql}, {float(quantity)})"
                    )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
