"""ИИ-помощник по системе — отвечает на вопросы, но НИЧЕГО не меняет.

ЗАЧЕМ ЭТО НУЖНО.
Данные о работе фабрики разбросаны по сотне таблиц и трём десяткам страниц.
Простой вопрос вроде «сколько заказов висит в раскрое» или «какие рулоны
заканчиваются» требует знать, где смотреть. Помощник отвечает словами: человек
спрашивает по-русски, а система сама достаёт цифры из базы.

ГЛАВНОЕ ПРАВИЛО — ТОЛЬКО ЧТЕНИЕ.
Помощник не может изменить в системе ни строчки. Защита стоит в три слоя, и
каждый работает сам по себе:
  1) подключение к базе открыто в режиме READ ONLY — сама база отклонит любую
     попытку записи, даже если запрос всё-таки проскочит;
  2) текст запроса проверяется до отправки: разрешено только SELECT, а слова
     вроде INSERT, UPDATE, DELETE, DROP запрещены;
  3) модель физически не имеет других инструментов — она умеет только задать
     вопрос к базе и прочитать ответ.
Поэтому даже если пользователь напишет «удали все заказы», выполнить это
невозможно: запрос будет отклонён.

КАК ЭТО РАБОТАЕТ.
Модель получает список таблиц и, если нужны цифры, сама пишет SELECT-запрос.
Мы выполняем его, возвращаем результат модели, и она отвечает человеку обычным
текстом. Отвечает по-русски и без технических терминов — вопросы задаёт
владелец, а не программист.

ДОСТУП. Только администраторы: помощник видит зарплаты, выручку и полные данные
по сотрудникам, и открывать это цеху нельзя.
"""

import json
import os
import re
import urllib.error
import urllib.request

import psycopg2

AITUNNEL_URL = 'https://api.aitunnel.ru/v1/chat/completions'

# Модель берётся из настроек, а если её там нет — первая рабочая из списка.
# Список нужен потому, что ключи в aitunnel открывают разный набор моделей:
# заказанная может оказаться недоступна, и вместо ответа человек получил бы
# ошибку. Все варианты — недорогие и быстрые, разница для наших вопросов
# незаметна.
MODEL_CANDIDATES = [
    'gpt-4o-mini',
    'gpt-4.1-mini',
    'gpt-5-mini',
    'gpt-5.4-mini',
    'gpt-4.1-nano',
]

# Ограничения на запросы модели к базе. Помощник отвечает на вопросы, а не
# выгружает базу: большие выборки только жгут деньги и тормозят ответ.
MAX_ROWS = 200
SQL_TIMEOUT_MS = 8000
# Сколько шагов «подумать → сходить в базу → подумать» разрешено за один вопрос.
# Хватает, чтобы уточнить данные несколькими запросами (например, когда первый
# вернул пусто и надо проверить соседние даты), но не даёт зациклиться.
MAX_STEPS = 6

# Слова, которых в запросе быть не должно. Это второй слой защиты: основной —
# READ ONLY у самого подключения к базе.
FORBIDDEN_SQL = re.compile(
    r'\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|'
    r'commit|rollback|copy|vacuum|reindex|call|do|set|lock|merge)\b',
    re.IGNORECASE,
)


# Таблицы, по которым спрашивают на деле. В базе их больше сотни, и если
# отправлять модели все, запрос разбухает и ответ приходит заметно дольше —
# а служебные таблицы (коды входа, курсоры синхронизации, журналы) на вопросы
# владельца всё равно не отвечают.
USEFUL_TABLES = (
    'orders', 'goods_warehouse', 'rolls', 'materials', 'material_defects',
    'shelves', 'users', 'shift_sessions', 'shifts', 'workshops',
    'salary_accruals', 'salary_payouts', 'salary_rates',
    'marketplace_supplies', 'marketplace_supply_items', 'marketplace_items',
    'marketplace_returns', 'marketplace_sales', 'marketplace_stocks',
    'marketplace_buyout', 'marketplace_prices', 'reviews',
    'shipments', 'shipment_items', 'suppliers', 'supplier_prices',
    'contracts', 'vacations', 'stocktakes', 'cash_box_transactions',
    'manager_accruals', 'order_material_usage', 'material_movements',
    'variki_purchases', 'variki_shop_items', 'audit_log',
)

# Колонки, которые модели знать незачем: технические ссылки на внешние системы,
# служебные отметки синхронизации, следы интеграций. Они раздувают справочник
# (а значит, и время ответа), но на вопросы владельца не отвечают.
SKIP_COLUMN_PATTERNS = (
    'posting_number', 'sync_', '_sync', 'external_', 'raw_', '_json',
    'cursor', 'webhook', 'token', 'secret', 'password', 'hash',
)


def _useful_column(name: str) -> bool:
    """Нужна ли колонка в справочнике для модели."""
    low = name.lower()
    return not any(p in low for p in SKIP_COLUMN_PATTERNS)


def _schema_digest(cur, schema):
    """Список таблиц с колонками — чтобы модель знала, где что лежит.

    Без этого она выдумывает названия таблиц и запросы падают.
    """
    cur.execute(
        "SELECT table_name, column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = ANY(%s) "
        "ORDER BY table_name, ordinal_position",
        (schema, list(USEFUL_TABLES)),
    )
    # Типы сокращаем до коротких обозначений: модели достаточно понимать, число
    # это, дата или текст, а полные названия типов занимают половину справочника.
    short = {
        'character varying': 'текст', 'text': 'текст', 'integer': 'число',
        'bigint': 'число', 'numeric': 'число', 'double precision': 'число',
        'boolean': 'да/нет', 'date': 'дата',
        'timestamp without time zone': 'дата+время',
        'timestamp with time zone': 'дата+время', 'jsonb': 'json',
    }
    tables = {}
    for table, column, dtype in cur.fetchall():
        if not _useful_column(column):
            continue
        tables.setdefault(table, []).append(f'{column} {short.get(dtype, dtype)}')
    return '\n'.join(f'{t}({", ".join(cols)})' for t, cols in tables.items())


def _is_safe_select(sql: str) -> tuple:
    """Проверяет, что запрос только читает. Возвращает (можно ли, причина отказа)."""
    clean = sql.strip().rstrip(';').strip()
    if not clean:
        return False, 'Пустой запрос'
    # Несколько команд за раз — классический способ спрятать запись во втором
    # запросе. Разрешаем ровно одну.
    if ';' in clean:
        return False, 'Разрешён только один запрос без точки с запятой'
    low = clean.lower()
    if not (low.startswith('select') or low.startswith('with')):
        return False, 'Разрешены только запросы на чтение (SELECT)'
    if FORBIDDEN_SQL.search(clean):
        return False, 'В запросе есть команда изменения данных — это запрещено'
    return True, ''


def _run_select(dsn, schema, sql):
    """Выполняет SELECT в режиме только для чтения и возвращает строки текстом."""
    ok, reason = _is_safe_select(sql)
    if not ok:
        return f'ОТКАЗАНО: {reason}'

    conn = psycopg2.connect(dsn)
    try:
        # ГЛАВНАЯ ЗАЩИТА: соединение только для чтения. Любая попытка записи
        # отклоняется самой базой, что бы ни было в тексте запроса.
        conn.set_session(readonly=True, autocommit=True)
        cur = conn.cursor()
        cur.execute(sql)
        if cur.description is None:
            return 'Запрос ничего не вернул'
        cols = [d[0] for d in cur.description]
        rows = cur.fetchmany(MAX_ROWS)
        if not rows:
            return 'Данных нет (пустой результат)'
        lines = [' | '.join(cols)]
        for r in rows:
            lines.append(' | '.join('' if v is None else str(v) for v in r))
        if len(rows) == MAX_ROWS:
            lines.append(f'... показаны первые {MAX_ROWS} строк')
        return '\n'.join(lines)
    except Exception as e:
        # Ошибку отдаём модели как есть: она сама исправит запрос и повторит.
        return f'ОШИБКА ЗАПРОСА: {e}'
    finally:
        conn.close()


def _call_model(api_key, model, messages, tools):
    """Один запрос к сервису ИИ. Возвращает (ответ, ошибка, код ошибки)."""
    payload = {
        'model': model,
        'messages': messages,
        'temperature': 0.2,
    }
    if tools:
        payload['tools'] = tools
    req = urllib.request.Request(
        AITUNNEL_URL,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode('utf-8')), None, 0
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')
        return None, f'Сервис ИИ ответил ошибкой {e.code}: {body[:300]}', e.code
    except Exception as e:
        return None, f'Не удалось связаться с сервисом ИИ: {e}', 0


def _ask_model(api_key, messages, tools, model_state):
    """Отправляет диалог модели и возвращает её ответ.

    Если выбранная модель ключу недоступна (сервис отвечает 403), молча
    переключаемся на следующую из списка: для человека это должно выглядеть
    как обычный ответ, а не как ошибка настройки.
    """
    if model_state.get('model'):
        return _call_model(api_key, model_state['model'], messages, tools)[:2]

    preferred = os.environ.get('AITUNNEL_MODEL', '').strip()
    candidates = ([preferred] if preferred else []) + [
        m for m in MODEL_CANDIDATES if m != preferred
    ]
    last_err = 'Не удалось подобрать доступную модель'
    for model in candidates:
        data, err, code = _call_model(api_key, model, messages, tools)
        if data is not None:
            # Запомнили рабочую модель — дальше в этом же вопросе не перебираем.
            model_state['model'] = model
            return data, None
        last_err = err
        # 403 — модель ключу не разрешена, пробуем следующую. Остальные ошибки
        # (сеть, лимиты) перебором не лечатся.
        if code != 403:
            break
    return None, last_err


SYSTEM_PROMPT = """Ты — помощник по системе управления производством штор и тюля «Мегатюль».
Отвечаешь владельцу бизнеса и администраторам.

КАК ОТВЕЧАТЬ:
- Только по-русски, простым деловым языком, без технических терминов.
- Не показывай SQL-запросы и названия таблиц, если о них прямо не спросили.
- Коротко и по делу: сначала ответ, потом при необходимости пояснение.
- Числа приводи точно, как в базе. Если данных нет — так и скажи, не выдумывай.
- Суммы денег — в рублях, даты — в привычном виде (3 сентября 2026).

ЧТО ТЫ МОЖЕШЬ:
- Отвечать на вопросы о работе фабрики, читая данные из базы.
- Объяснять, как устроены процессы и разделы системы.

ЧЕГО ТЫ НЕ МОЖЕШЬ:
- Менять что-либо в системе. Доступ только на чтение. Если просят изменить,
  удалить или добавить данные — вежливо объясни, что ты только показываешь
  информацию, а изменения делаются в соответствующем разделе системы.

РАБОТА С БАЗОЙ:
- Если для ответа нужны цифры — вызови инструмент sql_query с запросом SELECT.
- Разрешён только SELECT (можно с WITH). Одна команда за раз.
- Всегда ограничивай выборку: LIMIT, агрегаты (count, sum), группировки.
- Не запрашивай пароли, токены и коды входа — это личные данные.

КАК УСТРОЕНО ПРОИЗВОДСТВО (путь заказа):
Заказ приходит с маркетплейса → закройщик режет ткань из рулона → швея шьёт →
упаковщица пакует и клеит стикер → кладовщик собирает вещи под отправления и
отгружает поставку на маркетплейс. Часть заказов закрывается не пошивом, а
готовой вещью со склада (sewing_status='Со склада').

ЗАКАЗЫ (таблица orders):
- sewing_status — этап пошива. РЕАЛЬНЫЕ значения в базе, других НЕТ:
    'Новый'     — ждёт работы (ещё не в раскрое)
    'Раскроено' — закройщик раскроил, ждёт швею
    'Готовые'   — пошив завершён
    'Со склада' — заказ закрыт готовой вещью со склада, а не пошивом
    'Отменён'   — отменён
  ВАЖНО: статусов «В работе», «На раскрое», «Стикеровка» в базе НЕ существует.
  Вопрос «сколько заказов в работе» = ещё не готовые и не отменённые, то есть
  sewing_status IN ('Новый','Раскроено').
- status — судьба заказа: 'Новый', 'Готов', 'Выполнен', 'Отгружен', 'Отменён'.
- ЖИВОЙ заказ (не отменён и не уехал): COALESCE(status,'') NOT IN
  ('Отменён','Отгружен') — почти всегда нужно добавлять это условие.
- marketplace — площадка: 'OZON', 'WB', 'Yandex' (именно так, заглавными).
- product — что за вещь текстом, например 'Лен 300x265'; material, width, height —
  то же по отдельности. order_type — 'FBS' или 'FBO'.
- Кто делал: cutter_user_id (закройщик), sewer_user_id (швея), assigned_user_id.

СКЛАД ГОТОВЫХ ВЕЩЕЙ (goods_warehouse) — одна строка = одна физическая вещь:
- status, реальные значения: 'in_stock' (лежит на полке, свободна),
  'picking' (подобрана под заказ, кладовщик должен снять с полки),
  'awaiting_supply' (уже в собираемой поставке), 'reserved' (отложена),
  'repacking' (у упаковщицы на переупаковке), 'shipped' (уехала),
  'mp_return' (возврат с ПВЗ, ждёт разбора), 'lost' (списана),
  'to_dispose' (на утилизацию), 'awaiting_shelf', 'inspected', 'taken'.
- reserved_order_id — под какой заказ отложена вещь. storage_barcode — её стикер.
- shelf_id → shelves.name — на какой полке лежит.
- «Сколько товара на складе» — это status='in_stock'.

РУЛОНЫ ТКАНИ (rolls):
- status: 'in_storage' (на складе), 'in_workshop' (в цехе, из него кроят),
  'completed' (израсходован).
- remaining_quantity — сколько осталось (метры или штуки, см. materials.unit).
- «Заканчиваются» — это рулоны В ЦЕХЕ с малым остатком:
  status='in_workshop' AND remaining_quantity < 20, сортировать по остатку.
- material_id → materials (name, unit).

СОТРУДНИКИ И СМЕНЫ:
- users.full_name — имя, users.role — должность: 'sewer' (швея), 'cutter'
  (закройщик), 'packer' (упаковщица), 'storekeeper' (кладовщик),
  'senior_storekeeper' (старший кладовщик), 'cleaner' (уборщица),
  'manager' (менеджер), 'admin' (администратор).
- Работающие сотрудники: is_active = true И contract_terminated_at IS NULL.
  На вопрос «сколько человек работает» считай именно так, иначе в число попадут
  уволенные.
- shift_sessions — смены: opened_at начало, closed_at конец.
  «Кто сейчас на смене» = closed_at IS NULL.
- Начало и конец смены хранятся в UTC, а рабочий день считается по Москве (+3 часа).

ПОСТАВКИ И ОТГРУЗКИ:
- marketplace_supplies — поставки на маркетплейс, status: 'На сборке',
  'Выполнена', 'Отменена'. type — 'FBS' или 'FBO'.
- marketplace_supply_items — что в поставке (ссылки на goods_warehouse).
- shipments — отгрузки: type='to_workshop' (материал в цех),
  'from_supplier' (приход от поставщика) и другие.
- marketplace_returns — возвраты с маркетплейса, reviews — отзывы покупателей.

ЗАРПЛАТЫ И ЗАРАБОТОК:
- salary_accruals — все начисления сотрудникам. amount: положительная сумма —
  заработок, отрицательная — удержание. user_id — кому начислено.
- type, реальные значения: 'sewer_piece' (швее за пошив), 'cutter_cut'
  (закройщику за раскрой), 'packer_stickering' (упаковщице за стикеровку),
  'packer_repack' (за переупаковку), 'storekeeper_shift' и
  'senior_storekeeper_shift' (оклад кладовщика за смену), 'cleaner_shift'
  (оклад уборщицы), 'manual' (начислено вручную), 'penalty' (штраф),
  'deduction' (удержание).
- Сдельщики (швея, закройщик, упаковщица) получают за каждую единицу работы —
  поэтому у них за день десятки строк начислений. Кладовщик и уборщица получают
  оклад за смену, у них одна строка.
- ГЛАВНОЕ: за какой рабочий день начисление, показывает поле accrued_for (дата),
  а НЕ created_at. Вопросы «кто сколько заработал вчера / за вчера / за 2 сентября»
  считай по accrued_for.
- Имя сотрудника бери из users.full_name (соединяй по user_id).
- «Сколько заработал» — это SUM(amount) с группировкой по сотруднику и
  сортировкой по убыванию. Штрафы уже входят в сумму со знаком минус.
- salary_payouts — фактические выплаты денег на руки, это НЕ то же самое, что
  заработок за день. paid_at в начислении — когда деньги выплачены.
- cash_box_transactions — касса, manager_accruals — начисления менеджеру.

КАК СЧИТАТЬ ДАТЫ (очень важно):
- НИКОГДА не подставляй дату из головы — ты не знаешь сегодняшнее число.
- Всегда вычисляй даты прямо в запросе от текущего момента базы.
- Сегодня по Москве: (now() + interval '3 hours')::date
- Вчера: (now() + interval '3 hours')::date - 1
- Пример «кто сколько заработал вчера»:
  SELECT u.full_name, SUM(sa.amount) AS zarabotok
  FROM <схема>.salary_accruals sa
  JOIN <схема>.users u ON u.id = sa.user_id
  WHERE sa.accrued_for = (now() + interval '3 hours')::date - 1
  GROUP BY u.full_name ORDER BY zarabotok DESC;
- Если запрос вернул пусто — прежде чем говорить «данных нет», проверь соседние
  дни (например MAX(accrued_for)): возможно, ты ошибся с датой.

ЕСЛИ ЗАПРОС ВЕРНУЛ ПУСТО — НЕ СПЕШИ ГОВОРИТЬ «ДАННЫХ НЕТ»:
Чаще всего дело не в отсутствии данных, а в неверном значении в условии.
Сделай ещё один запрос и посмотри, какие значения там есть на самом деле:
  SELECT sewing_status, count(*) FROM <схема>.orders GROUP BY sewing_status;
и ответь уже по фактическим значениям. Пустой ответ — почти всегда моя ошибка
в фильтре, а не отсутствие работы на фабрике.

ПРИМЕРЫ ПРАВИЛЬНЫХ ЗАПРОСОВ:
- «Сколько заказов в работе»:
  SELECT sewing_status, count(*) FROM <схема>.orders
  WHERE sewing_status IN ('Новый','Раскроено')
    AND COALESCE(status,'') NOT IN ('Отменён','Отгружен')
  GROUP BY sewing_status;
- «Какие рулоны заканчиваются»:
  SELECT m.name, r.remaining_quantity, m.unit FROM <схема>.rolls r
  JOIN <схема>.materials m ON m.id = r.material_id
  WHERE r.status='in_workshop' AND r.remaining_quantity < 20
  ORDER BY r.remaining_quantity LIMIT 30;
- «Кто сейчас на смене»:
  SELECT u.full_name, u.role, ss.opened_at FROM <схема>.shift_sessions ss
  JOIN <схема>.users u ON u.id = ss.user_id WHERE ss.closed_at IS NULL;
- «Сколько товара на складе»:
  SELECT count(*) FROM <схема>.goods_warehouse WHERE status='in_stock';
"""

TOOLS = [{
    'type': 'function',
    'function': {
        'name': 'sql_query',
        'description': (
            'Выполняет SELECT-запрос к базе данных системы и возвращает строки. '
            'Только чтение: изменять данные нельзя. Всегда ограничивай объём '
            'выборки через LIMIT или агрегаты.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'sql': {
                    'type': 'string',
                    'description': 'SQL-запрос SELECT (или WITH). Одна команда, без точки с запятой.',
                },
            },
            'required': ['sql'],
        },
    },
}]


def handler(event: dict, context) -> dict:
    """ИИ-помощник по системе: отвечает на вопросы, читая данные из базы.

    Доступ только у администраторов. Вносить изменения помощник не может:
    подключение к базе открыто в режиме «только чтение», а текст запроса
    дополнительно проверяется на запрещённые команды.

    POST / { question, history?, userId }
      question — вопрос человека обычным текстом
      history  — предыдущие сообщения [{role, content}] для продолжения беседы
      userId   — кто спрашивает; роль проверяется по базе, должна быть admin
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

    api_key = os.environ.get('AITUNNEL_API_KEY', '').strip()

    # Проверка настройки: какие модели доступны сервису. Нужна, когда чат
    # отвечает ошибкой доступа — сразу видно, дело в ключе или в модели.
    if method == 'GET' and (event.get('queryStringParameters') or {}).get('models'):
        probe = (event.get('queryStringParameters') or {}).get('probe')
        if probe:
            checked = {}
            for m in [x.strip() for x in probe.split(',') if x.strip()]:
                data, err, code = _call_model(
                    api_key, m,
                    [{'role': 'user', 'content': 'ответь одним словом: ок'}], None,
                )
                checked[m] = 'ok' if data is not None else f'{code}: {(err or "")[:400]}'
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps(checked, ensure_ascii=False)}

        req = urllib.request.Request(
            'https://api.aitunnel.ru/v1/models',
            headers={'Authorization': f'Bearer {api_key}'},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode())
            ids = [m.get('id') for m in data.get('data', [])]
        except Exception as e:
            return {'statusCode': 502, 'headers': headers,
                    'body': json.dumps({'error': str(e)}, ensure_ascii=False)}
        return {'statusCode': 200, 'headers': headers,
                'body': json.dumps({'total': len(ids), 'models': ids}, ensure_ascii=False)}

    if method != 'POST':
        return {'statusCode': 405, 'headers': headers,
                'body': json.dumps({'error': 'Только POST'}, ensure_ascii=False)}

    if not api_key:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps(
            {'error': 'Не настроен ключ доступа к сервису ИИ'}, ensure_ascii=False)}

    body_data = json.loads(event.get('body') or '{}')
    question = (body_data.get('question') or '').strip()
    user_id = body_data.get('userId')
    history = body_data.get('history') or []

    if not question:
        return {'statusCode': 400, 'headers': headers,
                'body': json.dumps({'error': 'Пустой вопрос'}, ensure_ascii=False)}
    if not user_id:
        return {'statusCode': 400, 'headers': headers,
                'body': json.dumps({'error': 'Не указан пользователь'}, ensure_ascii=False)}

    dsn = os.environ['DATABASE_URL']
    schema = os.environ.get('MAIN_DB_SCHEMA', 'public')

    # ПРАВО ДОСТУПА ПРОВЕРЯЕМ ПО БАЗЕ, А НЕ ПО ФЛАГУ ИЗ БРАУЗЕРА.
    # Помощник видит зарплаты и выручку — открывать это цеху нельзя.
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT role FROM {schema}.users WHERE id = %s", (int(user_id),))
        row = cur.fetchone()
        if not row or row[0] != 'admin':
            return {'statusCode': 403, 'headers': headers, 'body': json.dumps(
                {'error': 'Помощник доступен только администраторам'}, ensure_ascii=False)}
        schema_text = _schema_digest(cur, schema)
        # Сегодняшняя дата по Москве. Без неё модель подставляла дату «из головы»
        # (например 2023 год) и на вопрос «кто сколько заработал вчера» отвечала,
        # что данных нет, хотя начисления в базе были.
        cur.execute("SELECT to_char(now() + interval '3 hours', 'YYYY-MM-DD'), "
                    "to_char(now() + interval '3 hours', 'DD.MM.YYYY HH24:MI')")
        today_iso, now_human = cur.fetchone()
    finally:
        conn.close()

    # Схему указываем явно: на этой платформе search_path менять нельзя, поэтому
    # без префикса запросы модели не найдут ни одной таблицы.
    schema_rule = (
        f'\n\nВАЖНО ПРО ЗАПРОСЫ: все таблицы лежат в схеме "{schema}". '
        f'ВСЕГДА пиши имя схемы перед таблицей, например: '
        f'SELECT count(*) FROM {schema}.orders. Без схемы запрос не сработает.'
    )
    date_rule = (
        f'\n\nСЕГОДНЯ: {today_iso} (по Москве сейчас {now_human}). '
        f'Вчера — это {today_iso} минус один день. Используй эти сведения, чтобы '
        f'правильно понимать слова «сегодня», «вчера», «на этой неделе», но в '
        f'самих запросах всё равно вычисляй даты от now(), как показано выше.'
    )
    messages = [
        {'role': 'system', 'content': SYSTEM_PROMPT + schema_rule + date_rule
            + '\n\nТАБЛИЦЫ БАЗЫ ДАННЫХ:\n' + schema_text},
    ]
    # Прошлые сообщения беседы: без них помощник не поймёт «а за прошлый месяц?».
    for m in history[-10:]:
        role = m.get('role')
        content = (m.get('content') or '').strip()
        if role in ('user', 'assistant') and content:
            messages.append({'role': role, 'content': content})
    messages.append({'role': 'user', 'content': question})

    queries_ran = []
    model_state = {}
    for _ in range(MAX_STEPS):
        data, err = _ask_model(api_key, messages, TOOLS, model_state)
        if err:
            # Частый случай — ключ выпущен с ограничением по списку моделей.
            # Человеку нужен не текст ошибки сервиса, а что именно поправить.
            if 'не разрешена для этого API-ключа' in err:
                err = (
                    'Ключ доступа к ИИ выдан без прав на модели. Зайдите в личный '
                    'кабинет aitunnel.ru → раздел с ключами → откройте ключ и '
                    'разрешите ему модель (например gpt-4o-mini) либо создайте '
                    'новый ключ без ограничений по моделям.'
                )
            return {'statusCode': 502, 'headers': headers,
                    'body': json.dumps({'error': err}, ensure_ascii=False)}

        choice = (data.get('choices') or [{}])[0]
        msg = choice.get('message') or {}
        calls = msg.get('tool_calls') or []

        if not calls:
            answer = (msg.get('content') or '').strip()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                'answer': answer or 'Не удалось получить ответ, попробуйте переспросить.',
                'queries': queries_ran,
                'model': model_state.get('model'),
            }, ensure_ascii=False)}

        messages.append(msg)
        for call in calls:
            fn = (call.get('function') or {})
            try:
                args = json.loads(fn.get('arguments') or '{}')
            except json.JSONDecodeError:
                args = {}
            sql = (args.get('sql') or '').strip()
            result = _run_select(dsn, schema, sql)
            queries_ran.append(sql)
            messages.append({
                'role': 'tool',
                'tool_call_id': call.get('id'),
                'content': result[:12000],
            })

    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
        'answer': 'Вопрос оказался слишком сложным — попробуйте спросить конкретнее.',
        'queries': queries_ran,
    }, ensure_ascii=False)}