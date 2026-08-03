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
        - запрещено, если документ уже изменил остатки безвозвратно.
          Для to_workshop разрешено только в статусах "Новый"/"Отправлено" (админ);
          собранные рулоны возвращаются на склад (status='in_storage'). Если удаляемая
          заявка была автозаказом (is_auto_order=true) — по этому материалу/цеху/смене
          создаётся блокировка (auto_order_blocks): автозаказ не будет создавать новые
          заявки на эту комбинацию, пока следующая заявка (созданная вручную) не дойдёт
          до статуса "Получено" (action 'receive' снимает блокировку).
          Для from_supplier разрешено в ЛЮБОМ статусе (включая "Завершено"): если поставка
          уже подтверждена, созданные рулоны удаляются вместе с ней, но ТОЛЬКО если ни один
          из них ещё не использован (не списан, не передан в цех) — иначе 409

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
               materialId, requestedQuantity?, requestedBy? }
        - создаёт заявку в статусе "Новый" строго на ОДИН материал (без привязки к рулонам).
          Заявку создаёт ТОЛЬКО сам сотрудник цеха (швея/закройщик/упаковщик) или админ —
          кладовщик заявки не создаёт, он только собирает и отправляет то, что уже
          запросили (проверка роли по actorId, если он передан). Нет автозаказа —
          заявки создаются только вручную сотрудником. workshopId/shiftNumber берутся
          из профиля сотрудника (не выбираются вручную). Сотрудник только выбирает
          материал, requestedQuantity необязателен (кладовщик сам определит, сколько и
          какие рулоны собрать). Если по этому материалу на эту же смену/цех уже есть
          незакрытая заявка (статус != 'Получено') — отклоняется (409). Материала
          физически не должно быть 0 на складе (сумма остатков rolls in_storage по
          материалу) — иначе заявку создать нельзя (409)
    POST /  { action: 'collect_scan', shipmentId, barcode }
        - сканирование штрихкода рулона на складе, добавляет его целиком в заявку.
          Рулон должен быть в статусе in_storage и НЕ закреплён за другим цехом/сменой
          (рулон должен быть материала из заявки и находиться в статусе in_storage —
          то есть уже подтверждённый админом при приёмке). Разрешено в статусе "Новый",
          а также в режиме коррекции — статус "Отправлено" с непустым reject_reason
          (цех отказал в приёме, кладовщик правит состав перед повторной отправкой)
    POST /  { action: 'remove_scanned_roll', itemId }
        - кладовщик убирает обратно ошибочно отсканированный рулон из заявки (без жёстких
          условий) — либо пока заявка в статусе "Новый" (не отправлена; рулон остаётся
          in_storage), либо в режиме коррекции (статус "Отправлено" + reject_reason —
          рулон уже был in_workshop, при удалении возвращается на склад в in_storage)
    POST /  { action: 'ship', shipmentId }
        - переводит заявку в статус "Отправлено", все собранные рулоны получают статус
          in_workshop и привязку к цеху/смене. Разрешено только зоне склада (role='storekeeper')
          или администратору (role='admin') — проверяется по actorId, если он передан.
          Также разрешена ПОВТОРНАЯ отправка в режиме коррекции (статус уже "Отправлено" +
          непустой reject_reason) — после правок состава заявка уходит на повторную проверку
          цеху, reject_reason сбрасывается
    POST /  { action: 'receive', shipmentId }
        - подтверждение приёмки в цехе, статус "Получено" (после этого статуса по данному
          материалу/цеху/смене можно снова создать новую заявку), reject_reason сбрасывается.
          Разрешено только сотруднику ИМЕННО того цеха/смены, куда отправлена заявка
          (role in sewer/cutter/packer, users.workshop/shift_number совпадают с заявкой),
          либо администратору — проверяется по actorId, если он передан
    POST /  { action: 'reject_receive', shipmentId, rejectReason }
        - сотрудник цеха ОТКАЗЫВАЕТСЯ принять заявку (состав не в порядке — например, не
          хватает рулона). Заявка ОСТАЁТСЯ в статусе "Отправлено" (рулоны остаются в цехе,
          in_workshop), фиксируется обязательная причина отказа (reject_reason) — кладовщик/
          админ видят её в списке заявок и могут открыть экран сборки, чтобы добавить/убрать
          рулоны и отправить заявку заново (см. collect_scan/remove_scanned_roll/ship выше).
          Права те же, что и у 'receive' — только сотрудник того же цеха/смены или админ

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
                    "s.created_by, cu.full_name, s.is_auto_order, s.reject_reason "
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
                    'createdAt': row[9].isoformat() + 'Z',
                    'completedAt': (row[10].isoformat() + 'Z') if row[10] else None,
                    'requestedBy': row[11],
                    'requestedByName': row[12],
                    'createdBy': row[13],
                    'createdByName': row[14],
                    'isAutoOrder': row[15],
                    'rejectReason': row[16],
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
                f"(SELECT COALESCE(SUM(si.quantity), 0) FROM shipment_items si WHERE si.shipment_id = s.id) as total_qty, "
                f"s.is_auto_order, "
                f"(SELECT STRING_AGG(DISTINCT m.name, ', ') FROM shipment_items si "
                f"JOIN materials m ON m.id = si.material_id WHERE si.shipment_id = s.id) as material_names, "
                f"(SELECT MIN(si.material_id) FROM shipment_items si WHERE si.shipment_id = s.id) as material_id, "
                f"s.reject_reason "
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
                    'createdAt': r[9].isoformat() + 'Z',
                    'completedAt': (r[10].isoformat() + 'Z') if r[10] else None,
                    'itemsCount': r[11],
                    'requestedByName': r[12],
                    'createdByName': r[13],
                    'totalQuantity': float(r[14]) if r[14] is not None else 0.0,
                    'isAutoOrder': r[15],
                    'materialNames': r[16],
                    'materialId': r[17],
                    'rejectReason': r[18],
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
                if not shift_number:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Не определена смена — откройте смену на главной странице'})}
                if not material_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите материал'})}

                # Заявку на материал в цех создаёт только сам сотрудник цеха (швея/закройщик/
                # упаковщик) или админ — кладовщик заявки не создаёт (только собирает и
                # отправляет то, что уже запросили). Проверяем на сервере, чтобы нельзя было
                # обойти проверку на фронтенде.
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    actor_row = cur.fetchone()
                    if actor_row and actor_row[0] not in ('sewer', 'cutter', 'packer', 'admin'):
                        return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Создать заявку на материал может только сотрудник цеха'})}

                # 1 материал = 1 незакрытая заявка на смену: пока предыдущая заявка на этот же
                # материал/цех/смену не дошла до статуса "Получено" (отгружена кладовщиком И
                # подтверждена сотрудником цеха) — новую создать нельзя. shift_number здесь
                # уже гарантированно указан (проверено выше).
                cur.execute(
                    "SELECT s.id FROM shipments s "
                    "JOIN shipment_items si ON si.shipment_id = s.id "
                    "WHERE s.type = 'to_workshop' AND s.workshop_id = %s AND s.shift_number = %s "
                    "AND si.material_id = %s AND s.status != 'Получено' "
                    "LIMIT 1",
                    (int(workshop_id), int(shift_number), int(material_id)),
                )
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'По этому материалу уже есть незакрытая заявка на вашу смену — дождитесь отгрузки и подтверждения'}),
                    }

                # Нельзя запросить материал, которого физически нет на складе — иначе
                # кладовщик получит заявку, которую невозможно собрать.
                cur.execute(
                    "SELECT COALESCE(SUM(remaining_quantity), 0), m.name FROM materials m "
                    "LEFT JOIN rolls r ON r.material_id = m.id AND r.status = 'in_storage' "
                    "WHERE m.id = %s GROUP BY m.name",
                    (int(material_id),),
                )
                stock_row = cur.fetchone()
                warehouse_qty = float(stock_row[0]) if stock_row else 0
                material_name = stock_row[1] if stock_row else None
                if warehouse_qty <= 0:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Материала "{material_name or "—"}" нет на складе — заявку создать нельзя'}),
                    }

                requested_by_sql = int(requested_by) if requested_by not in (None, '') else 'NULL'
                comment_esc = comment.replace("'", "''")

                cur.execute(
                    f"INSERT INTO shipments (type, status, workshop_id, shift_number, comment, requested_by) "
                    f"VALUES ('to_workshop', 'Новый', {int(workshop_id)}, {int(shift_number)}, '{comment_esc}', {requested_by_sql}) "
                    f"RETURNING id"
                )
                shipment_id = cur.fetchone()[0]

                requested_qty_sql = float(requested_qty) if requested_qty not in (None, '') else 'NULL'
                cur.execute(
                    f"INSERT INTO shipment_items (shipment_id, material_id, requested_quantity) "
                    f"VALUES ({shipment_id}, {int(material_id)}, {requested_qty_sql})"
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

                cur.execute("SELECT type, status, reject_reason FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заявка не найдена'})}
                # Сборка разрешена либо в статусе "Новый" (обычный процесс), либо в статусе
                # "Отправлено" с непустым reject_reason — это режим коррекции после отказа
                # цеха в приёме (кладовщик/админ добавляет/убирает рулоны и отправляет заново).
                is_correction = sh_row[1] == 'Отправлено' and sh_row[2]
                if sh_row[0] != 'to_workshop' or (sh_row[1] != 'Новый' and not is_correction):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявка не в статусе сборки'})}

                # "Запрошенная" позиция — это исходная строка заявки (создана в request_to_workshop),
                # у неё ещё нет roll_id. Строки с roll_id — это уже отсканированные рулоны. Раньше
                # тут фильтровали по requested_quantity IS NOT NULL, но т.к. requestedQuantity стало
                # необязательным полем, эта проверка сломалась бы — используем roll_id IS NULL.
                cur.execute(
                    "SELECT DISTINCT material_id FROM shipment_items WHERE shipment_id = %s AND roll_id IS NULL",
                    (int(shipment_id),),
                )
                requested_material_ids = {r[0] for r in cur.fetchall()}

                cur.execute(
                    "SELECT id, material_id, remaining_quantity, status, workshop_id, shift_number FROM rolls WHERE barcode = %s",
                    (barcode,),
                )
                roll_row = cur.fetchone()
                if not roll_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Рулон {barcode} не найден'})}
                roll_id, material_id, remaining, roll_status, roll_workshop_id, roll_shift_number = roll_row
                if roll_status != 'in_storage':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Рулон {barcode} не на складе (статус: {roll_status})'})}
                # Рулон, привязанный к какому-то цеху/смене, нельзя забрать в заявку другого
                # цеха/смены — даже если формально он ещё в статусе in_storage (защита от
                # рассинхронизации данных при ручном редактировании рулона администратором).
                if roll_workshop_id is not None or roll_shift_number is not None:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Рулон {barcode} уже закреплён за другим цехом/сменой'}),
                    }
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

            if action == 'remove_scanned_roll':
                # Кладовщик убирает обратно ошибочно отсканированный рулон из заявки на
                # отгрузку в цех — без жёстких условий, пока заявка ещё в статусе "Новый"
                # (не отправлена). Сам рулон остаётся в статусе in_storage (collect_scan его
                # не менял), просто удаляется строка-привязка к заявке.
                item_id = body_data.get('itemId')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите itemId'})}

                cur.execute(
                    "SELECT si.shipment_id, si.roll_id, s.type, s.status, s.reject_reason FROM shipment_items si "
                    "JOIN shipments s ON s.id = si.shipment_id WHERE si.id = %s",
                    (int(item_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
                sh_shipment_id, sh_roll_id, sh_type, sh_status, sh_reject_reason = row
                if sh_type != 'to_workshop' or sh_roll_id is None:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Эту позицию нельзя убрать'})}
                # Убрать рулон можно либо пока заявка ещё в статусе "Новый" (сборка), либо в
                # режиме коррекции после отказа цеха в приёме (статус "Отправлено" +
                # непустой reject_reason).
                is_correction = sh_status == 'Отправлено' and sh_reject_reason
                if sh_status != 'Новый' and not is_correction:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявка уже не в статусе сборки'})}

                # В режиме коррекции рулон уже был переведён в in_workshop при первой отправке —
                # возвращаем его на склад, раз кладовщик решил убрать его из заявки.
                if is_correction:
                    cur.execute(
                        f"UPDATE rolls SET status = 'in_storage', workshop_id = NULL, shift_number = NULL "
                        f"WHERE id = {sh_roll_id}"
                    )

                cur.execute("DELETE FROM shipment_items WHERE id = %s", (int(item_id),))
                log_action(
                    cur, actor_id, actor_name, 'remove_scanned_roll', 'shipment', sh_shipment_id,
                    f'Убрал рулон из собираемой заявки #{sh_shipment_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'ship':
                shipment_id = body_data.get('shipmentId')
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите shipmentId'})}

                # Отправить рулоны в цех может только зона склада (кладовщик) или админ —
                # проверяем на сервере, чтобы нельзя было обойти проверку на фронтенде.
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    actor_row = cur.fetchone()
                    if actor_row and actor_row[0] not in ('storekeeper', 'admin'):
                        return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Отправлять заявку может только кладовщик или администратор'})}

                cur.execute("SELECT type, status, workshop_id, shift_number, reject_reason FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заявка не найдена'})}
                # Повторная отправка разрешена в режиме коррекции после отказа цеха в приёме
                # (статус "Отправлено" + непустой reject_reason) — кладовщик поправил состав
                # и отправляет заново на проверку тому же цеху.
                is_correction = sh_row[1] == 'Отправлено' and sh_row[4]
                if sh_row[0] != 'to_workshop' or (sh_row[1] != 'Новый' and not is_correction):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявку нельзя отправить в текущем статусе'})}
                workshop_id, shift_number = sh_row[2], sh_row[3]

                # Рулон в цехе обязан принадлежать смене (CHECK-ограничение БД) — заявки без
                # смены больше не создаются (см. request_to_workshop), но на всякий случай
                # не даём отправить в цех рулоны по старой заявке без смены с понятной ошибкой.
                if not workshop_id or not shift_number:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'В заявке не указана смена — обратитесь к администратору'}),
                    }

                cur.execute(
                    "SELECT roll_id FROM shipment_items WHERE shipment_id = %s AND roll_id IS NOT NULL",
                    (int(shipment_id),),
                )
                roll_ids = [r[0] for r in cur.fetchall()]
                if not roll_ids:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Соберите хотя бы один рулон перед отправкой'})}

                for roll_id in roll_ids:
                    cur.execute(
                        f"UPDATE rolls SET status = 'in_workshop', workshop_id = {int(workshop_id)}, "
                        f"shift_number = {int(shift_number)} WHERE id = {roll_id}"
                    )

                cur.execute(
                    f"UPDATE shipments SET status = 'Отправлено', reject_reason = NULL WHERE id = {int(shipment_id)}"
                )
                log_action(
                    cur, actor_id, actor_name, 'ship', 'shipment', shipment_id,
                    f'Отправил заявку #{shipment_id} ({len(roll_ids)} рулонов)' + (' — повторно после исправлений' if is_correction else ''),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'receive':
                shipment_id = body_data.get('shipmentId')
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите shipmentId'})}

                cur.execute("SELECT type, status, workshop_id, shift_number FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заявка не найдена'})}
                if sh_row[0] != 'to_workshop' or sh_row[1] != 'Отправлено':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявка ещё не отправлена или уже получена'})}
                workshop_id, shift_number = sh_row[2], sh_row[3]

                # Подтвердить приём в цехе может только работник ИМЕННО этого цеха/смены
                # (зона workshop) или админ — проверяем на сервере, чтобы нельзя было
                # подтвердить приём чужой заявки прямым API-запросом в обход фронтенда.
                if actor_id:
                    cur.execute(
                        "SELECT role, workshop, shift_number FROM users WHERE id = %s", (int(actor_id),)
                    )
                    actor_row = cur.fetchone()
                    if actor_row:
                        actor_role, actor_workshop_name, actor_shift_number = actor_row
                        if actor_role != 'admin':
                            if actor_role not in ('sewer', 'cutter', 'packer'):
                                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Принять заявку в цехе может только сотрудник этого цеха'})}
                            cur.execute("SELECT id FROM workshops WHERE name = %s", (actor_workshop_name,))
                            wr = cur.fetchone()
                            actor_workshop_id = wr[0] if wr else None
                            if actor_workshop_id != workshop_id or (
                                shift_number is not None and actor_shift_number != shift_number
                            ):
                                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Эта заявка отправлена в другой цех/смену'})}

                cur.execute(
                    f"UPDATE shipments SET status = 'Получено', completed_at = now(), reject_reason = NULL "
                    f"WHERE id = {int(shipment_id)}"
                )

                # Успешное получение этой заявки снимает блокировку автозаказа (если она
                # была наложена ранее удалением админом предыдущей автозаявки на этот же
                # материал/цех/смену) — автозаказ снова сможет создавать заявки для этой комбинации.
                cur.execute(
                    "SELECT DISTINCT material_id FROM shipment_items WHERE shipment_id = %s",
                    (int(shipment_id),),
                )
                material_ids = [r[0] for r in cur.fetchall()]
                shift_condition = "shift_number = %s" if shift_number is not None else "shift_number IS NULL"
                for material_id in material_ids:
                    query_params = (material_id, workshop_id, shift_number) if shift_number is not None else (material_id, workshop_id)
                    cur.execute(
                        f"DELETE FROM auto_order_blocks WHERE material_id = %s AND workshop_id = %s AND {shift_condition}",
                        query_params,
                    )

                log_action(
                    cur, actor_id, actor_name, 'receive', 'shipment', shipment_id,
                    f'Принял заявку #{shipment_id} в цехе',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'reject_receive':
                # Сотрудник цеха отказывается принять заявку — состав не в порядке (например,
                # не хватает рулона). Заявка ОСТАЁТСЯ в статусе "Отправлено" (рулоны остаются
                # привязаны к цеху, in_workshop), просто фиксируется причина отказа —
                # кладовщик/админ видят её в списке и могут внести исправления через экран
                # сборки (снова открыть заявку, добавить/убрать рулоны, отправить заново).
                shipment_id = body_data.get('shipmentId')
                reject_reason = (body_data.get('rejectReason') or '').strip()
                if not shipment_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите shipmentId'})}
                if not reject_reason:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите причину отказа'})}

                cur.execute("SELECT type, status, workshop_id, shift_number FROM shipments WHERE id = %s", (int(shipment_id),))
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заявка не найдена'})}
                if sh_row[0] != 'to_workshop' or sh_row[1] != 'Отправлено':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Заявка ещё не отправлена или уже получена'})}
                workshop_id, shift_number = sh_row[2], sh_row[3]

                # Та же проверка прав, что и для 'receive' — отказать может только сотрудник
                # именно этого цеха/смены или админ.
                if actor_id:
                    cur.execute(
                        "SELECT role, workshop, shift_number FROM users WHERE id = %s", (int(actor_id),)
                    )
                    actor_row = cur.fetchone()
                    if actor_row:
                        actor_role, actor_workshop_name, actor_shift_number = actor_row
                        if actor_role != 'admin':
                            if actor_role not in ('sewer', 'cutter', 'packer'):
                                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Отказать в приёме заявки может только сотрудник этого цеха'})}
                            cur.execute("SELECT id FROM workshops WHERE name = %s", (actor_workshop_name,))
                            wr = cur.fetchone()
                            actor_workshop_id = wr[0] if wr else None
                            if actor_workshop_id != workshop_id or (
                                shift_number is not None and actor_shift_number != shift_number
                            ):
                                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Эта заявка отправлена в другой цех/смену'})}

                reject_reason_esc = reject_reason.replace("'", "''")
                cur.execute(
                    f"UPDATE shipments SET reject_reason = '{reject_reason_esc}' WHERE id = {int(shipment_id)}"
                )
                log_action(
                    cur, actor_id, actor_name, 'reject_receive', 'shipment', shipment_id,
                    f'Отказал в приёме заявки #{shipment_id}: {reject_reason}',
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

                cur.execute(
                    "SELECT type, status, workshop_id, shift_number, is_auto_order FROM shipments WHERE id = %s",
                    (int(item_id),),
                )
                sh_row = cur.fetchone()
                if not sh_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Документ не найден'})}
                sh_type, sh_status, sh_workshop_id, sh_shift_number, sh_is_auto = sh_row

                if sh_type == 'to_workshop' and sh_status not in ('Новый', 'Отправлено'):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Удалить можно только заявку в статусе "Новый" или "Отправлено"'}),
                    }

                # Поставку от поставщика можно удалить в любом статусе. Если она уже подтверждена
                # (status='Завершено') — рулоны, созданные при подтверждении, тоже удаляются, но
                # ТОЛЬКО если они ещё не использованы (остаток = исходному кол-ву, статус
                # 'in_storage' — не списаны, не переданы в цех). Если хотя бы один рулон уже тронут —
                # удаление всей поставки блокируется, чтобы не потерять историю расхода материала.
                supply_roll_ids_to_delete: list = []
                if sh_type == 'from_supplier' and sh_status == 'Завершено':
                    cur.execute(
                        "SELECT r.id, r.barcode, r.status, r.initial_quantity, r.remaining_quantity "
                        "FROM shipment_items si JOIN rolls r ON r.id = si.roll_id "
                        "WHERE si.shipment_id = %s",
                        (int(item_id),),
                    )
                    roll_rows = cur.fetchall()
                    touched = [
                        r[1] for r in roll_rows
                        if r[2] != 'in_storage' or float(r[3]) != float(r[4])
                    ]
                    if touched:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': 'Нельзя удалить: рулоны уже используются (списаны или переданы в цех): '
                                + ', '.join(touched)
                            }),
                        }
                    supply_roll_ids_to_delete = [r[0] for r in roll_rows]

                # Если отправленная заявка уже собрала рулоны (status='Отправлено' или
                # они привязаны к цеху) — возвращаем их на склад, чтобы удаление не "теряло" материал.
                if sh_type == 'to_workshop':
                    cur.execute(
                        "SELECT roll_id FROM shipment_items WHERE shipment_id = %s AND roll_id IS NOT NULL",
                        (int(item_id),),
                    )
                    roll_ids = [r[0] for r in cur.fetchall()]
                    for roll_id in roll_ids:
                        cur.execute(
                            f"UPDATE rolls SET status = 'in_storage', workshop_id = NULL, shift_number = NULL "
                            f"WHERE id = {roll_id}"
                        )

                    # Удаление админом автозаказа блокирует повторный автозаказ по этому
                    # материалу/цеху/смене, пока следующая (уже неавтоматическая) заявка на
                    # эту же комбинацию не дойдёт до статуса "Получено" (снимается в action 'receive').
                    if sh_is_auto and sh_workshop_id is not None:
                        cur.execute(
                            "SELECT DISTINCT material_id FROM shipment_items WHERE shipment_id = %s",
                            (int(item_id),),
                        )
                        material_ids = [r[0] for r in cur.fetchall()]
                        shift_sql = int(sh_shift_number) if sh_shift_number is not None else 'NULL'
                        actor_id_sql = int(actor_id) if actor_id not in (None, '') else 'NULL'
                        for material_id in material_ids:
                            cur.execute(
                                f"INSERT INTO auto_order_blocks (material_id, workshop_id, shift_number, blocked_by) "
                                f"VALUES ({material_id}, {sh_workshop_id}, {shift_sql}, {actor_id_sql})"
                            )

                cur.execute("DELETE FROM shipment_items WHERE shipment_id = %s", (int(item_id),))
                for roll_id in supply_roll_ids_to_delete:
                    cur.execute("DELETE FROM rolls WHERE id = %s", (roll_id,))
                cur.execute("DELETE FROM shipments WHERE id = %s", (int(item_id),))
                log_action(
                    cur, actor_id, actor_name, 'delete_shipment', 'shipment', item_id,
                    f'Удалил документ отгрузки #{item_id}' + (' (автозаказ)' if sh_is_auto else ''),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}