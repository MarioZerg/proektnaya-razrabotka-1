import json
import os

import psycopg2

# Статусы OZON, при которых шить уже нечего: покупатель отказался либо отправление
# собрано и уехало. В счётчике срочных они создавали ложную гору работы.
NOT_URGENT_OZON = (
    'cancelled', 'delivering', 'delivered', 'not_accepted',
    'driver_pickup', 'awaiting_deliver',
)

# Рулон считается заканчивающимся, если в нём меньше 20 погонных метров.
ROLL_LOW_STOCK_THRESHOLD = 20

# Что метрами НЕ является. Метры в системе записаны по-разному («м», «п.м»,
# «пог.м»), поэтому перечислять их бесполезно — проще отсечь штуки и вес,
# ровно как это делает isMetersUnit в интерфейсе. Пустая единица — метры.
NOT_METERS_PREFIXES = ('шт', 'кг', 'г', 'уп', 'компл')


def handler(event: dict, context) -> dict:
    """Считает ВСЕ цифры для плиток главной страницы одним запросом.

    Зачем функция существует.

    Главная страница — самый посещаемый экран: её открывают все сотрудники и
    держат открытой всю смену. Раньше ради полутора десятков чисел браузер
    выкачивал четыре полных списка: все заказы, весь товар на складе, все рулоны
    и поставки — около 4.5 МБ на каждое открытие. Считались они уже на месте, в
    браузере: из 5282 записей склада брали два числа, из 1445 заказов — восемь.

    Платили за это дважды: сервер собирал и отдавал мегабайты, а слабый планшет
    в цехе потом это разбирал и подтормаживал.

    Здесь всё то же самое считает база — она умеет считать не выгружая. Ответ
    получается около килобайта вместо 4.5 МБ, а формулы повторяют прежние
    один в один, чтобы цифры на экране не изменились.
    """
    method = event.get('httpMethod', 'GET')
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
        'Content-Type': 'application/json',
    }

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {**headers, 'Access-Control-Max-Age': '86400'},
            'body': '',
        }

    if method != 'GET':
        return {
            'statusCode': 405,
            'headers': headers,
            'body': json.dumps({'error': 'Method not allowed'}),
        }

    params = event.get('queryStringParameters') or {}
    # Швея и закройщик видят на панели ТОЛЬКО свою работу: чужие заказы в личной
    # сводке сбивают с толку — человек шёл искать «30 товаров в пошиве», а его там
    # один. Роль и id приходят с фронта, как и раньше при подсчёте в браузере.
    role = (params.get('role') or '').strip()
    try:
        user_id = int(params.get('userId') or 0)
    except (TypeError, ValueError):
        user_id = 0

    is_sewer = role == 'sewer'
    is_cutter = role == 'cutter'
    # Складские плитки нужны только тем, кто отвечает за склад.
    warehouse = role in ('admin', 'storekeeper', 'senior_storekeeper')

    dsn = os.environ.get('DATABASE_URL')
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        # Личный фильтр для швеи и закройщика. Подставляем id прямо в текст запроса:
        # значение уже приведено к целому числу выше, посторонним туда не попасть.
        mine_sewing = f' AND assigned_user_id = {user_id}' if is_sewer and user_id else ''
        mine_cutting = f' AND assigned_user_id = {user_id}' if is_cutter and user_id else ''
        # На стикеровке швея записана исполнителем этапа (sewer_user_id), а
        # assigned_user_id к этому моменту уже перешёл к упаковщице.
        stick_parts = []
        if is_sewer and user_id:
            stick_parts.append(f'sewer_user_id = {user_id}')
        if is_cutter and user_id:
            stick_parts.append(f'cutter_user_id = {user_id}')
        mine_stick = (' AND ' + ' AND '.join(stick_parts)) if stick_parts else ''

        not_urgent = ', '.join(f"'{s}'" for s in NOT_URGENT_OZON)

        cur.execute(
            "SELECT "
            # «Новые задания» — общая очередь, её разбирают все. Считаем только
            # заказы, реально пришедшие с площадок: ручной импорт сюда попадать
            # не должен, иначе цифра расходится с кабинетом маркетплейса.
            "COUNT(*) FILTER (WHERE sewing_status = 'Новый' AND source = 'api') AS new_orders, "
            f"COUNT(*) FILTER (WHERE sewing_status = 'В работе'{mine_sewing}) AS in_sewing, "
            f"COUNT(*) FILTER (WHERE sewing_status = 'На раскрое'{mine_cutting}) AS in_cutting, "
            f"COUNT(*) FILTER (WHERE sewing_status = 'Стикеровка'{mine_stick}) AS in_stickering, "
            # «Раскроено» — общий пул: закройщики сдали работу, швеи её разбирают.
            "COUNT(*) FILTER (WHERE sewing_status = 'Раскроено') AS cut, "
            "COUNT(*) FILTER (WHERE order_type = 'FBS' "
            "  AND sewing_status IN ('Новый', 'На раскрое', 'Раскроено', 'В работе', 'Стикеровка') "
            f"  AND COALESCE(ozon_status, '') NOT IN ({not_urgent})) AS urgent_fbs "
            "FROM orders"
        )
        o = cur.fetchone()

        result = {
            'newOrders': o[0],
            'inSewing': o[1],
            'inCutting': o[2],
            'inStickering': o[3],
            'cut': o[4],
            'urgentFbs': o[5],
        }

        # Поставки в цех: их всего пара сотен, но и это лишние 126 КБ ради двух чисел.
        cur.execute(
            "SELECT "
            "COUNT(*) FILTER (WHERE status = 'Новый') AS not_shipped, "
            "COUNT(*) FILTER (WHERE status = 'Отправлено') AS not_received "
            "FROM shipments WHERE type = 'to_workshop'"
        )
        sh = cur.fetchone()
        result['notShippedToWorkshop'] = sh[0]
        result['notReceivedInWorkshop'] = sh[1]

        # ЗАДВОЕННЫЕ ЗАКАЗЫ: одна вещь попала в систему дважды.
        #
        # Отличаем задвоение от нормального отправления с несколькими вещами по
        # образцу номера: раньше в номер подставлялся артикул («…-vyal3_265-1»),
        # сейчас — только порядковый номер. Если внутри ОДНОГО отправления
        # встречаются оба образца сразу, значит вещи заехали повторно после смены
        # формата. Отправление, где все номера сделаны одинаково, — нормальный
        # заказ на несколько вещей.
        #
        # Лишних вещей столько, сколько записей сверх одной, — их и надо отменить.
        cur.execute(
            "SELECT COALESCE(SUM(cnt - 1), 0) FROM ("
            "  SELECT COUNT(*) AS cnt "
            "  FROM orders "
            "  WHERE marketplace = 'OZON' AND status <> 'Отменён' "
            "    AND ozon_posting_number IS NOT NULL AND ozon_posting_number <> '' "
            "  GROUP BY ozon_posting_number "
            "  HAVING COUNT(*) >= 2 "
            "     AND COUNT(*) FILTER (WHERE order_number LIKE '%\\_%') > 0 "
            "     AND COUNT(*) FILTER (WHERE order_number LIKE '%\\_%') < COUNT(*)"
            ") d"
        )
        result['duplicateOrders'] = int(cur.fetchone()[0] or 0)

        if warehouse:
            # Убираем ВСЕ пробелы, а не только крайние: в базе встречается
            # «пог. м», а в интерфейсе сравнение идёт по строке без пробелов.
            not_meters = ' AND '.join(
                f"u.v NOT LIKE '{p}%'" for p in NOT_METERS_PREFIXES
            )
            # Единица измерения хранится не у рулона, а у материала, из которого
            # он смотан, — поэтому join. Материал может быть не указан: тогда
            # единица пустая, а пустая по правилам интерфейса считается метрами.
            cur.execute(
                "SELECT COUNT(*) FROM rolls r "
                "LEFT JOIN materials m ON m.id = r.material_id, "
                "  LATERAL (SELECT LOWER(REPLACE(COALESCE(m.unit, ''), ' ', '')) AS v) u "
                # ТОЛЬКО рулоны в цехе: панель и раньше запрашивала их с
                # фильтром status=in_workshop. Рулоны на складе в этот счётчик
                # не входят — там остаток нормальный, это запас, а не работа.
                "WHERE r.status = 'in_workshop' "
                f"  AND ({not_meters}) "
                f"  AND r.remaining_quantity < {ROLL_LOW_STOCK_THRESHOLD}"
            )
            result['lowStockRolls'] = cur.fetchone()[0]

            cur.execute(
                "SELECT "
                # Вещи, отменённые клиентом: упаковщик наклеил стикер хранения, но
                # кладовщик ещё не забрал их из цеха и не положил на полку.
                "COUNT(*) FILTER (WHERE status IN ('awaiting_shelf', 'mp_return')) AS awaiting_shelf, "
                # Заказы, которые закрываются вещью с полки и ждут стикера отправления.
                "COUNT(*) FILTER (WHERE reserved_order_id IS NOT NULL "
                "  AND shipping_labeled_at IS NULL AND status = 'picking') AS awaiting_ship_label "
                "FROM goods_warehouse"
            )
            g = cur.fetchone()
            result['awaitingShelf'] = g[0]
            result['awaitingShipLabel'] = g[1]

            # Вещи, привезённые кладовщиком с ПВЗ, но ещё не разобранные.
            cur.execute(
                "SELECT COUNT(*) FROM marketplace_returns WHERE status = 'picked_up'"
            )
            result['returnsPickedUp'] = cur.fetchone()[0]
    finally:
        conn.close()

    return {'statusCode': 200, 'headers': headers, 'body': json.dumps(result)}
