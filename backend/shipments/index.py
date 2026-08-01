import json
import os

import psycopg2


VALID_TYPES = {'from_supplier', 'to_workshop', 'return_to_supplier', 'defect_writeoff', 'workshop_writeoff'}


def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description, details=None):
    """Пишет запись в журнал действий (audit_log) в той же транзакции перед commit()."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'warehouse',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


def handler(event: dict, context) -> dict:
    """Управляет складским документооборотом: отгрузки от поставщика, в цех,
    возврат поставщику и списание брака. Каждый документ (shipment) содержит список
    позиций (shipment_items) и автоматически создаёт/обновляет рулоны материалов.

    Типы документов:
      - from_supplier      — приёмка от поставщика: требует подтверждения админом (см. ниже)
      - to_workshop         — заявка на отгрузку в цех, двухстадийный процесс со сканированием (см. ниже)
      - return_to_supplier  — возврат поставщику: списывает количество с рулона
      - defect_writeoff     — списание брака: списывает количество с рулона

    GET  /                          - список документов (можно ?type=from_supplier)
        доп. фильтры: ?supplier_id=1, ?status=Завершено, ?date_from=2026-01-01, ?date_to=2026-01-31
    GET  /?id=1                     - детальная карточка документа с позициями
    POST /  { action: 'create', type, supplierId?, comment?, createdBy?, items: [...] }
        items для from_supplier: [{materialId, quantity, numberRolls}]
            - quantity — общее количество (шт. или пог.м.), numberRolls — сколько рулонов/пачек
              приехало; supplierId ОБЯЗАТЕЛЕН. Поставка уходит в статус "Новый" — рулоны
              ЕЩЁ НЕ создаются и материал НЕ появляется на складе, пока админ не подтвердит
              (action 'approve_supply')
            - createdBy — id кладовщика, оформившего приёмку (опционально)
        items для return_to_supplier / defect_writeoff: [{rollId, quantity}]
        (для to_workshop используйте action 'request_to_workshop')
    POST /  { action: 'delete', id }
        - запрещено, если документ уже изменил остатки безвозвратно

    Подтверждение поставки от поставщика (только type='from_supplier', статус 'Новый'):
    POST /  { action: 'update_pending_supply', id, items: [...], supplierId? }
        - админ правит позиции (например, кладовщик указал метраж с ошибкой) до подтверждения;
          items заменяют прежние позиции целиком
    POST /  { action: 'approve_supply', id }
        - подтверждает поставку: только теперь создаются реальные рулоны на складе
          (status='in_storage') со штрихкодами, quantity делится поровну на numberRolls;
          статус документа -> 'Завершено'
    POST /  { action: 'reject_supply', id }
        - отклоняет поставку: позиции удаляются, рулоны не создавались — статус -> 'Отклонена'

    Отгрузка в цех (as-is с физического склада, повторяет процесс кладовщика):
    POST /  { action: 'request_to_workshop', workshopId, shiftNumber?, comment?,
               materialId, requestedQuantity, requestedBy? }
        - создаёт заявку в статусе "Новый" строго на ОДИН материал (без привязки к рулонам).
          Заявку создаёт швея/закройщик — 1 заявка = 1 материал, workshopId/shiftNumber
          берутся из профиля сотрудника (не выбираются вручную). Если по этому материалу
          на эту же смену/цех уже есть незакрытая заявка (статус != 'Получено') — отклоняется (409)
    POST /  { action: 'collect_scan', shipmentId, barcode }
        - сканирование штрихкода рулона на складе, добавляет его целиком в заявку
          (рулон должен быть материала из заявки и находиться в статусе in_storage —
          то есть уже подтверждённый админом при приёмке)
    POST /  { action: 'ship', shipmentId }
        - переводит заявку в статус "Отправлено", все собранные рулоны получают статус
          in_workshop и привязку к цеху/смене
    POST /  { action: 'receive', shipmentId }
        - подтверждение приёмки в цехе, статус "Получено" (после этого статуса по данному
          материалу/цеху/смене можно снова создать новую заявку)

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
                    "s.shift_number, s.comment, s.created_at, s.completed_at, s.requested_by, u.full_name, "
                    "s.created_by, cu.full_name "
                    "FROM shipments s "
                    "LEFT JOIN suppliers sup ON sup.id = s.supplier_id "
                    "LEFT JOIN workshops w ON w.id = s.workshop_id "
                    "LEFT JOIN users u ON u.id = s.requested_by "
                    "LEFT JOIN users cu ON cu.id = s.created_by "
                    "WHERE s.id = %s",
                    (int(shipment_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Документ не найден'})}

                cur.execute(
                    "SELECT si.id, si.material_id, m.name, m.unit, si.barcode, si.roll_id, r.barcode, "
                    "si.quantity, si.requested_quantity, si.number_rolls "
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
                        'requestedQuantity': float(r[8]) if r[8] is not None else None,
                        'numberRolls': r[9],
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
                    'requestedBy': row[11],
                    'requestedByName': row[12],
                    'createdBy': row[13],
                    'createdByName': row[14],
                    'items': items,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shipment': detail})}

            supplier_filter = params.get('supplier_id')
            status_filter = params.get('status')
            date_from = params.get('date_from')
            date_to = params.get('date_to')

            conditions = []
            if type_filter:
                type_esc = type_filter.replace("'", "''")
                conditions.append(f"s.type = '{type_esc}'")
            if supplier_filter:
                conditions.append(f"s.supplier_id = {int(supplier_filter)}")
            if status_filter:
                status_esc = status_filter.replace("'", "''")
                conditions.append(f"s.status = '{status_esc}'")
            if date_from:
                date_from_esc = date_from.replace("'", "''")
                conditions.append(f"s.created_at >= '{date_from_esc}'::date")
            if date_to:
                date_to_esc = date_to.replace("'", "''")
                conditions.append(f"s.created_at < '{date_to_esc}'::date + interval '1 day'")
            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"SELECT s.id, s.type, s.status, s.supplier_id, sup.name, s.workshop_id, w.name, "
                f"s.shift_number, s.comment, s.created_at, s.completed_at, "
                f"(SELECT COUNT(*) FROM shipment_items si WHERE si.shipment_id = s.id) as items_count, "
                f"u.full_name, cu.full_name, "
                f"(SELECT COALESCE(SUM(si.quantity), 0) FROM shipment_items si WHERE si.shipment_id = s.id) as total_qty "
                f"FROM shipments s "
                f"LEFT JOIN suppliers sup ON sup.id = s.supplier_id "
                f"LEFT JOIN workshops w ON w.id = s.workshop_id "
                f"LEFT JOIN users u ON u.id = s.requested_by "
                f"LEFT JOIN users cu ON cu.id = s.created_by "
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
                    'requestedByName': r[12],
                    'createdByName': r[13],
                    'totalQuantity': float(r[14]) if r[14] is not None else 0.0,
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shipments': shipments})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                doc_type = body_data.get('type')
                supplier_id = body_data.get('supplierId')
                comment = (body_data.get('comment') or '').strip()
                items = body_data.get('items') or []

                if doc_type not in ('from_supplier', 'return_to_supplier', 'defect_writeoff'):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный тип документа'})}
                if not items:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Добавьте хотя бы одну позицию'})}
                if doc_type == 'from_supplier' and supplier_id in (None, ''):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите поставщика — без него приёмку оформить нельзя'})}

                supplier_sql = int(supplier_id) if supplier_id not in (None, '') else 'NULL'
                comment_esc = comment.replace("'", "''")
                created_by = body_data.get('createdBy')
                created_by_sql = int(created_by) if created_by not in (None, '') else 'NULL'

                if doc_type == 'from_supplier':
                    # Приёмка от поставщика уходит на подтверждение админу: рулоны создаются
                    # только когда админ проверит метраж/кол-во и нажмёт "Подтвердить" (action approve_supply).
                    # До этого момента материал НЕ появляется на складе.
                    cur.execute(
                        f"INSERT INTO shipments (type, status, supplier_id, comment, created_by) "
                        f"VALUES ('from_supplier', 'Новый', {supplier_sql}, '{comment_esc}', {created_by_sql}) RETURNING id"
                    )
                    shipment_id = cur.fetchone()[0]

                    for item in items:
                        material_id = item.get('materialId')
                        quantity = item.get('quantity')
                        number_rolls = item.get('numberRolls')
                        if not material_id or quantity in (None, '') or not number_rolls:
                            return {
                                'statusCode': 400,
                                'headers': headers,
                                'body': json.dumps({'error': 'Для каждой позиции укажите материал, количество и число рулонов'}),
                            }
                        material_id = int(material_id)
                        quantity = float(quantity)
                        number_rolls = int(number_rolls)
                        if number_rolls < 1:
                            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Число рулонов должно быть не меньше 1'})}

                        cur.execute("SELECT id FROM materials WHERE id = %s", (material_id,))
                        if not cur.fetchone():
                            return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Материал #{material_id} не найден'})}

                        cur.execute(
                            f"INSERT INTO shipment_items (shipment_id, material_id, quantity, number_rolls) "
                            f"VALUES ({shipment_id}, {material_id}, {quantity}, {number_rolls})"
                        )

                    log_action(
                        cur, actor_id, actor_name, 'create_pending_supply',
                        'shipment', shipment_id, f'Оформил приёмку от поставщика #{shipment_id}, ожидает подтверждения',
                    )
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': shipment_id})}

                cur.execute(
                    f"INSERT INTO shipments (type, status, supplier_id, comment, completed_at, created_by) "
                    f"VALUES ('{doc_type}', 'Завершено', {supplier_sql}, '{comment_esc}', now(), {created_by_sql}) RETURNING id"
                )
                shipment_id = cur.fetchone()[0]

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

                log_action(
                    cur, actor_id, actor_name, f'create_{doc_type}', 'shipment', shipment_id,
                    f'Оформил документ «{doc_type}» из {len(items)} позиций',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': shipment_id})}

            if action == 'update_pending_supply':
                # Админ правит метраж/кол-во позиций поставки от поставщика ДО подтверждения
                # (например кладовщик указал "001" на конце по ошибке) — рулоны ещё не созданы.
                shipment_id = body_data.get('id')
                items = body_data.get('items') or []
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                if not items:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Добавьте хотя бы одну позицию'})}

                cur.execute("SELECT type, status FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if sh_row[0] != 'from_supplier' or sh_row[1] != 'Новый':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Редактировать можно только неподтверждённую поставку'})}

                cur.execute("DELETE FROM shipment_items WHERE shipment_id = %s", (int(shipment_id),))
                for item in items:
                    material_id = item.get('materialId')
                    quantity = item.get('quantity')
                    number_rolls = item.get('numberRolls')
                    if not material_id or quantity in (None, '') or not number_rolls:
                        return {
                            'statusCode': 400,
                            'headers': headers,
                            'body': json.dumps({'error': 'Для каждой позиции укажите материал, количество и число рулонов'}),
                        }
                    cur.execute(
                        f"INSERT INTO shipment_items (shipment_id, material_id, quantity, number_rolls) "
                        f"VALUES ({int(shipment_id)}, {int(material_id)}, {float(quantity)}, {int(number_rolls)})"
                    )

                if 'supplierId' in body_data:
                    supplier_id = body_data['supplierId']
                    if supplier_id in (None, ''):
                        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нельзя убрать поставщика'})}
                    cur.execute("UPDATE shipments SET supplier_id = %s WHERE id = %s", (int(supplier_id), int(shipment_id)))

                log_action(
                    cur, actor_id, actor_name, 'update_pending_supply', 'shipment', shipment_id,
                    f'Отредактировал позиции поставки #{shipment_id} перед подтверждением',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'approve_supply':
                # Подтверждение поставки от поставщика: только теперь создаются реальные
                # рулоны на складе (status='in_storage') и генерируются штрихкоды.
                shipment_id = body_data.get('id')
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute("SELECT type, status FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if sh_row[0] != 'from_supplier' or sh_row[1] != 'Новый':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Поставка уже обработана'})}

                cur.execute(
                    "SELECT id, material_id, quantity, number_rolls FROM shipment_items WHERE shipment_id = %s",
                    (int(shipment_id),),
                )
                pending_items = cur.fetchall()
                if not pending_items:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'В поставке нет позиций'})}

                created_rolls = []
                for item_id, material_id, quantity, number_rolls in pending_items:
                    quantity = float(quantity)
                    number_rolls = int(number_rolls)

                    cur.execute("SELECT type_id FROM materials WHERE id = %s", (material_id,))
                    type_id = cur.fetchone()[0]

                    cur.execute("SELECT barcode FROM rolls WHERE barcode LIKE %s", (f'{type_id}-%',))
                    existing_barcodes = [r[0] for r in cur.fetchall()]
                    max_seq = 0
                    for bc in existing_barcodes:
                        suffix = bc.split('-', 1)[1] if '-' in bc else ''
                        if suffix.isdigit():
                            max_seq = max(max_seq, int(suffix))

                    per_roll_qty = round(quantity / number_rolls, 3)
                    new_rolls = []
                    for _ in range(number_rolls):
                        max_seq += 1
                        barcode = f"{type_id}-{max_seq:06d}"
                        cur.execute(
                            f"INSERT INTO rolls (barcode, material_id, initial_quantity, remaining_quantity, status) "
                            f"VALUES ('{barcode}', {material_id}, {per_roll_qty}, {per_roll_qty}, 'in_storage') "
                            f"RETURNING id"
                        )
                        new_rolls.append((cur.fetchone()[0], barcode))
                        created_rolls.append(barcode)

                    # Первая строка позиции обновляется до первого рулона, остальные рулоны
                    # добавляются новыми строками shipment_items (у исходной позиции roll_id был NULL).
                    first_roll_id, first_barcode = new_rolls[0]
                    cur.execute(
                        f"UPDATE shipment_items SET roll_id = {first_roll_id}, barcode = '{first_barcode}', "
                        f"quantity = {per_roll_qty} WHERE id = {item_id}"
                    )
                    for extra_roll_id, extra_barcode in new_rolls[1:]:
                        cur.execute(
                            f"INSERT INTO shipment_items (shipment_id, material_id, barcode, roll_id, quantity) "
                            f"VALUES ({int(shipment_id)}, {material_id}, '{extra_barcode}', {extra_roll_id}, {per_roll_qty})"
                        )

                cur.execute(f"UPDATE shipments SET status = 'Завершено', completed_at = now() WHERE id = {int(shipment_id)}")
                log_action(
                    cur, actor_id, actor_name, 'approve_supply', 'shipment', shipment_id,
                    f'Подтвердил поставку #{shipment_id}, создано рулонов: {len(created_rolls)}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'createdRolls': created_rolls})}

            if action == 'reject_supply':
                shipment_id = body_data.get('id')
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute("SELECT type, status FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
                if sh_row[0] != 'from_supplier' or sh_row[1] != 'Новый':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Поставка уже обработана'})}

                cur.execute("DELETE FROM shipment_items WHERE shipment_id = %s", (int(shipment_id),))
                cur.execute(f"UPDATE shipments SET status = 'Отклонена', completed_at = now() WHERE id = {int(shipment_id)}")
                log_action(
                    cur, actor_id, actor_name, 'reject_supply', 'shipment', shipment_id,
                    f'Отклонил поставку #{shipment_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'request_to_workshop':
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                comment = (body_data.get('comment') or '').strip()
                material_id = body_data.get('materialId')
                requested_qty = body_data.get('requestedQuantity')
                requested_by = body_data.get('requestedBy')

                if not workshop_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Не определён цех — обратитесь к администратору'})}
                if not material_id or requested_qty in (None, ''):
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите материал и количество'})}

                # 1 материал = 1 незакрытая заявка на смену: пока предыдущая заявка на этот же
                # материал/цех/смену не дошла до статуса "Получено" (отгружена кладовщиком И
                # подтверждена сотрудником цеха) — новую создать нельзя.
                shift_condition = "s.shift_number = %s" if shift_number not in (None, '') else "s.shift_number IS NULL"
                query_params = (int(workshop_id), shift_number, int(material_id)) if shift_number not in (None, '') else (int(workshop_id), int(material_id))
                cur.execute(
                    f"SELECT s.id FROM shipments s "
                    f"JOIN shipment_items si ON si.shipment_id = s.id "
                    f"WHERE s.type = 'to_workshop' AND s.workshop_id = %s AND {shift_condition} "
                    f"AND si.material_id = %s AND s.status != 'Получено' "
                    f"LIMIT 1",
                    query_params,
                )
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'По этому материалу уже есть незакрытая заявка на вашу смену — дождитесь отгрузки и подтверждения'}),
                    }

                shift_sql = int(shift_number) if shift_number not in (None, '') else 'NULL'
                requested_by_sql = int(requested_by) if requested_by not in (None, '') else 'NULL'
                comment_esc = comment.replace("'", "''")

                cur.execute(
                    f"INSERT INTO shipments (type, status, workshop_id, shift_number, comment, requested_by) "
                    f"VALUES ('to_workshop', 'Новый', {int(workshop_id)}, {shift_sql}, '{comment_esc}', {requested_by_sql}) "
                    f"RETURNING id"
                )
                shipment_id = cur.fetchone()[0]

                cur.execute(
                    f"INSERT INTO shipment_items (shipment_id, material_id, requested_quantity) "
                    f"VALUES ({shipment_id}, {int(material_id)}, {float(requested_qty)})"
                )

                log_action(
                    cur, actor_id, actor_name, 'request_to_workshop', 'shipment', shipment_id,
                    f'Создал заявку на отгрузку в цех #{workshop_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': shipment_id})}

            if action == 'collect_scan':
                shipment_id = body_data.get('shipmentId')
                barcode = (body_data.get('barcode') or '').strip()
                if not shipment_id or not barcode:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Отсканируйте штрихкод рулона'})}

                cur.execute("SELECT type, status FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заявка не найдена'})}
                if sh_row[0] != 'to_workshop' or sh_row[1] != 'Новый':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявка не в статусе сборки'})}

                cur.execute(
                    "SELECT DISTINCT material_id FROM shipment_items WHERE shipment_id = %s AND requested_quantity IS NOT NULL",
                    (int(shipment_id),),
                )
                requested_material_ids = {r[0] for r in cur.fetchall()}

                cur.execute(
                    "SELECT id, material_id, remaining_quantity, status FROM rolls WHERE barcode = %s",
                    (barcode,),
                )
                roll_row = cur.fetchone()
                if not roll_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Рулон {barcode} не найден'})}
                roll_id, material_id, remaining, roll_status = roll_row
                if roll_status != 'in_storage':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Рулон {barcode} не на складе (статус: {roll_status})'})}
                if material_id not in requested_material_ids:
                    cur.execute("SELECT name FROM materials WHERE id = %s", (material_id,))
                    mat_name = cur.fetchone()[0]
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Рулон {barcode} — материал "{mat_name}", он не запрошен в этой заявке'})}

                cur.execute(
                    "SELECT id FROM shipment_items WHERE shipment_id = %s AND roll_id = %s",
                    (int(shipment_id), roll_id),
                )
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Рулон {barcode} уже добавлен в заявку'})}

                cur.execute(
                    f"INSERT INTO shipment_items (shipment_id, material_id, roll_id, quantity) "
                    f"VALUES ({int(shipment_id)}, {material_id}, {roll_id}, {float(remaining)})"
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'rollId': roll_id, 'materialId': material_id, 'quantity': float(remaining)}),
                }

            if action == 'ship':
                shipment_id = body_data.get('shipmentId')
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите shipmentId'})}

                cur.execute("SELECT type, status, workshop_id, shift_number FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заявка не найдена'})}
                if sh_row[0] != 'to_workshop' or sh_row[1] != 'Новый':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявку нельзя отправить в текущем статусе'})}
                workshop_id, shift_number = sh_row[2], sh_row[3]

                cur.execute(
                    "SELECT roll_id FROM shipment_items WHERE shipment_id = %s AND roll_id IS NOT NULL",
                    (int(shipment_id),),
                )
                roll_ids = [r[0] for r in cur.fetchall()]
                if not roll_ids:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Соберите хотя бы один рулон перед отправкой'})}

                shift_sql = shift_number if shift_number is not None else 'NULL'
                for roll_id in roll_ids:
                    cur.execute(
                        f"UPDATE rolls SET status = 'in_workshop', workshop_id = {workshop_id}, "
                        f"shift_number = {shift_sql} WHERE id = {roll_id}"
                    )

                cur.execute(f"UPDATE shipments SET status = 'Отправлено' WHERE id = {int(shipment_id)}")
                log_action(
                    cur, actor_id, actor_name, 'ship', 'shipment', shipment_id,
                    f'Отправил заявку #{shipment_id} ({len(roll_ids)} рулонов)',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'receive':
                shipment_id = body_data.get('shipmentId')
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите shipmentId'})}

                cur.execute("SELECT type, status FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заявка не найдена'})}
                if sh_row[0] != 'to_workshop' or sh_row[1] != 'Отправлено':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявка ещё не отправлена или уже получена'})}

                cur.execute(f"UPDATE shipments SET status = 'Получено', completed_at = now() WHERE id = {int(shipment_id)}")
                log_action(
                    cur, actor_id, actor_name, 'receive', 'shipment', shipment_id,
                    f'Принял заявку #{shipment_id} в цехе',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'workshop_writeoff':
                workshop_id = body_data.get('workshopId')
                shift_number = body_data.get('shiftNumber')
                comment = (body_data.get('comment') or '').strip()
                items = body_data.get('items') or []

                if not items:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Добавьте хотя бы одну позицию'})}

                workshop_sql = int(workshop_id) if workshop_id not in (None, '') else 'NULL'
                shift_sql = int(shift_number) if shift_number not in (None, '') else 'NULL'
                comment_esc = comment.replace("'", "''")

                cur.execute(
                    f"INSERT INTO shipments (type, status, workshop_id, shift_number, comment, completed_at) "
                    f"VALUES ('workshop_writeoff', 'Выполнена', {workshop_sql}, {shift_sql}, '{comment_esc}', now()) "
                    f"RETURNING id"
                )
                shipment_id = cur.fetchone()[0]

                for item in items:
                    material_id = item.get('materialId')
                    quantity = item.get('quantity')
                    if not material_id or quantity in (None, ''):
                        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите материал и количество'})}
                    quantity = float(quantity)

                    roll_conditions = ["material_id = %s", "status = 'in_workshop'", "remaining_quantity > 0"]
                    params = [int(material_id)]
                    if workshop_id not in (None, ''):
                        roll_conditions.append("workshop_id = %s")
                        params.append(int(workshop_id))
                    if shift_number not in (None, ''):
                        roll_conditions.append("shift_number = %s")
                        params.append(int(shift_number))

                    cur.execute(
                        f"SELECT id, remaining_quantity FROM rolls WHERE {' AND '.join(roll_conditions)} ORDER BY created_at ASC",
                        tuple(params),
                    )
                    available_rolls = cur.fetchall()
                    total_available = sum(float(r[1]) for r in available_rolls)
                    if total_available < quantity:
                        cur.execute("SELECT name, unit FROM materials WHERE id = %s", (int(material_id),))
                        mat_name, mat_unit = cur.fetchone()
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({'error': f'{mat_name}: в цехе есть только {total_available} {mat_unit}, нужно {quantity}'}),
                        }

                    remaining_to_take = quantity
                    for roll_id, roll_remaining in available_rolls:
                        if remaining_to_take <= 0:
                            break
                        take = min(float(roll_remaining), remaining_to_take)
                        new_remaining = float(roll_remaining) - take
                        status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
                        cur.execute(f"UPDATE rolls SET remaining_quantity = {new_remaining}{status_sql} WHERE id = {roll_id}")
                        cur.execute(
                            f"INSERT INTO shipment_items (shipment_id, material_id, roll_id, quantity) "
                            f"VALUES ({shipment_id}, {int(material_id)}, {roll_id}, {take})"
                        )
                        remaining_to_take -= take

                log_action(
                    cur, actor_id, actor_name, 'workshop_writeoff', 'shipment', shipment_id,
                    f'Списал брак в цехе #{workshop_id} ({len(items)} позиций)',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': shipment_id})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute("DELETE FROM shipment_items WHERE shipment_id = %s", (int(item_id),))
                cur.execute("DELETE FROM shipments WHERE id = %s", (int(item_id),))
                log_action(
                    cur, actor_id, actor_name, 'delete_shipment', 'shipment', item_id,
                    f'Удалил документ отгрузки #{item_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
