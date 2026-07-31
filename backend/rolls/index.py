import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет рулонами материалов на складе и в цехах.

    Рулон — партия материала с уникальным штрихкодом. У рулона фиксируется начальный
    и текущий остаток (в единицах материала: п.м. или шт.), статус и привязка к смене/цеху.
    При списании через раскрой заказа остаток рулона уменьшается автоматически.

    GET  /                                 - список рулонов
    GET  /?material_id=1&status=in_storage - список рулонов с фильтром
    POST /  { action: 'create', barcode, materialId, initialQuantity, workshopId?, shiftNumber? }
    POST /  { action: 'update', id, status?, workshopId?, shiftNumber? }
    POST /  { action: 'write_off', id, quantity, orderId? }
        - списывает quantity с остатка рулона, создаёт запись в order_material_usage если указан orderId
        - если остаток становится <= 0, статус рулона переводится в 'completed'
    POST /  { action: 'delete', id }

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над рулонами
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
        material_id = params.get('material_id')
        status = params.get('status')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            conditions = []
            if material_id:
                conditions.append(f"r.material_id = {int(material_id)}")
            if status:
                status_esc = status.replace("'", "''")
                conditions.append(f"r.status = '{status_esc}'")
            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"SELECT r.id, r.barcode, r.material_id, m.name, m.unit, r.workshop_id, w.name, "
                f"r.shift_number, r.initial_quantity, r.remaining_quantity, r.status, "
                f"r.created_at, r.completed_at "
                f"FROM rolls r "
                f"LEFT JOIN materials m ON m.id = r.material_id "
                f"LEFT JOIN workshops w ON w.id = r.workshop_id "
                f"{where_clause} "
                f"ORDER BY r.created_at DESC, r.id DESC"
            )
            rolls = [
                {
                    'id': r[0],
                    'barcode': r[1],
                    'materialId': r[2],
                    'materialName': r[3],
                    'unit': r[4],
                    'workshopId': r[5],
                    'workshopName': r[6],
                    'shiftNumber': r[7],
                    'initialQuantity': float(r[8]),
                    'remainingQuantity': float(r[9]),
                    'status': r[10],
                    'createdAt': r[11].isoformat(),
                    'completedAt': r[12].isoformat() if r[12] else None,
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'rolls': rolls})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                barcode = (body_data.get('barcode') or '').strip()
                material_id = body_data.get('materialId')
                initial_quantity = body_data.get('initialQuantity')
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')

                if not barcode or not material_id or initial_quantity in (None, ''):
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите штрихкод, материал и начальное количество'}),
                    }

                barcode_esc = barcode.replace("'", "''")
                cur.execute(f"SELECT id FROM rolls WHERE barcode = '{barcode_esc}'")
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Рулон со штрихкодом {barcode} уже существует'}),
                    }

                workshop_sql = int(workshop_id) if workshop_id not in (None, '') else 'NULL'
                shift_sql = int(shift_number) if shift_number not in (None, '') else 'NULL'
                status = 'in_workshop' if workshop_id not in (None, '') else 'in_storage'

                cur.execute(
                    f"INSERT INTO rolls (barcode, material_id, workshop_id, shift_number, "
                    f"initial_quantity, remaining_quantity, status) "
                    f"VALUES ('{barcode_esc}', {int(material_id)}, {workshop_sql}, {shift_sql}, "
                    f"{float(initial_quantity)}, {float(initial_quantity)}, '{status}') "
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
                if 'status' in body_data:
                    status_esc = str(body_data['status']).replace("'", "''")
                    fields.append(f"status = '{status_esc}'")
                    if body_data['status'] == 'completed':
                        fields.append("completed_at = now()")
                if 'workshopId' in body_data:
                    val = body_data['workshopId']
                    fields.append(f"workshop_id = {int(val) if val not in (None, '') else 'NULL'}")
                if 'shiftNumber' in body_data:
                    val = body_data['shiftNumber']
                    fields.append(f"shift_number = {int(val) if val not in (None, '') else 'NULL'}")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE rolls SET {', '.join(fields)} WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'write_off':
                item_id = body_data.get('id')
                quantity = body_data.get('quantity')
                order_id = body_data.get('orderId')

                if not item_id or quantity in (None, ''):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id и quantity'})}

                cur.execute(
                    "SELECT remaining_quantity, material_id FROM rolls WHERE id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}

                remaining, material_id = row
                new_remaining = float(remaining) - float(quantity)
                new_status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""

                cur.execute(
                    f"UPDATE rolls SET remaining_quantity = {new_remaining}{new_status_sql} WHERE id = {int(item_id)}"
                )

                if order_id:
                    cur.execute(
                        f"INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
                        f"VALUES ({int(order_id)}, {int(material_id)}, {int(item_id)}, {float(quantity)})"
                    )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'remainingQuantity': new_remaining})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("SELECT id FROM order_material_usage WHERE roll_id = %s LIMIT 1", (int(item_id),))
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Нельзя удалить рулон — по нему уже есть списания на заказы'}),
                    }
                cur.execute(f"DELETE FROM rolls WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
