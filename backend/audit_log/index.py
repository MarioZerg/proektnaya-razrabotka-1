import json
import os
from datetime import datetime, timedelta

import psycopg2

# Человеческие названия действий. В базе действие хранится техническим кодом
# ('take_order'), а админу нужно читаемое «Швея взяла заказ в работу».
ACTION_TITLES = {
    # Производство
    'cut': 'Раскроил заказ',
    'take_stack': 'Взял пачку в раскрой',
    'cut_group': 'Раскроил связку заказов',
    'take_order': 'Взял заказ в пошив',
    'send_to_stickering': 'Отшил, отправил на стикеровку',
    'close_order': 'Упаковал заказ',
    'cancel_order': 'Отменил заказ',
    'delete_order': 'Удалил заказ',
    'create_manual': 'Завёл заказ вручную',
    'update_order': 'Изменил заказ',
    'defect_writeoff': 'Списал брак',
    'defect_received': 'Принял брак',
    # Смены — собираются из shift_sessions, а не из audit_log
    'shift_open': 'Открыл смену',
    'shift_close': 'Закрыл смену',
    'shifts_auto_close': 'Автозакрытие смен',
    # Склад
    'place_on_shelf': 'Положил на полку',
    'ship_label': 'Напечатал ярлык',
    'send_to_supply': 'Добавил в поставку',
    'admin_receive': 'Принял на склад',
    'receive': 'Принял товар',
    'ship': 'Отгрузил',
    'scan_picking': 'Отсканировал при сборке',
    'verify_picking': 'Проверил сборку',
    'to_shelf_from_inspection': 'Вернул на полку после проверки',
    'delete_goods': 'Удалил товар со склада',
    'auto_match': 'Автоподбор со склада',
    'request_to_workshop': 'Запросил в цех',
    'not_found': 'Товар не найден',
    # Деньги
    'update_rate': 'Изменил тариф',
    'delete_accrual': 'Удалил начисление',
    # Интеграции
    'ozon_sync_orders': 'OZON: загрузка заказов',
    'wb_sync_orders': 'WB: загрузка заказов',
    'ym_sync': 'Яндекс: загрузка заказов',
    'ozon_refresh_statuses': 'OZON: проверка статусов',
    'wb_check_statuses': 'WB: проверка статусов',
    'ym_check_statuses': 'Яндекс: проверка статусов',
    'ozon_split_pending': 'OZON: разделение заказов',
    'sync': 'Синхронизация',
}

# Группы для фильтра «этап». Админу удобнее искать по смыслу работы, а не по
# техническому коду: «покажи всё про пошив» вместо перечисления действий.
STAGE_ACTIONS = {
    'shifts': ('shift_open', 'shift_close', 'shifts_auto_close'),
    'cutting': ('cut', 'take_stack', 'cut_group'),
    'sewing': ('take_order', 'send_to_stickering'),
    'stickering': ('close_order', 'place_on_shelf', 'ship_label'),
}


def esc(text):
    """Экранирует строку для подстановки в SQL.

    Здесь используется Simple Query Protocol (параметры %s недоступны для части
    запросов), поэтому значения из фильтров подставляются в текст запроса —
    экранирование обязательно, иначе кавычка в поиске сломает запрос.
    """
    return str(text).replace("'", "''")


def build_filters(params):
    """Собирает условия отбора из параметров запроса.

    Возвращает (список условий для audit_log, список условий для смен, срез значений).
    Смены живут в отдельной таблице, поэтому условия для них строятся параллельно.
    """
    search = (params.get('search') or '').strip()
    user_id = (params.get('userId') or '').strip()
    stage = (params.get('stage') or '').strip()
    date_from = (params.get('dateFrom') or '').strip()
    date_to = (params.get('dateTo') or '').strip()

    log_where = ["1=1"]
    shift_where = ["1=1"]

    if user_id.isdigit():
        log_where.append(f"a.user_id = {int(user_id)}")
        shift_where.append(f"s.user_id = {int(user_id)}")

    if date_from:
        log_where.append(f"a.created_at >= '{esc(date_from)} 00:00:00'")
        shift_where.append(f"s.opened_at >= '{esc(date_from)} 00:00:00'")
    if date_to:
        log_where.append(f"a.created_at <= '{esc(date_to)} 23:59:59'")
        shift_where.append(f"s.opened_at <= '{esc(date_to)} 23:59:59'")

    if search:
        s = esc(search)
        log_where.append(
            f"(a.description ILIKE '%{s}%' OR a.user_name ILIKE '%{s}%' "
            f"OR CAST(a.entity_id AS TEXT) = '{s}')"
        )
        shift_where.append(f"u.full_name ILIKE '%{s}%'")

    return log_where, shift_where, stage


def fetch_events(cur, params):
    """Собирает ленту событий: журнал действий + открытия/закрытия смен.

    Смены не пишутся в audit_log (в таблице только автозакрытие), но админу они нужны
    в общей ленте. Поэтому события смен строятся прямо из shift_sessions: одна строка
    смены превращается в два события — «открыл» и «закрыл». Так журнал показывает
    полную картину дня, не требуя переписывать существующий код смен.
    """
    log_where, shift_where, stage = build_filters(params)

    limit = params.get('limit') or '100'
    offset = params.get('offset') or '0'
    limit = min(int(limit) if str(limit).isdigit() else 100, 500)
    offset = int(offset) if str(offset).isdigit() else 0

    include_shifts = (not stage) or stage == 'shifts'
    include_log = (not stage) or stage != 'shifts'

    stage_sql = ''
    if stage and stage in STAGE_ACTIONS and stage != 'shifts':
        codes = "','".join(STAGE_ACTIONS[stage])
        stage_sql = f" AND a.action IN ('{codes}')"

    parts = []
    if include_log:
        parts.append(
            "SELECT a.created_at AS at, a.user_id, "
            "COALESCE(u.full_name, a.user_name, 'Система') AS who, "
            "a.action, a.entity_type, a.entity_id, a.description, a.category, "
            "NULL::int AS workshop_id, NULL::text AS role "
            "FROM audit_log a LEFT JOIN users u ON u.id = a.user_id "
            f"WHERE {' AND '.join(log_where)}{stage_sql}"
        )
    if include_shifts:
        parts.append(
            "SELECT s.opened_at AS at, s.user_id, u.full_name AS who, "
            "'shift_open' AS action, 'shift_session' AS entity_type, s.id AS entity_id, "
            # В подробностях у смены — не повтор названия действия, а то, чего не видно
            # в других колонках: опоздание и номер смены. Иначе строка дублировала бы
            # сама себя («Открыл смену» / «Открыл смену») и не давала админу ничего.
            "(CASE WHEN s.is_late THEN 'Опоздание' ELSE 'Вовремя' END "
            " || COALESCE(', смена №' || s.shift_number, '')) AS description, "
            "'shifts' AS category, s.workshop_id, s.role "
            "FROM shift_sessions s JOIN users u ON u.id = s.user_id "
            f"WHERE {' AND '.join(shift_where)}"
        )
        parts.append(
            "SELECT s.closed_at AS at, s.user_id, u.full_name AS who, "
            "'shift_close' AS action, 'shift_session' AS entity_type, s.id AS entity_id, "
            # Сколько человек отработал — главное, что админ хочет знать о закрытой смене.
            "('Отработал ' || "
            " to_char((s.closed_at - s.opened_at), 'HH24:MI')) AS description, "
            "'shifts' AS category, s.workshop_id, s.role "
            "FROM shift_sessions s JOIN users u ON u.id = s.user_id "
            f"WHERE {' AND '.join(shift_where)} AND s.closed_at IS NOT NULL"
        )

    union_sql = " UNION ALL ".join(parts)

    cur.execute(f"SELECT count(*) FROM ({union_sql}) e")
    total = cur.fetchone()[0]

    cur.execute(
        f"SELECT e.*, w.name FROM ({union_sql}) e "
        "LEFT JOIN workshops w ON w.id = e.workshop_id "
        f"ORDER BY e.at DESC LIMIT {limit} OFFSET {offset}"
    )

    items = []
    for r in cur.fetchall():
        action = r[3]
        items.append({
            'at': r[0].isoformat() if r[0] else None,
            'userId': r[1],
            'who': r[2] or 'Система',
            'action': action,
            'actionTitle': ACTION_TITLES.get(action, action),
            'entityType': r[4],
            'entityId': r[5],
            'description': r[6],
            'category': r[7],
            'workshop': r[10],
            'role': r[9],
        })

    return {'items': items, 'total': total, 'limit': limit, 'offset': offset}


def fetch_summary(cur, params):
    """Короткая сводка за выбранный период — сколько каких событий.

    Нужна, чтобы админ с первого взгляда видел объём работы за день: сколько
    раскроили, сколько отшили, сколько смен открыли, — не листая всю ленту.
    """
    log_where, shift_where, _ = build_filters(params)

    cur.execute(
        "SELECT a.action, count(*) FROM audit_log a "
        f"WHERE {' AND '.join(log_where)} GROUP BY a.action"
    )
    counts = {r[0]: r[1] for r in cur.fetchall()}

    cur.execute(
        "SELECT count(*), count(s.closed_at) FROM shift_sessions s "
        f"JOIN users u ON u.id = s.user_id WHERE {' AND '.join(shift_where)}"
    )
    row = cur.fetchone()
    opened, closed = row[0], row[1]

    return {
        'shiftsOpened': opened,
        'shiftsClosed': closed,
        'cut': counts.get('cut', 0),
        'taken': counts.get('take_order', 0),
        'sewn': counts.get('send_to_stickering', 0),
        'packed': counts.get('close_order', 0),
    }


def handler(event: dict, context) -> dict:
    """Журнал действий для администратора.

    Показывает единой лентой, кто и когда открывал и закрывал смены, брал заказы,
    раскраивал, шил и стикеровал. События собираются из двух источников: таблицы
    audit_log (действия с заказами и складом) и shift_sessions (смены).

    GET /?action=events — лента событий.
        Фильтры: search (по описанию, сотруднику, номеру заказа), userId, stage
        (shifts|cutting|sewing|stickering), dateFrom, dateTo (YYYY-MM-DD), limit, offset.
    GET /?action=summary — сводка за период (сколько раскроено, отшито, упаковано).
    GET /?action=users — список сотрудников, встречающихся в журнале (для фильтра).

    Args:
        event: dict с httpMethod, queryStringParameters
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с лентой событий, сводкой или списком сотрудников
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

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

    if method != 'GET':
        return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}

    params = event.get('queryStringParameters') or {}
    action = (params.get('action') or 'events').strip()

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if action == 'users':
            # Только те, кто реально что-то делал, — иначе в фильтре висят десятки
            # уволенных и никогда не работавших сотрудников.
            cur.execute(
                "SELECT DISTINCT u.id, u.full_name FROM users u "
                "WHERE EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id = u.id) "
                "   OR EXISTS (SELECT 1 FROM shift_sessions s WHERE s.user_id = u.id) "
                "ORDER BY u.full_name"
            )
            users = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'users': users}, ensure_ascii=False)}

        if action == 'summary':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(fetch_summary(cur, params), ensure_ascii=False),
            }

        if action == 'events':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(fetch_events(cur, params), ensure_ascii=False),
            }

        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
    finally:
        conn.close()
