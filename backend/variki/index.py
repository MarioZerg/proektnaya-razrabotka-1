import base64
import json
import os
import uuid

import boto3
import psycopg2

# Внутренняя игровая валюта "Варики" (викторина/лототрон для производственных сотрудников).
# НЕ финансы — в зарплате/кассе не учитывается. Начисляются в backend/orders при отправке
# заказа на стикеровку. Здесь: GET баланс сотрудника / список игроков для админа;
# POST списание вариков админом (игра в лототрон).

# Порог, при котором сотруднику предлагается сыграть в лототрон (≈580 заказов при рандоме 1-12).
LOTOTRON_THRESHOLD = 3770

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

PRODUCTION_ROLES = ('sewer', 'cutter', 'packer')


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False),
    }


def handler(event: dict, context) -> dict:
    """Внутренняя игровая валюта "Варики".

    GET /?userId=N   - баланс вариков сотрудника (+порог лототрона)
    GET /?players=1  - список производственных сотрудников с их вариками (для админа)
    GET /?shop=1&userId=N     - витрина магазина и покупки сотрудника
    GET /?purchases=1&actorId=N - все покупки (для админа)
    POST / { action: 'debit', actorId, userId, amount } - списание вариков (только админ)
    POST / { action: 'buy', userId, itemId }            - купить подарок за варики
    POST / { action: 'attach_coupon', actorId, purchaseId, fileBase64, fileName }
        - админ прикрепляет PDF-купон к покупке, сотрудник видит его в магазине
    POST / { action: 'cancel_purchase', actorId, purchaseId, reason }
        - покупка отменена, варики возвращаются сотруднику
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}

            if params.get('shop'):
                # Витрина магазина + покупки самого сотрудника. Сюда ходит и админ
                # (посмотреть, что в продаже), и швея (купить и забрать купон).
                cur.execute(
                    "SELECT id, title, description, price, animation, icon "
                    "FROM variki_shop_items WHERE is_active = true "
                    "ORDER BY sort_order, id"
                )
                items = [
                    {'id': r[0], 'title': r[1], 'description': r[2],
                     'price': r[3], 'animation': r[4], 'icon': r[5]}
                    for r in cur.fetchall()
                ]
                user_id = params.get('userId')
                balance = 0
                purchases = []
                if user_id:
                    cur.execute(
                        "SELECT COALESCE(variki, 0) FROM users WHERE id = %s",
                        (int(user_id),),
                    )
                    br = cur.fetchone()
                    balance = int(br[0]) if br else 0
                    cur.execute(
                        "SELECT p.id, p.item_id, i.title, p.price, p.status, p.created_at, "
                        "  p.coupon_url, p.coupon_name, p.coupon_at, p.cancel_reason "
                        "FROM variki_purchases p "
                        "JOIN variki_shop_items i ON i.id = p.item_id "
                        "WHERE p.user_id = %s ORDER BY p.created_at DESC",
                        (int(user_id),),
                    )
                    purchases = [
                        {'id': r[0], 'itemId': r[1], 'title': r[2], 'price': r[3],
                         'status': r[4],
                         'createdAt': r[5].isoformat() + 'Z' if r[5] else None,
                         'couponUrl': r[6], 'couponName': r[7],
                         'couponAt': r[8].isoformat() + 'Z' if r[8] else None,
                         'cancelReason': r[9]}
                        for r in cur.fetchall()
                    ]
                return _resp(200, {'items': items, 'balance': balance, 'purchases': purchases})

            if params.get('purchases'):
                # Все покупки — рабочий список админа: по нему он видит, кому ещё
                # не прислал купон.
                actor_id = params.get('actorId')
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    ar = cur.fetchone()
                    actor_role = ar[0] if ar else None
                if actor_role != 'admin':
                    return _resp(403, {'error': 'Доступ только для администратора'})
                cur.execute(
                    "SELECT p.id, p.user_id, p.user_name, i.title, p.price, p.status, "
                    "  p.created_at, p.coupon_url, p.coupon_name, p.coupon_at, p.cancel_reason "
                    "FROM variki_purchases p "
                    "JOIN variki_shop_items i ON i.id = p.item_id "
                    "ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT 100"
                )
                rows = [
                    {'id': r[0], 'userId': r[1], 'userName': r[2], 'title': r[3],
                     'price': r[4], 'status': r[5],
                     'createdAt': r[6].isoformat() + 'Z' if r[6] else None,
                     'couponUrl': r[7], 'couponName': r[8],
                     'couponAt': r[9].isoformat() + 'Z' if r[9] else None,
                     'cancelReason': r[10]}
                    for r in cur.fetchall()
                ]
                pending = sum(1 for r in rows if r['status'] == 'pending')
                return _resp(200, {'purchases': rows, 'pendingCount': pending})

            if params.get('players'):
                cur.execute(
                    "SELECT id, full_name, role, COALESCE(variki, 0) FROM users "
                    "WHERE role IN %s AND is_active = true ORDER BY COALESCE(variki, 0) DESC, full_name",
                    (PRODUCTION_ROLES,),
                )
                players = [
                    {'id': r[0], 'fullName': r[1], 'role': r[2], 'variki': r[3],
                     'canPlay': r[3] >= LOTOTRON_THRESHOLD}
                    for r in cur.fetchall()
                ]
                return _resp(200, {'players': players, 'threshold': LOTOTRON_THRESHOLD})

            user_id = params.get('userId')
            if not user_id:
                return _resp(400, {'error': 'Укажите userId'})
            cur.execute("SELECT COALESCE(variki, 0) FROM users WHERE id = %s", (int(user_id),))
            row = cur.fetchone()
            variki = row[0] if row else 0
            return _resp(200, {
                'variki': variki,
                'threshold': LOTOTRON_THRESHOLD,
                'canPlay': variki >= LOTOTRON_THRESHOLD,
            })

        if method == 'POST':
            body_data = json.loads(event.get('body') or '{}')
            action = body_data.get('action')

            if action == 'debit':
                # Списывать варики (игра в лототрон) может только администратор.
                actor_id = body_data.get('actorId')
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    ar = cur.fetchone()
                    actor_role = ar[0] if ar else None
                if actor_role != 'admin':
                    return _resp(403, {'error': 'Списывать варики может только администратор'})

                user_id = body_data.get('userId')
                amount = body_data.get('amount')
                try:
                    amount = int(amount)
                except (TypeError, ValueError):
                    return _resp(400, {'error': 'Укажите количество вариков'})
                if not user_id or amount <= 0:
                    return _resp(400, {'error': 'Укажите игрока и количество вариков'})

                cur.execute("SELECT COALESCE(variki, 0) FROM users WHERE id = %s", (int(user_id),))
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Игрок не найден'})
                if row[0] < amount:
                    return _resp(409, {'error': f'У игрока только {row[0]} вариков'})

                cur.execute(
                    "UPDATE users SET variki = COALESCE(variki, 0) - %s WHERE id = %s RETURNING variki",
                    (amount, int(user_id)),
                )
                new_balance = cur.fetchone()[0]
                conn.commit()
                return _resp(200, {'variki': new_balance})

            if action == 'buy':
                # Покупка подарка за варики. Сотрудник покупает сам — админ только
                # выдаёт купон. Баланс проверяем и списываем в одной транзакции с
                # блокировкой строки: два нажатия подряд не должны увести баланс
                # в минус и создать две покупки.
                user_id = body_data.get('userId')
                item_id = body_data.get('itemId')
                if not user_id or not item_id:
                    return _resp(400, {'error': 'Укажите сотрудника и подарок'})

                cur.execute(
                    "SELECT title, price FROM variki_shop_items "
                    "WHERE id = %s AND is_active = true",
                    (int(item_id),),
                )
                item = cur.fetchone()
                if not item:
                    return _resp(404, {'error': 'Подарок не найден или снят с продажи'})
                title, price = item[0], int(item[1])

                cur.execute(
                    "SELECT COALESCE(variki, 0), full_name FROM users WHERE id = %s FOR UPDATE",
                    (int(user_id),),
                )
                urow = cur.fetchone()
                if not urow:
                    return _resp(404, {'error': 'Сотрудник не найден'})
                balance, user_name = int(urow[0]), urow[1]
                if balance < price:
                    return _resp(409, {
                        'error': f'Не хватает вариков: нужно {price}, у вас {balance}',
                    })

                cur.execute(
                    "UPDATE users SET variki = COALESCE(variki, 0) - %s WHERE id = %s "
                    "RETURNING COALESCE(variki, 0)",
                    (price, int(user_id)),
                )
                new_balance = int(cur.fetchone()[0])
                cur.execute(
                    "INSERT INTO variki_purchases (item_id, user_id, user_name, price, status) "
                    "VALUES (%s, %s, %s, %s, 'pending') RETURNING id",
                    (int(item_id), int(user_id), user_name, price),
                )
                purchase_id = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO audit_log (category, user_id, user_name, action, "
                    "  entity_type, entity_id, description) "
                    "VALUES ('variki', %s, %s, 'variki_buy', 'variki_purchase', %s, %s)",
                    (int(user_id), user_name, purchase_id,
                     f'Купил за варики: {title} ({price} вариков)'),
                )
                conn.commit()
                return _resp(200, {
                    'purchaseId': purchase_id, 'variki': new_balance, 'title': title,
                })

            if action == 'attach_coupon':
                # Админ прикрепляет купон PDF. Сертификаты покупаются на стороне и
                # приходят письмом — выдать их автоматически неоткуда, поэтому файл
                # загружается руками. После загрузки купон виден сотруднику.
                actor_id = body_data.get('actorId')
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    ar = cur.fetchone()
                    actor_role = ar[0] if ar else None
                if actor_role != 'admin':
                    return _resp(403, {'error': 'Прикреплять купон может только администратор'})

                purchase_id = body_data.get('purchaseId')
                file_b64 = body_data.get('fileBase64') or ''
                file_name = (body_data.get('fileName') or 'coupon.pdf').strip()
                if not purchase_id or not file_b64:
                    return _resp(400, {'error': 'Выберите покупку и файл купона'})

                cur.execute(
                    "SELECT status FROM variki_purchases WHERE id = %s", (int(purchase_id),)
                )
                prow = cur.fetchone()
                if not prow:
                    return _resp(404, {'error': 'Покупка не найдена'})
                if prow[0] == 'cancelled':
                    return _resp(409, {'error': 'Покупка отменена — купон приложить нельзя'})

                if ',' in file_b64:
                    file_b64 = file_b64.split(',', 1)[1]
                try:
                    binary = base64.b64decode(file_b64)
                except Exception:
                    return _resp(400, {'error': 'Файл повреждён'})
                if len(binary) > 10 * 1024 * 1024:
                    return _resp(400, {'error': 'Файл больше 10 МБ'})

                s3 = boto3.client(
                    's3',
                    endpoint_url='https://bucket.poehali.dev',
                    aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                    aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                )
                key = f'variki-coupons/{uuid.uuid4().hex}.pdf'
                s3.put_object(
                    Bucket='files', Key=key, Body=binary, ContentType='application/pdf'
                )
                url = (
                    f"https://cdn.poehali.dev/projects/"
                    f"{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
                )

                cur.execute(
                    "UPDATE variki_purchases SET status = 'issued', coupon_url = %s, "
                    "  coupon_name = %s, coupon_at = now(), coupon_by = %s, "
                    "  coupon_by_name = %s WHERE id = %s",
                    (url, file_name, int(actor_id) if actor_id else None,
                     body_data.get('actorName'), int(purchase_id)),
                )
                conn.commit()
                return _resp(200, {'couponUrl': url})

            if action == 'cancel_purchase':
                # Подарок выдать не получилось — возвращаем варики. Без возврата
                # сотрудник остался бы и без валюты, и без купона.
                actor_id = body_data.get('actorId')
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    ar = cur.fetchone()
                    actor_role = ar[0] if ar else None
                if actor_role != 'admin':
                    return _resp(403, {'error': 'Отменять покупку может только администратор'})

                purchase_id = body_data.get('purchaseId')
                reason = (body_data.get('reason') or '').strip()
                if not purchase_id or not reason:
                    return _resp(400, {'error': 'Укажите покупку и причину отмены'})

                cur.execute(
                    "SELECT user_id, price, status FROM variki_purchases WHERE id = %s",
                    (int(purchase_id),),
                )
                prow = cur.fetchone()
                if not prow:
                    return _resp(404, {'error': 'Покупка не найдена'})
                if prow[2] == 'cancelled':
                    return _resp(409, {'error': 'Покупка уже отменена'})

                cur.execute(
                    "UPDATE users SET variki = COALESCE(variki, 0) + %s WHERE id = %s",
                    (int(prow[1]), int(prow[0])),
                )
                cur.execute(
                    "UPDATE variki_purchases SET status = 'cancelled', cancel_reason = %s "
                    "WHERE id = %s",
                    (reason, int(purchase_id)),
                )
                conn.commit()
                return _resp(200, {'success': True, 'refunded': int(prow[1])})

            return _resp(400, {'error': 'Неизвестное действие'})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()
