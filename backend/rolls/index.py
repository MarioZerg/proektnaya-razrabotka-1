import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет рулонами материалов на складе и в цехах.

    Рулон — партия материала с уникальным штрихкодом. У рулона фиксируется начальный
    и текущий остаток (в единицах материала: п.м. или шт.), статус и привязка к смене/цеху.
    При списании через раскрой заказа остаток рулона уменьшается автоматически.

    Обязательное правило: рулон в статусе 'in_workshop' (в цехе) ДОЛЖЕН иметь и цех,
    и смену — "ничейных" рулонов в цехе быть не может (гарантируется CHECK-ограничением
    БД rolls_workshop_requires_shift + валидацией здесь). На складе (in_storage) цех и
    смена не нужны — это нормальная часть склада.

    GET  /                                 - список рулонов
    GET  /?material_id=1&status=in_storage - список рулонов с фильтром
    POST /  { action: 'create', barcode, materialId, initialQuantity, workshopId?, shiftNumber? }
        - если указан workshopId, shiftNumber обязателен
    POST /  { action: 'update', id, status?, workshopId?, shiftNumber? }
        - если итоговый статус 'in_workshop', итоговые цех и смена обязательны
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
        roll_id = params.get('id')

        # Детальная карточка рулона: сам рулон + история движений (расход на заказы и
        # списание брака). Позволяет "провалиться" в рулон и увидеть, сколько осталось,
        # кто и когда использовал материал, включая списания брака (в т.ч. с терминала).
        if roll_id:
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT r.id, r.barcode, r.material_id, m.name, m.unit, r.workshop_id, w.name, "
                    "r.shift_number, r.initial_quantity, r.remaining_quantity, r.status, "
                    "r.created_at, r.completed_at, mt.name "
                    "FROM rolls r "
                    "LEFT JOIN materials m ON m.id = r.material_id "
                    "LEFT JOIN material_types mt ON mt.id = m.type_id "
                    "LEFT JOIN workshops w ON w.id = r.workshop_id "
                    "WHERE r.id = %s",
                    (int(roll_id),),
                )
                r = cur.fetchone()
                if not r:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                material_type = r[13]
                # Тип материала рулона: "Тюль" — это ткань (за брак отвечает закройщик), всё
                # остальное (Аксессуары/тесьма и т.п.) — за брак отвечает швея.
                is_fabric = (material_type == 'Тюль')
                roll = {
                    'id': r[0], 'barcode': r[1], 'materialId': r[2], 'materialName': r[3],
                    'unit': r[4], 'workshopId': r[5], 'workshopName': r[6], 'shiftNumber': r[7],
                    'initialQuantity': float(r[8]), 'remainingQuantity': float(r[9]),
                    'status': r[10], 'createdAt': r[11].isoformat() + 'Z',
                    'completedAt': (r[12].isoformat() + 'Z') if r[12] else None,
                    'materialType': material_type,
                    'kind': 'fabric' if is_fabric else 'trim',
                }

                history = []
                # Расход на заказы (раскрой / стикеровка). Для каждого движения строим «лесенку»
                # этапов заказа: кто раскроил → кто сшил → кто упаковал.
                cur.execute(
                    "SELECT omu.quantity, omu.created_at, o.order_number, "
                    "cu.full_name, su.full_name, pu.full_name, o.cut_at "
                    "FROM order_material_usage omu "
                    "JOIN orders o ON o.id = omu.order_id "
                    "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                    "LEFT JOIN users su ON su.id = o.sewer_user_id "
                    "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                    "WHERE omu.roll_id = %s",
                    (int(roll_id),),
                )
                for row in cur.fetchall():
                    stages = [
                        {'role': 'cutter', 'label': 'Раскрой',
                         'userName': row[3],
                         'at': (row[6].isoformat() + 'Z') if row[6] else None},
                        {'role': 'sewer', 'label': 'Пошив', 'userName': row[4], 'at': None},
                        {'role': 'packer', 'label': 'Упаковка', 'userName': row[5], 'at': None},
                    ]
                    history.append({
                        'kind': 'order',
                        'quantity': float(row[0]),
                        'createdAt': row[1].isoformat() + 'Z',
                        'orderNumber': row[2],
                        'userName': row[3] or row[4],
                        'comment': None,
                        'stages': stages,
                    })

                # Списание брака. Роль исполнителя брака зависит от типа рулона: ткань → закройщик,
                # тесьма → швея. Пока конкретного исполнителя нет — показываем создателя документа
                # (в дальнейшем при логине по штрих-коду на терминале подтянется реальный сотрудник).
                defect_role = 'cutter' if is_fabric else 'sewer'
                defect_role_label = 'закройщик' if is_fabric else 'швея'
                cur.execute(
                    "SELECT si.quantity, s.created_at, s.comment, cu.full_name, s.type "
                    "FROM shipment_items si "
                    "JOIN shipments s ON s.id = si.shipment_id "
                    "LEFT JOIN users cu ON cu.id = s.created_by "
                    "WHERE si.roll_id = %s AND s.type IN ('defect_writeoff', 'return_to_supplier', 'workshop_writeoff')",
                    (int(roll_id),),
                )
                for row in cur.fetchall():
                    is_defect = (row[4] == 'defect_writeoff')
                    history.append({
                        'kind': 'defect' if is_defect else row[4],
                        'quantity': float(row[0]) if row[0] is not None else 0.0,
                        'createdAt': row[1].isoformat() + 'Z',
                        'orderNumber': None,
                        'userName': row[3],
                        'comment': row[2],
                        'defectRole': defect_role if is_defect else None,
                        'defectRoleLabel': defect_role_label if is_defect else None,
                        'stages': None,
                    })

                history.sort(key=lambda h: h['createdAt'], reverse=True)
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'roll': roll, 'history': history})}
            finally:
                conn.close()

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

            # Если передан usedSinceUserId — отмечаем, по каким рулонам было движение материала
            # в ТЕКУЩЕЙ открытой смене этого сотрудника (терминал показывает такие рулоны
            # активными, а остальные — затуманенными, пока с ними не начали работать).
            used_roll_ids = set()
            used_since_user_id = (event.get('queryStringParameters') or {}).get('usedSinceUserId')
            if used_since_user_id:
                cur.execute(
                    "SELECT opened_at FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(used_since_user_id),),
                )
                s_row = cur.fetchone()
                if s_row:
                    cur.execute(
                        "SELECT DISTINCT roll_id FROM order_material_usage "
                        "WHERE roll_id IS NOT NULL AND created_at >= %s",
                        (s_row[0],),
                    )
                    used_roll_ids = {r[0] for r in cur.fetchall()}

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
                    'createdAt': r[11].isoformat() + 'Z',
                    'completedAt': (r[12].isoformat() + 'Z') if r[12] else None,
                    'usedInShift': r[0] in used_roll_ids,
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

                # Рулон, отправленный сразу в цех, обязан принадлежать конкретной смене —
                # "ничейных" рулонов в цехе быть не должно (проверяется и на уровне БД).
                if workshop_id not in (None, '') and shift_number in (None, ''):
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'При выборе цеха укажите смену'}),
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

                cur.execute(
                    "SELECT status, workshop_id, shift_number FROM rolls WHERE id = %s", (int(item_id),)
                )
                current_row = cur.fetchone()
                if not current_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                cur_status, cur_workshop_id, cur_shift_number = current_row

                new_status = body_data.get('status', cur_status)
                new_workshop_id = body_data['workshopId'] if 'workshopId' in body_data else cur_workshop_id
                new_shift_number = body_data['shiftNumber'] if 'shiftNumber' in body_data else cur_shift_number

                # Рулон в статусе "в цехе" обязан иметь и цех, и смену — та же гарантия,
                # что и на уровне БД (rolls_workshop_requires_shift), проверяем заранее,
                # чтобы вернуть понятную ошибку вместо сырого исключения psycopg2.
                if new_status == 'in_workshop' and (new_workshop_id in (None, '') or new_shift_number in (None, '')):
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Для статуса "в цехе" укажите и цех, и смену'}),
                    }

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

            # Закрытие рулона в цехе (терминал): рулон физически закончился. Остаток списывается
            # полностью, а если ткани не хватило — дополнительно фиксируется недостача (метраж,
            # которого не оказалось в рулоне). Рулон переводится в статус completed.
            if action == 'close_roll':
                item_id = body_data.get('id')
                shortage = body_data.get('shortage') or 0
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                try:
                    shortage = float(shortage)
                except (TypeError, ValueError):
                    shortage = 0.0

                cur.execute(
                    "SELECT remaining_quantity, status FROM rolls WHERE id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                if row[1] == 'completed':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Рулон уже закрыт'})}

                cur.execute(
                    "UPDATE rolls SET remaining_quantity = 0, status = 'completed', completed_at = now(), "
                    "shortage_quantity = %s WHERE id = %s",
                    (shortage, int(item_id)),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'shortage': shortage}),
                }

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