import json
import os
import random

import psycopg2


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
            "WHERE material_id = %s AND status IN ('in_storage', 'in_workshop') AND remaining_quantity > 0 "
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
    POST /  { action: 'create_manual', orderNumber, marketplace, orderType, cluster?, marketplaceItemId }
        - marketplaceItemId — id товара из справочника "Товары на маркетплейсе" (marketplace_items);
          заказ наследует его material/width/height (нужны конвейеру раскроя) и текстовый product
          формируется автоматически как "{material} {width}x{height}"
    POST /  { action: 'update_order', id, orderNumber?, marketplace?, orderType?, status?, product?,
              sewingStatus?, assignedUserId?, workshopId? }
        - если sewingStatus вручную возвращается на "Новый"/"На раскрое" — снимается
          невыплаченное начисление закройщику за раскрой этого заказа (salary_accruals,
          type='cutter_cut'), как если бы заказ убрали из раскроя
    POST /  { action: 'take_stack', userId, workshopId, shiftNumber }
        - закройщик берёт стек заказов из статуса "Новый": количество берётся из настройки
          цеха max_quantity_orders_to_cutter (или глобальной system_settings, по умолчанию 20).
          Заказы назначаются на userId, переводятся в "На раскрое" и получают workshopId.
          Если у закройщика уже есть незавершённые заказы в "На раскрое" — отклоняется (409).
          Возвращает orders — полные данные взятых заказов (orderNumber, orderType, material,
          width, height), отсортированные по материалу — для немедленной печати листа закройщика
    POST /  { action: 'cut', id, rollId }
        - переводит заказ в статус "Раскроено". Тюль списывается с указанного закройщиком
          рулона rollId (должен быть в его цехе/смене), упаковка (этикетки, пакеты) списывается
          автоматически по FIFO со склада. Тесьма (Аксессуары) НЕ списывается на этом этапе —
          её позже указывает швея перед отправкой на стикеровку.
          Фиксирует cutter_user_id = текущий assigned_user_id (закройщик) — это отдельное
          поле от assigned_user_id, которое дальше будет перезаписано на швею при take_order,
          так что именно cutter_user_id остаётся источником "кто раскроил" на карточке товара.
          Начисляет закройщику зарплату (salary_accruals, type='cutter_cut'): ставка за 1 пог.м.
          по материалу И ширине товара (salary_rates, role='cutter', material_id+width, тарифы
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

            if order_id:
                cur.execute(
                    "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.status, o.cluster, o.product, "
                    "o.quantity, o.source, o.created_at, o.completed_at, o.material, o.width, o.height, "
                    "o.sewing_status, o.assigned_user_id, u.full_name, o.workshop_id, w.name, "
                    "o.cutter_user_id, cu.full_name, o.hanger_number, "
                    "o.sewer_user_id, su.full_name, o.packer_user_id, pu.full_name, o.product_barcode, "
                    "o.marketplace_item_id, o.product_ozon_sku, u.last_hanger_number "
                    "FROM orders o "
                    "LEFT JOIN users u ON u.id = o.assigned_user_id "
                    "LEFT JOIN workshops w ON w.id = o.workshop_id "
                    "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                    "LEFT JOIN users su ON su.id = o.sewer_user_id "
                    "LEFT JOIN users pu ON pu.id = o.packer_user_id "
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
                }
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'order': detail})}

            cur.execute(
                "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.status, o.cluster, o.product, "
                "o.quantity, o.source, o.created_at, o.completed_at, o.material, o.width, o.height, "
                "o.sewing_status, o.assigned_user_id, u.full_name, o.workshop_id, w.name, "
                "o.cutter_user_id, cu.full_name, o.hanger_number, "
                "o.sewer_user_id, su.full_name, o.packer_user_id, pu.full_name, "
                "o.ozon_status, o.ozon_posting_number, o.product_barcode, o.product_ozon_sku, "
                "o.marketplace_created_at "
                "FROM orders o "
                "LEFT JOIN users u ON u.id = o.assigned_user_id "
                "LEFT JOIN workshops w ON w.id = o.workshop_id "
                "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                "LEFT JOIN users su ON su.id = o.sewer_user_id "
                "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                "ORDER BY o.created_at DESC, o.id DESC"
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
                    'sewerUserId': r[22],
                    'sewerUserName': r[23],
                    'packerUserId': r[24],
                    'packerUserName': r[25],
                    'ozonStatus': r[26],
                    'ozonPostingNumber': r[27],
                    'productBarcode': r[28],
                    'productOzonSku': r[29],
                    'marketplaceCreatedAt': (r[30].isoformat() + 'Z') if r[30] else None,
                }
                for r in cur.fetchall()
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

                if not user_id or not workshop_id:
                    return {
                        'statusCode': 400,
                        'headers': headers,
                        'body': json.dumps({'error': 'Укажите userId и workshopId'}),
                    }

                cur.execute(
                    "SELECT COUNT(*) FROM orders WHERE assigned_user_id = %s AND sewing_status = 'На раскрое'",
                    (int(user_id),),
                )
                unfinished = cur.fetchone()[0]
                if unfinished > 0:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'У вас есть {unfinished} нераскроенных заказов — сначала раскроите их'}
                        ),
                    }

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
                # сжатые сроки отгрузки), при равенстве — FIFO по дате попадания в систему.
                cur.execute(
                    "SELECT id FROM orders WHERE sewing_status = 'Новый' "
                    "AND material IN (" + names_csv + ") "
                    "ORDER BY (order_type = 'FBS') DESC, created_at ASC, id ASC LIMIT %s",
                    (stack_size,),
                )
                order_ids = [r[0] for r in cur.fetchall()]

                if not order_ids:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Нет новых заказов на разрешённые вашему цеху материалы'}),
                    }

                ids_csv = ','.join(str(i) for i in order_ids)
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'На раскрое', assigned_user_id = {int(user_id)}, "
                    f"workshop_id = {int(workshop_id)} WHERE id IN ({ids_csv})"
                )
                log_action(
                    cur, actor_id, actor_name, 'take_stack', 'order', None,
                    f'Взял в раскрой стек из {len(order_ids)} заказов',
                    {'orderIds': order_ids, 'workshopId': workshop_id, 'shiftNumber': shift_number},
                )

                # Полные данные взятых заказов — фронтенду нужны для немедленной печати
                # "листа закройщика" (чек-лист + QR-лист) сразу после взятия стека.
                cur.execute(
                    f"SELECT id, order_number, order_type, marketplace, material, width, height "
                    f"FROM orders WHERE id IN ({ids_csv}) ORDER BY material, id"
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
                marketplace = (body_data.get('marketplace') or '').strip()
                order_type = (body_data.get('orderType') or 'FBO').strip()
                cluster = (body_data.get('cluster') or '').strip()
                marketplace_item_id = body_data.get('marketplaceItemId')

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
                order_number = f"00000-{next_seq:02d}"

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

                order_number_esc = order_number.replace("'", "''")
                cur.execute(
                    f"SELECT id FROM orders WHERE order_number = '{order_number_esc}'"
                )
                existing = cur.fetchone()
                if existing:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(
                            {'error': f'Заказ с номером {order_number} уже есть в системе — дубль не создан'}
                        ),
                    }

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

                cur.execute(
                    f"INSERT INTO orders (order_number, marketplace, order_type, status, cluster, product, "
                    f"quantity, source, material, width, height, marketplace_item_id, product_barcode, product_ozon_sku) "
                    f"VALUES ('{order_number_esc}', '{marketplace_esc}', '{order_type_esc}', 'Новый', "
                    f"'{cluster_esc}', '{product_esc}', 1, 'manual', {material_sql}, {width_sql}, {height_sql}, "
                    f"{int(marketplace_item_id)}, {barcode_sql}, {ozon_sku_sql}) "
                    f"RETURNING id"
                )
                new_id = cur.fetchone()[0]
                log_action(
                    cur, actor_id, actor_name, 'create_manual', 'order', new_id,
                    f'Создал заказ {order_number} вручную ({marketplace}, {product})',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

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

            if action == 'cut':
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

                cur.execute(
                    "SELECT material, width, height, workshop_id, assigned_user_id FROM orders WHERE id = %s",
                    (int(item_id),),
                )
                order_row = cur.fetchone()
                if not order_row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Заказ не найден'})}
                material, width, height, order_workshop_id, order_assigned_user_id = order_row

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

                fabric_material_id = None
                accessory_material_ids = set()
                for material_id, _qty in needed:
                    cur.execute("SELECT type_id FROM materials WHERE id = %s", (material_id,))
                    mt_row = cur.fetchone()
                    if not mt_row:
                        continue
                    if tul_type_id and mt_row[0] == tul_type_id and fabric_material_id is None:
                        fabric_material_id = material_id
                    elif acc_type_id and mt_row[0] == acc_type_id:
                        accessory_material_ids.add(material_id)

                if fabric_material_id and not roll_id_chosen:
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

                    if fabric_material_id and material_id == fabric_material_id:
                        cur.execute(
                            "SELECT id, remaining_quantity, workshop_id, shift_number FROM rolls WHERE id = %s "
                            "AND material_id = %s AND status = 'in_workshop'",
                            (int(roll_id_chosen), material_id),
                        )
                        roll_row = cur.fetchone()
                        if not roll_row:
                            return {
                                'statusCode': 404,
                                'headers': headers,
                                'body': json.dumps({'error': 'Выбранный рулон не найден или недоступен'}),
                            }
                        if order_workshop_id and roll_row[2] != order_workshop_id:
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': 'Рулон не принадлежит вашему цеху/смене'}),
                            }
                        if order_shift_number and roll_row[3] != order_shift_number:
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': 'Рулон не принадлежит вашей смене'}),
                            }
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
                        "WHERE material_id = %s AND status IN ('in_storage', 'in_workshop') AND remaining_quantity > 0 "
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

                # Начисление закройщику: ставка за 1 пог.м. по материалу И ширине товара
                # (salary_rates, role='cutter', material_id+width), берётся из тарифов цеха,
                # в котором выполняется заказ (order_workshop_id) — тарифы полностью раздельные
                # по цехам. Метраж для оплаты — ЧИСТАЯ ширина товара (width/100 пог.м.), а НЕ
                # технологический расход ткани со склада (marketplace_item_materials.quantity,
                # который включает запас на подгибку и используется только для списания со
                # склада) — иначе оплата некорректно завышалась/дробилась на копейки запаса.
                # Если заказ позже удалят из раскроя (cancel_order/delete_order), начисление
                # снимается там же.
                if fabric_material_id and order_assigned_user_id and order_workshop_id and width:
                    cur.execute(
                        "SELECT rate FROM salary_rates WHERE role = 'cutter' AND material_id = %s "
                        "AND width = %s AND workshop_id = %s",
                        (fabric_material_id, int(width), order_workshop_id),
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

                log_action(
                    cur, actor_id, actor_name, 'cut', 'order', item_id,
                    f'Раскроил заказ #{item_id}',
                    {'rollId': roll_id_chosen},
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

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
                session_workshop_id, session_opened_at = session_row if session_row else (None, None)

                # Лимит одновременных заказов "В работе" у швеи (max_quantity_orders_to_seamstress)
                max_orders = get_setting_int(cur, session_workshop_id, 'max_quantity_orders_to_seamstress', 0)
                if max_orders > 0:
                    cur.execute(
                        "SELECT COUNT(*) FROM orders WHERE assigned_user_id = %s AND sewing_status = 'В работе'",
                        (int(user_id),),
                    )
                    in_work = cur.fetchone()[0]
                    if in_work >= max_orders:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({'error': f'У вас уже {in_work} заказов в работе (лимит {max_orders}) — сначала отправьте их на стикеровку'}),
                        }

                # Лимиты и таймаут считаются в пределах ТЕКУЩЕЙ открытой смены (сбрасываются
                # при открытии новой) — без открытой смены не применяются.
                if session_opened_at:
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

                    # НАКОПИТЕЛЬНЫЙ таймаут между взятием заказов. Первые
                    # max_quantity_orders_without_timeout заказов за смену швея берёт без
                    # задержки — они НЕ входят в сумму. Каждый следующий заказ (сверх лимита)
                    # добавляет к общему "бюджету времени" свой timeout_{bucket} по ширине.
                    # Взять новый заказ можно, когда с момента взятия ПЕРВОГО заказа за смену
                    # прошло не меньше этого накопленного бюджета. Пример: лимит 2, взяли 2
                    # заказа мгновенно — бюджет 0. Берём 3-й (ширина 500, timeout 12с) — теперь
                    # бюджет 12с; 4-й станет доступен, когда с первого взятия пройдёт ещё столько,
                    # чтобы покрыть сумму таймаутов 3-го и 4-го заказов. Так задержки суммируются.
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
                            required_budget += get_setting_int(cur, session_workshop_id, f'timeout_{bucket}', 0)

                    if required_budget > 0 and taken_rows:
                        elapsed_since_first = taken_rows[0][2]
                        if elapsed_since_first < required_budget:
                            wait_left = round(required_budget - elapsed_since_first)
                            return {
                                'statusCode': 409,
                                'headers': headers,
                                'body': json.dumps({'error': f'Подождите ещё {wait_left} сек. перед взятием следующего заказа'}),
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
                where_parts.append(f"workshop_id = {int(session_workshop_id)}")
                if orders_filter_setting == 'fbo':
                    where_parts.append("order_type = 'FBO'")
                elif orders_filter_setting == 'fbs':
                    where_parts.append("order_type = 'FBS'")

                order_parts = []
                # FBS-заказы ВСЕГДА идут первыми в очереди — это жёсткое правило, оно важнее
                # любых настроек приоритета цеха (у FBS сжатые сроки отгрузки на маркетплейс).
                order_parts.append("(order_type = 'FBS') DESC")
                if cluster_priority:
                    cluster_esc = cluster_priority.replace("'", "''")
                    order_parts.append(f"(cluster = '{cluster_esc}') DESC")
                if orders_priority_setting == 'ozon_first':
                    order_parts.append("(marketplace = 'OZON') DESC")
                elif orders_priority_setting == 'wb_first':
                    order_parts.append("(marketplace = 'WB') DESC")
                elif orders_priority_setting == 'yandex_first':
                    order_parts.append("(marketplace = 'Yandex') DESC")
                order_parts.append("cut_at ASC NULLS LAST")
                order_parts.append("id ASC")

                cur.execute(
                    f"SELECT id FROM orders WHERE {' AND '.join(where_parts)} "
                    f"ORDER BY {', '.join(order_parts)} "
                    f"LIMIT 1 FOR UPDATE SKIP LOCKED"
                )
                row = cur.fetchone()
                if not row:
                    return {
                        'statusCode': 404,
                        'headers': headers,
                        'body': json.dumps({'error': 'Нет раскроенных заказов в очереди'}),
                    }
                order_id = row[0]

                # Проверяем, что материалы для этого товара есть в цехе смены. Если чего-то
                # не хватает — заказ в работу не выдаём и пишем, какого именно материала мало.
                cur.execute("SELECT material, width, height FROM orders WHERE id = %s", (order_id,))
                o_row = cur.fetchone()
                if o_row and o_row[0] and o_row[1] and o_row[2]:
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
                                "SELECT COALESCE(SUM(remaining_quantity), 0) FROM rolls "
                                "WHERE material_id = %s AND status = 'in_workshop' AND remaining_quantity > 0 "
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

                cur.execute(
                    f"UPDATE orders SET sewing_status = 'В работе', assigned_user_id = {int(user_id)}, "
                    f"taken_at = now() WHERE id = {order_id}"
                )
                log_action(
                    cur, actor_id, actor_name, 'take_order', 'order', order_id,
                    f'Взял в работу заказ #{order_id}',
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'orderId': order_id})}

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

                # Текущая смена швеи берётся из её ОТКРЫТОЙ shift_sessions (учитывает
                # гостевой режим), с fallback на штатную смену профиля.
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
                        f"UPDATE orders SET sewing_status = 'Стикеровка'{sewer_sql} WHERE id = {int(item_id)}"
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
                if order_workshop_id and roll_row[2] != order_workshop_id:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Рулон не принадлежит вашему цеху/смене'}),
                    }
                if order_shift_number and roll_row[3] != order_shift_number:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': 'Рулон не принадлежит вашей смене'}),
                    }
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
                cur.execute(
                    f"INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity) "
                    f"VALUES ({int(item_id)}, {trim_material_id}, {roll_row[0]}, {trim_qty_needed})"
                )
                sewer_sql = f", sewer_user_id = {order_assigned_user_id}" if order_assigned_user_id else ""
                cur.execute(
                    f"UPDATE orders SET sewing_status = 'Стикеровка'{sewer_sql} WHERE id = {int(item_id)}"
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