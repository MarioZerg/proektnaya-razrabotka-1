import json
import os

import psycopg2


# Порядок удаления важен: таблицы связаны между собой, и при другом порядке база
# откажется удалять строки. Проверен по реальным связям (foreign keys).
CLEANUP_STEPS = [
    # Отзывы и поставки на маркетплейс
    ('reviews', "DELETE FROM reviews"),
    ('marketplace_supply_items', "DELETE FROM marketplace_supply_items"),
    ('marketplace_supply_boxes', "DELETE FROM marketplace_supply_boxes"),
    ('wb_supply_orders', "DELETE FROM wb_supply_orders"),
    ('marketplace_supplies', "DELETE FROM marketplace_supplies"),
    # Возвраты: склад товара и возвраты ссылаются друг на друга, поэтому сначала
    # разрываем связь, а сам склад чистим ниже.
    ('goods_warehouse_unlink', "UPDATE goods_warehouse SET repack_return_id = NULL "
                               "WHERE repack_return_id IS NOT NULL"),
    ('marketplace_returns', "DELETE FROM marketplace_returns"),
    # Зарплата и касса: начисления и касса ссылаются на выплаты, выплаты — последними.
    ('salary_accruals', "DELETE FROM salary_accruals"),
    ('cash_box_transactions', "DELETE FROM cash_box_transactions"),
    ('salary_payouts', "DELETE FROM salary_payouts"),
    # Склад готового товара
    ('goods_warehouse', "DELETE FROM goods_warehouse"),
    # Заказы и расход материала по ним
    ('order_material_usage', "DELETE FROM order_material_usage"),
    ('auto_order_blocks', "DELETE FROM auto_order_blocks"),
    ('orders', "DELETE FROM orders"),
    # Отгрузки, брак, движения материала
    ('shipment_items', "DELETE FROM shipment_items"),
    ('material_defects', "DELETE FROM material_defects"),
    ('shipments', "DELETE FROM shipments"),
    ('material_movements', "DELETE FROM material_movements"),
    # Рулоны ткани
    ('rolls', "DELETE FROM rolls"),
    # Инвентаризация
    ('inventory_items', "DELETE FROM inventory_items"),
    # Смены сотрудников и журнал действий
    ('shift_sessions', "DELETE FROM shift_sessions"),
    ('audit_log', "DELETE FROM audit_log"),
]

# Нумерация начнётся заново, чтобы новые заказы и рулоны шли с первого номера.
SEQUENCES = [
    'orders_id_seq',
    'rolls_id_seq',
    'goods_warehouse_id_seq',
    'shipments_id_seq',
    'shift_sessions_id_seq',
    'audit_log_id_seq',
]

# Эти таблицы НЕ трогаем — без них система работать не будет.
KEPT_TABLES = [
    'users', 'user_roles', 'workshops', 'workshop_settings', 'shifts', 'shift_calendar',
    'salary_rates', 'materials', 'material_types', 'suppliers', 'shelves', 'hangers',
    'marketplace_integrations', 'marketplace_items', 'marketplace_item_materials',
    'system_settings',
]

CONFIRM_PHRASE = 'ОЧИСТИТЬ'


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False),
    }


def collect_counts(cur):
    """Считает, сколько строк в таблицах — до и после очистки, чтобы показать результат."""
    counts = {}
    for name, _ in CLEANUP_STEPS:
        if name.endswith('_unlink'):
            continue
        cur.execute(f"SELECT COUNT(*) FROM {name}")
        counts[name] = int(cur.fetchone()[0])
    return counts


def handler(event: dict, context) -> dict:
    """Разовая очистка системы перед стартом работы с чистого листа.

    Удаляет всю рабочую историю: заказы, рулоны ткани, склад готового товара,
    отгрузки, поставки, возвраты, зарплату, кассу, смены и журнал действий.

    НЕ ТРОГАЕТ настройки, без которых система не работает: сотрудников, цеха с их
    настройками, смены, тарифы зарплаты, справочник материалов, поставщиков, полки,
    вешалки, ключи маркетплейсов и карточки товаров с нормами расхода ткани
    (по ним заказы с маркетплейсов распознаются — удалять их нельзя).

    POST { action: 'preview' } — показывает, что будет удалено и что останется.
        Ничего не меняет, нужен чтобы админ увидел объём перед нажатием.

    POST { action: 'cleanup', confirm: 'ОЧИСТИТЬ' } — выполняет очистку.
        Без точной подтверждающей фразы ничего не делает: защита от случайного нажатия.
        Всё идёт одной транзакцией — при ошибке откатывается целиком, данные остаются.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: сводка сколько строк было и сколько удалено по каждому разделу
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    if method != 'POST':
        return _resp(405, {'error': 'Method not allowed'})

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if action == 'preview':
            before = collect_counts(cur)
            kept = {}
            for t in KEPT_TABLES:
                cur.execute(f"SELECT COUNT(*) FROM {t}")
                kept[t] = int(cur.fetchone()[0])
            return _resp(200, {
                'willDelete': before,
                'willKeep': kept,
                'totalToDelete': sum(before.values()),
            })

        if action == 'cleanup':
            if (body_data.get('confirm') or '').strip() != CONFIRM_PHRASE:
                return _resp(400, {'error': f'Для подтверждения введите: {CONFIRM_PHRASE}'})

            before = collect_counts(cur)

            deleted = {}
            for name, sql in CLEANUP_STEPS:
                cur.execute(sql)
                if not name.endswith('_unlink'):
                    deleted[name] = cur.rowcount

            for seq in SEQUENCES:
                cur.execute(f"ALTER SEQUENCE {seq} RESTART WITH 1")

            after = collect_counts(cur)
            conn.commit()

            kept = {}
            for t in KEPT_TABLES:
                cur.execute(f"SELECT COUNT(*) FROM {t}")
                kept[t] = int(cur.fetchone()[0])

            return _resp(200, {
                'success': True,
                'before': before,
                'deleted': deleted,
                'after': after,
                'kept': kept,
                'totalDeleted': sum(deleted.values()),
            })

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()
