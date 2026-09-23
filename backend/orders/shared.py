"""Конвейер заказов — общие части: лимиты выдачи, справочники и функции,
которыми пользуются и чтение, и действия.

Вынесено из index.py: в одном файле было 3454 строки, и любая правка требовала
листать его целиком. Код перенесён КАК ЕСТЬ, логика не менялась.
"""

import json
import random
from datetime import datetime, timedelta, timezone

# Сколько ЗАКРЫТЫХ заказов («Готовые», «Со склада») отдаём в общий список конвейера.
#
# АКТИВНЫЕ заказы отдаются ВСЕ и лимитом не ограничены — это работа цеха, она не
# может «не поместиться». Раньше активные и закрытые делили один лимит на всех, и это
# была мина замедленного действия: закрытых копится по сотне в день, и однажды они
# вытеснили бы рабочие заказы — цех перестал бы видеть то, что нужно шить.
#
# История же нужна не вся: кладовщику важно найти вещь, застикерованную на днях, и
# собрать по ней поставку. Более старое ищется поиском по номеру заказа: он идёт в
# базу напрямую, мимо этого лимита.
#
# 1200 оказалось мало: столько закрытых заказов набегает примерно за две недели, и
# вкладка «Выполненные» показывала обрывок — менеджер не находил вещь, отгруженную
# в начале месяца.
#
# Но и задирать лимит нельзя: платформа обрывает ответ больше 3.5 МБ, и раздел
# тогда не открывается ВООБЩЕ — вместо неполной истории менеджер получает пустой
# экран. Это хуже короткой истории, поэтому считаем по факту.
#
# Замер на боевых данных: строка ответа весит ~1.5 КБ (а не 1.25 КБ, как считалось
# при подборе прежнего лимита — в заказе прибавилось полей: магазин, оверлок, отмена).
# Сверх истории идут активные заказы (~320) и отменённые (300).
#
# 1500 закрытых давали ~2200 строк и 3.74 МБ — выше потолка платформы в 3.5 МБ, и
# функция возвращала 502 вместо данных: конвейер у закройщицы не открывался вообще.
# 1100 — это ~1700 строк и около 2.6 МБ, запас до потолка примерно 25%.
#
# Это по-прежнему больше месяца закрытых заказов на одного человека: швее и
# закройщику история приходит только их собственная (см. history_filter ниже).
CLOSED_ORDERS_LIMIT = 1100

# Сколько ОТМЕНЁННЫХ заказов отдаём. Отмены разбирают свежими: по ним смотрят, за
# что мы платим маркетплейсу и что делать с вещью, которая уже сшита. Отмена
# полугодовой давности не нужна никому, а вес в ответе занимает.
#
# 300 — это примерно три недели отмен при нынешнем потоке. Раньше их показывалось 149
# ЗА ВСЁ ВРЕМЯ (считались только по нашему полю), так что видно станет вдвое больше.
# Пятьсот пробовали, но вместе с историей ответ перевалил за потолок платформы.
CANCELLED_ORDERS_LIMIT = 300

# ЧТО СЧИТАЕТСЯ ОТМЕНЁННЫМ ЗАКАЗОМ.
#
# Отменяет покупатель — на стороне площадки. К нам это приезжает статусом
# маркетплейса (ozon_status='cancelled', ym_status='...CANCELLED'), а наш
# собственный status остаётся прежним: «Новый», «Отгружен» — какой был.
#
# Поэтому судить об отмене только по нашему полю нельзя: по нему отменённых
# полторы сотни, а по статусам площадок — почти полторы тысячи. Условие одно
# на весь файл, чтобы вкладка «Отменённые», выборка истории и признак в строке
# считались одинаково и не разъезжались.
def cancelled_sql(alias: str = 'o') -> str:
    """Условие отмены для запроса с псевдонимом таблицы или без него (FROM orders).

    Очереди раскроя и пошива написаны без алиаса, и раньше они проверяли отмену
    только по нашему полю status. Из-за этого отменённый покупателем заказ
    (ozon_status='cancelled', а наш status остался «Новый») спокойно уезжал
    закройщику в стек: ткань резали на вещь, которую никто не ждёт.

    Внутри НЕТ знака процента, хотя по смыслу это поиск по началу и по вхождению.
    Процент в тексте запроса psycopg2 принимает за место для подстановки значения,
    и запрос с параметрами (а очередь раскроя именно такая) падал бы на ровном
    месте. strpos делает то же самое и без ловушки.
    """
    p = f'{alias}.' if alias else ''
    return (
        f"{p}status = 'Отменён' OR {p}sewing_status = 'Отменён' "
        f"OR {p}cancelled_at IS NOT NULL "
        # 'cancelled', 'cancelled_from_split' и прочие варианты OZON — всё, что
        # начинается на cancel.
        f"OR strpos(lower(COALESCE({p}ozon_status, '')), 'cancel') = 1 "
        # У Яндекса слово стоит в середине: 'CANCELLED_BEFORE_PROCESSING'.
        f"OR strpos(upper(COALESCE({p}ym_status, '')), 'CANCEL') > 0"
    )


CANCELLED_SQL = cancelled_sql('o')

# ПОТОЛОК ОТВЕТА ПЛАТФОРМЫ — 3.5 МБ. Больше него функция не отдаёт НИЧЕГО: вместо
# данных прилетает 502 JobResponseTooLong, и страница остаётся пустой.
#
# Ровно это и случилось у закройщицы. Расчёт лимитов выше делался по средней строке
# в 1.25 КБ, а реальная оказалась 1.5 КБ: у заказов появились названия магазинов,
# признак оверлока, отмены. 2200 строк × 1.5 КБ = 3.74 МБ — на 70 КБ выше потолка.
# Конвейер не открылся совсем: заказов нет, значит нет и «На раскрое», а вместе с
# ними пропала кнопка «Распечатать задание» — печатать было нечего.
#
# Считать вес заранее по «средней строке» — гадание: оно уже дало сбой. Поэтому вес
# меряется по факту на собранном ответе, и если он не помещается — отрезается хвост
# ИСТОРИИ. Работа цеха при этом не страдает: активные заказы стоят в начале списка
# (ORDER BY ставит их первыми) и обрезаются последними.
RESPONSE_LIMIT_BYTES = 3_670_016

# Запас под служебные поля ответа и возможную разницу кодировок: режем не впритык
# к потолку, а с небольшим зазором — иначе очередное новое поле снова упрёт в 502.
RESPONSE_SAFE_BYTES = 3_300_000


def _fit_orders_body(orders):
    """Собирает тело ответа, укладываясь в потолок платформы.

    Пока ответ тяжелее допустимого, отбрасывает хвост списка — это закрытая
    история и старые отмены, они идут последними. Активные заказы цеха стоят в
    начале и остаются на месте при любой обрезке: конвейер обязан открыться,
    даже если истории не хватило места.
    """
    body = json.dumps({'orders': orders})
    if len(body.encode('utf-8')) <= RESPONSE_SAFE_BYTES:
        return body

    # Урезаем долю хвоста пропорционально перевесу и добиваем шагами по 10%:
    # пересобирать JSON построчно на двух тысячах заказов слишком дорого.
    kept = orders
    while kept and len(body.encode('utf-8')) > RESPONSE_SAFE_BYTES:
        ratio = RESPONSE_SAFE_BYTES / len(body.encode('utf-8'))
        keep_count = max(1, int(len(kept) * ratio * 0.9))
        if keep_count >= len(kept):
            keep_count = len(kept) - 1
        kept = kept[:keep_count]
        body = json.dumps({'orders': kept})
    return body


def award_variki(cur, user_id):
    """Начисляет швее случайное число вариков (1-12) за отшитый заказ — внутренняя игровая
    валюта (не финансы). Возвращает начисленное количество."""
    if not user_id:
        return 0
    amount = random.randint(1, 12)
    cur.execute(
        "UPDATE users SET variki = COALESCE(variki, 0) + %s WHERE id = %s",
        (amount, int(user_id)),
    )
    return amount


def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description, details=None):
    """Пишет запись в журнал действий (audit_log). Вызывается в той же транзакции,
    что и само изменение, непосредственно перед conn.commit()."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'production',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
            json.dumps(details) if details else None,
        ),
    )


STATUS_ORDER = ['Новый', 'На раскрое', 'Раскроено', 'В работе', 'Стикеровка', 'Готовые']


def take_cancelled_cut(cur, order_id) -> dict | None:
    """Отдаёт новому заказу готовый крой от ОТМЕНЁННОГО заказа того же размера.

    ЗАЧЕМ. Покупатель отменяет заказ уже после раскроя: ткань разрезана по его
    размеру и в рулон не вернётся. Такой крой висит на вешалке и дошивается «на
    склад» — вещь ложится на полку и ждёт, пока под неё найдётся покупатель.
    Если ровно в этот момент приходит новый заказ того же размера и материала,
    шить его с нуля незачем — подходящий крой уже висит в цехе.

    Передаём крой новому заказу: он сразу встаёт в очередь «Раскроено», швея
    берёт его как обычную работу, и на склад ничего лишнего не уезжает.

    ПОЧЕМУ ЭТО НЕ ТО ЖЕ САМОЕ, ЧТО ПОДБОР СО СКЛАДА. Подбор (match_from_stock)
    ищет ГОТОВУЮ вещь на полке — её остаётся только отстикеровать. Здесь вещи
    ещё нет: есть разрезанная ткань, которую надо отшить. Поэтому заказ идёт не
    в «Со склада», а в «Раскроено» — на конвейер, к швеям.

    ПОРЯДОК ВАЖЕН: сначала подбор со склада (готовая вещь лучше кроя), и только
    если готовой нет — эта функция.

    БИРКА НА ВЕШАЛКЕ ОСТАЁТСЯ СО СТАРЫМ НОМЕРОМ.

    Перепечатать её некому: заказы приходят круглосуточно, в том числе ночью.
    Поэтому храним обе ссылки (cut_from_order_id / cut_given_to_order_id): по
    ним швея видит на экране, с какой биркой искать крой, а терминал стикеровки
    находит новый заказ по отсканированной старой бирке.

    Возвращает данные переданного кроя (для журнала) или None.
    """
    cur.execute(
        "SELECT product, material, width, height, workshop_id, order_type "
        "FROM orders WHERE id = %s",
        (int(order_id),),
    )
    row = cur.fetchone()
    if not row:
        return None
    product, material, width, height, workshop_id, order_type = row
    # Без размеров сопоставить крой не с чем: ткань режется ровно по ним.
    if not product or not material or not width or not height:
        return None

    cur.execute(
        "SELECT o.id, o.order_number, o.cut_at, o.cutter_user_id, o.hanger_number, "
        "       o.workshop_id, o.requires_overlock, o.overlocked_at, o.overlock_user_id "
        "FROM orders o "
        "WHERE o.sewing_status = 'Раскроено' "
        # Крой ещё никому не передан: иначе одну вешалку отдали бы двум заказам.
        "  AND o.cut_given_to_order_id IS NULL "
        # Только ОТМЕНЁННЫЕ: живой заказ ждёт свой покупатель, его крой не трогаем.
        f"  AND ({cancelled_sql('o')}) "
        # Размер и материал совпадают ТОЧНО. Ткань разрезана под конкретную вещь:
        # из кроя 300x255 штору 400x265 не сшить, и «почти подходит» тут не бывает.
        "  AND o.product = %s "
        "  AND o.material = %s AND o.width = %s AND o.height = %s "
        # Крой физически висит в своём цехе — в чужой его никто не понесёт.
        # Заказы без цеха (ручные, из старой базы) подходят любому.
        "  AND (o.workshop_id = %s OR o.workshop_id IS NULL OR %s IS NULL) "
        "  AND o.id <> %s "
        # Первым отдаём самый давний крой: он дольше всех висит на вешалке.
        "ORDER BY o.cut_at ASC NULLS LAST, o.id ASC LIMIT 1 "
        # Два заказа одного размера могут прийти одной секундой — без блокировки
        # обоим достался бы один и тот же крой.
        "FOR UPDATE OF o SKIP LOCKED",
        (
            product, material, int(width), int(height),
            workshop_id, workshop_id, int(order_id),
        ),
    )
    cut = cur.fetchone()
    if not cut:
        return None
    (cut_id, cut_number, cut_at, cutter_id, hanger, cut_workshop,
     req_overlock, overlocked_at, overlock_user) = cut

    # НОВЫЙ ЗАКАЗ ВСТАЁТ В ОЧЕРЕДЬ «РАСКРОЕНО» — КАК ОБЫЧНАЯ РАБОТА.
    #
    # Переносим на него всё, что относится к физическому крою: время раскроя,
    # закройщика, вешалку, цех и этап оверлока. Швея должна увидеть вещь ровно
    # такой, какой она висит в цехе.
    #
    # cut_at берём СТАРЫЙ, а не now(): по нему считается очередь пошива и
    # выработка закройщика. Поставив текущее время, мы бы приписали работу
    # сегодняшней смене и подвинули вещь в конец очереди, хотя крой давно готов.
    cur.execute(
        "UPDATE orders SET sewing_status = 'Раскроено', "
        "  cut_at = %s, cutter_user_id = %s, hanger_number = %s, "
        "  workshop_id = COALESCE(%s, workshop_id), "
        "  requires_overlock = %s, overlocked_at = %s, overlock_user_id = %s, "
        "  cut_from_order_id = %s "
        "WHERE id = %s",
        (
            cut_at, cutter_id, hanger or 0, cut_workshop,
            bool(req_overlock), overlocked_at, overlock_user,
            int(cut_id), int(order_id),
        ),
    )

    # СТАРЫЙ ЗАКАЗ ОТДАЛ СВОЙ КРОЙ И УХОДИТ ИЗ РАБОТЫ.
    #
    # Статус меняем на «Готовые»: для цеха по нему работы больше нет — вещь из
    # этой ткани сошьют, но уже под новым номером. Без смены статуса он остался
    # бы висеть в очереди «Раскроено» и его крой попытались бы отдать второй раз.
    cur.execute(
        "UPDATE orders SET cut_given_to_order_id = %s, sewing_status = 'Готовые' "
        "WHERE id = %s",
        (int(order_id), int(cut_id)),
    )

    # Списание ткани остаётся на СТАРОМ заказе — материал ушёл именно там, и
    # переносить расход нельзя: иначе рулон сойдётся неверно. Новый заказ
    # закрывается без своего списания, ткань за него уже потрачена.
    return {
        'cutOrderId': int(cut_id),
        'cutOrderNumber': cut_number,
        'product': product,
        'hangerNumber': hanger,
        'orderType': order_type,
    }


def write_off_materials_once(cur, order_id, material, width, height, workshop_id=None):
    """Списывает материалы заказа по FIFO ОДИН раз (для случая, когда админ двигает статус
    заказа, а не проходит обычный конвейер раскроя). Если по заказу уже есть списания
    (order_material_usage) — ничего не делает. При нехватке материала возвращает текст ошибки,
    иначе None. Списывает все материалы товара (тюль + аксессуары) из рулонов ЦЕХА.

    РАСХОД ИДЁТ ТОЛЬКО ВНУТРИ ЦЕХА. Складские рулоны не трогаем никогда: пока
    кладовщик не отгрузил материал в цех и смена его не приняла, этого материала
    у людей физически нет. Раньше склад шёл в общий котёл, и заказы «списывались»
    с рулонов, которые лежали на складе нетронутыми: у цеха остаток не убывал,
    а на складе таял материал, к которому никто не подходил.

    ЗАКАЗ ЗАКРЫВАЮТ КУСКОМ — РУЛОН НЕ РАСХОДУЕТСЯ ВООБЩЕ.

    За заказом может быть закреплён отрез с перешива. На обычном конвейере это
    учитывалось (см. раскрой в orders_actions), а здесь — нет: админ двигал
    статус, и ткань молча списывалась с рулона ПОВЕРХ уже лежащего на столе
    куска. Один заказ съедал материал дважды: остаток рулона уезжал вниз на
    штору, которую из него не резали, а кусок навсегда зависал в 'reserved' —
    из перешива пропал, в расход не попал, вернуть некому.

    Поэтому при закреплённом куске ткань из расхода исключается целиком, сам
    кусок переводится в 'used', а в order_material_usage появляется запись
    БЕЗ roll_id: по ней в карточке видно, что метры взяты не с рулона, и
    себестоимость вещи не оказывается нулевой по ткани. Аксессуары и упаковка
    списываются как обычно — их перешив не заменяет.
    """
    # Уже списывали по этому заказу — расход идёт один раз (при откате статуса не трогаем).
    cur.execute("SELECT 1 FROM order_material_usage WHERE order_id = %s LIMIT 1", (order_id,))
    if cur.fetchone():
        return None

    if not (material and width and height):
        return None

    cur.execute(
        "SELECT id FROM marketplace_items WHERE material = %s AND width = %s AND height = %s LIMIT 1",
        (material, width, height),
    )
    item_row = cur.fetchone()
    if not item_row:
        return None
    cur.execute(
        "SELECT material_id, quantity FROM marketplace_item_materials WHERE marketplace_item_id = %s",
        (item_row[0],),
    )
    needed = cur.fetchall()
    if not needed:
        return None

    # Закреплён ли за заказом кусок с перешива. Берём и 'reserved', и 'used':
    # раскроенный кусок означает ровно то же самое — ткань уже взята не с
    # рулона, и списывать её повторно нельзя ни при каком порядке действий.
    cur.execute(
        "SELECT id, status FROM repair_fabric_pieces "
        "WHERE used_order_id = %s AND status IN ('reserved', 'used') "
        "ORDER BY CASE status WHEN 'reserved' THEN 0 ELSE 1 END, id DESC LIMIT 1 "
        "FOR UPDATE",
        (int(order_id),),
    )
    piece_row = cur.fetchone()
    repair_piece_id = piece_row[0] if piece_row else None

    # Какой из материалов товара — ткань. Только её заменяет кусок: тесьму и
    # упаковку вещь расходует независимо от того, откуда взято полотно.
    fabric_material_id = None
    if repair_piece_id:
        cur.execute("SELECT id FROM material_types WHERE name = 'Тюль'")
        t_row = cur.fetchone()
        tul_type_id = t_row[0] if t_row else None
        if tul_type_id:
            for mat_id, _qty in needed:
                cur.execute("SELECT type_id FROM materials WHERE id = %s", (mat_id,))
                mt_row = cur.fetchone()
                if mt_row and mt_row[0] == tul_type_id:
                    fabric_material_id = mat_id
                    break

    shortages = []
    write_offs = []
    repair_fabric_qty = 0.0
    for material_id, qty_needed in needed:
        qty_needed = float(qty_needed)

        if repair_piece_id and fabric_material_id and material_id == fabric_material_id:
            # Ткань пришла с перешива — с рулона не снимаем ни метра.
            # Норму запоминаем: ниже она ляжет в расход записью без рулона.
            repair_fabric_qty = qty_needed
            continue

        cur.execute(
            "SELECT id, remaining_quantity FROM rolls "
            # Только рулоны В ЦЕХЕ и только ПРИНЯТЫЕ сменой: склад в расход не идёт,
            # а рулон «в пути» мог не доехать. Бракованный тоже не берём — закройщик
            # его отставил, судьбу решает кладовщик.
            "WHERE material_id = %s AND remaining_quantity > 0 "
            "AND defect_flagged_at IS NULL "
            "AND status = 'in_workshop' AND accepted_at IS NOT NULL "
            "AND (%s IS NULL OR workshop_id = %s) "
            "ORDER BY created_at ASC",
            (material_id, workshop_id, workshop_id),
        )
        available_rolls = cur.fetchall()
        total_available = sum(float(r[1]) for r in available_rolls)
        if total_available < qty_needed:
            cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
            mat_name, mat_unit = cur.fetchone()
            shortages.append(f"{mat_name}: нужно {round(qty_needed, 2)} {mat_unit}, "
                             f"в цехе {round(total_available, 2)} {mat_unit}")
            continue
        remaining_to_take = qty_needed
        for roll_id, roll_remaining in available_rolls:
            if remaining_to_take <= 0:
                break
            take = min(float(roll_remaining), remaining_to_take)
            write_offs.append((roll_id, material_id, take))
            remaining_to_take -= take

    if shortages:
        return 'Не хватает материала в цехе: ' + '; '.join(shortages)

    # Вычитает база, одним запросом: между подсчётом write_offs выше и записью
    # материал мог уйти в раскрой. «Прочитал → посчитал → записал» в этом месте
    # затирал чужой расход, и остаток на рулоне переставал сходиться с фактом.
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
            cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
            m_row = cur.fetchone()
            return (f'{m_row[0] if m_row else "Материал"}: не хватило '
                    f'{round(take, 2)} {m_row[1] if m_row else ""} — материал разобрали, '
                    f'пока шло списание')
        cur.execute(
            "INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) VALUES (%s, %s, %s, %s)",
            (int(order_id), material_id, roll_id, take),
        )

    # КУСОК С ПЕРЕШИВА ПОШЁЛ В ДЕЛО — резерв становится расходом.
    #
    # Раньше этого здесь не было: кусок оставался в 'reserved' у закрытого
    # заказа навсегда. В перешиве он не виден (значит, никто его не возьмёт),
    # в расходе его нет (значит, ткань вещи выглядела взятой ниоткуда), и
    # открепить его невозможно — заказ давно ушёл с раскроя. Отрез просто
    # исчезал из учёта, оставаясь физически в цехе.
    #
    # Запись БЕЗ roll_id — это и есть ответ «из чего сделана вещь»: рулон не
    # тронут, а норма ткани в себестоимости учтена. Сам след «какой именно
    # кусок» остаётся в repair_fabric_pieces.used_order_id и виден в карточке.
    if repair_piece_id:
        cur.execute(
            "UPDATE repair_fabric_pieces SET status = 'used', "
            "  used_at = COALESCE(used_at, now()) "
            "WHERE id = %s AND status = 'reserved'",
            (repair_piece_id,),
        )
        if fabric_material_id and repair_fabric_qty > 0:
            cur.execute(
                "INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
                "VALUES (%s, %s, NULL, %s)",
                (int(order_id), fabric_material_id, round(repair_fabric_qty, 3)),
            )
    return None


def can_work_as(cur, actor_id, needed_role):
    """Может ли сотрудник выполнять работу этой должности прямо сейчас.

    В цехе совмещают: Елена Привезенцева оформлена швеёй, но у неё утверждены
    ОБЕ должности — швея и закройщик. Смену она открыла закройщиком, а шьёт.

    Раньше должность брали только из открытой смены, и таким людям система
    отказывала: «отправлять на стикеровку может только швея» — при том что
    швеёй человек и оформлен, и утверждён. Работа вставала на ровном месте.

    Поэтому проверяем ТРИ источника и достаточно любого:
      · должность в открытой смене — кем человек вышел работать;
      · должность в карточке — кем он оформлен;
      · утверждённые должности — что ему вообще разрешено делать.

    Админ может всё.
    """
    if not actor_id:
        # Без сотрудника проверять нечего: такие вызовы приходят из киоска и
        # проверяются иначе. Не блокируем.
        return True

    roles = set()

    cur.execute(
        "SELECT role FROM shift_sessions WHERE user_id = %s "
        "AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
        (int(actor_id),),
    )
    row = cur.fetchone()
    if row and row[0]:
        roles.add(row[0])

    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    if row and row[0]:
        roles.add(row[0])

    cur.execute(
        "SELECT role FROM user_roles WHERE user_id = %s AND is_approved = true",
        (int(actor_id),),
    )
    roles.update(r[0] for r in cur.fetchall() if r[0])

    return 'admin' in roles or needed_role in roles


def get_setting(cur, workshop_id, key, default=None):
    """Читает значение настройки: сначала переопределение цеха (workshop_settings),
    если его нет — глобальное значение (system_settings), если и его нет — default.
    Возвращает строку (как хранится в БД) или default."""
    if workshop_id:
        cur.execute(
            "SELECT value FROM workshop_settings WHERE workshop_id = %s AND key = %s",
            (int(workshop_id), key),
        )
        row = cur.fetchone()
        if row and row[0] not in (None, ''):
            return row[0]
    cur.execute("SELECT value FROM system_settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if row and row[0] not in (None, ''):
        return row[0]
    return default


def get_setting_float(cur, workshop_id, key, default=0.0):
    val = get_setting(cur, workshop_id, key, None)
    try:
        return float(val) if val not in (None, '') else default
    except (TypeError, ValueError):
        return default


def get_setting_int(cur, workshop_id, key, default=0):
    val = get_setting(cur, workshop_id, key, None)
    try:
        return int(val) if val not in (None, '') else default
    except (TypeError, ValueError):
        return default



def ozon_cutoff_passed(cur, workshop_id):
    """Прошло ли время, после которого OZON уходит в конец очереди.

    Машина на ПВЗ уезжает раз в день (у нас в 12:30), и всё, что сшито после отсечки,
    на неё уже не попадёт — вещь пролежит до завтра. А заказы WB и Яндекса отгружаются
    иначе и от этой машины не зависят.

    Поэтому после отсечки (по умолчанию 11:00 МСК) конвейер сначала отдаёт WB и Яндекс:
    их работу можно закрыть сегодня. OZON при этом НЕ запрещён — если другой работы нет,
    швея спокойно берёт его и шьёт, просто вещь уедет завтрашней машиной. Простоя нет.

    Настройки цеха:
      ozon_cutoff_enabled — 'true'/'false', контролировать выдачу по времени;
      ozon_cutoff_time    — время отсечки в МСК, например '11:00'.

    Возвращает True, если сейчас позже отсечки и правило включено.
    """
    enabled = (get_setting(cur, workshop_id, 'ozon_cutoff_enabled', 'false') or 'false').strip().lower()
    if enabled not in ('true', 'yes', '1'):
        return False

    raw = (get_setting(cur, workshop_id, 'ozon_cutoff_time', '11:00') or '11:00').strip()
    try:
        parts = raw.split(':')
        cutoff_h = int(parts[0])
        cutoff_m = int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return False
    if not (0 <= cutoff_h <= 23 and 0 <= cutoff_m <= 59):
        return False

    # Время в базе хранится в UTC, а цех живёт по московскому — сравниваем в МСК.
    cur.execute("SELECT (now() + interval '3 hours')::time")
    now_msk = cur.fetchone()[0]
    return (now_msk.hour, now_msk.minute) >= (cutoff_h, cutoff_m)


def apply_penalty(cur, user_id, amount, description, order_id=None):
    """Начисляет автоматический штраф сотруднику (salary_accruals, type='penalty') —
    отрицательная сумма, как и у ручных штрафов через backend/salary. Если order_id указан,
    защищено уникальным индексом (order_id, type) — повторный штраф за тот же заказ не
    создастся (ON CONFLICT DO NOTHING)."""
    if amount <= 0 or not user_id:
        return
    penalty_amount = -abs(float(amount))
    description_esc = description.replace("'", "''")
    order_sql = str(int(order_id)) if order_id else 'NULL'
    conflict_sql = "ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING" if order_id else ""
    cur.execute(
        f"INSERT INTO salary_accruals (user_id, type, amount, order_id, description) "
        f"VALUES ({int(user_id)}, 'penalty', {penalty_amount}, {order_sql}, '{description_esc}') "
        f"{conflict_sql}"
    )


TIMEOUT_WIDTHS = [200, 300, 400, 500, 600, 700, 800]


def nearest_timeout_width(width):
    """Подбирает ближайшую ширину из списка timeout_200..800 (снизу вверх) для заданной
    ширины товара — используется, чтобы взять из настроек цеха соответствующий timeout_XXX."""
    if not width:
        return None
    for w in TIMEOUT_WIDTHS:
        if width <= w:
            return w
    return TIMEOUT_WIDTHS[-1]


def sewing_wait_for_order(cur, workshop_id, width, taken_at):
    """Сколько секунд ещё шить ЭТУ вещь, прежде чем сдать её на стикеровку.

    Время берётся из настроек цеха по ширине изделия (timeout_200…800, в МИНУТАХ) и
    отсчитывается от момента, когда швея взяла заказ в работу. Пока отсчёт идёт,
    кнопка «Отправить на стикеровку» у этой вещи заблокирована.

    Так темп задаёт сама работа: широкое полотно шьётся дольше узкого, и система
    считает время по конкретной вещи, а не общим счётчиком за смену. Раньше таймер
    был накопительным от первого заказа смены — к вечеру он разрастался до часа и
    переставал отражать реальность.

    Возвращает (wait_sec, next_at_iso): сколько секунд осталось (0 — можно сдавать) и
    момент разблокировки в ISO, по которому фронт тикает сам, не дёргая сервер.
    """
    if not taken_at:
        return 0, None
    bucket = nearest_timeout_width(width)
    if not bucket:
        return 0, None
    minutes = get_setting_int(cur, workshop_id, f'timeout_{bucket}', 0)
    if minutes <= 0:
        return 0, None

    cur.execute("SELECT EXTRACT(EPOCH FROM (now() - %s))::float", (taken_at,))
    elapsed = float(cur.fetchone()[0] or 0)
    wait_sec = int(round(minutes * 60 - elapsed))
    if wait_sec <= 0:
        return 0, None
    next_at = datetime.now(timezone.utc) + timedelta(seconds=wait_sec)
    return wait_sec, next_at.isoformat()


def format_wait(wait_sec):
    """Человеческая запись остатка ожидания: до минуты — в секундах, дальше — мин. сек."""
    if wait_sec < 60:
        return f'{wait_sec} сек.'
    return f'{wait_sec // 60} мин. {wait_sec % 60} сек.'


# Сколько вещей связки раскраиваем за один вызов функции. Раскрой одной вещи — это десятки
# запросов к базе, поэтому большую связку обрабатываем порциями, иначе упираемся в лимит
# времени выполнения. Для закройщика это незаметно: фронтенд повторяет вызов автоматически.
GROUP_CUT_BATCH = 6


# ТКАНИ, КОТОРЫЕ РВУТСЯ ПО НИТКЕ, — РЕЖУТСЯ БЫСТРО.
#
# Вуаль, бамбук, молния, лён и шифон закройщик надрезает и рвёт: полотно идёт
# ровно по нити, ножницы почти не нужны. Такая вещь готова за считанные минуты.
FAST_TEAR_MATERIALS = ('Вуаль', 'Бамбук', 'Молния', 'Лен', 'Шифон')

# ТКАНИ, КОТОРЫЕ РЕЖУТСЯ ТОЛЬКО НОЖНИЦАМИ, — ДОЛГИЕ.
#
# Сетка и мрамор по нитке не рвутся, их ведут ножницами по всей длине. Одна
# такая вещь съедает столько же времени, сколько несколько «рвущихся».
SLOW_CUT_MATERIALS = ('Сетка', 'Мрамор')


def _materials_in_sql(names) -> str:
    """Список названий тканей как SQL-перечисление для IN (...)."""
    return ','.join("'" + n.replace("'", "''") + "'" for n in names)


# Со скольких суток заказ считается залежавшимся и перестаёт уступать очередь.
CUT_OVERDUE_DAYS = 2


def cut_speed_order_sql(column: str = 'material', overdue_expr: str = None) -> str:
    """Кусок ORDER BY: быстрые ткани вперёд, долгие — в конец.

    ЗАЧЕМ ЭТО НУЖНО. Закройщик один, а швей несколько, и пока он ведёт ножницами
    метры сетки, швеи сидят без работы. Если же первым идёт то, что рвётся по
    нитке, за то же время он отдаёт в пошив в разы больше вещей — конвейер не
    простаивает.

    ПОЧЕМУ ЭТО НЕ ПРЕВРАЩАЕТСЯ В «СЕТКУ НЕ РЕЖЕМ НИКОГДА». Для залежавшихся
    заказов правило ткани ОТКЛЮЧАЕТСЯ: всем им присваивается один и тот же
    уровень, и между собой они идут просто по дате. Иначе двухдневная сетка
    продолжала бы пропускать вперёд свежую вуаль и так и не доходила бы до
    раскроя.

    overdue_expr — условие «заказ залежался». Если передано, у таких заказов
    ткань на порядок не влияет.

    Уровни: «рвущиеся» (0), прочие (1), «ножничные» (2).
    """
    fast = _materials_in_sql(FAST_TEAR_MATERIALS)
    slow = _materials_in_sql(SLOW_CUT_MATERIALS)
    overdue_case = f"WHEN {overdue_expr} THEN 0 " if overdue_expr else ""
    return (
        f"(CASE {overdue_case}"
        f"      WHEN {column} IN ({fast}) THEN 0 "
        f"      WHEN {column} IN ({slow}) THEN 2 "
        f"      ELSE 1 END) ASC, "
    )


def cut_queue_order_sql(date_expr: str = 'COALESCE(marketplace_created_at, created_at)',
                        column: str = 'material') -> str:
    """Порядок очереди на раскрой — общий для выдачи стека и предпросмотра.

    Уровни, сверху вниз:

    1. ЗАЛЕЖАВШИЕСЯ ЗАКАЗЫ (старше двух суток) — вперёд всех, независимо от
       ткани. Это страховка: без неё сетка и мрамор откладывались бы каждый
       день в пользу свежей вуали и в итоге сорвали бы отгрузку. Между собой
       такие заказы идут строго по дате — ткань здесь уже ничего не решает.
    2. FBS — жёсткое правило по всему конвейеру, сроки отгрузки сжатые.
    3. СКОРОСТЬ РАСКРОЯ — рвущиеся ткани раньше ножничных, чтобы швеи не ждали.
       Действует только на свежих заказах.
    4. Дата заказа у покупателя — кто ждёт дольше, тот раньше.
    5. Связки и позиция в них, id — как и раньше.

    Порядок уровней важен: «старое» стоит ВЫШЕ скорости раскроя, иначе первое
    правило не сработало бы вовсе.
    """
    overdue = f"{date_expr} < now() - interval '{CUT_OVERDUE_DAYS} days'"
    return (
        f"({overdue}) DESC, "
        "(order_type = 'FBS') DESC, "
        + cut_speed_order_sql(column, overdue) +
        f"{date_expr} ASC, "
        "group_key NULLS FIRST, group_position ASC NULLS LAST, id ASC"
    )