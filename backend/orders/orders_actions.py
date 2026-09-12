"""Конвейер заказов — действия: взятие стека, раскрой, пошив, стикеровка,
оверлок, отмена и удаление заказа.

Вынесено из index.py как есть: тело POST-ветки перенесено целиком, отступ снят
на один уровень. Логика, порядок проверок и тексты ответов не менялись.
"""

import json

import psycopg2

from shared import (
    GROUP_CUT_BATCH,
    STATUS_ORDER,
    apply_penalty,
    award_variki,
    can_work_as,
    format_wait,
    get_setting,
    get_setting_float,
    get_setting_int,
    log_action,
    ozon_cutoff_passed,
    sewing_wait_for_order,
    write_off_materials_once,
)


def handle_post(event: dict, headers: dict, dsn: str) -> dict:
    """Действия конвейера: всё, что двигает заказ по этапам."""
    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    actor_id = body_data.get('actorId')
    actor_name = body_data.get('actorName')

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        if action == 'take_stack':
            user_id = body_data.get('userId')
            workshop_id = body_data.get('workshopId')
            shift_number = body_data.get('shiftNumber')
            # «Взять 1 заказ» — режим для добора одной вещи, когда полный стек брать
            # незачем (конец смены, доделать остаток ткани). Связки Яндекса в этом
            # режиме пропускаем: заказ покупателя из нескольких вещей раскраивается
            # только целиком, поштучно его разрывать нельзя — вещи разъедутся по цеху
            # и отгрузить заказ будет нечем. Поэтому берём следующий ОДИНОЧНЫЙ заказ.
            single_mode = bool(body_data.get('single'))

            if not user_id or not workshop_id:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Укажите userId и workshopId'}),
                }

            # Брать работу с конвейера можно только на открытой смене — иначе выработка
            # и зарплата повиснут вне смены, а в цехе будет непонятно, кто работает.
            cur.execute(
                "SELECT id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL LIMIT 1",
                (int(user_id),),
            )
            if not cur.fetchone():
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Смена не открыта — откройте смену на терминале в цехе'}),
                }

            cur.execute(
                "SELECT COUNT(*) FROM orders WHERE assigned_user_id = %s AND sewing_status = 'На раскрое'",
                (int(user_id),),
            )
            unfinished = cur.fetchone()[0]

            cur.execute(
                "SELECT value FROM workshop_settings WHERE workshop_id = %s AND key = 'max_quantity_orders_to_cutter'",
                (int(workshop_id),),
            )
            row = cur.fetchone()
            if not row:
                cur.execute(
                    "SELECT value FROM system_settings WHERE key = 'max_quantity_orders_to_cutter'"
                )
                row = cur.fetchone()
            stack_size = int(row[0]) if row and row[0] else 20

            if single_mode:
                # «Взять 1 заказ» — добор поштучно ДО общего лимита закройщика.
                #
                # Раньше любой незакрытый заказ полностью запирал кнопку: взял стек,
                # раскроил половину — и добрать одну вещь под остаток рулона уже
                # нельзя, пока не закроешь всё до последнего. Закройщики упирались в
                # это каждый день: ткань на столе есть, работа стоит.
                #
                # Теперь считаем не «есть ли незакрытые», а сколько их: пока на руках
                # меньше лимита — можно добирать по одной. Сам лимит остаётся прежним
                # (max_quantity_orders_to_cutter, сейчас 20): он защищает от того,
                # чтобы один человек не разобрал всю очередь цеха.
                if unfinished >= stack_size:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'У вас уже {unfinished} нераскроенных заказов — '
                                     f'это предел ({stack_size} шт.). Раскроите часть, '
                                     f'и можно будет добрать ещё'
                        }, ensure_ascii=False),
                    }
                stack_size = 1
            elif unfinished > 0:
                # Стек берётся только «с чистого листа»: иначе на закройщике окажется
                # два десятка заказов поверх недоделанных, и очередь цеха встанет.
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'У вас есть {unfinished} нераскроенных заказов — '
                                 f'раскроите их или добирайте по одному кнопкой '
                                 f'«Взять 1 заказ»'
                    }, ensure_ascii=False),
                }

            # Остаток лимита метража на смену. Раньше стек выдавался целиком, не глядя
            # на лимит: закройщик с 490 из 500 пог.м. получал ещё 20 заказов, кроил один
            # и упирался в «лимит исчерпан» — остальные 19 висели на нём нераскроенными
            # и блокировали работу (взять новый стек нельзя, пока есть незакрытые).
            # Теперь считаем, сколько метров осталось, и отдаём ровно столько заказов,
            # сколько в него влезает. Дальше закройщик добирает по одному сам.
            # Лимит действует только на открытой смене — как и его проверка при раскрое.
            cutter_meters_left = None
            cur.execute(
                "SELECT opened_at FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                "ORDER BY opened_at DESC LIMIT 1",
                (int(user_id),),
            )
            shift_row = cur.fetchone()
            if shift_row:
                daily_limit = get_setting_float(cur, int(workshop_id), 'cutter_daily_limit', 0)
                if daily_limit > 0:
                    # Метраж считаем ТЕМ ЖЕ запросом, что и проверка при раскрое, —
                    # иначе выдача и проверка разошлись бы, и человек снова упирался
                    # бы в отказ на заказе, который система ему сама и выдала.
                    cur.execute(
                        "SELECT COALESCE(SUM(width), 0) FROM orders WHERE assigned_user_id = %s "
                        "AND sewing_status IN ('Раскроено', 'В работе', 'Стикеровка', 'Готовые') "
                        "AND cut_at >= %s",
                        (int(user_id), shift_row[0]),
                    )
                    cut_meters = float(cur.fetchone()[0] or 0) / 100
                    cutter_meters_left = daily_limit - cut_meters
                    if cutter_meters_left <= 0:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Лимит метража на смену исчерпан: '
                                         f'{round(cut_meters, 2)}/{daily_limit} пог.м.'
                            }, ensure_ascii=False),
                        }

            # Цех берёт в раскрой только заказы на РАЗРЕШЁННЫЕ ему материалы
            # (workshops.allowed_materials — список id материалов, отмеченных в настройках
            # цеха галочками). Заказ хранит материал текстом (orders.material), поэтому
            # сопоставляем через названия материалов из справочника. Так цеха не перебивают
            # заказы друг у друга: заказ на "Вуаль без утяжелителя" уйдёт только тому цеху,
            # которому этот материал разрешён.
            cur.execute(
                "SELECT allowed_materials FROM workshops WHERE id = %s", (int(workshop_id),)
            )
            aw_row = cur.fetchone()
            allowed_ids = aw_row[0] if aw_row and aw_row[0] else []
            if isinstance(allowed_ids, str):
                allowed_ids = json.loads(allowed_ids or '[]')

            if not allowed_ids:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Для вашего цеха не выбрано ни одного разрешённого материала — обратитесь к администратору'}),
                }

            allowed_ids_csv = ','.join(str(int(i)) for i in allowed_ids)
            cur.execute(
                "SELECT name FROM materials WHERE id IN (" + allowed_ids_csv + ")"
            )
            allowed_names = [r[0] for r in cur.fetchall()]

            if not allowed_names:
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({'error': 'Нет новых заказов для взятия в работу'}),
                }

            names_csv = ','.join("'" + n.replace("'", "''") + "'" for n in allowed_names)
            # FBS-заказы раскраиваются первыми (жёсткое правило по всему конвейеру —
            # сжатые сроки отгрузки), при равенстве — сначала самые давние заказы.
            #
            # Считаем по дате заказа У ПОКУПАТЕЛЯ (marketplace_created_at), а не по
            # дате загрузки к нам. Это принципиально: заказы приезжают из маркетплейса
            # пачками, и у сотни заказов дата загрузки одна и та же — по ней очередь
            # не выстроить. Покупатель, ждущий третий день, должен уходить в раскрой
            # раньше сегодняшнего. Для ручных заказов даты покупателя нет — берём дату
            # создания в системе.
            # FOR UPDATE SKIP LOCKED: строки блокируются на время транзакции, поэтому
            # один и тот же заказ не уйдёт одновременно двум закройщикам и не будет
            # подобран со склада, пока мы его забираем в раскрой.
            # fulfilled_from_stock_id IS NULL — заказ, уже закрытый вещью со склада,
            # шить не нужно (он ждёт стикеровки у кладовщика).
            # В режиме «взять 1 заказ» связки отсекаем прямо в запросе: иначе первой
            # в очереди могла оказаться связка, и закройщик получил бы отказ вместо
            # работы. Так он всегда получает следующий одиночный заказ по очереди.
            single_sql = (
                " AND (group_key IS NULL OR COALESCE(group_size, 1) <= 1) "
                if single_mode else " "
            )
            # Отсечка OZON действует и на раскрое: резать во второй половине дня то,
            # что всё равно не уедет сегодня, — значит копить крой впустую, пока
            # заказы WB и Яндекса ждут. Это порядок, а не запрет: кончились заказы
            # других площадок — закройщик получает OZON и работает дальше.
            cut_ozon_last_sql = (
                "(marketplace = 'OZON') ASC, "
                if ozon_cutoff_passed(cur, int(workshop_id) if workshop_id else None)
                else ""
            )
            cur.execute(
                "SELECT id, group_key, group_size, COALESCE(width, 0) FROM orders "
                "WHERE sewing_status = 'Новый' "
                "AND fulfilled_from_stock_id IS NULL "
                "AND COALESCE(status, '') <> 'Отменён' "
                "AND material IN (" + names_csv + ") "
                + single_sql +
                "ORDER BY " + cut_ozon_last_sql +
                "(order_type = 'FBS') DESC, "
                "COALESCE(marketplace_created_at, created_at) ASC, "
                "group_key NULLS FIRST, group_position ASC NULLS LAST, id ASC LIMIT %s "
                "FOR UPDATE SKIP LOCKED",
                (stack_size,),
            )
            picked = cur.fetchall()

            # Обрезаем стек по остатку лимита: набираем заказы по очереди, пока их
            # суммарная ширина влезает в оставшиеся метры. Первый заказ отдаём всегда,
            # даже если он один перекрывает остаток, — иначе при остатке в 1 метр
            # закройщик не получил бы вообще ничего и встал бы совсем.
            if cutter_meters_left is not None and picked:
                limited = []
                used = 0.0
                for row in picked:
                    row_meters = float(row[3] or 0) / 100
                    if limited and used + row_meters > cutter_meters_left:
                        break
                    limited.append(row)
                    used += row_meters
                picked = limited

            order_ids = [r[0] for r in picked]

            # НАСТОЯЩАЯ связка — заказ покупателя от ДВУХ вещей и больше. Она выдаётся
            # отдельно от обычного стека: закройщик раскраивает её целиком, вешает на
            # одну вешалку и отдаёт швее. Если подмешать к связке обычные заказы,
            # закройщик получит гору вещей, часть которых надо вешать вместе, а часть —
            # по отдельности, и связка растворится в стеке.
            #
            # Заказ Яндекса из ОДНОЙ вещи технически тоже имеет ключ группы (система
            # ставит его всем заказам Яндекса), но по сути это обычный одиночный заказ —
            # вешать вместе нечего. Такие идут в общий стек, иначе закройщик получал бы
            # одну-единственную вещь вместо полного стека.
            #
            # Дополниться позже такой заказ не может: ключ группы строится из НОМЕРА
            # заказа покупателя, а следующая покупка того же человека получает новый
            # номер — это отдельное отправление со своим ярлыком.
            first_group_key = next(
                (r[1] for r in picked if r[1] and (r[2] or 1) > 1), None
            )
            if first_group_key:
                order_ids = []

            # Заказ Яндекс Маркета из нескольких вещей едет по одному общему ярлыку, поэтому
            # его нельзя разрезать границей стека: если в стек попала часть связки, добираем
            # остальные её вещи — иначе хвост заказа уйдёт другому закройщику и вещи
            # разъедутся по цеху, а собрать их к отгрузке будет нечем.
            group_keys = {first_group_key} if first_group_key else set()
            if group_keys:
                keys_csv = ','.join("'" + k.replace("'", "''") + "'" for k in group_keys)
                cur.execute(
                    "SELECT id FROM orders WHERE sewing_status = 'Новый' "
                    "AND fulfilled_from_stock_id IS NULL "
                    "AND COALESCE(status, '') <> 'Отменён' "
                    f"AND group_key IN ({keys_csv}) "
                    "AND material IN (" + names_csv + ") "
                    "FOR UPDATE SKIP LOCKED"
                )
                order_ids = sorted({r[0] for r in cur.fetchall()} | set(order_ids))

            # ОТПРАВЛЕНИЯ ОДНОЙ ПОКУПКИ OZON — ОДНОМУ ЗАКРОЙЩИКУ.
            #
            # Покупатель OZON заказал две одинаковые шторы — приходят два
            # РАЗНЫХ отправления: 87011164-0186-1 и 87011164-0186-3. У каждого
            # свой ярлык, отгружаются они порознь, поэтому связкой Яндекса (одна
            # вешалка, один ярлык) их делать нельзя — это сломало бы отгрузку.
            #
            # Но и разъезжаться по разным закройщикам они не должны. Именно так
            # вышло 11.09: «-3» попал в стек, «-1» добрали отдельной кнопкой
            # через 12 минут. Обе вещи — Лен 300×255, обе легли на вешалку 1,
            # различить их можно было только по бирке, которой у одной не было.
            # Швеи и закройщицы час искали, где чей крой.
            #
            # Поэтому добираем в тот же стек остальные отправления этой покупки:
            # закройщик получает их разом, видит на листе «ОДНА ПОКУПКА 1/2» и
            # вешает на разные вешалки, зная, что вещи похожи.
            # В режиме «Взять 1 заказ» добор не делаем: закройщица берёт ровно
            # одну вещь под остаток ткани, и лишние ей сейчас не нужны. Бирку на
            # такую вещь терминал печатает сразу — этого достаточно.
            if order_ids and not first_group_key and not single_mode:
                ids_for_siblings = ','.join(str(int(i)) for i in order_ids)
                cur.execute(
                    "SELECT id FROM orders WHERE sewing_status = 'Новый' "
                    "AND fulfilled_from_stock_id IS NULL "
                    "AND COALESCE(status, '') <> 'Отменён' "
                    "AND marketplace = 'OZON' "
                    "AND ozon_posting_number IS NOT NULL "
                    "AND material IN (" + names_csv + ") "
                    # Префикс отправления — номер покупки без хвоста «-1», «-3».
                    "AND regexp_replace(ozon_posting_number, '-[0-9]+$', '') IN ("
                    "  SELECT regexp_replace(ozon_posting_number, '-[0-9]+$', '') "
                    "  FROM orders WHERE id IN (" + ids_for_siblings + ") "
                    "    AND marketplace = 'OZON' AND ozon_posting_number IS NOT NULL) "
                    f"AND id NOT IN ({ids_for_siblings}) "
                    # Предохранитель от аномалии: покупка на сотню отправлений не
                    # должна одна забить весь стек закройщика.
                    "LIMIT 20 "
                    "FOR UPDATE SKIP LOCKED"
                )
                siblings = [r[0] for r in cur.fetchall()]
                if siblings:
                    order_ids = sorted(set(order_ids) | set(siblings))

                # Связку отдаём закройщику ТОЛЬКО если тюля в его цехе хватит на ВСЕ её
                # вещи. Заказ покупателя раскраивается по принципу «всё или ничего»:
                # если материал кончится на середине, связка застрянет разорванной —
                # часть вещей раскроена, часть нет, и отгрузить заказ нечем.
                # Считаем суммарную потребность по каждому материалу и сравниваем с
                # остатком рулонов, доступных этому цеху.
                group_need = {}
                cur.execute(
                    "SELECT material, width, height FROM orders WHERE id IN ("
                    + ','.join(str(int(i)) for i in order_ids) + ")"
                )
                for g_material, g_width, g_height in cur.fetchall():
                    if not (g_material and g_width and g_height):
                        continue
                    cur.execute(
                        "SELECT id FROM marketplace_items WHERE material = %s AND width = %s "
                        "AND height = %s LIMIT 1",
                        (g_material, g_width, g_height),
                    )
                    gi_row = cur.fetchone()
                    if not gi_row:
                        continue
                    cur.execute(
                        "SELECT mim.material_id, mim.quantity FROM marketplace_item_materials mim "
                        "JOIN materials m ON m.id = mim.material_id "
                        "JOIN material_types mt ON mt.id = m.type_id "
                        "WHERE mim.marketplace_item_id = %s AND mt.name = 'Тюль'",
                        (gi_row[0],),
                    )
                    for gm_id, gm_qty in cur.fetchall():
                        group_need[gm_id] = group_need.get(gm_id, 0) + float(gm_qty)

                group_shortages = []
                for gm_id, gm_total in group_need.items():
                    cur.execute(
                        "SELECT COALESCE(SUM(remaining_quantity), 0) FROM rolls "
                        # Считаем остаток ЦЕХА: склад закройщику недоступен, пока
                        # материал не отгрузили и смена его не приняла.
                        "WHERE material_id = %s "
                        "AND status = 'in_workshop' AND accepted_at IS NOT NULL "
                        "AND defect_flagged_at IS NULL "
                        "AND (%s IS NULL OR workshop_id = %s) "
                        "AND remaining_quantity > 0",
                        (gm_id, workshop_id, workshop_id),
                    )
                    gm_available = float(cur.fetchone()[0] or 0)
                    if gm_available < gm_total:
                        cur.execute("SELECT name, unit FROM materials WHERE id = %s", (gm_id,))
                        gm_row = cur.fetchone()
                        gm_name, gm_unit = (gm_row[0], gm_row[1]) if gm_row else ('материал', '')
                        group_shortages.append(
                            f'{gm_name}: на связку нужно {round(gm_total, 2)} {gm_unit}, '
                            f'доступно {round(gm_available, 2)} {gm_unit}'
                        )

                if group_shortages:
                    conn.rollback()
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Не хватает материала на всю связку — обратитесь к кладовщику. '
                                      + '; '.join(group_shortages)},
                            ensure_ascii=False,
                        ),
                    }

            if not order_ids:
                # В режиме одного заказа очередь может состоять только из связок —
                # объясняем это прямо, иначе закройщик решит, что работы нет вообще.
                msg = (
                    'Нет одиночных заказов — в очереди только связки Яндекса. '
                    'Возьмите стек: связка раскраивается целиком'
                    if single_mode
                    else 'Нет новых заказов на разрешённые вашему цеху материалы'
                )
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({'error': msg}, ensure_ascii=False),
                }

            ids_csv = ','.join(str(i) for i in order_ids)
            cur.execute(
                f"UPDATE orders SET sewing_status = 'На раскрое', assigned_user_id = {int(user_id)}, "
                f"workshop_id = {int(workshop_id)} WHERE id IN ({ids_csv})"
            )
            log_action(
                cur, actor_id, actor_name, 'take_stack', 'order', None,
                (f'Взял в раскрой 1 заказ' if single_mode
                 else f'Взял в раскрой стек из {len(order_ids)} заказов'),
                {'orderIds': order_ids, 'workshopId': workshop_id, 'shiftNumber': shift_number},
            )

            # Полные данные взятых заказов — фронтенду нужны для немедленной печати
            # "листа закройщика" (чек-лист + QR-лист) сразу после взятия стека.
            # Признак оверлока берём У ТКАНИ, а не у заказа: сам заказ его получит
            # только в момент раскроя, а лист печатается ДО него. Закройщику метка
            # нужна именно сейчас — по ней он вешает крой в очередь обмётки, а не
            # в общую.
            cur.execute(
                f"SELECT o.id, o.order_number, o.order_type, o.marketplace, o.material, "
                f"o.width, o.height, o.group_key, o.group_size, o.group_position, "
                f"COALESCE((SELECT m.requires_overlock FROM materials m "
                f"          WHERE m.name = o.material LIMIT 1), false), "
                # НОМЕР ПОКУПКИ OZON и сколько её отправлений в этом стеке.
                #
                # Два отправления одной покупки — это часто две ОДИНАКОВЫЕ вещи
                # (Лен 300×255 и Лен 300×255). На вешалке их не различить, и
                # закройщица должна видеть это заранее, на бумаге: вещи похожи,
                # бирки путать нельзя. Отгружаются они порознь, каждая по своему
                # ярлыку, поэтому это НЕ связка Яндекса — вешать вместе не надо.
                f"CASE WHEN o.marketplace = 'OZON' AND o.ozon_posting_number IS NOT NULL "
                f"     THEN regexp_replace(o.ozon_posting_number, '-[0-9]+$', '') END "
                f"FROM orders o WHERE o.id IN ({ids_csv}) "
                f"ORDER BY o.material, o.group_key NULLS FIRST, "
                f"         o.group_position NULLS LAST, o.id"
            )
            raw_taken = cur.fetchall()
            # Считаем, сколько отправлений каждой покупки OZON попало в стек:
            # метку печатаем только когда их два и больше — одиночному заказу
            # предупреждать не о чем.
            purchase_counts = {}
            for r in raw_taken:
                if r[11]:
                    purchase_counts[r[11]] = purchase_counts.get(r[11], 0) + 1
            purchase_seen = {}

            taken_orders = []
            for r in raw_taken:
                purchase = r[11]
                total = purchase_counts.get(purchase, 0) if purchase else 0
                position = None
                if purchase and total > 1:
                    position = purchase_seen.get(purchase, 0) + 1
                    purchase_seen[purchase] = position
                taken_orders.append({
                    'id': r[0],
                    'orderNumber': r[1],
                    'orderType': r[2],
                    'marketplace': r[3],
                    'material': r[4],
                    'width': r[5],
                    'height': r[6],
                    # Связка Яндекса: все вещи одного заказа покупателя вешаются вместе
                    # на одну вешалку — иначе швея не соберёт заказ целиком.
                    'groupKey': r[7],
                    'groupSize': r[8],
                    'groupPosition': r[9],
                    # Ткань с осыпающимся краем — на листе печатается «ОВЕРЛОК».
                    'requiresOverlock': bool(r[10]),
                    # Отправления одной покупки OZON: вещи часто одинаковые, на
                    # вешалке их не различить. Отгружаются порознь — вешать вместе
                    # НЕ надо, но бирки путать нельзя.
                    'purchaseKey': purchase if total > 1 else None,
                    'purchaseSize': total if total > 1 else None,
                    'purchasePosition': position,
                })

            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    'count': len(order_ids),
                    'orderIds': order_ids,
                    'orders': taken_orders,
                }),
            }

        if action == 'create_manual':
            # Индивидуальные заказы (пошив не под маркетплейс) заводятся партией:
            # выбрали размер и количество — система сама создаёт нужное число заявок
            # с автономерами. Раньше приходилось добавлять их по одной.
            marketplace = (body_data.get('marketplace') or '').strip()
            order_type = (body_data.get('orderType') or 'FBO').strip()
            cluster = (body_data.get('cluster') or '').strip()
            marketplace_item_id = body_data.get('marketplaceItemId')
            # Сколько одинаковых изделий нужно отшить. По умолчанию 1 —
            # так старые вызовы продолжают работать без изменений.
            try:
                quantity = int(body_data.get('quantity') or 1)
            except (TypeError, ValueError):
                quantity = 1
            if quantity < 1:
                quantity = 1
            if quantity > 200:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'За один раз можно создать не больше 200 заказов'},
                        ensure_ascii=False,
                    ),
                }

            # У индивидуального пошива маркетплейса нет — подставляем метку,
            # чтобы поле не было пустым и заказ корректно отображался в списках.
            if order_type == 'Индивидуальный' and not marketplace:
                marketplace = 'Индивидуальный'

            if not marketplace or not marketplace_item_id:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Укажите маркетплейс и товар'}),
                }

            # Номер ручного заказа генерируется автоматически сквозным счётчиком в формате
            # 00000-01, 00000-02, ... Берём максимальный уже выданный номер такого вида и
            # увеличиваем на 1. Так пользователю не нужно вводить номер вручную.
            cur.execute(
                "SELECT order_number FROM orders "
                "WHERE order_number ~ '^00000-[0-9]+$' "
                "ORDER BY (split_part(order_number, '-', 2))::int DESC LIMIT 1"
            )
            last_row = cur.fetchone()
            next_seq = (int(last_row[0].split('-')[1]) + 1) if last_row else 1

            # Товар выбирается из справочника "Товары на маркетплейсе" — берём его
            # material/width/height, чтобы заказ сразу попал в очередь раскроя (конвейер
            # ищет marketplace_items именно по этим трём полям), а не только в текстовый
            # product для отображения.
            cur.execute(
                "SELECT name, material, width, height, barcode, ozon_sku FROM marketplace_items WHERE id = %s",
                (int(marketplace_item_id),),
            )
            item_row = cur.fetchone()
            if not item_row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}
            item_name, item_material, item_width, item_height, item_barcode, item_ozon_sku = item_row
            product = f"{item_material} {item_width}x{item_height}" if item_material and item_width and item_height else item_name

            marketplace_esc = marketplace.replace("'", "''")
            order_type_esc = order_type.replace("'", "''")
            cluster_esc = cluster.replace("'", "''")
            product_esc = product.replace("'", "''")
            material_esc = item_material.replace("'", "''") if item_material else None
            material_sql = f"'{material_esc}'" if material_esc else 'NULL'
            width_sql = str(int(item_width)) if item_width else 'NULL'
            height_sql = str(int(item_height)) if item_height else 'NULL'
            barcode_sql = f"'{item_barcode.replace(chr(39), chr(39)*2)}'" if item_barcode else 'NULL'
            ozon_sku_sql = f"'{item_ozon_sku.replace(chr(39), chr(39)*2)}'" if item_ozon_sku else 'NULL'

            # Создаём столько отдельных заявок, сколько изделий заказали: каждая
            # идёт по конвейеру самостоятельно (своя раскройка, свой пошив), но
            # заводить их руками по одной больше не нужно.
            created_ids = []
            created_numbers = []
            seq = next_seq
            for _ in range(quantity):
                # Номер могли занять параллельно (другой сотрудник тоже создаёт
                # заказы) — сдвигаемся дальше, пока не найдём свободный.
                while True:
                    candidate = f"00000-{seq:02d}"
                    # Значение подставляет драйвер: номер заказа приходит от
                    # маркетплейса, и ручное экранирование кавычек — лишний риск.
                    cur.execute(
                        "SELECT 1 FROM orders WHERE order_number = %s", (candidate,)
                    )
                    if not cur.fetchone():
                        break
                    seq += 1
                order_number_esc = candidate.replace("'", "''")
                cur.execute(
                    f"INSERT INTO orders (order_number, marketplace, order_type, status, cluster, product, "
                    f"quantity, source, material, width, height, marketplace_item_id, product_barcode, product_ozon_sku) "
                    f"VALUES ('{order_number_esc}', '{marketplace_esc}', '{order_type_esc}', 'Новый', "
                    f"'{cluster_esc}', '{product_esc}', 1, 'manual', {material_sql}, {width_sql}, {height_sql}, "
                    f"{int(marketplace_item_id)}, {barcode_sql}, {ozon_sku_sql}) "
                    f"RETURNING id"
                )
                created_ids.append(cur.fetchone()[0])
                created_numbers.append(candidate)
                seq += 1

            log_action(
                cur, actor_id, actor_name, 'create_manual', 'order', created_ids[0],
                f'Создал заказов вручную: {len(created_ids)} шт. '
                f'({created_numbers[0]}–{created_numbers[-1]}, {marketplace}, {product})'
                if len(created_ids) > 1 else
                f'Создал заказ {created_numbers[0]} вручную ({marketplace}, {product})',
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(
                    {'id': created_ids[0], 'ids': created_ids,
                     'orderNumbers': created_numbers, 'created': len(created_ids)},
                    ensure_ascii=False,
                ),
            }

        if action == 'update_order':
            item_id = body_data.get('id')
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

            # Двигать заказ по статусам вручную (sewingStatus) может только администратор.
            # Роль проверяем по actorId.
            if 'sewingStatus' in body_data:
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    r_row = cur.fetchone()
                    actor_role = r_row[0] if r_row else None
                if actor_role != 'admin':
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Менять статус заказа может только администратор'})}

                # ЗАЩИТА КОНВЕЙЕРА. Даже администратор не может «телепортировать»
                # заказ через этапы: порядок Раскроено → В работе → Стикеровка →
                # Готовые обязателен для всех. Иначе вещь числится закрытой, а крой
                # висит в цехе — именно так терялся крой, который «есть по факту».
                cur.execute(
                    "SELECT sewing_status FROM orders WHERE id = %s", (int(item_id),)
                )
                cs_row = cur.fetchone()
                if not cs_row:
                    return {'statusCode': 404, 'headers': headers,
                            'body': json.dumps({'error': 'Заказ не найден'})}
                current_sewing = cs_row[0]
                target_sewing = body_data['sewingStatus']

                # В «Готовые» — только со «Стикеровки». Ни из очереди, ни из работы.
                if target_sewing == 'Готовые' and current_sewing != 'Стикеровка':
                    return {
                        'statusCode': 409, 'headers': headers,
                        'body': json.dumps({
                            'error': f'Заказ в статусе «{current_sewing}» нельзя перевести в «Готовые». '
                                     f'Закрыть заказ можно только со стикеровки',
                        }, ensure_ascii=False),
                    }

                # В «Стикеровку» — только из «В работе»: этап пошива не пропускаем.
                if target_sewing == 'Стикеровка' and current_sewing != 'В работе':
                    return {
                        'statusCode': 409, 'headers': headers,
                        'body': json.dumps({
                            'error': f'Заказ в статусе «{current_sewing}» нельзя отправить на стикеровку. '
                                     f'Сначала швея должна взять его в работу',
                        }, ensure_ascii=False),
                    }

                # В «Раскроено» нельзя «скинуть» заказ просто так: без реального
                # расхода ткани в цехе не появится физического кроя, и швея будет
                # искать вещь, которой не существует. Ткань спишется ниже по FIFO —
                # но только если она есть на складе. Здесь проверяем, что списывать
                # вообще есть из чего: у заказа заполнены материал и размер.
                if target_sewing == 'Раскроено' and current_sewing != 'Раскроено':
                    cur.execute(
                        "SELECT material, width, height FROM orders WHERE id = %s",
                        (int(item_id),),
                    )
                    mwh_row = cur.fetchone()
                    if not mwh_row or not all(mwh_row):
                        return {
                            'statusCode': 409, 'headers': headers,
                            'body': json.dumps({
                                'error': 'Нельзя перевести в «Раскроено»: у заказа не указаны '
                                         'материал и размер — списать ткань не с чего. '
                                         'Крой оформляет закройщик на терминале, указывая рулон',
                            }, ensure_ascii=False),
                        }

            if 'orderNumber' in body_data:
                new_number = str(body_data['orderNumber']).strip()
                new_number_esc = new_number.replace("'", "''")
                cur.execute(
                    f"SELECT id FROM orders WHERE order_number = '{new_number_esc}' AND id != {int(item_id)}"
                )
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': f'Заказ с номером {new_number} уже есть в системе'}),
                    }

            fields = []
            if 'orderNumber' in body_data:
                fields.append(f"order_number = '{str(body_data['orderNumber']).replace(chr(39), chr(39)*2)}'")
            if 'marketplace' in body_data:
                fields.append(f"marketplace = '{str(body_data['marketplace']).replace(chr(39), chr(39)*2)}'")
            if 'orderType' in body_data:
                fields.append(f"order_type = '{str(body_data['orderType']).replace(chr(39), chr(39)*2)}'")
            if 'status' in body_data:
                status_val = str(body_data['status']).replace(chr(39), chr(39) * 2)
                fields.append(f"status = '{status_val}'")
                if body_data['status'] == 'Выполнен':
                    fields.append("completed_at = now()")
            if 'product' in body_data:
                fields.append(f"product = '{str(body_data['product']).replace(chr(39), chr(39)*2)}'")
            revert_cutter_accrual = False
            if 'sewingStatus' in body_data:
                sewing_status_val = str(body_data['sewingStatus']).replace(chr(39), chr(39) * 2)
                fields.append(f"sewing_status = '{sewing_status_val}'")
                # Если заказ вручную возвращают ДО этапа "Раскроено" — начисление
                # закройщику за раскрой этого заказа снимается (as per ТЗ: "в случае
                # удаления из раскроя начисления пропадают")
                if body_data['sewingStatus'] in ('Новый', 'На раскрое'):
                    revert_cutter_accrual = True
            if 'assignedUserId' in body_data:
                val = body_data['assignedUserId']
                fields.append(f"assigned_user_id = {int(val) if val not in (None, '') else 'NULL'}")
            if 'workshopId' in body_data:
                val = body_data['workshopId']
                fields.append(f"workshop_id = {int(val) if val not in (None, '') else 'NULL'}")
            # Привязка заказа к конкретному товару справочника — фиксируем штрихкод товара
            # для стикера FBO. Штрихкод берём из выбранного товара (может быть несколько
            # товаров на один размер с разными штрихкодами).
            if 'marketplaceItemId' in body_data:
                mi_val = body_data['marketplaceItemId']
                if mi_val in (None, ''):
                    fields.append("marketplace_item_id = NULL")
                    fields.append("product_barcode = NULL")
                    fields.append("product_ozon_sku = NULL")
                else:
                    cur.execute("SELECT barcode, ozon_sku FROM marketplace_items WHERE id = %s", (int(mi_val),))
                    mi_row = cur.fetchone()
                    if not mi_row:
                        return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}
                    bc = mi_row[0]
                    oz = mi_row[1]
                    bc_sql = f"'{bc.replace(chr(39), chr(39)*2)}'" if bc else 'NULL'
                    oz_sql = f"'{oz.replace(chr(39), chr(39)*2)}'" if oz else 'NULL'
                    fields.append(f"marketplace_item_id = {int(mi_val)}")
                    fields.append(f"product_barcode = {bc_sql}")
                    fields.append(f"product_ozon_sku = {oz_sql}")
            if not fields:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

            cur.execute(f"UPDATE orders SET {', '.join(fields)} WHERE id = {int(item_id)}")

            if revert_cutter_accrual:
                cur.execute(
                    "DELETE FROM salary_accruals WHERE order_id = %s AND type = 'cutter_cut' AND paid_at IS NULL",
                    (int(item_id),),
                )

            # Админ перевёл статус на "Раскроено" или дальше по конвейеру — материал
            # расходуется ОДИН раз (по FIFO из доступных рулонов). При откате статуса назад
            # материалы не трогаются и не возвращаются (расход разовый).
            if 'sewingStatus' in body_data:
                new_status = body_data['sewingStatus']
                if new_status in STATUS_ORDER and STATUS_ORDER.index(new_status) >= STATUS_ORDER.index('Раскроено'):
                    cur.execute(
                        "SELECT material, width, height, workshop_id FROM orders WHERE id = %s",
                        (int(item_id),),
                    )
                    mwh = cur.fetchone()
                    if mwh:
                        # Материал списываем из цеха заказа: расход идёт только
                        # внутри цеха, склад в него не входит.
                        err = write_off_materials_once(
                            cur, int(item_id), mwh[0], mwh[1], mwh[2], mwh[3])
                        if err:
                            conn.rollback()
                            return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': err})}

            # ЗАРПЛАТА ЗА ПОШИВ ПРИ РУЧНОМ ЗАКРЫТИИ ЗАКАЗА.
            #
            # Обычно заказ закрывает упаковщица на терминале — там начисление и
            # создаётся. Но заказ можно закрыть и отсюда, из карточки: терминал
            # был занят, вещь потерялась и нашлась, статус поправили руками.
            # Начисление в этом случае НЕ создавалось: швея заказ отшила, а
            # денег за него не получала. Ошибки никто не видел — заказ выглядел
            # закрытым, и потеря всплывала только в блоке «Работа без
            # начисления», причём люди уверены, что ничего не трогали.
            #
            # Логика та же, что на терминале: ставка за штуку по ширине из
            # тарифов цеха заказа, а если цех у заказа не проставлен (FBO
            # приходит в пошив мимо раскроя) — из штатного цеха самой швеи.
            # Повторное начисление невозможно: ON CONFLICT по (order_id, type).
            if 'sewingStatus' in body_data and body_data['sewingStatus'] == 'Готовые':
                cur.execute(
                    "SELECT assigned_user_id, width, workshop_id, order_number, sewing_status, "
                    # Вещь после оверлока оплачивается по другой ставке — см. ниже.
                    "overlocked_at FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                sew_row = cur.fetchone()
                if sew_row:
                    (sew_user, sew_width, sew_workshop,
                     sew_order_number, sew_status, sew_overlocked_at) = sew_row

                    # «Со склада» — вещь взяли готовой, её никто не шил.
                    if sew_user and sew_width and sew_status != 'Со склада':
                        if not sew_workshop:
                            cur.execute(
                                "SELECT w.id FROM users u JOIN workshops w ON w.name = u.workshop "
                                "WHERE u.id = %s",
                                (int(sew_user),),
                            )
                            sw_row = cur.fetchone()
                            sew_workshop = sw_row[0] if sw_row else None

                        if sew_workshop:
                            # Вещь, прошедшая оверлок, оплачивается за пог.м. по
                            # отдельной ставке: край уже обмётан, швее осталось
                            # пришить тесьму. Точно так же считает терминал
                            # упаковщицы — правило одно на оба пути закрытия.
                            if sew_overlocked_at:
                                cur.execute(
                                    "SELECT rate FROM salary_rates WHERE role = 'sewer_overlock' "
                                    "AND material_id IS NULL AND width IS NULL AND workshop_id = %s",
                                    (sew_workshop,),
                                )
                                rate_row = cur.fetchone()
                                ov_rate = float(rate_row[0]) if rate_row else 0
                                if ov_rate > 0:
                                    ov_meters = round(float(sew_width) / 100, 2)
                                    cur.execute(
                                        "INSERT INTO salary_accruals "
                                        "(user_id, type, amount, order_id, description) "
                                        "VALUES (%s, 'sewer_piece', %s, %s, %s) "
                                        "ON CONFLICT (order_id, type) "
                                        "WHERE order_id IS NOT NULL DO NOTHING",
                                        (int(sew_user), round(ov_meters * ov_rate, 2), int(item_id),
                                         f'Пошив заказа #{sew_order_number or item_id} '
                                         f'после оверлока - {ov_meters} пог.м.'),
                                    )
                            else:
                                cur.execute(
                                    "SELECT rate FROM salary_rates WHERE role = 'sewer' "
                                    "AND width = %s AND workshop_id = %s",
                                    (int(sew_width), sew_workshop),
                                )
                                rate_row = cur.fetchone()
                                sew_rate = float(rate_row[0]) if rate_row else 0
                                if sew_rate > 0:
                                    cur.execute(
                                        "INSERT INTO salary_accruals "
                                        "(user_id, type, amount, order_id, description) "
                                        "VALUES (%s, 'sewer_piece', %s, %s, %s) "
                                        "ON CONFLICT (order_id, type) "
                                        "WHERE order_id IS NOT NULL DO NOTHING",
                                        (int(sew_user), sew_rate, int(item_id),
                                         f'Пошив заказа #{sew_order_number or item_id} '
                                         f'({int(sew_width)} см)'),
                                    )

            log_action(
                cur, actor_id, actor_name, 'update_order', 'order', item_id,
                f'Изменил заказ #{item_id}',
                {k: v for k, v in body_data.items() if k not in ('action', 'id', 'actorId', 'actorName')},
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        if action in ('cut', 'cut_group'):
            # 'cut' — раскроить одну вещь.
            # 'cut_group' — раскроить и отправить в цех ВСЮ связку Яндекса разом: заказ
            # покупателя из 30 вещей закройщик не должен раскраивать по одной кнопке на
            # каждую, а швея потом собирать его по кусочкам. Списание материалов, лимиты
            # и начисление зарплаты для каждой вещи считаются точно так же, как при
            # обычном раскрое — просто в цикле.
            item_id = body_data.get('id')
            roll_id_chosen = body_data.get('rollId')
            # Вешалка, выбранная закройщиком при раскрое (необязательно). Запоминается за
            # закройщиком и подставляется по умолчанию в следующие заказы.
            hanger_number = body_data.get('hangerNumber')
            try:
                hanger_number = int(hanger_number) if hanger_number not in (None, '') else None
            except (TypeError, ValueError):
                hanger_number = None
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

            # Раскраивать и списывать материал может только закройщик (и администратор).
            # Остальные роли — швея, упаковщица, кладовщик, менеджер — к материалам
            # заказа отношения не имеют, иначе списание ушло бы мимо реального этапа.
            #
            # Допуск — по всем должностям сотрудника сразу (см. can_work_as):
            # смена, карточка и утверждённые должности. Совместитель, вышедший
            # в смену другой должностью, не должен упираться в отказ.
            if not can_work_as(cur, actor_id, 'cutter'):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Раскраивать заказы и выбирать рулон может только закройщик'},
                        ensure_ascii=False,
                    ),
                }

            # Для связки собираем все её ещё не раскроенные вещи, закреплённые за этим же
            # закройщиком, и обрабатываем их одну за другой в общей транзакции: либо
            # раскраивается вся связка, либо (при нехватке материала) не меняется ничего.
            cut_queue = [int(item_id)]
            if action == 'cut_group':
                cur.execute(
                    "SELECT group_key, assigned_user_id FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                g_row = cur.fetchone()
                if not g_row or not g_row[0]:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Этот заказ не входит в связку'}, ensure_ascii=False),
                    }
                # Связка может быть огромной (заказ из 30+ вещей). Раскрой каждой вещи —
                # это десятки запросов к базе (состав товара, рулоны, списание, зарплата),
                # поэтому за один вызов обрабатываем ограниченную порцию: иначе функция
                # упирается в лимит времени и запросов и падает на середине. Фронтенд
                # вызывает действие повторно, пока в связке остаются нераскроенные вещи —
                # для закройщика это по-прежнему ОДНА кнопка.
                cur.execute(
                    "SELECT id FROM orders WHERE group_key = %s AND sewing_status = 'На раскрое' "
                    "AND (assigned_user_id = %s OR %s IS NULL) "
                    "ORDER BY group_position ASC NULLS LAST, id ASC",
                    (g_row[0], g_row[1], g_row[1]),
                )
                all_pending = [r[0] for r in cur.fetchall()] or [int(item_id)]
                cut_queue = all_pending[:GROUP_CUT_BATCH]
                group_remaining = max(0, len(all_pending) - len(cut_queue))

            # Связка раскраивается по принципу «всё или ничего»: если на какой-то вещи
            # не хватило материала, откатываем ВСЮ транзакцию (conn.rollback перед каждым
            # выходом с ошибкой). Иначе часть заказа осталась бы раскроенной, часть нет —
            # и связка застряла бы разорванной посреди цеха.
            group_remaining = locals().get('group_remaining', 0)
            cut_done = []
            for item_id in cut_queue:

                cur.execute(
                    "SELECT material, width, height, workshop_id, assigned_user_id, sewing_status, "
                    "COALESCE(source, '') FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                order_row = cur.fetchone()
                if not order_row:
                        conn.rollback()
                        return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                (material, width, height, order_workshop_id, order_assigned_user_id,
                 current_sewing_status, order_source) = order_row

                # Раскроить можно ТОЛЬКО заказ, который сейчас на раскрое. Без этой
                # проверки закройщик мог выбрать рулон и вешалку у заказа, уже ушедшего
                # дальше по конвейеру (в работе, на стикеровке, в готовых) — материал
                # списался бы повторно, зарплата начислилась второй раз, а вешалка
                # заменилась бы посреди работы швеи.
                if current_sewing_status != 'На раскрое':
                        conn.rollback()
                        return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps(
                                        {'error': f'Заказ уже в статусе «{current_sewing_status}» — раскроить можно только заказ на раскрое'},
                                        ensure_ascii=False,
                                ),
                        }

                # Лимит метража и макс. число рулонов на смену закройщика (cutter_daily_limit,
                # max_fabric_rolls_per_shift) — считаются в пределах ТЕКУЩЕЙ открытой рабочей
                # смены (сбрасываются при открытии новой). Без открытой смены не применяются.
                if order_assigned_user_id:
                        cur.execute(
                                "SELECT opened_at FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                                "ORDER BY opened_at DESC LIMIT 1",
                                (order_assigned_user_id,),
                        )
                        cutter_session_row = cur.fetchone()
                        if cutter_session_row:
                                session_opened_at = cutter_session_row[0]
                                cutter_daily_limit = get_setting_float(cur, order_workshop_id, 'cutter_daily_limit', 0)
                                if cutter_daily_limit > 0:
                                        cur.execute(
                                                "SELECT COALESCE(SUM(width), 0) FROM orders WHERE assigned_user_id = %s "
                                                "AND sewing_status IN ('Раскроено', 'В работе', 'Стикеровка', 'Готовые') AND cut_at >= %s",
                                                (order_assigned_user_id, session_opened_at),
                                        )
                                        cut_meters = float(cur.fetchone()[0] or 0) / 100
                                        if cut_meters >= cutter_daily_limit:
                                                conn.rollback()
                                                return {
                                                        'statusCode': 409,
                                                        'headers': headers,
                                                        'body': json.dumps({'error': f'Лимит метража на смену исчерпан: {round(cut_meters, 2)}/{cutter_daily_limit} пог.м.'}),
                                                }

                                max_rolls = get_setting_int(cur, order_workshop_id, 'max_fabric_rolls_per_shift', 0)
                                if max_rolls > 0 and roll_id_chosen:
                                        cur.execute(
                                                "SELECT COUNT(DISTINCT omu.roll_id) FROM order_material_usage omu "
                                                "JOIN orders o ON o.id = omu.order_id "
                                                "WHERE o.assigned_user_id = %s AND o.cut_at >= %s AND omu.roll_id IS NOT NULL",
                                                (order_assigned_user_id, session_opened_at),
                                        )
                                        rolls_used = cur.fetchone()[0]
                                        cur.execute(
                                                "SELECT 1 FROM order_material_usage omu JOIN orders o ON o.id = omu.order_id "
                                                "WHERE o.assigned_user_id = %s AND o.cut_at >= %s AND omu.roll_id = %s LIMIT 1",
                                                (order_assigned_user_id, session_opened_at, int(roll_id_chosen)),
                                        )
                                        roll_already_used = bool(cur.fetchone())
                                        if not roll_already_used and rolls_used >= max_rolls:
                                                conn.rollback()
                                                return {
                                                        'statusCode': 409,
                                                        'headers': headers,
                                                        'body': json.dumps({'error': f'Лимит рулонов на смену исчерпан: {rolls_used}/{max_rolls}'}),
                                                }

                # Текущая смена закройщика берётся из его ОТКРЫТОЙ shift_sessions (а не из
                # статичного users.shift_number) — это учитывает гостевой режим: если
                # сотрудник сегодня зашёл в чужую смену, рулон должен списываться именно с
                # неё. Если открытой смены нет (например, старые тестовые данные) — fallback
                # на штатную смену профиля.
                order_shift_number = None
                if order_assigned_user_id:
                        cur.execute(
                                "SELECT shift_number FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                                "ORDER BY opened_at DESC LIMIT 1",
                                (order_assigned_user_id,),
                        )
                        session_row = cur.fetchone()
                        if session_row and session_row[0] is not None:
                                order_shift_number = session_row[0]
                        else:
                                cur.execute("SELECT shift_number FROM users WHERE id = %s", (order_assigned_user_id,))
                                u_row = cur.fetchone()
                                order_shift_number = u_row[0] if u_row else None

                cur.execute(
                        "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
                        (material, width, height),
                )
                item_row = cur.fetchone()
                if not item_row:
                        conn.rollback()
                        return {
                                'statusCode': 404,
                                'headers': headers,
                                'body': json.dumps({'error': 'Не найден товар маркетплейса для этого материала/размера — расход материалов не определён'}),
                        }
                marketplace_item_id = item_row[0]

                cur.execute(
                        "SELECT material_id, quantity FROM marketplace_item_materials WHERE marketplace_item_id = %s",
                        (marketplace_item_id,),
                )
                needed = cur.fetchall()
                if not needed:
                        conn.rollback()
                        return {
                                'statusCode': 400,
                                'headers': headers,
                                'body': json.dumps({'error': 'У товара не заполнен расход материалов'}),
                        }

                cur.execute("SELECT id FROM material_types WHERE name = 'Тюль'")
                tul_type_row = cur.fetchone()
                tul_type_id = tul_type_row[0] if tul_type_row else None

                cur.execute("SELECT id FROM material_types WHERE name = 'Аксессуары'")
                acc_type_row = cur.fetchone()
                acc_type_id = acc_type_row[0] if acc_type_row else None

                # Упаковка (пакет, этикетка на пакет) расходуется физически только на
                # стикеровке, поэтому при раскрое её не трогаем — списание идёт на терминале
                # упаковщика при закрытии заказа.
                cur.execute("SELECT id FROM material_types WHERE name = 'Упаковка'")
                pack_type_row = cur.fetchone()
                pack_type_id = pack_type_row[0] if pack_type_row else None

                fabric_material_id = None
                accessory_material_ids = set()
                packaging_material_ids = set()
                for material_id, _qty in needed:
                        cur.execute("SELECT type_id FROM materials WHERE id = %s", (material_id,))
                        mt_row = cur.fetchone()
                        if not mt_row:
                                continue
                        if tul_type_id and mt_row[0] == tul_type_id and fabric_material_id is None:
                                fabric_material_id = material_id
                        elif acc_type_id and mt_row[0] == acc_type_id:
                                accessory_material_ids.add(material_id)
                        elif pack_type_id and mt_row[0] == pack_type_id:
                                packaging_material_ids.add(material_id)

                if fabric_material_id and not roll_id_chosen:
                        conn.rollback()
                        return {
                                'statusCode': 400,
                                'headers': headers,
                                'body': json.dumps({'error': 'Выберите рулон тюля для раскроя'}),
                        }

                shortages = []
                write_offs = []
                for material_id, qty_needed in needed:
                        qty_needed = float(qty_needed)

                        if material_id in accessory_material_ids:
                                # Тесьма списывается позже швеёй перед отправкой на стикеровку
                                continue

                        if material_id in packaging_material_ids:
                                # Упаковка списывается на стикеровке (терминал упаковщика)
                                continue

                        if fabric_material_id and material_id == fabric_material_id:
                                cur.execute(
                                        "SELECT id, remaining_quantity, workshop_id, shift_number, "
                                        "accepted_at, defect_flagged_at FROM rolls WHERE id = %s "
                                        "AND material_id = %s AND status = 'in_workshop'",
                                        (int(roll_id_chosen), material_id),
                                )
                                roll_row = cur.fetchone()
                                if not roll_row:
                                        conn.rollback()
                                        return {
                                                'statusCode': 404,
                                                'headers': headers,
                                                'body': json.dumps({'error': 'Выбранный рулон не найден или недоступен'}),
                                        }
                                # Рулон отгружен со склада, но смена его не приняла —
                                # резать нельзя. По документам он в цехе, по факту мог
                                # не доехать или приехать порванным. Для аксессуаров
                                # такая проверка стояла давно, а для ткани рулон
                                # выбирает сам закройщик — и мимо неё проходил.
                                if roll_row[4] is None:
                                        conn.rollback()
                                        return {
                                                'statusCode': 409,
                                                'headers': headers,
                                                'body': json.dumps({
                                                        'error': 'Рулон ещё не принят сменой. Подтвердите приёмку '
                                                                 'рулона в цех, потом раскраивайте'
                                                }, ensure_ascii=False),
                                        }
                                if roll_row[5] is not None:
                                        conn.rollback()
                                        return {
                                                'statusCode': 409,
                                                'headers': headers,
                                                'body': json.dumps({
                                                        'error': 'Рулон отставлен как бракованный — работать с ним нельзя'
                                                }, ensure_ascii=False),
                                        }
                                if order_workshop_id and roll_row[2] != order_workshop_id:
                                        conn.rollback()
                                        return {
                                                'statusCode': 409,
                                                'headers': headers,
                                                'body': json.dumps({'error': 'Рулон не принадлежит вашему цеху/смене'}),
                                        }
                                # Смену не блокируем: закройщик-гость режет ткань,
                                # которая стоит рядом с ним в этом цехе, даже если
                                # коробку заводила другая смена. Цех проверен выше.
                                roll_remaining = float(roll_row[1])
                                if roll_remaining < qty_needed:
                                        cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
                                        mat_name, mat_unit = cur.fetchone()
                                        shortages.append(
                                                f"{mat_name}: нужно {round(qty_needed, 2)} {mat_unit}, "
                                                f"в рулоне осталось {round(roll_remaining, 2)} {mat_unit}"
                                        )
                                        continue
                                write_offs.append((roll_row[0], material_id, qty_needed))
                                continue

                        cur.execute(
                                "SELECT id, remaining_quantity FROM rolls "
                                # РАСХОД ТОЛЬКО ВНУТРИ ЦЕХА: склад не трогаем, пока
                                # кладовщик не отгрузил материал и смена его не приняла.
                                # Рулон «в пути» мог не доехать, бракованный ждёт
                                # решения кладовщика — оба в раскрой не идут.
                                "WHERE material_id = %s AND remaining_quantity > 0 "
                                "AND defect_flagged_at IS NULL "
                                "AND status = 'in_workshop' AND accepted_at IS NOT NULL "
                                "AND (%s IS NULL OR workshop_id = %s) "
                                "ORDER BY created_at ASC",
                                (material_id, order_workshop_id, order_workshop_id),
                        )
                        available_rolls = cur.fetchall()
                        total_available = sum(float(r[1]) for r in available_rolls)
                        if total_available < qty_needed:
                                cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
                                mat_name, mat_unit = cur.fetchone()
                                shortages.append(
                                        f"{mat_name}: нужно {round(qty_needed, 2)} {mat_unit}, "
                                        f"доступно {round(total_available, 2)} {mat_unit}"
                                )
                                continue

                        remaining_to_take = qty_needed
                        for roll_id, roll_remaining in available_rolls:
                                if remaining_to_take <= 0:
                                        break
                                take = min(float(roll_remaining), remaining_to_take)
                                write_offs.append((roll_id, material_id, take))
                                remaining_to_take -= take

                if shortages:
                        conn.rollback()
                        return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': 'Недостаточно материалов на складе: ' + '; '.join(shortages)}),
                        }

                # СПИСАНИЕ АТОМАРНОЕ: вычитает сама база, одним запросом.
                #
                # Раньше здесь было «прочитал остаток → посчитал новый → записал».
                # Два закройщика, нажавшие «Раскроено» одновременно, читали одно и то
                # же число и записывали каждый своё: расход второго затирал расход
                # первого. Метры уходили в заказы, а на рулоне не убывали — остаток
                # рос из воздуха, и недостача всплывала уже на закрытии рулона.
                #
                # Условие remaining_quantity >= take проверяется в момент записи:
                # если материал разобрали, пока мы считали, строка не обновится и
                # мы откатим весь раскрой, а не спишем половину.
                for roll_id, material_id, take in write_offs:
                        cur.execute(
                                "UPDATE rolls SET remaining_quantity = round(remaining_quantity - %s, 3), "
                                "status = CASE WHEN remaining_quantity - %s <= 0 THEN 'completed' ELSE status END, "
                                "completed_at = CASE WHEN remaining_quantity - %s <= 0 THEN now() ELSE completed_at END "
                                "WHERE id = %s AND remaining_quantity >= %s "
                                "RETURNING remaining_quantity",
                                (take, take, take, roll_id, take - 0.001),
                        )
                        if not cur.fetchone():
                                conn.rollback()
                                cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
                                m_row = cur.fetchone()
                                m_name = m_row[0] if m_row else 'Материал'
                                m_unit = m_row[1] if m_row else ''
                                return {
                                        'statusCode': 409,
                                        'headers': headers,
                                        'body': json.dumps({
                                                'error': f'{m_name}: материал разобрали, пока шёл раскрой — '
                                                         f'нужно {round(take, 2)} {m_unit}, столько уже нет. '
                                                         f'Обновите экран и повторите'
                                        }, ensure_ascii=False),
                                }
                        cur.execute(
                                f"INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
                                f"VALUES ({int(item_id)}, {material_id}, {roll_id}, {take})"
                        )

                # cutter_user_id фиксирует, КТО именно раскроил заказ, отдельно от
                # assigned_user_id — последний будет перезаписан на швею при take_order,
                # а история "кто кроил" должна остаться видна на карточке товара.
                cutter_sql = f", cutter_user_id = {order_assigned_user_id}" if order_assigned_user_id else ""
                # Если закройщик выбрал вешалку — ставим её; иначе берём его последнюю вешалку
                # (запоминается за закройщиком, чтобы не выбирать каждый раз заново).
                effective_hanger = hanger_number
                if effective_hanger is None and order_assigned_user_id:
                        cur.execute("SELECT last_hanger_number FROM users WHERE id = %s", (order_assigned_user_id,))
                        lh = cur.fetchone()
                        effective_hanger = lh[0] if lh and lh[0] else None
                hanger_sql = f", hanger_number = {int(effective_hanger)}" if effective_hanger else ""

                # ТРЕБУЕТ ЛИ ВЕЩЬ ОБМЁТКИ НА ОВЕРЛОКЕ.
                #
                # Признак берём у ткани в момент раскроя и ЗАПИСЫВАЕМ В ЗАКАЗ, а не
                # смотрим на ткань каждый раз потом. Ткань могут перенастроить
                # завтра, а вещи, уже запущенные в работу, должны пройти тот
                # маршрут, по которому их отправили: иначе крой, висящий на
                # вешалке, внезапно поменяет очередь.
                needs_overlock = False
                if fabric_material_id:
                        cur.execute(
                                "SELECT requires_overlock FROM materials WHERE id = %s",
                                (fabric_material_id,),
                        )
                        ov_row = cur.fetchone()
                        needs_overlock = bool(ov_row and ov_row[0])
                overlock_sql = ", requires_overlock = true" if needs_overlock else ""

                cur.execute(
                        f"UPDATE orders SET sewing_status = 'Раскроено', cut_at = now()"
                        f"{cutter_sql}{hanger_sql}{overlock_sql} WHERE id = {int(item_id)}"
                )
                # Запоминаем выбранную вешалку за закройщиком для следующих заказов.
                if hanger_number and order_assigned_user_id:
                        cur.execute(
                                "UPDATE users SET last_hanger_number = %s WHERE id = %s",
                                (int(hanger_number), order_assigned_user_id),
                        )

                # Начисление закройщику: ставка за 1 пог.м. по материалу (одна на ткань)
                # (salary_rates, role='cutter', material_id), берётся из тарифов цеха,
                # в котором выполняется заказ (order_workshop_id) — тарифы полностью раздельные
                # по цехам. Метраж для оплаты — ЧИСТАЯ ширина товара (width/100 пог.м.), а НЕ
                # технологический расход ткани со склада (marketplace_item_materials.quantity,
                # который включает запас на подгибку и используется только для списания со
                # склада) — иначе оплата некорректно завышалась/дробилась на копейки запаса.
                # Если заказ позже удалят из раскроя (cancel_order/delete_order), начисление
                # снимается там же.
                # Происхождение заказа на оплату НЕ влияет: закройщик физически раскроил
                # вещь — работа сделана и оплачивается. Раньше заказы, перенесённые из
                # старой системы (source = 'import'), исключались из оплаты, потому что
                # считалось, что их раскроили ещё до переезда. На практике эти заказы
                # доходят до цеха нераскроенными, и человек делает по ним полноценную
                # работу — а в балансе она не появлялась. Так же оплачиваются пошив
                # и стикеровка: этап выполнен — этап оплачен.
                # Цех для ставки: у заказа, если проставлен, иначе штатный цех
                # самого закройщика.
                #
                # Без этой подстраховки заказ БЕЗ ЦЕХА давал нулевую ставку, и
                # начисление молча не создавалось — закройщица кроила бесплатно.
                # А цех у заказа проставляется ПОЗЖЕ, на терминале упаковщицы:
                # в момент раскроя его у заказа ещё нет. Такая же подстраховка
                # давно стоит у пошива — у раскроя её просто забыли поставить.
                cutter_workshop_for_rate = order_workshop_id
                if order_assigned_user_id and not cutter_workshop_for_rate:
                        cur.execute(
                                "SELECT w.id FROM users u JOIN workshops w ON w.name = u.workshop "
                                "WHERE u.id = %s",
                                (int(order_assigned_user_id),),
                        )
                        cw_row = cur.fetchone()
                        cutter_workshop_for_rate = cw_row[0] if cw_row else None

                if fabric_material_id and order_assigned_user_id and cutter_workshop_for_rate and width:
                        # Ставка задаётся ОДНА на ткань (width IS NULL) — раньше её
                        # требовалось заводить на каждую пару «ткань + ширина», то есть
                        # 56 полей на цех при одинаковом значении внутри ткани. Ширина
                        # всё равно учитывается ниже: сумма = метраж x ставка.
                        cur.execute(
                                "SELECT rate FROM salary_rates WHERE role = 'cutter' AND material_id = %s "
                                "AND width IS NULL AND workshop_id = %s",
                                (fabric_material_id, cutter_workshop_for_rate),
                        )
                        rate_row = cur.fetchone()
                        rate = float(rate_row[0]) if rate_row else 0
                        if rate > 0:
                                cur.execute("SELECT name FROM materials WHERE id = %s", (fabric_material_id,))
                                mat_name = cur.fetchone()[0]
                                pay_meters = round(float(width) / 100, 2)
                                amount = round(pay_meters * rate, 2)
                                cur.execute(
                                        f"INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                                        f"VALUES ({order_assigned_user_id}, 'cutter_cut', {amount}, {int(item_id)}, "
                                        f"'Раскрой заказа #{item_id} ({mat_name} {int(width)} см) - {pay_meters} пог.м.') "
                                        f"ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING"
                                )

                cut_done.append(item_id)
                log_action(
                        cur, actor_id, actor_name, 'cut', 'order', item_id,
                        f'Раскроил заказ #{item_id}',
                        {'rollId': roll_id_chosen},
                )

            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'success': True, 'cutCount': len(cut_done)}),
            }

        if action == 'take_order':
            user_id = body_data.get('userId')
            if not user_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите userId'})}

            # Настройки лимитов/таймаута/приоритета берутся по цеху ТЕКУЩЕЙ открытой
            # рабочей смены швеи (учитывает гостевой режим), при её отсутствии — глобальные.
            cur.execute(
                "SELECT workshop_id, opened_at FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                "ORDER BY opened_at DESC LIMIT 1",
                (int(user_id),),
            )
            session_row = cur.fetchone()
            # Брать заказ в пошив можно только на открытой смене — выработка и зарплата
            # должны попадать в смену, а не «висеть» вне её.
            if not session_row:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Смена не открыта — откройте смену на терминале в цехе'}),
                }
            session_workshop_id, session_opened_at = session_row

            # Заказ Яндекса из нескольких вещей едет по ОДНОМУ общему ярлыку, поэтому его
            # шьёт одна швея целиком. Если у неё уже есть незакрытая связка, лимиты на
            # взятие не применяются: иначе при заказе из 5 вещей и лимите в 3 швея упрётся
            # на середине, а недошитый заказ повиснет — его не сможет добрать ни она (лимит),
            # ни другая швея (связка закреплена за ней). Это исключение НЕ даёт брать больше
            # работы: догрузить можно только вещи уже начатого заказа, новые заказы сверх
            # лимита по-прежнему недоступны.
            cur.execute(
                "SELECT 1 FROM orders o WHERE o.group_key IS NOT NULL "
                "AND (o.assigned_user_id = %s OR o.sewer_user_id = %s) "
                "AND o.sewing_status IN ('В работе', 'Стикеровка') "
                "AND EXISTS (SELECT 1 FROM orders p WHERE p.group_key = o.group_key "
                "            AND p.sewing_status = 'Раскроено') LIMIT 1",
                (int(user_id), int(user_id)),
            )
            finishing_group = cur.fetchone() is not None

            # Лимит заказов НА РУКАХ У ШВЕИ (max_quantity_orders_to_seamstress).
            #
            # СЧИТАЕМ ТОЛЬКО «В РАБОТЕ». Отправила вещь на стикеровку — место
            # освободилось сразу, можно брать следующую.
            #
            # Раньше в лимит входила и «Стикеровка»: швея сдавала обе вещи и всё
            # равно упиралась в замок, пока упаковщица их не закроет. Работа швеи
            # вставала из-за очереди на чужом участке — она физически освободила
            # руки, а система держала её закрытой. Теперь ограничение отражает
            # ровно то, что швея реально шьёт прямо сейчас.
            max_orders = get_setting_int(cur, session_workshop_id, 'max_quantity_orders_to_seamstress', 0)
            if max_orders > 0 and not finishing_group:
                cur.execute(
                    "SELECT COUNT(*) FROM orders "
                    "WHERE assigned_user_id = %s AND sewing_status = 'В работе'",
                    (int(user_id),),
                )
                in_work = int(cur.fetchone()[0])
                if in_work >= max_orders:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'У вас уже {in_work} заказов в работе (лимит {max_orders}) — '
                                     f'сначала отправьте их на стикеровку',
                            'inWork': in_work,
                            'maxOrders': max_orders,
                        }, ensure_ascii=False),
                    }

            # НАКОПИТЕЛЬНОГО ТАЙМАУТА НА ВЗЯТИЕ И ЛИМИТА МЕТРАЖА ЗА СМЕНУ БОЛЬШЕ НЕТ.
            #
            # Раньше швея упиралась в общий таймер: система складывала таймауты всех
            # взятых за смену заказов и держала кнопку «Получить заказ» закрытой. Время
            # шло от ПЕРВОГО заказа смены, поэтому к вечеру отсчёт превращался в час с
            # лишним, а связь с реальной работой терялась — швея могла всё отшить и
            # всё равно ждать.
            #
            # Теперь темп задаёт САМА ВЕЩЬ: таймер висит на кнопке «Отправить на
            # стикеровку» конкретного заказа и считается по его ширине (timeout_200…800).
            # Пока вещь не отшита по времени — её не сдать, а значит и место в работе не
            # освободится. Ограничение осталось прежним по сути, но стало честным:
            # оно привязано к конкретной вещи, а не к общему счётчику смены.
            #
            # Здесь остаётся ровно одна проверка — лимит заказов на руках
            # (max_quantity_orders_to_seamstress, сейчас 2). Она выше по коду.

            # Приоритет и фильтр заказов (по цеху смены): orders_filter — ограничивает
            # выборку FBO/FBS, orders_cluster_priority — приоритетный FBO-кластер идёт
            # первым, orders_priority — сначала OZON/WB, при равенстве — FIFO по cut_at.
            orders_filter_setting = get_setting(cur, session_workshop_id, 'orders_filter', 'all')
            cluster_priority = get_setting(cur, session_workshop_id, 'orders_cluster_priority', '')
            orders_priority_setting = get_setting(cur, session_workshop_id, 'orders_priority', 'by_date')

            where_parts = ["sewing_status = 'Раскроено'"]
            # Швея берёт в работу только заказы, раскроенные в ЕЁ цехе (цех текущей
            # открытой смены) — цеха изолированы: заказ, раскроенный в цехе №2, швея
            # цеха №1 взять не может. Без открытой смены цех неизвестен — брать нечего.
            if not session_workshop_id:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Откройте рабочую смену, чтобы брать заказы в работу'}),
                }
            # Заказы, заведённые вручную/загрузкой из старой базы (source = 'import'),
            # цеха не имеют: их не раскраивал закройщик, и проставить цех было неоткуда.
            # Без поблажки они висят мёртвым грузом — швея своего цеха их не видит,
            # а другого цеха у них нет. Поэтому берём либо свой цех, либо «без цеха».
            where_parts.append(
                f"(workshop_id = {int(session_workshop_id)} OR workshop_id IS NULL)"
            )
            # ВЕЩЬ, КОТОРОЙ НУЖЕН ОВЕРЛОК, В ПРЯМОСТРОЧКУ НЕ ОТДАЁМ, ПОКА КРАЙ НЕ
            # ОБМЕТАН.
            #
            # Такая вещь лежит в «Раскроено» вместе с остальными, но её маршрут
            # длиннее: сначала оверлок, потом прямострочка. Без этого условия
            # кнопка «Взять заказ» выдала бы швее необмётанный крой, и этап,
            # ради которого всё затевалось, оказался бы пропущен.
            where_parts.append("(requires_overlock = false OR overlocked_at IS NOT NULL)")
            if orders_filter_setting == 'fbo':
                where_parts.append("order_type = 'FBO'")
            elif orders_filter_setting == 'fbs':
                where_parts.append("order_type = 'FBS'")

            order_parts = []
            # ОТСЕЧКА OZON. Машина на ПВЗ уезжает раз в день, и вещь, сшитая после
            # отсечки, на неё уже не попадёт. Поэтому во второй половине дня сначала
            # отдаём WB и Яндекс — их работу ещё можно закрыть сегодня.
            #
            # Это именно ПОРЯДОК, а не запрет: OZON остаётся в очереди последним и
            # уходит швее, как только другой работы не осталось. Иначе цех вставал бы
            # на пустом месте в дни, когда WB и Яндекс молчат.
            ozon_last = ozon_cutoff_passed(cur, session_workshop_id)
            if ozon_last:
                order_parts.append("(marketplace = 'OZON') ASC")
            # FBS-заказы ВСЕГДА идут первыми в очереди — это жёсткое правило, оно важнее
            # любых настроек приоритета цеха (у FBS сжатые сроки отгрузки на маркетплейс).
            order_parts.append("(order_type = 'FBS') DESC")
            if cluster_priority:
                cluster_esc = cluster_priority.replace("'", "''")
                order_parts.append(f"(cluster = '{cluster_esc}') DESC")
            # После отсечки настройка «Сначала OZON» не применяется: иначе две
            # настройки тянули бы очередь в разные стороны. У нас в системе глобально
            # стоит именно ozon_first, и без этой оговорки правило отсечки выглядело бы
            # сломанным — OZON бы возвращался наверх сразу после отсечки.
            if orders_priority_setting == 'ozon_first' and not ozon_last:
                order_parts.append("(marketplace = 'OZON') DESC")
            elif orders_priority_setting == 'wb_first':
                order_parts.append("(marketplace = 'WB') DESC")
            elif orders_priority_setting == 'yandex_first':
                order_parts.append("(marketplace = 'Yandex') DESC")
            # ГЛАВНОЕ ПРАВИЛО ОЧЕРЕДИ — ВОЗРАСТ ЗАКАЗА ПОКУПАТЕЛЯ, а не время раскроя.
            #
            # Раньше сортировали по cut_at (когда вещь раскроили), и из-за этого крой
            # свежей смены пролезал вперёд старого. Пример: заказ позавчерашний, но его
            # раскроили сегодня в 14:00 — а вчерашний крой лежит с 06:00. По cut_at
            # первым уходил вчерашний, но если сегодняшняя смена раскроила СВЕЖИЙ заказ
            # раньше, чем прошлая смена — свой старый, то свежий заказ уходил в пошив
            # первым. Заказы прошлой смены отодвигались, копились и просрочивались.
            #
            # Теперь очередь строго по дате заказа покупателя: чем дольше человек ждёт,
            # тем раньше вещь шьётся — независимо от того, какая смена её раскроила.
            # cut_at остаётся вторым ключом: при одинаковой дате заказа первым идёт
            # то, что раскроили раньше.
            order_parts.append("COALESCE(marketplace_created_at, created_at) ASC")
            order_parts.append("cut_at ASC NULLS LAST")
            # Внутри одного заказа покупателя вещи выдаются по порядку — «1 из 3», «2 из 3».
            order_parts.append("group_key NULLS FIRST")
            order_parts.append("group_position ASC NULLS LAST")
            order_parts.append("id ASC")

            # Если швея уже начала связку (заказ Яндекса из нескольких вещей), сначала
            # доотдаём ей оставшиеся вещи этой связки — заказ шьётся одной швеёй целиком,
            # потому что ярлык на него один общий. Только когда связка закрыта, выдаём
            # следующий заказ из общей очереди.
            cur.execute(
                f"SELECT id FROM orders WHERE {' AND '.join(where_parts)} "
                f"AND group_key IS NOT NULL AND group_key IN ("
                f"  SELECT group_key FROM orders WHERE group_key IS NOT NULL "
                f"  AND (assigned_user_id = {int(user_id)} OR sewer_user_id = {int(user_id)}) "
                f"  AND sewing_status IN ('В работе', 'Стикеровка')) "
                f"ORDER BY group_key, group_position ASC NULLS LAST, id ASC "
                f"LIMIT 1 FOR UPDATE SKIP LOCKED"
            )
            row = cur.fetchone()

            if not row:
                cur.execute(
                    f"SELECT id FROM orders WHERE {' AND '.join(where_parts)} "
                    f"ORDER BY {', '.join(order_parts)} "
                    f"LIMIT 1 FOR UPDATE SKIP LOCKED"
                )
                row = cur.fetchone()
            if not row:
                # Объясняем ПОЧЕМУ пусто, иначе швея видит «нет заказов» и не понимает,
                # что делать. Самая частая причина — смена открыта не в том цехе:
                # человек физически стоит в одном цехе, а смену открыл на терминале
                # другого, и вся очередь чужого цеха ему недоступна.
                cur.execute(
                    "SELECT w.id, w.name, COUNT(o.id) FROM orders o "
                    "JOIN workshops w ON w.id = o.workshop_id "
                    "WHERE o.sewing_status = 'Раскроено' "
                    "AND COALESCE(o.status, '') <> 'Отменён' "
                    "GROUP BY w.id, w.name ORDER BY COUNT(o.id) DESC"
                )
                elsewhere = [r for r in cur.fetchall() if r[0] != session_workshop_id]

                cur.execute("SELECT name FROM workshops WHERE id = %s", (int(session_workshop_id),))
                ws_name_row = cur.fetchone()
                ws_name = ws_name_row[0] if ws_name_row else f'#{session_workshop_id}'

                if elsewhere:
                    where_txt = ', '.join(f'{r[1]} — {r[2]} шт.' for r in elsewhere)
                    msg = (
                        f'В {ws_name} нет раскроенных заказов. Они есть в другом цехе: '
                        f'{where_txt}. Ваша смена открыта в {ws_name} — если вы работаете '
                        f'в другом цехе, закройте смену и откройте её на терминале того цеха'
                    )
                else:
                    msg = (
                        f'В {ws_name} нет раскроенных заказов — закройщики ещё не сдали крой. '
                        f'Подождите или спросите закройщицу'
                    )
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({'error': msg}, ensure_ascii=False),
                }
            order_id = row[0]

            # Проверяем, что материалы для этого товара есть в цехе смены. Если чего-то
            # не хватает — заказ в работу не выдаём и пишем, какого именно материала мало.
            # У заказов, заведённых вручную (source = 'import'), расход материалов в
            # карточках товара ещё не заполнен — проверка остатка отбраковала бы их все.
            # Такие заказы отдаём в работу без проверки: материал по ним списывается
            # по факту, а не планируется заранее.
            cur.execute(
                "SELECT material, width, height, COALESCE(source, '') FROM orders WHERE id = %s",
                (order_id,),
            )
            o_row = cur.fetchone()
            is_manual_order = bool(o_row) and o_row[3] == 'import'
            if o_row and o_row[0] and o_row[1] and o_row[2] and not is_manual_order:
                cur.execute(
                    "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
                    (o_row[0], o_row[1], o_row[2]),
                )
                mi_row = cur.fetchone()
                if mi_row:
                    # Берём ВЕСЬ состав товара из карточки «Товары на маркетплейсе»,
                    # а не только аксессуары.
                    #
                    # Раньше проверялся один тип — «Аксессуары». Швея брала заказ и
                    # обнаруживала уже за машинкой, что кончилась упаковка: заказ
                    # висел в работе, вещь не закрывалась. Что расходуется на товар,
                    # решает его карточка — по ней и проверяем.
                    #
                    # Ткань исключаем: её списывает раскрой ДО пошива, и к моменту
                    # взятия заказа она уже израсходована. Требовать её остаток
                    # здесь — значит запретить шить готовый крой.
                    cur.execute(
                        "SELECT mim.material_id, mim.quantity, m.name, m.unit "
                        "FROM marketplace_item_materials mim "
                        "JOIN materials m ON m.id = mim.material_id "
                        "JOIN material_types mt ON mt.id = m.type_id "
                        "WHERE mim.marketplace_item_id = %s AND mt.name <> 'Тюль' "
                        # Материал, уже списанный по этому заказу, второй раз не
                        # требуем: он физически израсходован, остаток на него не нужен.
                        "AND NOT EXISTS (SELECT 1 FROM order_material_usage omu "
                        "                WHERE omu.order_id = %s "
                        "                  AND omu.material_id = mim.material_id)",
                        (mi_row[0], order_id),
                    )
                    needed_rows = cur.fetchall()

                    # ОСТАТКИ ВСЕХ МАТЕРИАЛОВ — ОДНИМ ЗАПРОСОМ.
                    #
                    # Раньше на каждый материал товара шёл отдельный запрос к
                    # rolls (в таблице 4800 рулонов), и каждый занимал около
                    # секунды. На товар приходится до трёх материалов — три
                    # секунды только здесь, плюс остальные проверки. Функция
                    # не укладывалась в свои 4 секунды и обрывалась: швея
                    # видела ошибку вместо заказа.
                    #
                    # Условия те же, что и были: бракованные рулоны не считаем
                    # (планировать заказ на брак нельзя) и непринятые тоже —
                    # рулон отгружен со склада, но смена его не подтвердила, по
                    # факту материала в цехе может не быть.
                    stock_by_material = {}
                    if needed_rows:
                        mat_ids_csv = ','.join(str(int(r[0])) for r in needed_rows)
                        cur.execute(
                            "SELECT material_id, COALESCE(SUM(remaining_quantity), 0) "
                            "FROM rolls "
                            f"WHERE material_id IN ({mat_ids_csv}) "
                            "  AND status = 'in_workshop' AND remaining_quantity > 0 "
                            "  AND defect_flagged_at IS NULL AND accepted_at IS NOT NULL "
                            "  AND (%s IS NULL OR workshop_id = %s) "
                            "GROUP BY material_id",
                            (session_workshop_id, session_workshop_id),
                        )
                        stock_by_material = {r[0]: float(r[1] or 0) for r in cur.fetchall()}

                    lacks = []
                    for mat_id, qty_needed, mat_name, mat_unit in needed_rows:
                        available = stock_by_material.get(mat_id, 0.0)
                        if available < float(qty_needed):
                            lacks.append(
                                f"{mat_name}: нужно {round(float(qty_needed), 2)} {mat_unit}, "
                                f"в цехе {round(available, 2)} {mat_unit}"
                            )
                    if lacks:
                        conn.rollback()
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({'error': 'Не хватает материала в цехе — ' + '; '.join(lacks)}),
                        }

            # Заказ Яндекса из нескольких вещей шьётся ОДНОЙ швеёй целиком — ярлык на него
            # общий. Поэтому выдаём сразу всю связку одним нажатием, а не по одной вещи:
            # швея не должна жать кнопку 30 раз и упираться в лимиты на середине заказа.
            cur.execute("SELECT group_key FROM orders WHERE id = %s", (order_id,))
            gk_row = cur.fetchone()
            group_key = gk_row[0] if gk_row else None

            taken_ids = [order_id]
            if group_key:
                cur.execute(
                    f"SELECT id FROM orders WHERE {' AND '.join(where_parts)} "
                    "AND group_key = %s AND id <> %s "
                    "ORDER BY group_position ASC NULLS LAST, id ASC FOR UPDATE SKIP LOCKED",
                    (group_key, order_id),
                )
                taken_ids += [r[0] for r in cur.fetchall()]

            ids_csv = ','.join(str(int(i)) for i in taken_ids)
            cur.execute(
                # Цех проставляем по смене швеи, если у заказа его ещё нет.
                #
                # Заказы маркетплейсов приходят без цеха — его задаёт раскрой. Но FBO-заказы
                # попадают в пошив, минуя раскрой (ткань уже готова), и цех оставался пустым.
                # Дальше по цепочке зарплата швеи считается по ставке ЦЕХА ЗАКАЗА: нет цеха —
                # нет ставки — начисление молча не создаётся. Швея отшивала смену и не
                # получала за неё ничего, а в отчётах это выглядело как «не работала».
                f"UPDATE orders SET sewing_status = 'В работе', assigned_user_id = {int(user_id)}, "
                f"workshop_id = COALESCE(workshop_id, {int(session_workshop_id)}), "
                f"taken_at = now() WHERE id IN ({ids_csv})"
            )
            if group_key and len(taken_ids) > 1:
                log_action(
                    cur, actor_id, actor_name, 'take_order', 'order', order_id,
                    f'Взяла в работу связку {group_key} целиком: {len(taken_ids)} вещей',
                )
            else:
                log_action(
                    cur, actor_id, actor_name, 'take_order', 'order', order_id,
                    f'Взял в работу заказ #{order_id}',
                )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    'orderId': order_id,
                    'groupKey': group_key,
                    'takenCount': len(taken_ids),
                }, ensure_ascii=False),
            }

        if action == 'send_to_stickering':
            item_id = body_data.get('id')
            roll_id_chosen = body_data.get('rollId')
            # rollId обязателен только если товару нужна тесьма — это проверяется ниже,
            # после определения trim_material_id. Товар без тесьмы отправляется без рулона.
            if not item_id:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Укажите id заказа'}),
                }

            # Тесьму списывает только швея (и администратор): это её этап работы.
            #
            # Допуск проверяем по всем должностям сотрудника сразу — см.
            # can_work_as: смена, карточка и утверждённые должности.
            if not can_work_as(cur, actor_id, 'sewer'):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Отправлять на стикеровку и выбирать тесьму может только швея'},
                        ensure_ascii=False,
                    ),
                }

            cur.execute(
                "SELECT material, width, height, workshop_id, sewing_status, assigned_user_id, taken_at "
                "FROM orders WHERE id = %s",
                (int(item_id),),
            )
            order_row = cur.fetchone()
            if not order_row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
            (material, width, height, order_workshop_id, current_status,
             order_assigned_user_id, order_taken_at) = order_row
            if current_status == 'Стикеровка':
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Заказ уже отправлен на стикеровку'}),
                }
            # На стикеровку — ТОЛЬКО из «В работе», то есть заказ, который швея взяла
            # кнопкой «Взять заказ» из очереди «Раскроено».
            #
            # Раньше сюда пускали и статус «Раскроено»: заказ можно было сдать на
            # стикеровку, минуя швею. Крой при этом физически оставался висеть на
            # вешалке, а по системе вещь считалась отшитой — и пропадала из очереди
            # навсегда. Теперь этап пошива обязателен: пропустить его нельзя.
            if current_status != 'В работе':
                stage_hint = {
                    'Новый': 'заказ ещё не раскроен',
                    'На раскрое': 'заказ на раскрое у закройщика',
                    'Раскроено': 'сначала возьмите заказ в работу кнопкой «Взять заказ»',
                    'Стикеровка': 'заказ уже на стикеровке',
                    'Готовые': 'заказ уже закрыт',
                }.get(current_status, f'заказ в статусе «{current_status}»')
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': f'На стикеровку нельзя: {stage_hint}'},
                        ensure_ascii=False,
                    ),
                }

            # ВЕЩЬ НЕЛЬЗЯ СДАТЬ РАНЬШЕ, ЧЕМ ЕЁ РЕАЛЬНО МОЖНО ОТШИТЬ.
            #
            # Время на пошив задано настройками цеха по ширине изделия
            # (timeout_200…800) и отсчитывается от момента взятия заказа в работу.
            # Пока оно не вышло, отправить вещь на стикеровку нельзя — иначе смысл
            # ограничения теряется: швея за минуту «сдавала» бы всё подряд, освобождая
            # места в работе, и разбирала бы очередь цеха.
            #
            # Проверку делает СЕРВЕР, а не только кнопка на экране: интерфейс можно
            # обойти старой вкладкой или повторным запросом, сервер — нет.
            #
            # Цех берём у заказа, а при его отсутствии — из смены швеи (гостевой режим
            # и FBO-заказы без цеха): настройки должны найтись в любом случае.
            wait_ws_id = order_workshop_id
            if not wait_ws_id:
                cur.execute(
                    "SELECT workshop_id FROM shift_sessions "
                    "WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(actor_id),) if actor_id else (0,),
                )
                ws_row = cur.fetchone()
                wait_ws_id = ws_row[0] if ws_row else None

            sew_wait, _sew_next = sewing_wait_for_order(
                cur, wait_ws_id, width, order_taken_at
            )
            if sew_wait > 0:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Ещё рано: вещь можно сдать через {format_wait(sew_wait)}',
                        'waitSeconds': sew_wait,
                    }, ensure_ascii=False),
                }

            # Цех и смена, с материалами которых работает швея ПРЯМО СЕЙЧАС, берутся из
            # её открытой смены (shift_sessions), а не из заказа.
            #
            # Это принципиально для гостевого режима: швея из цеха №1 вышла работать
            # в цех №2, рулоны тесьмы у неё под руками — цеха №2, а заказ помечен цехом,
            # где его раскроили. Раньше рулон сверялся с цехом ЗАКАЗА, и гостю прилетало
            # «Рулон не принадлежит вашему цеху/смене» — списать тесьму он не мог вообще,
            # хотя физически держал рулон в руках. Сверяем с фактической сменой швеи.
            order_shift_number = None
            sewer_workshop_id = None
            if order_assigned_user_id:
                cur.execute(
                    "SELECT workshop_id, shift_number FROM shift_sessions "
                    "WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (order_assigned_user_id,),
                )
                session_row = cur.fetchone()
                if session_row:
                    sewer_workshop_id = session_row[0]
                    order_shift_number = session_row[1]
                if order_shift_number is None:
                    cur.execute("SELECT shift_number FROM users WHERE id = %s", (order_assigned_user_id,))
                    u_row = cur.fetchone()
                    order_shift_number = u_row[0] if u_row else None

            # Цех для сверки рулона: где швея работает сейчас, иначе — цех заказа.
            check_workshop_id = sewer_workshop_id or order_workshop_id

            cur.execute(
                "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
                (material, width, height),
            )
            item_row = cur.fetchone()
            if not item_row:
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({'error': 'Не найден товар маркетплейса для этого материала/размера'}),
                }
            marketplace_item_id = item_row[0]

            cur.execute("SELECT id FROM material_types WHERE name = 'Аксессуары'")
            acc_type_row = cur.fetchone()
            acc_type_id = acc_type_row[0] if acc_type_row else None

            cur.execute(
                "SELECT material_id, quantity FROM marketplace_item_materials WHERE marketplace_item_id = %s",
                (marketplace_item_id,),
            )
            needed = cur.fetchall()

            trim_material_id = None
            trim_qty_needed = None
            if acc_type_id:
                for material_id, qty in needed:
                    cur.execute("SELECT type_id FROM materials WHERE id = %s", (material_id,))
                    mt_row = cur.fetchone()
                    if mt_row and mt_row[0] == acc_type_id:
                        trim_material_id = material_id
                        trim_qty_needed = float(qty)
                        break

            if not trim_material_id:
                # sewer_user_id фиксирует, КТО именно отшил заказ — отдельно от
                # assigned_user_id, которое дальше будет использовано упаковщицей
                # только для начисления зарплаты, а сама привязка на orders не меняется.
                sewer_sql = f", sewer_user_id = {order_assigned_user_id}" if order_assigned_user_id else ""
                cur.execute(
                    # sewn_at — момент, когда швея реально сдала вещь. По нему считается
                    # её выработка за месяц (в том числе бонусная программа) и период
                    # на вкладке «Готовые». Раньше поле заполнялось только разовой
                    # миграцией по дате начисления зарплаты, а при новых сдачах
                    # оставалось пустым — выработка «терялась».
                    f"UPDATE orders SET sewing_status = 'Стикеровка', "
                    f"sewn_at = COALESCE(sewn_at, now()){sewer_sql} WHERE id = {int(item_id)}"
                )
                # Швея получает случайные варики (внутренняя игровая валюта, не финансы).
                award_variki(cur, order_assigned_user_id)
                log_action(
                    cur, actor_id, actor_name, 'send_to_stickering', 'order', item_id,
                    f'Отправил заказ #{item_id} на стикеровку',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            # Тесьма для этого товара нужна — рулон обязателен.
            if not roll_id_chosen:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Выберите рулон тесьмы'}),
                }

            cur.execute(
                "SELECT id, remaining_quantity, workshop_id, shift_number, accepted_at, "
                "defect_flagged_at FROM rolls WHERE id = %s "
                "AND material_id = %s AND status = 'in_workshop'",
                (int(roll_id_chosen), trim_material_id),
            )
            roll_row = cur.fetchone()
            if not roll_row:
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({'error': 'Выбранный рулон тесьмы не найден или недоступен'}),
                }
            # Рулон отгружен в цех, но смена его не приняла — работать нельзя.
            if roll_row[4] is None:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Рулон тесьмы ещё не принят сменой. Подтвердите приёмку, '
                                 'потом стикеруйте'
                    }, ensure_ascii=False),
                }
            if roll_row[5] is not None:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Рулон тесьмы отставлен как бракованный — работать с ним нельзя'
                    }, ensure_ascii=False),
                }
            if check_workshop_id and roll_row[2] != check_workshop_id:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Рулон не принадлежит вашему цеху/смене'}),
                }
            # Смену НЕ блокируем: гость пришёл в чужой цех и работает тем материалом,
            # который физически стоит рядом с ним, даже если коробку заводила другая
            # смена. Цех проверили выше — этого достаточно, чтобы человек не списал
            # материал из другого помещения. Факт работы за чужую смену просто
            # записываем в расход, чтобы он не приписался смене-владельцу материала.
            is_foreign_shift = bool(
                order_shift_number and roll_row[3] is not None
                and roll_row[3] != order_shift_number
            )
            roll_remaining = float(roll_row[1])
            if roll_remaining < trim_qty_needed:
                cur.execute("SELECT name, unit FROM materials WHERE id = %s", (trim_material_id,))
                mat_name, mat_unit = cur.fetchone()
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': f'{mat_name}: нужно {round(trim_qty_needed, 2)} {mat_unit}, '
                                  f'в рулоне осталось {round(roll_remaining, 2)} {mat_unit}'}
                    ),
                }

            # Атомарное вычитание: между проверкой остатка выше и этой записью
            # тесьму мог забрать другой заказ. Считает база, условие проверяется
            # в момент записи — иначе расход двух заказов затирал бы друг друга.
            cur.execute(
                "UPDATE rolls SET remaining_quantity = round(remaining_quantity - %s, 3), "
                "status = CASE WHEN remaining_quantity - %s <= 0 THEN 'completed' ELSE status END, "
                "completed_at = CASE WHEN remaining_quantity - %s <= 0 THEN now() ELSE completed_at END "
                "WHERE id = %s AND remaining_quantity >= %s "
                "RETURNING remaining_quantity",
                (trim_qty_needed, trim_qty_needed, trim_qty_needed,
                 roll_row[0], trim_qty_needed - 0.001),
            )
            if not cur.fetchone():
                conn.rollback()
                cur.execute("SELECT name, unit FROM materials WHERE id = %s", (trim_material_id,))
                t_row = cur.fetchone()
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'{t_row[0] if t_row else "Тесьма"}: материал разобрали, пока '
                                 f'шла стикеровка — нужно {round(trim_qty_needed, 2)} '
                                 f'{t_row[1] if t_row else ""}, столько уже нет. '
                                 f'Обновите экран и повторите'
                    }, ensure_ascii=False),
                }
            # Пишем, КТО и в какой смене реально израсходовал материал: у гостя это
            # смена цеха присутствия, а не смена-владелец коробки.
            actor_ws_sql = int(check_workshop_id) if check_workshop_id else 'NULL'
            actor_shift_sql = int(order_shift_number) if order_shift_number else 'NULL'
            actor_user_sql = int(order_assigned_user_id) if order_assigned_user_id else 'NULL'
            cur.execute(
                f"INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity, "
                f"actor_user_id, actor_workshop_id, actor_shift_number, is_foreign_shift) "
                f"VALUES ({int(item_id)}, {trim_material_id}, {roll_row[0]}, {trim_qty_needed}, "
                f"{actor_user_sql}, {actor_ws_sql}, {actor_shift_sql}, {str(is_foreign_shift).lower()})"
            )
            sewer_sql = f", sewer_user_id = {order_assigned_user_id}" if order_assigned_user_id else ""
            cur.execute(
                # sewn_at — момент сдачи вещи швеёй, см. пояснение выше.
                f"UPDATE orders SET sewing_status = 'Стикеровка', "
                f"sewn_at = COALESCE(sewn_at, now()){sewer_sql} WHERE id = {int(item_id)}"
            )
            # Швея получает случайные варики (внутренняя игровая валюта, не финансы).
            award_variki(cur, order_assigned_user_id)
            log_action(
                cur, actor_id, actor_name, 'send_to_stickering', 'order', item_id,
                f'Отправил заказ #{item_id} на стикеровку',
                {'rollId': roll_id_chosen},
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        if action in ('take_overlock', 'overlock_done'):
            # ЭТАП ОВЕРЛОКА.
            #
            # take_overlock   — швея-оверлочница берёт вещь из очереди «Оверлок».
            # overlock_done   — край обметан. Дальше два пути, их выбирает она сама:
            #     · 'to_sewing' (по умолчанию) — вещь возвращается в общую очередь
            #       «Раскроено» с отметкой «Обработан на оверлоке», и её разбирают
            #       обычные швеи на прямострочку;
            #     · 'finish' — работы по вещи больше нет, оверлочница закончила её
            #       целиком и отправляет сразу на стикеровку, минуя прямострочку.
            item_id = body_data.get('id')
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id заказа'})}

            # К оверлоку допускает админ галочкой в карточке сотрудника. Отдельной
            # должности нет: человек работает и на оверлоке, и на прямострочке.
            cur.execute(
                "SELECT role, COALESCE(can_overlock, false) FROM users WHERE id = %s",
                (int(actor_id),) if actor_id else (0,),
            )
            actor_row = cur.fetchone()
            if not actor_row or (actor_row[0] != 'admin' and not actor_row[1]):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Нет допуска к оверлоку. Обратитесь к администратору'},
                        ensure_ascii=False,
                    ),
                }

            cur.execute(
                "SELECT sewing_status, requires_overlock, overlocked_at, width, "
                "       workshop_id, order_number, overlock_user_id "
                "FROM orders WHERE id = %s",
                (int(item_id),),
            )
            o_row = cur.fetchone()
            if not o_row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
            (ov_status, ov_required, ov_done_at, ov_width,
             ov_workshop, ov_number, ov_user) = o_row

            if not ov_required:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Этой вещи оверлок не нужен'}, ensure_ascii=False
                    ),
                }

            if action == 'take_overlock':
                if ov_done_at:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Край уже обметан — вещь ушла дальше по конвейеру'},
                            ensure_ascii=False,
                        ),
                    }
                # Вещь уже взял кто-то другой: очередь общая, и два человека могли
                # нажать кнопку почти одновременно.
                if ov_user and int(ov_user) != int(actor_id or 0):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': 'Заказ уже взят другой швеёй'}, ensure_ascii=False
                        ),
                    }
                cur.execute(
                    f"UPDATE orders SET overlock_user_id = {int(actor_id)} WHERE id = {int(item_id)}"
                )
                log_action(
                    cur, actor_id, actor_name, 'take_overlock', 'order', item_id,
                    f'Взял заказ #{ov_number or item_id} на оверлок',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            # overlock_done — край обметан.
            if ov_done_at:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Заказ уже обработан на оверлоке'}, ensure_ascii=False
                    ),
                }
            if ov_status != 'Раскроено':
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': f'Обметать можно только раскроенную вещь, сейчас «{ov_status}»'},
                        ensure_ascii=False,
                    ),
                }

            # Оплата оверлочнице: за пог.м. ширины по тарифу цеха (role='overlock').
            # Цех берём у заказа, а если он ещё не проставлен — штатный цех
            # работницы: иначе ставка молча вышла бы нулевой и человек обметал
            # бы бесплатно. Такая же подстраховка стоит у раскроя и пошива.
            ov_rate_workshop = ov_workshop
            if not ov_rate_workshop:
                cur.execute(
                    "SELECT w.id FROM users u JOIN workshops w ON w.name = u.workshop "
                    "WHERE u.id = %s",
                    (int(actor_id),),
                )
                w_row = cur.fetchone()
                ov_rate_workshop = w_row[0] if w_row else None

            if ov_rate_workshop and ov_width:
                cur.execute(
                    "SELECT rate FROM salary_rates WHERE role = 'overlock' "
                    "AND material_id IS NULL AND width IS NULL AND workshop_id = %s",
                    (ov_rate_workshop,),
                )
                r_row = cur.fetchone()
                ov_rate = float(r_row[0]) if r_row else 0
                if ov_rate > 0:
                    ov_meters = round(float(ov_width) / 100, 2)
                    ov_amount = round(ov_meters * ov_rate, 2)
                    cur.execute(
                        "INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
                        "VALUES (%s, 'overlock_piece', %s, %s, %s) "
                        "ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING",
                        (
                            int(actor_id), ov_amount, int(item_id),
                            f'Оверлок заказа #{ov_number or item_id} - {ov_meters} пог.м.',
                        ),
                    )

            # Куда вещь уходит после обмётки — решает сама оверлочница.
            next_step = body_data.get('next') or 'to_sewing'
            if next_step == 'finish':
                # Работы по вещи больше нет: оверлочница закончила её целиком.
                # Отправляем сразу на стикеровку, минуя очередь прямострочки, и
                # проставляем её же швеёй — вещь отшила она.
                cur.execute(
                    f"UPDATE orders SET overlocked_at = now(), "
                    f"overlock_user_id = {int(actor_id)}, sewing_status = 'Стикеровка', "
                    f"sewn_at = COALESCE(sewn_at, now()), "
                    f"sewer_user_id = COALESCE(sewer_user_id, {int(actor_id)}) "
                    f"WHERE id = {int(item_id)}"
                )
                award_variki(cur, actor_id)
                log_action(
                    cur, actor_id, actor_name, 'overlock_done', 'order', item_id,
                    f'Обметал заказ #{ov_number or item_id} и сдал на стикеровку',
                )
            else:
                # Обычный путь: вещь возвращается в общую очередь «Раскроено» с
                # отметкой об оверлоке. assigned_user_id снимаем — вещь снова
                # ничья, её берёт следующая свободная швея в порядке очереди.
                cur.execute(
                    f"UPDATE orders SET overlocked_at = now(), "
                    f"overlock_user_id = {int(actor_id)}, sewing_status = 'Раскроено', "
                    f"assigned_user_id = NULL, taken_at = NULL WHERE id = {int(item_id)}"
                )
                log_action(
                    cur, actor_id, actor_name, 'overlock_done', 'order', item_id,
                    f'Обметал заказ #{ov_number or item_id} и передал на пошив',
                )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        if action == 'log_print_sheet':
            """Отмечает в журнале, что лист закройщика распечатан.

            ЗАЧЕМ. Бирка с номером заказа — единственное, чем крой отличается от
            такого же куска ткани рядом. Когда вещь теряется на вешалке, первый
            вопрос: печаталась ли на неё бирка вообще? Раньше ответа не было
            нигде — факт печати нигде не сохранялся, и разбор случая с заказом
            87011164-0186-1 занял час гаданий по косвенным признакам.

            Теперь в журнале остаётся запись: кто, когда и на какие заказы
            распечатал лист. Это не мешает работе: не записалось — печать всё
            равно идёт, лист важнее журнала.
            """
            order_ids = body_data.get('orderIds') or []
            kind = (body_data.get('kind') or 'stack').strip()
            if not order_ids:
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Нечего записывать'},
                                           ensure_ascii=False)}

            ids = [int(i) for i in order_ids if str(i).isdigit()][:200]
            if not ids:
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Неверные заказы'},
                                           ensure_ascii=False)}

            cur.execute(
                "SELECT order_number FROM orders WHERE id IN ("
                + ','.join(str(i) for i in ids) + ") ORDER BY id"
            )
            numbers = [r[0] for r in cur.fetchall() if r[0]]
            what = ('бирку на добранный заказ' if kind == 'single'
                    else f'лист на {len(ids)} заказов')
            log_action(
                cur, actor_id, actor_name, 'print_cutting_sheet', 'order', None,
                f'Распечатал {what}: ' + ', '.join(numbers[:30])
                + ('…' if len(numbers) > 30 else ''),
                {'orderIds': ids, 'kind': kind},
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'success': True})}

        if action == 'cancel_order':
            item_id = body_data.get('id')
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

            cur.execute(
                "SELECT sewing_status, workshop_id, assigned_user_id FROM orders WHERE id = %s",
                (int(item_id),),
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
            current_status, order_workshop_id, order_assigned_user_id = row

            if current_status == 'На раскрое':
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Новый', assigned_user_id = NULL, "
                    f"workshop_id = NULL WHERE id = {int(item_id)}"
                )
            elif current_status == 'В работе':
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Раскроено', assigned_user_id = NULL "
                    f"WHERE id = {int(item_id)}"
                )
            else:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': f'Заказ в статусе "{current_status}" нельзя отменить'}),
                }

            # Автоштраф сотруднику, отменившему заказ (cancel_order_penalty из настроек
            # цеха заказа) — начисляется сразу при отмене, защищён от дубля уникальным
            # индексом (order_id, type='penalty'), поэтому повторная отмена того же заказа
            # штраф не задвоит.
            penalty = get_setting_float(cur, order_workshop_id, 'cancel_order_penalty', 0)
            if penalty > 0 and order_assigned_user_id:
                apply_penalty(
                    cur, order_assigned_user_id, penalty,
                    f'Отмена заказа #{item_id}', order_id=item_id,
                )

            log_action(
                cur, actor_id, actor_name, 'cancel_order', 'order', item_id,
                f'Отменил заказ #{item_id} (был в статусе "{current_status}")',
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        if action == 'delete_order':
            item_id = body_data.get('id')
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
            cur.execute("SELECT status FROM orders WHERE id = %s", (int(item_id),))
            del_row = cur.fetchone()
            if not del_row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
            # Удаление заказа админом — это МЯГКАЯ отмена: заказ не стирается из базы, а
            # помечается status='Отменён' (в таблице он показывается зачёркнутым и остаётся
            # в истории). Так же поступает отмена заказа через API FBS маркетплейса.
            # Невыплаченные начисления зарплаты по этому заказу снимаются, выплаченные —
            # остаются в истории (order_id сохраняется, заказ ведь никуда не делся).
            cur.execute(
                "DELETE FROM salary_accruals WHERE order_id = %s AND paid_at IS NULL", (int(item_id),)
            )
            cur.execute(
                "UPDATE orders SET status = 'Отменён' WHERE id = %s", (int(item_id),)
            )
            log_action(
                cur, actor_id, actor_name, 'delete_order', 'order', item_id,
                f'Отменил (удалил) заказ #{item_id}',
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
    finally:
        conn.close()
