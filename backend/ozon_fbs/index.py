import base64
import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

import psycopg2

# OZON Seller API. Тестового контура у OZON нет — ключ боевой, поэтому функция работает
# ТОЛЬКО НА ЧТЕНИЕ: тянет новые FBS-заказы и читает статусы отправлений, но НЕ двигает
# заказы на стороне OZON (не собирает и не отгружает).
OZON_API_BASE = 'https://api-seller.ozon.ru'

# Сколько отправлений просим у OZON за один запрос.
#
# Было 50 — и функция не укладывалась в свои 5 секунд: сам ответ OZON приходит 1-2
# секунды, а на разбор и запись полусотни отправлений (в каждом бывает несколько
# вещей) времени уже не оставалось. Загрузка обрывалась по таймауту, и заказы не
# создавались вообще.
#
# По 10 штук за раз очередь разбиралась слишком медленно: синхронизация идёт раз в
# 15 минут, то есть 40 заказов в час — за сутки не успевали забрать даже те 368, что
# висят в «ожидает сборки».
#
# Берём по 100. Список приходит свежими вперёд, и почти вся страница — это уже
# загруженные заказы: они отсекаются одной проверкой по номеру и почти ничего не
# стоят. Тяжёлая работа (создание заказа, деление многотоварного отправления)
# приходится лишь на новые, а их за 15 минут появляется единицы. Так очередь
# разбирается за считаные запуски вместо суток.
OZON_SYNC_PAGE = 100

# Сколько отправлений за один запуск разрешено делить на OZON.
#
# Деление — это отдельный запрос к OZON на каждое многотоварное отправление, а он
# занимает секунду-полторы. У функции всего 5 секунд на всё, поэтому за раз делим
# немного: остальные разделятся при следующих запусках. Заказы не теряются — они
# просто попадут на конвейер чуть позже, уже разбитыми.
OZON_SPLIT_PER_RUN = 2
# Сколько страниц забираем за один запуск.
#
# У функции всего 5 секунд на всю работу: запрос к OZON, разбор отправлений и запись
# в базу. На нескольких страницах она в это время не укладывалась и обрывалась, ничего
# не сохранив. Берём ОДНУ страницу (50 отправлений) за раз, а место остановки
# запоминаем — следующий запуск продолжит оттуда. Заказы не теряются: они висят
# в «ожидает сборки», пока их не соберут.
OZON_SYNC_MAX_PAGES = 1

# Сколько страниц разрешено ПРОЛИСТАТЬ за один запуск в поисках новых заказов.
#
# Листание дешёвое: запрос к OZON плюс одна проверка «эти номера у нас уже есть?».
# Тяжёлая работа начинается только на странице, где нашлись новые отправления.
# Десяти страниц по 100 хватает, чтобы добраться до конца очереди «ожидает сборки»
# даже в сезон, когда там под тысячу отправлений.
OZON_SCAN_PAGES = 10

# Сколько НОВЫХ отправлений создаём за один запуск.
#
# Планировщик дёргает загрузку раз в 15 минут, а в сезон на OZON приходит под 300
# заказов в час — то есть около 70 за интервал. Если брать меньше, очередь растёт
# быстрее, чем разбирается, и заказы копятся неделями (именно так их и потерялось
# 117 штук). Берём с запасом: 80 отправлений за запуск покрывают пиковый поток.
#
# Само создание заказа — быстрая вставка в базу. Тяжёлая часть, деление многотоварных
# отправлений, ограничена отдельно (OZON_SPLIT_PER_RUN) и в этот лимит не упирается.
OZON_CREATE_PER_RUN = 80

# Сколько секунд отводим на создание заказов, прежде чем остановиться и сохранить.
#
# Платформа обрывает функцию по таймауту без предупреждения, и всё несохранённое
# пропадает. Останавливаемся заранее и записываем то, что успели: недобранное
# заберёт следующий запуск через 15 минут, а потерянное не вернулось бы никогда.
OZON_TIME_BUDGET_SEC = 3.0

# ОБЩИЙ ДЕДЛАЙН НА ВЕСЬ ЗАПУСК.
#
# У функции жёсткий лимит 5 секунд. Раньше этап поиска отправлений и этап создания
# заказов отсчитывали время КАЖДЫЙ ОТ СВОЕГО НУЛЯ: 2.5 секунды на поиск плюс 3 на
# создание — это 5.5 секунды в сумме, уже больше лимита. Плюс ответ OZON на запрос
# списка приходит за 1–3 секунды, и он вообще не попадал ни в один бюджет.
#
# Итог: загрузка регулярно обрывалась по таймауту (в логах Code: 504), и всё, что
# она успела набрать, не сохранялось — заказы просто не приезжали в цех.
#
# Теперь время считается ОТ НАЧАЛА ЗАПУСКА, единым дедлайном на всё: сколько бы ни
# думал OZON, функция успевает записать набранное и корректно завершиться. Остаток
# заберёт следующий запуск через 15 минут.
OZON_RUN_DEADLINE_SEC = 3.8

# Сколько секунд отводим на поиск новых отправлений в ленте OZON.
#
# Листание дешёвое, но если OZON отвечает медленно, оно способно занять весь запуск —
# и на сохранение заказов времени не останется. Ограничиваем отдельно.
OZON_SCAN_BUDGET_SEC = 2.5

# Только заказы, требующие сборки, попадают на конвейер производства.
# Заказы, которые ждут сборки с нашей стороны.
#
# Берём ТОЛЬКО awaiting_packaging — это и есть «ожидают сборки» в кабинете OZON.
# Статус awaiting_deliver означает, что отправление уже собрано и ждёт передачи
# в доставку: шить там нечего, в цех такие заказы попадать не должны.
OZON_NEW_STATUS = 'awaiting_packaging'
OZON_WORK_STATUSES = ('awaiting_packaging',)

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps(body),
    }


def get_ozon_credentials(cur):
    """Возвращает (client_id, api_key, is_enabled) для OZON из marketplace_integrations."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = 'ozon'"
    )
    row = cur.fetchone()
    if not row:
        return None, None, False
    is_enabled = bool(row[0])
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()
    return client_id, api_key, is_enabled


def ozon_post(path, client_id, api_key, payload):
    """POST-запрос к OZON Seller API. Возвращает (status_code, parsed_json_or_text).
    Используется только для чтения (list/get) — статусы заказов не меняются."""
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(OZON_API_BASE + path, method='POST', data=body)
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read().decode('utf-8')
            return r.status, (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', errors='replace')
        try:
            detail = json.loads(detail)
        except Exception:
            pass
        return e.code, detail
    except Exception as e:
        return 0, str(e)


def ozon_post_raw(path, client_id, api_key, payload):
    """POST к OZON, ответ возвращается СЫРЫМИ БАЙТАМИ.

    Нужен для этикетки: она приходит бинарным PDF, а обычный ozon_post декодирует
    ответ как UTF-8 и падает на первом же не-текстовом байте («utf-8 codec can't
    decode byte 0xe2»). Из-за этого готовая этикетка не доезжала до принтера, хотя
    OZON её уже отдал.

    Возвращает (status_code, bytes_or_text).
    """
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(OZON_API_BASE + path, method='POST', data=body)
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', errors='replace')
        try:
            detail = json.loads(detail)
        except Exception:
            pass
        return e.code, detail
    except Exception as e:
        return 0, str(e)


def ozon_error_text(status_code, data):
    if isinstance(data, dict):
        return data.get('message') or data.get('error') or json.dumps(data, ensure_ascii=False)
    return str(data)


def split_posting(client_id, api_key, posting_number, products):
    """Делит отправление OZON на отдельные посылки — по одной вещи в каждой.

    Зачем: покупатель заказал три разные шторы одним отправлением. Пока они едут одним
    номером, OZON принимает сборку только целиком — стоит упаковщице застикеровать
    первую вещь, как ВСЁ отправление уходит в «ожидает отгрузки», хотя две шторы ещё
    не сшиты. Кладовщик видит в поставке товар, которого физически нет.

    После деления каждая вещь — самостоятельное отправление со СВОИМ номером от OZON,
    и она уезжает ровно тогда, когда её застикеровали.

    Деление НЕОБРАТИМО и заметно покупателю: посылки придут по отдельности. Поэтому
    делим только новые отправления, которых ещё нет в системе.

    Возвращает список (posting_number, sku) — по одной записи на вещь, или None,
    если OZON отказал (тогда работаем по-старому, одним отправлением).
    """
    plan = []
    for pr in products:
        sku = pr.get('sku')
        if not sku:
            return None
        for _ in range(int(pr.get('quantity') or 1)):
            plan.append({'products': [{'product_id': int(sku), 'quantity': 1}]})

    # Делить нечего: в отправлении одна вещь.
    if len(plan) < 2:
        return None

    status, data = ozon_post(
        '/v1/posting/fbs/split', client_id, api_key,
        {'posting_number': posting_number, 'postings': plan},
    )
    if status != 200 or not isinstance(data, dict):
        return None

    # OZON возвращает родительское отправление (в нём остаётся одна вещь) и список
    # новых. Собираем всё вместе: каждая запись — одна вещь со своим номером.
    result = []
    parent = data.get('parent_posting') or {}
    for block in [parent] + list(data.get('postings') or []):
        number = block.get('posting_number')
        if not number:
            continue
        for pr in block.get('products') or []:
            for _ in range(int(pr.get('quantity') or 1)):
                result.append((number, str(pr.get('product_id'))))
    return result or None


def load_items_index(cur):
    """Загружает справочник товаров в память одним запросом.

    Раньше карточка искалась отдельным запросом на КАЖДЫЙ товар отправления (а то и
    двумя: по sku и по артикулу). На странице в 50 отправлений это сотни обращений к
    базе, и функция стабильно упиралась в таймаут 5 секунд — загрузка обрывалась,
    заказы не создавались. Карточек меньше тысячи, поэтому дешевле забрать их разом.

    Возвращает два указателя: по ozon_sku и по артикулу продавца.
    """
    cur.execute(
        "SELECT material, width, height, name, id, ozon_sku, sku FROM marketplace_items"
    )
    by_ozon_sku = {}
    by_sku = {}
    for material, width, height, name, item_id, ozon_sku, sku in cur.fetchall():
        row = (material, width, height, name, item_id)
        if ozon_sku:
            by_ozon_sku.setdefault(str(ozon_sku), row)
        if sku:
            by_sku.setdefault(str(sku), row)
    return by_ozon_sku, by_sku


def find_item_cached(items_index, ozon_sku, offer_id):
    """Ищет товар в заранее загруженном справочнике: сначала по sku OZON, затем по артикулу."""
    by_ozon_sku, by_sku = items_index
    if ozon_sku:
        row = by_ozon_sku.get(str(ozon_sku))
        if row:
            return row
    if offer_id:
        row = by_sku.get(str(offer_id))
        if row:
            return row
    return None


def find_marketplace_item(cur, ozon_sku, offer_id):
    """Ищет товар: сначала по ozon_sku (числовой sku OZON), затем по offer_id=sku (артикул
    продавца). Возвращает (material, width, height, name, id) или None."""
    if ozon_sku:
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items WHERE ozon_sku = %s LIMIT 1",
            (str(ozon_sku),),
        )
        row = cur.fetchone()
        if row:
            return row
    if offer_id:
        cur.execute(
            "SELECT material, width, height, name, id FROM marketplace_items WHERE sku = %s LIMIT 1",
            (str(offer_id),),
        )
        row = cur.fetchone()
        if row:
            return row
    return None


def log_action(cur, actor_id, actor_name, action, description):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'integration',
            action,
            'order',
            None,
            description,
        ),
    )


def match_from_stock(cur, order_id, item_id) -> bool:
    """Пробует закрыть новый заказ вещью, которая уже лежит на полке склада.

    Подбор строго по товару справочника (marketplace_item_id) — это та же карточка товара,
    значит вещь подойдёт покупателю. Берём самую давно лежащую вещь (FIFO). Если нашли:
    заказ помечается как закрытый со склада и НЕ уходит на конвейер производства, а вещь
    резервируется под него — кладовщик заберёт её с полки и наклеит стикер отправления.
    """
    if not item_id:
        return False
    cur.execute(
        "SELECT gw.id FROM goods_warehouse gw "
        "JOIN orders src ON src.id = gw.order_id "
        "WHERE gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
        "AND src.marketplace_item_id = %s "
        "ORDER BY gw.received_at ASC LIMIT 1",
        (int(item_id),),
    )
    row = cur.fetchone()
    if not row:
        return False
    gw_id = row[0]
    cur.execute(
        "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() WHERE id = %s",
        (int(order_id), gw_id),
    )
    # Заказ закрывается со склада: на конвейер не попадает, ждёт стикеровки кладовщиком.
    cur.execute(
        "UPDATE orders SET fulfilled_from_stock_id = %s, sewing_status = 'Со склада' WHERE id = %s",
        (gw_id, int(order_id)),
    )
    return True


def handle_split_pending(cur, conn, client_id, api_key, actor_id, actor_name):
    """Делит на OZON отправления, которые попали в систему ДО появления деления.

    Такие заказы лежат в «Новых» слипшимися: три шторы одного покупателя едут одним
    номером, и стоит упаковщице застикеровать первую, как всё отправление уходит в
    «ожидает отгрузки», хотя остальные ещё не сшиты.

    Делим ТОЛЬКО те отправления, где НИ ОДНА вещь ещё не взята в работу. Если по
    отправлению уже начали шить, трогать его нельзя: деление необратимо, а часть
    вещей уже привязана к работе и оплате.
    """
    cur.execute(
        "SELECT o.ozon_posting_number, count(*) "
        "FROM orders o "
        "WHERE o.marketplace = 'OZON' AND o.order_type = 'FBS' "
        "  AND o.ozon_status = 'awaiting_packaging' "
        "  AND o.ozon_posting_number IS NOT NULL "
        "GROUP BY o.ozon_posting_number "
        # Делим, пока НИ НА ОДНУ вещь отправления не наклеен ярлык OZON.
        #
        # Раньше требовалось, чтобы все вещи были строго «Новыми» — то есть работа по
        # ним ещё не начиналась. На практике отправление успевало уйти в цех раньше,
        # чем до него доходило деление, и оставалось неделёным навсегда. Такие заказы
        # мы дробили только у себя, придумывая номера с суффиксами (-1, -2), которых
        # OZON не знает: собрать по ним поставку невозможно.
        #
        # До наклейки ярлыка OZON считает отправление несобранным, а в цехе меняются
        # только наши внутренние статусы — раскрой и пошив делению не мешают.
        "HAVING count(*) > 1 "
        "   AND count(*) FILTER (WHERE EXISTS ("
        "         SELECT 1 FROM goods_warehouse g "
        "         WHERE g.reserved_order_id = o.id "
        "           AND g.shipping_labeled_at IS NOT NULL)) = 0 "
        "ORDER BY o.ozon_posting_number "
        f"LIMIT {OZON_SPLIT_PER_RUN}"
    )
    candidates = [row[0] for row in cur.fetchall()]

    split_done = 0
    split_failed = 0
    renamed = 0

    for posting_number in candidates:
        # Состав берём у OZON: только он знает, какие товары и в каком количестве
        # реально в отправлении.
        status, data = ozon_post(
            '/v3/posting/fbs/get', client_id, api_key,
            {'posting_number': posting_number, 'with': {}},
        )
        if status != 200:
            split_failed += 1
            continue
        result = (data or {}).get('result') or {}
        if result.get('status') != 'awaiting_packaging':
            # Отправление уже уехало дальше — делить поздно и не нужно.
            continue

        products = result.get('products') or []

        # Отправление МОГЛИ уже разделить на стороне OZON (вручную в кабинете или
        # прошлым запуском, оборвавшимся до переименования). Тогда у OZON в нём
        # осталась одна вещь, а у нас всё ещё висит несколько записей под старым
        # номером. Делить нечего — но и бросать нельзя: надо подтянуть новые номера.
        total_qty = sum(int(pr.get('quantity') or 1) for pr in products)
        if total_qty < 2:
            split_failed += 1
            continue

        split_map = split_posting(client_id, api_key, posting_number, products)
        if not split_map:
            split_failed += 1
            continue
        split_done += 1

        # Раздаём новые номера уже созданным заказам: по одному номеру на вещь,
        # сопоставляя по коду товара OZON.
        by_sku = {}
        for number, sku in split_map:
            by_sku.setdefault(str(sku), []).append(number)

        cur.execute(
            "SELECT o.id, COALESCE(o.product_ozon_sku, mi.ozon_sku) "
            "FROM orders o LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
            # Берём ВСЕ вещи отправления, а не только «Новые»: часть уже могла уйти
            # в раскрой или пошив, и им новый номер нужен точно так же — именно по
            # нему упаковщица получит ярлык, а кладовщик соберёт поставку.
            "WHERE o.ozon_posting_number = %s "
            "ORDER BY o.id",
            (posting_number,),
        )
        rows = cur.fetchall()
        for order_id, sku in rows:
            numbers = by_sku.get(str(sku)) if sku else None
            if not numbers:
                continue
            new_number = numbers.pop(0)
            # Номер заказа = номер отправления OZON. Свои номера не выдумываем:
            # сотрудник сверяет его с ярлыком один в один.
            cur.execute(
                "UPDATE orders SET order_number = %s, ozon_posting_number = %s "
                "WHERE id = %s AND NOT EXISTS ("
                "  SELECT 1 FROM orders x WHERE x.order_number = %s"
                ")",
                (new_number, new_number, order_id, new_number),
            )
            renamed += cur.rowcount
        conn.commit()

    # Пишем в журнал КАЖДЫЙ запуск, даже когда делить нечего: иначе исправное
    # задание в спокойный час выглядит на странице «Планировщик» как отвалившееся.
    log_action(
        cur, actor_id, actor_name, 'ozon_split_pending',
        f'Разделено отправлений OZON: {split_done}, вещам присвоены свои номера: {renamed}'
        if split_done else 'Разделение заказов OZON: делить нечего',
    )
    conn.commit()

    # Сколько ещё осталось разделить — чтобы приложение знало, вызывать ли снова.
    cur.execute(
        "SELECT count(*) FROM ("
        "  SELECT o.ozon_posting_number FROM orders o "
        "  WHERE o.marketplace = 'OZON' AND o.order_type = 'FBS' "
        "    AND o.ozon_status = 'awaiting_packaging' "
        "    AND o.ozon_posting_number IS NOT NULL "
        "  GROUP BY o.ozon_posting_number "
        "  HAVING count(*) > 1 "
        "     AND count(*) FILTER (WHERE EXISTS ("
        "           SELECT 1 FROM goods_warehouse g "
        "           WHERE g.reserved_order_id = o.id "
        "             AND g.shipping_labeled_at IS NOT NULL)) = 0 "
        ") q"
    )
    pending = int(cur.fetchone()[0] or 0)

    return _resp(200, {
        'splitDone': split_done,
        'splitFailed': split_failed,
        'renamed': renamed,
        'pending': pending,
    })


def handle_sync_orders(cur, conn, client_id, api_key, actor_id, actor_name,
                       only_numbers=None):
    """Тянет новые FBS-заказы OZON (status=awaiting_packaging) и создаёт их в системе.

    only_numbers — точечная догрузка: забрать конкретные отправления по номерам,
    не перебирая ленту. Так сверка закрывает найденное расхождение сразу, а не ждёт
    планировщика. Обычный запуск (only_numbers=None) работает как раньше.
    """
    # Часы запускаем ДО первого обращения к OZON: ответ маркетплейса — самая долгая
    # часть запуска, и раньше он не учитывался в бюджете вообще.
    run_started = time.monotonic()

    payload = {
        # СВЕЖИЕ ЗАКАЗЫ ИДУТ ПЕРВЫМИ.
        #
        # Список unfulfilled отсортирован по сроку отгрузки и содержит ВСЮ ленту —
        # почти две тысячи отправлений, включая давно уехавшие «в доставке». Нужные
        # нам «ожидает сборки» лежат в самом конце: при обходе с начала система
        # тратила все запуски на уже обработанные отправления и до новых заказов
        # не доходила неделями. Именно поэтому в системе не хватало 117 заказов.
        #
        # Берём с конца — там всегда самые свежие. Постраничный указатель при этом
        # больше не нужен: новых заказов за 15 минут появляется меньше страницы,
        # и они гарантированно попадают в первую же выборку.
        'dir': 'DESC',
        # Статус в фильтре НЕ указываем: OZON позволяет задать только один, а нам
        # нужны оба рабочих. Забираем список целиком и отбираем нужные на своей
        # стороне — так ни один заказ не теряется.
        'filter': {
            'cutoff_from': '2020-01-01T00:00:00Z',
            'cutoff_to': '2030-01-01T00:00:00Z',
        },
        # Раньше брали 50 штук по возрастанию — и это была ошибка: список всегда
        # начинался с одних и тех же самых старых отправлений, уже загруженных.
        # Всё, что дальше 50-й позиции (а их бывает под 300), не попадало в систему
        # НИКОГДА — именно так терялись заказы юрлиц.
        #
        # Сортируем по убыванию: свежие отправления идут первыми, и новый заказ
        # попадает в цех сразу, а не встаёт в конец длинной очереди.
        'limit': OZON_SYNC_PAGE,
        'offset': 0,
        # legal_info — реквизиты покупателя-компании. Без этого флага OZON блок не
        # присылает, и заказ юрлица выглядел на конвейере как обычный розничный.
        'with': {'legal_info': True},
    }
    # Забираем ВСЕ страницы, а не первую.
    #
    # Раньше тянулась ровно одна страница на 50 отправлений. Пока их было немного,
    # это работало, но в сезон в статусе «ожидает сборки» скапливается 200-300 штук —
    # и всё, что не поместилось в первые 50, не попадало в систему вообще. Цех про
    # такие заказы просто не знал.
    postings = []
    # ВСЕГДА НАЧИНАЕМ С НАЧАЛА СПИСКА (а он отсортирован свежими вперёд).
    #
    # Раньше здесь читался сохранённый указатель «мы остановились на позиции N».
    # Это и ломало загрузку: лента unfulfilled живая — заказы в неё добавляются и
    # уходят из неё каждую минуту, поэтому позиция N через 15 минут указывает уже
    # на другие отправления. Часть очереди проскакивала мимо и не загружалась
    # никогда, а система тем временем перебирала давно уехавшие отправления.
    #
    # ПРОПУСКАЕМ СТРАНИЦЫ, КОТОРЫЕ УЖЕ ЦЕЛИКОМ ЗАГРУЖЕНЫ.
    #
    # Свежие заказы идут первыми, и первые страницы — это, как правило, отправления,
    # которые мы забрали ещё вчера. Создавать по ним нечего, но раньше загрузка
    # упиралась именно в них: разбирала первую сотню, тратила на это весь запуск и
    # до неразобранного хвоста не доходила.
    #
    # Поэтому сначала быстро листаем страницы, спрашивая базу «эти отправления у нас
    # уже есть?». Одна проверка по номерам стоит миллисекунды. Как только находим
    # страницу с новыми заказами — берём её в работу и на этом останавливаемся:
    # тяжёлая часть (создание заказов, деление многотоварных) достаётся только ей.
    #
    # Так очередь разбирается с любого места, а не только с начала, и при этом
    # каждый запуск укладывается в отведённое время.
    # ТОЧЕЧНАЯ ДОГРУЗКА ПО НОМЕРАМ.
    #
    # Сверка нашла конкретные отправления, которых у нас нет, — забираем именно их,
    # не листая ленту. Это последний рубеж: даже если заказ по какой-то причине
    # проскочил мимо обычной загрузки, его можно вернуть одним действием.
    if only_numbers:
        for number in only_numbers[:OZON_CREATE_PER_RUN]:
            sc, d = ozon_post('/v3/posting/fbs/get', client_id, api_key,
                              {'posting_number': number,
                               'with': {'legal_info': True}})
            if sc != 200:
                continue
            res = (d.get('result') or {}) if isinstance(d, dict) else {}
            if res and (res.get('status') or '') in OZON_WORK_STATUSES:
                postings.append(res)

    offset = 0
    reached_end = False
    # Листание тоже под часами: каждая страница — это запрос к OZON, и на медленном
    # ответе десять страниц съедят всё время, не оставив его на сохранение заказов.
    scan_started = run_started
    for _ in range(0 if only_numbers else OZON_SCAN_PAGES):
        if time.monotonic() - scan_started > OZON_SCAN_BUDGET_SEC:
            break
        payload['offset'] = offset
        status_code, data = ozon_post(
            '/v3/posting/fbs/unfulfilled/list', client_id, api_key, payload
        )
        if status_code in (401, 403):
            return _resp(400, {'error': 'OZON отклонил ключ (проверьте Client ID и API-ключ в настройках интеграции).'})
        if status_code != 200:
            return _resp(502, {'error': f'OZON вернул ошибку ({status_code}): {ozon_error_text(status_code, data)}'})

        result = (data.get('result', {}) or {}) if isinstance(data, dict) else {}
        page = result.get('postings', []) or []
        # В работу берём только отправления, которые ещё не уехали в доставку.
        work = [p for p in page if (p.get('status') or '') in OZON_WORK_STATUSES]

        # Конец списка определяем по СЫРОЙ странице от OZON, а не по отобранным:
        # после отбора страница почти всегда неполная, и загрузка обрывалась бы
        # на первой же, так и не дойдя до остальных заказов.
        if len(page) < OZON_SYNC_PAGE:
            reached_end = True

        # С каждой страницы берём ТОЛЬКО НОВЫЕ отправления и идём дальше, пока не
        # наберём порцию на создание.
        #
        # Раньше страница бралась целиком и цикл сразу обрывался, если на ней нашёлся
        # хоть один новый заказ. На практике это значило: из 98 отправлений страницы
        # новым был один — его и создавали, а на этом запуск заканчивался. При потоке
        # 270 заказов в час загрузка успевала брать единицы, и очередь непрерывно
        # росла, сколько бы раз планировщик её ни дёргал.
        #
        # Теперь пропускаем уже загруженное (проверка по номерам стоит миллисекунды)
        # и копим именно новые отправления — до OZON_CREATE_PER_RUN за запуск.
        page_numbers = [p.get('posting_number') for p in work if p.get('posting_number')]
        known_on_page = set()
        if page_numbers:
            cur.execute(
                "SELECT ozon_posting_number FROM orders "
                "WHERE ozon_posting_number = ANY(%s)", (page_numbers,)
            )
            known_on_page = {r[0] for r in cur.fetchall()}

        for p in work:
            if p.get('posting_number') not in known_on_page:
                postings.append(p)

        if len(postings) >= OZON_CREATE_PER_RUN or reached_end:
            break

        offset += OZON_SYNC_PAGE


    created = 0
    matched = 0
    skipped_existing = 0
    skipped_no_item = 0
    unmatched = []
    created_numbers = []
    # Сколько вещей ДОЛЖНО быть у каждого отправления по данным OZON — эталон для
    # проверки на задвоение в конце загрузки.
    expected_units = {}

    # Как уже названы вещи отправлений, которые есть в системе. Читаем ОДНИМ запросом
    # заранее: запрос внутри цикла по 50 отправлениям упирал функцию в таймаут.
    all_postings = [p.get('posting_number') for p in postings if p.get('posting_number')]
    existing_format = {}
    if all_postings:
        cur.execute(
            "SELECT ozon_posting_number, min(order_number) FROM orders "
            "WHERE ozon_posting_number = ANY(%s) GROUP BY ozon_posting_number",
            (all_postings,),
        )
        for pn, first_number in cur.fetchall():
            existing_format[pn] = (first_number == pn)

    # Справочник товаров забираем ОДИН раз на всю страницу, а не по запросу на товар.
    items_index = load_items_index(cur)

    # Сколько отправлений уже разделили за этот запуск и сколько раз OZON отказал.
    split_done = 0
    split_failed = 0
    # Отправления, отложенные до следующего запуска: их нужно сперва разделить на OZON,
    # иначе в системе появятся номера, которых маркетплейс не знает.
    postponed_split = []

    # СТРАХОВКА ПО ВРЕМЕНИ: успеть сохранить созданное до обрыва.
    #
    # У функции жёсткий лимит времени. Если он истечёт посреди цикла, платформа
    # обрывает работу и НЕЗАПИСАННЫЕ заказы теряются — при следующем запуске список
    # уже другой, и до них может не дойти очередь. Именно так заказы и пропадали.
    #
    # Поэтому следим за часами сами: как только время подходит к концу, прекращаем
    # брать новые отправления и сохраняем то, что успели. Остальное спокойно заберёт
    # следующий запуск — они никуда не денутся, а вот незаписанные пропали бы.
    started_at = time.monotonic()

    for p in postings:
        # Два ограничителя сразу: свой бюджет на создание И общий дедлайн запуска.
        # Общий важнее — он гарантирует, что набранное успеет записаться в базу,
        # даже если OZON отвечал непривычно долго.
        if time.monotonic() - started_at > OZON_TIME_BUDGET_SEC:
            break
        if time.monotonic() - run_started > OZON_RUN_DEADLINE_SEC:
            break

        posting_number = p.get('posting_number')
        ozon_status = p.get('status')
        if not posting_number:
            continue

        # Раньше здесь отправление целиком пропускалось, если по нему уже был хоть один
        # заказ. Из-за этого из отправления с несколькими товарами в производство попадала
        # только первая штука. Теперь проверяем каждую штуку отдельно — по её уникальному
        # номеру заказа (см. ниже), поэтому повторный импорт по-прежнему не создаёт дублей.

        # Время оформления заказа покупателем на OZON: in_process_at (когда отправление
        # ушло в работу), с фолбэком на created_at. По нему считаем ожидание заказа.
        mp_created_at = p.get('in_process_at') or p.get('created_at') or None

        # Заказ юридического лица: OZON присылает название компании, ИНН и КПП.
        # Признаком считаем заполненный ИНН или название — у розничных покупателей
        # блок приходит пустым.
        legal = p.get('legal_info') or {}
        legal_company = (legal.get('company_name') or '').strip()
        legal_inn = (legal.get('inn') or '').strip()
        is_legal = bool(legal_company or legal_inn)

        # Каждый товар отправления = отдельная штука на конвейере (1 заказ = 1 штука),
        # с учётом количества.
        products = p.get('products', []) or []
        made_any = False

        # Многотоварное отправление делим на стороне OZON — по посылке на вещь.
        #
        # Иначе OZON принимает сборку только целиком: упаковщица закрывает одну штору
        # из трёх, а всё отправление уходит в «ожидает отгрузки», хотя две ещё не сшиты.
        # Кладовщик видит в поставке товар, которого физически нет.
        #
        # Делим ТОЛЬКО отправления, которых ещё нет в системе: деление необратимо, и
        # повторный проход не должен резать то, что уже разделено и, возможно, частично
        # собрано. Если OZON отказал — работаем по-старому, одним отправлением: работа
        # цеха важнее, чем идеальное деление.
        split_map = None
        if (
            posting_number not in existing_format
            and len(products) > 0
            and split_done < OZON_SPLIT_PER_RUN
        ):
            total_qty = sum(int(pr.get('quantity') or 1) for pr in products)
            if total_qty > 1:
                split_map = split_posting(client_id, api_key, posting_number, products)
                split_done += 1
                if not split_map:
                    # OZON отказал в делении (истёк срок, сменился статус). Не создаём
                    # заказы этой порцией: следующий запуск попробует снова, а если так
                    # и не выйдет — отправление уедет целиком, как раньше.
                    split_failed += 1
                    continue

        # Многовещевое отправление, до которого деление в этот раз не дошло (уперлись
        # в лимит порции), НЕ заводим с придуманными номерами.
        #
        # Именно так в системе появлялись номера с суффиксами (-1, -2), которых OZON
        # не знает. Дальше по такому номеру нельзя ни получить ярлык, ни собрать
        # поставку: вещи «застревали» — числились в доставке, хотя лежали на складе.
        # Пропускаем — следующий запуск синхронизации разделит их на стороне OZON
        # и заведёт уже с настоящими номерами.
        if split_map is None and posting_number not in existing_format:
            total_qty_check = sum(int(pr.get('quantity') or 1) for pr in products)
            if total_qty_check > 1:
                postponed_split.append(posting_number)
                continue

        if split_map:
            # Отправление разделено: дальше каждая вещь живёт под СВОИМ номером от OZON.
            # Свои номера не выдумываем — номер отправления и есть номер заказа.
            by_sku = {}
            for number, sku in split_map:
                by_sku.setdefault(str(sku), []).append(number)

            for pr in products:
                item = find_item_cached(items_index, pr.get('sku'), pr.get('offer_id'))
                qty = int(pr.get('quantity') or 1)
                if not item:
                    skipped_no_item += qty
                    unmatched.append({
                        'postingNumber': posting_number,
                        'ozonSku': pr.get('sku'),
                        'offerId': pr.get('offer_id'),
                    })
                    continue
                material, width, height, item_name, item_id = item
                product_name = (
                    f"{material} {width}x{height}" if material and width and height else item_name
                )
                numbers = by_sku.get(str(pr.get('sku')), [])
                for _n in range(qty):
                    if not numbers:
                        break
                    unit_number = numbers.pop(0)
                    cur.execute(
                        "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
                        "quantity, source, material, width, height, ozon_posting_number, ozon_status, "
                        "marketplace_created_at, marketplace_item_id, "
                        "is_legal_entity, legal_company_name, legal_inn) "
                        "VALUES (%s, 'OZON', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, %s, %s, "
                        "%s, %s, %s) "
                        "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                        (
                            unit_number, product_name, material, width, height,
                            unit_number, ozon_status, mp_created_at, item_id,
                            is_legal, legal_company or None, legal_inn or None,
                        ),
                    )
                    if cur.fetchone():
                        created += 1
                        created_numbers.append(unit_number)
                        made_any = True
                    else:
                        skipped_existing += 1
            if made_any:
                conn.commit()
            continue

        # Сколько ВСЕГО вещей приедет в этом отправлении (по всем товарам, с учётом
        # количества). Считаем заранее, потому что от этого зависит формат номера:
        #   одна вещь  -> номер РОВНО как у OZON: «52019137-0148-1»
        #   несколько  -> с порядковым хвостом:   «52019137-0148-1-1», «...-2»
        # Отправление с одним товаром — самый частый случай, и сотруднику удобнее
        # сверять номер с ярлыком OZON один в один, без лишнего хвоста. Хвост нужен
        # только когда вещей несколько: каждая шьётся отдельно, и номера обязаны
        # различаться, иначе часть вещей потеряется при загрузке.
        # Товары ищем ОДИН раз и запоминаем: раньше поиск шёл дважды (сначала для
        # подсчёта вещей, потом в основном цикле) — это удваивало число запросов к базе
        # и упирало загрузку в таймаут.
        resolved = []
        total_units = 0
        for pr in products:
            found = find_item_cached(items_index, pr.get('sku'), pr.get('offer_id'))
            resolved.append((pr, found))
            if found:
                total_units += int(pr.get('quantity') or 1)

        # Если вещи этого отправления уже заводились — НЕ меняем формат их номеров.
        # Иначе при повторной загрузке та же вещь приехала бы под другим номером,
        # защита от дублей (ON CONFLICT по order_number) не сработала бы, и заказ
        # задвоился бы. Поэтому смотрим, как назван первый уже существующий заказ
        # отправления, и продолжаем в том же формате.
        keep_plain_number = existing_format.get(posting_number)

        if total_units:
            expected_units[posting_number] = total_units

        # Сквозной счётчик вещей ВНУТРИ отправления: общий на все товары, иначе две
        # разные позиции получили бы одинаковые номера и вторая потерялась бы.
        unit_seq = 0
        for pr, item in resolved:
            ozon_sku = pr.get('sku')
            offer_id = pr.get('offer_id')
            qty = int(pr.get('quantity') or 1)
            if not item:
                skipped_no_item += 1
                unmatched.append({'postingNumber': posting_number, 'ozonSku': ozon_sku, 'offerId': offer_id})
                continue
            material, width, height, item_name, item_id = item
            product = f"{material} {width}x{height}" if material and width and height else item_name
            for _n in range(1, qty + 1):
                # Повторная загрузка дублей не создаёт (ON CONFLICT DO NOTHING).
                # Само отправление хранится в ozon_posting_number — по нему заказы
                # собираются обратно при отгрузке.
                unit_seq += 1
                use_plain = (
                    keep_plain_number if keep_plain_number is not None else total_units <= 1
                )
                unique_number = (
                    posting_number if use_plain else f"{posting_number}-{unit_seq}"
                )
                cur.execute(
                    "INSERT INTO orders (order_number, marketplace, order_type, status, product, "
                    "quantity, source, material, width, height, ozon_posting_number, ozon_status, "
                    "marketplace_created_at, marketplace_item_id, "
                    "is_legal_entity, legal_company_name, legal_inn) "
                    "VALUES (%s, 'OZON', 'FBS', 'Новый', %s, 1, 'api', %s, %s, %s, %s, %s, %s, %s, "
                    "%s, %s, %s) "
                    "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                    (
                        unique_number,
                        product,
                        material,
                        int(width) if width else None,
                        int(height) if height else None,
                        posting_number,
                        ozon_status,
                        mp_created_at,
                        int(item_id) if item_id else None,
                        is_legal,
                        legal_company or None,
                        legal_inn or None,
                    ),
                )
                inserted = cur.fetchone()
                if not inserted:
                    # Эта штука уже загружена ранее — дубль не создаём. Но если заказ
                    # завели до того, как мы научились различать юрлиц, пометку нужно
                    # проставить задним числом, иначе цех её не увидит.
                    if is_legal:
                        cur.execute(
                            "UPDATE orders SET is_legal_entity = true, "
                            "legal_company_name = COALESCE(legal_company_name, %s), "
                            "legal_inn = COALESCE(legal_inn, %s) "
                            "WHERE order_number = %s AND is_legal_entity = false",
                            (legal_company or None, legal_inn or None, unique_number),
                        )
                    skipped_existing += 1
                    continue
                new_order_id = inserted[0]
                # Такая вещь может уже лежать на полке (осталась от отменённого заказа) —
                # тогда шить заново не надо: резервируем её под этот заказ, кладовщик заберёт
                # её с полки, наклеит стикер отправления и отсканирует в поставку FBS.
                matched += 1 if match_from_stock(cur, new_order_id, item_id) else 0
                made_any = True
                created += 1
        if made_any:
            created_numbers.append(posting_number)

    # Самопроверка на задвоение. Одна вещь отправления должна существовать в системе
    # ровно один раз. Если формат номера когда-нибудь снова изменится, та же вещь
    # заедет повторно под новым номером — молча этого допускать нельзя, деньги и
    # материалы спишутся дважды. Поэтому сверяем: сколько вещей числится у каждого
    # затронутого отправления и сколько их реально прислал OZON.
    # Проверяем ТОЛЬКО отправления, куда эта загрузка реально добавила вещи. Иначе
    # сигнал сыпался бы на исторические заказы: у давних отправлений OZON со временем
    # отдаёт другой состав (часть вещей уже отгружена или отменена на его стороне),
    # и расхождение с системой там нормальное, а не задвоение.
    duplicates = []
    if created_numbers:
        checked = created_numbers[:200]
        placeholders = ','.join(['%s'] * len(checked))
        cur.execute(
            f"SELECT ozon_posting_number, count(*) FROM orders "
            f"WHERE ozon_posting_number IN ({placeholders}) "
            f"AND COALESCE(status, '') <> 'Отменён' "
            f"GROUP BY ozon_posting_number",
            checked,
        )
        actual = {r[0]: r[1] for r in cur.fetchall()}
        for posting_number, expected in expected_units.items():
            if posting_number in actual and actual[posting_number] > expected:
                duplicates.append({
                    'postingNumber': posting_number,
                    'expected': expected,
                    'actual': actual[posting_number],
                })

    if duplicates:
        log_action(
            cur, actor_id, actor_name, 'ozon_sync_duplicates',
            f'ВНИМАНИЕ: обнаружено задвоение заказов OZON в {len(duplicates)} отправлениях: '
            + ', '.join(
                f"{d['postingNumber']} (в системе {d['actual']}, у OZON {d['expected']})"
                for d in duplicates[:10]
            ),
        )

    # Пишем в журнал КАЖДЫЙ запуск, даже когда новых заказов нет: иначе исправное
    # задание в спокойный час выглядит на странице «Планировщик» как отвалившееся.
    log_action(
        cur, actor_id, actor_name, 'ozon_sync_orders',
        f'Загрузка заказов OZON FBS: создано {created}, пропущено (уже есть) {skipped_existing}, '
        f'без товара {skipped_no_item}',
    )

    conn.commit()

    return _resp(200, {
        'created': created,
        'matchedFromStock': matched,
        'skippedExisting': skipped_existing,
        'skippedNoItem': skipped_no_item,
        # Сколько многотоварных отправлений разделили на OZON за этот запуск и сколько
        # раз OZON отказал (такие уедут целиком, как раньше).
        'splitDone': split_done,
        'splitFailed': split_failed,
        # Отправления, отложенные до следующего запуска: сперва их надо разделить
        # на OZON, иначе в системе появятся номера, которых маркетплейс не знает.
        'postponedSplit': len(postponed_split),
        'totalFromOzon': len(postings),
        'unmatched': unmatched[:50],
        'createdNumbers': created_numbers[:50],
        # Непустой список = сигнал тревоги для интерфейса.
        'duplicates': duplicates[:20],
    })


def handle_refresh_status(cur, conn, client_id, api_key, body_data):
    """Читает актуальный статус отправления OZON и сохраняет его у заказов (ТОЛЬКО чтение —
    статус на стороне OZON не меняется)."""
    posting_number = (body_data.get('postingNumber') or '').strip()
    if not posting_number:
        return _resp(400, {'error': 'Укажите postingNumber'})

    status_code, data = ozon_post(
        '/v3/posting/fbs/get', client_id, api_key,
        {'posting_number': posting_number, 'with': {}},
    )
    if status_code != 200:
        return _resp(502, {'error': f'OZON вернул ошибку ({status_code}): {ozon_error_text(status_code, data)}'})

    ozon_status = (data.get('result', {}) or {}).get('status') if isinstance(data, dict) else None
    if ozon_status:
        cur.execute(
            "UPDATE orders SET ozon_status = %s, "
            "  cancelled_at = CASE WHEN %s LIKE 'cancel%%' AND cancelled_at IS NULL "
            "                      THEN now() ELSE cancelled_at END "
            "WHERE ozon_posting_number = %s",
            (ozon_status, ozon_status, posting_number),
        )
        conn.commit()
    return _resp(200, {'postingNumber': posting_number, 'ozonStatus': ozon_status})


def handle_refresh_all(cur, conn, client_id, api_key, body_data=None, actor_id=None, actor_name=None):
    """Разом обновляет статусы всех OZON FBS-заказов в системе. Проходит по списку
    отправлений OZON (/v3/posting/fbs/list, ТОЛЬКО чтение) постранично и для каждого
    отправления, которое есть у нас, сохраняет актуальный ozon_status. Заказы на стороне
    OZON не двигаются."""
    # Множество номеров отправлений, которые есть в нашей системе — обновляем только их.
    cur.execute(
        "SELECT DISTINCT ozon_posting_number FROM orders "
        "WHERE marketplace = 'OZON' AND ozon_posting_number IS NOT NULL"
    )
    known = {r[0] for r in cur.fetchall()}
    if not known:
        return _resp(200, {'updated': 0, 'checked': 0})

    page_limit = 1000
    found = {}  # posting_number -> status (накапливаем в память, БД обновим одним разом)

    # OZON ограничивает длину периода выборки (PERIOD_IS_TOO_LONG), поэтому идём окнами.
    # Загруженные FBS-заказы свежие, поэтому смотрим недалеко в прошлое: 3 окна по 45 дней.
    # Отправления отсортированы по дате (DESC), поэтому свежие заказы находятся быстро —
    # как только нашли все известные, выходим (ранний выход экономит таймаут).
    now = datetime.now(timezone.utc)
    window_days = 45
    # За один вызов проходим ОДНО окно: полный обход трёх окон не укладывается в
    # отведённое функции время и обрывался целиком, не сохранив ничего. Приложение
    # вызывает обновление несколько раз подряд, передавая номер окна.
    try:
        window_index = int((body_data or {}).get('window') or 0)
    except (TypeError, ValueError):
        window_index = 0
    window_index = max(0, min(window_index, 2))
    windows = 1
    max_pages_per_window = 3
    for _w in range(windows):
        w = window_index
        to_dt = now - timedelta(days=window_days * w)
        since_dt = now - timedelta(days=window_days * (w + 1))
        offset = 0
        for _ in range(max_pages_per_window):
            status_code, data = ozon_post(
                '/v3/posting/fbs/list', client_id, api_key,
                {
                    'dir': 'DESC',
                    'filter': {
                        'since': since_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                        'to': to_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                    },
                    'limit': page_limit,
                    'offset': offset,
                    'with': {},
                },
            )
            if status_code in (401, 403):
                return _resp(400, {'error': 'OZON отклонил ключ (проверьте Client ID и API-ключ).'})
            if status_code != 200:
                return _resp(502, {'error': f'OZON вернул ошибку ({status_code}): {ozon_error_text(status_code, data)}'})

            result = data.get('result', {}) if isinstance(data, dict) else {}
            postings = result.get('postings', []) or []
            if not postings:
                break

            for p in postings:
                pn = p.get('posting_number')
                st = p.get('status')
                if pn in known and st and pn not in found:
                    found[pn] = st

            if len(found) >= len(known) or not result.get('has_next'):
                break
            offset += page_limit

        if len(found) >= len(known):
            break

    # Пакетное обновление одним запросом (VALUES + UPDATE ... FROM) — быстро даже для сотен строк.
    updated = 0
    if found:
        values_sql = ', '.join(
            "('" + pn.replace("'", "''") + "', '" + st.replace("'", "''") + "')"
            for pn, st in found.items()
        )
        # Момент перехода в отмену запоминаем: кладовщику при приёмке возврата важно
        # видеть, когда покупатель отказался. Ставим дату только при ПЕРВОМ переходе,
        # иначе повторные синхронизации сдвигали бы её на сегодня.
        cur.execute(
            f"UPDATE orders o SET ozon_status = v.status, "
            f"  cancelled_at = CASE "
            f"    WHEN v.status LIKE 'cancel%' AND o.cancelled_at IS NULL THEN now() "
            f"    ELSE o.cancelled_at END "
            f"FROM (VALUES {values_sql}) AS v(posting, status) "
            f"WHERE o.ozon_posting_number = v.posting AND o.ozon_status IS DISTINCT FROM v.status "
            f"RETURNING o.id"
        )
        updated = len(cur.fetchall())

    # Отмечаем запуск в журнале: по нему страница «Планировщик» показывает админу,
    # когда задание отработало последний раз и что нашло. Без этой записи молчащий
    # планировщик неотличим от работающего.
    log_action(
        cur, actor_id, actor_name, 'ozon_refresh_statuses',
        f'Обновление статусов OZON FBS: сверено {len(found)}, '
        f'обновлено {updated} (окно {window_index + 1} из 3)',
    )
    conn.commit()
    return _resp(200, {
        'updated': updated, 'checked': len(found), 'known': len(known),
        'window': window_index,
        # Есть ли ещё окна для обхода: приложение вызывает обновление повторно,
        # пока не пройдёт весь период.
        'hasMore': window_index < 2,
        'nextWindow': window_index + 1 if window_index < 2 else None,
    })



def fill_exemplars(client_id, api_key, posting_number, products, debug=None):
    """Заполняет «экземпляры» отправления — без этого заказ юрлица не собрать.

    Зачем: покупателю-компании OZON выставляет счёт-фактуру, поэтому требует по каждой
    единице товара данные о таможенной декларации (ГТД). Пока их нет, сборка отбивается
    ошибкой EXEMPLAR_INFO_NOT_FILLED_COMPLETELY — и заказ висит на стикеровке, а
    упаковщица видит только «ярлык не пришёл».

    Шторы мы шьём сами, это не импорт — ГТД у товара нет. OZON такой ответ принимает:
    отправляем признак «декларация отсутствует».

    Возвращает текст ошибки или None, если всё в порядке. Отсутствие поддержки
    экземпляров у продавца ошибкой НЕ считается: обычные розничные отправления
    собираются и без них, и мешать им нельзя.
    """
    # Просим у OZON номера экземпляров: он сам заводит нужное количество по составу
    # отправления и возвращает их идентификаторы.
    #
    # Версию метода перебираем: OZON регулярно выводит старые из строя (отвечает
    # «obsolete method cannot be used»), и жёстко зашитая версия однажды перестаёт
    # работать — ровно так стикеровка юрлиц и встала. Свежая версия идёт первой.
    status, data = None, None
    for version in ('v6', 'v5', 'v4'):
        status, data = ozon_post(
            f'/{version}/fbs/posting/product/exemplar/create-or-get', client_id, api_key,
            {'posting_number': posting_number},
        )
        if debug is not None:
            debug.setdefault('exemplarGet', []).append({
                'version': version, 'status': status, 'response': str(data)[:300],
            })
        if status == 200:
            break
    if status != 200 or not isinstance(data, dict):
        # Метод недоступен — не мешаем обычной сборке, пусть пробует как раньше.
        return None

    result = data.get('result') or data
    api_products = result.get('products') or []
    if not api_products:
        return None

    # По каждой единице товара говорим: маркировки нет, таможенной декларации нет.
    filled = []
    for pr in api_products:
        exemplars = []
        for ex in (pr.get('exemplars') or []):
            exemplars.append({
                'exemplar_id': ex.get('exemplar_id'),
                # Обязательной маркировки («Честный знак») у штор нет.
                'is_mandatory_mark_absent': True,
                # Товар собственного производства — таможенной декларации нет.
                'is_gtd_absent': True,
                # Не прослеживаемый товар — РНПТ тоже нет.
                'is_rnpt_absent': True,
            })
        if exemplars:
            filled.append({
                'product_id': pr.get('product_id'),
                'exemplars': exemplars,
            })

    if not filled:
        return None

    set_status, set_data = None, None
    for version in ('v6', 'v5', 'v4'):
        set_status, set_data = ozon_post(
            f'/{version}/fbs/posting/product/exemplar/set', client_id, api_key,
            {'posting_number': posting_number, 'products': filled},
        )
        if debug is not None:
            debug.setdefault('exemplarSet', []).append({
                'version': version, 'status': set_status, 'response': str(set_data)[:300],
            })
        if set_status == 200:
            break
    if set_status != 200:
        return (
            f'OZON не принял данные по товару для заказа юрлица (код {set_status}): '
            f'{ozon_error_text(set_status, set_data)}'
        )

    # OZON проверяет экземпляры не мгновенно: сразу после отправки сборка ещё
    # отбивается. Ждём готовности, иначе упаковщице пришлось бы жать кнопку повторно.
    for _ in range(4):
        time.sleep(0.8)
        st_status, st_data = None, None
        for version in ('v6', 'v5', 'v4'):
            st_status, st_data = ozon_post(
                f'/{version}/fbs/posting/product/exemplar/status', client_id, api_key,
                {'posting_number': posting_number},
            )
            if st_status == 200:
                break
        st_result = (st_data or {}).get('result') or st_data or {}
        if str(st_result.get('status') or '') == 'ship_available':
            if debug is not None:
                debug['exemplarReady'] = True
            return None
    if debug is not None:
        debug['exemplarReady'] = False
    return None


def assemble_posting(client_id, api_key, posting_number, debug=None):
    """Собирает отправление FBS на стороне OZON (/v4/posting/fbs/ship).

    OZON отдаёт этикетку только после сборки: пока отправление в статусе
    «ожидает упаковки» (awaiting_packaging), запрос этикетки отвечает ошибкой.
    Раньше упаковщице просто показывали «этикетка ещё не готова, попробуйте позже»,
    и заказ вставал — собрать его из системы было нельзя, приходилось идти в личный
    кабинет OZON руками.

    Этот вызов переводит отправление в «ожидает отгрузки» (awaiting_deliver), после
    чего этикетка становится доступна. Состав берём из самого отправления: OZON
    требует перечислить товары с количеством.

    Возвращает (ошибка, новый_статус). Если отправление уже собрано — не ошибка.
    """
    status, data = ozon_post(
        '/v3/posting/fbs/get', client_id, api_key,
        {'posting_number': posting_number, 'with': {}},
    )
    if status != 200:
        return f'OZON не отдал состав отправления (код {status}): {ozon_error_text(status, data)}', None

    result = (data or {}).get('result') or {}
    current_status = result.get('status')
    if debug is not None:
        debug['postingStatus'] = current_status
        debug['substatus'] = result.get('substatus')
        debug['productsCount'] = len(result.get('products') or [])
    # Уже собрано или уехало дальше — собирать повторно не нужно и нельзя.
    if current_status and current_status != 'awaiting_packaging':
        return None, current_status

    products = result.get('products') or []
    if not products:
        return 'В отправлении OZON нет товаров — обратитесь в поддержку OZON', None

    items = [
        {'product_id': int(pr.get('sku')), 'quantity': int(pr.get('quantity') or 1)}
        for pr in products if pr.get('sku')
    ]
    if not items:
        return 'У товаров отправления нет кода OZON — собрать не получится', None

    # ЗАКАЗ ЮРЛИЦА: OZON не даёт собрать отправление, пока не заполнены «экземпляры».
    #
    # Для компаний OZON выставляет счёт-фактуру и потому требует по КАЖДОЙ единице
    # товара данные о таможенной декларации (ГТД). Пока их нет, сборка отбивается
    # ошибкой EXEMPLAR_INFO_NOT_FILLED_COMPLETELY, а упаковщица на терминале видит
    # только «не удалось получить ярлык» — заказ намертво зависает на стикеровке.
    #
    # Товар нашего производства (шторы шьём сами), импорта нет — значит ГТД
    # отсутствует, и это законный вариант ответа: отправляем признак «ГТД нет».
    # Розничных заказов это не касается — там экземпляры не требуются.
    exemplar_err = fill_exemplars(client_id, api_key, posting_number, products, debug)
    if exemplar_err:
        return exemplar_err, None

    # OZON принимает сборку в двух форматах, и какой именно — зависит от схемы работы
    # продавца. Пробуем оба: сначала с перечислением товаров (обычная схема), затем
    # упрощённый вызов без состава. Так упаковщица не упрётся в ошибку формата.
    attempts = [
        {'posting_number': posting_number, 'packages': [{'products': items}]},
        {'posting_number': posting_number},
    ]
    last_status, last_data = None, None
    for payload in attempts:
        ship_status, ship_data = ozon_post(
            '/v4/posting/fbs/ship', client_id, api_key, payload
        )
        if ship_status == 200:
            return None, 'awaiting_deliver'
        last_status, last_data = ship_status, ship_data
        if debug is not None:
            debug.setdefault('shipAttempts', []).append({
                'status': ship_status, 'response': str(ship_data)[:400],
            })

    return (
        f'OZON не принял сборку отправления (код {last_status}): '
        f'{ozon_error_text(last_status, last_data)}'
    ), None


def find_posting_by_barcode(client_id, api_key, barcode):
    """Ищет отправление OZON по ШТРИХКОДУ, напечатанному на ярлыке.

    На ярлыке OZON крупно печатает не номер отправления, а собственный штрихкод
    (длинное число). Сканер считывает именно его, поэтому по нашей базе вещь не
    находилась — там хранится номер отправления вида 12345678-0123-1.

    Возвращает (номер отправления или None, текст ошибки или None).
    """
    status, data = ozon_post(
        '/v2/posting/fbs/get-by-barcode', client_id, api_key, {'barcode': str(barcode)}
    )
    if status == 200 and isinstance(data, dict):
        result = data.get('result') or {}
        number = result.get('posting_number')
        if number:
            return number, None
        return None, None
    # 404/400 — OZON просто не знает такой штрихкод: это не сбой, ищем дальше сами.
    if status in (400, 404):
        return None, None
    return None, f'OZON не ответил на поиск по штрихкоду (код {status})'


def get_posting_label(cur, client_id, api_key, order_number, debug=None):
    """Маркетплейсный ярлык OZON на отправление FBS.

    OZON отдаёт готовую этикетку PDF по номеру отправления — печатаем её как есть, а не
    рисуем свой штрихкод: на ярлыке маркетплейса нужные ему коды и разметка, самодельный
    аналог на складе OZON не примут.

    Возвращает (ошибка, base64_pdf).
    """
    # Ищем и по номеру заказа, и по номеру отправления: упаковщица может отсканировать
    # ярлык OZON, где напечатан номер отправления, а у вещи в системе внутренний номер
    # с хвостом (…-1-2) — наследство старого способа деления.
    cur.execute(
        "SELECT ozon_posting_number FROM orders "
        "WHERE order_number = %s OR ozon_posting_number = %s "
        "ORDER BY (order_number = %s) DESC, id LIMIT 1",
        (order_number, order_number, order_number),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return 'У этого заказа нет отправления OZON', None
    posting_number = row[0]

    # Сначала собираем отправление на стороне OZON — без этого этикетки просто нет.
    # Упаковщица нажимает «Распечатать ярлык», а система сама переводит заказ в
    # «ожидает отгрузки» и сразу отдаёт этикетку: лишних действий в личном кабинете
    # OZON делать не нужно.
    ship_err, new_status = assemble_posting(client_id, api_key, posting_number, debug=debug)
    if ship_err:
        return ship_err, None

    # Отправление уже уехало от нас — этикетки для него у OZON больше нет, и ждать
    # бессмысленно. Раньше в этом случае показывали «OZON готовит этикетку, нажмите
    # через полминуты», и кладовщик жал кнопку по кругу без всякого результата.
    # Такие вещи попадают на подбор, когда покупатель отказался ещё в пути: их не
    # стикеруют, а принимают как возврат, когда коробка доедет назад.
    gone = {
        'delivering': 'уже едет к покупателю',
        'delivered': 'уже доставлено покупателю',
        'cancelled': 'отменено',
        'not_accepted': 'не принято складом OZON',
        'driver_pickup': 'передано водителю',
    }
    # Статус у себя обновляем всегда: терминал должен знать, где отправление.
    if new_status in gone:
        cur.execute(
            "UPDATE orders SET ozon_status = %s WHERE ozon_posting_number = %s",
            (new_status, posting_number),
        )
    if new_status:
        cur.execute(
            "UPDATE orders SET ozon_status = %s, "
            "  cancelled_at = CASE WHEN %s LIKE 'cancel%%' AND cancelled_at IS NULL "
            "                      THEN now() ELSE cancelled_at END "
            "WHERE ozon_posting_number = %s",
            (new_status, new_status, posting_number),
        )

    # OZON принимает сборку сразу, но САМУ ЭТИКЕТКУ готовит с задержкой в пару секунд.
    # Из-за этого стикеровка работала через раз: заказ, который только что собрали,
    # отвечал INVALID_ARGUMENT, и упаковщица видела «этикетка ещё не готова» — хотя
    # со второго нажатия всё печаталось. Ждём и пробуем снова, вместо того чтобы
    # гонять человека нажимать кнопку повторно.
    status, data = ozon_post_raw(
        '/v2/posting/fbs/package-label', client_id, api_key,
        {'posting_number': [posting_number]},
    )
    retries = 0
    while status != 200 and 'INVALID_ARGUMENT' in str(data) and retries < 3:
        retries += 1
        time.sleep(1.2)
        status, data = ozon_post_raw(
            '/v2/posting/fbs/package-label', client_id, api_key,
            {'posting_number': [posting_number]},
        )
    if debug is not None:
        debug['retries'] = retries
    if status != 200:
        # OZON отдаёт этикетку только после того, как отправление собрано на его стороне.
        # Пока заказ в статусе «ожидает упаковки», API отвечает INVALID_ARGUMENT — объясняем
        # это упаковщику человеческим языком, а не кодом ошибки.
        if debug is not None:
            debug['labelStatus'] = status
            debug['labelResponse'] = str(data)[:400]
        # Отправление уже ушло от нас И этикетку OZON больше не отдаёт — только теперь
        # отправляем вещь на хранение.
        #
        # Раньше на этом статусе мы выходили ЗАРАНЕЕ, не спросив этикетку вовсе. А в
        # многовещевом отправлении ярлык ОДИН на всю посылку: стикеровка первой вещи
        # переводила отправление в «едет к покупателю», и остальные вещи той же посылки
        # навсегда лишались ярлыка — хотя он уже сгенерирован и OZON обычно его отдаёт.
        # Такие вещи копились на терминале, и доложить их в свою же посылку было нечем.
        if new_status in gone:
            return (
                f'Ярлык не нужен: отправление {gone[new_status]}, и OZON больше не отдаёт '
                f'этикетку. Эта вещь не поедет покупателю — закройте заказ, наклейте '
                f'стикер хранения и оставьте вещь кладовщику'
            ), None
        if 'INVALID_ARGUMENT' in str(data):
            return (
                'OZON пока не отдал этикетку: он готовит её несколько секунд после сборки. '
                'Нажмите «Распечатать» ещё раз через полминуты.'
            ), None
        return f'OZON не отдал этикетку (код {status}): {str(data)[:250]}', None
    # Этикетка приходит бинарным PDF — отдаём её в base64 как есть, без перекодировок.
    if isinstance(data, (bytes, bytearray)):
        pdf_bytes = bytes(data)
        if not pdf_bytes:
            return 'OZON вернул пустую этикетку — попробуйте ещё раз', None
        # OZON при ошибке отвечает JSON-ом с тем же кодом 200 — распознаём это,
        # чтобы на принтер не ушёл мусор вместо ярлыка.
        if pdf_bytes[:1] == b'{':
            try:
                err_json = json.loads(pdf_bytes.decode('utf-8', 'replace'))
                if new_status in gone:
                    return (
                        f'Ярлык не нужен: отправление {gone[new_status]}, и OZON больше не '
                        f'отдаёт этикетку. Закройте заказ, наклейте стикер хранения и '
                        f'оставьте вещь кладовщику'
                    ), None
                return f'OZON не отдал этикетку: {ozon_error_text(200, err_json)}', None
            except Exception:
                pass
        return None, base64.b64encode(pdf_bytes).decode()
    return f'OZON не отдал этикетку: {ozon_error_text(status, data)}', None


def handler(event: dict, context) -> dict:
    """Интеграция с OZON FBS (Seller API) — РЕЖИМ ТОЛЬКО ЧТЕНИЕ.

    Тянет новые FBS-заказы OZON на конвейер производства и читает статусы отправлений.
    Ключ OZON боевой (тестового контура у OZON нет), поэтому функция НЕ двигает заказы на
    стороне OZON — не собирает и не отгружает. Client-Id и Api-Key берутся из настроек
    интеграции (marketplace_integrations, marketplace_code='ozon').

    POST /  { action: 'sync_orders', actorId?, actorName? }
        - вызывает OZON /v3/posting/fbs/unfulfilled/list со status=awaiting_packaging
          (только новые, требующие сборки), сопоставляет товар по ozon_sku (фолбэк offer_id=sku)
          и создаёт заказы: marketplace='OZON', order_type='FBS', status='Новый',
          sewing_status='Новый', source='api'. Дубли исключаются по ozon_posting_number.
    POST /  { action: 'refresh_status', postingNumber }
        - читает актуальный статус отправления OZON (/v3/posting/fbs/get) и сохраняет его
          у соответствующих заказов. Статус на стороне OZON не меняется.
    POST /  { action: 'refresh_all_statuses' }
        - разом обновляет статусы всех OZON FBS-заказов системы: постранично читает список
          отправлений OZON (/v3/posting/fbs/list) и сохраняет актуальный статус тем заказам,
          чьё отправление есть в системе. Только чтение — заказы на OZON не двигаются.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с результатом синхронизации
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    # Планировщик умеет только простую ссылку (GET без тела) — разрешаем такой запуск,
    # если в адресе есть ключ: ?action=sync_orders&cronSecret=...
    if method == 'GET':
        params = event.get('queryStringParameters') or {}
        if not params.get('cronSecret'):
            return _resp(405, {'error': 'Method not allowed'})
        body_data = dict(params)
    elif method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
    else:
        return _resp(405, {'error': 'Method not allowed'})

    action = body_data.get('action')
    actor_id = body_data.get('actorId')
    actor_name = body_data.get('actorName')

    # Ночной планировщик тянет заказы сам, без открытой CRM. Ключ сверяем только если он
    # пришёл: из интерфейса вызов идёт как раньше, без ключа.
    if body_data.get('cronSecret'):
        cron_secret = os.environ.get('CRON_SECRET', '')
        if not cron_secret or body_data['cronSecret'] != cron_secret:
            return _resp(403, {'error': 'Неверный ключ планировщика'})
        # В журнале должно быть видно, что заказы подтянул планировщик, а не сотрудник.
        actor_id, actor_name = None, 'Планировщик'

    if action not in ('sync_orders', 'split_pending', 'refresh_status',
                      'refresh_all_statuses', 'label', 'find_by_barcode'):
        return _resp(400, {'error': 'Неизвестное действие'})

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        client_id, api_key, is_enabled = get_ozon_credentials(cur)
        if not is_enabled:
            return _resp(400, {'error': 'Интеграция с OZON выключена. Включите её в разделе «Интеграции маркетплейсов».'})
        if not client_id or not api_key:
            return _resp(400, {'error': 'Не указаны Client ID или API-ключ OZON. Добавьте их в разделе «Интеграции маркетплейсов».'})

        if action == 'sync_orders':
            # postingNumbers — точечная догрузка из сверки: забрать именно те
            # отправления, которых у нас не хватает.
            only = body_data.get('postingNumbers') or None
            if isinstance(only, str):
                only = [n.strip() for n in only.split(',') if n.strip()]
            return handle_sync_orders(cur, conn, client_id, api_key, actor_id, actor_name,
                                      only_numbers=only)
        if action == 'split_pending':
            return handle_split_pending(cur, conn, client_id, api_key, actor_id, actor_name)
        if action == 'refresh_status':
            return handle_refresh_status(cur, conn, client_id, api_key, body_data)
        if action == 'refresh_all_statuses':
            return handle_refresh_all(cur, conn, client_id, api_key, body_data, actor_id, actor_name)
        if action == 'find_by_barcode':
            # Кладовщик отсканировал штрихкод с ярлыка OZON — возвращаем номер
            # отправления, по которому вещь ищется в нашей системе.
            barcode = (body_data.get('barcode') or '').strip()
            if not barcode:
                return _resp(400, {'error': 'Укажите штрихкод'})
            number, err = find_posting_by_barcode(client_id, api_key, barcode)
            if err:
                return _resp(502, {'error': err})
            if not number:
                return _resp(404, {'error': f'OZON не знает штрихкод {barcode}'})
            return _resp(200, {'postingNumber': number})

        if action == 'label':
            # Маркетплейсный ярлык на отправление — печатается на терминале упаковщика.
            order_number = (body_data.get('orderNumber') or '').strip()
            if not order_number:
                return _resp(400, {'error': 'Укажите номер заказа'})
            # debug=1 — вернуть, что именно ответил OZON. Нужен, чтобы понять причину
            # отказа: обычное сообщение для упаковщицы деталей не содержит.
            want_debug = str(body_data.get('debug') or '') in ('1', 'true', 'True')
            debug = {} if want_debug else None
            err, pdf_b64 = get_posting_label(
                cur, client_id, api_key, order_number, debug=debug
            )
            if err:
                # Коммитим даже при отказе: внутри мог обновиться статус отправления
                # («уже едет к покупателю» и т.п.). Раньше здесь был откат, и этот
                # факт терялся — терминал каждый раз заново упирался в ту же ошибку.
                conn.commit()
                return _resp(502, {'error': err, 'debug': debug} if want_debug else {'error': err})
            # Сборка отправления меняет статус заказа — сохраняем его у себя.
            conn.commit()
            return _resp(200, {'orderNumber': order_number, 'pdfBase64': pdf_b64})
    finally:
        conn.close()