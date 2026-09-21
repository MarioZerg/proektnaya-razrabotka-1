import json
import os

import psycopg2

from authz import (
    AuthError,
    auth_error_response,
    current_user,
    require_admin,
    require_role,
)

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': CORS_HEADERS,
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def log_action(cur, actor_id, actor_name, action, entity_id, description):
    """Пишет в журнал: движение материала должно оставлять именной след."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, "
        "  entity_id, description) VALUES (%s, %s, 'warehouse', %s, 'repair_piece', %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            action,
            int(entity_id) if entity_id else None,
            description,
        ),
    )


def list_pieces(cur, event):
    """Остатки кусков в цехе. Для таблицы закройщиков и таблицы администратора.

    Параметры (queryStringParameters):
      status   — available (по умолчанию) | reserved | used | written_off | all
      material — фильтр по материалу
      full     — '1' для таблицы администратора (кто отправил, смена, цех)
    """
    q = event.get('queryStringParameters') or {}
    status = (q.get('status') or 'available').strip()
    material = (q.get('material') or '').strip()

    where = []
    params = []
    if status != 'all':
        where.append("p.status = %s")
        params.append(status)
    if material:
        where.append("p.material = %s")
        params.append(material)
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''

    cur.execute(
        f"SELECT p.id, p.material, p.material_id, p.width, p.height, p.status, "
        f"       p.workshop_id, w.name, p.shift_number, "
        f"       p.created_by_name, p.created_at, "
        f"       p.used_order_id, o.order_number, p.used_by_name, p.used_at, p.comment "
        f"FROM repair_fabric_pieces p "
        f"LEFT JOIN workshops w ON w.id = p.workshop_id "
        f"LEFT JOIN orders o ON o.id = p.used_order_id "
        f"{where_sql} "
        f"ORDER BY p.material, p.width, p.height, p.id",
        params,
    )
    pieces = [
        {
            'id': r[0], 'material': r[1], 'materialId': r[2],
            'width': r[3], 'height': r[4], 'status': r[5],
            'workshopId': r[6], 'workshopName': r[7], 'shiftNumber': r[8],
            'createdByName': r[9], 'createdAt': r[10],
            'usedOrderId': r[11], 'usedOrderNumber': r[12],
            'usedByName': r[13], 'usedAt': r[14], 'comment': r[15],
        }
        for r in cur.fetchall()
    ]

    # Сводка по материалам — закройщику важнее «сколько чего есть», чем
    # перечень строк: он ищет глазами нужный материал, а не конкретный кусок.
    summary = {}
    for p in pieces:
        if p['status'] != 'available':
            continue
        summary.setdefault(p['material'], 0)
        summary[p['material']] += 1

    return _resp(200, {
        'pieces': pieces,
        'summary': [{'material': k, 'count': v} for k, v in sorted(summary.items())],
    })


def suitable_for_order(cur, event):
    """Куски, которыми МОЖНО перешить конкретный заказ.

    ГЛАВНОЕ ПРАВИЛО: кусок подходит, только если он НЕ МЕНЬШЕ заказа —
    и по ширине, и по высоте. Из куска 300×255 нельзя сшить штору 400×265:
    ткани физически не хватит. Раньше подбор шёл по метражу рулона, и такая
    ошибка всплывала уже за раскройным столом.

    МАТЕРИАЛ СТРОГО ТОТ ЖЕ. В карточке вуали показываем только вуалевые
    куски: закройщику не приходится вычитывать материал в списке и он не
    возьмёт лён под вуаль.

    Сортировка — от самых близких по размеру: сверху наименее расточительные
    куски, чтобы большой отрез не пустили на маленький заказ.
    """
    q = event.get('queryStringParameters') or {}
    order_id = q.get('orderId')
    if not order_id:
        return _resp(400, {'error': 'Укажите orderId'})

    cur.execute(
        "SELECT material, width, height, order_number FROM orders WHERE id = %s",
        (int(order_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Заказ не найден'})
    material, width, height, order_number = row
    if not material or not width or not height:
        return _resp(200, {
            'pieces': [], 'order': {'material': material, 'width': width, 'height': height},
            'note': 'У заказа не указан материал или размеры — подобрать кусок нельзя',
        })

    cur.execute(
        "SELECT p.id, p.material, p.width, p.height, p.created_by_name, p.created_at, "
        "       w.name, p.shift_number "
        "FROM repair_fabric_pieces p "
        "LEFT JOIN workshops w ON w.id = p.workshop_id "
        "WHERE p.status = 'available' "
        "  AND p.material = %s "
        "  AND p.width >= %s "
        "  AND p.height >= %s "
        # Сначала самые близкие по площади — меньше уходит в обрезки.
        "ORDER BY (p.width - %s) + (p.height - %s), p.id",
        (material, int(width), int(height), int(width), int(height)),
    )
    pieces = [
        {
            'id': r[0], 'material': r[1], 'width': r[2], 'height': r[3],
            'createdByName': r[4], 'createdAt': r[5],
            'workshopName': r[6], 'shiftNumber': r[7],
            # Насколько кусок больше заказа — закройщик видит запас сразу.
            'extraWidth': r[2] - int(width),
            'extraHeight': r[3] - int(height),
        }
        for r in cur.fetchall()
    ]

    return _resp(200, {
        'pieces': pieces,
        'order': {
            'orderNumber': order_number, 'material': material,
            'width': width, 'height': height,
        },
    })


def send_to_repair(cur, conn, event, body):
    """Упаковщица отправляет вещь в перешив — кусок попадает в цех.

    Раньше здесь требовалось выбрать рулон: упаковщица искала подходящий,
    сканировала его, и кусок растворялся в метраже. Теперь она просто
    отправляет вещь в перешив — кусок сохраняет свои размеры и достаётся
    закройщику как отдельный отрез.
    """
    gw_id = body.get('goodsWarehouseId')
    if not gw_id:
        return _resp(400, {'error': 'Укажите вещь'})

    user = current_user(cur, event)
    actor_id = user['id'] if user else body.get('userId')
    actor_name = user['full_name'] if user else body.get('userName')

    cur.execute(
        "SELECT gw.id, gw.status, o.material, o.width, o.height, o.order_number "
        "FROM goods_warehouse gw "
        "LEFT JOIN orders o ON o.id = COALESCE(gw.reserved_order_id, gw.order_id) "
        "WHERE gw.id = %s",
        (int(gw_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Вещь не найдена'})
    _id, gw_status, material, width, height, order_number = row

    if not material or not width or not height:
        return _resp(409, {
            'error': 'У вещи не указаны материал или размеры — в перешив её не принять',
        })
    # Уже отгруженную вещь в перешив не пускаем: её нет на складе.
    if gw_status in ('shipped', 'returned_to_roll', 'disposed'):
        return _resp(409, {'error': 'Эта вещь уже выбыла со склада'})

    cur.execute(
        "SELECT 1 FROM repair_fabric_pieces WHERE goods_warehouse_id = %s AND status = 'available'",
        (int(gw_id),),
    )
    if cur.fetchone():
        return _resp(409, {'error': 'Эта вещь уже отправлена в перешив'})

    # Цех и смену берём из открытой смены отправителя: перешив доступен всем
    # сменам цеха, но кто именно отправил — фиксируем для разбора.
    workshop_id, shift_number = None, None
    if actor_id:
        cur.execute(
            "SELECT workshop_id, shift_number FROM shift_sessions "
            "WHERE user_id = %s AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
            (int(actor_id),),
        )
        s_row = cur.fetchone()
        if s_row:
            workshop_id, shift_number = s_row

    cur.execute("SELECT id FROM materials WHERE name = %s", (material,))
    m_row = cur.fetchone()
    material_id = m_row[0] if m_row else None

    cur.execute(
        "INSERT INTO repair_fabric_pieces "
        "  (goods_warehouse_id, material_id, material, width, height, "
        "   workshop_id, shift_number, created_by, created_by_name, comment) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (
            int(gw_id), material_id, material, int(width), int(height),
            workshop_id, shift_number,
            int(actor_id) if actor_id else None, actor_name,
            f'Из заказа {order_number}' if order_number else None,
        ),
    )
    piece_id = cur.fetchone()[0]

    # Вещь уходит со склада: как товар она больше не существует, теперь это
    # материал в цехе. Статус тот же, что был у роспуска в рулон, — движение
    # по складу остаётся прослеживаемым.
    cur.execute(
        "UPDATE goods_warehouse SET status = 'returned_to_roll', shipped_at = now() "
        "WHERE id = %s",
        (int(gw_id),),
    )

    log_action(
        cur, actor_id, actor_name, 'repair_piece_add', piece_id,
        f'В перешив: {material} {width}x{height} (вещь #{gw_id})',
    )
    conn.commit()

    return _resp(200, {
        'success': True, 'pieceId': piece_id,
        'material': material, 'width': width, 'height': height,
    })


def use_piece(cur, conn, event, body):
    """Закройщик закрепляет кусок за заказом — кусок резервируется под него.

    ПОЧЕМУ РЕЗЕРВ, А НЕ СПИСАНИЕ. Раньше «Взять» списывало кусок насовсем:
    он исчезал из перешива в ту же секунду. Но ткань в этот момент ещё не
    разрезана — закройщица могла передумать, уйти со смены, обнаружить на
    куске дырку. Вернуть его было нечем: в перешиве его уже нет, в заказе он
    никак не отмечен. Кусок просто терялся.

    Теперь кусок переходит в 'reserved': из общего списка он пропадает (двое
    один отрез не возьмут), но остаётся закреплённым за заказом, и его видно
    в карточке. Открепить можно в любой момент до раскроя — кусок вернётся
    в перешив. Окончательно он спишется в 'used' при раскрое.

    ОДИН ЗАКАЗ — ОДИН КУСОК. Если за заказом уже закреплён отрез, второй не
    берём: иначе первый останется висеть в резерве и потеряется.
    """
    piece_id = body.get('pieceId')
    order_id = body.get('orderId')
    if not piece_id or not order_id:
        return _resp(400, {'error': 'Укажите кусок и заказ'})

    user = current_user(cur, event)
    actor_id = user['id'] if user else body.get('userId')
    actor_name = user['full_name'] if user else body.get('userName')

    cur.execute(
        "SELECT id FROM repair_fabric_pieces WHERE used_order_id = %s AND status = 'reserved'",
        (int(order_id),),
    )
    busy = cur.fetchone()
    if busy and busy[0] != int(piece_id):
        return _resp(409, {
            'error': 'За этим заказом уже закреплён кусок с перешива. '
                     'Сначала открепите его, потом берите другой',
        })

    cur.execute(
        "SELECT p.status, p.material, p.width, p.height FROM repair_fabric_pieces p "
        "WHERE p.id = %s FOR UPDATE",
        (int(piece_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Кусок не найден'})
    status, material, width, height = row
    if status != 'available':
        return _resp(409, {
            'error': 'Этот кусок уже забрали. Обновите список и выберите другой',
        })

    # Повторная проверка размеров на сервере: список мог устареть, а отдать
    # заказу кусок меньше нужного нельзя ни при каких условиях.
    cur.execute(
        "SELECT material, width, height, order_number FROM orders WHERE id = %s",
        (int(order_id),),
    )
    o_row = cur.fetchone()
    if not o_row:
        return _resp(404, {'error': 'Заказ не найден'})
    o_material, o_width, o_height, order_number = o_row
    if material != o_material:
        return _resp(409, {
            'error': f'Кусок из материала «{material}», а заказу нужен «{o_material}»',
        })
    if o_width and width < int(o_width) or o_height and height < int(o_height):
        return _resp(409, {
            'error': f'Кусок {width}x{height} меньше заказа {o_width}x{o_height} — не подойдёт',
        })

    cur.execute(
        "UPDATE repair_fabric_pieces SET status = 'reserved', used_order_id = %s, "
        "  used_by = %s, used_by_name = %s, used_at = now() WHERE id = %s",
        (int(order_id), int(actor_id) if actor_id else None, actor_name, int(piece_id)),
    )

    log_action(
        cur, actor_id, actor_name, 'repair_piece_reserve', piece_id,
        f'Кусок {material} {width}x{height} закреплён за заказом {order_number}',
    )
    conn.commit()

    return _resp(200, {'success': True, 'material': material, 'width': width, 'height': height})


def release_piece(cur, conn, event, body):
    """Открепить кусок от заказа — он возвращается в перешив, к остальным.

    ЗАЧЕМ. Закройщица передумала, нашла на куске брак или решила всё-таки
    резать от рулона. Без этой кнопки единственным выходом было бросить
    заказ: кусок висел за ним намертво, рулон при этом выбрать было нельзя.

    Возвращаем именно в 'available', а не списываем: отрез физически цел и
    лежит в цехе, его должен увидеть следующий, кому он подойдёт. Именно
    отсюда берётся «в список перешива возвращается, а не теряется».

    Раскроенный ('used') кусок открепить нельзя: ткань уже разрезана.
    """
    piece_id = body.get('pieceId')
    order_id = body.get('orderId')
    if not piece_id and not order_id:
        return _resp(400, {'error': 'Укажите кусок или заказ'})

    user = current_user(cur, event)
    actor_id = user['id'] if user else body.get('userId')
    actor_name = user['full_name'] if user else body.get('userName')

    if piece_id:
        cur.execute(
            "SELECT id, status, material, width, height, used_order_id "
            "FROM repair_fabric_pieces WHERE id = %s FOR UPDATE",
            (int(piece_id),),
        )
    else:
        cur.execute(
            "SELECT id, status, material, width, height, used_order_id "
            "FROM repair_fabric_pieces WHERE used_order_id = %s AND status = 'reserved' "
            "FOR UPDATE",
            (int(order_id),),
        )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Закреплённый кусок не найден'})
    pid, status, material, width, height, piece_order_id = row

    if status == 'used':
        return _resp(409, {
            'error': 'Кусок уже пущен в раскрой — открепить его нельзя',
        })
    if status != 'reserved':
        return _resp(409, {'error': 'Этот кусок ни за кем не закреплён'})

    cur.execute(
        "UPDATE repair_fabric_pieces SET status = 'available', used_order_id = NULL, "
        "  used_by = NULL, used_by_name = NULL, used_at = NULL WHERE id = %s",
        (pid,),
    )
    log_action(
        cur, actor_id, actor_name, 'repair_piece_release', pid,
        f'Кусок {material} {width}x{height} откреплён от заказа #{piece_order_id} '
        f'и возвращён в перешив',
    )
    conn.commit()
    return _resp(200, {'success': True, 'material': material, 'width': width, 'height': height})


def reserved_for_order(cur, event):
    """Какой кусок закреплён за заказом. По нему карточка прячет выбор рулона."""
    q = event.get('queryStringParameters') or {}
    order_id = q.get('orderId')
    if not order_id:
        return _resp(400, {'error': 'Укажите orderId'})

    cur.execute(
        "SELECT id, material, width, height, status, used_by_name, used_at "
        "FROM repair_fabric_pieces "
        "WHERE used_order_id = %s AND status IN ('reserved', 'used') "
        "ORDER BY CASE status WHEN 'reserved' THEN 0 ELSE 1 END, id DESC LIMIT 1",
        (int(order_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(200, {'piece': None})
    return _resp(200, {'piece': {
        'id': row[0], 'material': row[1], 'width': row[2], 'height': row[3],
        'status': row[4], 'usedByName': row[5], 'usedAt': row[6],
    }})


def delete_piece(cur, conn, event, body):
    """Администратор УДАЛЯЕТ строку из таблицы перешива насовсем.

    ЗАЧЕМ ОТДЕЛЬНО ОТ СПИСАНИЯ. Списание — это учётное событие: кусок был,
    его испортили, след остался в истории. Но в таблицу попадает и мусор:
    упаковщица отправила вещь по ошибке, задублировала, завела кусок с
    неверными размерами. Списывать такое нельзя — в отчётах появится брак,
    которого не было. Такие строки нужно именно убрать.

    Закреплённый за заказом кусок сначала откреплеяем — иначе заказ останется
    ссылаться на строку, которой больше нет.
    """
    piece_id = body.get('pieceId')
    if not piece_id:
        return _resp(400, {'error': 'Укажите кусок'})

    user = require_admin(cur, event)

    cur.execute(
        "SELECT status, material, width, height, goods_warehouse_id "
        "FROM repair_fabric_pieces WHERE id = %s",
        (int(piece_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Кусок не найден'})
    status, material, width, height, gw_id = row

    # Вещь уходила в перешив с перепаковки и получала статус 'returned_to_roll'.
    # Раз куска больше нет, возвращаем её в очередь перепаковки: иначе вещь
    # пропадёт отовсюду разом — и из перешива, и из работы упаковщицы.
    # Только для непотраченных кусков: раскроенный обратно вещью не станет.
    if gw_id and status in ('available', 'reserved'):
        cur.execute(
            "UPDATE goods_warehouse SET status = 'repacking', shipped_at = NULL "
            "WHERE id = %s AND status = 'returned_to_roll'",
            (int(gw_id),),
        )

    cur.execute("DELETE FROM repair_fabric_pieces WHERE id = %s", (int(piece_id),))

    log_action(
        cur, user['id'], user['full_name'], 'repair_piece_delete', piece_id,
        f'Удалён из таблицы перешива кусок {material} {width}x{height} (был «{status}»)',
    )
    conn.commit()
    return _resp(200, {'success': True})


def write_off_piece(cur, conn, event, body):
    """Администратор списывает кусок (брак, потеря, ошибка)."""
    piece_id = body.get('pieceId')
    reason = (body.get('reason') or '').strip()
    if not piece_id:
        return _resp(400, {'error': 'Укажите кусок'})

    user = require_admin(cur, event)

    cur.execute(
        "SELECT status, material, width, height FROM repair_fabric_pieces WHERE id = %s",
        (int(piece_id),),
    )
    row = cur.fetchone()
    if not row:
        return _resp(404, {'error': 'Кусок не найден'})
    status, material, width, height = row
    # Закреплённый за заказом кусок списать можно: он ещё цел, просто закройщица
    # его отложила. Раскроенный — нет, ткани как куска уже не существует.
    if status not in ('available', 'reserved'):
        return _resp(409, {'error': 'Кусок уже израсходован или списан'})

    cur.execute(
        "UPDATE repair_fabric_pieces SET status = 'written_off', used_at = now(), "
        "  used_by = %s, used_by_name = %s, "
        "  comment = COALESCE(comment || ' | ', '') || %s WHERE id = %s",
        (user['id'], user['full_name'], f'Списан: {reason or "без причины"}', int(piece_id)),
    )
    log_action(
        cur, user['id'], user['full_name'], 'repair_piece_write_off', piece_id,
        f'Списан кусок {material} {width}x{height}: {reason or "без причины"}',
    )
    conn.commit()
    return _resp(200, {'success': True})


def handler(event: dict, context) -> dict:
    """Склад кусков ткани на перешив — отрезы, лежащие в цехе.

    ЗАЧЕМ ОТДЕЛЬНО ОТ РУЛОНОВ. Упаковщица, разбирая брак, «распускала» вещь в
    рулон: метраж прибавлялся к остатку, а кусок терял размеры. Закройщик
    видел обезличенные метры и не мог найти конкретный отрез под заказ.
    Здесь кусок хранится как вещь со своими шириной и высотой.

    ПУТЬ КУСКА: available → reserved → used. Резерв обратим — пока ткань не
    разрезана, кусок можно открепить от заказа и вернуть в перешив.

    GET  /?status=available&material=Вуаль
        - остатки кусков в цехе (таблица закройщиков и администратора).
          status: available (по умолчанию) | reserved | used | written_off | all
    GET  /?action=suitable&orderId=123
        - куски, которыми можно перешить заказ: тот же материал и размер
          НЕ МЕНЬШЕ заказа. Отсортированы от наименее расточительных.
    GET  /?action=reserved&orderId=123
        - кусок, закреплённый за заказом (по нему карточка прячет рулоны).
    POST / { action: 'send', goodsWarehouseId }
        - упаковщица отправляет вещь в перешив (рулон указывать не нужно).
    POST / { action: 'use', pieceId, orderId }
        - закройщик закрепляет кусок за заказом (reserved).
    POST / { action: 'release', pieceId | orderId }
        - открепить кусок: возвращается в перешив как available.
    POST / { action: 'write_off', pieceId, reason }
        - администратор списывает кусок (учётное событие, след остаётся).
    POST / { action: 'delete', pieceId }
        - администратор удаляет строку из таблицы перешива насовсем.
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            q = event.get('queryStringParameters') or {}
            if q.get('action') == 'suitable':
                return suitable_for_order(cur, event)
            if q.get('action') == 'reserved':
                return reserved_for_order(cur, event)
            return list_pieces(cur, event)

        if method != 'POST':
            return _resp(405, {'error': 'Method not allowed'})

        body = json.loads(event.get('body') or '{}')
        action = body.get('action')

        try:
            if action == 'send':
                return send_to_repair(cur, conn, event, body)
            if action == 'use':
                return use_piece(cur, conn, event, body)
            if action == 'release':
                return release_piece(cur, conn, event, body)
            if action == 'write_off':
                return write_off_piece(cur, conn, event, body)
            if action == 'delete':
                return delete_piece(cur, conn, event, body)
        except AuthError as err:
            return auth_error_response(err, CORS_HEADERS)

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()