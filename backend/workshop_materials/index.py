import json
import os

import psycopg2


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
    """Сводный отчёт по материалам, находящимся в цехах (не на складе).

    Полностью повторяет раздел "Материал на производстве" физического склада:
    группирует остатки рулонов со статусом in_workshop по материалу, цеху и смене.
    У каждого цеха свой набор именованных смен (например у Цеха №1 — "Смена № 1" и
    "Смена № 2", у Цеха №2 — "5/2"), поэтому колонки строятся динамически по всем
    цехам сразу: cпискок колонок = все смены всех активных цехов.

    Автозаказ: при каждом открытии этой страницы (раз настоящего планировщика/cron в
    платформе нет — проверка встроена сюда) для каждой ячейки "материал-цех-смена" с
    остатком меньше порога auto_order_threshold (system_settings, по умолчанию 100)
    автоматически создаётся заявка на отгрузку в цех (shipments type='to_workshop'),
    если по этому материалу/цеху/смене ещё нет незакрытой заявки. Управляется настройкой
    auto_order_enabled, количество в заявке — auto_order_quantity (по умолчанию 300).

    GET  /                - сводка по всем цехам сразу: для каждого материала показывает
                             остаток и число рулонов по каждой колонке "цех - смена" + итого;
                             попутно создаёт автозаказы, если остаток ниже порога
    GET  /?workshop_id=1  - фильтр: только смены конкретного цеха

    Args:
        event: dict с httpMethod, queryStringParameters
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со сводкой материалов в цехах, списком колонок смен и
              autoOrdersCreated — список созданных за этот запрос автозаказов
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

    if method != 'GET':
        return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}

    params = event.get('queryStringParameters') or {}
    workshop_id_filter = params.get('workshop_id')

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        workshop_condition = f"AND w.id = {int(workshop_id_filter)}" if workshop_id_filter else ""
        cur.execute(
            f"SELECT w.id, w.name, w.shift_names FROM workshops w "
            f"WHERE w.is_active = true {workshop_condition} ORDER BY w.id"
        )
        workshop_rows = cur.fetchall()

        columns = []
        for wid, wname, shift_names in workshop_rows:
            names = shift_names if isinstance(shift_names, list) else json.loads(shift_names or '[]')
            if not names:
                columns.append({'workshopId': wid, 'workshopName': wname, 'shiftNumber': None, 'shiftLabel': wname})
            else:
                for idx, sname in enumerate(names, start=1):
                    columns.append({
                        'workshopId': wid,
                        'workshopName': wname,
                        'shiftNumber': idx,
                        'shiftLabel': sname,
                    })

        today_weekday = None
        cur.execute("SELECT EXTRACT(DOW FROM now())")
        row = cur.fetchone()
        if row:
            today_weekday = int(row[0])

        active_column_key = None
        if columns:
            first_workshop_columns = [c for c in columns if c['workshopId'] == columns[0]['workshopId']]
            if len(first_workshop_columns) > 0 and today_weekday is not None:
                active_idx = today_weekday % len(first_workshop_columns)
                active_column_key = (
                    first_workshop_columns[active_idx]['workshopId'],
                    first_workshop_columns[active_idx]['shiftNumber'],
                )

        workshop_condition_rolls = f"AND r.workshop_id = {int(workshop_id_filter)}" if workshop_id_filter else ""
        cur.execute(
            f"SELECT mt.id, mt.name, mt.sort_order, m.id, m.name, m.unit, m.sort_order, "
            f"r.workshop_id, r.shift_number, "
            f"SUM(r.remaining_quantity), COUNT(r.id) "
            f"FROM rolls r "
            f"JOIN materials m ON m.id = r.material_id "
            f"JOIN material_types mt ON mt.id = m.type_id "
            f"WHERE r.status = 'in_workshop' AND r.remaining_quantity > 0 {workshop_condition_rolls} "
            f"GROUP BY mt.id, mt.name, mt.sort_order, m.id, m.name, m.unit, m.sort_order, r.workshop_id, r.shift_number "
            f"ORDER BY mt.sort_order, m.sort_order"
        )

        rows = cur.fetchall()

        types_map = {}
        materials_map = {}
        for (type_id, type_name, _type_sort, material_id, material_name, unit, _mat_sort,
             r_workshop_id, shift_number, qty, roll_count) in rows:
            if type_id not in types_map:
                types_map[type_id] = {'id': type_id, 'name': type_name, 'materials': []}
            if material_id not in materials_map:
                mat_entry = {
                    'materialId': material_id,
                    'materialName': material_name,
                    'unit': unit,
                    'cells': [],
                    'totalQuantity': 0.0,
                    'totalRolls': 0,
                }
                materials_map[material_id] = mat_entry
                types_map[type_id]['materials'].append(mat_entry)

            entry = materials_map[material_id]
            entry['cells'].append({
                'workshopId': r_workshop_id,
                'shiftNumber': shift_number,
                'quantity': float(qty),
                'rollCount': roll_count,
            })
            entry['totalQuantity'] += float(qty)
            entry['totalRolls'] += roll_count

        result = list(types_map.values())

        # --- Автозаказ материала в цех при низком остатке (нет cron — проверяем при заходе на страницу) ---
        auto_orders_created = []
        cur.execute(
            "SELECT key, value FROM system_settings WHERE key IN "
            "('auto_order_enabled', 'auto_order_threshold', 'auto_order_quantity')"
        )
        settings_map = {k: v for k, v in cur.fetchall()}
        auto_order_enabled = (settings_map.get('auto_order_enabled') or 'true') == 'true'

        if auto_order_enabled and not workshop_id_filter:
            threshold = float(settings_map.get('auto_order_threshold') or 100)
            order_qty = float(settings_map.get('auto_order_quantity') or 300)

            cur.execute("SELECT id, allowed_materials FROM workshops WHERE is_active = true")
            allowed_by_workshop = {}
            for wid, allowed in cur.fetchall():
                ids = allowed if isinstance(allowed, list) else json.loads(allowed or '[]')
                allowed_by_workshop[wid] = set(ids) if ids else None  # None = все материалы

            cur.execute("SELECT id FROM materials WHERE status = 'active'")
            all_material_ids = [r[0] for r in cur.fetchall()]

            remaining_by_key = {}
            for mat_entry in materials_map.values():
                for cell in mat_entry['cells']:
                    remaining_by_key[(mat_entry['materialId'], cell['workshopId'], cell['shiftNumber'])] = cell['quantity']

            for col in columns:
                wid, shift = col['workshopId'], col['shiftNumber']
                allowed = allowed_by_workshop.get(wid)
                material_ids = [m for m in all_material_ids if allowed is None or m in allowed]
                for material_id in material_ids:
                    remaining = remaining_by_key.get((material_id, wid, shift), 0.0)
                    if remaining >= threshold:
                        continue

                    shift_condition = "s.shift_number = %s" if shift is not None else "s.shift_number IS NULL"
                    query_params = (wid, shift, material_id) if shift is not None else (wid, material_id)
                    cur.execute(
                        f"SELECT s.id FROM shipments s JOIN shipment_items si ON si.shipment_id = s.id "
                        f"WHERE s.type = 'to_workshop' AND s.workshop_id = %s AND {shift_condition} "
                        f"AND si.material_id = %s AND s.status != 'Получено' LIMIT 1",
                        query_params,
                    )
                    if cur.fetchone():
                        continue

                    shift_sql = int(shift) if shift is not None else 'NULL'
                    comment_esc = f"Автозаказ: остаток {remaining} ниже порога {threshold}"
                    cur.execute(
                        f"INSERT INTO shipments (type, status, workshop_id, shift_number, comment) "
                        f"VALUES ('to_workshop', 'Новый', {wid}, {shift_sql}, '{comment_esc}') RETURNING id"
                    )
                    new_shipment_id = cur.fetchone()[0]
                    cur.execute(
                        f"INSERT INTO shipment_items (shipment_id, material_id, requested_quantity) "
                        f"VALUES ({new_shipment_id}, {material_id}, {order_qty})"
                    )
                    log_action(
                        cur, None, 'Система (автозаказ)', 'auto_order', 'shipment', new_shipment_id,
                        f'Автозаказ материала #{material_id} в цех #{wid}: остаток {remaining} ниже порога {threshold}',
                    )
                    auto_orders_created.append({'shipmentId': new_shipment_id, 'materialId': material_id, 'workshopId': wid, 'shiftNumber': shift})

            if auto_orders_created:
                conn.commit()
    finally:
        conn.close()

    active_column = None
    if active_column_key:
        active_column = {'workshopId': active_column_key[0], 'shiftNumber': active_column_key[1]}

    return {
        'statusCode': 200,
        'headers': headers,
        'body': json.dumps({
            'types': result,
            'columns': columns,
            'activeColumn': active_column,
            'autoOrdersCreated': auto_orders_created,
        }),
    }
