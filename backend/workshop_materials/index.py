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
    цехам сразу: список колонок = все смены всех активных цехов. Рулон в статусе
    in_workshop ОБЯЗАН иметь смену (гарантируется CHECK-ограничением БД
    rolls_workshop_requires_shift) — колонки "Без смены" в отчёте больше нет.

    Автозаказ материала в цех ОТКЛЮЧЁН: заявки на отгрузку в цех создают только сами
    сотрудники цеха (action 'request_to_workshop' в backend/shipments) вручную, когда
    им нужен материал — кладовщик и система заявки не создают.

    GET  /                - сводка по всем цехам сразу: для каждого материала показывает
                             остаток и число рулонов по каждой колонке "цех - смена" + итого
    GET  /?workshop_id=1  - фильтр: только смены конкретного цеха

    Args:
        event: dict с httpMethod, queryStringParameters
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со сводкой материалов в цехах и списком колонок смен
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
                # Защитный случай (в БД сейчас такого нет) — у цеха нет именованных смен.
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
            f"SUM(r.remaining_quantity), COUNT(r.id), "
            # Отдельно считаем непринятое: рулон отгружен в цех, но смена его ещё
            # не подтвердила. Такой материал показывается как «в пути» и в раскрой не идёт.
            f"COALESCE(SUM(r.remaining_quantity) FILTER (WHERE r.accepted_at IS NULL), 0), "
            f"COUNT(r.id) FILTER (WHERE r.accepted_at IS NULL) "
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
             r_workshop_id, shift_number, qty, roll_count, pending_qty, pending_rolls) in rows:
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
                    # Сколько из остатка ещё не принято сменой.
                    'pendingQuantity': 0.0,
                    'pendingRolls': 0,
                }
                materials_map[material_id] = mat_entry
                types_map[type_id]['materials'].append(mat_entry)

            entry = materials_map[material_id]
            entry['cells'].append({
                'workshopId': r_workshop_id,
                'shiftNumber': shift_number,
                'quantity': float(qty),
                'rollCount': roll_count,
                'pendingQuantity': float(pending_qty or 0),
                'pendingRolls': pending_rolls or 0,
            })
            entry['totalQuantity'] += float(qty)
            entry['totalRolls'] += roll_count
            entry['pendingQuantity'] += float(pending_qty or 0)
            entry['pendingRolls'] += pending_rolls or 0

        result = list(types_map.values())
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
        }),
    }