import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Сводный отчёт по материалам, находящимся в цехах (не на складе).

    Полностью повторяет раздел "Материал на производстве" физического склада:
    группирует остатки рулонов со статусом in_workshop по материалу, цеху и смене.
    У каждого цеха свой набор именованных смен (например у Цеха №1 — "Смена № 1" и
    "Смена № 2", у Цеха №2 — "5/2"), поэтому колонки строятся динамически по всем
    цехам сразу: cпискок колонок = все смены всех активных цехов.

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
    finally:
        conn.close()

    active_column = None
    if active_column_key:
        active_column = {'workshopId': active_column_key[0], 'shiftNumber': active_column_key[1]}

    return {
        'statusCode': 200,
        'headers': headers,
        'body': json.dumps({'types': result, 'columns': columns, 'activeColumn': active_column}),
    }