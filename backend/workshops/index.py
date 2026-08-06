import json
import os

import psycopg2

SETTINGS_KEYS = [
    'working_day_start',
    'working_day_end',
    'is_enabled_work_schedule',
    'api_key_wb',
    'api_key_ozon',
    'seller_id_ozon',
    'max_quantity_orders_to_seamstress',
    'orders_priority',
    'late_opened_shift_penalty',
    'unclosed_shift_penalty',
    'unclosed_shift_with_orders_penalty',
    'is_enabled_work_shift',
    'max_quantity_orders_to_cutter',
    'cutter_daily_limit',
    'cancel_order_penalty',
    'seamstress_daily_limit',
    'max_quantity_orders_without_timeout',
    'timeout_200',
    'timeout_300',
    'timeout_400',
    'timeout_500',
    'timeout_600',
    'timeout_700',
    'timeout_800',
    'print_qr_cutting',
    'sticking_otk',
    'sticking_seamstress',
    'orders_filter',
    'orders_cluster_priority',
    'max_fabric_rolls_per_shift',
]


def handler(event: dict, context) -> dict:
    """Управляет цехами: список, создание, редактирование, детальная карточка с настройками.

    GET  /                       - получить список цехов с числом смен и сотрудников
    GET  /?id=1                  - получить детальную карточку цеха (материалы, товары, настройки, смены)
    POST /  { action: 'create', name, shiftsCount? }
        - создаёт цех; автоматически копирует полную таблицу тарифов зарплаты (salary_rates)
          с первого по списку существующего цеха — тарифы полностью раздельные по цехам,
          у нового цеха сразу появляется рабочий набор ставок (админ может их скорректировать)
    POST /  { action: 'update', id, name?, shiftsCount?, isActive?, allowedProducts?, allowedMaterials?, settings? }
    POST /  { action: 'delete', id }
        - удаляет цех. Отклоняется (409), если у цеха есть хотя бы одна смена (таблица
          shifts) — сначала нужно удалить все смены цеха на вкладке "Смены". Также
          отклоняется, если с цехом связаны реальные бизнес-данные (рулоны, заказы,
          отгрузки, история открытия смен) — их нельзя молча потерять. Конфигурационные
          данные (тарифы salary_rates, переопределения настроек workshop_settings,
          блокировки автозаказа, нормы расхода материалов) удаляются каскадно вместе с цехом

    settings — словарь { key: value|null }, null означает "использовать глобальное значение".

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/детальными данными/результатом операции над цехами
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
        workshop_id = params.get('id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if workshop_id:
                cur.execute(
                    "SELECT id, name, is_active, shifts_count, allowed_products, allowed_materials, "
                    "created_at, updated_at FROM workshops WHERE id = %s",
                    (int(workshop_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Цех не найден'})}

                w_id = row[0]

                cur.execute(
                    "SELECT shift_number, COUNT(*) FROM users "
                    "WHERE workshop = %s AND shift_number IS NOT NULL GROUP BY shift_number ORDER BY shift_number",
                    (row[1],),
                )
                shifts = [{'number': r[0], 'employeesCount': r[1]} for r in cur.fetchall()]

                cur.execute(
                    "SELECT key, value FROM workshop_settings WHERE workshop_id = %s", (w_id,)
                )
                overrides = {r[0]: r[1] for r in cur.fetchall()}

                cur.execute("SELECT key, value FROM system_settings")
                globals_map = {r[0]: r[1] for r in cur.fetchall()}

                settings = {
                    key: {'value': overrides.get(key), 'global': globals_map.get(key)}
                    for key in SETTINGS_KEYS
                }

                detail = {
                    'id': w_id,
                    'name': row[1],
                    'isActive': row[2],
                    'shiftsCount': row[3],
                    'allowedProducts': row[4] or [],
                    'allowedMaterials': row[5] or [],
                    'createdAt': row[6].isoformat() + 'Z',
                    'updatedAt': row[7].isoformat() + 'Z',
                    'shifts': shifts,
                    'settings': settings,
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'workshop': detail})}

            cur.execute(
                "SELECT w.id, w.name, w.is_active, w.shifts_count, w.created_at, w.updated_at, "
                "(SELECT COUNT(*) FROM users u WHERE u.workshop = w.name), w.shift_names "
                "FROM workshops w ORDER BY w.id"
            )
            workshops = [
                {
                    'id': r[0],
                    'name': r[1],
                    'isActive': r[2],
                    'shiftsCount': r[3],
                    'createdAt': r[4].isoformat() + 'Z',
                    'updatedAt': r[5].isoformat() + 'Z',
                    'employeesCount': r[6],
                    'shiftNames': r[7] if isinstance(r[7], list) else json.loads(r[7] or '[]'),
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'workshops': workshops})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                shifts_count = body_data.get('shiftsCount', 1)

                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название цеха'})}

                name_esc = name.replace("'", "''")
                cur.execute(f"SELECT id FROM workshops WHERE name = '{name_esc}'")
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Цех с названием {name} уже есть'}),
                    }

                cur.execute(
                    f"INSERT INTO workshops (name, shifts_count) VALUES ('{name_esc}', {int(shifts_count)}) RETURNING id"
                )
                new_id = cur.fetchone()[0]

                # Тарифы зарплаты (salary_rates) полностью раздельные по цехам — у нового цеха
                # своих ставок ещё нет. Заполняем копированием структуры/значений тарифов
                # первого по списку существующего цеха (кроме только что созданного), чтобы
                # сразу была рабочая конфигурация — админ при необходимости скорректирует ставки.
                cur.execute(
                    "SELECT id FROM workshops WHERE id != %s ORDER BY id LIMIT 1", (new_id,)
                )
                template_row = cur.fetchone()
                if template_row:
                    template_workshop_id = template_row[0]
                    cur.execute(
                        "INSERT INTO salary_rates (role, material_id, width, rate, workshop_id) "
                        "SELECT role, material_id, width, rate, %s FROM salary_rates WHERE workshop_id = %s",
                        (new_id, template_workshop_id),
                    )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update':
                workshop_id = body_data.get('id')
                if not workshop_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                fields = []
                if 'name' in body_data:
                    fields.append(f"name = '{str(body_data['name']).replace(chr(39), chr(39)*2)}'")
                if 'shiftsCount' in body_data:
                    fields.append(f"shifts_count = {int(body_data['shiftsCount'])}")
                if 'isActive' in body_data:
                    fields.append(f"is_active = {'true' if body_data['isActive'] else 'false'}")
                if 'allowedProducts' in body_data:
                    products_json = json.dumps(body_data['allowedProducts']).replace("'", "''")
                    fields.append(f"allowed_products = '{products_json}'::jsonb")
                if 'allowedMaterials' in body_data:
                    materials_json = json.dumps(body_data['allowedMaterials']).replace("'", "''")
                    fields.append(f"allowed_materials = '{materials_json}'::jsonb")
                fields.append("updated_at = now()")

                if fields:
                    cur.execute(f"UPDATE workshops SET {', '.join(fields)} WHERE id = {int(workshop_id)}")

                if 'settings' in body_data and isinstance(body_data['settings'], dict):
                    for key, value in body_data['settings'].items():
                        if key not in SETTINGS_KEYS:
                            continue
                        key_esc = key.replace("'", "''")
                        if value is None or value == '':
                            cur.execute(
                                f"DELETE FROM workshop_settings WHERE workshop_id = {int(workshop_id)} AND key = '{key_esc}'"
                            )
                        else:
                            value_esc = str(value).replace("'", "''")
                            cur.execute(
                                f"INSERT INTO workshop_settings (workshop_id, key, value) "
                                f"VALUES ({int(workshop_id)}, '{key_esc}', '{value_esc}') "
                                f"ON CONFLICT (workshop_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
                            )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                workshop_id = body_data.get('id')
                if not workshop_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                cur.execute("SELECT id FROM workshops WHERE id = %s", (int(workshop_id),))
                if not cur.fetchone():
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Цех не найден'})}

                # Удаление запрещено, если у цеха ещё есть хоть одна смена — сначала нужно
                # удалить все смены цеха (на вкладке "Смены"), только потом можно удалить сам цех.
                cur.execute("SELECT COUNT(*) FROM shifts WHERE workshop_id = %s", (int(workshop_id),))
                shifts_count = cur.fetchone()[0]
                if shifts_count > 0:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'У цеха есть {shifts_count} смен(ы) — сначала удалите все смены цеха'}),
                    }

                # Удаление также запрещено, если с цехом связаны реальные бизнес-данные
                # (рулоны, заказы, отгрузки, история открытия смен) — их нельзя молча потерять.
                data_checks = [
                    ('rolls', 'рулонов материалов'),
                    ('orders', 'заказов'),
                    ('shipments', 'отгрузок/поставок'),
                    ('shift_sessions', 'записей истории смен'),
                ]
                for table, label in data_checks:
                    cur.execute(f"SELECT COUNT(*) FROM {table} WHERE workshop_id = %s", (int(workshop_id),))
                    cnt = cur.fetchone()[0]
                    if cnt > 0:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({'error': f'С цехом связано {cnt} {label} — удаление невозможно'}),
                        }

                # Конфигурационные данные цеха (тарифы, переопределения настроек, блокировки
                # автозаказа) бессмысленны без самого цеха — удаляются каскадно вместе с ним.
                cur.execute("DELETE FROM salary_rates WHERE workshop_id = %s", (int(workshop_id),))
                cur.execute("DELETE FROM workshop_settings WHERE workshop_id = %s", (int(workshop_id),))
                cur.execute("DELETE FROM auto_order_blocks WHERE workshop_id = %s", (int(workshop_id),))
                cur.execute("DELETE FROM shift_calendar WHERE workshop_id = %s", (int(workshop_id),))
                cur.execute("DELETE FROM marketplace_item_materials WHERE workshop_id = %s", (int(workshop_id),))

                cur.execute(f"DELETE FROM workshops WHERE id = {int(workshop_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}