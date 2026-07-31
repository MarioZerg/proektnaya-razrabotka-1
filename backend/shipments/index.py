import json
import os

import psycopg2


VALID_TYPES = {'from_supplier', 'to_workshop', 'return_to_supplier', 'defect_writeoff'}


def handler(event: dict, context) -> dict:
    """Управляет складским документооборотом: отгрузки от поставщика, в цех,
    возврат поставщику и списание брака. Каждый документ (shipment) содержит список
    позиций (shipment_items) и автоматически создаёт/обновляет рулоны материалов.

    Типы документов:
      - from_supplier      — приёмка от поставщика: создаёт новые рулоны на складе
      - to_workshop         — отгрузка в цех: перемещает существующие рулоны в цех/смену
      - return_to_supplier  — возврат поставщику: списывает количество с рулона
      - defect_writeoff     — списание брака: списывает количество с рулона

    GET  /                          - список документов (можно ?type=from_supplier)
    GET  /?id=1                     - детальная карточка документа с позициями
    POST /  { action: 'create', type, supplierId?, workshopId?, shiftNumber?, comment?, items: [...] }
        items для from_supplier: [{materialId, barcode, quantity}]
        items для to_workshop: [{rollId}]
        items для return_to_supplier / defect_writeoff: [{rollId, quantity}]
    POST /  { action: 'delete', id }
        - запрещено, если документ уже изменил остатки безвозвратно (всегда разрешено
          только для последнего документа не старше по бизнес-правилам не проверяется здесь)

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
        shipment_id = params.get('id')
        type_filter = params.get('type')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if shipment_id:
                cur.execute(
                    "SELECT s.id, s.type, s.status, s.supplier_id, sup.name, s.workshop_id, w.name, "
                    "s.shift_number, s.comment, s.created_at, s.completed_at "
                    "FROM shipments s "
                    "LEFT JOIN suppliers sup ON sup.id = s.supplier_id "
                    "LEFT JOIN workshops w ON w.id = s.workshop_id "
                    "WHERE s.id = %s",
                    (int(shipment_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Документ не найден'})}

                cur.execute(
                    "SELECT si.id, si.material_id, m.name, m.unit, si.barcode, si.roll_id, r.barcode, si.quantity "
                    "FROM shipment_items si "
                    "LEFT JOIN materials m ON m.id = si.material_id "
                    "LEFT JOIN rolls r ON r.id = si.roll_id "
                    "WHERE si.shipment_id = %s ORDER BY si.id",
                    (int(shipment_id),),
                )
                items = [
                    {
                        'id': r[0],
                        'materialId': r[1],
                        'materialName': r[2],
                        'unit': r[3],
                        'barcode': r[4],
                        'rollId': r[5],
                        'rollBarcode': r[6],
                        'quantity': float(r[7]) if r[7] is not None else None,
                    }
                    for r in cur.fetchall()
                ]

                detail = {
                    'id': row[0],
                    'type': row[1],
                    'status': row[2],
                    'supplierId': row[3],
                    'supplierName': row[4],
                    'workshopId': row[5],
                    'workshopName': row[6],
                    'shiftNumber': row[7],
                    'comment': row[8],
                    'createdAt': row[9].isoformat(),
                    'completedAt': row[10].isoformat() if row[10] else None,
                    'items': items,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shipment': detail})}

            conditions = []
            if type_filter:
                type_esc = type_filter.replace("'", "''")
                conditions.append(f"s.type = '{type_esc}'")
            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"SELECT s.id, s.type, s.status, s.supplier_id, sup.name, s.workshop_id, w.name, "
                f"s.shift_number, s.comment, s.created_at, s.completed_at, "
                f"(SELECT COUNT(*) FROM shipment_items si WHERE si.shipment_id = s.id) as items_count "
                f"FROM shipments s "
                f"LEFT JOIN suppliers sup ON sup.id = s.supplier_id "
                f"LEFT JOIN workshops w ON w.id = s.workshop_id "
                f"{where_clause} "
                f"ORDER BY s.created_at DESC, s.id DESC"
            )
            shipments = [
                {
                    'id': r[0],
                    'type': r[1],
                    'status': r[2],
                    'supplierId': r[3],
                    'supplierName': r[4],
                    'workshopId': r[5],
                    'workshopName': r[6],
                    'shiftNumber': r[7],
                    'comment': r[8],
                    'createdAt': r[9].isoformat(),
                    'completedAt': r[10].isoformat() if r[10] else None,
                    'itemsCount': r[11],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shipments': shipments})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                doc_type = body_data.get('type')
                supplier_id = body_data.get('supplierId')
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                comment = (body_data.get('comment') or '').strip()
                items = body_data.get('items') or []

                if doc_type not in VALID_TYPES:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный тип документа'})}
                if not items:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Добавьте хотя бы одну позицию'})}

                if doc_type == 'to_workshop' and not workshop_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите цех назначения'})}

                supplier_sql = int(supplier_id) if supplier_id not in (None, '') else 'NULL'
                workshop_sql = int(workshop_id) if workshop_id not in (None, '') else 'NULL'
                shift_sql = int(shift_number) if shift_number not in (None, '') else 'NULL'
                comment_esc = comment.replace("'", "''")

                cur.execute(
                    f"INSERT INTO shipments (type, status, supplier_id, workshop_id, shift_number, comment, completed_at) "
                    f"VALUES ('{doc_type}', 'Выполнена', {supplier_sql}, {workshop_sql}, {shift_sql}, "
                    f"'{comment_esc}', now()) RETURNING id"
                )
                shipment_id = cur.fetchone()[0]

                if doc_type == 'from_supplier':
                    for item in items:
                        material_id = item.get('materialId')
                        barcode = (item.get('barcode') or '').strip()
                        quantity = item.get('quantity')
                        if not material_id or not barcode or quantity in (None, ''):
                            return {
                                'statusCode': 400,
                                'headers': headers,
                                'body': json.dumps({'error': 'Для каждой позиции укажите материал, штрихкод и количество'}),
                            }
                        barcode_esc = barcode.replace("'", "''")
                        cur.execute("SELECT id FROM rolls WHERE barcode = %s", (barcode,))
                        if cur.fetchone():
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': f'Рулон со штрихкодом {barcode} уже существует'}),
                            }
                        cur.execute(
                            f"INSERT INTO rolls (barcode, material_id, initial_quantity, remaining_quantity, status) "
                            f"VALUES ('{barcode_esc}', {int(material_id)}, {float(quantity)}, {float(quantity)}, 'in_storage') "
                            f"RETURNING id"
                        )
                        roll_id = cur.fetchone()[0]
                        cur.execute(
                            f"INSERT INTO shipment_items (shipment_id, material_id, barcode, roll_id, quantity) "
                            f"VALUES ({shipment_id}, {int(material_id)}, '{barcode_esc}', {roll_id}, {float(quantity)})"
                        )

                elif doc_type == 'to_workshop':
                    for item in items:
                        roll_id = item.get('rollId')
                        if not roll_id:
                            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите рулон'})}
                        cur.execute(
                            "SELECT material_id, status FROM rolls WHERE id = %s",
                            (int(roll_id),),
                        )
                        roll_row = cur.fetchone()
                        if not roll_row:
                            return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Рулон #{roll_id} не найден'})}
                        material_id = roll_row[0]

                        cur.execute(
                            f"UPDATE rolls SET workshop_id = {int(workshop_id)}, "
                            f"shift_number = {shift_sql}, status = 'in_workshop' WHERE id = {int(roll_id)}"
                        )
                        cur.execute(
                            f"INSERT INTO shipment_items (shipment_id, material_id, roll_id) "
                            f"VALUES ({shipment_id}, {material_id}, {int(roll_id)})"
                        )

                else:
                    for item in items:
                        roll_id = item.get('rollId')
                        quantity = item.get('quantity')
                        if not roll_id or quantity in (None, ''):
                            return {
                                'statusCode': 400,
                                'headers': headers,
                                'body': json.dumps({'error': 'Укажите рулон и количество'}),
                            }
                        cur.execute(
                            "SELECT material_id, remaining_quantity FROM rolls WHERE id = %s",
                            (int(roll_id),),
                        )
                        roll_row = cur.fetchone()
                        if not roll_row:
                            return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Рулон #{roll_id} не найден'})}
                        material_id, remaining = roll_row
                        quantity = float(quantity)
                        if quantity > float(remaining):
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': f'На рулоне #{roll_id} остаток {remaining}, нельзя списать {quantity}'}),
                            }
                        new_remaining = float(remaining) - quantity
                        status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
                        cur.execute(
                            f"UPDATE rolls SET remaining_quantity = {new_remaining}{status_sql} WHERE id = {int(roll_id)}"
                        )
                        cur.execute(
                            f"INSERT INTO shipment_items (shipment_id, material_id, roll_id, quantity) "
                            f"VALUES ({shipment_id}, {material_id}, {int(roll_id)}, {quantity})"
                        )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': shipment_id})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("DELETE FROM shipment_items WHERE shipment_id = %s", (int(item_id),))
                cur.execute("DELETE FROM shipments WHERE id = %s", (int(item_id),))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
