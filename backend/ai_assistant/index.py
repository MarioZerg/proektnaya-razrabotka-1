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
SQL_TIMEOUT_MS = 15000
# Сколько шагов «подумать → сходить в базу → подумать» разрешено за один вопрос.
# Хватает, чтобы уточнить данные парой запросов, но не даёт зациклиться.
MAX_STEPS = 4

# Слова, которых в запросе быть не должно. Это второй слой защиты: основной —
# READ ONLY у самого подключения к базе.
FORBIDDEN_SQL = re.compile(
    r'\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|'
    r'commit|rollback|copy|vacuum|reindex|call|do|set|lock|merge)\b',
    re.IGNORECASE,
)


def _schema_digest(cur, schema):
    """Список таблиц с колонками — чтобы модель знала, где что лежит.

    Без этого она выдумывает названия таблиц и запросы падают.
    """
    cur.execute(
        "SELECT table_name, column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = %s ORDER BY table_name, ordinal_position",
        (schema,),
    )
    tables = {}
    for table, column, dtype in cur.fetchall():
        tables.setdefault(table, []).append(f'{column} {dtype}')
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

УСТРОЙСТВО СИСТЕМЫ (для понимания вопросов):
- orders — заказы с маркетплейсов (Ozon, Wildberries, Яндекс). Поле sewing_status
  показывает этап: «Новый», «На раскрое», «В работе», «Стикеровка», «Со склада».
  Поле status — судьба заказа: «Отменён», «Отгружен», «Доставлен».
- goods_warehouse — конкретные вещи на складе. status: in_stock (на полке),
  picking (в подборе под заказ), shipped (уехала), mp_return (возврат с ПВЗ),
  lost (списана). reserved_order_id — под какой заказ отложена.
- rolls — рулоны ткани, materials — материалы, shelves — полки.
- users — сотрудники (роли: admin, manager, storekeeper, senior_storekeeper,
  sewer — швея, cutter — закройщик, packer — упаковщик, cleaner — уборщица).
- shift_sessions — смены: opened_at начало, closed_at конец (пусто = на смене).
- salary_accruals — начисления и штрафы, salary_payouts — выплаты.
- marketplace_supplies — поставки на маркетплейс, shipments — отгрузки.
- Время в базе хранится по Гринвичу, а рабочий день считается по Москве (+3 часа).
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
    finally:
        conn.close()

    # Схему указываем явно: на этой платформе search_path менять нельзя, поэтому
    # без префикса запросы модели не найдут ни одной таблицы.
    schema_rule = (
        f'\n\nВАЖНО ПРО ЗАПРОСЫ: все таблицы лежат в схеме "{schema}". '
        f'ВСЕГДА пиши имя схемы перед таблицей, например: '
        f'SELECT count(*) FROM {schema}.orders. Без схемы запрос не сработает.'
    )
    messages = [
        {'role': 'system', 'content': SYSTEM_PROMPT + schema_rule
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