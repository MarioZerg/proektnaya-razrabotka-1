"""MCP-сервер проекта: внешний ИИ-агент (Cursor и подобные) читает проект.

ЗАЧЕМ ЭТО НУЖНО.

Иногда работу над проектом хочется вести не только здесь, но и во внешнем
редакторе с собственным агентом. Чтобы такой агент был полезен, ему нужно
видеть то же, что вижу я: исходный код, структуру базы, реальные данные и
журнал действий. Иначе он советует наугад.

Этот файл — один HTTP-адрес, который говорит на языке MCP (Model Context
Protocol). Cursor подключает его как набор инструментов, и агент сам ходит за
файлами и данными, а не просит человека копировать их в чат.

ГРАНИЦЫ, КОТОРЫЕ ЗДЕСЬ ЖЁСТКО ЗАШИТЫ.

1. ТОЛЬКО ЧТЕНИЕ. Ни один инструмент не меняет ни файл, ни строку в базе.
   Внешний агент — консультант, а не второй хозяин склада. Правки идут через
   обычный git: агент готовит их у себя, человек смотрит и присылает в проект.
   Поэтому в db_query разрешён только SELECT, и запрос выполняется в транзакции
   read only — если в тексте спрячут UPDATE, база сама его отклонит.

2. ПАРОЛЬ ОБЯЗАТЕЛЕН. Адрес функции публичный, так что без пароля это была бы
   открытая дверь ко всему коду и данным. Пароль лежит в секрете проекта и
   сверяется побайтно, устойчиво к подбору по времени ответа.

3. СЕКРЕТЫ НЕ ОТДАЮТСЯ НИКОГДА. Ключи интеграций и строка подключения к базе
   наружу не уходят: агенту для работы достаточно знать, что секрет есть, а
   утёкший ключ маркетплейса — это уже чужие деньги.

4. ПЕРСОНАЛЬНЫЕ ДАННЫЕ ЗАКРЫТЫ. Паспорта, телефоны, адреса и токены входа
   сотрудников из выдачи вырезаны. Агенту для понимания логики они не нужны,
   а утечка такого списка — это ответственность владельца по закону о
   персональных данных.
"""

import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Authorization, '
                                    'X-Agent-Token, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Max-Age': '86400',
}

HEADERS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

REPO = 'MarioZerg/proektnaya-razrabotka-1'

PROTOCOL_VERSION = '2024-11-05'

# Что агенту читать бессмысленно. node_modules и lock-файлы — это чужой код на
# десятки мегабайт: он забьёт агенту всё внимание и вытеснит наш собственный код,
# ради которого его и позвали.
SKIP_PREFIXES = ('node_modules/', 'dist/', '.git/', 'public/')
SKIP_NAMES = ('bun.lock', 'package-lock.json', 'vite-dev.log')

# Один файл целиком в ответе. Больше — агент всё равно не осмыслит, а ответ
# начнёт обрываться по таймауту.
MAX_FILE_BYTES = 400_000

# Таблицы, которых внешний агент не касается совсем. Здесь личные документы
# сотрудников и действующие токены входа: по такому токену можно войти в систему
# от чужого имени, поэтому отдавать их нельзя даже на чтение.
FORBIDDEN_TABLES = (
    'personal_data',
    'auth_sessions',
    'max_login_codes',
    'max_login_tokens',
    'telegram_login_codes',
)

# Колонки, которые вырезаются из любой выдачи, в какой таблице бы ни встретились.
# Список намеренно шире, чем кажется нужным: лишняя скрытая колонка агенту не
# помешает разобраться в логике, а утёкший паспорт сотрудника вернуть нельзя.
FORBIDDEN_COLUMNS = (
    'password', 'password_hash', 'password_salt',
    'token', 'access_token', 'refresh_token', 'max_pending_token',
    'api_key', 'secret',
    'passport', 'passport_number', 'passport_series', 'passport_issued_by',
    'passport_issued_date', 'passport_department_code',
    'inn', 'snils', 'card_number', 'account_number',
    'phone', 'sbp_phone', 'email',
    'address', 'registration_address', 'birth_date',
    'salary',
)

MAX_ROWS = 200


def _resp(status, body, extra_headers=None):
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    return {'statusCode': status, 'headers': headers, 'body': json.dumps(body, ensure_ascii=False)}


def _rpc_ok(req_id, result):
    return _resp(200, {'jsonrpc': '2.0', 'id': req_id, 'result': result})


def _rpc_err(req_id, code, message):
    return _resp(200, {'jsonrpc': '2.0', 'id': req_id, 'error': {'code': code, 'message': message}})


def _text_result(text, is_error=False):
    """Ответ инструмента. MCP ждёт список блоков содержимого, а не голую строку."""
    return {'content': [{'type': 'text', 'text': text}], 'isError': is_error}


def _check_token(event):
    """Пускать ли запрос. Сверка побайтная: обычное == выдаёт длину пароля."""
    expected = os.environ.get('MCP_AGENT_TOKEN') or ''
    if not expected:
        return False
    headers = {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}
    raw = (
        headers.get('x-agent-token')
        or headers.get('x-authorization')
        or headers.get('authorization')
        or ''
    ).strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return hmac.compare_digest(raw, expected)


# --------------------------------------------------------------------------
# Код проекта. Берём из GitHub: файлы проекта лежат там, а сама функция
# запускается отдельно от них и своего дерева исходников не видит.
# --------------------------------------------------------------------------

def _gh(path, params=None):
    url = f'https://api.github.com{path}'
    if params:
        url += '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json',
        # Имя MCP_GITHUB_TOKEN, а не GITHUB_TOKEN: короткое имя занято самой
        # платформой под её собственную интеграцию с GitHub, и секрет с таким
        # именем в проект не добавляется.
        'Authorization': f'Bearer {os.environ["MCP_GITHUB_TOKEN"]}',
        'User-Agent': 'poehali-mcp',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def _is_interesting(path):
    if any(path.startswith(p) for p in SKIP_PREFIXES):
        return False
    return path.rsplit('/', 1)[-1] not in SKIP_NAMES


def tool_list_files(args):
    """Дерево файлов проекта."""
    prefix = (args.get('path') or '').strip().lstrip('/')
    head = _gh(f'/repos/{REPO}/branches/main')
    sha = head['commit']['commit']['tree']['sha']
    tree = _gh(f'/repos/{REPO}/git/trees/{sha}', {'recursive': '1'})
    rows = []
    for node in tree.get('tree', []):
        if node.get('type') != 'blob':
            continue
        path = node['path']
        if not _is_interesting(path):
            continue
        if prefix and not path.startswith(prefix):
            continue
        rows.append(f'{path}\t{node.get("size", 0)}')
    rows.sort()
    header = f'Файлов: {len(rows)} (путь\tразмер в байтах)'
    if tree.get('truncated'):
        header += '\nВНИМАНИЕ: GitHub обрезал дерево, список неполный.'
    return _text_result(header + '\n' + '\n'.join(rows))


def tool_read_file(args):
    """Содержимое одного файла."""
    path = (args.get('path') or '').strip().lstrip('/')
    if not path:
        return _text_result('Укажите path — путь к файлу, например src/App.tsx', True)
    if not _is_interesting(path):
        return _text_result(f'{path} — служебный или сгенерированный файл, он не отдаётся', True)
    try:
        data = _gh(f'/repos/{REPO}/contents/{urllib.parse.quote(path)}', {'ref': 'main'})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return _text_result(f'Файл {path} не найден', True)
        raise
    if isinstance(data, list):
        names = '\n'.join(sorted(d['path'] for d in data))
        return _text_result(f'{path} — это папка. Внутри:\n{names}')
    import base64
    size = data.get('size') or 0
    if size > MAX_FILE_BYTES:
        return _text_result(
            f'{path} весит {size} байт — слишком много для одного ответа. '
            f'Найдите нужное место через search_code.', True)
    content = base64.b64decode(data.get('content') or '').decode('utf-8', errors='replace')
    return _text_result(f'# {path} ({size} байт)\n\n{content}')


def tool_search_code(args):
    """Поиск строки по коду проекта."""
    query = (args.get('query') or '').strip()
    if not query:
        return _text_result('Укажите query — что искать в коде', True)
    try:
        data = _gh('/search/code', {'q': f'{query} repo:{REPO}', 'per_page': '50'})
    except urllib.error.HTTPError as e:
        if e.code in (403, 422):
            return _text_result(
                'Поиск по коду сейчас недоступен (ограничение GitHub). '
                'Возьмите список файлов через list_files и читайте нужные через read_file.', True)
        raise
    items = data.get('items') or []
    if not items:
        return _text_result(f'«{query}» в коде проекта не встречается')
    paths = [i['path'] for i in items if _is_interesting(i['path'])]
    return _text_result(
        f'«{query}» найдено в {len(paths)} файлах (всего совпадений {data.get("total_count")}):\n'
        + '\n'.join(paths)
        + '\n\nЧитайте нужный файл через read_file.'
    )


# --------------------------------------------------------------------------
# База данных
# --------------------------------------------------------------------------

def _connect():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _schema():
    return os.environ.get('MAIN_DB_SCHEMA') or 'public'


def _sql_str(value):
    return "'" + str(value).replace("'", "''") + "'"


def tool_db_schema(args):
    """Таблицы и колонки базы."""
    table = (args.get('table') or '').strip()
    conn = _connect()
    try:
        cur = conn.cursor()
        if table:
            if table in FORBIDDEN_TABLES:
                return _text_result(
                    f'Таблица {table} закрыта: в ней личные документы и токены входа сотрудников',
                    True)
            cur.execute(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns "
                f"WHERE table_schema = {_sql_str(_schema())} AND table_name = {_sql_str(table)} "
                "ORDER BY ordinal_position"
            )
            rows = cur.fetchall()
            if not rows:
                return _text_result(f'Таблица {table} не найдена', True)
            lines = [f'Таблица {table} — колонки:']
            for c in rows:
                mark = '' if c[0] not in FORBIDDEN_COLUMNS else '  [скрыта в выдаче данных]'
                null = '' if c[2] == 'NO' else ' NULL'
                default = f' = {c[3]}' if c[3] else ''
                lines.append(f'  {c[0]}: {c[1]}{null}{default}{mark}')
            return _text_result('\n'.join(lines))

        cur.execute(
            "SELECT c.relname, c.reltuples::bigint "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            f"WHERE n.nspname = {_sql_str(_schema())} AND c.relkind = 'r' "
            "ORDER BY c.relname"
        )
        lines = [f'Схема {_schema()} — таблицы (примерное число строк):']
        for t, cnt in cur.fetchall():
            if t in FORBIDDEN_TABLES:
                lines.append(f'  {t} — закрыта')
            else:
                lines.append(f'  {t} — ~{max(int(cnt or 0), 0)}')
        lines.append('\nКолонки конкретной таблицы: db_schema с параметром table.')
        return _text_result('\n'.join(lines))
    finally:
        conn.close()


def tool_db_query(args):
    """SELECT по базе проекта."""
    sql = (args.get('sql') or '').strip().rstrip(';')
    if not sql:
        return _text_result('Укажите sql — запрос SELECT', True)
    low = ' '.join(sql.lower().split())
    if not (low.startswith('select') or low.startswith('with')):
        return _text_result('Разрешён только SELECT: внешний агент читает базу, но не меняет', True)
    for t in FORBIDDEN_TABLES:
        if t in low:
            return _text_result(
                f'Таблица {t} закрыта: в ней личные документы и токены входа сотрудников', True)

    limit = args.get('limit')
    try:
        limit = min(int(limit), MAX_ROWS) if limit else MAX_ROWS
    except (TypeError, ValueError):
        limit = MAX_ROWS

    conn = _connect()
    try:
        # read only на уровне базы: даже если запрет по тексту обойдут хитрой
        # конструкцией, сама Postgres не даст ничего записать.
        conn.set_session(readonly=True)
        cur = conn.cursor()
        cur.execute(f'SET LOCAL search_path TO {_schema()}, public')
        cur.execute(f'SELECT * FROM ({sql}) AS q LIMIT {limit + 1}')
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
    except psycopg2.Error as e:
        return _text_result(f'Запрос не выполнился: {str(e).strip()}', True)
    finally:
        conn.close()

    truncated = len(rows) > limit
    rows = rows[:limit]
    hidden = [c for c in cols if c in FORBIDDEN_COLUMNS]
    out = []
    for r in rows:
        item = {}
        for name, value in zip(cols, r):
            if name in FORBIDDEN_COLUMNS:
                item[name] = '***скрыто***'
            elif hasattr(value, 'isoformat'):
                item[name] = value.isoformat()
            elif isinstance(value, (dict, list, str, int, float, bool)) or value is None:
                item[name] = value
            else:
                item[name] = str(value)
        out.append(item)

    note = f'Строк: {len(out)}'
    if truncated:
        note += f' (обрезано до {limit} — уточните запрос)'
    if hidden:
        note += f'. Скрытые колонки: {", ".join(hidden)}'
    return _text_result(note + '\n' + json.dumps(out, ensure_ascii=False, indent=2))


def tool_audit_log(args):
    """Журнал действий: кто и что делал в системе."""
    limit = args.get('limit')
    try:
        limit = min(int(limit), MAX_ROWS) if limit else 50
    except (TypeError, ValueError):
        limit = 50
    where = []
    if (args.get('category') or '').strip():
        where.append(f'category = {_sql_str(args["category"].strip())}')
    if (args.get('action') or '').strip():
        where.append(f'action = {_sql_str(args["action"].strip())}')
    if (args.get('entityType') or '').strip():
        where.append(f'entity_type = {_sql_str(args["entityType"].strip())}')
    clause = (' WHERE ' + ' AND '.join(where)) if where else ''

    conn = _connect()
    try:
        conn.set_session(readonly=True)
        cur = conn.cursor()
        cur.execute(f'SET LOCAL search_path TO {_schema()}, public')
        cur.execute(
            'SELECT created_at, user_name, category, action, entity_type, entity_id, description '
            f'FROM audit_log{clause} ORDER BY created_at DESC LIMIT {limit}'
        )
        rows = cur.fetchall()
    except psycopg2.Error as e:
        return _text_result(f'Журнал не прочитался: {str(e).strip()}', True)
    finally:
        conn.close()

    lines = [f'Записей: {len(rows)}']
    for r in rows:
        when = r[0].isoformat() if r[0] else '—'
        lines.append(
            f'{when} | {r[1] or "—"} | {r[2] or "—"}/{r[3] or "—"} | '
            f'{r[4] or "—"}#{r[5] if r[5] is not None else "—"} | {r[6] or ""}'
        )
    return _text_result('\n'.join(lines))


def tool_app_errors(args):
    """Сбои приложения: что падает у сотрудников и в облачных функциях."""
    limit = args.get('limit')
    try:
        limit = min(int(limit), MAX_ROWS) if limit else 30
    except (TypeError, ValueError):
        limit = 30

    conn = _connect()
    try:
        conn.set_session(readonly=True)
        cur = conn.cursor()
        cur.execute(f'SET LOCAL search_path TO {_schema()}, public')

        # Сводка нужна, чтобы отличить массовую поломку от единичной случайности:
        # одна и та же ошибка у восьми человек и у одного — это разные задачи.
        if args.get('summary'):
            cur.execute(
                'SELECT message, count(*), count(DISTINCT user_id), max(occurred_at) '
                "FROM app_errors WHERE occurred_at > now() - interval '7 days' "
                f'GROUP BY message ORDER BY count(*) DESC LIMIT {limit}'
            )
            rows = cur.fetchall()
            if not rows:
                return _text_result('За последнюю неделю сбоев не зафиксировано')
            lines = ['Повторяющиеся сбои за 7 дней (раз | сотрудников | последний раз | текст):']
            for r in rows:
                when = r[3].isoformat() if r[3] else '—'
                lines.append(f'{r[1]} | {r[2] or 0} | {when} | {r[0]}')
            return _text_result('\n'.join(lines))

        where = []
        if (args.get('source') or '').strip():
            where.append(f'source = {_sql_str(args["source"].strip())}')
        if (args.get('search') or '').strip():
            where.append(f'message ILIKE {_sql_str("%" + args["search"].strip() + "%")}')
        clause = (' WHERE ' + ' AND '.join(where)) if where else ''

        cur.execute(
            'SELECT occurred_at, source, level, message, page, user_name, user_role, '
            '  app_version, stack '
            f'FROM app_errors{clause} ORDER BY occurred_at DESC LIMIT {limit}'
        )
        rows = cur.fetchall()
    except psycopg2.Error as e:
        return _text_result(f'Журнал сбоев не прочитался: {str(e).strip()}', True)
    finally:
        conn.close()

    if not rows:
        return _text_result('Сбоев по этому условию нет')

    blocks = [f'Сбоев: {len(rows)}']
    for r in rows:
        when = r[0].isoformat() if r[0] else '—'
        head = f'\n--- {when} | {r[1]}/{r[2]} | стр. {r[4] or "—"} | {r[5] or "—"} ({r[6] or "—"})'
        if r[7]:
            head += f' | версия {r[7]}'
        blocks.append(head + f'\n{r[3]}')
        if r[8]:
            # Стек обрезаем: первые строки указывают на наш код, дальше идут
            # внутренности библиотек, в которых искать нечего.
            blocks.append('\n'.join(str(r[8]).splitlines()[:12]))
    return _text_result('\n'.join(blocks))


TOOLS = [
    {
        'name': 'list_files',
        'description': 'Список файлов проекта с размерами. Начните с него, чтобы понять '
                       'структуру. Можно ограничить папкой: path="src/components".',
        'inputSchema': {
            'type': 'object',
            'properties': {'path': {'type': 'string', 'description': 'Папка, необязательно'}},
        },
        'handler': tool_list_files,
    },
    {
        'name': 'read_file',
        'description': 'Прочитать файл проекта целиком по пути, например src/App.tsx '
                       'или backend/orders/index.py.',
        'inputSchema': {
            'type': 'object',
            'properties': {'path': {'type': 'string', 'description': 'Путь к файлу'}},
            'required': ['path'],
        },
        'handler': tool_read_file,
    },
    {
        'name': 'search_code',
        'description': 'Найти, в каких файлах встречается строка: имя функции, текст '
                       'на экране, название таблицы.',
        'inputSchema': {
            'type': 'object',
            'properties': {'query': {'type': 'string', 'description': 'Что искать'}},
            'required': ['query'],
        },
        'handler': tool_search_code,
    },
    {
        'name': 'db_schema',
        'description': 'Структура базы: без параметров — все таблицы, с table="orders" — '
                       'колонки этой таблицы.',
        'inputSchema': {
            'type': 'object',
            'properties': {'table': {'type': 'string', 'description': 'Имя таблицы'}},
        },
        'handler': tool_db_schema,
    },
    {
        'name': 'db_query',
        'description': 'Выполнить SELECT по базе проекта и получить строки. Только чтение. '
                       'Персональные данные сотрудников в выдаче скрыты.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'sql': {'type': 'string', 'description': 'Запрос SELECT'},
                'limit': {'type': 'integer', 'description': f'Сколько строк, максимум {MAX_ROWS}'},
            },
            'required': ['sql'],
        },
        'handler': tool_db_query,
    },
    {
        'name': 'audit_log',
        'description': 'Журнал действий в системе: кто, когда и что сделал. Помогает '
                       'разобраться в реальном сценарии работы и в ошибках.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'category': {'type': 'string', 'description': 'Раздел, например warehouse'},
                'action': {'type': 'string', 'description': 'Действие, например stocktake_approve'},
                'entityType': {'type': 'string', 'description': 'Тип объекта, например order'},
                'limit': {'type': 'integer', 'description': f'Сколько записей, максимум {MAX_ROWS}'},
            },
        },
        'handler': tool_audit_log,
    },
    {
        'name': 'app_errors',
        'description': 'Сбои приложения: что упало у сотрудников в браузере и в облачных '
                       'функциях, с текстом ошибки, страницей и версией. С summary=true — '
                       'сводка за неделю: какие ошибки массовые, а какие единичные. '
                       'Начинайте разбор любой жалобы «не работает» отсюда.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'summary': {'type': 'boolean', 'description': 'Сводка повторяющихся ошибок'},
                'source': {'type': 'string', 'description': 'frontend или backend'},
                'search': {'type': 'string', 'description': 'Искать по тексту ошибки'},
                'limit': {'type': 'integer', 'description': f'Сколько записей, максимум {MAX_ROWS}'},
            },
        },
        'handler': tool_app_errors,
    },
]

TOOLS_BY_NAME = {t['name']: t for t in TOOLS}


def handler(event: dict, context) -> dict:
    """MCP-сервер проекта для внешних ИИ-агентов (Cursor и подобных).

    Говорит по JSON-RPC 2.0, как того требует Model Context Protocol. Даёт
    ТОЛЬКО чтение: код проекта из GitHub, структуру и данные базы, журнал
    действий. Секреты, личные документы и токены входа наружу не отдаются.

    Доступ по паролю MCP_AGENT_TOKEN в заголовке Authorization: Bearer <...>.

    Инструменты: list_files, read_file, search_code, db_schema, db_query,
    audit_log, app_errors.
    """
    method = event.get('httpMethod', 'POST')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    if not _check_token(event):
        return _resp(401, {
            'jsonrpc': '2.0',
            'id': None,
            'error': {'code': -32001, 'message': 'Нужен пароль агента в заголовке Authorization'},
        })

    # Проверка живости и SSE-ручка: агент иногда дёргает GET, прежде чем начать.
    if method == 'GET':
        return _resp(200, {'status': 'ok', 'protocolVersion': PROTOCOL_VERSION,
                           'tools': [t['name'] for t in TOOLS]})

    try:
        rpc = json.loads(event.get('body') or '{}')
    except json.JSONDecodeError:
        return _rpc_err(None, -32700, 'Тело запроса не разобралось как JSON')

    # Пачка запросов одним телом — допустимо по спецификации.
    if isinstance(rpc, list):
        results = []
        for one in rpc:
            r = _handle_rpc(one)
            if r is not None:
                results.append(r)
        return _resp(200, results)

    result = _handle_rpc(rpc)
    if result is None:
        # Уведомление: ответ не предусмотрен, но соединение закрываем чисто.
        return {'statusCode': 202, 'headers': HEADERS, 'body': ''}
    return _resp(200, result)


def _handle_rpc(rpc):
    """Одна операция MCP. None — уведомление, отвечать нечем."""
    req_id = rpc.get('id')
    method = rpc.get('method') or ''
    params = rpc.get('params') or {}

    if method.startswith('notifications/'):
        return None

    if method == 'initialize':
        return {
            'jsonrpc': '2.0', 'id': req_id,
            'result': {
                'protocolVersion': PROTOCOL_VERSION,
                'capabilities': {'tools': {'listChanged': False}},
                'serverInfo': {'name': 'proektnaya-razrabotka', 'version': '1.0.0'},
                'instructions': (
                    'Производственная система: заказы, раскрой, пошив, склад товара, '
                    'маркетплейсы, зарплаты. Код на React+TypeScript во фронтенде и '
                    'облачные функции на Python в backend. Доступ только на чтение: '
                    'правки вносите через git, напрямую менять проект нельзя.'
                ),
            },
        }

    if method == 'ping':
        return {'jsonrpc': '2.0', 'id': req_id, 'result': {}}

    if method == 'tools/list':
        return {
            'jsonrpc': '2.0', 'id': req_id,
            'result': {'tools': [
                {'name': t['name'], 'description': t['description'],
                 'inputSchema': t['inputSchema']}
                for t in TOOLS
            ]},
        }

    if method in ('resources/list', 'prompts/list'):
        key = method.split('/')[0]
        return {'jsonrpc': '2.0', 'id': req_id, 'result': {key: []}}

    if method == 'tools/call':
        name = params.get('name')
        tool = TOOLS_BY_NAME.get(name)
        if not tool:
            return {'jsonrpc': '2.0', 'id': req_id,
                    'error': {'code': -32602, 'message': f'Инструмента {name} нет'}}
        args = params.get('arguments') or {}
        try:
            return {'jsonrpc': '2.0', 'id': req_id, 'result': tool['handler'](args)}
        except KeyError as e:
            # Не хватает секрета — говорим прямо, иначе агент решит, что сломан код.
            return {'jsonrpc': '2.0', 'id': req_id,
                    'result': _text_result(f'В проекте не задан секрет {e}', True)}
        except urllib.error.HTTPError as e:
            return {'jsonrpc': '2.0', 'id': req_id,
                    'result': _text_result(f'GitHub ответил ошибкой {e.code}: {e.reason}', True)}
        except Exception as e:
            return {'jsonrpc': '2.0', 'id': req_id,
                    'result': _text_result(f'{type(e).__name__}: {e}', True)}

    return {'jsonrpc': '2.0', 'id': req_id, 'error': {'code': -32601, 'message': f'Метод {method} не поддерживается'}}