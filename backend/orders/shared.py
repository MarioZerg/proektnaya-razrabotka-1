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
CANCELLED_SQL = (
    "o.status = 'Отменён' OR o.sewing_status = 'Отменён' "
    "OR o.cancelled_at IS NOT NULL "
    "OR COALESCE(o.ozon_status, '') ILIKE 'cancel%' "
    "OR COALESCE(o.ym_status, '') ILIKE '%CANCEL%'"
)

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

    shortages = []
    write_offs = []
    for material_id, qty_needed in needed:
        qty_needed = float(qty_needed)
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
