import hashlib
import json
import os
import re
import secrets

import psycopg2


ROLES = {'sewer', 'cutter', 'packer', 'storekeeper', 'senior_storekeeper', 'cleaner', 'admin', 'manager'}


def normalize_phone(raw: str) -> str | None:
    """Приводит номер к формату +7XXXXXXXXXX. Возвращает None, если не похоже на телефон."""
    digits = re.sub(r'\D', '', raw or '')
    if len(digits) == 11 and digits[0] in ('7', '8'):
        digits = '7' + digits[1:]
    elif len(digits) == 10:
        digits = '7' + digits
    else:
        return None
    return '+' + digits


def _resp_access(active, reason=None):
    """Ответ на сверку доступа: действует ли учётная запись и почему нет."""
    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps({'active': active, 'reason': reason}, ensure_ascii=False),
    }


def handler(event: dict, context) -> dict:
    """Авторизация сотрудников. Три независимых способа попасть в систему.

    1. Вход через MAX (быстрый, для тех, кто уже работает):
       сотрудник жмёт «Войти через MAX» → открывается бот (backend/max_bot присылает
       код после того, как человек поделился номером телефона).
       POST { action: 'max_verify_code', code } — сайт проверяет код и возвращает
       пользователя со списком его должностей. Никаких данных вводить не нужно.

    2. Заявка на регистрацию (для новеньких, кого ещё нет в системе):
       POST { action: 'register_request', fullName, role, email, phone } — создаёт
       пользователя без роли и запись в user_roles с is_approved = false. Пароля у него
       пока нет: администратор задаст его, когда утвердит заявку (см. backend/users).

    3. Вход по логину и паролю ОТКЛЮЧЁН — в систему заходят только через MAX.
       POST { action: 'password_login' } отвечает 410: старые открытые вкладки
       получают понятное сообщение вместо молчаливой ошибки.

    После любого из способов фронтенд смотрит на роли:
    нет ни одной утверждённой — показываем экран ожидания; утверждена ровно одна —
    сразу входим в неё; утверждено несколько — сотрудник выбирает, кем работать сегодня.

    POST { action: 'enter_role', userId, role } — вход в конкретную утверждённую роль.
    Проверяет, что роль утверждена, и возвращает полные данные сессии
    (id, name, role, workshopId, workshopName, shiftNumber).

    POST { action: 'impersonate', adminId, userId, role? } — администратор входит
    в аккаунт сотрудника, чтобы увидеть его рабочую панель. Права проверяются на
    сервере по adminId; пароль сотрудника не нужен.

    POST { action: 'bot_info' } — отдаёт публичную ссылку на бота MAX (кнопка
    «Войти через MAX» на сайте открывает её в новой вкладке).

    POST { action: 'test_accounts' } — демо-вход: по одному активному сотруднику
    на каждую основную роль (без проверки кода), для ознакомительного режима.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с данными пользователя/ролей или ошибкой
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

    if method != 'POST':
        return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    dsn = os.environ['DATABASE_URL']

    if action == 'startup':
        """Всё, что нужно показать сотруднику при входе, — ОДНИМ запросом.

        Раньше при открытии системы уходило три отдельных обращения: неподписанные
        договоры, срок на документы и счётчик работы в меню. Три вызова облачных
        функций на каждое открытие вкладки, у каждого сотрудника, весь день — при
        том что все три вопроса про одного человека и решаются одним походом в базу.

        Здесь считаем всё сразу. Счётчик отдаём только тем, у кого он есть в меню:
        кладовщику и администратору — остальным незачем.
        """
        user_id = body_data.get('userId')
        role = (body_data.get('role') or '').strip()
        if not user_id:
            return {'statusCode': 400, 'headers': headers,
                    'body': json.dumps({'error': 'Укажите userId'}, ensure_ascii=False)}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            uid = int(user_id)

            # 1. Неподписанные договоры: пока они есть, вместо страниц показывается
            # экран подписания. Без этого числа нельзя нарисовать интерфейс.
            cur.execute(
                "SELECT count(*) FROM contracts WHERE user_id = %s AND status = 'pending'",
                (uid,),
            )
            pending_contracts = int(cur.fetchone()[0])

            # 2. Срок на загрузку документов. Интересует только факт блокировки:
            # подробности человек смотрит на своей странице документов.
            #
            # Администратора не проверяем — у него этого требования нет.
            docs_blocked = False
            if role != 'admin':
                cur.execute(
                    "SELECT docs_blocked, personal_data_verified FROM users WHERE id = %s",
                    (uid,),
                )
                d_row = cur.fetchone()
                docs_blocked = bool(d_row and d_row[0] and not d_row[1])

            # 3. Счётчик работы кладовщика в меню: подбор и вещи «на руках».
            # Считаем ОДНИМ проходом по таблице — как в самом складе, иначе цифры
            # в меню и на странице разойдутся.
            picking = 0
            awaiting_shelf = 0
            if role in ('storekeeper', 'senior_storekeeper', 'admin'):
                # Вещи «на руках»: отказы из цеха, ждущие полки, и возвраты
                # с маркетплейса, ждущие разбора.
                cur.execute(
                    "SELECT count(*) FROM goods_warehouse "
                    "WHERE status = 'mp_return' "
                    "   OR (status = 'awaiting_shelf' AND storage_labeled_at IS NOT NULL)"
                )
                awaiting_shelf = int(cur.fetchone()[0] or 0)

                # Подбор считаем ТЕМ ЖЕ запросом, что и страница склада, иначе цифры
                # в меню и на экране разойдутся, и кладовщик перестанет им верить.
                # Условия здесь не косметические: вещь должна быть под живым заказом
                # и не лежать уже в чьей-то поставке.
                cur.execute(
                    "SELECT count(*) FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = gw.reserved_order_id "
                    "WHERE gw.status IN ('picking', 'awaiting_supply') "
                    "  AND gw.reserved_order_id IS NOT NULL "
                    "  AND gw.shipped_at IS NULL "
                    "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                    "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                    "                  WHERE msi.goods_warehouse_id = gw.id "
                    "                    AND COALESCE(ms.status, '') "
                    "                        NOT IN ('Выполнена', 'Отменена')) "
                    "  AND (COALESCE(o.sewing_status, '') IN ('Новый', 'Со склада') "
                    "       AND COALESCE(o.status, '') "
                    "           NOT IN ('Отменён', 'Отгружен', 'Доставлен') "
                    "       AND COALESCE(o.ozon_status, '') NOT IN "
                    "           ('delivering', 'delivered', 'cancelled', "
                    "            'not_accepted', 'driver_pickup'))"
                )
                picking = int(cur.fetchone()[0] or 0)

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'pendingContracts': pending_contracts,
                    'docsBlocked': docs_blocked,
                    'picking': picking,
                    'awaitingShelf': awaiting_shelf,
                }, ensure_ascii=False),
            }
        finally:
            conn.close()

    if action == 'bot_info':
        # Ссылка на бота с ОДНОРАЗОВОЙ МЕТКОЙ этой вкладки (?start=...).
        #
        # Метка — это то, что избавляет человека от ручного ввода кода. MAX передаёт
        # её боту при открытии чата, бот по ней понимает, какая вкладка ждёт входа,
        # и кладёт готовый код обратно в метку. Вкладка забирает код сама.
        username = os.environ.get('MAX_BOT_USERNAME', '')
        if not username:
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'botUrl': None})}

        login_token = secrets.token_urlsafe(24)[:64]
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO max_login_tokens (token, expires_at) "
                "VALUES (%s, now() + interval '15 minutes')",
                (login_token,),
            )
            # Заодно подчищаем протухшие метки, чтобы таблица не росла бесконечно.
            cur.execute("DELETE FROM max_login_tokens WHERE expires_at < now() - interval '1 day'")
            conn.commit()
        finally:
            conn.close()

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'botUrl': f'https://max.ru/{username}?start={login_token}',
                'loginToken': login_token,
            }),
        }

    if action == 'max_login_status':
        # Вкладка периодически спрашивает: «код уже готов?». Как только бот его
        # выдал — возвращаем, и вход происходит без единого нажатия.
        login_token = (body_data.get('loginToken') or '').strip()
        if not login_token:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет метки входа'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                'SELECT code, awaiting_contact FROM max_login_tokens '
                'WHERE token = %s AND expires_at > now()',
                (login_token,),
            )
            row = cur.fetchone()
        finally:
            conn.close()

        if not row:
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'expired': True})}

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'code': row[0], 'awaitingContact': row[1], 'expired': False}),
        }

    if action == 'online_now':
        # Сколько человек прямо сейчас на смене — показывается на экране входа.
        # Данные публичные и обезличенные: только количество и разбивка по цехам,
        # без имён, чтобы посторонний у экрана не видел, кто именно работает.
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT COALESCE(w.name, 'Без цеха') AS ceh, COUNT(*) "
                "FROM shift_sessions ss "
                "LEFT JOIN workshops w ON w.id = ss.workshop_id "
                "WHERE ss.closed_at IS NULL "
                "GROUP BY COALESCE(w.name, 'Без цеха') "
                "ORDER BY COALESCE(w.name, 'Без цеха')"
            )
            rows = cur.fetchall()
        finally:
            conn.close()

        by_workshop = [{'workshop': r[0], 'count': int(r[1])} for r in rows]
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {'total': sum(w['count'] for w in by_workshop), 'byWorkshop': by_workshop},
                ensure_ascii=False,
            ),
        }

    if action == 'test_accounts':
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                # ПО ОДНОМУ ЧЕЛОВЕКУ НА РОЛЬ, но швеи — ДВЕ.
                #
                # Оверлок это не должность, а допуск (галочка can_overlock): он
                # открывает вкладку «Оверлок» и меняет расчёт зарплаты. Раньше
                # список брал строго по одному на роль, и швея с допуском в него
                # не попадала — посмотреть этот режим было не на ком.
                #
                # Поэтому ключ группировки — роль ПЛЮС признак оверлока: у швей
                # выходит два входа, у остальных ролей по-прежнему один.
                "SELECT DISTINCT ON (u.role, COALESCE(u.can_overlock, false)) "
                "  u.id, u.full_name, u.role, u.workshop, u.shift_number, w.id, "
                "  COALESCE(u.can_overlock, false) "
                "FROM users u "
                "LEFT JOIN workshops w ON w.name = u.workshop "
                "WHERE u.is_active = true AND u.role <> '' "
                # Расторгнувших договор в списке для входа не показываем: их
                # доступ закрыт, и предлагать им кнопку входа незачем.
                "  AND u.contract_terminated_at IS NULL "
                # Демо-аккаунты идут первыми: если для роли заведён специальный
                # тестовый сотрудник, показываем именно его, а не живого человека.
                "ORDER BY u.role, COALESCE(u.can_overlock, false), "
                "         COALESCE(u.is_demo, false) DESC, u.id"
            )
            rows = cur.fetchall()
        finally:
            conn.close()

        accounts = [
            {
                'id': r[0],
                'name': r[1],
                'role': r[2],
                'workshopName': r[3],
                'shiftNumber': r[4],
                'workshopId': r[5],
                # Допуск к оверлоку: по нему в списке входов видно, чем этот
                # аккаунт отличается от обычной швеи.
                'canOverlock': bool(r[6]),
            }
            for r in rows
        ]
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'accounts': accounts})}

    if action == 'max_verify_code':
        sessions_table = 'max_auth_sessions'
        id_column = 'max_user_id'

        code = (body_data.get('code') or '').strip()
        if not code:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Введите код'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT id, {id_column} FROM {sessions_table} "
                "WHERE code = %s AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1",
                (code,),
            )
            session_row = cur.fetchone()
            if not session_row:
                return {'statusCode': 401, 'headers': headers, 'body': json.dumps({'error': 'Неверный или устаревший код'})}

            session_id, messenger_user_id = session_row
            cur.execute(f'UPDATE {sessions_table} SET used = true WHERE id = %s', (session_id,))

            cur.execute(
                "SELECT id, full_name, is_active, workshop, shift_number, phone "
                f"FROM users WHERE {id_column} = %s",
                (messenger_user_id,),
            )
            user_row = cur.fetchone()
            if not user_row:
                conn.commit()
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Пользователь не найден'})}

            user_id, full_name, is_active, workshop_name, shift_number, phone = user_row
            if not is_active:
                conn.commit()
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Учётная запись отключена'})}
            # Договор расторгнут — доступ закрыт (п. 5.7 договора). Аккаунт при
            # этом сохраняется: расчёты по нему продолжаются.
            cur.execute('SELECT contract_terminated_at FROM users WHERE id = %s', (user_id,))
            t_row = cur.fetchone()
            if t_row and t_row[0]:
                conn.commit()
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps(
                    {'error': 'Договор расторгнут, доступ в систему закрыт. '
                              'По вопросам расчётов обратитесь к администратору'},
                    ensure_ascii=False)}

            cur.execute('SELECT role, is_approved FROM user_roles WHERE user_id = %s ORDER BY id', (user_id,))
            roles = [{'role': r[0], 'isApproved': r[1]} for r in cur.fetchall()]

            conn.commit()
        finally:
            conn.close()

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {
                    'id': user_id,
                    'name': full_name,
                    'phone': phone,
                    'roles': roles,
                }
            ),
        }

    if action == 'register_request':
        # Самостоятельная заявка: человек ещё не заходил в систему и никак с ней не связан,
        # поэтому создаём для него нового пользователя без роли. Пароль ему задаст
        # администратор в момент утверждения заявки — до этого войти нельзя.
        role = (body_data.get('role') or '').strip()
        full_name = (body_data.get('fullName') or '').strip()
        email = (body_data.get('email') or '').strip().lower()
        phone = normalize_phone(body_data.get('phone') or '')

        if role not in ROLES or role == 'admin':
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите должность'})}
        if len(full_name) < 3:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите фамилию, имя и отчество'})}
        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный адрес почты'})}
        if not phone:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный номер телефона'})}
        # Согласие на обработку персональных данных обязательно по закону: проверяем на
        # сервере, а не только галочкой в форме — иначе требование легко обойти.
        if not body_data.get('consent'):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps(
                    {'error': 'Необходимо согласие на обработку персональных данных'},
                    ensure_ascii=False,
                ),
            }

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Почта и телефон — единственные приметы, по которым администратор узнаёт
            # человека в списке заявок, поэтому они должны быть уникальными.
            cur.execute('SELECT id FROM users WHERE lower(email) = %s', (email,))
            if cur.fetchone():
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Эта почта уже занята — возможно, заявка уже отправлена'}),
                }
            cur.execute('SELECT id FROM users WHERE phone = %s', (phone,))
            if cur.fetchone():
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Этот номер телефона уже занят'}),
                }

            # Пароля пока нет: кладём случайный хеш, который не подойдёт ни к одной строке.
            # Настоящий пароль появится, когда админ утвердит заявку.
            salt = secrets.token_hex(16)
            dummy_hash = hashlib.sha256(secrets.token_bytes(16)).hexdigest()
            login = email.split('@')[0][:50] or f'user{secrets.token_hex(3)}'
            cur.execute('SELECT id FROM users WHERE login = %s', (login,))
            if cur.fetchone():
                login = f'{login}{secrets.token_hex(2)}'[:50]

            cur.execute(
                "INSERT INTO users (login, password_hash, password_salt, full_name, role, email, phone, "
                "is_active, privacy_accepted_at) "
                "VALUES (%s, %s, %s, %s, '', %s, %s, true, now()) RETURNING id",
                (login, dummy_hash, salt, full_name[:200], email, phone),
            )
            user_id = cur.fetchone()[0]
            cur.execute(
                'INSERT INTO user_roles (user_id, role, is_approved) VALUES (%s, %s, false)',
                (user_id, role),
            )
            conn.commit()
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

    if action == 'check_access':
        # Сверка доступа для уже вошедшего сотрудника.
        #
        # Вход в системе бессрочный: человек авторизуется один раз и работает, пока
        # администратор не закроет ему доступ. Но раз выхода нет, нужно уметь этот
        # доступ отзывать — приложение периодически спрашивает сервер, действует ли
        # ещё учётная запись и осталась ли у сотрудника его должность.
        user_id = body_data.get('userId')
        role = (body_data.get('role') or '').strip()
        if not user_id:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                'SELECT is_active, full_name, contract_terminated_at, archived_at '
                'FROM users WHERE id = %s', (int(user_id),)
            )
            row = cur.fetchone()
            if not row:
                return _resp_access(False, 'Учётная запись удалена')
            # Уволенный (архив) — отдельное, понятное человеку сообщение. Без него
            # он видел бы «администратор закрыл доступ» и звонил бы выяснять.
            if row[3]:
                return _resp_access(
                    False,
                    'Вы уволены, доступ в систему закрыт. По вопросам расчётов '
                    'обратитесь к администратору')
            if not row[0]:
                return _resp_access(False, 'Администратор закрыл доступ к профилю')
            # Договор расторгнут (п. 5.7): выкидываем даже того, кто уже был в
            # системе. Без этой проверки человек с открытой вкладкой продолжал
            # бы работать и после расторжения — вход-то бессрочный.
            if row[2]:
                return _resp_access(
                    False,
                    'Договор расторгнут, доступ закрыт. По вопросам расчётов '
                    'обратитесь к администратору')

            cur.execute(
                'SELECT role FROM user_roles WHERE user_id = %s AND is_approved = true',
                (int(user_id),),
            )
            roles = [r[0] for r in cur.fetchall()]
            if role and role not in roles:
                return _resp_access(False, 'Должность больше не подтверждена администратором')

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'active': True, 'roles': roles}),
            }
        finally:
            conn.close()

    # Вход по логину и паролю отключён: в систему заходят только через MAX.
    # Действие оставлено заглушкой, чтобы старые вкладки, открытые до обновления,
    # получали понятный ответ, а не молчаливую ошибку.
    if action == 'password_login':
        return {
            'statusCode': 410,
            'headers': headers,
            'body': json.dumps({'error': 'Вход по паролю отключён — используйте вход через MAX'},
                               ensure_ascii=False),
        }

    if action == 'enter_role':
        user_id = body_data.get('userId')
        role = (body_data.get('role') or '').strip()
        if not user_id or not role:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT u.id, u.full_name, u.is_active, u.workshop, u.shift_number, w.id, "
                "ur.is_approved, u.contract_terminated_at "
                "FROM users u "
                "LEFT JOIN workshops w ON w.name = u.workshop "
                "LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.role = %s "
                "WHERE u.id = %s",
                (role, int(user_id)),
            )
            row = cur.fetchone()
        finally:
            conn.close()

        if not row:
            return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Пользователь не найден'})}

        (user_id, full_name, is_active, workshop_name, shift_number, workshop_id,
         is_approved, terminated_at) = row
        if not is_active:
            return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Учётная запись отключена'})}
        # Договор расторгнут — в систему не пускаем (п. 5.7).
        if terminated_at:
            return {'statusCode': 403, 'headers': headers, 'body': json.dumps(
                {'error': 'Договор расторгнут, доступ в систему закрыт. '
                          'По вопросам расчётов обратитесь к администратору'},
                ensure_ascii=False)}
        if not is_approved:
            return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Эта должность ещё не утверждена администратором'})}

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {
                    'id': user_id,
                    'name': full_name,
                    'role': role,
                    'workshopId': workshop_id,
                    'workshopName': workshop_name,
                    'shiftNumber': shift_number,
                }
            ),
        }

    if action == 'impersonate':
        # Вход администратора в аккаунт сотрудника, чтобы увидеть его рабочую панель
        # своими глазами: что показывает терминал закройщицы, какие рулоны видит швея.
        # Разбирать жалобу «у меня не тот список» иначе приходится вслепую.
        #
        # Пароль сотрудника при этом не нужен и не раскрывается — админ и так может
        # задать любой в карточке. Права проверяем на сервере: свою роль браузер
        # мог бы подменить, и тогда войти в чужой аккаунт смог бы любой сотрудник.
        admin_id = body_data.get('adminId')
        target_id = body_data.get('userId')
        role = (body_data.get('role') or '').strip()
        if not admin_id or not target_id:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректные данные'})}

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT 1 FROM user_roles WHERE user_id = %s AND role = 'admin' AND is_approved = true",
                (int(admin_id),),
            )
            if not cur.fetchone():
                return {'statusCode': 403, 'headers': headers,
                        'body': json.dumps({'error': 'Доступно только администратору'})}

            cur.execute('SELECT is_active FROM users WHERE id = %s', (int(admin_id),))
            adm = cur.fetchone()
            if not adm or not adm[0]:
                return {'statusCode': 403, 'headers': headers,
                        'body': json.dumps({'error': 'Учётная запись отключена'})}

            cur.execute(
                "SELECT u.id, u.full_name, u.is_active, u.workshop, u.shift_number, w.id "
                "FROM users u LEFT JOIN workshops w ON w.name = u.workshop WHERE u.id = %s",
                (int(target_id),),
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers,
                        'body': json.dumps({'error': 'Сотрудник не найден'})}
            uid, full_name, is_active, workshop_name, shift_number, workshop_id = row
            if not is_active:
                return {'statusCode': 403, 'headers': headers,
                        'body': json.dumps({'error': 'Учётная запись сотрудника отключена'})}

            # Роли берём утверждённые. Заходить в неутверждённую должность нельзя:
            # сотрудник её ещё не получил, и панель показала бы то, чего у него нет.
            cur.execute(
                'SELECT role FROM user_roles WHERE user_id = %s AND is_approved = true ORDER BY id',
                (uid,),
            )
            roles = [r[0] for r in cur.fetchall()]
        finally:
            conn.close()

        if not roles:
            return {'statusCode': 403, 'headers': headers,
                    'body': json.dumps({'error': 'У сотрудника нет утверждённых должностей'})}
        if role and role not in roles:
            return {'statusCode': 403, 'headers': headers,
                    'body': json.dumps({'error': 'Эта должность у сотрудника не утверждена'})}

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {
                    'id': uid,
                    'name': full_name,
                    'role': role or roles[0],
                    'availableRoles': roles,
                    'workshopId': workshop_id,
                    'workshopName': workshop_name,
                    'shiftNumber': shift_number,
                },
                ensure_ascii=False,
            ),
        }

    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}