import json
import os
import random

import psycopg2

# Сколько ЗАКРЫТЫХ заказов («Готовые», «Со склада») отдаём в общий список конвейера.
#
# АКТИВНЫЕ заказы отдаются ВСЕ и лимитом не ограничены — это работа цеха, она не
# может «не поместиться». Раньше активные и закрытые делили один лимит на всех, и это
# была мина замедленного действия: закрытых копится по сотне в день, и однажды они
# вытеснили бы рабочие заказы — цех перестал бы видеть то, что нужно шить.
#
# История же нужна не вся: кладовщику важно найти вещь, застикерованную на днях, и
# собрать по ней поставку. 1200 — это примерно месяц закрытых заказов. Более старое
# ищется поиском по номеру заказа: он идёт в базу напрямую, мимо этого лимита.
CLOSED_ORDERS_LIMIT = 1200


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


def write_off_materials_once(cur, order_id, material, width, height):
    """Списывает материалы заказа по FIFO ОДИН раз (для случая, когда админ двигает статус
    заказа, а не проходит обычный конвейер раскроя). Если по заказу уже есть списания
    (order_material_usage) — ничего не делает. При нехватке материала возвращает текст ошибки,
    иначе None. Списывает все материалы товара (тюль + аксессуары) из доступных рулонов."""
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
            # Рулон «в пути» (отгружен в цех, но не принят сменой) в раскрой не идёт:
            # материал мог не доехать. Такой рулон ждёт подтверждения приёмки.
            # Бракованный рулон в раскрой не идёт: закройщик его отставил, и материал
            # с него списывать нельзя, пока кладовщик не решит судьбу рулона.
            "WHERE material_id = %s AND remaining_quantity > 0 "
            "AND defect_flagged_at IS NULL "
            "AND (status = 'in_storage' OR (status = 'in_workshop' AND accepted_at IS NOT NULL)) "
            "ORDER BY created_at ASC",
            (material_id,),
        )
        available_rolls = cur.fetchall()
        total_available = sum(float(r[1]) for r in available_rolls)
        if total_available < qty_needed:
            cur.execute("SELECT name, unit FROM materials WHERE id = %s", (material_id,))
            mat_name, mat_unit = cur.fetchone()
            shortages.append(f"{mat_name}: нужно {round(qty_needed, 2)} {mat_unit}, доступно {round(total_available, 2)} {mat_unit}")
            continue
        remaining_to_take = qty_needed
        for roll_id, roll_remaining in available_rolls:
            if remaining_to_take <= 0:
                break
            take = min(float(roll_remaining), remaining_to_take)
            write_offs.append((roll_id, material_id, take))
            remaining_to_take -= take

    if shortages:
        return 'Недостаточно материалов на складе: ' + '; '.join(shortages)

    for roll_id, material_id, take in write_offs:
        cur.execute("SELECT remaining_quantity FROM rolls WHERE id = %s", (roll_id,))
        roll_remaining = float(cur.fetchone()[0])
        new_remaining = roll_remaining - take
        new_status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
        cur.execute(f"UPDATE rolls SET remaining_quantity = {new_remaining}{new_status_sql} WHERE id = {roll_id}")
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


# Сколько вещей связки раскраиваем за один вызов функции. Раскрой одной вещи — это десятки
# запросов к базе, поэтому большую связку обрабатываем порциями, иначе упираемся в лимит
# времени выполнения. Для закройщика это незаметно: фронтенд повторяет вызов автоматически.
GROUP_CUT_BATCH = 6


def handler(event: dict, context) -> dict:
    """Управляет заказами с маркетплейсов (OZON, WB, Яндекс.Маркет).

    Правила:
      - Один заказ = одна позиция товара, количество всегда равно 1 (без объединения
        нескольких единиц в одну строку и без дробления одного заказа на несколько).
      - Заказ попадает в систему двумя способами: через API маркетплейса или вручную кнопкой.
      - При ручном создании номер заказа проверяется на дубль: если такой номер уже
        есть в системе (в т.ч. пришедший ранее по API) — новый заказ не создаётся.

    GET  /                       - получить список заказов
    GET  /?id=1                  - получить детальную карточку заказа с расходом материалов;
                                    дополнительно возвращает requiredFabricMaterialId/Name и
                                    requiredTrimMaterialId/Name — конкретный материал тюля и тесьмы,
                                    нужный именно для этого товара (чтобы на фронте показывать
                                    только подходящие рулоны, а не всю категорию)
    POST /  { action: 'create_manual', marketplace, orderType, cluster?, marketplaceItemId, quantity? }
        - создаёт заказы вручную с автоматическими номерами (00000-01, 00000-02, ...).
          quantity — сколько одинаковых изделий нужно отшить: система заведёт столько
          отдельных заявок, каждая пойдёт по конвейеру сама. По умолчанию 1, максимум 200.
          Для orderType='Индивидуальный' маркетплейс не требуется
        - marketplaceItemId — id товара из справочника "Товары на маркетплейсе" (marketplace_items);
          заказ наследует его material/width/height (нужны конвейеру раскроя) и текстовый product
          формируется автоматически как "{material} {width}x{height}"
    POST /  { action: 'update_order', id, orderNumber?, marketplace?, orderType?, status?, product?,
              sewingStatus?, assignedUserId?, workshopId? }
        - если sewingStatus вручную возвращается на "Новый"/"На раскрое" — снимается
          невыплаченное начисление закройщику за раскрой этого заказа (salary_accruals,
          type='cutter_cut'), как если бы заказ убрали из раскроя
    POST /  { action: 'take_stack', userId, workshopId, shiftNumber, single? }
        - single=true — взять ОДИН заказ вместо стека. Связки Яндекса (group_size > 1)
          в этом режиме пропускаются: заказ покупателя из нескольких вещей раскраивается
          только целиком, поэтому выдаётся следующий одиночный заказ по очереди.
        - закройщик берёт стек заказов из статуса "Новый": количество берётся из настройки
          цеха max_quantity_orders_to_cutter (или глобальной system_settings, по умолчанию 20).
          Заказы назначаются на userId, переводятся в "На раскрое" и получают workshopId.
          Если у закройщика уже есть незавершённые заказы в "На раскрое" — отклоняется (409).
          Возвращает orders — полные данные взятых заказов (orderNumber, orderType, material,
          width, height), отсортированные по материалу — для немедленной печати листа закройщика
    POST /  { action: 'cut', id, rollId }
    POST /  { action: 'cut_group', id, rollId }
        - раскроить и отправить в цех ВСЮ связку Яндекса разом (все вещи одного заказа
          покупателя, закреплённые за этим закройщиком). Материалы, лимиты и начисления
          считаются для каждой вещи как при обычном раскрое; если материала не хватило,
          не раскраивается ничего
        - переводит заказ в статус "Раскроено". Тюль списывается с указанного закройщиком
          рулона rollId (должен быть в его цехе/смене), упаковка (этикетки, пакеты) списывается
          автоматически по FIFO со склада. Тесьма (Аксессуары) НЕ списывается на этом этапе —
          её позже указывает швея перед отправкой на стикеровку.
          Фиксирует cutter_user_id = текущий assigned_user_id (закройщик) — это отдельное
          поле от assigned_user_id, которое дальше будет перезаписано на швею при take_order,
          так что именно cutter_user_id остаётся источником "кто раскроил" на карточке товара.
          Начисляет закройщику зарплату (salary_accruals, type='cutter_cut'): ставка за 1 пог.м.
          по материалу (salary_rates, role='cutter', material_id, width IS NULL; тарифы
          цеха заказа workshop_id) × чистая ширина товара (width/100), а не технологический
          расход ткани со склада (тот включает запас на подгибку и не годится для оплаты).
          Отклоняется (409), если за текущую открытую смену закройщика уже исчерпан лимит
          метража (cutter_daily_limit) или число уникальных рулонов тюля (max_fabric_rolls_per_shift)
          из настроек цеха — оба лимита считаются только в пределах текущей смены
    POST /  { action: 'take_order', userId }
        - швея получает в работу заказ из "Раскроено". Порядок выборки: FBS-заказы ВСЕГДА
          идут первыми (жёсткое правило, важнее настроек цеха). Далее — по настройкам ЦЕХА
          текущей открытой смены швеи: orders_filter (all/fbo/fbs — ограничивает выборку),
          orders_cluster_priority (приоритетный FBO-кластер идёт первым), orders_priority
          (ozon_first/wb_first/yandex_first — соответствующий маркетплейс идёт первым), при
          равенстве — FIFO по времени раскроя (cut_at). Атомарная операция (FOR UPDATE SKIP LOCKED)
          исключает дубли при одновременных нажатиях. Назначает заказ на userId, переводит
          в "В работе", фиксирует taken_at.
          Отклоняется (409), если: у швеи уже max_quantity_orders_to_seamstress заказов "В
          работе"; за текущую смену исчерпан лимит метража (seamstress_daily_limit); не прошёл
          НАКОПЛЕННЫЙ таймаут. Таймаут накопительный: первые max_quantity_orders_without_timeout
          заказов за смену берутся без задержки, каждый следующий добавляет к общему бюджету
          времени свой timeout_{ширина}; взять новый заказ можно, когда с момента взятия
          ПЕРВОГО заказа смены прошло не меньше суммы таймаутов всех заказов сверх лимита.
          Лимиты/таймаут действуют только при наличии открытой рабочей смены (shift_sessions)
    POST /  { action: 'send_to_stickering', id, rollId }
        - швея указывает рулон тесьмы (должен быть в её цехе/смене), с которого списывается
          тесьма товара, и переводит заказ в статус "Стикеровка". Без указания рулона тесьмы
          перевод недоступен. Фиксирует sewer_user_id = текущий assigned_user_id (швея) —
          отдельное поле от assigned_user_id, аналогично cutter_user_id, чтобы история
          "кто отшил" осталась видна на карточке товара
    POST /  { action: 'cancel_order', id }
        - отмена заказа закройщиком (статус "На раскрое") или швеёй (статус "В работе").
          Заказ НЕ удаляется из системы: снимается назначенный сотрудник, и заказ возвращается
          на предыдущий этап очереди — "На раскрое" -> "Новый" (снимается и цех, заказ снова
          доступен любому закройщику по общей очереди), "В работе" -> "Раскроено" (цех и время
          раскроя cut_at не меняются, заказ остаётся на своём месте в FIFO-очереди для швей).
          Для остальных статусов отмена недоступна (409).
          Автоматически начисляет отменившему сотруднику штраф (salary_accruals, type='penalty')
          на сумму cancel_order_penalty из настроек цеха заказа, если она больше 0 — повторный
          штраф за тот же заказ не задваивается (уникальный индекс order_id+type)
    POST /  { action: 'delete_order', id }
        - мягкая отмена заказа админом: помечает status='Отменён' (заказ остаётся в истории,
          показывается зачёркнутым, не стирается из базы); снимает его невыплаченные начисления
          зарплаты (уже выплаченные остаются в истории)

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над заказами
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        params = event.get('queryStringParameters') or {}
        order_id = params.get('id')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

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
                    # Название вешалки. Запятой после подзапроса быть не должно —
                    # это последнее поле перед FROM.
                    "(SELECT h.name FROM hangers h WHERE h.number = o.hanger_number) "
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
                    'hangerName': row[-1],
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

            cur.execute(
                # Активные заказы отдаём ВСЕ, историю — только свежую часть.
                #
                # Раньше и те и другие делили один лимит: закрытых заказов копится по
                # сотне в день, и они рано или поздно вытеснили бы рабочие — цех перестал
                # бы видеть то, что нужно шить. Здесь список свежих закрытых считается
                # ОТДЕЛЬНО и подмешивается к активным, поэтому история физически не может
                # отобрать место у работы.
                "WITH recent_closed AS ("
                "  SELECT id FROM orders WHERE sewing_status IN ('Готовые', 'Со склада') "
                f"  ORDER BY id DESC LIMIT {CLOSED_ORDERS_LIMIT}"
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
                "shp.name, shp.color "
                "FROM orders o "
                "LEFT JOIN users u ON u.id = o.assigned_user_id "
                "LEFT JOIN workshops w ON w.id = o.workshop_id "
                "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                "LEFT JOIN users su ON su.id = o.sewer_user_id "
                "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                "LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
                "LEFT JOIN shops shp ON shp.id = o.shop_id "
                # Берём все активные заказы и только свежую часть истории (см. CTE выше).
                "WHERE o.sewing_status NOT IN ('Готовые', 'Со склада') "
                "   OR o.id IN (SELECT id FROM recent_closed) "
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
                    # Три последних поля: вешалка, магазин и его цвет. Отсчёт с
                    # конца, потому что колонок много и номера легко сбить.
                    'hangerName': r[-3],
                    'shopName': r[-2],
                    'shopColor': r[-1],
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

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'orders': orders})}

    if method == 'POST':
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
                            "WHERE material_id = %s "
                            "AND (status = 'in_storage' OR (status = 'in_workshop' AND accepted_at IS NOT NULL)) "
                            "AND remaining_quantity > 0",
                            (gm_id,),
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
                cur.execute(
                    f"SELECT id, order_number, order_type, marketplace, material, width, height, "
                    f"group_key, group_size, group_position "
                    f"FROM orders WHERE id IN ({ids_csv}) "
                    f"ORDER BY material, group_key NULLS FIRST, group_position NULLS LAST, id"
                )
                taken_orders = [
                    {
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
                    }
                    for r in cur.fetchall()
                ]

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
                        cur.execute("SELECT material, width, height FROM orders WHERE id = %s", (int(item_id),))
                        mwh = cur.fetchone()
                        if mwh:
                            err = write_off_materials_once(cur, int(item_id), mwh[0], mwh[1], mwh[2])
                            if err:
                                conn.rollback()
                                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': err})}

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
                                            "SELECT id, remaining_quantity, workshop_id, shift_number FROM rolls WHERE id = %s "
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
                                    # Рулон «в пути» (отгружен в цех, но не принят сменой) в раскрой не идёт:
            # материал мог не доехать. Такой рулон ждёт подтверждения приёмки.
            # Бракованный рулон в раскрой не идёт: закройщик его отставил, и материал
            # с него списывать нельзя, пока кладовщик не решит судьбу рулона.
            "WHERE material_id = %s AND remaining_quantity > 0 "
            "AND defect_flagged_at IS NULL "
            "AND (status = 'in_storage' OR (status = 'in_workshop' AND accepted_at IS NOT NULL)) "
                                    "ORDER BY created_at ASC",
                                    (material_id,),
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

                    for roll_id, material_id, take in write_offs:
                            cur.execute(
                                    "SELECT remaining_quantity FROM rolls WHERE id = %s",
                                    (roll_id,),
                            )
                            roll_remaining = float(cur.fetchone()[0])
                            new_remaining = roll_remaining - take
                            new_status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
                            cur.execute(
                                    f"UPDATE rolls SET remaining_quantity = {new_remaining}{new_status_sql} WHERE id = {roll_id}"
                            )
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
                    cur.execute(
                            f"UPDATE orders SET sewing_status = 'Раскроено', cut_at = now(){cutter_sql}{hanger_sql} WHERE id = {int(item_id)}"
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
                    if fabric_material_id and order_assigned_user_id and order_workshop_id and width:
                            # Ставка задаётся ОДНА на ткань (width IS NULL) — раньше её
                            # требовалось заводить на каждую пару «ткань + ширина», то есть
                            # 56 полей на цех при одинаковом значении внутри ткани. Ширина
                            # всё равно учитывается ниже: сумма = метраж x ставка.
                            cur.execute(
                                    "SELECT rate FROM salary_rates WHERE role = 'cutter' AND material_id = %s "
                                    "AND width IS NULL AND workshop_id = %s",
                                    (fabric_material_id, order_workshop_id),
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

                # Лимит незакрытых заказов у швеи (max_quantity_orders_to_seamstress). Считаем
                # и те, что "В работе", и те, что уже отправлены на "Стикеровку", но упаковщик
                # их ещё не закрыл: иначе швея копит горы неупакованного и лимит обходится.
                max_orders = get_setting_int(cur, session_workshop_id, 'max_quantity_orders_to_seamstress', 0)
                if max_orders > 0 and not finishing_group:
                    cur.execute(
                        "SELECT COUNT(*) FILTER (WHERE sewing_status = 'В работе'), "
                        "COUNT(*) FILTER (WHERE sewing_status = 'Стикеровка') FROM orders "
                        "WHERE (assigned_user_id = %s OR sewer_user_id = %s) "
                        "AND sewing_status IN ('В работе', 'Стикеровка')",
                        (int(user_id), int(user_id)),
                    )
                    cnt_row = cur.fetchone()
                    in_work, on_stickering = int(cnt_row[0]), int(cnt_row[1])
                    total_open = in_work + on_stickering
                    if total_open >= max_orders:
                        if on_stickering > 0:
                            msg = (f'У вас {in_work} в работе и {on_stickering} ждут стикеровки '
                                   f'(лимит {max_orders}) — дождитесь, пока упаковщик их закроет')
                        else:
                            msg = (f'У вас уже {in_work} заказов в работе (лимит {max_orders}) — '
                                   f'сначала отправьте их на стикеровку')
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({'error': msg}),
                        }

                # Лимиты и таймаут считаются в пределах ТЕКУЩЕЙ открытой смены (сбрасываются
                # при открытии новой) — без открытой смены не применяются.
                if session_opened_at and not finishing_group:
                    daily_limit = get_setting_float(cur, session_workshop_id, 'seamstress_daily_limit', 0)
                    if daily_limit > 0:
                        cur.execute(
                            "SELECT COALESCE(SUM(width), 0) FROM orders WHERE assigned_user_id = %s AND taken_at >= %s",
                            (int(user_id), session_opened_at),
                        )
                        taken_meters = float(cur.fetchone()[0] or 0) / 100
                        if taken_meters >= daily_limit:
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': f'Лимит метража на смену исчерпан: {round(taken_meters, 2)}/{daily_limit} пог.м.'}),
                            }

                    # НАКОПИТЕЛЬНЫЙ таймаут между взятием заказов. Настройки timeout_200..800
                    # задаются в МИНУТАХ (в БД хранятся минуты, здесь переводим в секунды).
                    # Первые max_quantity_orders_without_timeout заказов за смену швея берёт
                    # без задержки — они НЕ входят в сумму. Каждый следующий заказ (сверх
                    # лимита) добавляет к общему "бюджету времени" свой timeout_{bucket} по
                    # ширине. Взять новый заказ можно, когда с момента взятия ПЕРВОГО заказа
                    # за смену прошло не меньше накопленного бюджета. Пример: лимит 2, взяли 2
                    # заказа мгновенно — бюджет 0. Берём 3-й (ширина 500, timeout 12 мин) —
                    # бюджет 12 мин; 4-й станет доступен, когда с первого взятия пройдёт
                    # столько, чтобы покрыть сумму таймаутов 3-го и 4-го. Задержки суммируются.
                    without_timeout = get_setting_int(cur, session_workshop_id, 'max_quantity_orders_without_timeout', 0)
                    cur.execute(
                        "SELECT width, taken_at, EXTRACT(EPOCH FROM (now() - taken_at))::float "
                        "FROM orders WHERE assigned_user_id = %s AND taken_at >= %s "
                        "ORDER BY taken_at ASC, id ASC",
                        (int(user_id), session_opened_at),
                    )
                    taken_rows = cur.fetchall()
                    # Требуемый бюджет времени = сумма таймаутов заказов, взятых СВЕРХ лимита
                    # (первые without_timeout заказов не считаются). Ширина каждого заказа
                    # округляется до ближайшего порога timeout_200..800.
                    required_budget = 0
                    for w in taken_rows[without_timeout:]:
                        bucket = nearest_timeout_width(w[0])
                        if bucket:
                            # Значение настройки — минуты, бюджет считаем в секундах.
                            required_budget += get_setting_int(
                                cur, session_workshop_id, f'timeout_{bucket}', 0
                            ) * 60

                    if required_budget > 0 and taken_rows:
                        elapsed_since_first = taken_rows[0][2]
                        if elapsed_since_first < required_budget:
                            wait_sec = round(required_budget - elapsed_since_first)
                            # Пишем понятно: до минуты — в секундах, дальше — в минутах.
                            if wait_sec < 60:
                                wait_text = f'{wait_sec} сек.'
                            else:
                                wait_text = f'{wait_sec // 60} мин. {wait_sec % 60} сек.'
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': f'Подождите ещё {wait_text} перед взятием следующего заказа'}),
                            }

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
                        cur.execute(
                            "SELECT mim.material_id, mim.quantity, m.name, m.unit "
                            "FROM marketplace_item_materials mim "
                            "JOIN materials m ON m.id = mim.material_id "
                            "JOIN material_types mt ON mt.id = m.type_id "
                            "WHERE mim.marketplace_item_id = %s AND mt.name = 'Аксессуары'",
                            (mi_row[0],),
                        )
                        lacks = []
                        for mat_id, qty_needed, mat_name, mat_unit in cur.fetchall():
                            cur.execute(
                                # Бракованные рулоны в доступный остаток не считаем —
                                # заказ на них планировать нельзя.
                                "SELECT COALESCE(SUM(remaining_quantity), 0) FROM rolls "
                                "WHERE material_id = %s AND status = 'in_workshop' AND remaining_quantity > 0 "
                                "AND defect_flagged_at IS NULL "
                                "AND (%s IS NULL OR workshop_id = %s)",
                                (mat_id, session_workshop_id, session_workshop_id),
                            )
                            available = float(cur.fetchone()[0] or 0)
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
                    "SELECT material, width, height, workshop_id, sewing_status, assigned_user_id FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                order_row = cur.fetchone()
                if not order_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                material, width, height, order_workshop_id, current_status, order_assigned_user_id = order_row
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
                    "SELECT id, remaining_quantity, workshop_id, shift_number FROM rolls WHERE id = %s "
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

                new_remaining = roll_remaining - trim_qty_needed
                new_status_sql = ", status = 'completed', completed_at = now()" if new_remaining <= 0 else ""
                cur.execute(
                    f"UPDATE rolls SET remaining_quantity = {new_remaining}{new_status_sql} WHERE id = {roll_row[0]}"
                )
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

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}