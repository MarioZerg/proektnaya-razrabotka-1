import json
import os

import psycopg2


# Фраза, которую администратор вводит руками. Защита от случайного нажатия:
# очистка необратима, и «вы уверены?» для такого недостаточно.
CONFIRM_PHRASE = 'ОЧИСТИТЬ'

# Порядок удаления продуман по связям между таблицами: сначала записи, которые
# ссылаются на другие, потом те, на которые ссылаются. Иначе база не даст удалить.
#
# Группы идут именно в этом порядке. «Заказы» тянут за собой товар на складе:
# у каждой единицы товара жёсткая ссылка на заказ, отвязать её нельзя.
GROUPS = {
    'documents': {
        'title': 'Договоры и документы сотрудников',
        'steps': [
            "DELETE FROM contract_sign_codes",
            "DELETE FROM contracts",
            "DELETE FROM user_documents",
            # Паспортные данные и реквизиты — это тоже документы сотрудника.
            "UPDATE users SET passport_series = NULL, passport_number = NULL, "
            "passport_issued_by = NULL, passport_issued_date = NULL, "
            "passport_department_code = NULL, birth_date = NULL, "
            "registration_address = NULL, snils = NULL, inn = NULL, "
            "sbp_phone = NULL, sbp_bank = NULL, sbp_confirmed = false, "
            "sbp_confirmed_at = NULL, sbp_confirmed_by = NULL, "
            "personal_data_verified = false, personal_data_verified_at = NULL, "
            "personal_data_verified_by = NULL, docs_deadline = NULL, "
            "docs_submitted_at = NULL, docs_rejected_reason = NULL, "
            "docs_rejected_at = NULL, docs_blocked = false",
        ],
    },
    'salary': {
        'title': 'Зарплаты, смены и штрафы',
        'steps': [
            "DELETE FROM cash_box_transactions",
            "DELETE FROM salary_accruals",
            "DELETE FROM salary_payouts",
            "DELETE FROM shift_calendar",
            "DELETE FROM shift_sessions",
            "DELETE FROM shifts",
            "DELETE FROM vacations",
        ],
    },
    'orders': {
        'title': 'Заказы, поставки, отгрузки и товар на складе',
        'steps': [
            # Возвраты и товар ссылаются друг на друга по кругу — разрываем связь,
            # иначе ни одну из таблиц не удалить первой.
            "UPDATE marketplace_returns SET goods_warehouse_id = NULL",
            "UPDATE goods_warehouse SET repack_return_id = NULL",
            "DELETE FROM reviews",
            "DELETE FROM order_material_usage",
            "DELETE FROM wb_supply_orders",
            "DELETE FROM marketplace_supply_items",
            "DELETE FROM marketplace_supply_boxes",
            "DELETE FROM marketplace_supplies",
            "DELETE FROM marketplace_returns",
            # Коды ПВЗ здесь НЕ трогаем. Это постоянные штрихкоды кабинета продавца
            # (по ним на пункте выдачи отдают возвраты), а не данные заказов. Раньше
            # очистка заказов стирала их вместе с возвратами, и кладовщик оставался
            # без кода прямо на ПВЗ — восстановить можно только руками из кабинета.
            "DELETE FROM goods_warehouse",
            "DELETE FROM orders",
        ],
    },
    'warehouse': {
        'title': 'Склад: рулоны, поставки материала, брак',
        'steps': [
            "DELETE FROM material_defects",
            "DELETE FROM shipment_items",
            "DELETE FROM material_movements",
            "DELETE FROM rolls",
            "DELETE FROM shipments",
            "DELETE FROM inventory_items",
        ],
    },
    'catalogs': {
        'title': 'Справочники: материалы, товары, полки, поставщики',
        'steps': [
            "DELETE FROM auto_order_blocks",
            "DELETE FROM marketplace_item_materials",
            "DELETE FROM marketplace_items",
            "DELETE FROM salary_rates",
            "DELETE FROM supplier_prices",
            "DELETE FROM materials",
            "DELETE FROM material_types",
            "DELETE FROM suppliers",
            "DELETE FROM shelves",
            "DELETE FROM hangers",
            "DELETE FROM inventory_categories",
        ],
    },
    'employees': {
        'title': 'Сотрудники, кроме администраторов',
        'steps': [
            # Ссылки на удаляемых людей обнуляем заранее: заказы к этому моменту уже
            # удалены, но настройки и интеграции остаются и ссылаются на автора.
            "UPDATE marketplace_integrations SET updated_by = NULL "
            "WHERE updated_by NOT IN (SELECT id FROM users WHERE role = 'admin')",
            "UPDATE users SET sbp_confirmed_by = NULL, personal_data_verified_by = NULL",
            "DELETE FROM max_login_codes WHERE user_id NOT IN "
            "(SELECT id FROM users WHERE role = 'admin')",
            "DELETE FROM max_auth_sessions",
            "DELETE FROM telegram_auth_sessions",
            "DELETE FROM user_roles WHERE user_id NOT IN "
            "(SELECT id FROM users WHERE role = 'admin')",
            "DELETE FROM users WHERE role <> 'admin'",
        ],
    },
    'audit': {
        'title': 'Журнал действий',
        'steps': ["DELETE FROM audit_log"],
    },
}

# Порядок обязателен: справочники удаляются последними, потому что на них
# ссылаются рулоны и заказы, а сотрудники — после всего, что хранит их авторство.
GROUP_ORDER = ['documents', 'salary', 'orders', 'warehouse', 'catalogs', 'employees', 'audit']

# Счётчики ID, которые сбрасываем, чтобы нумерация начиналась заново.
SEQUENCES = [
    'orders', 'rolls', 'shipments', 'shipment_items', 'goods_warehouse',
    'marketplace_returns', 'marketplace_supplies', 'marketplace_items',
    'marketplace_item_materials', 'materials', 'material_types', 'material_defects',
    'suppliers', 'supplier_prices', 'shelves', 'hangers', 'salary_accruals',
    'salary_payouts', 'salary_rates', 'shift_sessions', 'shifts', 'contracts',
    'user_documents', 'reviews', 'audit_log',
]


def is_admin(cur, actor_id) -> bool:
    """Роль берём из базы: в запросе её можно подменить, в базе — нет."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def count_rows(cur) -> dict:
    """Сколько записей сейчас в основных таблицах — показываем перед очисткой."""
    tables = {
        'orders': 'Заказы',
        'goods_warehouse': 'Товар на складе',
        'marketplace_returns': 'Возвраты',
        'marketplace_supplies': 'Поставки на маркетплейсы',
        'rolls': 'Рулоны',
        'shipments': 'Поставки материала',
        'salary_accruals': 'Начисления зарплаты',
        'shift_sessions': 'Смены',
        'contracts': 'Договоры',
        'user_documents': 'Сканы документов',
        'marketplace_items': 'Товары в номенклатуре',
        'materials': 'Материалы',
        'suppliers': 'Поставщики',
        'reviews': 'Отзывы',
        'audit_log': 'Записи журнала',
    }
    result = []
    for table, label in tables.items():
        cur.execute(f"SELECT count(*) FROM {table}")
        result.append({'table': table, 'label': label, 'count': cur.fetchone()[0]})

    cur.execute("SELECT count(*) FROM users WHERE role <> 'admin'")
    result.append({
        'table': 'users',
        'label': 'Сотрудники (кроме администраторов)',
        'count': cur.fetchone()[0],
    })
    return result


def handler(event: dict, context) -> dict:
    """Очистка данных системы перед запуском на реальной работе.

    Операция необратимая: удалённое не восстановить. Поэтому доступна только
    администратору и только с подтверждением словом «ОЧИСТИТЬ».

    Что НИКОГДА не удаляется: учётные записи администраторов, настройки системы,
    реквизиты ИП, ключи интеграций с маркетплейсами и цеха.

    GET  /?actorId=1        - сколько записей в каждой таблице и список групп
    POST / { action: 'clear', actorId, groups: ['orders', ...], confirm: 'ОЧИСТИТЬ' }
        - очищает выбранные группы. Порядок удаления система выбирает сама

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        HTTP-ответ со сводкой: что и сколько удалено
    """
    method = event.get('httpMethod', 'GET')
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
        'Content-Type': 'application/json',
    }

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {**headers, 'Access-Control-Max-Age': '86400'},
            'body': '',
        }

    dsn = os.environ['DATABASE_URL']
    params = event.get('queryStringParameters') or {}

    if method == 'GET':
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            if not is_admin(cur, params.get('actorId')):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({'error': 'Очистка доступна только администратору'},
                                       ensure_ascii=False),
                }
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'counts': count_rows(cur),
                    'groups': [
                        {'key': k, 'title': GROUPS[k]['title']} for k in GROUP_ORDER
                    ],
                    'confirmPhrase': CONFIRM_PHRASE,
                }, ensure_ascii=False),
            }
        finally:
            conn.close()

    body_data = json.loads(event.get('body') or '{}')
    if body_data.get('action') != 'clear':
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'Неизвестное действие'}, ensure_ascii=False),
        }

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        actor_id = body_data.get('actorId')
        if not is_admin(cur, actor_id):
            return {
                'statusCode': 403,
                'headers': headers,
                'body': json.dumps({'error': 'Очистка доступна только администратору'},
                                   ensure_ascii=False),
            }

        if (body_data.get('confirm') or '').strip().upper() != CONFIRM_PHRASE:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': f'Для подтверждения введите слово {CONFIRM_PHRASE}'
                }, ensure_ascii=False),
            }

        selected = body_data.get('groups') or []
        unknown = [g for g in selected if g not in GROUPS]
        if not selected or unknown:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Выберите, что именно очистить'},
                                   ensure_ascii=False),
            }

        # Заказы нельзя удалить, не удалив товар на складе: у каждой единицы
        # жёсткая ссылка на заказ. Товар входит в ту же группу, поэтому отдельной
        # проверки не нужно — но порядок групп соблюдаем строго.
        before = {row['table']: row['count'] for row in count_rows(cur)}

        for key in GROUP_ORDER:
            if key not in selected:
                continue
            for sql in GROUPS[key]['steps']:
                cur.execute(sql)

        # Нумерация начинается заново — иначе первый заказ получит номер 748.
        for table in SEQUENCES:
            cur.execute(
                "SELECT pg_get_serial_sequence(%s, 'id')", (table,)
            )
            seq = cur.fetchone()[0]
            if seq:
                cur.execute(f"ALTER SEQUENCE {seq} RESTART WITH 1")

        conn.commit()

        after = {row['table']: row['count'] for row in count_rows(cur)}
        removed = [
            {'table': t, 'removed': before[t] - after.get(t, 0)}
            for t in before
            if before[t] - after.get(t, 0) > 0
        ]

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'success': True,
                'removed': removed,
                'counts': count_rows(cur),
            }, ensure_ascii=False),
        }
    finally:
        conn.close()
