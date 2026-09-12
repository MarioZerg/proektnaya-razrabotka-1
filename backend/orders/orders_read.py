"""Конвейер заказов — чтение: список конвейера, карточка заказа,
таймеры пошива и предпросмотр следующего стека закройщика.

Вынесено из index.py как есть: тело GET-ветки перенесено целиком, отступ снят
на один уровень. Логика и порядок проверок не менялись.
"""

import json

import psycopg2

from shared import (
    CANCELLED_ORDERS_LIMIT,
    CANCELLED_SQL,
    CLOSED_ORDERS_LIMIT,
    _fit_orders_body,
    get_setting_int,
    sewing_wait_for_order,
)


def handle_get(event: dict, headers: dict, dsn: str) -> dict:
    """Читающая часть конвейера: что показать цеху и менеджеру."""
    params = event.get('queryStringParameters') or {}
    order_id = params.get('id')
    # Чью историю показываем. Производственник на вкладке «Готовые» смотрит
    # СВОЮ выработку, и брать ради этого общий архив бессмысленно.
    try:
        history_for = int(params.get('historyFor') or 0)
    except (TypeError, ValueError):
        history_for = 0
    history_role = (params.get('historyRole') or '').strip()


    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        # Сколько ещё шить каждую вещь, взятую швеёй в работу.
        #
        # Лёгкий запрос без побочных эффектов: фронт спрашивает его при открытии
        # страницы и дальше тикает сам по nextAt, не дёргая сервер каждую секунду.
        # По этим числам блокируются кнопки «Отправить на стикеровку» у конкретных
        # заказов — швея видит, сколько осталось, а не гадает.
        if params.get('sewingWaits') and params.get('userId'):
            waits_user_id = int(params['userId'])
            cur.execute(
                "SELECT workshop_id FROM shift_sessions "
                "WHERE user_id = %s AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
                (waits_user_id,),
            )
            ws_row = cur.fetchone()
            session_ws = ws_row[0] if ws_row else None

            # Все вещи «В работе» у этой швеи. Цех берём у заказа, а если он не
            # проставлен (FBO мимо раскроя) — из её открытой смены.
            cur.execute(
                "SELECT id, width, workshop_id, taken_at FROM orders "
                "WHERE assigned_user_id = %s AND sewing_status = 'В работе'",
                (waits_user_id,),
            )
            waits = {}
            in_work_count = 0
            for w_id, w_width, w_ws, w_taken in cur.fetchall():
                in_work_count += 1
                w_sec, w_next = sewing_wait_for_order(
                    cur, w_ws or session_ws, w_width, w_taken
                )
                if w_sec > 0:
                    waits[str(w_id)] = {'waitSeconds': w_sec, 'nextAt': w_next}

            # Лимит заказов на руках отдаём фронту: по нему кнопка «Получить заказ»
            # показывает замочек, не дёргая сервер впустую. Проверку всё равно делает
            # сервер при взятии — это только подсказка для глаз.
            max_orders = get_setting_int(
                cur, session_ws, 'max_quantity_orders_to_seamstress', 0
            )
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'waits': waits,
                    'shiftOpen': ws_row is not None,
                    'inWork': in_work_count,
                    'maxOrders': max_orders,
                }),
            }

        # Предпросмотр очереди для закройщика: что лежит следующим для его цеха.
        # Ничего не занимает и не меняет — просто заглядывает в очередь, чтобы
        # закройщик заранее знал, получит он связку Яндекса или обычный стек.
        if params.get('stackPreview') and params.get('workshopId'):
            preview_workshop_id = int(params['workshopId'])

            # Предел заказов на руках у закройщика. Читаем сразу: он нужен
            # фронту в ЛЮБОМ ответе — по нему кнопка «Взять 1 заказ» решает,
            # можно ли добирать. Раньше при пустой очереди лимит не приходил,
            # и кнопка не знала, что делать.
            cur.execute(
                "SELECT value FROM workshop_settings WHERE workshop_id = %s "
                "AND key = 'max_quantity_orders_to_cutter'",
                (preview_workshop_id,),
            )
            ps_row = cur.fetchone()
            if not ps_row:
                cur.execute(
                    "SELECT value FROM system_settings WHERE key = 'max_quantity_orders_to_cutter'"
                )
                ps_row = cur.fetchone()
            p_stack_size = int(ps_row[0]) if ps_row and ps_row[0] else 20

            cur.execute(
                "SELECT allowed_materials FROM workshops WHERE id = %s", (preview_workshop_id,)
            )
            pw_row = cur.fetchone()
            p_allowed = pw_row[0] if pw_row and pw_row[0] else []
            if isinstance(p_allowed, str):
                p_allowed = json.loads(p_allowed or '[]')
            if not p_allowed:
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'kind': 'none', 'count': 0,
                                        'cutterLimit': p_stack_size}),
                }
            p_ids_csv = ','.join(str(int(i)) for i in p_allowed)
            cur.execute("SELECT name FROM materials WHERE id IN (" + p_ids_csv + ")")
            p_names = [r[0] for r in cur.fetchall()]
            if not p_names:
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'kind': 'none', 'count': 0,
                                        'cutterLimit': p_stack_size}),
                }
            p_names_csv = ','.join("'" + n.replace("'", "''") + "'" for n in p_names)
            # Порядок ТОЧНО такой же, как при реальной выдаче стека — иначе предпросмотр
            # показывал бы одно, а выдавалось другое.
            cur.execute(
                "SELECT id, group_key, group_size FROM orders WHERE sewing_status = 'Новый' "
                "AND fulfilled_from_stock_id IS NULL "
                "AND COALESCE(status, '') <> 'Отменён' "
                "AND material IN (" + p_names_csv + ") "
                "ORDER BY (order_type = 'FBS') DESC, "
                "COALESCE(marketplace_created_at, created_at) ASC, "
                "group_key NULLS FIRST, group_position ASC NULLS LAST, id ASC LIMIT %s",
                (p_stack_size,),
            )
            p_rows = cur.fetchall()
            if not p_rows:
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'kind': 'none', 'count': 0,
                                        'cutterLimit': p_stack_size}),
                }
            # Связкой считаем только заказ от ДВУХ вещей — как и при реальной выдаче.
            # Одиночные заказы Яндекса идут в обычный стек.
            p_group_key = next(
                (r[1] for r in p_rows if r[1] and (r[2] or 1) > 1), None
            )
            if p_group_key:
                cur.execute(
                    "SELECT COUNT(*) FROM orders WHERE sewing_status = 'Новый' "
                    "AND fulfilled_from_stock_id IS NULL "
                    "AND COALESCE(status, '') <> 'Отменён' "
                    "AND group_key = %s AND material IN (" + p_names_csv + ")",
                    (p_group_key,),
                )
                p_count = cur.fetchone()[0]
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'kind': 'group', 'count': p_count,
                                        'cutterLimit': p_stack_size}),
                }
            # Предел заказов на руках отдаём фронту: по нему кнопка «Взять 1
            # заказ» понимает, можно ли ещё добирать, и не гоняет сервер зря.
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'kind': 'stack', 'count': len(p_rows),
                                    'cutterLimit': p_stack_size}),
            }

        if order_id:
            cur.execute(
                # Кластер берём из поставки, если в заказе он не заполнен. Кластер —
                # это склад приёмки FBO, и печатается он на стикере: по нему вещь
                # сортируют. У заказов, загруженных из заявки OZON FBO, поле в самом
                # заказе пустое, а кластер задан у поставки — на стикере получалась
                # пустая строка, и вещь ехала без адреса приёмки.
                "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.status, "
                "COALESCE(o.cluster, sup.cluster), o.product, "
                "o.quantity, o.source, o.created_at, o.completed_at, o.material, o.width, o.height, "
                "o.sewing_status, o.assigned_user_id, u.full_name, o.workshop_id, w.name, "
                "o.cutter_user_id, cu.full_name, o.hanger_number, "
                "o.sewer_user_id, su.full_name, o.packer_user_id, pu.full_name, "
                # Код товара для стикера FBO. У заказов, перенесённых из старой
                # системы, поля в самом заказе пустые — код лежит в привязанной
                # карточке товара (marketplace_items). Без этой подстановки на
                # терминале печаталось «Код товара не загружен — привяжите товар»,
                # хотя товар привязан и код в системе есть.
                "COALESCE(o.product_barcode, mi.barcode), "
                "o.marketplace_item_id, COALESCE(o.product_ozon_sku, mi.ozon_sku), "
                "u.last_hanger_number, "
                "o.group_key, o.group_size, o.group_position, "
                "(SELECT h.name FROM hangers h WHERE h.number = o.hanger_number), "
                # Этап оверлока. Запятой после последнего поля быть не должно —
                # дальше идёт FROM.
                "o.requires_overlock, o.overlocked_at "
                "FROM orders o "
                "LEFT JOIN users u ON u.id = o.assigned_user_id "
                "LEFT JOIN workshops w ON w.id = o.workshop_id "
                "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                "LEFT JOIN users su ON su.id = o.sewer_user_id "
                "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                "LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
                "LEFT JOIN marketplace_supplies sup ON sup.id = o.supply_id "
                "WHERE o.id = %s",
                (int(order_id),),
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}

            cur.execute(
                "SELECT omu.id, omu.material_id, m.name, m.unit, omu.roll_id, r.barcode, omu.quantity, omu.created_at "
                "FROM order_material_usage omu "
                "LEFT JOIN materials m ON m.id = omu.material_id "
                "LEFT JOIN rolls r ON r.id = omu.roll_id "
                "WHERE omu.order_id = %s ORDER BY omu.id",
                (int(order_id),),
            )
            materialUsage = [
                {
                    'id': r[0],
                    'materialId': r[1],
                    'materialName': r[2],
                    'unit': r[3],
                    'rollId': r[4],
                    'rollBarcode': r[5],
                    'quantity': float(r[6]),
                    'createdAt': r[7].isoformat() + 'Z',
                }
                for r in cur.fetchall()
            ]

            material_name, width_val, height_val = row[11], row[12], row[13]
            required_fabric_material_id = None
            required_fabric_material_name = None
            required_trim_material_id = None
            required_trim_material_name = None
            if material_name and width_val and height_val:
                cur.execute(
                    "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
                    (material_name, width_val, height_val),
                )
                mi_row = cur.fetchone()
                if mi_row:
                    cur.execute(
                        "SELECT m.id, m.name, mt.name FROM marketplace_item_materials mim "
                        "JOIN materials m ON m.id = mim.material_id "
                        "JOIN material_types mt ON mt.id = m.type_id "
                        "WHERE mim.marketplace_item_id = %s",
                        (mi_row[0],),
                    )
                    for mat_id, mat_name, mat_type_name in cur.fetchall():
                        if mat_type_name == 'Тюль' and required_fabric_material_id is None:
                            required_fabric_material_id = mat_id
                            required_fabric_material_name = mat_name
                        elif mat_type_name == 'Аксессуары' and required_trim_material_id is None:
                            required_trim_material_id = mat_id
                            required_trim_material_name = mat_name

            detail = {
                'id': row[0],
                'orderNumber': row[1],
                'marketplace': row[2],
                'orderType': row[3],
                'status': row[4],
                'cluster': row[5],
                'product': row[6],
                'quantity': float(row[7]),
                'source': row[8],
                'createdAt': row[9].isoformat() + 'Z',
                'completedAt': (row[10].isoformat() + 'Z') if row[10] else None,
                'material': row[11],
                'width': row[12],
                'height': row[13],
                'sewingStatus': row[14],
                'assignedUserId': row[15],
                'assignedUserName': row[16],
                'workshopId': row[17],
                'workshopName': row[18],
                'cutterUserId': row[19],
                'cutterUserName': row[20],
                'hangerNumber': row[21],
                # Название вешалки («Синяя у окна»). Пустое — в интерфейсе
                # покажется номер, как было раньше.
                'hangerName': row[-3],
                # Этап оверлока: нужна ли обмётка и прошла ли вещь этот этап.
                'requiresOverlock': bool(row[-2]),
                'overlockedAt': (row[-1].isoformat() + 'Z') if row[-1] else None,
                'sewerUserId': row[22],
                'sewerUserName': row[23],
                'packerUserId': row[24],
                'packerUserName': row[25],
                'productBarcode': row[26],
                'marketplaceItemId': row[27],
                'productOzonSku': row[28],
                'lastHangerNumber': row[29],
                'materialUsage': materialUsage,
                'requiredFabricMaterialId': required_fabric_material_id,
                'requiredFabricMaterialName': required_fabric_material_name,
                'requiredTrimMaterialId': required_trim_material_id,
                'requiredTrimMaterialName': required_trim_material_name,
                # Вещи одного заказа покупателя (Яндекс Маркет) идут по цеху вместе —
                # показываем «1 из 3», чтобы швея видела, что заказ ещё не закончен.
                'groupKey': row[30],
                'groupSize': row[31],
                'groupPosition': row[32],
            }
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'order': detail})}

        # ИСТОРИЯ — ТОЛЬКО СВОЯ, ЕСЛИ СПРАШИВАЕТ ПРОИЗВОДСТВЕННИК.
        #
        # Общий архив закрытых заказов делится между всеми: в лимит попадают
        # свежие заказы ВСЕГО цеха, а швея на вкладке «Готовые» видит только
        # свои. На практике это значило, что её выработка обрывалась на
        # нескольких днях — остальное место в лимите занимали чужие заказы,
        # которые ей всё равно не показывались. Швея с семью сотнями заказов
        # за месяц видела около двух сотен и считала, что работа пропала.
        #
        # Спрашиваем историю по исполнителю: швея — по своему пошиву,
        # закройщик — по своему раскрою. Тогда весь лимит достаётся ему
        # одному, и выработка видна за куда больший срок.
        history_filter = ""
        if history_for and history_role == 'sewer':
            history_filter = f"  AND sewer_user_id = {history_for} "
        elif history_for and history_role == 'cutter':
            history_filter = f"  AND cutter_user_id = {history_for} "

        cur.execute(
            # Активные заказы отдаём ВСЕ, историю — только свежую часть.
            #
            # Раньше и те и другие делили один лимит: закрытых заказов копится по
            # сотне в день, и они рано или поздно вытеснили бы рабочие — цех перестал
            # бы видеть то, что нужно шить. Здесь список свежих закрытых считается
            # ОТДЕЛЬНО и подмешивается к активным, поэтому история физически не может
            # отобрать место у работы.
            # ОТМЕНУ ВИДИТ МАРКЕТПЛЕЙС, А НЕ МЫ.
            #
            # Покупатель отменяет заказ на площадке, и у нас это приезжает в
            # ozon_status='cancelled' (или ym_status). А наш status при этом
            # остаётся прежним — «Новый», «Отгружен», какой был.
            #
            # Вкладка «Отменённые» смотрела только на наш status и потому была
            # почти пустой: по нашему полю отменённых 149, а по статусам площадок
            # — 1416. Десять из одиннадцати отмен не видел никто.
            #
            # Теперь признак отмены считаем одинаково во всех трёх местах запроса:
            # он один на весь список.
            "WITH recent_closed AS ("
            "  SELECT id FROM orders o WHERE o.sewing_status IN ('Готовые', 'Со склада') "
            f"    AND NOT ({CANCELLED_SQL}) "
            + history_filter +
            f"  ORDER BY id DESC LIMIT {CLOSED_ORDERS_LIMIT}"
            "), "
            # ОТМЕНЁННЫЕ ТОЖЕ РЕЖЕМ ПО СВЕЖЕСТИ.
            #
            # Раньше они отдавались ВСЕ и мимо лимита — казалось, что их немного.
            # Но считались отменёнными только по нашему полю (149 штук), а как
            # только стали учитывать статусы площадок, их оказалось 1416, и ответ
            # перевалил за 3.5 МБ — платформа обрывает такой, и раздел переставал
            # открываться совсем.
            #
            # Свежие отмены нужны для разбора, полугодовой давности — нет.
            "recent_cancelled AS ("
            f"  SELECT id FROM orders o WHERE ({CANCELLED_SQL}) "
            + history_filter +
            f"  ORDER BY id DESC LIMIT {CANCELLED_ORDERS_LIMIT}"
            ") "
            # Историю режем заранее (CTE выше), поэтому здесь обычная выборка —
            # порядок и состав полей не меняются.
            "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.status, o.cluster, o.product, "
            "o.quantity, o.source, o.created_at, o.completed_at, o.material, o.width, o.height, "
            "o.sewing_status, o.assigned_user_id, u.full_name, o.workshop_id, w.name, "
            "o.cutter_user_id, cu.full_name, o.hanger_number, "
            "o.sewer_user_id, su.full_name, o.packer_user_id, pu.full_name, "
            "o.ozon_status, o.ozon_posting_number, "
            # Код товара берём из заказа, а если там пусто (заказы из старой
            # системы) — из привязанной карточки товара.
            "COALESCE(o.product_barcode, mi.barcode), "
            "COALESCE(o.product_ozon_sku, mi.ozon_sku), "
            "o.marketplace_created_at, o.group_key, o.group_size, o.group_position, "
            # Заказ юридического лица (B2B с OZON): цех должен видеть пометку прямо
            # в списке, а реквизиты компании — в карточке заказа.
            "o.is_legal_entity, o.legal_company_name, o.legal_inn, "
            # Реальный расход ткани на одно изделие из карточки товара: он включает
            # запас на подгибку и потому больше «чистой» ширины. Именно эту цифру
            # кладовщик должен видеть в сводке — столько ткани уйдёт со склада.
            "(SELECT mim.quantity FROM marketplace_items fmi "
            " JOIN marketplace_item_materials mim ON mim.marketplace_item_id = fmi.id "
            " JOIN materials mm ON mm.id = mim.material_id "
            " JOIN material_types mmt ON mmt.id = mm.type_id "
            " WHERE mmt.name = 'Тюль' AND fmi.material = o.material "
            "   AND fmi.width = o.width AND fmi.height = o.height LIMIT 1) AS fabric_per_item, "
            # Когда вещь реально раскроили и отшили. По этим датам закройщик и швея
            # сверяют свою выработку за смену или неделю: дата заказа покупателя для
            # этого не годится — заказ мог пролежать в очереди неделю.
            "o.cut_at, o.sewn_at, "
            # Название вешалки — последним полем, чтобы не сдвигать индексы
            # остальных колонок (их читают по номерам).
            "(SELECT h.name FROM hangers h WHERE h.number = o.hanger_number), "
            # Магазин заказа: цех общий, но швея должна видеть, чью вещь
            # шьёт — у МЕГАТЮЛЬ и ДЮНА разные упаковка и вложения.
            "shp.name, shp.color, "
            # ЭТАП ОВЕРЛОКА. requires_overlock проставляется на раскрое по
            # признаку ткани; overlocked_at заполняется, когда край обметали.
            # По паре этих полей конвейер понимает, где вещь в маршруте:
            # ждёт оверлок, уже обработана или этап ей вообще не нужен.
            "o.requires_overlock, o.overlocked_at, o.overlock_user_id, ou.full_name, "
            # ОТМЕНА — ГОТОВЫМ ПРИЗНАКОМ, А НЕ РАЗБОРОМ СТАТУСОВ НА ЭКРАНЕ.
            #
            # У каждой площадки своё слово для отмены, и держать этот разбор на
            # фронте — значит рано или поздно забыть там очередной статус. Считаем
            # один раз здесь, тем же условием, что и выборка выше.
            #
            # Поле идёт ПОСЛЕДНИМ: остальные колонки читаются по номерам с конца
            # (r[-1], r[-2] …), и вставка в середину сдвинула бы их все.
            f"({CANCELLED_SQL}) AS is_cancelled "
            "FROM orders o "
            "LEFT JOIN users u ON u.id = o.assigned_user_id "
            "LEFT JOIN workshops w ON w.id = o.workshop_id "
            "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
            "LEFT JOIN users su ON su.id = o.sewer_user_id "
            "LEFT JOIN users pu ON pu.id = o.packer_user_id "
            "LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
            "LEFT JOIN shops shp ON shp.id = o.shop_id "
            "LEFT JOIN users ou ON ou.id = o.overlock_user_id "
            # Берём все активные заказы и только свежую часть истории (см. CTE выше).
            "WHERE o.sewing_status NOT IN ('Готовые', 'Со склада') "
            "   OR o.id IN (SELECT id FROM recent_closed) "
            # Отменённые отдаём ВСЕ и мимо лимита истории. Их немного (сотня-другая
            # против десятков тысяч закрытых), а вкладка «Отменённые» должна давать
            # полную картину: по ней разбирают, за что мы платим маркетплейсу.
            # Раньше отменённый заказ, успевший стать «Готовым» или «Со склада»,
            # делил общий лимит с историей и с её ростом просто исчезал из списка.
            "   OR o.id IN (SELECT id FROM recent_cancelled) "
            # Сверху — самые давние заказы покупателей: они горят и разбираются
            # первыми. Раньше сортировали по дате загрузки к нам и по убыванию,
            # из-за чего список заказов шёл в обратном порядке относительно
            # очереди конвейера. Дата загрузки для очереди вообще не годится:
            # заказы приезжают из маркетплейса пачками, и у сотни заказов она
            # одинаковая. У ручных заказов даты покупателя нет — берём нашу.
            #
            # Сначала активные заказы, потом закрытые («Готовые» и «Со склада»).
            # Лимит режет хвост списка, поэтому порядок групп важен: без него
            # обрезались бы рабочие заказы, а история оставалась.
            #
            # ВНУТРИ ГРУПП порядок РАЗНЫЙ, и это принципиально:
            #  - активные — самые давние сверху: это очередь конвейера, старые горят;
            #  - закрытые — самые СВЕЖИЕ сверху (по номеру заказа: чем больше номер,
            #    тем позже вещь завели). Раньше и здесь шли давние, и лимит съедал
            #    как раз недавно отшитые вещи: закрытых заказов больше тысячи, в
            #    список попадала древняя история, а вещь, застикерованная вчера, на
            #    вкладке «Готовые» не находилась вообще — кладовщик искал товар,
            #    который система «потеряла», хотя он лежал в контейнере.
            # Активные заказы отдаём ВСЕ, закрытые — только свежую часть.
            #
            # Раньше и те и другие делили один лимит: закрытых копится по сотне в
            # день, и они рано или поздно вытеснили бы рабочие заказы — цех перестал
            # бы видеть то, что нужно шить. Оконная нумерация внутри каждой группы
            # позволяет ограничить ТОЛЬКО историю, не трогая работу.
            #
            # ВНУТРИ ГРУПП порядок РАЗНЫЙ, и это принципиально:
            #  - активные — самые давние сверху: это очередь конвейера, старые горят;
            #  - закрытые — самые СВЕЖИЕ сверху: кладовщику нужна вещь, застикерованная
            #    вчера, а не древняя история.
            "ORDER BY (o.sewing_status IN ('Готовые', 'Со склада')) ASC, "
            "CASE WHEN o.sewing_status IN ('Готовые', 'Со склада') THEN NULL "
            "     ELSE COALESCE(o.marketplace_created_at, o.created_at) END ASC, "
            "CASE WHEN o.sewing_status IN ('Готовые', 'Со склада') "
            "     THEN o.id END DESC, "
            "o.id ASC"
        )
        orders = [
            {
                'id': r[0],
                'orderNumber': r[1],
                'marketplace': r[2],
                'orderType': r[3],
                'status': r[4],
                'cluster': r[5],
                'product': r[6],
                'quantity': float(r[7]),
                'source': r[8],
                'createdAt': r[9].isoformat() + 'Z',
                'completedAt': (r[10].isoformat() + 'Z') if r[10] else None,
                'material': r[11],
                'width': r[12],
                'height': r[13],
                'sewingStatus': r[14],
                'assignedUserId': r[15],
                'assignedUserName': r[16],
                'workshopId': r[17],
                'workshopName': r[18],
                'cutterUserId': r[19],
                'cutterUserName': r[20],
                'hangerNumber': r[21],
                # Хвост списка колонок: вешалка, магазин с цветом и этап
                # оверлока. Отсчёт с конца, потому что колонок много и
                # номера легко сбить.
                'hangerName': r[-8],
                'shopName': r[-7],
                'shopColor': r[-6],
                # Этап оверлока: нужен ли он вещи и прошла ли она его.
                'requiresOverlock': bool(r[-5]) or None,
                'overlockedAt': (r[-4].isoformat() + 'Z') if r[-4] else None,
                'overlockUserId': r[-3],
                'overlockUserName': r[-2],
                # Отмена покупателем — уже посчитанный признак: у каждой
                # площадки своё слово для отмены, и разбирать их на экране
                # значит однажды забыть очередное.
                'isCancelled': bool(r[-1]) or None,
                'sewerUserId': r[22],
                'sewerUserName': r[23],
                'packerUserId': r[24],
                'packerUserName': r[25],
                'ozonStatus': r[26],
                'ozonPostingNumber': r[27],
                'productBarcode': r[28],
                'productOzonSku': r[29],
                'marketplaceCreatedAt': (r[30].isoformat() + 'Z') if r[30] else None,
                # Заказ покупателя из нескольких вещей (Яндекс Маркет): вещи связаны общим
                # ключом и едут по цеху вместе — в интерфейсе показываем «1 из 3».
                'groupKey': r[31],
                'groupSize': r[32],
                'groupPosition': r[33],
                # Сколько ткани реально уйдёт со склада на одно изделие (с запасом на
                # подгибку). None — если карточка товара с таким размером не заведена.
                'isLegalEntity': bool(r[34]),
                'legalCompanyName': r[35],
                'legalInn': r[36],
                'fabricPerItem': float(r[37]) if r[37] is not None else None,
                'cutAt': (r[38].isoformat() + 'Z') if r[38] else None,
                'sewnAt': (r[39].isoformat() + 'Z') if r[39] else None,
            }
            for r in cur.fetchall()
        ]

        # Выбрасываем пустые поля из ответа.
        #
        # У заказа 40 полей, но у большинства половина из них пустая: кластер, связка
        # Яндекса, реквизиты юрлица, имена швеи и упаковщицы у ещё не сшитых вещей.
        # Пустое поле всё равно занимает место в каждой из полутора тысяч строк —
        # это сотни килобайт на пустоту, которые едут на планшет в цех по мобильному
        # интернету при каждом открытии страницы.
        #
        # Для получателя ничего не меняется: отсутствующее поле читается так же,
        # как пустое, — интерфейс везде проверяет значение на пустоту.
        orders = [
            {k: v for k, v in o.items() if v is not None and v != ''}
            for o in orders
        ]
    finally:
        conn.close()

    body = _fit_orders_body(orders)
    return {'statusCode': 200, 'headers': headers, 'body': body}
