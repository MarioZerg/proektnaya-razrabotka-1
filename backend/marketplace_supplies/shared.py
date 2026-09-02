"""Общие части модуля поставок: константы, доступ к OZON и проверки состава.

Вынесено из index.py без изменений — тот же код, те же имена. Один файл на 3556 строк
приходилось листать целиком, чтобы найти нужную проверку; здесь лежит то, чем
пользуются и чтение списка поставок, и все действия по сборке.
"""

import base64
import json
import os
import time
import urllib.error
import urllib.request
import uuid

import boto3

# Вещь реально ждёт поставки — то есть её ещё МОЖНО положить в короб и увезти.
#
# Одного «на вещи есть ярлык» мало. Отправление живёт своей жизнью: пока вещь лежала
# у кладовщика, покупатель мог отменить заказ, а сам заказ — уехать другой поставкой
# или уже ехать к клиенту. Такая вещь в короб не пойдёт никогда, но ярлык на ней
# остаётся, и счётчик показывал её как работу: «к выдаче 32», а кладовщик выкладывал
# на стол 4 штуки и не понимал, где ещё 28.
#
# Считаем только то, что действительно можно отгрузить: заказ не отменён, не отгружен,
# не доставлен и не уехал к покупателю.
GOODS_READY_FOR_SUPPLY_SQL = (
    "COALESCE(ro.status, so.status, '') NOT IN ('Отменён', 'Отгружен', 'Доставлен') "
    "AND COALESCE(ro.ozon_status, so.ozon_status, '') NOT IN "
    "    ('delivering', 'delivered', 'cancelled', 'not_accepted', 'driver_pickup')"
)


def _ozon_creds(cur):
    """Ключи OZON из настроек интеграции. Возвращает (client_id, api_key) или (None, None)."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'ozon' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
    )
    row = cur.fetchone()
    if not row or not row[0] or not row[1]:
        return None, None
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1])
    client_id = (creds.get('clientId') or creds.get('client_id') or '').strip()
    api_key = (creds.get('apiKey') or creds.get('api_key') or '').strip()
    return (client_id or None), (api_key or None)


def ensure_ozon_assembled(cur, goods_id):
    """Досбирает отправление OZON, если оно ещё «ожидает сборки».

    Кладовщик отсканировал вещь в короб — на площадке отправление обязано быть собрано
    и ждать отгрузки. Иначе OZON не даст передать поставку в доставку, а в списке у
    кладовщика останется непонятное «ожидает сборки» по вещи, которая у него в руках.

    Статус сначала смотрим в своей базе и, если отправление уже собрано, к OZON не
    обращаемся вовсе. Это важно: кладовщик стоит с вещью в руках и ждёт ответа, а
    подавляющее большинство отправлений к моменту скана давно собраны.

    Возвращает True, если отправление собрали сейчас.
    """
    cur.execute(
        "SELECT COALESCE(ro.ozon_posting_number, o.ozon_posting_number), "
        "COALESCE(ro.ozon_status, o.ozon_status) "
        "FROM goods_warehouse gw "
        "LEFT JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
        "WHERE gw.id = %s",
        (int(goods_id),),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return False
    posting_number, status = row
    if status and status != 'awaiting_packaging':
        return False

    client_id, api_key = _ozon_creds(cur)
    if not client_id or not api_key:
        return False

    def _post(path, payload):
        req = urllib.request.Request(
            f'https://api-seller.ozon.ru{path}', method='POST',
            data=json.dumps(payload).encode('utf-8'),
        )
        req.add_header('Client-Id', client_id)
        req.add_header('Api-Key', api_key)
        req.add_header('Content-Type', 'application/json')
        # 5 секунд вместо 15. Кладовщик стоит с пакетом в руках и ждёт ответа:
        # если OZON тормозит, лучше быстро отпустить его сканировать дальше —
        # статус отправления всё равно подтянется ближайшей синхронизацией.
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read().decode('utf-8') or '{}')

    try:
        info = _post('/v3/posting/fbs/get', {'posting_number': posting_number, 'with': {}})
        result = (info or {}).get('result') or {}
        if result.get('status') and result['status'] != 'awaiting_packaging':
            cur.execute(
                "UPDATE orders SET ozon_status = %s WHERE ozon_posting_number = %s",
                (result['status'], posting_number),
            )
            return False
        items = [
            {'product_id': int(p.get('sku')), 'quantity': int(p.get('quantity') or 1)}
            for p in (result.get('products') or []) if p.get('sku')
        ]
        if not items:
            return False
        _post('/v4/posting/fbs/ship',
              {'posting_number': posting_number, 'packages': [{'products': items}]})
        cur.execute(
            "UPDATE orders SET ozon_status = 'awaiting_deliver' WHERE ozon_posting_number = %s",
            (posting_number,),
        )
        return True
    except Exception:
        # Не смогли собрать — не срываем сканирование: вещь в коробе, а статус
        # подтянется ближайшей синхронизацией.
        return False


def ozon_posting_status_live(cur, posting_number):
    """Спрашивает у OZON НАСТОЯЩИЙ статус отправления прямо сейчас (только чтение).

    Наш ozon_status обновляется синхронизацией и легко отстаёт: покупатель отменил
    заказ полчаса назад, а у нас он ещё «ждёт отгрузки». Кладовщик в этот момент
    кладёт вещь в короб и увозит — на приёмке отправление не принимают, вещь едет
    обратно, а заказ считается просроченным.

    Поэтому в момент сканирования в короб спрашиваем площадку напрямую. Возвращает
    строку статуса или None, если узнать не удалось (нет ключей, сеть) — тогда
    сканирование не блокируем: лучше собрать поставку, чем остановить склад.
    """
    if not posting_number:
        return None
    client_id, api_key = _ozon_creds(cur)
    if not client_id or not api_key:
        return None
    try:
        req = urllib.request.Request(
            'https://api-seller.ozon.ru/v3/posting/fbs/get', method='POST',
            data=json.dumps({'posting_number': posting_number, 'with': {}}).encode('utf-8'),
        )
        req.add_header('Client-Id', client_id)
        req.add_header('Api-Key', api_key)
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode('utf-8') or '{}')
        status = ((data or {}).get('result') or {}).get('status')
        if status:
            # Раз уж спросили — сохраняем ответ у себя: следующий экран покажет
            # актуальные данные без ещё одного обращения к площадке.
            cur.execute(
                "UPDATE orders SET ozon_status = %s, "
                "  cancelled_at = CASE WHEN %s LIKE 'cancel%%' AND cancelled_at IS NULL "
                "                      THEN now() ELSE cancelled_at END "
                "WHERE ozon_posting_number = %s",
                (status, status, posting_number),
            )
        return status
    except Exception:
        # Площадка не ответила — не мешаем кладовщику собирать короб.
        return None


# Статусы OZON, при которых вещь в короб класть НЕЛЬЗЯ: отправление отменено или
# уже уехало. Понятный текст для кладовщика — чтобы он не гадал, что делать.
OZON_DEAD_STATUSES = {
    'cancelled': 'Заказ отменён покупателем — вещь в поставку не идёт',
    'not_accepted': 'Отправление не принято на сортировке — в поставку не идёт',
    'delivering': 'Отправление уже едет к покупателю — второй раз его везти нельзя',
    'delivered': 'Отправление уже доставлено покупателю',
    'driver_pickup': 'Отправление уже забрал водитель',
}


# Сколько отправлений передаём в OZON за один вызов и сколько секунд на это
# отводим. OZON принимает их строго по одному, а функция живёт считанные секунды —
# поэтому берём небольшую порцию и останавливаемся по часам, не дожидаясь обрыва.
# Остаток досылается следующими вызовами: это дольше по количеству нажатий, но
# поставка закрывается сразу и ничего не теряется.
# Порция намеренно большая: главный ограничитель — часы (deadline), а не счётчик.
# Когда OZON отвечает быстро, за окно проходит много отправлений и поставка на 400
# позиций закрывается за считанные заходы; когда площадка тормозит — успеем сколько
# успеем и честно вернём остаток. Слишком мелкая порция растянула бы такую поставку
# на полсотни кругов.
# Сколько отправлений уходит в OZON за один вызов функции и за один HTTP-запрос.
# Метод last-mile принимает список, поэтому поставка на сотни отправлений
# укладывается в считанные запросы. Окно по времени — страховка от медленного
# ответа площадки: успели меньше — остаток досылается следующим вызовом.
# Коды отказа OZON человеческим языком: кладовщик должен понимать, что делать,
# а не пересылать администратору строку HAS_INCORRECT_TPL_INTEGRATION_TYPE.
# Отказы, которые отказами не являются: OZON сам подтверждает отгрузку этих
# отправлений (везёт его логистика, водитель принимает короб по акту).
# Показывать их кладовщику как проблему — только пугать.
OZON_SHIP_SELF_CONFIRMED = {'HAS_INCORRECT_TPL_INTEGRATION_TYPE'}

OZON_SHIP_ERRORS = {
    'HAS_INCORRECT_TPL_INTEGRATION_TYPE':
        'отгрузку подтверждает водитель OZON при приёмке — из CRM не требуется',
    'POSTING_NOT_FOUND': 'OZON не нашёл это отправление',
    'STATE_NOT_VALID': 'отправление в другом статусе, отгрузить нельзя',
}

OZON_SHIP_BATCH = 500
# 20 — жёсткий предел самого OZON: «value must contain between 1 and 20 items».
# Больше в один запрос он не принимает и отвергает пачку целиком.
OZON_SHIP_CHUNK = 20
OZON_SHIP_WINDOW_SEC = 3.0


def ozon_ship_postings(cur, supply_id, limit=None, deadline=None):
    """Передаёт отправления поставки в доставку на стороне OZON.

    Кладовщик закрывает поставку — значит, короб уехал. На OZON отправления должны
    уйти из «ожидает отгрузки» в «доставляется», иначе площадка считает, что товар
    всё ещё у продавца, и начисляет просрочку.

    ОТПРАВЛЯЕМ ПАЧКАМИ. Метод last-mile принимает СПИСОК отправлений за раз.
    Раньше мы слали по одному — и не просто медленно: в поле posting_number
    уходила строка вместо списка, OZON отвечал «syntax error» и НЕ принимал
    ничего. Поставка на 400 отправлений давала 400 бесполезных запросов, функция
    обрывалась по таймауту, откатывая даже закрытие поставки, — кнопка выглядела
    нерабочей. Теперь одна пачка на сотню отправлений: вся поставка уходит за
    считанные запросы.

    limit/deadline — страховка на случай, если OZON начнёт отвечать медленно:
    берём сколько успеваем и честно возвращаем остаток, а не обрываемся молча.

    Возвращает (сколько передано, список проблем, сколько осталось).
    """
    client_id, api_key = _ozon_creds(cur)
    if not client_id or not api_key:
        return 0, [], 0

    # Берём только те отправления, что ещё НЕ переданы. Признак передачи —
    # ozon_status: мы сами ставим его в 'delivering' после успешного ответа
    # площадки. Без этого условия каждая следующая порция начинала бы список
    # заново, гоняя по кругу уже отправленное.
    cur.execute(
        "SELECT DISTINCT COALESCE(ro.ozon_posting_number, o.ozon_posting_number) "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "LEFT JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
        "WHERE msi.supply_id = %s "
        "AND COALESCE(ro.marketplace, o.marketplace) = 'OZON' "
        "AND COALESCE(ro.ozon_posting_number, o.ozon_posting_number) IS NOT NULL "
        "AND COALESCE(ro.ozon_status, o.ozon_status, '') NOT IN "
        "    ('delivering', 'delivered', 'cancelled')",
        (int(supply_id),),
    )
    numbers = [r[0] for r in cur.fetchall() if r[0]]
    if not numbers:
        return 0, [], 0

    total = len(numbers)
    if limit:
        numbers = numbers[:int(limit)]

    shipped, problems, handled = 0, [], 0
    for start in range(0, len(numbers), OZON_SHIP_CHUNK):
        if deadline and time.time() >= deadline:
            break
        chunk = numbers[start:start + OZON_SHIP_CHUNK]

        body = json.dumps({'posting_number': chunk}).encode('utf-8')
        req = urllib.request.Request(
            'https://api-seller.ozon.ru/v2/fbs/posting/last-mile',
            method='POST', data=body,
        )
        req.add_header('Client-Id', client_id)
        req.add_header('Api-Key', api_key)
        req.add_header('Content-Type', 'application/json')

        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                answer = json.loads(r.read().decode('utf-8', 'replace') or '{}')
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:160]
            problems.append(f'пачка из {len(chunk)}: {detail}')
            handled += len(chunk)
            continue
        except Exception as e:
            problems.append(f'пачка из {len(chunk)}: {str(e)[:120]}')
            handled += len(chunk)
            continue

        handled += len(chunk)

        # OZON отвечает построчно: по каждому отправлению — принято или нет.
        # Отмечаем доставленными ТОЛЬКО принятые, иначе отвергнутые молча
        # выпали бы из повторной отправки и остались бы у продавца.
        rows = answer.get('result')
        ok_numbers = []
        if isinstance(rows, list) and rows:
            for row in rows:
                if not isinstance(row, dict):
                    continue
                number = row.get('posting_number')
                if row.get('result'):
                    ok_numbers.append(number)
                    continue

                code = row.get('error')
                # Отгрузку этих отправлений подтверждает сам OZON — водитель при
                # приёмке короба. Из CRM подтверждать нечего, и это НЕ ошибка:
                # раньше кладовщик видел пугающий красный список на всю поставку,
                # хотя всё шло правильно. Молча пропускаем.
                if code in OZON_SHIP_SELF_CONFIRMED:
                    continue

                problems.append(
                    f"{number}: {OZON_SHIP_ERRORS.get(code, code or 'не принято')}"
                )
        else:
            # Ответ без построчного результата — считаем пачку принятой целиком.
            ok_numbers = chunk

        if ok_numbers:
            ids_sql = ','.join(
                "'" + str(n).replace("'", "''") + "'" for n in ok_numbers if n
            )
            if ids_sql:
                cur.execute(
                    f"UPDATE orders SET ozon_status = 'delivering' "
                    f"WHERE ozon_posting_number IN ({ids_sql})"
                )
            shipped += len(ok_numbers)

    return shipped, problems, max(0, total - handled)


def resolve_ozon_barcode(cur, barcode):
    """Превращает штрихкод с ярлыка OZON в номер отправления.

    На ярлыке OZON крупно печатает свой штрихкод (длинное число), а не номер
    отправления — сканер считывает именно его. В нашей базе такого кода нет, поэтому
    вещь «не находилась», хотя лежала у кладовщика в руках. Спрашиваем номер у OZON.

    Возвращает номер отправления или None, если это не штрихкод OZON.
    """
    if not barcode.isdigit() or len(barcode) < 12:
        return None
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'ozon' ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
    )
    row = cur.fetchone()
    if not row or not row[0] or not row[1]:
        return None
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1])
    client_id = (creds.get('clientId') or creds.get('client_id') or '').strip()
    api_key = (creds.get('apiKey') or creds.get('api_key') or '').strip()
    if not client_id or not api_key:
        return None

    req = urllib.request.Request(
        'https://api-seller.ozon.ru/v2/posting/fbs/get-by-barcode',
        method='POST',
        data=json.dumps({'barcode': str(barcode)}).encode('utf-8'),
    )
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        # 6 секунд: это запасной путь, когда штрихкод не нашёлся в своей базе.
        # Ждать четверть минуты ради него нельзя — сканирование встаёт.
        with urllib.request.urlopen(req, timeout=6) as r:
            data = json.loads(r.read().decode('utf-8') or '{}')
        return ((data.get('result') or {}).get('posting_number')) or None
    except Exception:
        # OZON не знает штрихкод или не ответил — просто ищем дальше по своей базе.
        return None


VALID_STATUSES = ['Открытая', 'На сборке', 'Отгрузка', 'Выполнена']

# Черновые (незавершённые) этапы пошива — заказ ещё "в работе" на производстве.
IN_PROGRESS_SEWING_STATUSES = ('На раскрое', 'Раскроено', 'В работе', 'Стикеровка')


def upload_pass_sticker(base64_data: str, file_name: str) -> str:
    """Загружает PDF стикера пропуска (WB) в S3, возвращает публичный CDN URL."""
    _, _, data = base64_data.partition(',')
    binary = base64.b64decode(data)

    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    safe_name = ''.join(c for c in (file_name or 'sticker.pdf') if c.isalnum() or c in ('.', '_', '-')) or 'sticker.pdf'
    key = f'pass-stickers/{uuid.uuid4().hex}-{safe_name}'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType='application/pdf')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def compute_order_status(sewing_status: str, box_number) -> str:
    """Мапит производственный статус заказа + принадлежность к коробу в статус для дропдауна:
    Новый / В работе / На поставку / В коробе №N."""
    if box_number:
        return f'В коробе №{box_number}'
    if sewing_status == 'Готовые':
        return 'На поставку'
    if sewing_status in IN_PROGRESS_SEWING_STATUSES:
        return 'В работе'
    return 'Новый'




def deny_manager_fbs(cur, supply_id=None, supply_type=None, actor_role=None):
    """Проверяет, что менеджер не правит FBS-поставку.

    FBS-поставку собирает кладовщик: он сканирует товары со своих полок на складе. Менеджер
    такую поставку только НАБЛЮДАЕТ в реальном времени — иначе состав поставки можно менять
    из-за стола, пока кладовщик физически собирает другой набор вещей, и данные разъедутся
    с реальностью. FBO-поставки менеджера это не касается — там состав ведёт именно он.

    Возвращает текст ошибки или None, если действие разрешено.
    """
    if (actor_role or '') != 'manager':
        return None
    if supply_type is None and supply_id:
        cur.execute("SELECT type FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
        row = cur.fetchone()
        supply_type = row[0] if row else None
    if supply_type == 'FBS':
        return ('FBS-поставку собирает кладовщик — вам доступен только просмотр '
                'хода сборки в реальном времени')
    return None




def log_action(cur, actor_id, actor_name, action, entity_type, entity_id, description):
    """Запись в журнал действий — чтобы было видно, кто и что делал с поставкой."""
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            'supply',
            action,
            entity_type,
            int(entity_id) if entity_id not in (None, '') else None,
            description,
        ),
    )


# Сколько поставка остаётся «занятой» без обновления от кладовщика.
# Страница шлёт сигнал «я здесь» каждую минуту; 5 минут тишины — значит человек
# закрыл вкладку, ушёл со смены или у него сел планшет. После этого поставку
# может взять другой, иначе она осталась бы заблокированной навсегда.
SUPPLY_LOCK_TTL_MINUTES = 5


def release_stale_supply_locks(cur):
    """Снимает блокировки, по которым давно нет признаков жизни."""
    cur.execute(
        "UPDATE marketplace_supplies SET locked_by = NULL, locked_at = NULL "
        f"WHERE locked_by IS NOT NULL AND locked_at < now() - interval '{SUPPLY_LOCK_TTL_MINUTES} minutes'"
    )


def get_supply_lock(cur, supply_id):
    """Кто сейчас занимает поставку: (id сотрудника, имя) или (None, None)."""
    cur.execute(
        "SELECT s.locked_by, u.full_name FROM marketplace_supplies s "
        "LEFT JOIN users u ON u.id = s.locked_by WHERE s.id = %s",
        (int(supply_id),),
    )
    r = cur.fetchone()
    return (r[0], r[1]) if r else (None, None)


def deny_if_locked_by_other(cur, supply_id, actor_id):
    """Текст ошибки, если поставку собирает другой сотрудник, иначе None.

    Проверяем на КАЖДОМ действии сборки, а не только при входе: без этого двое
    кладовщиков, открывших страницу одновременно, продолжали бы раскладывать
    заказы по чужим коробам.
    """
    if not actor_id:
        return None
    release_stale_supply_locks(cur)
    locked_by, locked_name = get_supply_lock(cur, supply_id)
    if locked_by and int(locked_by) != int(actor_id):
        return f'Поставку уже собирает {locked_name or "другой сотрудник"}'
    return None


def return_wb_order_to_accumulator(cur, goods_id):
    """Возвращает вещь WB FBS в резервную (накопительную) поставку.

    ЗАЧЕМ. Кладовщик убирает вещь из поставки, когда она не влезла в короб. Вещь при
    этом никуда не делась: она застикерована, покупатель её ждёт, и поедет она
    следующей поставкой. Но раньше вместе с позицией пропадала и связь с поставкой WB —
    вещь исчезала из счётчика «Ожидают отгрузки». Кладовщик открывал новую поставку и
    видел там ноль: найти убранную вещь можно было только вручную по складу.

    Теперь связь не удаляется, а ПЕРЕСТАВЛЯЕТСЯ в резервную поставку — туда же, откуда
    вещь попадает в сборку после стикеровки. Кладовщик сразу видит её в списке
    «ожидают отгрузки» и сканирует в новую поставку.

    На стороне WB заказ трогать не нужно: резервная поставка — тоже поставка WB, и
    задание просто переезжает в неё при следующем сканировании.

    Возвращает True, если связь восстановлена.
    """
    cur.execute(
        "SELECT o.id FROM goods_warehouse gw "
        "JOIN orders o ON o.id = COALESCE(gw.reserved_order_id, gw.order_id) "
        "WHERE gw.id = %s AND o.marketplace = 'WB' AND o.order_type = 'FBS' "
        "  AND o.status NOT IN ('Отгружен', 'Отменён')",
        (int(goods_id),),
    )
    row = cur.fetchone()
    if not row:
        return False
    order_id = row[0]

    # Резервная поставка: открытая накопительная. Если её нет — заводим свою запись.
    # Идентификатор на стороне WB здесь не нужен: он появится при сканировании.
    cur.execute(
        "SELECT id FROM marketplace_supplies "
        "WHERE marketplace = 'WB' AND type = 'FBS' AND is_accumulator = true "
        "  AND status IN ('Открытая', 'На сборке') ORDER BY id DESC LIMIT 1"
    )
    acc = cur.fetchone()
    if acc:
        acc_id = acc[0]
    else:
        cur.execute(
            "INSERT INTO marketplace_supplies (marketplace, type, status, comment, is_accumulator) "
            "VALUES ('WB', 'FBS', 'Открытая', %s, true) RETURNING id",
            ('Резервная поставка: вещи ждут сканирования в поставку',),
        )
        acc_id = cur.fetchone()[0]

    # Связь одна на заказ, поэтому переставляем существующую, а если её нет — создаём.
    cur.execute(
        "UPDATE wb_supply_orders SET supply_id = %s WHERE order_id = %s",
        (int(acc_id), int(order_id)),
    )
    if cur.rowcount == 0:
        cur.execute(
            "INSERT INTO wb_supply_orders (supply_id, order_id) VALUES (%s, %s) "
            "ON CONFLICT (order_id) DO UPDATE SET supply_id = EXCLUDED.supply_id",
            (int(acc_id), int(order_id)),
        )
    return True


def cancelled_item_info(cur, goods_id):
    """Данные отменённой вещи для карточки на терминале сборки.

    Кладовщик держит вещь в руках и должен понять, что с ней делать: карточка
    показывает размер (чтобы сверить с биркой) и штрихкод хранения (чтобы
    положить на полку). Если чего-то нет — просто не показываем это поле,
    сканирование из-за отсутствующей подписи останавливать нельзя.
    """
    # Берём заказ, под который вещь едет СЕЙЧАС (reserved_order_id), а если его нет —
    # тот, под который её сшили. Размер вещи от этого не меняется, но маркетплейс и
    # номер должны совпадать с тем, что кладовщик видит на ярлыке в руках.
    cur.execute(
        "SELECT o.material, o.width, o.height, o.marketplace, gw.storage_barcode "
        "FROM goods_warehouse gw "
        "JOIN orders o ON o.id = COALESCE(gw.reserved_order_id, gw.order_id) "
        "WHERE gw.id = %s",
        (int(goods_id),),
    )
    row = cur.fetchone()
    if not row:
        return {}
    return {
        'material': row[0],
        'width': row[1],
        'height': row[2],
        'marketplace': row[3],
        'storageBarcode': row[4],
    }


def find_cancelled_items(cur, supply_id):
    """Товары поставки, чьи заказы отменены маркетплейсом.

    Заказ могут отменить в любой момент — в том числе когда вещь уже сшита, застикерована
    и лежит в собранной поставке. Отгружать её нельзя: на маркетплейсе заказа больше нет.
    Такая вещь должна уехать на полку хранения и ждать нового покупателя, а поставку с ней
    внутри закрывать запрещено.

    Возвращает список словарей: id позиции, штрихкод хранения, номер заказа, связка.
    """
    # Смотрим заказ, под который вещь ЕДЕТ (reserved_order_id): именно его могли
    # отменить. Заказ, в котором вещь когда-то сшили, к отгрузке отношения не имеет.
    cur.execute(
        "SELECT msi.id, gw.storage_barcode, "
        "COALESCE(ro.order_number, o.order_number), COALESCE(ro.group_key, o.group_key) "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "LEFT JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
        "WHERE msi.supply_id = %s AND ("
        "  COALESCE(ro.status, o.status) = 'Отменён' "
        "  OR lower(coalesce(COALESCE(ro.ozon_status, o.ozon_status), '')) LIKE '%%cancel%%' "
        "  OR lower(coalesce(COALESCE(ro.ym_status, o.ym_status), '')) LIKE '%%cancel%%')",
        (int(supply_id),),
    )
    direct = [
        {'itemId': r[0], 'storageBarcode': r[1], 'orderNumber': r[2], 'groupKey': r[3],
         'reason': 'cancelled'}
        for r in cur.fetchall()
    ]

    # Связка Яндекса едет по ОДНОМУ общему ярлыку. Если отменили хотя бы одну вещь заказа,
    # отправлять остаток нельзя — покупателю уедет неполная посылка по ярлыку на весь заказ.
    # Поэтому на полку уходит вся связка целиком, а не только отменённая вещь.
    broken_keys = {c['groupKey'] for c in direct if c['groupKey']}
    if not broken_keys:
        return direct

    keys_csv = ','.join("'" + k.replace("'", "''") + "'" for k in broken_keys)
    cur.execute(
        "SELECT msi.id, gw.storage_barcode, o.order_number, o.group_key "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "JOIN orders o ON o.id = gw.order_id "
        f"WHERE msi.supply_id = %s AND o.group_key IN ({keys_csv})",
        (int(supply_id),),
    )
    known = {c['itemId'] for c in direct}
    for r in cur.fetchall():
        if r[0] not in known:
            direct.append({
                'itemId': r[0], 'storageBarcode': r[1], 'orderNumber': r[2],
                'groupKey': r[3],
                # Сама вещь не отменена — но её заказ уже неполный, ехать ей некуда.
                'reason': 'broken_group',
            })
    return direct


def check_fbo_underfilled(cur, supply_id):
    """Проверяет, собрана ли поставка FBO полностью.

    В заявке на маркетплейс указано, сколько единиц мы обещали привезти. Если отгрузить
    меньше, маркетплейс засчитает недовоз: заявка закроется частично, а остаток товара
    зависнет на складе до следующей поставки. Поэтому недособранную поставку не отдаём.

    Возвращает (собрано, план) — или None, если план не указан и проверять нечего.
    """
    cur.execute(
        "SELECT type, total_quantity_marketplace FROM marketplace_supplies WHERE id = %s",
        (int(supply_id),),
    )
    row = cur.fetchone()
    if not row:
        return None
    supply_type, planned = row
    # Проверка только для FBO: в FBS каждая вещь едет по своему ярлыку, и отгрузить
    # часть отправлений — нормальная ситуация.
    if supply_type != 'FBO' or not planned:
        return None

    cur.execute(
        "SELECT COUNT(*) FROM marketplace_supply_items WHERE supply_id = %s",
        (int(supply_id),),
    )
    collected = int(cur.fetchone()[0])
    if collected >= int(planned):
        return None
    return collected, int(planned)


def check_incomplete_groups(cur, supply_id):
    """Ищет в поставке заказы Яндекса, собранные не полностью.

    На заказ покупателя из нескольких вещей Яндекс выдаёт ОДИН ярлык. Если отгрузить часть
    такого заказа, вторая половина останется на складе, а покупатель получит неполную
    посылку — маркетплейс засчитает это как недовоз. Поэтому заказ едет только целиком.

    Возвращает список словарей с ключами groupKey, inSupply, total.
    """
    cur.execute(
        "SELECT o.group_key, count(*) AS in_supply, max(o.group_size) AS total "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "JOIN orders o ON o.id = gw.order_id "
        "WHERE msi.supply_id = %s AND o.group_key IS NOT NULL "
        "GROUP BY o.group_key HAVING count(*) < max(o.group_size)",
        (int(supply_id),),
    )
    return [
        {'groupKey': r[0], 'inSupply': int(r[1]), 'total': int(r[2] or 0)}
        for r in cur.fetchall()
    ]


def check_unlabeled_bundles(cur, supply_id):
    """Связки, собранные целиком, но БЕЗ наклеенного общего ярлыка.

    Сборка связки состоит из двух шагов: отсканировать вещи по стикерам YM и
    подтвердить общий ярлык маркетплейса, который клеится на коробку. Вещи
    внутри есть, а коробка не подписана — на приёмке её не опознают, и заказ
    зависнет. Поэтому такую поставку не отпускаем.
    """
    cur.execute(
        "SELECT o.group_key, count(*) AS in_supply, max(o.group_size) AS total "
        "FROM marketplace_supply_items msi "
        "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
        "JOIN orders o ON o.id = COALESCE(gw.reserved_order_id, gw.order_id) "
        "WHERE msi.supply_id = %s AND o.group_key IS NOT NULL "
        "  AND COALESCE(o.group_size, 1) > 1 "
        "  AND NOT EXISTS (SELECT 1 FROM supply_bundle_labels sbl "
        "                  WHERE sbl.supply_id = msi.supply_id "
        "                    AND sbl.group_key = o.group_key) "
        "GROUP BY o.group_key",
        (int(supply_id),),
    )
    return [
        {'groupKey': r[0], 'inSupply': int(r[1]), 'total': int(r[2] or 0)}
        for r in cur.fetchall()
    ]
