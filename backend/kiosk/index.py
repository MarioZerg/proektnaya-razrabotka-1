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
            'production',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


def handler(event: dict, context) -> dict:
    """Терминал упаковщицы (kiosk) — упрощённый экран для завершения стикеровки.

    Упаковщица находит заказ со статусом "Стикеровка" по номеру заказа, проверяет его и
    нажимает "Закрыть заказ" — заказ переходит в статус "Готовые" (после этого доступен для
    приёмки на склад готового товара). При закрытии начисляется зарплата:
      - швее (assignedUserId заказа) — фиксированная ставка за штуку по ширине товара
        (salary_rates, role='sewer', width). Именно на этом шаге, а не раньше, чтобы не
        начислять за заказ, который швея не успела дошить (мог быть отправлен на
        стикеровку по ошибке)
      - упаковщице (та, что закрывает заказ) — ставка за пог.м. на стикеровке
        (salary_rates, role='packer'), метраж = ширина заказа в пог.метрах (width / 100)

    GET  /?orderNumber=XXX  - найти заказ по номеру (для проверки перед закрытием),
                               возвращает базовую информацию, только если заказ в
                               статусе "Стикеровка"

    POST /  { action: 'close_order', orderId, packerId }
        - переводит заказ в статус "Готовые", создаёт начисления швее и упаковщице

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с данными заказа/результатом закрытия
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
        order_number = (params.get('orderNumber') or '').strip()
        if not order_number:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите orderNumber'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            order_number_esc = order_number.replace("'", "''")
            cur.execute(
                "SELECT o.id, o.order_number, o.product, o.material, o.width, o.height, "
                "o.sewing_status, o.assigned_user_id, u.full_name "
                "FROM orders o LEFT JOIN users u ON u.id = o.assigned_user_id "
                f"WHERE o.order_number = '{order_number_esc}'"
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Заказ {order_number} не найден'})}
            if row[6] != 'Стикеровка':
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': f'Заказ {order_number} не на стикеровке (статус: {row[6]})'}),
                }

            order = {
                'id': row[0],
                'orderNumber': row[1],
                'product': row[2],
                'material': row[3],
                'width': row[4],
                'height': row[5],
                'sewingStatus': row[6],
                'assignedUserId': row[7],
                'assignedUserName': row[8],
            }
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'order': order})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'close_order':
                order_id = body_data.get('orderId')
                packer_id = body_data.get('packerId')
                if not order_id or not packer_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите orderId и packerId'})}

                cur.execute(
                    "SELECT sewing_status, width, assigned_user_id, order_number FROM orders WHERE id = %s",
                    (int(order_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                sewing_status, width, assigned_user_id, order_number = row
                if sewing_status != 'Стикеровка':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Заказ не на стикеровке (статус: {sewing_status})'}),
                    }

                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Готовые' WHERE id = {int(order_id)}"
                )

                # Швея получает фиксированную ставку за штуку по ширине товара — именно сейчас,
                # когда заказ реально дошит и прошёл стикеровку (не раньше)
                if assigned_user_id and width:
                    cur.execute(
                        "SELECT rate FROM salary_rates WHERE role = 'sewer' AND width = %s",
                        (int(width),),
                    )
                    rate_row = cur.fetchone()
                    sewer_rate = float(rate_row[0]) if rate_row else 0
                    if sewer_rate > 0:
                        cur.execute(
                            f"INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                            f"VALUES ({int(assigned_user_id)}, 'sewer_piece', {sewer_rate}, {int(order_id)}, "
                            f"'Пошив заказа #{order_number} ({width} см)') "
                            f"ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING"
                        )

                # Упаковщица получает ставку за пог.м. на стикеровке
                cur.execute("SELECT rate FROM salary_rates WHERE role = 'packer' LIMIT 1")
                packer_rate_row = cur.fetchone()
                packer_rate = float(packer_rate_row[0]) if packer_rate_row else 0
                if packer_rate > 0 and width:
                    meters = round(float(width) / 100, 2)
                    amount = round(meters * packer_rate, 2)
                    cur.execute(
                        f"INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                        f"VALUES ({int(packer_id)}, 'packer_stickering', {amount}, {int(order_id)}, "
                        f"'Стикеровка заказа #{order_number} - {meters} п.м.') "
                        f"ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING"
                    )

                log_action(
                    cur, actor_id, actor_name, 'close_order', 'order', order_id,
                    f'Закрыл заказ #{order_number} после стикеровки',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
