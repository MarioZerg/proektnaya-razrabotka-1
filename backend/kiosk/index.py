import json
import os
import re

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


def next_storage_barcode(cur) -> str:
    """Генерирует следующий штрихкод хранения вида GW-000001 (по максимальному текущему)."""
    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE storage_barcode LIKE 'GW-%'")
    max_seq = 0
    for (bc,) in cur.fetchall():
        suffix = bc.split('-', 1)[1] if '-' in bc else ''
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return f"GW-{max_seq + 1:06d}"


def handler(event: dict, context) -> dict:
    """Терминал упаковщицы (kiosk) — упрощённый экран для завершения стикеровки.

    Упаковщица находит заказ со статусом "Стикеровка" по номеру заказа, проверяет его и
    нажимает "Закрыть заказ" — заказ переходит в статус "Готовые" (после этого доступен для
    приёмки на склад готового товара). Тарифы (salary_rates) полностью раздельные по цехам.
    При закрытии начисляется зарплата:
      - швее (assignedUserId заказа) — фиксированная ставка за штуку по ширине товара
        (salary_rates, role='sewer', width), берётся из тарифов ЦЕХА ЗАКАЗА (workshop_id заказа).
        Именно на этом шаге, а не раньше, чтобы не начислять за заказ, который швея не успела
        дошить (мог быть отправлен на стикеровку по ошибке)
      - упаковщице (та, что закрывает заказ) — ставка за пог.м. на стикеровке
        (salary_rates, role='packer'), берётся из тарифов ЦЕХА САМОЙ УПАКОВЩИЦЫ (users.workshop
        её профиля, а не цеха заказа), метраж = ширина заказа в пог.метрах (width / 100)

    GET  /?orderNumber=XXX  - найти заказ по номеру (для проверки перед закрытием),
                               возвращает базовую информацию, только если заказ в
                               статусе "Стикеровка"

    POST /  { action: 'login_by_code', code }
        - вход на терминал по личному QR-коду сотрудника формата
          "{userId}-{shiftNumber}-{ГГГГММДД}" (например 3-20-20250513). Возвращает сотрудника
          и состояние его смены (открыта/закрыта) — пароль на терминале не нужен

    POST /  { action: 'close_order', orderId, packerId }
        - переводит заказ в статус "Готовые", создаёт начисления швее и упаковщице.
          Фиксирует packer_user_id = packerId — отдельное поле на заказе, аналогично
          cutter_user_id/sewer_user_id, чтобы история "кто упаковал" была видна на карточке

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
                "o.sewing_status, o.assigned_user_id, u.full_name, o.status, o.ozon_status "
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
                # Заказ отменён клиентом: вещь всё равно дошивается, но уходит не покупателю,
                # а на склад хранения — упаковщик клеит стикер ХРАНЕНИЯ вместо отправления.
                'isCancelled': row[9] == 'Отменён' or 'cancel' in (row[10] or '').lower(),
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

            # Вход на терминал по QR-коду сотрудника формата "{userId}-{shiftNumber}-{ГГГГММДД}"
            # (например 3-20-20250513). Пароль не нужен — терминал стоит в цехе, вход по личному
            # QR с бейджа. Возвращаем сотрудника и состояние его смены.
            if action == 'login_by_code':
                code = (body_data.get('code') or '').strip()
                # Сканер мог передать полную ссылку из QR, причём при русской раскладке на
                # терминале латиница превращается в кириллицу, а цифры остаются целыми.
                # Поэтому сначала ищем сам код по шаблону "{id}-{смена}-{дата}".
                m = re.search(r'(\d{1,6}-\d{1,3}-\d{6,8})', code)
                if m:
                    code = m.group(1)
                elif 'barcode=' in code:
                    code = code.split('barcode=')[1].split('&')[0].strip()
                parts = code.split('-')
                if len(parts) < 1 or not parts[0].isdigit():
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неверный код сотрудника'})}
                user_id = int(parts[0])
                shift_from_code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None

                cur.execute(
                    "SELECT u.id, u.full_name, u.role, u.is_active, w.id "
                    "FROM users u LEFT JOIN workshops w ON w.name = u.workshop WHERE u.id = %s",
                    (user_id,),
                )
                u_row = cur.fetchone()
                if not u_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}
                if not u_row[3]:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник неактивен'})}

                cur.execute(
                    "SELECT id, opened_at, workshop_id, shift_number FROM shift_sessions "
                    "WHERE user_id = %s AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
                    (user_id,),
                )
                s_row = cur.fetchone()

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'user': {
                            'id': u_row[0],
                            'name': u_row[1],
                            'role': u_row[2],
                            'shiftFromCode': shift_from_code,
                            'homeWorkshopId': u_row[4],
                        },
                        'shift': {
                            'isOpen': bool(s_row),
                            'openedAt': (s_row[1].isoformat() + 'Z') if s_row else None,
                            'workshopId': s_row[2] if s_row else None,
                            'shiftNumber': s_row[3] if s_row else None,
                        },
                    }),
                }

            if action == 'close_order':
                order_id = body_data.get('orderId')
                packer_id = body_data.get('packerId')
                if not order_id or not packer_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите orderId и packerId'})}

                cur.execute(
                    "SELECT sewing_status, width, assigned_user_id, order_number, workshop_id, "
                    "status, ozon_status FROM orders WHERE id = %s",
                    (int(order_id),),
                )
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                (sewing_status, width, assigned_user_id, order_number, order_workshop_id,
                 order_status, order_ozon_status) = row
                is_cancelled = order_status == 'Отменён' or 'cancel' in (order_ozon_status or '').lower()
                if sewing_status != 'Стикеровка':
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Заказ не на стикеровке (статус: {sewing_status})'}),
                    }

                # Пока в цехе на смене есть упаковщик — стикеровать может только он. Швеи и
                # закройщики допускаются к стикеровке лишь после закрытия его смены.
                cur.execute(
                    "SELECT COALESCE(ss.role, u.role) FROM shift_sessions ss "
                    "JOIN users u ON u.id = ss.user_id "
                    "WHERE ss.user_id = %s AND ss.closed_at IS NULL ORDER BY ss.opened_at DESC LIMIT 1",
                    (int(packer_id),),
                )
                pr = cur.fetchone()
                packer_shift_role = pr[0] if pr else None
                if packer_shift_role and packer_shift_role != 'packer' and order_workshop_id:
                    cur.execute(
                        "SELECT u.full_name FROM shift_sessions ss JOIN users u ON u.id = ss.user_id "
                        "WHERE ss.closed_at IS NULL AND ss.workshop_id = %s "
                        "AND COALESCE(ss.role, u.role) = 'packer' LIMIT 1",
                        (order_workshop_id,),
                    )
                    active_packer = cur.fetchone()
                    if active_packer:
                        return {
                            'statusCode': 403,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'В цехе на смене упаковщик ({active_packer[0]}) — стикеровку '
                                         f'выполняет он. Вы сможете стикеровать после закрытия его смены'
                            }),
                        }

                # packer_user_id фиксирует, КТО именно закрыл заказ (упаковщица) — отдельное
                # поле, аналогично cutter_user_id/sewer_user_id, чтобы история исполнителей на
                # каждом этапе была видна на карточке товара (раньше сохранялось только в
                # salary_accruals для зарплаты и нигде на самом заказе не фиксировалось).
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Готовые', packer_user_id = {int(packer_id)} "
                    f"WHERE id = {int(order_id)}"
                )

                # Заказ отменён клиентом — вещь не поедет покупателю. Сразу заводим её на складе
                # в статусе awaiting_shelf: упаковщик клеит стикер хранения, а кладовщик потом
                # заберёт вещь из цеха и отсканирует на конкретную полку у себя на компьютере.
                storage_barcode = None
                if is_cancelled:
                    cur.execute("SELECT storage_barcode FROM goods_warehouse WHERE order_id = %s", (int(order_id),))
                    gw_existing = cur.fetchone()
                    if gw_existing:
                        storage_barcode = gw_existing[0]
                    else:
                        storage_barcode = next_storage_barcode(cur)
                        cur.execute(
                            "INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
                            "VALUES (%s, 'awaiting_shelf', %s, 'cancelled')",
                            (int(order_id), storage_barcode),
                        )

                # Швея получает фиксированную ставку за штуку по ширине товара — именно сейчас,
                # когда заказ реально дошит и прошёл стикеровку (не раньше). Ставка берётся из
                # тарифов цеха, в котором выполняется заказ (order_workshop_id).
                if assigned_user_id and width and order_workshop_id:
                    cur.execute(
                        "SELECT rate FROM salary_rates WHERE role = 'sewer' AND width = %s AND workshop_id = %s",
                        (int(width), order_workshop_id),
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

                # Упаковщица получает ставку за пог.м. на стикеровке — берётся из тарифов ЕЁ
                # СОБСТВЕННОГО цеха (users.workshop её профиля), а не цеха заказа.
                cur.execute(
                    "SELECT w.id FROM users u JOIN workshops w ON w.name = u.workshop WHERE u.id = %s",
                    (int(packer_id),),
                )
                packer_workshop_row = cur.fetchone()
                packer_workshop_id = packer_workshop_row[0] if packer_workshop_row else None
                # Если стикерует швея/закройщик (упаковщика на смене нет) — оплата всё равно
                # идёт по тарифу упаковщицы; при отсутствии штатного цеха берём цех заказа.
                if not packer_workshop_id:
                    packer_workshop_id = order_workshop_id

                packer_rate = 0.0
                if packer_workshop_id:
                    cur.execute(
                        "SELECT rate FROM salary_rates WHERE role = 'packer' AND workshop_id = %s",
                        (packer_workshop_id,),
                    )
                    packer_rate_row = cur.fetchone()
                    packer_rate = float(packer_rate_row[0]) if packer_rate_row else 0
                if packer_rate > 0 and width:
                    meters = round(float(width) / 100, 2)
                    amount = round(meters * packer_rate, 2)
                    # Если стикеровал не упаковщик (упаковщика на смене не было), помечаем это
                    # в описании начисления — админу видно, кто подменял упаковщицу.
                    role_labels = {'sewer': 'швея', 'cutter': 'закройщик', 'packer': 'упаковщик'}
                    instead_note = ''
                    if packer_shift_role and packer_shift_role != 'packer':
                        instead_note = f' (стикеровал {role_labels.get(packer_shift_role, packer_shift_role)} вместо упаковщицы)'
                    cur.execute(
                        "INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                        "VALUES (%s, 'packer_stickering', %s, %s, %s) "
                        "ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING",
                        (
                            int(packer_id), amount, int(order_id),
                            f'Стикеровка заказа #{order_number} - {meters} п.м.{instead_note}',
                        ),
                    )

                log_action(
                    cur, actor_id, actor_name, 'close_order', 'order', order_id,
                    f'Закрыл заказ #{order_number} после стикеровки'
                    + (' (отменён клиентом — на склад хранения)' if is_cancelled else ''),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'success': True,
                        'isCancelled': is_cancelled,
                        'storageBarcode': storage_barcode,
                    }),
                }

            if action == 'defect_writeoff':
                # Списание брака прямо на терминале: сотрудник сканирует СВОЙ штрихкод, и если
                # он штатный работник цеха этого рулона — брак списывается (в том числе за
                # гостевых работников, которым списание в чужом цехе запрещено).
                code = (body_data.get('code') or '').strip()
                roll_id = body_data.get('rollId')
                quantity = body_data.get('quantity')
                comment = (body_data.get('comment') or '').strip()
                if not code or not roll_id or quantity in (None, ''):
                    return {'statusCode': 400, 'headers': headers,
                            'body': json.dumps({'error': 'Отсканируйте штрихкод, выберите рулон и укажите метраж'})}

                m = re.search(r'(\d{1,6}-\d{1,3}-\d{6,8})', code)
                if m:
                    code = m.group(1)
                elif 'barcode=' in code:
                    code = code.split('barcode=')[1].split('&')[0].strip()
                actor_uid = code.split('-')[0]
                if not actor_uid.isdigit():
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный штрихкод'})}

                cur.execute(
                    "SELECT u.full_name, u.role, w.id, u.is_active FROM users u "
                    "LEFT JOIN workshops w ON w.name = u.workshop WHERE u.id = %s",
                    (int(actor_uid),),
                )
                au = cur.fetchone()
                if not au:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник не найден'})}
                if not au[3]:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Сотрудник неактивен'})}

                cur.execute(
                    "SELECT r.workshop_id, r.remaining_quantity, w.name, m.unit FROM rolls r "
                    "LEFT JOIN workshops w ON w.id = r.workshop_id "
                    "LEFT JOIN materials m ON m.id = r.material_id WHERE r.id = %s",
                    (int(roll_id),),
                )
                rr = cur.fetchone()
                if not rr:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Рулон не найден'})}

                if au[1] not in ('admin', 'storekeeper', 'manager') and rr[0] and rr[0] != au[2]:
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({
                        'error': f'{au[0]} не относится к цеху «{rr[2]}» — брак может списать только '
                                 f'штатный сотрудник этого цеха'})}

                qty = float(quantity)
                if qty <= 0:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Метраж должен быть больше нуля'})}
                if qty > float(rr[1] or 0):
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({
                        'error': f'На рулоне осталось {round(float(rr[1] or 0), 2)} {rr[3] or "м"}'})}

                cur.execute(
                    "INSERT INTO shipments (type, status, comment, completed_at, created_by) "
                    "VALUES ('defect_writeoff', 'Завершено', %s, now(), %s) RETURNING id",
                    (comment or None, int(actor_uid)),
                )
                shipment_id = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO shipment_items (shipment_id, roll_id, quantity) VALUES (%s, %s, %s)",
                    (shipment_id, int(roll_id), qty),
                )
                new_remaining = float(rr[1] or 0) - qty
                if new_remaining <= 0:
                    cur.execute(
                        "UPDATE rolls SET remaining_quantity = 0, status = 'completed', completed_at = now() "
                        "WHERE id = %s", (int(roll_id),))
                else:
                    cur.execute("UPDATE rolls SET remaining_quantity = %s WHERE id = %s",
                                (new_remaining, int(roll_id)))

                log_action(
                    cur, int(actor_uid), au[0], 'defect_writeoff', 'shipment', shipment_id,
                    f'Списал брак на терминале: рулон #{roll_id}, {qty}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({'success': True, 'id': shipment_id, 'actorName': au[0]})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}