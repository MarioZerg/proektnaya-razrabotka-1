import base64
import json
import os
import uuid
from datetime import date

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


def _is_admin(cur, actor_id) -> bool:
    """Роль берём из базы по actorId, а не из запроса: подменить её нельзя."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _upload_pdf(binary: bytes, prefix: str) -> str:
    """Кладём PDF в облако и отдаём постоянную ссылку."""
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'{prefix}/{uuid.uuid4().hex}.pdf'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType='application/pdf')
    # Возвращаем КЛЮЧ файла, а не публичную ссылку на хранилище: сертификат —
    # это ценность, и прямая ссылка позволила бы скачать его кому угодно, в том
    # числе переслав её дальше. Наружу файл отдаётся только через нашу функцию,
    # которая проверяет, что человек имеет на него право.
    return key


def _read_pdf(key: str) -> bytes:
    """Забираем PDF из хранилища по ключу, чтобы отдать его через наш домен."""
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    return s3.get_object(Bucket='files', Key=key)['Body'].read()


def _storage_key(stored: str) -> str:
    """
    Ключ файла в хранилище.

    Старые записи хранят полную ссылку на CDN, новые — сразу ключ. Приводим к
    ключу, чтобы уже загруженные сертификаты продолжили открываться.
    """
    if stored.startswith('http'):
        return stored.split('/bucket/', 1)[-1]
    return stored


def _decode_pdf(file_b64: str):
    """base64 из тела запроса -> байты. Возвращает (данные, ошибка)."""
    if ',' in file_b64:
        file_b64 = file_b64.split(',', 1)[1]
    try:
        binary = base64.b64decode(file_b64)
    except Exception:
        return None, 'Файл повреждён'
    # 2.5 МБ, а не больше: шлюз режет запросы тяжелее ~3.5 МБ ещё до функции, а
    # base64 раздувает файл на треть — PDF на 3 МБ превращается в тело на 4 МБ и
    # до нас просто не доезжает. Предел считаем от РЕАЛЬНОГО размера файла.
    if len(binary) > 2560 * 1024:
        return None, 'файл больше 2,5 МБ'
    return binary, None


def handler(event: dict, context) -> dict:
    """Внутренняя игровая валюта "Варики".

    GET /?userId=N   - баланс вариков сотрудника (+порог лототрона)
    GET /?players=1  - список производственных сотрудников с их вариками (для админа)
    GET /?shop=1&userId=N     - витрина магазина и покупки сотрудника
    GET /?manage=1&actorId=N  - все товары для админа (вкладка управления)
    GET /?purchases=1&actorId=N - все покупки (для админа)
    GET /?certificates=1&itemId=N&actorId=N - сертификаты подарка (для админа)
    GET /?download=N&actorId=N  - скачать сам файл сертификата
    POST / { action: 'debit', actorId, userId, amount } - списание вариков (только админ)
    POST / { action: 'buy', userId, itemId }            - купить подарок за варики
        (сертификат со склада выдаётся сразу, если он есть)
    POST / { action: 'save_item', actorId, itemId?, title, price, ... } - товар в магазине
    POST / { action: 'upload_certificates', actorId, itemId, files[] }  - пачка сертификатов
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

            if params.get('download'):
                # Отдаём сам PDF со своего домена. Право на файл проверяем здесь:
                # админу открыты все сертификаты (ему нужно проверять загруженное),
                # сотруднику — только тот, который выдали лично ему.
                cert_id = params.get('download')
                actor_id = params.get('actorId')
                if not str(cert_id).isdigit() or not str(actor_id or '').isdigit():
                    return _resp(400, {'error': 'Не указан файл или пользователь'})

                cur.execute(
                    "SELECT c.file_url, c.file_name, p.user_id "
                    "FROM variki_certificates c "
                    "LEFT JOIN variki_purchases p ON p.id = c.purchase_id "
                    "WHERE c.id = %s",
                    (int(cert_id),),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Сертификат не найден'})

                owner_id = row[2]
                if not _is_admin(cur, actor_id) and owner_id != int(actor_id):
                    return _resp(403, {'error': 'Этот сертификат выдан не вам'})

                binary = _read_pdf(_storage_key(row[0]))
                safe_name = (row[1] or 'sertifikat.pdf').replace('"', '')
                return {
                    'statusCode': 200,
                    'headers': {
                        **CORS_HEADERS,
                        'Content-Type': 'application/pdf',
                        'Content-Disposition': f'inline; filename="{safe_name}"',
                    },
                    'body': base64.b64encode(binary).decode(),
                    'isBase64Encoded': True,
                }

            if params.get('coupon'):
                # Купон по покупке. Ссылку на хранилище наружу не отдаём вовсе:
                # забрать файл может только его владелец или админ.
                purchase_id = params.get('coupon')
                actor_id = params.get('actorId')
                if not str(purchase_id).isdigit() or not str(actor_id or '').isdigit():
                    return _resp(400, {'error': 'Не указана покупка или пользователь'})

                cur.execute(
                    "SELECT coupon_url, coupon_name, user_id FROM variki_purchases "
                    "WHERE id = %s",
                    (int(purchase_id),),
                )
                row = cur.fetchone()
                if not row or not row[0]:
                    return _resp(404, {'error': 'Купон ещё не выдан'})
                if not _is_admin(cur, actor_id) and row[2] != int(actor_id):
                    return _resp(403, {'error': 'Этот купон выдан не вам'})

                binary = _read_pdf(_storage_key(row[0]))
                safe_name = (row[1] or 'kupon.pdf').replace('"', '')
                return {
                    'statusCode': 200,
                    'headers': {
                        **CORS_HEADERS,
                        'Content-Type': 'application/pdf',
                        'Content-Disposition': f'inline; filename="{safe_name}"',
                    },
                    'body': base64.b64encode(binary).decode(),
                    'isBase64Encoded': True,
                }

            if params.get('shop'):
                # Витрина магазина + покупки самого сотрудника. Сюда ходит и админ
                # (посмотреть, что в продаже), и швея (купить и забрать купон).
                # Остаток считаем по СВОБОДНЫМ сертификатам на складе: сотрудник
                # должен видеть, сколько подарков реально можно забрать сейчас, а
                # не сколько их задумывал админ.
                cur.execute(
                    "SELECT i.id, i.title, i.description, i.price, i.animation, i.icon, "
                    "  i.image_url, i.stock_limit, i.org_address, i.org_phone, "
                    "  i.valid_from, i.valid_to, "
                    "  (SELECT count(*) FROM variki_certificates c "
                    "     WHERE c.item_id = i.id AND c.purchase_id IS NULL) AS free "
                    "FROM variki_shop_items i WHERE i.is_active = true "
                    "ORDER BY i.sort_order, i.id"
                )
                items = [
                    {'id': r[0], 'title': r[1], 'description': r[2],
                     'price': r[3], 'animation': r[4], 'icon': r[5], 'imageUrl': r[6],
                     'stockLimit': r[7], 'orgAddress': r[8], 'orgPhone': r[9],
                     'validFrom': r[10].isoformat() if r[10] else None,
                     'validTo': r[11].isoformat() if r[11] else None,
                     'available': int(r[12])}
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
                        "  p.coupon_url, p.coupon_name, p.coupon_at, p.cancel_reason, "
                        # Контакты нужны именно ЗДЕСЬ: сотрудник с сертификатом на
                        # руках открывает свои покупки, чтобы записаться на услугу.
                        "  i.org_address, i.org_phone "
                        "FROM variki_purchases p "
                        "JOIN variki_shop_items i ON i.id = p.item_id "
                        "WHERE p.user_id = %s ORDER BY p.created_at DESC",
                        (int(user_id),),
                    )
                    purchases = [
                        {'id': r[0], 'itemId': r[1], 'title': r[2], 'price': r[3],
                         'status': r[4],
                         'createdAt': r[5].isoformat() + 'Z' if r[5] else None,
                         # Ссылку на хранилище наружу не отдаём — только признак,
                         # что купон готов. Файл забирают через наш адрес.
                         'hasCoupon': bool(r[6]), 'couponName': r[7],
                         'couponAt': r[8].isoformat() + 'Z' if r[8] else None,
                         'cancelReason': r[9],
                         'orgAddress': r[10], 'orgPhone': r[11]}
                        for r in cur.fetchall()
                    ]
                return _resp(200, {'items': items, 'balance': balance, 'purchases': purchases})

            if params.get('certificates'):
                # Список загруженных сертификатов по подарку: админ должен видеть,
                # что именно лежит на складе, какие файлы уже ушли сотрудникам, а
                # какие ждут покупателя — и открыть любой из них для проверки.
                if not _is_admin(cur, params.get('actorId')):
                    return _resp(403, {'error': 'Доступно только администратору'})
                item_id = params.get('itemId')
                if not str(item_id or '').isdigit():
                    return _resp(400, {'error': 'Не указан подарок'})

                cur.execute(
                    "SELECT c.id, c.file_name, c.uploaded_at, c.uploaded_by_name, "
                    "  c.issued_at, p.user_name "
                    "FROM variki_certificates c "
                    "LEFT JOIN variki_purchases p ON p.id = c.purchase_id "
                    "WHERE c.item_id = %s "
                    # Свободные сверху: именно их админ пополняет и проверяет чаще.
                    "ORDER BY (c.purchase_id IS NULL) DESC, c.uploaded_at DESC",
                    (int(item_id),),
                )
                certificates = [
                    {'id': r[0], 'fileName': r[1],
                     'uploadedAt': r[2].isoformat() + 'Z' if r[2] else None,
                     'uploadedByName': r[3],
                     'issuedAt': r[4].isoformat() + 'Z' if r[4] else None,
                     'issuedTo': r[5]}
                    for r in cur.fetchall()
                ]
                return _resp(200, {'certificates': certificates})

            if params.get('manage'):
                # Витрина глазами админа: все товары, включая снятые с продажи,
                # с остатком сертификатов на складе.
                if not _is_admin(cur, params.get('actorId')):
                    return _resp(403, {'error': 'Доступ только для администратора'})
                cur.execute(
                    "SELECT i.id, i.title, i.description, i.price, i.animation, i.icon, "
                    "  i.image_url, i.stock_limit, i.is_active, i.sort_order, "
                    "  i.org_address, i.org_phone, i.valid_from, i.valid_to, "
                    "  (SELECT count(*) FROM variki_certificates c "
                    "     WHERE c.item_id = i.id AND c.purchase_id IS NULL), "
                    "  (SELECT count(*) FROM variki_certificates c "
                    "     WHERE c.item_id = i.id AND c.purchase_id IS NOT NULL) "
                    "FROM variki_shop_items i ORDER BY i.sort_order, i.id"
                )
                items = [
                    {'id': r[0], 'title': r[1], 'description': r[2], 'price': r[3],
                     'animation': r[4], 'icon': r[5], 'imageUrl': r[6],
                     'stockLimit': r[7], 'isActive': r[8], 'sortOrder': r[9],
                     'orgAddress': r[10], 'orgPhone': r[11],
                     'validFrom': r[12].isoformat() if r[12] else None,
                     'validTo': r[13].isoformat() if r[13] else None,
                     'available': int(r[14]), 'issued': int(r[15])}
                    for r in cur.fetchall()
                ]
                return _resp(200, {'items': items})

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
                     'hasCoupon': bool(r[7]), 'couponName': r[8],
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
                    "SELECT title, price, valid_from, valid_to FROM variki_shop_items "
                    "WHERE id = %s AND is_active = true",
                    (int(item_id),),
                )
                item = cur.fetchone()
                if not item:
                    return _resp(404, {'error': 'Подарок не найден или снят с продажи'})
                title, price = item[0], int(item[1])

                # Проверяем период ЗДЕСЬ, а не только на кнопке: между открытием
                # страницы и нажатием срок мог закончиться, и сотрудник потратил бы
                # варики на сертификат, которым уже не воспользуется.
                today = date.today()
                valid_from, valid_to = item[2], item[3]
                if valid_from and today < valid_from:
                    return _resp(409, {
                        'error': f'Подарок поступит в продажу {valid_from.strftime("%d.%m.%Y")}',
                    })
                if valid_to and today > valid_to:
                    return _resp(409, {
                        'error': f'Срок действия сертификатов истёк {valid_to.strftime("%d.%m.%Y")}',
                    })

                # Сертификаты кончились — покупать нечего. Проверяем ДО списания
                # вариков: иначе сотрудник остался бы без валюты и без подарка.
                cur.execute(
                    "SELECT count(*) FROM variki_certificates "
                    "WHERE item_id = %s AND purchase_id IS NULL",
                    (int(item_id),),
                )
                free_count = int(cur.fetchone()[0])
                if free_count == 0:
                    return _resp(409, {
                        'error': 'Сертификаты на этот подарок закончились. '
                                 'Загляните позже — администратор пополнит запас',
                    })

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
                # Берём СВОБОДНЫЙ сертификат со склада и сразу закрепляем за покупкой.
                #
                # FOR UPDATE SKIP LOCKED: если две швеи жмут «Купить» одновременно,
                # каждая получит свой файл, а не один и тот же. Без этого один
                # сертификат мог уехать двоим.
                cur.execute(
                    "SELECT id, file_url, file_name FROM variki_certificates "
                    "WHERE item_id = %s AND purchase_id IS NULL "
                    "ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
                    (int(item_id),),
                )
                cert = cur.fetchone()

                # Сертификат есть — покупка закрывается мгновенно, ждать админа не нужно.
                # Нет — заявка уходит админу, как раньше.
                status = 'issued' if cert else 'pending'
                cur.execute(
                    "INSERT INTO variki_purchases (item_id, user_id, user_name, price, "
                    "  status, coupon_url, coupon_name, coupon_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, "
                    "  CASE WHEN %s THEN now() ELSE NULL END) RETURNING id",
                    (int(item_id), int(user_id), user_name, price, status,
                     cert[1] if cert else None, cert[2] if cert else None, bool(cert)),
                )
                purchase_id = cur.fetchone()[0]
                if cert:
                    cur.execute(
                        "UPDATE variki_certificates SET purchase_id = %s, issued_at = now() "
                        "WHERE id = %s",
                        (purchase_id, cert[0]),
                    )
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
                    # Сам файл фронт запросит по покупке — ключ хранилища наружу не уходит.
                    'hasCoupon': bool(cert),
                    'instant': bool(cert),
                })

            if action == 'save_item':
                # Создание и правка карточки товара. Один обработчик на оба случая:
                # поля одинаковые, а разделять создание и правку — лишний код.
                if not _is_admin(cur, body_data.get('actorId')):
                    return _resp(403, {'error': 'Управлять магазином может только администратор'})

                item_id = body_data.get('itemId')
                title = (body_data.get('title') or '').strip()
                if not title:
                    return _resp(400, {'error': 'Укажите название подарка'})
                try:
                    price = int(body_data.get('price'))
                except (TypeError, ValueError):
                    return _resp(400, {'error': 'Укажите цену в вариках'})
                if price <= 0:
                    return _resp(400, {'error': 'Цена должна быть больше нуля'})

                description = (body_data.get('description') or '').strip() or None
                org_address = (body_data.get('orgAddress') or '').strip()[:400] or None
                org_phone = (body_data.get('orgPhone') or '').strip()[:50] or None
                # Пустая строка из формы — это «не ограничивать», а не дата.
                valid_from = (body_data.get('validFrom') or '').strip() or None
                valid_to = (body_data.get('validTo') or '').strip() or None
                if valid_from and valid_to and valid_from > valid_to:
                    return _resp(400, {
                        'error': 'Дата начала продажи позже даты окончания',
                    })
                image_url = (body_data.get('imageUrl') or '').strip() or None
                icon = (body_data.get('icon') or 'Gift').strip()
                animation = (body_data.get('animation') or 'none').strip()
                is_active = bool(body_data.get('isActive', True))
                stock_limit = body_data.get('stockLimit')
                try:
                    stock_limit = int(stock_limit) if stock_limit not in (None, '') else None
                except (TypeError, ValueError):
                    stock_limit = None

                if item_id:
                    cur.execute(
                        "UPDATE variki_shop_items SET title = %s, description = %s, "
                        "  price = %s, image_url = %s, icon = %s, animation = %s, "
                        "  stock_limit = %s, is_active = %s, org_address = %s, "
                        "  org_phone = %s, valid_from = %s, valid_to = %s "
                        "WHERE id = %s RETURNING id",
                        (title, description, price, image_url, icon, animation,
                         stock_limit, is_active, org_address, org_phone,
                         valid_from, valid_to, int(item_id)),
                    )
                    row = cur.fetchone()
                    if not row:
                        return _resp(404, {'error': 'Подарок не найден'})
                    new_id = row[0]
                else:
                    cur.execute(
                        "INSERT INTO variki_shop_items (title, description, price, "
                        "  image_url, icon, animation, stock_limit, is_active, "
                        "  org_address, org_phone, valid_from, valid_to, sort_order) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                        "  COALESCE((SELECT max(sort_order) + 1 FROM variki_shop_items), 1)) "
                        "RETURNING id",
                        (title, description, price, image_url, icon, animation,
                         stock_limit, is_active, org_address, org_phone,
                         valid_from, valid_to),
                    )
                    new_id = cur.fetchone()[0]
                conn.commit()
                return _resp(200, {'id': new_id})

            if action == 'upload_certificates':
                # Загрузка ПАЧКИ готовых сертификатов на товар. Файлы лежат на складе
                # и выдаются автоматически при покупке — сотруднику не нужно ждать,
                # пока админ вручную пришлёт купон.
                if not _is_admin(cur, body_data.get('actorId')):
                    return _resp(403, {'error': 'Загружать сертификаты может только администратор'})

                item_id = body_data.get('itemId')
                files = body_data.get('files') or []
                if not item_id or not files:
                    return _resp(400, {'error': 'Выберите подарок и файлы сертификатов'})

                cur.execute("SELECT id FROM variki_shop_items WHERE id = %s", (int(item_id),))
                if not cur.fetchone():
                    return _resp(404, {'error': 'Подарок не найден'})

                saved = 0
                for f in files[:50]:
                    binary, err = _decode_pdf(f.get('fileBase64') or '')
                    if err:
                        return _resp(400, {'error': f"{f.get('fileName') or 'Файл'}: {err}"})
                    url = _upload_pdf(binary, 'variki-certificates')
                    cur.execute(
                        "INSERT INTO variki_certificates (item_id, file_url, file_name, "
                        "  uploaded_by, uploaded_by_name) VALUES (%s, %s, %s, %s, %s)",
                        (int(item_id), url, (f.get('fileName') or 'certificate.pdf')[:300],
                         body_data.get('actorId'), body_data.get('actorName')),
                    )
                    saved += 1

                cur.execute(
                    "SELECT count(*) FROM variki_certificates "
                    "WHERE item_id = %s AND purchase_id IS NULL",
                    (int(item_id),),
                )
                available = int(cur.fetchone()[0])
                conn.commit()
                return _resp(200, {'saved': saved, 'available': available})

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

                binary, err = _decode_pdf(file_b64)
                if err:
                    return _resp(400, {'error': err})
                url = _upload_pdf(binary, 'variki-coupons')

                cur.execute(
                    "UPDATE variki_purchases SET status = 'issued', coupon_url = %s, "
                    "  coupon_name = %s, coupon_at = now(), coupon_by = %s, "
                    "  coupon_by_name = %s WHERE id = %s",
                    (url, file_name, int(actor_id) if actor_id else None,
                     body_data.get('actorName'), int(purchase_id)),
                )
                conn.commit()
                return _resp(200, {'saved': True})

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
                # Сертификат возвращаем на склад: он не использован и должен снова
                # стать доступным для покупки, иначе запас утекал бы с каждой отменой.
                cur.execute(
                    "UPDATE variki_certificates SET purchase_id = NULL, issued_at = NULL "
                    "WHERE purchase_id = %s",
                    (int(purchase_id),),
                )
                conn.commit()
                return _resp(200, {'success': True, 'refunded': int(prow[1])})

            return _resp(400, {'error': 'Неизвестное действие'})

        return _resp(405, {'error': 'Метод не поддерживается'})
    finally:
        conn.close()
