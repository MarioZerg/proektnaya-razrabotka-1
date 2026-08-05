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
    GET  /?forUserId=5                     - рулоны ТОЛЬКО цеха открытой смены сотрудника
                                             (для швеи/закройщика/упаковщика)
    GET  /?shortage_stats=1&from=&to=      - статистика недостач по закрытым рулонам:
        средний и максимальный процент недостачи по каждому материалу, сводка по закройщикам
        и список закрытых рулонов. Нужна, чтобы за месяц набрать реальные цифры и потом
        задать нормы недостачи (materials.shortage_norm_percent)
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

        # Статистика недостач по закрытым рулонам: сколько метров в среднем «не хватает»
        # в целом рулоне по каждому материалу. Нужна, чтобы за месяц набрать реальные цифры
        # и на их основе задать нормы недостачи. Пока никого не штрафуем — только считаем.
        if params.get('shortage_stats'):
            date_from = (params.get('from') or '').strip()
            date_to = (params.get('to') or '').strip()
            where = ["r.status = 'completed'", "r.initial_quantity > 0"]
            if date_from:
                where.append(f"r.completed_at >= '{date_from.replace(chr(39), chr(39)*2)}'")
            if date_to:
                where.append(f"r.completed_at < ('{date_to.replace(chr(39), chr(39)*2)}'::date + 1)")
            where_sql = ' AND '.join(where)

            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                # По каждому материалу: сколько рулонов закрыто, средняя/макс недостача в
                # процентах от рулона и во что она обошлась по себестоимости материала.
                cur.execute(
                    "SELECT m.id, m.name, m.unit, COALESCE(m.cost, 0), m.shortage_norm_percent, "
                    "COUNT(*), "
                    "COALESCE(SUM(r.shortage_quantity), 0), "
                    "COALESCE(AVG(r.shortage_quantity / r.initial_quantity * 100), 0), "
                    "COALESCE(MAX(r.shortage_quantity / r.initial_quantity * 100), 0), "
                    "COUNT(*) FILTER (WHERE r.shortage_quantity > 0) "
                    "FROM rolls r JOIN materials m ON m.id = r.material_id "
                    f"WHERE {where_sql} "
                    "GROUP BY m.id, m.name, m.unit, m.cost, m.shortage_norm_percent "
                    "ORDER BY 8 DESC"
                )
                by_material = [
                    {
                        'materialId': row[0],
                        'material': row[1],
                        'unit': row[2],
                        'cost': float(row[3]),
                        'normPercent': float(row[4]) if row[4] is not None else None,
                        'rollsClosed': row[5],
                        'shortageTotal': float(row[6]),
                        'avgPercent': float(row[7]),
                        'maxPercent': float(row[8]),
                        'rollsWithShortage': row[9],
                        'costTotal': float(row[6]) * float(row[3]),
                    }
                    for row in cur.fetchall()
                ]

                # По закройщикам: у кого недостача выше средней — это будущие кандидаты
                # на списание, когда нормы будут введены.
                cur.execute(
                    "SELECT r.closed_by_user_id, COALESCE(r.closed_by_name, 'Не указан'), "
                    "COUNT(*), COALESCE(SUM(r.shortage_quantity), 0), "
                    "COALESCE(AVG(r.shortage_quantity / r.initial_quantity * 100), 0), "
                    "COALESCE(SUM(r.shortage_quantity * COALESCE(m.cost, 0)), 0) "
                    "FROM rolls r JOIN materials m ON m.id = r.material_id "
                    f"WHERE {where_sql} "
                    "GROUP BY r.closed_by_user_id, r.closed_by_name "
                    "ORDER BY 5 DESC"
                )
                by_user = [
                    {
                        'userId': row[0],
                        'userName': row[1],
                        'rollsClosed': row[2],
                        'shortageTotal': float(row[3]),
                        'avgPercent': float(row[4]),
                        'costTotal': float(row[5]),
                    }
                    for row in cur.fetchall()
                ]

                # Полный список закрытых рулонов — чтобы можно было посмотреть каждый случай.
                cur.execute(
                    "SELECT r.id, r.barcode, m.name, m.unit, r.initial_quantity, "
                    "r.shortage_quantity, "
                    "CASE WHEN r.initial_quantity > 0 "
                    "THEN r.shortage_quantity / r.initial_quantity * 100 ELSE 0 END, "
                    "COALESCE(r.closed_by_name, ''), r.completed_at, "
                    "r.shortage_quantity * COALESCE(m.cost, 0) "
                    "FROM rolls r JOIN materials m ON m.id = r.material_id "
                    f"WHERE {where_sql} "
                    "ORDER BY r.completed_at DESC LIMIT 500"
                )
                rolls_list = [
                    {
                        'id': row[0],
                        'barcode': row[1],
                        'material': row[2],
                        'unit': row[3],
                        'initialQuantity': float(row[4]),
                        'shortage': float(row[5]),
                        'shortagePercent': float(row[6]),
                        'closedBy': row[7],
                        'completedAt': row[8].isoformat() if row[8] else None,
                        'cost': float(row[9]),
                    }
                    for row in cur.fetchall()
                ]

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'byMaterial': by_material,
                        'byUser': by_user,
                        'rolls': rolls_list,
                    }),
                }
            finally:
                conn.close()

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
                # За брак отвечает тот, кто физически работает с этим материалом:
                # Тюль (ткань) — закройщик, Аксессуары (тесьма) — швея, Упаковка — упаковщик.
                # Для незнакомого типа ответственного не назначаем, чтобы не обвинить не того.
                responsible_by_type = {
                    'Тюль': ('cutter', 'закройщик'),
                    'Аксессуары': ('sewer', 'швея'),
                    'Упаковка': ('packer', 'упаковщик'),
                }
                defect_role, defect_role_label = responsible_by_type.get(
                    material_type, (None, None)
                )
                is_fabric = (material_type == 'Тюль')
                roll = {
                    'id': r[0], 'barcode': r[1], 'materialId': r[2], 'materialName': r[3],
                    'unit': r[4], 'workshopId': r[5], 'workshopName': r[6], 'shiftNumber': r[7],
                    'initialQuantity': float(r[8]), 'remainingQuantity': float(r[9]),
                    'status': r[10], 'createdAt': r[11].isoformat() + 'Z',
                    'completedAt': (r[12].isoformat() + 'Z') if r[12] else None,
                    'materialType': material_type,
                    'kind': 'fabric' if is_fabric else 'trim',
                    'defectRole': defect_role,
                    'defectRoleLabel': defect_role_label,
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

                # Списание брака. Ответственный определён выше по типу материала. Пока
                # конкретного исполнителя нет — показываем создателя документа (в дальнейшем
                # при логине по штрих-коду на терминале подтянется реальный сотрудник).
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

            # forUserId — производственная роль (швея/закройщик/упаковщик) смотрит рулоны:
            # показываем ТОЛЬКО рулоны цеха её текущей открытой смены. Склад и рулоны чужих
            # цехов ей не видны. Кладовщику и админу этот параметр не передаётся — они
            # видят всё. Без открытой смены список пустой.
            for_user_id = params.get('forUserId')
            if for_user_id:
                cur.execute(
                    "SELECT ss.workshop_id FROM shift_sessions ss "
                    "WHERE ss.user_id = %s AND ss.closed_at IS NULL "
                    "ORDER BY ss.opened_at DESC LIMIT 1",
                    (int(for_user_id),),
                )
                sess = cur.fetchone()
                if sess and sess[0]:
                    conditions.append(f"r.workshop_id = {int(sess[0])}")
                else:
                    conditions.append("1 = 0")

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
                f"r.created_at, r.completed_at, COALESCE(r.shortage_quantity, 0) "
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
                    'shortageQuantity': float(r[13] or 0),
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
                    "SELECT r.remaining_quantity, r.status, r.workshop_id, mt.name "
                    "FROM rolls r "
                    "LEFT JOIN materials m ON m.id = r.material_id "
                    "LEFT JOIN material_types mt ON mt.id = m.type_id "
                    "WHERE r.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}
                if row[1] == 'completed':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Рулон уже закрыт'})}

                # Рулон нельзя закрыть, пока на нём остаётся слишком много материала:
                # тюль — по настройке цеха min_remaining_to_close_fabric (по умолчанию 20 м),
                # тесьма/аксессуары — min_remaining_to_close_trim (по умолчанию 80 м).
                remaining_now = float(row[0] or 0)
                type_name = row[3] or ''
                setting_key = 'min_remaining_to_close_fabric' if type_name == 'Тюль' else 'min_remaining_to_close_trim'
                default_limit = 20.0 if type_name == 'Тюль' else 80.0
                limit = default_limit
                cur.execute(
                    "SELECT value FROM workshop_settings WHERE workshop_id = %s AND key = %s",
                    (row[2], setting_key),
                )
                s_row = cur.fetchone()
                if not s_row:
                    cur.execute("SELECT value FROM system_settings WHERE key = %s", (setting_key,))
                    s_row = cur.fetchone()
                if s_row and s_row[0] not in (None, ''):
                    try:
                        limit = float(s_row[0])
                    except (TypeError, ValueError):
                        limit = default_limit

                if remaining_now > limit:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Рулон нельзя закрыть: на нём ещё {round(remaining_now, 2)} м '
                                     f'(закрытие возможно при остатке до {round(limit, 2)} м)'
                        }),
                    }

                # Запоминаем, кто закрыл рулон: по этим данным копится статистика недостач
                # в разрезе закройщиков и тканей — она понадобится для будущих норм списания.
                closed_by_id = body_data.get('userId')
                closed_by_name = (body_data.get('userName') or '').strip()
                cur.execute(
                    "UPDATE rolls SET remaining_quantity = 0, status = 'completed', completed_at = now(), "
                    "shortage_quantity = %s, closed_by_user_id = %s, closed_by_name = %s WHERE id = %s",
                    (
                        shortage,
                        int(closed_by_id) if closed_by_id else None,
                        closed_by_name or None,
                        int(item_id),
                    ),
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