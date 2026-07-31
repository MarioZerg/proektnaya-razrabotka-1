import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Сводный отчёт по материалам, находящимся в цехах (не на складе).

    Группирует остатки рулонов со статусом in_workshop по материалу, цеху и номеру смены.
    Используется на странице "Материал в цехе" (аналог "Материал на производстве").

    GET  /                - сводка: для каждого материала показывает остаток и число рулонов
                             по каждой смене цеха + итого
    GET  /?workshop_id=1  - фильтр по конкретному цеху

    Args:
        event: dict с httpMethod, queryStringParameters
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со сводкой материалов в цехах
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
    workshop_id = params.get('workshop_id')

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        condition = f"AND r.workshop_id = {int(workshop_id)}" if workshop_id else ""

        cur.execute(
            f"SELECT mt.id, mt.name, m.id, m.name, m.unit, r.shift_number, "
            f"SUM(r.remaining_quantity), COUNT(r.id) "
            f"FROM rolls r "
            f"JOIN materials m ON m.id = r.material_id "
            f"JOIN material_types mt ON mt.id = m.type_id "
            f"WHERE r.status = 'in_workshop' AND r.remaining_quantity > 0 {condition} "
            f"GROUP BY mt.id, mt.name, m.id, m.name, m.unit, r.shift_number "
            f"ORDER BY mt.sort_order, m.sort_order, r.shift_number"
        )

        rows = cur.fetchall()

        types_map = {}
        materials_map = {}
        for type_id, type_name, material_id, material_name, unit, shift_number, qty, roll_count in rows:
            if type_id not in types_map:
                types_map[type_id] = {'id': type_id, 'name': type_name, 'materials': []}
            if material_id not in materials_map:
                mat_entry = {
                    'materialId': material_id,
                    'materialName': material_name,
                    'unit': unit,
                    'shifts': [],
                    'totalQuantity': 0.0,
                    'totalRolls': 0,
                }
                materials_map[material_id] = mat_entry
                types_map[type_id]['materials'].append(mat_entry)

            entry = materials_map[material_id]
            entry['shifts'].append({
                'shiftNumber': shift_number,
                'quantity': float(qty),
                'rollCount': roll_count,
            })
            entry['totalQuantity'] += float(qty)
            entry['totalRolls'] += roll_count

        result = list(types_map.values())
    finally:
        conn.close()

    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'types': result})}
