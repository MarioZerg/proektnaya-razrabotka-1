import json
import os

import psycopg2


def handler(event: dict, context) -> dict:
    """Управляет справочником поставщиков.

    Себестоимость материалов зависит от поставщика: один и тот же материал у разных
    поставщиков стоит по-разному. Часть цен в валюте (вуаль 1.4 $ при курсе 65 ₽),
    часть — фиксированные в рублях (тесьма 5.90 ₽). Поэтому у поставщика есть валюта,
    курс по умолчанию и свой прайс по материалам.

    GET  /                       - получить список поставщиков вместе с их прайсами
    POST /  { action: 'create', name, phone?, address?, comment?, currency?, exchangeRate? }
    POST /  { action: 'update', id, name?, phone?, address?, comment?, currency?, exchangeRate? }
    POST /  { action: 'set_prices', id, prices: [{materialId, price, currency}] }
    POST /  { action: 'delete', id }

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над поставщиками
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
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, name, phone, address, comment, created_at, updated_at, "
                "currency, exchange_rate "
                "FROM suppliers ORDER BY id"
            )
            suppliers = [
                {
                    'id': r[0],
                    'name': r[1],
                    'phone': r[2],
                    'address': r[3],
                    'comment': r[4],
                    'createdAt': r[5].isoformat() + 'Z',
                    'updatedAt': r[6].isoformat() + 'Z',
                    'currency': r[7] or 'RUB',
                    'exchangeRate': float(r[8]) if r[8] is not None else None,
                    'prices': [],
                }
                for r in cur.fetchall()
            ]

            # Прайс каждого поставщика: цена материала в его валюте.
            cur.execute(
                "SELECT sp.supplier_id, sp.material_id, m.name, m.unit, sp.price, sp.currency "
                "FROM supplier_prices sp JOIN materials m ON m.id = sp.material_id "
                "ORDER BY m.name"
            )
            by_supplier = {}
            for sup_id, mat_id, mat_name, unit, price, currency in cur.fetchall():
                by_supplier.setdefault(sup_id, []).append({
                    'materialId': mat_id,
                    'materialName': mat_name,
                    'unit': unit,
                    'price': float(price),
                    'currency': currency or 'RUB',
                })
            for sup in suppliers:
                sup['prices'] = by_supplier.get(sup['id'], [])
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'suppliers': suppliers})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                phone = (body_data.get('phone') or '').strip()
                address = (body_data.get('address') or '').strip()
                comment = (body_data.get('comment') or '').strip()

                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название поставщика'})}

                name_esc = name.replace("'", "''")
                phone_esc = phone.replace("'", "''")
                address_esc = address.replace("'", "''")
                comment_esc = comment.replace("'", "''")

                currency = (body_data.get('currency') or 'RUB').strip().upper()[:10]
                rate = body_data.get('exchangeRate')
                rate_sql = 'NULL' if rate in (None, '') else str(float(rate))

                cur.execute(
                    f"INSERT INTO suppliers (name, phone, address, comment, currency, exchange_rate) "
                    f"VALUES ('{name_esc}', '{phone_esc}', '{address_esc}', '{comment_esc}', "
                    f"'{currency}', {rate_sql}) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'update':
                supplier_id = body_data.get('id')
                if not supplier_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

                fields = []
                if 'name' in body_data:
                    fields.append(f"name = '{str(body_data['name']).replace(chr(39), chr(39)*2)}'")
                if 'phone' in body_data:
                    fields.append(f"phone = '{str(body_data['phone']).replace(chr(39), chr(39)*2)}'")
                if 'address' in body_data:
                    fields.append(f"address = '{str(body_data['address']).replace(chr(39), chr(39)*2)}'")
                if 'comment' in body_data:
                    fields.append(f"comment = '{str(body_data['comment']).replace(chr(39), chr(39)*2)}'")
                if 'currency' in body_data:
                    cur_val = str(body_data['currency'] or 'RUB').strip().upper()[:10]
                    fields.append(f"currency = '{cur_val}'")
                if 'exchangeRate' in body_data:
                    rate = body_data['exchangeRate']
                    fields.append(
                        "exchange_rate = NULL" if rate in (None, '')
                        else f"exchange_rate = {float(rate)}"
                    )
                fields.append("updated_at = now()")

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                cur.execute(f"UPDATE suppliers SET {', '.join(fields)} WHERE id = {int(supplier_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'set_prices':
                # Прайс поставщика: цена каждого материала в его валюте. Полностью
                # заменяем список — так проще, чем ловить, что добавили, а что убрали.
                supplier_id = body_data.get('id')
                prices = body_data.get('prices')
                if not supplier_id or prices is None:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id и prices'})}

                cur.execute("SELECT 1 FROM suppliers WHERE id = %s", (int(supplier_id),))
                if not cur.fetchone():
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставщик не найден'})}

                for item in prices:
                    material_id = item.get('materialId')
                    price = item.get('price')
                    currency = (item.get('currency') or 'RUB').strip().upper()[:10]
                    if not material_id:
                        continue
                    if price in (None, ''):
                        continue
                    if float(price) < 0:
                        return {
                            'statusCode': 400,
                            'headers': headers,
                            'body': json.dumps({'error': 'Цена не может быть отрицательной'}, ensure_ascii=False),
                        }
                    cur.execute(
                        "INSERT INTO supplier_prices (supplier_id, material_id, price, currency) "
                        "VALUES (%s, %s, %s, %s) "
                        "ON CONFLICT (supplier_id, material_id) DO UPDATE "
                        "SET price = EXCLUDED.price, currency = EXCLUDED.currency, updated_at = now()",
                        (int(supplier_id), int(material_id), float(price), currency),
                    )

                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                supplier_id = body_data.get('id')
                if not supplier_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(f"DELETE FROM suppliers WHERE id = {int(supplier_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}