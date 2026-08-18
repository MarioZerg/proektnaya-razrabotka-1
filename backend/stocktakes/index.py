import json
import os

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

HEADERS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

# Кто считает товар. Инвентаризацию ведут только кладовщики: это их зона
# ответственности и их доступ к полкам.
STOREKEEPER_ROLES = ('storekeeper', 'senior_storekeeper')

# Вещи, которые ОБЯЗАНЫ лежать на полке и потому участвуют в пересчёте.
# Всё остальное (уехало в поставку, списано, у покупателя) физически на складе
# отсутствует — требовать его скан значило бы плодить ложные недостачи.
COUNTABLE_STATUS = 'in_stock'


def _resp(status, body):
    return {'statusCode': status, 'headers': HEADERS, 'body': json.dumps(body, ensure_ascii=False)}


def log_action(cur, actor_id, actor_name, action, entity_id, description):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, 'warehouse', %s, 'stocktake', %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            action,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
        ),
    )


def get_role(cur, user_id):
    if not user_id:
        return None
    cur.execute("SELECT role FROM users WHERE id = %s", (int(user_id),))
    row = cur.fetchone()
    return row[0] if row else None


def build_report(cur, stocktake_id):
    """Что нашли, чего не хватает и что лежит не на своей полке.

    Считается всегда «на лету» по текущему складу, а не сохранённой копией:
    пока идёт пересчёт, вещи продолжают приезжать и уезжать, и замороженный
    список сразу разошёлся бы с реальностью.
    """
    # Найденное: отсканированные стикеры.
    cur.execute(
        "SELECT s.storage_barcode, s.goods_warehouse_id, s.scanned_at, "
        "  sh_found.name, sh_exp.name, o.order_number, o.material, o.width, o.height "
        "FROM stocktake_scans s "
        "LEFT JOIN goods_warehouse gw ON gw.id = s.goods_warehouse_id "
        "LEFT JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN shelves sh_found ON sh_found.id = s.shelf_id "
        "LEFT JOIN shelves sh_exp ON sh_exp.id = s.expected_shelf_id "
        "WHERE s.stocktake_id = %s ORDER BY s.scanned_at DESC",
        (int(stocktake_id),),
    )
    found = []
    misplaced = []
    for r in cur.fetchall():
        item = {
            'barcode': r[0],
            'goodsWarehouseId': r[1],
            'scannedAt': r[2].isoformat() + 'Z' if r[2] else None,
            'shelfName': r[3],
            'expectedShelfName': r[4],
            'orderNumber': r[5],
            'product': ' '.join(
                str(x) for x in [r[6], f'{r[7]}×{r[8]}' if r[7] and r[8] else None] if x
            ) or None,
        }
        found.append(item)
        # Вещь нашлась, но не там, где числилась: полку поправим при подтверждении.
        if r[3] and r[4] and r[3] != r[4]:
            misplaced.append(item)

    # Недостача: числится на полке, но не отсканировано.
    cur.execute(
        "SELECT gw.id, gw.storage_barcode, sh.name, o.order_number, "
        "  o.material, o.width, o.height, gw.received_at "
        "FROM goods_warehouse gw "
        "LEFT JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
        "WHERE gw.status = %s "
        "  AND NOT EXISTS (SELECT 1 FROM stocktake_scans s "
        "                  WHERE s.stocktake_id = %s AND s.goods_warehouse_id = gw.id) "
        "ORDER BY sh.name NULLS LAST, gw.storage_barcode",
        (COUNTABLE_STATUS, int(stocktake_id)),
    )
    missing = [
        {
            'goodsWarehouseId': r[0],
            'barcode': r[1],
            'shelfName': r[2],
            'orderNumber': r[3],
            'product': ' '.join(
                str(x) for x in [r[4], f'{r[5]}×{r[6]}' if r[5] and r[6] else None] if x
            ) or None,
            'receivedAt': r[7].isoformat() + 'Z' if r[7] else None,
        }
        for r in cur.fetchall()
    ]

    # Сколько всего вещей должно лежать на полках — база для процента пересчёта.
    cur.execute(
        "SELECT COUNT(*) FROM goods_warehouse WHERE status = %s", (COUNTABLE_STATUS,)
    )
    expected = int(cur.fetchone()[0] or 0)

    # Излишки: стикер отсканирован, но вещь на складе не числится (уже списана,
    # уехала в поставку или её вернули мимо системы). Это не недостача, но и не
    # норма — админ должен увидеть такие вещи отдельно.
    extra = [f for f in found if not f['goodsWarehouseId']]

    # По полкам: кладовщику удобно сверять стеллаж за стеллажом.
    cur.execute(
        "SELECT sh.id, sh.name, "
        "  COUNT(gw.id) FILTER (WHERE gw.status = %s), "
        "  COUNT(s.id) "
        "FROM shelves sh "
        "LEFT JOIN goods_warehouse gw ON gw.shelf_id = sh.id AND gw.status = %s "
        "LEFT JOIN stocktake_scans s ON s.stocktake_id = %s AND s.shelf_id = sh.id "
        "GROUP BY sh.id, sh.name ORDER BY sh.name",
        (COUNTABLE_STATUS, COUNTABLE_STATUS, int(stocktake_id)),
    )
    shelves = [
        {'shelfId': r[0], 'shelfName': r[1], 'expected': int(r[2] or 0), 'found': int(r[3] or 0)}
        for r in cur.fetchall()
    ]

    return {
        'expected': expected,
        'found': found,
        'foundCount': len(found),
        'missing': missing,
        'missingCount': len(missing),
        'misplaced': misplaced,
        'extra': extra,
        'shelves': shelves,
    }


def load_stocktake(cur, stocktake_id):
    cur.execute(
        "SELECT id, status, started_by_name, started_at, closed_at, "
        "  approved_by_name, approved_at, reject_reason, note, "
        "  expected_count, found_count, missing_count, extra_count "
        "FROM stocktakes WHERE id = %s",
        (int(stocktake_id),),
    )
    r = cur.fetchone()
    if not r:
        return None
    return {
        'id': r[0],
        'status': r[1],
        'startedByName': r[2],
        'startedAt': r[3].isoformat() + 'Z' if r[3] else None,
        'closedAt': r[4].isoformat() + 'Z' if r[4] else None,
        'approvedByName': r[5],
        'approvedAt': r[6].isoformat() + 'Z' if r[6] else None,
        'rejectReason': r[7],
        'note': r[8],
        'expectedCount': r[9],
        'foundCount': r[10],
        'missingCount': r[11],
        'extraCount': r[12],
    }


def handler(event: dict, context) -> dict:
    """Инвентаризация склада готового товара.

    Кладовщик открывает пересчёт, сканирует стикеры хранения GW прямо с полок и
    закрывает инвентаризацию. Всё, что не отсканировано, попадает в недостачу.
    Списать недостачу сам кладовщик не может: закрытая инвентаризация уходит
    администратору, и только он утилизирует ненайденные вещи. Так пересчёт не
    превращается в способ молча убрать со склада пропавший товар.

    GET  /                       - список инвентаризаций
    GET  /?id=5                  - одна инвентаризация с полным отчётом
    GET  /?active=1              - текущая незакрытая инвентаризация
    POST / { action: 'start' }   - начать пересчёт (кладовщик)
    POST / { action: 'scan', stocktakeId, barcode } - отсканировать стикер GW
    POST / { action: 'undo_scan', stocktakeId, barcode }
    POST / { action: 'close', stocktakeId, note }   - закрыть и отправить админу
    POST / { action: 'approve', stocktakeId }       - админ: подтвердить, списать недостачу
    POST / { action: 'reject', stocktakeId, reason }- админ: вернуть на пересчёт
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}

            if params.get('id'):
                st = load_stocktake(cur, params['id'])
                if not st:
                    return _resp(404, {'error': 'Инвентаризация не найдена'})
                st['report'] = build_report(cur, st['id'])
                return _resp(200, {'stocktake': st})

            if params.get('active'):
                cur.execute(
                    "SELECT id FROM stocktakes WHERE status IN ('in_progress', 'rejected') "
                    "ORDER BY started_at DESC LIMIT 1"
                )
                row = cur.fetchone()
                if not row:
                    return _resp(200, {'stocktake': None})
                st = load_stocktake(cur, row[0])
                st['report'] = build_report(cur, st['id'])
                return _resp(200, {'stocktake': st})

            cur.execute(
                "SELECT id FROM stocktakes ORDER BY started_at DESC LIMIT 50"
            )
            items = [load_stocktake(cur, r[0]) for r in cur.fetchall()]
            return _resp(200, {'stocktakes': items})

        if method != 'POST':
            return _resp(405, {'error': 'Method not allowed'})

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')
        actor_role = get_role(cur, actor_id)

        if action == 'start':
            if actor_role not in STOREKEEPER_ROLES:
                return _resp(403, {'error': 'Инвентаризацию проводит кладовщик'})
            # Две параллельные инвентаризации привели бы к двойному пересчёту
            # одних и тех же полок и спору, чей результат верный.
            cur.execute(
                "SELECT id FROM stocktakes WHERE status IN ('in_progress', 'rejected') LIMIT 1"
            )
            existing = cur.fetchone()
            if existing:
                return _resp(409, {
                    'error': 'Инвентаризация уже идёт — продолжите её или закройте',
                    'stocktakeId': existing[0],
                })
            cur.execute(
                "INSERT INTO stocktakes (status, started_by, started_by_name) "
                "VALUES ('in_progress', %s, %s) RETURNING id",
                (int(actor_id) if actor_id else None, actor_name),
            )
            new_id = cur.fetchone()[0]
            log_action(cur, actor_id, actor_name, 'stocktake_start', new_id,
                       'Начата инвентаризация склада товара')
            conn.commit()
            return _resp(200, {'id': new_id})

        if action == 'scan':
            if actor_role not in STOREKEEPER_ROLES:
                return _resp(403, {'error': 'Сканировать может только кладовщик'})
            stocktake_id = body_data.get('stocktakeId')
            barcode = (body_data.get('barcode') or '').strip().upper()
            # Полка, у которой кладовщик стоит СЕЙЧАС. Без неё нельзя понять, что
            # вещь лежит не на своём месте: она числится на «Верхней», а найдена
            # на «Нижней». Не указана — считаем, что вещь лежит там, где числится.
            at_shelf_id = body_data.get('shelfId')
            if not stocktake_id or not barcode:
                return _resp(400, {'error': 'Отсканируйте стикер хранения'})

            cur.execute("SELECT status FROM stocktakes WHERE id = %s", (int(stocktake_id),))
            st_row = cur.fetchone()
            if not st_row:
                return _resp(404, {'error': 'Инвентаризация не найдена'})
            if st_row[0] not in ('in_progress', 'rejected'):
                return _resp(409, {'error': 'Инвентаризация уже закрыта — сканировать нельзя'})

            # В инвентаризации работают ТОЛЬКО складские стикеры GW. Ярлык
            # маркетплейса на вещи наклеен свой, и если считать по нему, одна и та
            # же вещь попадёт в пересчёт дважды, а часть товара — ни разу.
            if not barcode.startswith('GW-'):
                return _resp(400, {
                    'error': f'{barcode} — это не складской стикер. '
                             f'В инвентаризации сканируются только стикеры GW'
                })

            cur.execute(
                "SELECT gw.id, gw.status, gw.shelf_id, sh.name, o.order_number, "
                "  o.material, o.width, o.height "
                "FROM goods_warehouse gw "
                "LEFT JOIN orders o ON o.id = gw.order_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                "WHERE gw.storage_barcode = %s",
                (barcode,),
            )
            gw = cur.fetchone()

            cur.execute(
                "SELECT id FROM stocktake_scans WHERE stocktake_id = %s AND storage_barcode = %s",
                (int(stocktake_id), barcode),
            )
            if cur.fetchone():
                return _resp(409, {'error': f'{barcode} уже отсканирован в этой инвентаризации'})

            gw_id = gw[0] if gw else None
            expected_shelf_id = gw[2] if gw else None
            shelf_id = int(at_shelf_id) if at_shelf_id not in (None, '') else expected_shelf_id
            product = None
            order_number = None
            warning = None
            if gw:
                order_number = gw[4]
                product = ' '.join(
                    str(x) for x in [gw[5], f'{gw[6]}×{gw[7]}' if gw[6] and gw[7] else None] if x
                ) or None
                if gw[1] != COUNTABLE_STATUS:
                    # Вещь физически в руках, а по системе она не на полке. Скан
                    # принимаем (товар-то есть), но помечаем как излишек.
                    warning = f'Вещь числится не на складе (статус: {gw[1]}) — попадёт в излишки'
            else:
                warning = 'Стикер не найден в системе — попадёт в излишки'

            cur.execute(
                "INSERT INTO stocktake_scans (stocktake_id, goods_warehouse_id, storage_barcode, "
                "  shelf_id, expected_shelf_id, scanned_by, scanned_by_name) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (int(stocktake_id), gw_id, barcode, shelf_id, expected_shelf_id,
                 int(actor_id) if actor_id else None, actor_name),
            )
            conn.commit()
            return _resp(200, {
                'barcode': barcode,
                'orderNumber': order_number,
                'product': product,
                'shelfName': gw[3] if gw else None,
                'warning': warning,
            })

        if action == 'undo_scan':
            if actor_role not in STOREKEEPER_ROLES:
                return _resp(403, {'error': 'Только кладовщик'})
            stocktake_id = body_data.get('stocktakeId')
            barcode = (body_data.get('barcode') or '').strip().upper()
            if not stocktake_id or not barcode:
                return _resp(400, {'error': 'Укажите стикер'})
            cur.execute(
                "DELETE FROM stocktake_scans WHERE stocktake_id = %s AND storage_barcode = %s",
                (int(stocktake_id), barcode),
            )
            conn.commit()
            return _resp(200, {'success': True})

        if action == 'close':
            if actor_role not in STOREKEEPER_ROLES:
                return _resp(403, {'error': 'Закрывает инвентаризацию кладовщик'})
            stocktake_id = body_data.get('stocktakeId')
            if not stocktake_id:
                return _resp(400, {'error': 'Укажите инвентаризацию'})
            cur.execute("SELECT status FROM stocktakes WHERE id = %s", (int(stocktake_id),))
            st_row = cur.fetchone()
            if not st_row:
                return _resp(404, {'error': 'Инвентаризация не найдена'})
            if st_row[0] not in ('in_progress', 'rejected'):
                return _resp(409, {'error': 'Инвентаризация уже закрыта'})

            # Итоги фиксируем в момент закрытия: дальше склад живёт своей жизнью,
            # а админ должен видеть ровно то, что насчитал кладовщик.
            report = build_report(cur, stocktake_id)
            cur.execute(
                "UPDATE stocktakes SET status = 'pending_approval', closed_at = now(), "
                "  note = %s, expected_count = %s, found_count = %s, "
                "  missing_count = %s, extra_count = %s "
                "WHERE id = %s",
                (
                    (body_data.get('note') or '').strip() or None,
                    report['expected'], report['foundCount'],
                    report['missingCount'], len(report['extra']),
                    int(stocktake_id),
                ),
            )
            log_action(
                cur, actor_id, actor_name, 'stocktake_close', stocktake_id,
                f'Инвентаризация закрыта и отправлена на подтверждение: '
                f'найдено {report["foundCount"]} из {report["expected"]}, '
                f'недостача {report["missingCount"]}',
            )
            conn.commit()
            return _resp(200, {'success': True, 'missingCount': report['missingCount']})

        if action == 'approve':
            # Утилизация недостачи — только админ. Кладовщик считает, админ отвечает
            # за списание: иначе пропавший товар можно было бы убрать со склада
            # молча, тем же человеком, который его потерял.
            if actor_role != 'admin':
                return _resp(403, {'error': 'Подтвердить инвентаризацию может только администратор'})
            stocktake_id = body_data.get('stocktakeId')
            if not stocktake_id:
                return _resp(400, {'error': 'Укажите инвентаризацию'})
            cur.execute("SELECT status FROM stocktakes WHERE id = %s", (int(stocktake_id),))
            st_row = cur.fetchone()
            if not st_row:
                return _resp(404, {'error': 'Инвентаризация не найдена'})
            if st_row[0] != 'pending_approval':
                return _resp(409, {'error': 'Инвентаризация не ждёт подтверждения'})

            report = build_report(cur, stocktake_id)

            # Подтверждение списывает товар со склада безвозвратно, поэтому админ
            # обязан явно назвать число списываемых вещей (confirmMissing). Если
            # оно разошлось с расчётом — значит, склад изменился с момента закрытия
            # или запрос отправлен вслепую: останавливаемся и показываем реальную
            # цифру. Без этой сверки одно случайное обращение к адресу функции
            # списывает весь склад.
            confirm_missing = body_data.get('confirmMissing')
            if confirm_missing is None or int(confirm_missing) != report['missingCount']:
                return _resp(409, {
                    'error': f'Подтвердите списание: не найдено {report["missingCount"]} вещей',
                    'missingCount': report['missingCount'],
                    'needConfirm': True,
                })

            # 1. Ненайденные вещи списываем: физически их на складе нет.
            disposed = 0
            for m in report['missing']:
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'lost', "
                    "  lost_reason = %s, lost_at = now(), "
                    "  dispose_reason = %s, disposed_at = now(), disposed_by = %s, "
                    "  shelf_id = NULL, reserved_order_id = NULL, matched_at = NULL "
                    "WHERE id = %s",
                    (
                        f'Не найдена при инвентаризации №{stocktake_id}',
                        f'Утилизирована по инвентаризации №{stocktake_id}',
                        int(actor_id) if actor_id else None,
                        int(m['goodsWarehouseId']),
                    ),
                )
                disposed += 1

            # 2. Вещи, найденные на чужой полке, переставляем по факту: пересчёт
            #    заодно наводит порядок в адресах хранения.
            cur.execute(
                "UPDATE goods_warehouse gw SET shelf_id = s.shelf_id "
                "FROM stocktake_scans s "
                "WHERE s.stocktake_id = %s AND s.goods_warehouse_id = gw.id "
                "  AND s.shelf_id IS NOT NULL AND gw.shelf_id IS DISTINCT FROM s.shelf_id "
                "RETURNING gw.id",
                (int(stocktake_id),),
            )
            moved = len(cur.fetchall())

            cur.execute(
                "UPDATE stocktakes SET status = 'approved', approved_at = now(), "
                "  approved_by = %s, approved_by_name = %s, missing_count = %s "
                "WHERE id = %s",
                (int(actor_id) if actor_id else None, actor_name,
                 report['missingCount'], int(stocktake_id)),
            )
            log_action(
                cur, actor_id, actor_name, 'stocktake_approve', stocktake_id,
                f'Инвентаризация подтверждена: списано ненайденных {disposed}, '
                f'переставлено на верные полки {moved}',
            )
            conn.commit()
            return _resp(200, {'success': True, 'disposed': disposed, 'moved': moved})

        if action == 'reject':
            if actor_role != 'admin':
                return _resp(403, {'error': 'Вернуть на пересчёт может только администратор'})
            stocktake_id = body_data.get('stocktakeId')
            reason = (body_data.get('reason') or '').strip()
            if not stocktake_id or not reason:
                return _resp(400, {'error': 'Укажите причину возврата на пересчёт'})
            cur.execute(
                "UPDATE stocktakes SET status = 'rejected', reject_reason = %s, closed_at = NULL "
                "WHERE id = %s AND status = 'pending_approval'",
                (reason, int(stocktake_id)),
            )
            log_action(
                cur, actor_id, actor_name, 'stocktake_reject', stocktake_id,
                f'Инвентаризация возвращена на пересчёт: {reason}',
            )
            conn.commit()
            return _resp(200, {'success': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()