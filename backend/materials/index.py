import json
import os

import psycopg2

from authz import AuthError, auth_error_response, require_admin


def handler(event: dict, context) -> dict:
    """Управляет справочником типов и материалов (тюль, аксессуары, упаковка и т.д.).

    GET  /                      - получить все типы и материалы; у каждого материала
                                   дополнительно приходят warehouseQuantity (сумма остатков
                                   рулонов со статусом in_storage) и warehouseRolls (число таких
                                   рулонов) — это фактические остатки на складе, появляются
                                   только после того, как админ подтвердит приёмку от поставщика
                                   (action 'approve_supply' в backend/shipments создаёт рулоны
                                   in_storage); списание/отгрузка в цех эти остатки уменьшает
    POST /  { action: 'create_type', name }
    POST /  { action: 'create_material', typeId, name, unit, status }
    POST /  { action: 'update_material', id, name?, unit?, status?, typeId? }
    POST /  { action: 'delete_material', id }
    GET  /?view=packaging       - справочник упаковки для упаковщицы: какой пакет
                                   к какому товару подходит. Строится по фактическим
                                   привязкам материалов к товарам маркетплейса

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с данными типов/материалов
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

    params = event.get('queryStringParameters') or {}

    # Справочник упаковки для упаковщицы.
    #
    # Пакет подбирается по ДВУМ параметрам: ширине изделия и ткани. Высота на выбор
    # пакета не влияет — товар складывается, и высота уходит в толщину свёртка.
    # Плотные ткани (мрамор, лён) при той же ширине требуют пакет побольше, поэтому
    # одной таблицей «ширина → пакет» обойтись нельзя.
    #
    # Данные не хранятся отдельно, а собираются из фактических привязок материалов
    # к товарам: так справочник не разъедется с реальностью, если упаковку у товаров
    # поменяют.
    if method == 'GET' and params.get('view') == 'packaging':
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT mi.material, mi.width, m.name, COUNT(*) "
                "FROM marketplace_item_materials mim "
                "JOIN materials m ON m.id = mim.material_id "
                "JOIN marketplace_items mi ON mi.id = mim.marketplace_item_id "
                "WHERE m.name ILIKE 'Пакет%' AND mi.material IS NOT NULL AND mi.width IS NOT NULL "
                "GROUP BY mi.material, mi.width, m.name "
                "ORDER BY mi.material, mi.width"
            )
            rows = [
                {'fabric': r[0], 'width': r[1], 'bag': r[2], 'itemsCount': r[3]}
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        fabrics = sorted({r['fabric'] for r in rows})
        widths = sorted({r['width'] for r in rows})
        bags = sorted({r['bag'] for r in rows})

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {'rows': rows, 'fabrics': fabrics, 'widths': widths, 'bags': bags},
                ensure_ascii=False,
            ),
        }

    if method == 'GET':
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute("SELECT id, name, sort_order FROM material_types ORDER BY sort_order, id")
            types = [{'id': r[0], 'name': r[1], 'sortOrder': r[2]} for r in cur.fetchall()]

            # Справочной цены у материала больше нет — себестоимость приходит от поставщика
            # и хранится на каждом рулоне. Для справки отдаём среднюю цену по тем рулонам,
            # что сейчас лежат на складе: видно, почём материал обходится на самом деле.
            cur.execute(
                "SELECT m.id, m.type_id, m.name, m.unit, "
                "COALESCE((SELECT AVG(NULLIF(r.cost_per_unit, 0)) FROM rolls r "
                "WHERE r.material_id = m.id AND r.status IN ('in_storage', 'in_workshop')), 0), "
                "m.status, m.sort_order, "
                "EXISTS(SELECT 1 FROM material_movements mm WHERE mm.material_id = m.id), "
                "COALESCE((SELECT SUM(r.remaining_quantity) FROM rolls r "
                "WHERE r.material_id = m.id AND r.status = 'in_storage'), 0), "
                "COALESCE((SELECT COUNT(*) FROM rolls r "
                "WHERE r.material_id = m.id AND r.status = 'in_storage'), 0), "
                # Ткань с осыпающимся краем: заказ из неё сначала обмётывают на
                # оверлоке и только потом отдают швее на прямострочку.
                "m.requires_overlock "
                "FROM materials m ORDER BY m.sort_order, m.id"
            )
            materials = [
                {
                    'id': r[0],
                    'typeId': r[1],
                    'name': r[2],
                    'unit': r[3],
                    # Средняя себестоимость по рулонам на складе, не редактируется вручную.
                    'avgCost': float(r[4]),
                    'status': r[5],
                    'sortOrder': r[6],
                    'hasMovements': r[7],
                    'warehouseQuantity': float(r[8]),
                    'warehouseRolls': r[9],
                    'requiresOverlock': bool(r[10]),
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'types': types, 'materials': materials}),
        }

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # СПРАВОЧНИК МАТЕРИАЛОВ ПРАВИТ ТОЛЬКО АДМИНИСТРАТОР.
            #
            # Проверок здесь не было вовсе. Через правку материала можно тихо
            # подменить единицу измерения или норму расхода — и остатки по всему
            # складу поедут, а выглядеть это будет как ошибка учёта, а не как
            # чьё-то действие.
            require_admin(cur, event)

            if action == 'create_type':
                name = (body_data.get('name') or '').strip()
                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название типа'})}
                # Значения подставляет драйвер (%s): название приходит от человека.
                cur.execute(
                    "INSERT INTO material_types (name, sort_order) "
                    "VALUES (%s, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM material_types)) "
                    "ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name "
                    "RETURNING id",
                    (name,),
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'create_material':
                type_id = body_data.get('typeId')
                name = (body_data.get('name') or '').strip()
                unit = (body_data.get('unit') or 'шт').strip()
                status = (body_data.get('status') or 'active').strip()
                if not type_id or not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите тип и название'})}
                # Цену при создании не задаём: она придёт от поставщика при первой приёмке.
                cur.execute(
                    "INSERT INTO materials (type_id, name, unit, status, requires_overlock, sort_order) "
                    "VALUES (%s, %s, %s, %s, %s, "
                    "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM materials WHERE type_id = %s)) "
                    "RETURNING id",
                    (int(type_id), name, unit, status,
                     bool(body_data.get('requiresOverlock')), int(type_id)),
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update_material':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                # Имена полей задаём мы, значения подставляет драйвер (%s).
                fields = []
                values = []
                if 'name' in body_data:
                    fields.append("name = %s")
                    values.append(str(body_data['name']))
                if 'unit' in body_data:
                    fields.append("unit = %s")
                    values.append(str(body_data['unit']))
                if 'status' in body_data:
                    fields.append("status = %s")
                    values.append(str(body_data['status']))
                if 'typeId' in body_data:
                    fields.append("type_id = %s")
                    values.append(int(body_data['typeId']))
                if 'requiresOverlock' in body_data:
                    fields.append("requires_overlock = %s")
                    values.append(bool(body_data['requiresOverlock']))
                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}
                values.append(int(item_id))
                cur.execute(
                    f"UPDATE materials SET {', '.join(fields)} WHERE id = %s",
                    tuple(values),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete_material':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "SELECT COUNT(*) FROM material_movements WHERE material_id = %s",
                    (int(item_id),),
                )
                movements_count = cur.fetchone()[0]
                if movements_count > 0:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Материал участвовал в движениях по заказам — удалить нельзя. Переведите его в архив.'}
                        ),
                    }
                cur.execute("DELETE FROM materials WHERE id = %s", (int(item_id),))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete_type':
                # Удалить можно только пустую группу: если в ней есть материалы, они бы
                # «повисли» без категории. Тогда сначала переносим материалы в другую группу.
                type_id = body_data.get('id')
                if not type_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "SELECT COUNT(*), COALESCE(MIN(name), '') FROM materials WHERE type_id = %s",
                    (int(type_id),),
                )
                cnt_row = cur.fetchone()
                if cnt_row[0] > 0:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'В группе есть материалы ({cnt_row[0]} шт, например «{cnt_row[1]}») — '
                                     f'сначала перенесите их в другую группу'
                        }),
                    }
                cur.execute("DELETE FROM material_types WHERE id = %s", (int(type_id),))
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        except AuthError as e:
            conn.rollback()
            return auth_error_response(e, headers)
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}