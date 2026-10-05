"""МЕГАБУХ — бухгалтерский консультант. Производственную базу не читает.

Сейчас в системе один агент: МЕГАБУХ (бухгалтер). Он ищет законы,
кадровый учёт, 1С, СБИС, Контур.Диадок, банк Точка и правила маркетплейсов
в открытых источниках. Заказы, раскрой, склад и зарплаты цеха ему закрыты.

Производственный помощник администратора (SELECT к нашей базе) выключен.

ГЛАВНОЕ ПРАВИЛО — ТОЛЬКО ЧТЕНИЕ.
Агент ничего не меняет в системе и не отправляет отчёты в ФНС.
Код безопасного SELECT оставлен на будущее: подключение READ ONLY, в запросе
только SELECT, запрещены INSERT/UPDATE/DELETE/DROP.

Приватная память дела (только агент, в кабинете файла нет):
backend/ai_assistant/business_memory.jsonl — факты и практики Мегатюли.
Живая частота вопросов приходит с клиента в поле practice.
"""

import json
import os
import socket
import threading
import time
import re
import html as html_lib
import base64
import io
import zipfile
import zlib
import xml.etree.ElementTree as ET
import urllib.error
import urllib.parse
import urllib.request

import psycopg2

# В облаке IPv6 до внешних сайтов висит до таймаута, а один из двух IPv4 адресов
# AITUNNEL из облака Поехали не отвечает вовсе: urllib висел на нём ~25 с.
# Поэтому: только IPv4, а для AITUNNEL — один самый быстрый живой адрес.
_orig_getaddrinfo = socket.getaddrinfo
_AITUNNEL_HOSTS = ('api.aitunnel.ru', 'ru-api.aitunnel.ru')
_LIVE_IPS = {}
_BAD_IPS = {}


def _probe_ips(host, infos):
    from concurrent.futures import ThreadPoolExecutor
    ips = list(dict.fromkeys(i[4][0] for i in infos))

    def lat(ip):
        t = time.monotonic()
        try:
            socket.create_connection((ip, 443), timeout=1.5).close()
            return ip, time.monotonic() - t
        except Exception:
            return ip, None
    with ThreadPoolExecutor(max_workers=max(1, len(ips))) as ex:
        res = list(ex.map(lat, ips))
    alive = [ip for ip, t in sorted((r for r in res if r[1] is not None), key=lambda r: r[1])]
    print(f'[aitunnel] {host}: живые IP {alive} из {ips}', flush=True)
    return alive


def mark_bad_ip(host):
    """Запрос завис — исключаем адрес, через который шли, на 10 минут."""
    cached = _LIVE_IPS.get(host)
    if cached and cached[1]:
        ip = cached[1][0]
        _BAD_IPS[ip] = time.monotonic()
        _LIVE_IPS[host] = (cached[0], [x for x in cached[1] if x != ip])
        print(f'[aitunnel] {host}: IP {ip} завис — исключаю', flush=True)


def _ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    res = _orig_getaddrinfo(host, port, family, type, proto, flags)
    v4 = [r for r in res if r[0] == socket.AF_INET] or res
    if host not in _AITUNNEL_HOSTS:
        return v4
    cached = _LIVE_IPS.get(host)
    if not cached or time.monotonic() - cached[0] > 600 or not cached[1]:
        now = time.monotonic()
        alive = [ip for ip in _probe_ips(host, v4) if now - _BAD_IPS.get(ip, -1e9) > 600]
        _LIVE_IPS[host] = (now, alive)
        cached = _LIVE_IPS[host]
    if not cached[1]:
        return v4
    best = cached[1][0]
    return [i for i in v4 if i[4][0] == best] or v4


socket.getaddrinfo = _ipv4_getaddrinfo

# Основной API и зеркало: у части провайдеров блокируют api.aitunnel.ru —
# тогда тот же ключ и пути работают на ru-api.
AITUNNEL_BASES = (
    'https://api.aitunnel.ru/v1',
    'https://ru-api.aitunnel.ru/v1',
)

# Если ключ без белого списка — auto подберёт модель из каталога AITUNNEL.
# Список ниже: запас, когда auto или заказанная модель ключу недоступны.
# Ключ API_KEY_MEGABUX в кабинете AITUNNEL разрешает только модель MEGABUX.
MEGABUX_MODEL = 'MEGABUX'

MODEL_CANDIDATES = [
    MEGABUX_MODEL,
    'auto',
    'openai/gpt-6-luna-pro',
    'gpt-6-luna-pro',
    'gpt-6.1-sol-pro',
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
# Бухгалтеру нужно больше: поиск → открыть страницу ФНС → ещё один поиск.
MAX_STEPS_ACCOUNTANT = 8
# Суточная сводка маркетплейсов: по одному заходу на OZON, WB и Яндекс Маркет.
MAX_STEPS_DIGEST = 5

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
    'cost_settings', 'cost_extra_expenses', 'manager_commission_settings',
)

# Список таблиц для администратора — бухгалтеру (МЕГАБУХ) схема не отдаётся.

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


def _schema_digest(cur, schema, tables):
    """Список таблиц с колонками — чтобы модель знала, где что лежит.

    Без этого она выдумывает названия таблиц и запросы падают.
    """
    cur.execute(
        "SELECT table_name, column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = ANY(%s) "
        "ORDER BY table_name, ordinal_position",
        (schema, list(tables)),
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


def _sql_uses_only_tables(sql: str, schema: str, allowed) -> tuple:
    """Бухгалтеру нельзя читать чужие таблицы даже SELECT-ом."""
    allowed_set = {t.lower() for t in allowed}
    prefixed = set(re.findall(rf'\b{re.escape(schema)}\.([a-zA-Z_][\w]*)', sql, re.I))
    from_join = set(
        m.group(1)
        for m in re.finditer(
            r'(?:from|join)\s+(?:"?[a-zA-Z_][\w]*"?\.)?"?([a-zA-Z_][\w]*)"?',
            sql,
            re.I,
        )
    )
    found = {t.lower() for t in (prefixed | from_join)}
    extra = found - allowed_set
    if extra:
        return False, 'Этот запрос выходит за раздел себестоимости'
    return True, ''


def _assistant_scope(cur, schema, user_id, requested_role: str):
    """Кто может спрашивать МЕГАБУХа: бухгалтер и админ (раздел «Агенты»).

    Производственный помощник администратора выключен — к базе заказов и зарплат
    агент не подключается. Менеджеру чат закрыт.
    """
    cur.execute(
        f"SELECT role, is_active, full_name FROM {schema}.users WHERE id = %s",
        (int(user_id),),
    )
    row = cur.fetchone()
    if not row or not row[1]:
        return None, ''
    card_role = row[0] or ''
    full_name = (row[2] or '').strip()
    cur.execute(
        f"SELECT role FROM {schema}.user_roles "
        f"WHERE user_id = %s AND is_approved = true",
        (int(user_id),),
    )
    roles = {r[0] for r in cur.fetchall()}
    if card_role:
        roles.add(card_role)
    # Админ из «Агенты» — полный доступ к МЕГАБУХу (любая requested_role).
    if 'admin' in roles:
        return 'accountant', full_name
    want = (requested_role or '').strip()
    if want in ('', 'accountant') and 'accountant' in roles:
        return 'accountant', full_name
    return None, ''


def _given_name(full_name: str) -> str:
    """Имя для обращения: из «Иванов Иван Иванович» берём Иван, из «Андрей» — Андрей."""
    parts = [p for p in re.split(r'\s+', (full_name or '').strip()) if p]
    if not parts:
        return ''
    if len(parts) >= 3:
        return parts[1]
    if len(parts) == 2:
        if re.search(
            r'(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкая)$',
            parts[0],
            re.I,
        ):
            return parts[1]
        return parts[0]
    return parts[0]


def _chat_display_name(full_name: str) -> str:
    """Имя и фамилия для подписи собеседника."""
    parts = [p for p in re.split(r'\s+', (full_name or '').strip()) if p]
    if not parts:
        return ''
    if len(parts) >= 3:
        return f'{parts[1]} {parts[0]}'
    if len(parts) == 2:
        if re.search(
            r'(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкая)$',
            parts[0],
            re.I,
        ):
            return f'{parts[1]} {parts[0]}'
        return f'{parts[0]} {parts[1]}'
    return parts[0]


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


def _run_select(dsn, schema, sql, allowed_tables=None):
    """Выполняет SELECT в режиме только для чтения и возвращает строки текстом."""
    ok, reason = _is_safe_select(sql)
    if not ok:
        return f'ОТКАЗАНО: {reason}'
    if allowed_tables is not None:
        ok, reason = _sql_uses_only_tables(sql, schema, allowed_tables)
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


# Сколько секунд держим в запасе под финальный ответ модели.
ANSWER_RESERVE = 11
# Сколько текста одного источника держим в пошаговом режиме: состояние ездит
# браузер ↔ функция и не должно раздуваться (и модель на коротком контексте быстрее).
CONT_TOOL_CHARS = 5000
# Сколько кругов поиска разрешаем, прежде чем просить итоговый ответ.
CONT_MAX_TOOL_STEPS = 3
# Поток для итогового ответа: у пресета MEGABUX через AITUNNEL первый токен не приходит
# (проверено) — выключено, итог берём обычным вызовом с повтором в следующем заходе.
STREAM_FINAL = False


_RESERVE_NOW = [None]


def _tool_timeout(want=7):
    """Таймаут для поиска/чтения страниц: не съедаем время финального ответа."""
    reserve = ANSWER_RESERVE if _RESERVE_NOW[0] is None else _RESERVE_NOW[0]
    left = _time_left() - reserve
    return max(0.0, min(float(want), left))


def _http_get(url, timeout=7):
    """Простой GET: облачная функция без лишних библиотек."""
    timeout = _tool_timeout(timeout)
    if timeout < 3:
        raise TimeoutError('нет времени на запрос')
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; MegatulAccountant/1.0)',
            'Accept': 'text/plain, text/html;q=0.9, */*;q=0.8',
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()[:80000].decode('utf-8', 'ignore')


def _strip_tags(text: str) -> str:
    text = re.sub(r'(?is)<script.*?>.*?</script>', ' ', text)
    text = re.sub(r'(?is)<style.*?>.*?</style>', ' ', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html_lib.unescape(text)
    return re.sub(r'\s+', ' ', text).strip()


def _web_search(query: str) -> str:
    """Ищет в открытом интернете: законы, сроки, инструкции 1С.

    Сначала читалка Jina (удобный текст), если молчит — HTML DuckDuckGo.
    """
    q = (query or '').strip()[:180]
    if not q:
        return 'Пустой поисковый запрос'
    if _tool_timeout() < 3:
        return 'Время на поиск закончилось — отвечай по уже найденному и своим знаниям.'
    try:
        text = _http_get('https://s.jina.ai/' + urllib.parse.quote(q)).strip()
        if len(text) > 80:
            return text[:12000]
    except Exception:
        pass
    try:
        body = urllib.parse.urlencode({'q': q, 'kl': 'ru-ru'}).encode('utf-8')
        req = urllib.request.Request(
            'https://html.duckduckgo.com/html/',
            data=body,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; MegatulAccountant/1.0)',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        )
        ddg_timeout = _tool_timeout(6)
        if ddg_timeout < 3:
            return 'Время на поиск закончилось — отвечай по уже найденному и своим знаниям.'
        with urllib.request.urlopen(req, timeout=ddg_timeout) as r:
            page = r.read()[:80000].decode('utf-8', 'ignore')
        items = []
        titles = re.findall(r'class="result__a"[^>]*>(.*?)</a>', page, re.S | re.I)
        snippets = re.findall(
            r'class="result__snippet"[^>]*>(.*?)</(?:a|td|span)', page, re.S | re.I,
        )
        hrefs = re.findall(r'class="result__a"[^>]*href="([^"]+)"', page, re.I)
        for i, title in enumerate(titles[:8]):
            snip = snippets[i] if i < len(snippets) else ''
            href = hrefs[i] if i < len(hrefs) else ''
            items.append(
                f'{_strip_tags(title)}\n{_strip_tags(snip)}\n{href}'.strip()
            )
        if items:
            return '\n\n'.join(items)[:12000]
        return 'Поиск ничего не вернул. Сформулируйте запрос иначе.'
    except Exception as e:
        return f'Поиск сейчас недоступен: {e}'


def _read_page(url: str) -> str:
    """Читает страницу официального источника (налоги, 1С, право)."""
    url = (url or '').strip()
    if not (url.startswith('https://') or url.startswith('http://')):
        return 'Разрешены только ссылки http и https'
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or '').lower()
    # DuckDuckGo отдаёт переходник; открываем исходную страницу.
    qs = urllib.parse.parse_qs(parsed.query)
    if 'duckduckgo.com' in host and qs.get('uddg'):
        url = qs['uddg'][0]
        parsed = urllib.parse.urlparse(url)
        host = (parsed.hostname or '').lower()
    if not host or host in ('localhost', '127.0.0.1') or host.endswith('.local'):
        return 'Эта ссылка недоступна'
    if re.match(r'^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)', host):
        return 'Эта ссылка недоступна'
    if _tool_timeout() < 3:
        return 'Время на чтение страниц закончилось — отвечай по уже найденному.'
    try:
        text = _http_get('https://r.jina.ai/' + url).strip()
        if len(text) < 40:
            return 'Страница открылась пустой'
        return text[:12000]
    except Exception as e:
        return f'Не удалось открыть страницу: {e}'


# Справка 1С:Фреш (1cfresh.com/articles/faq*): выгружена в fresh_faq.json,
# ищем по словам вопроса без похода в интернет.
FRESH_FAQ_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fresh_faq.json')
_FRESH_FAQ = None


def _fresh_faq():
    global _FRESH_FAQ
    if _FRESH_FAQ is None:
        try:
            with open(FRESH_FAQ_PATH, encoding='utf-8') as f:
                _FRESH_FAQ = json.load(f)
        except (OSError, json.JSONDecodeError):
            _FRESH_FAQ = []
    return _FRESH_FAQ


def _fresh_words(text: str) -> list:
    words = re.findall(r'[a-zа-яё0-9]+', (text or '').lower().replace('ё', 'е'))
    stop = {'как', 'что', 'где', 'для', 'это', 'мне', 'мой', 'мои', 'при', 'или', 'мы',
            'мою', 'нам', 'мне', 'мной', 'мная', 'можно', 'нужно', 'делать', 'мес', 'фреш',
            '1с', 'fresh', '1cfresh', 'в', 'на', 'и', 'с', 'по', 'не', 'из', 'к', 'о', 'у'}
    # Грубая основа слова: первые 5 букв — «приложения» ≈ «приложение».
    return [w[:5] if len(w) > 5 else w for w in words if w not in stop and len(w) > 1]


def _fresh_help(query: str) -> str:
    """Ищет ответ в официальном FAQ 1С:Фреш."""
    items = _fresh_faq()
    if not items:
        return 'Справка 1С:Фреш недоступна — открой https://1cfresh.com/articles/faq через read_page.'
    qw = set(_fresh_words(query))
    if not qw:
        return 'Пустой запрос'
    scored = []
    for it in items:
        qs = set(_fresh_words(it.get('q', '')))
        body = set(_fresh_words(it.get('a', '')))
        score = 3 * len(qw & qs) + len(qw & body)
        if score:
            scored.append((score, it))
    scored.sort(key=lambda x: -x[0])
    top = [it for _, it in scored[:4]]
    if not top:
        return ('В FAQ 1С:Фреш точного ответа нет. Посмотри алфавитный перечень '
                'https://1cfresh.com/articles/faq_all (read_page) или '
                'web_search «site:1cfresh.com ...».')
    parts = []
    for it in top:
        parts.append(
            f"[{it.get('s')}] {it.get('q')}\n{it.get('a')}\nИсточник: {it.get('url')}"
        )
    return ('СПРАВКА 1С:ФРЕШ (официальная, 1cfresh.com; платформа 8.5):\n\n'
            + '\n\n---\n\n'.join(parts))[:12000]


MAX_ATTACH = 3
MAX_ATTACH_BYTES = 20 * 1024 * 1024
MAX_DOC_CHARS = 40000
DOC_EXT_OK = {
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf',
    'jpg', 'jpeg', 'png', 'webp', 'gif',
}
IMAGE_MIME_BY_EXT = {
    'png': 'image/png',
    'webp': 'image/webp',
    'gif': 'image/gif',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
}

# Приватный корпус на git: читает только эта функция, в CRM не отдаём.
MEMORY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'business_memory.jsonl')
MAX_MEMORY_CHARS = 8000


def _parse_memory_lines(lines) -> str:
    facts = []
    for ln in lines[-120:]:
        try:
            row = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        kind = (row.get('kind') or 'note').strip()
        topic = (row.get('topic') or '').strip()
        text = (row.get('text') or '').strip()
        if not text:
            continue
        facts.append(f'- [{kind}] {topic}: {text}' if topic else f'- [{kind}] {text}')
    return '\n'.join(facts)[:MAX_MEMORY_CHARS]


def _load_business_memory() -> str:
    """Строки из business_memory.jsonl — закреплённые факты и практики дела."""
    try:
        with open(MEMORY_PATH, encoding='utf-8') as f:
            blob = _parse_memory_lines([ln.strip() for ln in f if ln.strip()])
            if blob:
                return blob
    except OSError:
        pass
    return ''


def _format_practice_digest(raw) -> str:
    """Короткий срез частоты вопросов с рабочего места (не сырой журнал)."""
    if not isinstance(raw, dict):
        return ''
    try:
        total = int(raw.get('total') or 0)
    except (TypeError, ValueError):
        total = 0
    top = raw.get('top') or []
    recent = raw.get('recent') or []
    lines = []
    if total:
        lines.append(f'Всего зафиксированных вопросов на этом рабочем месте: {total}.')
    if isinstance(top, list) and top:
        lines.append('Чаще всего спрашивали:')
        for item in top[:12]:
            if not isinstance(item, dict):
                continue
            q = (item.get('q') or '').strip()[:160]
            try:
                n = int(item.get('n') or 0)
            except (TypeError, ValueError):
                n = 0
            if q:
                lines.append(f'- ({n}) {q}')
    if isinstance(recent, list) and recent:
        rec = [str(x).strip()[:160] for x in recent[:8] if str(x).strip()]
        if rec:
            lines.append('Недавно: ' + '; '.join(rec))
    return '\n'.join(lines)


def _xml_local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _decode_upload(raw: str) -> bytes:
    s = (raw or '').strip()
    if ',' in s and s.lower().startswith('data:'):
        s = s.split(',', 1)[1]
    s = re.sub(r'\s+', '', s)
    return base64.b64decode(s)


def _docx_text(data: bytes) -> str:
    z = zipfile.ZipFile(io.BytesIO(data))
    xml = z.read('word/document.xml')
    root = ET.fromstring(xml)
    paras = []
    for p in root.iter():
        if _xml_local(p.tag) != 'p':
            continue
        bits = [t.text or '' for t in p.iter() if _xml_local(t.tag) == 't']
        line = ''.join(bits).strip()
        if line:
            paras.append(line)
    return '\n'.join(paras)


def _xlsx_text(data: bytes) -> str:
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.iter():
            if _xml_local(si.tag) != 'si':
                continue
            shared.append(''.join(t.text or '' for t in si.iter() if _xml_local(t.tag) == 't'))
    sheets = [n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
    rows_out = []
    for name in sheets[:6]:
        root = ET.fromstring(z.read(name))
        rows_out.append(f'Лист {name.split("/")[-1]}:')
        for row in root.iter():
            if _xml_local(row.tag) != 'row':
                continue
            cells = []
            for c in row:
                if _xml_local(c.tag) != 'c':
                    continue
                t = c.attrib.get('t', '')
                v = ''
                for child in c:
                    if _xml_local(child.tag) == 'v':
                        v = child.text or ''
                if t == 's' and v.isdigit() and int(v) < len(shared):
                    cells.append(shared[int(v)])
                elif v:
                    cells.append(v)
            if cells:
                rows_out.append(' | '.join(cells))
        if len('\n'.join(rows_out)) > MAX_DOC_CHARS:
            break
    return '\n'.join(rows_out)


def _pdf_inflate(buf: bytes) -> bytes:
    for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
        try:
            return zlib.decompress(buf, wbits)
        except Exception:
            pass
    return buf


def _pdf_unescape(s: str) -> str:
    s = s.replace('\\n', '\n').replace('\\r', '\n').replace('\\t', ' ')
    s = s.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
    s = re.sub(r'\\([0-7]{1,3})', lambda m: chr(int(m.group(1), 8) % 256), s)
    return s


def _pdf_text(data: bytes) -> str:
    chunks = [data]
    for m in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', data, re.S):
        chunks.append(_pdf_inflate(m.group(1)))
    texts = []
    for chunk in chunks:
        raw = chunk.decode('latin-1', 'ignore')
        for m in re.finditer(r'\((?:\\.|[^\\)]){2,}\)\s*Tj', raw):
            inner = m.group(0)[1:m.group(0).rfind(')')]
            t = _pdf_unescape(inner).strip()
            if t:
                texts.append(t)
        for m in re.finditer(r'\[(.*?)\]\s*TJ', raw, re.S):
            parts = re.findall(r'\((?:\\.|[^\\)])*\)', m.group(1))
            line = ''.join(_pdf_unescape(p[1:-1]) for p in parts).strip()
            if line:
                texts.append(line)
    joined = re.sub(r'\s+', ' ', ' '.join(texts)).strip()
    if len(joined) < 40:
        # Иногда текст лежит просто строками в файле.
        extra = re.findall(r'[\x20-\x7eА-яЁё]{6,}', data.decode('latin-1', 'ignore'))
        joined = ' '.join(extra[:200])
    return joined[:MAX_DOC_CHARS]


def _pdf_jpegs(data: bytes) -> list:
    found = []
    i = 0
    while len(found) < 3:
        start = data.find(b'\xff\xd8\xff', i)
        if start < 0:
            break
        end = data.find(b'\xff\xd9', start + 3)
        if end < 0:
            break
        chunk = data[start:end + 2]
        if 8000 < len(chunk) < 2_400_000:
            found.append(chunk)
        i = start + 3
    return found


def _plain_text(data: bytes) -> str:
    for enc in ('utf-8-sig', 'utf-8', 'cp1251', 'latin-1'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', 'ignore')


def _read_attachments(files) -> tuple:
    """Достаёт текст и картинки из вложений. Без сторонних библиотек."""
    texts = []
    images = []
    if not isinstance(files, list):
        return '', images
    for item in files[:MAX_ATTACH]:
        if not isinstance(item, dict):
            continue
        name = str(item.get('name') or 'файл')[:180]
        mime = str(item.get('mime') or '').lower()
        ext = (name.rsplit('.', 1)[-1] if '.' in name else '').lower()
        # Текст уже извлечён на устройстве (тяжёлые отчёты до 20 МБ).
        pre = item.get('textExcerpt') or item.get('text')
        if isinstance(pre, str) and pre.strip():
            texts.append(f'--- {name} ---\n{pre.strip()[:MAX_DOC_CHARS]}')
            continue
        if ext not in DOC_EXT_OK:
            texts.append(f'--- {name} ---\nЭтот тип файла не читаю.')
            continue
        try:
            raw = _decode_upload(item.get('data') or '')
        except Exception:
            texts.append(f'--- {name} ---\nНе удалось прочитать файл.')
            continue
        if not raw:
            texts.append(f'--- {name} ---\nФайл пустой.')
            continue
        if len(raw) > MAX_ATTACH_BYTES:
            texts.append(f'--- {name} ---\nФайл слишком большой (лимит 20 МБ).')
            continue
        try:
            if ext in ('jpg', 'jpeg', 'png', 'webp', 'gif') or mime.startswith('image/'):
                b64 = base64.b64encode(raw).decode('ascii')
                img_mime = mime if mime.startswith('image/') else IMAGE_MIME_BY_EXT.get(ext, 'image/jpeg')
                images.append({'mime': img_mime, 'b64': b64, 'name': name})
                texts.append(f'--- {name} ---\nИзображение приложено, смотри картинку.')
            elif ext == 'docx':
                texts.append(f'--- {name} ---\n{_docx_text(raw)[:MAX_DOC_CHARS]}')
            elif ext == 'xlsx':
                texts.append(f'--- {name} ---\n{_xlsx_text(raw)[:MAX_DOC_CHARS]}')
            elif ext == 'pdf':
                body = _pdf_text(raw)
                jpegs = _pdf_jpegs(raw) if len(body) < 80 else []
                if body.strip():
                    texts.append(f'--- {name} ---\n{body}')
                for n, jpg in enumerate(jpegs, 1):
                    images.append({
                        'mime': 'image/jpeg',
                        'b64': base64.b64encode(jpg).decode('ascii'),
                        'name': f'{name} стр.{n}',
                    })
                if not body.strip() and not jpegs:
                    texts.append(f'--- {name} ---\nВ PDF не нашлось текста. Это, похоже, скан без распознавания.')
            elif ext in ('txt', 'csv', 'rtf'):
                texts.append(f'--- {name} ---\n{_plain_text(raw)[:MAX_DOC_CHARS]}')
            elif ext in ('doc', 'xls'):
                texts.append(
                    f'--- {name} ---\nСтарый формат . {ext}. Сохраните в .docx / .xlsx или PDF.'
                )
            else:
                texts.append(f'--- {name} ---\nНе умею открыть этот файл.')
        except Exception as e:
            texts.append(f'--- {name} ---\nНе получилось открыть: {e}')
    excerpt = '\n\n'.join(t for t in texts if t).strip()
    return excerpt[:MAX_DOC_CHARS * 2], images[:4]


# Шлюз Поехали рвёт соединение примерно на 35 с без ответа (499/503).
# Укладываемся в ~27 с, чтобы человек всегда получил ответ.
REQUEST_BUDGET = 28
_DEADLINE = [0.0]


def _start_budget():
    _DEADLINE[0] = time.monotonic() + REQUEST_BUDGET


def _time_left():
    if not _DEADLINE[0]:
        return float(REQUEST_BUDGET)
    return _DEADLINE[0] - time.monotonic()


# База, до которой уже достучались (живёт, пока жив тёплый контейнер).
_GOOD_BASE = ['']
_DEAD_BASES = {}
_DEAD_TTL = 300


def _aitunnel_bases():
    """Базы AITUNNEL: сначала основная, при блоке сети — зеркало ru-api."""
    preferred = (os.environ.get('AITUNNEL_BASE_URL', '') or '').strip().rstrip('/')
    bases = []
    if preferred:
        bases.append(preferred)
    for b in AITUNNEL_BASES:
        if b not in bases:
            bases.append(b)
    now = time.monotonic()
    alive = [b for b in bases if now - _DEAD_BASES.get(b, -1e9) > _DEAD_TTL]
    dead = [b for b in bases if b not in alive]
    good = _GOOD_BASE[0]
    if good in alive:
        alive.remove(good)
        alive.insert(0, good)
    return alive + dead


def _base_reachable(base, timeout=4):
    """Быстрая проверка TCP+TLS: блок/зависание видно за секунды, а не за минуту."""
    try:
        host = urllib.parse.urlparse(base).hostname
        import ssl
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host):
                return True
    except Exception:
        return False


def _aitunnel_open(path, api_key, payload=None, timeout=30):
    """GET или POST к AITUNNEL. При сетевом сбое пробует зеркало ru-api.

    HTTP-ответ от сервера (4xx/5xx) — это уже AITUNNEL, зеркало не меняет смысл.
    Переключаемся только когда до сервера не достучались.
    """
    body = None
    method = 'GET'
    if payload is not None:
        method = 'POST'
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        # Без User-Agent Cloudflare перед AITUNNEL отвечает 403 «error code: 1010».
        'User-Agent': 'Mozilla/5.0 (compatible; Megabuh/1.0)',
    }
    last_err = None
    for base in _aitunnel_bases():
        url = base.rstrip('/') + '/' + path.lstrip('/')
        left = _time_left() - 2
        if left < 3:
            last_err = last_err or 'не хватило времени на запрос'
            break
        if base != _GOOD_BASE[0] and not _base_reachable(base, timeout=min(8, left)):
            _DEAD_BASES[base] = time.monotonic()
            last_err = 'нет соединения с ' + (urllib.parse.urlparse(base).hostname or base)
            print(f'[aitunnel] {base} недоступен, пробую зеркало', flush=True)
            continue
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        t_req = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=min(timeout, left)) as r:
                out = json.loads(r.read().decode('utf-8'))
            print(f'[aitunnel] {path} {(payload or {}).get("model", "")} via {urllib.parse.urlparse(base).hostname} {time.monotonic() - t_req:.1f}s', flush=True)
            _GOOD_BASE[0] = base
            _DEAD_BASES.pop(base, None)
            return out, None, 0
        except urllib.error.HTTPError as e:
            _GOOD_BASE[0] = base
            raw = e.read().decode('utf-8', 'ignore')
            model = (payload or {}).get('model', '')
            print(f'[aitunnel] {path} {model} HTTP {e.code} через {time.monotonic() - t_req:.1f}s: {raw[:200]}', flush=True)
            return None, f'Сервис ИИ ответил ошибкой {e.code}: {raw[:300]}', e.code
        except Exception as e:
            last_err = e
            _DEAD_BASES[base] = time.monotonic()
            if _GOOD_BASE[0] == base:
                _GOOD_BASE[0] = ''
            print(f'[aitunnel] {path} {base} сбой сети через {time.monotonic() - t_req:.1f}s: {type(e).__name__}', flush=True)
            continue
    return None, f'Не удалось связаться с сервисом ИИ: {last_err}', 0


TUNNEL_ADMIN_MSG = (
    'Агент не работает обратитесь к Администратору - Нужна проверка Тунеля!'
)


def _public_ai_error(err, code=0):
    """Ошибки бюджета/ключа AITUNNEL — без технических деталей пользователю."""
    text = str(err or '')
    low = text.lower()
    if (
        int(code or 0) in (401, 402, 403)
        or '402' in text
        or 'бюджет' in low
        or 'aitunnel' in low
        or 'не разрешена' in low
        or 'разрешает только' in low
        or 'разрешённые' in low
        or 'разрешенные' in low
        or 'не настроен ключ' in low
        or 'ключ доступа к' in low
        or 'превышен' in low
        or 'payment required' in low
        or 'insufficient' in low
        or 'quota' in low
    ):
        return TUNNEL_ADMIN_MSG
    return text or TUNNEL_ADMIN_MSG


def _stream_final(api_key, model, messages, tools, stop_at):
    """Итоговый ответ потоком: копим текст до stop_at. Возвращает (text, done, err)."""
    payload = {
        'model': model, 'messages': messages, 'temperature': 0.2,
        'max_tokens': 2000, 'stream': True,
    }
    if tools:
        payload['tools'] = tools
        payload['tool_choice'] = 'none'
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    base = _GOOD_BASE[0] or AITUNNEL_BASES[0]
    req = urllib.request.Request(
        base.rstrip('/') + '/chat/completions', data=body, method='POST',
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json',
                 'Accept': 'text/event-stream',
                 'User-Agent': 'Mozilla/5.0 (compatible; Megabuh/1.0)'},
    )
    parts = []
    done = False
    t0 = time.monotonic()
    try:
        r = urllib.request.urlopen(req, timeout=max(2.0, min(10.0, stop_at - time.monotonic())))
    except urllib.error.HTTPError as e:
        return '', False, f'Сервис ИИ ответил ошибкой {e.code}: {e.read().decode("utf-8", "ignore")[:200]}'
    except Exception as e:
        return '', False, f'нет связи: {type(e).__name__}'
    try:
        with r:
            for raw in r:
                left = stop_at - time.monotonic()
                if left <= 0:
                    break
                try:
                    r.fp.raw._sock.settimeout(max(1.0, min(15.0, left)))
                except Exception:
                    pass
                line = raw.decode('utf-8', 'ignore').strip()
                if not line.startswith('data:'):
                    continue
                chunk = line[5:].strip()
                if chunk == '[DONE]':
                    done = True
                    break
                try:
                    d = json.loads(chunk)
                except ValueError:
                    continue
                for ch in d.get('choices') or []:
                    piece = (ch.get('delta') or {}).get('content') or ''
                    if piece:
                        parts.append(piece)
                    if ch.get('finish_reason'):
                        done = True
    except Exception as e:
        print(f'[megabuh] stream оборван: {type(e).__name__}', flush=True)
    text = ''.join(parts)
    print(f'[megabuh] stream {time.monotonic() - t0:.1f}s {len(text)} симв. done={done}', flush=True)
    return text, done, None


def _call_model(api_key, model, messages, tools, final=False):
    """Один запрос к сервису ИИ. Возвращает (ответ, ошибка, код ошибки)."""
    payload = {
        'model': model,
        'messages': messages,
        'temperature': 0.2,
        'max_tokens': 2000,
    }
    if tools:
        payload['tools'] = tools
        if final:
            payload['tool_choice'] = 'none'
    return _aitunnel_open('chat/completions', api_key, payload, timeout=75)


_KEY_CACHE = {}
_KEY_TTL = 600
_KEY_LOCK = threading.Lock()


def _key_allowed_models(api_key):
    """Белый список моделей ключа AITUNNEL. None — ограничений нет или ключ не ответил."""
    # Один запрос на контейнер: фоновый прогрев и основной поток не дублируют друг друга.
    with _KEY_LOCK:
        cached = _KEY_CACHE.get(api_key)
        if cached and time.monotonic() - cached[0] < _KEY_TTL:
            return cached[1]
        data, err, _code = _aitunnel_open('aitunnel/key', api_key, None, timeout=6)
        if data is None:
            return None
        result = _parse_allowed(data)
        _KEY_CACHE[api_key] = (time.monotonic(), result)
        return result


def _warm_key(api_key):
    """Список моделей ключа тянем в фоне, пока читаем базу — экономим 8–12 с."""
    if api_key in _KEY_CACHE:
        return None
    t = threading.Thread(target=_key_allowed_models, args=(api_key,), daemon=True)
    t.start()
    return t


def _parse_allowed(data):
    allowed = data.get('allowed_models')
    if not isinstance(allowed, list) or not allowed:
        return None
    out = []
    for item in allowed:
        name = str(item or '').strip()
        if name and name not in out:
            out.append(name)
    return out or None


def _model_aliases(name):
    """В каталоге одно и то же часто лежит как gpt-6-luna-pro и openai/gpt-6-luna-pro."""
    n = (name or '').strip()
    if not n or n == 'auto':
        return [n] if n else []
    out = [n]
    if n.startswith('openai/'):
        out.append(n.split('/', 1)[1])
    elif '/' not in n:
        out.append('openai/' + n)
    seen = []
    for item in out:
        if item and item not in seen:
            seen.append(item)
    return seen


def _add_models(ordered, name):
    for alias in _model_aliases(name):
        if alias not in ordered:
            ordered.append(alias)


def _model_candidates(api_key, state):
    """Ключ с белым списком — зовём только его модели. Иначе auto из каталога."""
    if state.get('candidates'):
        return state['candidates']
    # В секрете бывает «openai\\gpt-...» — обратную косую считаем прямой.
    preferred = os.environ.get('AITUNNEL_MODEL', '').strip().replace('\\', '/')
    cached = _KEY_CACHE.get(api_key)
    if not cached:
        # Не ждём медленный /aitunnel/key: сначала личная модель MEGABUX.
        ordered = [MEGABUX_MODEL]
        if preferred:
            _add_models(ordered, preferred)
        for name in MODEL_CANDIDATES:
            _add_models(ordered, name)
        state['candidates'] = ordered[:4]
        return state['candidates']
    allowed = _key_allowed_models(api_key)
    state['allowed_models'] = allowed
    ordered = []
    if allowed:
        if preferred:
            pref_set = set(_model_aliases(preferred))
            for name in allowed:
                if pref_set & set(_model_aliases(name)):
                    _add_models(ordered, name)
                    break
        for name in allowed:
            _add_models(ordered, name)
        state['candidates'] = ordered[:8]
        return state['candidates']
    if preferred:
        _add_models(ordered, preferred)
    for name in MODEL_CANDIDATES:
        _add_models(ordered, name)
    state['candidates'] = ordered[:8]
    return state['candidates']


def _ask_model(api_key, messages, tools, model_state, final=False):
    """Отправляет диалог модели и возвращает её ответ.

    Модель подбирается по ключу AITUNNEL: если в кабинете ключ ограничен
    одной моделью — зовём её. Если список пустой — auto, затем запасные.
    """
    if model_state.get('model'):
        return _call_model(api_key, model_state['model'], messages, tools, final)[:2]
    last_err = 'Не удалось подобрать доступную модель'
    for model in _model_candidates(api_key, model_state):
        data, err, code = _call_model(api_key, model, messages, tools, final)
        if data is not None:
            model_state['model'] = model
            return data, None
        last_err = err
        if int(code or 0) in (401, 402):
            return None, _public_ai_error(err, code)
        if code not in (400, 403, 404):
            break
    return None, _public_ai_error(last_err, 403 if model_state.get('allowed_models') else 0)


SYSTEM_PROMPT = """Ты — помощник по системе управления производством штор и тюля «Мегатюль».
Отвечаешь владельцу бизнеса и администраторам.

КАК ГОВОРИТЬ:
- Как живой человек в рабочем чате, на «вы». Не канцелярит и не «конечно, с радостью».
- Если знаешь имя собеседника — обращайся по имени, когда это к месту, не в каждом абзаце.
- Сначала ответ, потом короткое пояснение. Списки — только если цифр или шагов несколько.

КАК ОТВЕЧАТЬ:
- Только по-русски, простым деловым языком, без технических терминов.
- Не показывай SQL-запросы и названия таблиц, если о них прямо не спросили.
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

ACCOUNTANT_SYSTEM_PROMPT = """Ты — МЕГАБУХ, живой бухгалтер-консультант швейного производства «Мегатюль»
(ИП, продажа штор и тюля на OZON, Wildberries, Яндекс Маркете).

Твоя главная роль — сидеть «рядом» с бухгалтером у монитора: подсказывать,
куда нажать в программах, какой отчёт подготовить, как проверить и сдать,
какие документы подложить. Ты не робот-справка и не замена главбуху в спорных
случаях — ты коллега, который ведёт задачу до результата.

НАША ОРГАНИЗАЦИЯ (реквизиты, с которыми работаем; номера публичные):
- Наименование: ИП Левкин Андрей Станиславович, бренд «Мегатюль».
- Руководитель / ИП: Левкин Андрей Станиславович.
- ИНН: 760218194200 (12 знаков — ИП).
- ОГРНИП (в разговоре могут сказать «ОГРН» / «ОРГН»): 322774600341432.
- Адрес регистрации: г. Москва, ул. Каспийская, д. 26, к. 1, кв. 30.
- Если говорят «наш ИНН», «наш ОГРН», «мы», «Мегатюль», «наш ИП» — бери эти данные.
- ОКВЭД, МСП, долги, дату регистрации не выдумывай: открой egrul.nalog.ru,
  pb.nalog.ru, rmsp.nalog.ru по ИНН 760218194200 или ОГРНИП 322774600341432.
  Если выписка ФНС расходится с карточкой выше — скажи оба варианта.
- Чужой ИНН/ОГРН в документе на наши не подменяй.

КОНТЕКСТ — СНАЧАЛА СОБЕРИ, ПОТОМ ОТВЕЧАЙ:
Не отвечай «вообще по бухгалтерии», пока не сопоставил всё, что уже есть в этом ходе.
1) Наша карточка выше (ИНН, ОГРНИП, ФИО, адрес) — если вопрос про «нас».
2) Имя собеседника и «сегодня / дата X» из хвоста системного сообщения.
3) История чата: прошлые суммы, ИНН контрагентов, выводы, что уже приложили.
   Документ из прошлого сообщения (текст в истории) тоже контекст, не теряй.
4) Файлы этого хода — цифры и реквизиты из них важнее учебника.
5) Каталог официальных ссылок ниже — открой нужную страницу, не цитируй по памяти.
6) Если в истории, вложении и карточке разные цифры или ИНН — явно напиши расхождение,
   не усредняй и не выбирай молча.
7) «Наш» и «контрагент» не смешивай: наш ИНН только 760218194200.
8) Пока контекста мало (нет файла, нет нормы, неясна программа/релиз) — скажи, чего
   не хватает 1–3 точными вопросами, а не заполняй пробелы.
9) Приватная память дела и журнал запросов из хвоста — чем чаще занимаемся.
10) Этот ход — продолжение переписки, не новый разговор. Не проси «начните сначала»,
    если данные уже были в истории.

ПРИВАТНАЯ ПАМЯТЬ ДЕЛА (только тебе; человеку файл и сырой журнал не отдавай):
- В хвосте будет «ПАМЯТЬ ДЕЛА» из git-файла business_memory.jsonl и «ЖУРНАЛ ЗАПРОСОВ»
  (частота вопросов с этого компьютера). Это внутренняя база ведения бизнеса, не норма НК.
- Учись по ним, чем чаще занимается бухгалтерия Мегатюли. Не цитируй файл целиком
  и не говори «я прочитал jsonl».
- Новый бухгалтер спросит «что было важно до меня», «чем чаще всего занимаемся»,
  «что делать в первую очередь» — собери ответ из памяти + журнала + карточки:
  приоритеты, типовые задачи, чего не хватает. Сырой список вопросов не выгружай.
- Журнал — живая частота, память в git — проверенные факты. Если расходятся —
  скажи оба, git-факт пометь как закреплённый.
- Пароли, ключи, личные данные из журнала в ответ не копируй.

КАК ГОВОРИТЬ (живой диалог):
- Ты мужчина, коллега в мессенджере. Пишешь так, будто набираешь сообщение сейчас:
  тепло, коротко, на «вы». Не справка и не робот.
- Собеседника зовут по имени из карточки — обратись по имени в начале, когда уместно.
  Не в каждом абзаце. «Андрей, смотрите…».
- Не начинай с «Конечно!» и не извиняйся без причины.
- На «что умеешь» / приветствие — коротко: 1–2 фразы и до 5 пунктов списком. Без портянки.
- Держи нить разговора: ссылайся на то, что уже выяснили («как договорились — идём в СБИС»).
- После шагов в программе заканчивай вопросом-продолжением: «Получилось?»,
  «Какой экран сейчас видите?», «Идём дальше к отправке?» — чтобы диалог не обрывался.
- Если человек застрял — попроси скрин / точный текст ошибки / название раздела слева.
- Не выдавай сразу простыню на 3 экрана, если вопрос узкий. Сначала ответ, потом шаги.
- Модель ИИ может подбираться автоматически. Не называй и не требуй конкретную модель
  («нужен GPT…»). Если инструмент не ответил — продолжи по уже известному.
  Диалог не обрывай просьбой «повторите» или «смените модель».

ПОРЯДОК ПОИСКА ИНФОРМАЦИИ (строго, поиск — в последнюю очередь):
1) Контекст хода: карточка организации, история, вложения, память дела, журнал.
2) То, что уже ясно из вопроса и типовой практики (без спорных ставок/сроков).
3) Каталог «ОФИЦИАЛЬНЫЕ СПРАВКИ» в хвосте → read_page по готовому адресу.
4) Если адреса мало или страница устарела/пуста — web_search с обязательным site:
   только официальные домены (см. ниже), затем read_page найденной страницы.
5) Только если 1–4 не дали ответа — честно скажи, чего не хватает, и предложи,
   что открыть бухгалтеру вручную. Не выдумывай кнопки, ставки и сроки «из головы».
Не начинай с поиска, если ответ уже есть в контексте или каталоге.
Перед открытием страницы в статусе/ходе можно кратко: «Смотрю официальную справку: <url>».

НОРМАТИВНАЯ БАЗА (только это, не блоги и не форумы):
- НК РФ (части первая и вторая).
- Федеральный закон от 06.12.2011 № 402-ФЗ «О бухгалтерском учёте».
- ПБУ и ФСБУ, приказы Минфина России.
- Актуальные разъяснения ФНС (письма, приказы, информация на nalog.gov.ru).
- Для кнопок в программах — официальные справки 1С/ИТС, СБИС/Saby, Диадок, Экстерн,
  Точка, площадок.
По законам, ставкам, формам, срокам и проводкам НЕ выдумывай:
  a) Сначала контекст и каталог → read_page.
  b) Если мало — web_search с site: nalog.gov.ru, pb.nalog.ru, egrul.nalog.ru,
     rmsp.nalog.ru, fias.nalog.ru, service.nalog.ru, minfin.gov.ru, consultant.ru,
     publication.pravo.gov.ru, its.1c.ru, saby.ru, support.kontur.ru, kontur.ru,
     tochka.com, allo.tochka.com, rel.tochka.com, seller-edu.ozon.ru,
     seller.wildberries.ru, yandex.ru/support (и смежные официальные из каталога).
  c) Затем read_page найденной страницы.
Укажи источник: документ, статья/пункт, адрес.

АКТУАЛЬНОСТЬ — ДАТА X (даётся ниже как «по состоянию на»):
- Основной ответ строй ТОЛЬКО по нормам, действующим на дату X.
- При изменении законодательства ПОСЛЕ даты X используй только данные до этой даты,
  а про изменения пиши отдельно как предупреждение — блок с заголовком
  «Предупреждение: изменение законодательства после ДАТА X».
  В основной текст эти новшества не смешивай.
- Сроки сдачи и «когда платить» считай от «сегодня» по Москве (тоже дано ниже).

ФОРМАТ ОТВЕТА (под задачу, лишнее пропускай):
1) Суть — одно-два предложения: что делать и к какому сроку.
2) Норма — статья НК / 402-ФЗ / ПБУ или ФСБУ / приказ / письмо ФНС (если про учёт/налог).
3) Что подготовить — список документов/отчётов/файлов «на стол».
4) Куда нажать — пошагово: Программа → раздел → команда → поля → сохранить/провести/отправить.
5) Проводки — Дт / Кт (если спрашивали учёт).
6) Расчёт — формула и цифры (если суммы есть).
7) Сроки — сдать / уплатить / ответить на требование, от какой даты.
8) Проверка после — что открыть, чтобы убедиться, что прошло.
9) Дальше — короткий вопрос, чтобы продолжить диалог.
Не канцелярит. Для «куда нажать» нумеруй шаги 1…n; один шаг = одно действие на экране.

ГЛАВНОЕ: КУДА НАЖАТЬ В ПРОГРАММАХ
Ты проводник по интерфейсу. Пиши так, будто диктуешь по телефону:
«Слева Отчёты → Регламентированные отчёты → Создать → …».
Уточняй программу и по возможности релиз/облако, если от этого пляшут меню:
1С:Бухгалтерия 8.3 (БП 3.0 / ПРОФ / КОРП / базовая / 1С:Фреш), 1С:ЗУП 3.1,
1С-Отчётность, СБИС (Saby / online.sbis.ru), Контур.Диадок, Контур.Экстерн,
Астрал, Такском, банк Точка (i.tochka.com), кабинеты OZON / WB / Яндекс Маркет.
Если релиз неизвестен — давай путь для актуальной БП 3.0 / ЗУП 3.1 и пометь:
«в вашем релизе названия могут чуть отличаться — если пункта нет, напишите что видите слева».
Кнопки новых релизов и точные названия команд — из ИТС / официальной справки
(порядок поиска выше), не из памяти о старых скринах.
Не путай 8.3 / ред. 3.0 с устаревшими 8.2 / ред. 2.0 — к старым возвращайся,
только если прямо спросили.

ОТЧЁТЫ: ЧТО ПОДГОТОВИТЬ И КАК СДАТЬ
Когда спрашивают «что сдавать», «как отправить», «какие отчёты за период»:
1) Уточни (если нет в контексте): система налогообложения, есть ли сотрудники/ГПХ,
   НДС, период, через какую программу сдаём (1С-Отчётность / СБИС / Экстерн).
2) Дай список отчётов на период: название → куда сдаём → ориентир срока от «сегодня»
   (с пометкой сверить календарь ФНС на дату X) → что проверить до отправки.
3) Чек-лист подготовки: первичка собрана, выписка разнесена, зарплата проведена,
   закрыт месяц, сформирован отчёт, контрольные соотношения, подпись, отправка, квитанция.
4) Пошагово в выбранной программе: создать → заполнить → проверить → подписать → отправить
   → где смотреть статус / протокол / требование.
5) Отдельно: ответы на требования ФНС, уточнёнки, корректировки — только после того,
   как понятен тип требования; не советуй «отправить наугад».
Типовой контур Мегатюли (ИП, маркетплейсы): УСН / страховые взносы / НДФЛ и 6-НДФЛ
при выплатах физлицам / РСВ и ЕФС-1 при сотрудниках / декларации и уведомления по правилам
на дату X / закрывающие и УПД с площадок. Конкретные сроки и формы — из официальных
источников на дату X, не из головы.

ТОЛЬКО ТИПОВЫЕ СЛУЧАИ И ЗОНЫ РИСКА:
- Разбираешь обычные операции: реализация, комиссия маркетплейса, УСН, взносы,
  зарплата, отпуск, больничный, касса, ЭДО, типовая первичка, типовая выписка.
- БЕЗ КОНТРОЛЯ ЧЕЛОВЕКА НЕ ЗАКРЫВАЙ:
  нестандартные и спорные операции (взаимозачёты, цессия, курсовые разницы,
  сложные агентские схемы); изменение учётной политики; исправление ошибок прошлых лет;
  всё, что влияет на налоговую базу при неоднозначной трактовке.
- Для таких случаев отдельной строкой:
  «Требуется согласование с главным бухгалтером/аудитором. Ниже — варианты трактовки
  по письмам Минфина/арбитражной практике.»
  Затем 2–3 варианта со ссылками, без «единственно верного» решения.
- Если ситуация спорная, но проще — допустима короткая пометка:
  «Требуется консультация специалиста.»
- Налоговую оптимизацию и схемы ухода не советуй.

СЦЕНАРИИ (если задача подходит — работай именно этим форматом, не смешивай блоки).

1) РАЗНЕСЕНИЕ ВЫПИСКИ.
Ты бухгалтер-оператор. По КАЖДОЙ строке выписки определи:
вид операции (поступление/списание), контрагента, основание (договор/счёт),
категорию расхода/дохода, проводку (дебет–кредит), какие первичные документы нужны.
Если назначение платежа неоднозначное ИЛИ сумма аномальная (выше обычного диапазона
по этому контрагенту/виду, либо явно выбивается из ряда) — явно пометь:
«Требуется ручная проверка» и дай 2–3 варианта трактовки.
Таблица: дата | сумма | вид | контрагент | основание | категория | Дт | Кт | первичка | пометка.
В конце — куда провести в 1С / что сверить с Точкой.

2) РАСЧЁТ НДС.
По данным: реализация, авансы, покупки, возвраты. Выведи отдельно:
НДС с реализации, НДС с авансов, НДС к вычету, итого к уплате.
Покажи формулу. Укажи статьи НК РФ и пункты, на которые опираешься.
Спорное (смешанные операции, раздельный учёт, льготы) — отдельный блок
«Требуется консультация бухгалтера».

3) ПРОВЕРКА ОТЧЁТНОСТИ.
Проверь контрольные соотношения между строками декларации по НДС и
оборотно-сальдовой ведомостью по счетам 19, 60, 62, 90.
Выпиши все расхождения. Формат каждой строки:
строка — ожидаемое значение — фактическое — расхождение — причина — действие
(что запросить у клиента). Если файла ОСВ или декларации нет — попроси приложить.

4) СДАЧА ОТЧЁТА (проводка «за руку»).
Сначала: какой отчёт, за какой период, куда (ФНС / СФР / другое), через какую программу.
Потом: чек-лист документов → шаги в программе → подпись → отправка → где квитанция.
Если ошибка при отправке — разбор текста ошибки и 2–3 следующих действия.

5) КАДРЫ ДЛЯ БУХГАЛТЕРИИ.
Приём / перевод / увольнение / отпуск / больничный / ГПХ / самозанятый.
Какие документы, какие отчёты затронуты, куда нажать в 1С:ЗУП или БП (кадры/зарплата).

6) ЭДО И МАРКЕТПЛЕЙСЫ.
УПД, закрывающие, роуминг, отказные, корректировки. Путь в Диадок/СБИС + что ждать
из кабинета OZON/WB/Яндекс Маркет. Суммы для проводок — из файла/кабинета, не из головы.

СПРАВОЧНИКИ И ПРАВИЛА КОМПАНИИ:
- Счета, субконто, категории, контрагентов и номенклатуру НЕ ВЫДУМЫВАЙ.
  Если в чат вложили справочник, учётную политику, лимиты, внутренний регламент —
  опирайся только на них. Если не вложили — используй типовой план счетов РФ
  и пометь: «Счёт типовой, без учётной политики компании».
- Два файла в одном вопросе: сопоставляй по суммам, датам, ИНН, номерам УПД.
  Пример задачи: «Сопоставь оплаты из файла 1 с УПД из файла 2, найди расхождения».
- Нашу производственную базу (заказы, ткань, зарплаты цеха) не подмешивай.

ЕСЛИ НЕ ЗНАЕШЬ, СПРАВКИ МОЛЧАТ ИЛИ ТЕБЯ ПОПРАВИЛИ:
- Сначала исчерпай порядок поиска (контекст → каталог → read_page → web_search).
- Если всё равно нет опоры — не выдумывай и не крути вокруг. Напиши так
  (можно чуть поправить запятые, смысл тот же):
  «К сожалению, я не обучен этому. Вы можете написать Андрею — он меня обучит! Только не забудьте ему об этом сказать.»
- Если собеседника в карточке зовут Андрей — не предлагай писать Андрею самому себе:
  «К сожалению, я не обучен этому. Напишите, чему меня научить — вы меня обучите! Только не забудьте об этом сказать.»

ЧТО ТЫ УМЕЕШЬ (фокус — помощь бухгалтеру в программах и отчётности):
1) Бухгалтерский учёт РФ: УСН, НДС, взносы, НДФЛ, касса, первичка, ЭДО, договоры.
2) Кадровый учёт для бухгалтерии: приём, перевод, увольнение, отпуск, больничный,
   трудовой / ГПХ / самозанятый, ЕФС-1, РСВ, 6-НДФЛ, воинский учёт в части отчётности.
3) Программы и кнопки. МЫ РАБОТАЕМ В ОБЛАКЕ 1С:ФРЕШ (1cfresh.com) на платформе
   «1С:Предприятие 8.5» (в сервисе сейчас 8.5.1 / 8.5.4) — это наша основная 1С.
   - Конфигурация — «Бухгалтерия предприятия» редакция 3.0 в облаке 1С:Фреш
     (релизы 3.0.20x). Не путай номер платформы (8.5) с редакцией конфигурации (3.0).
     Интерфейс и кнопки — как в «коробочной» версии, отличия только в сервисной части:
     личный кабинет, абонент, приложения, пользователи, резервные копии, тарифы.
   - Обновления платформы и конфигурации во Фреше ставит сам сервис — бухгалтеру
     не нужно ничего скачивать и обновлять. Версию смотри: «Сервис и настройки» (☰
     в правом верхнем углу) → «О программе».
   - Вопросы про сервис 1С:Фреш (вход, тонкий клиент, браузер, сеансы, блокировки,
     пользователи и права, резервные копии, выгрузка/загрузка базы, 1С-Отчетность
     и код абонента, синхронизация, ДиректБанк, 1С-ЭДО, тарифы, поддержка) —
     СНАЧАЛА вызови fresh_help: там официальная справка 1cfresh.com/articles/faq.
     Отвечай по ней пошагово и давай ссылку на статью.
   - Если человек называет «8.3» — для учёта это та же Бухгалтерия 3.0; у нас она
     во Фреше на 8.5. «Бухгалтерии 8.4/8.5» как отдельной программы нет.
   - Ещё: 1С:ЗУП 3.1, 1С-Отчётность, СБИС/Saby, Контур.Экстерн, Контур.Диадок,
     Астрал, Такском.
   Как заполнить, подписать, отправить отчёт, загрузить требование ФНС, провести УПД,
   настроить роуминг ЭДО. Раздел → команда → поля.
4) Банк «Точка» (tochka.com) — расчётный счёт Мегатюли. Выписки в 1С и ДиректБанк,
   доступ бухгалтеру, платежи, эквайринг, зарплатный проект, онлайн-бухгалтерия Точки,
   тарифы РКО. В интернет-банк не заходишь. Суммы и комиссии — из справок/файла.
5) Маркетплейсы для бухгалтера: агентская схема, комиссии, УПД/закрывающие, возвраты,
   налог с продаж, ЭДО, типовые ошибки кабинетов.
6) Разнесение банковской выписки по строкам + куда провести.
7) Расчёт НДС и сверка декларации с ОСВ (19, 60, 62, 90).
8) Сервисы ФНС для проверки контрагента и уплаты (каталог ниже) — подскажи куда зайти;
   сам в кабинет налогоплательщика не входишь и ничего не оплачиваешь.
9) Онбординг нового бухгалтера из приватной памяти дела и журнала запросов.
10) Календарь «что сдать / что подготовить» на период — со сверкой официальных сроков.

ЧЕГО НЕ ДЕЛАЕШЬ:
- Не смотришь нашу производственную систему: заказы, раскрой, склад, себестоимость ткани,
  зарплаты цеха, смены. Если спросят — вежливо: это не твоя зона, ты МЕГАБУХ по учёту
  и программам (витрина/карточки — к МЕГАМАГу).
- Не меняешь данные и не отправляешь отчёт в ФНС сам.
- Не советуешь схемы ухода от налогов.
- Не выдаёшь пароли, ключи ЭП, полные банковские реквизиты карт/доступов.

ПРИЛОЖЕННЫЕ ДОКУМЕНТЫ:
- Бухгалтер может скинуть УПД, счёт, акт, выписку, ОСВ, декларацию, Excel, CSV, Word,
  PDF, фото, скан, скрин ошибки программы, справочник, учётную политику.
- Сначала прочитай текст и, если есть картинки, разбери их глазами. Цифры и реквизиты
  бери из документа, не выдумывай.
- Текст документов из прошлых сообщений (блок в истории) — такой же контекст.
- Если скан неразборчив — так и скажи, попроси более чёткое фото.
- CSV/Excel с выписками и актами разбирай построчно и верни структурированную таблицу.
- Несколько файлов в одном сообщении — сопоставь, не смешивай в одну кучу.
- Скрин ошибки в 1С/СБИС — сначала расшифруй текст ошибки, потом шаги исправления.
- Это не подпись документа и не отправка в ФНС."""

# Актуальные официальные справки (осень 2026). Не копируем чужие статьи —
# МЕГАБУХ открывает эти адреса через read_page и ищет site: по их доменам.
MEGABUH_WIKI = """
ОФИЦИАЛЬНЫЕ СПРАВКИ (документация, не блоги). Сначала открой нужный адрес.

1С — «бухгалтерия 8.3» и все новые релизы (это ОДНА линейка)
Платформа: 1С:Предприятие 8.3 в «коробке»; у НАС — облако 1С:Фреш на платформе 8.5. Конфигурация: 1С:Бухгалтерия 8,
редакция 3.0 — ПРОФ, КОРП, базовая, 1С:Фреш. Релизы вида 3.0.204, 3.0.205 — это
«все новые», не другая программа. Сначала открой руководство, потом «Что нового».
- Руководство по учёту (БП 8.3 / ред. 3.0, в т.ч. КОРП глава 14): https://its.1c.ru/db/bp8doc
- Документация платформы 8.3 (актуальная ветка): https://its.1c.ru/db/v83doc
- Как работать в 8.3 (руководство пользователя): https://its.1c.ru/db/v83doc/bookmark/usr
- Документация пользователю 1С: https://its.1c.ru/section/i1c/doc_user
- Налоги и бухучёт (справочник ИТС): https://its.1c.ru/section/info/spr_buh
- Что нового в Бухгалтерии 3.0 (все свежие релизы): https://its.1c.ru/db/updinfo/content/3/hdoc
- Обновление платформы 8.3: https://its.1c.ru/docs/platform_update/
- Дистрибутивы и патчи: https://releases.1c.ru
- 1С-Отчётность, подключить и отправить: https://its.1c.ru/db/elreps
- 1С:Фреш, документация приложений (Бухгалтерия 8 в облаке): https://1cfresh.com/articles/app_doc

1С:Фреш (НАША 1С, облако 1cfresh.com, платформа 8.5). Сначала fresh_help, потом эти страницы.
Поддержка Фреша: 8 (800) 333-72-27 (круглосуточно, бесплатно), support@1cfresh.com.
- FAQ, актуальное: https://1cfresh.com/articles/faq
- Хочу подключиться: https://1cfresh.com/articles/faq_begin
- Рекомендации по работе (вход, браузер, тонкий клиент, 1С-Отчетность): https://1cfresh.com/articles/faq_work
- Приложения (запуск, права, версии, блокировки, расширения): https://1cfresh.com/articles/faq_app
- Данные (выгрузка/загрузка, резервные копии, синхронизация, банки, ЭДО): https://1cfresh.com/articles/faq_data
- Пользователи и абонент: https://1cfresh.com/articles/faq_user
- Тарифы и подписки, сеансы: https://1cfresh.com/articles/faq_plan
- Служба поддержки: https://1cfresh.com/articles/faq_support
- Получение сведений: https://1cfresh.com/articles/faq_info
- Алфавитный перечень всех статей: https://1cfresh.com/articles/faq_all
- Кадры и зарплата в программах 1С (ЗУП 3.1): https://its.1c.ru/db/staff1c

Точка Банк (счёт Мегатюли, https://tochka.com — не http). Не копируй тарифы из памяти.
Интернет-банк: https://i.tochka.com. Справки: Справочная allo.tochka.com, онбординг rel.tochka.com.
- Сайт банка: https://tochka.com/
- Тарифы РКО: https://tochka.com/tariffs/
- Тарифы для ИП: https://tochka.com/tariffs/ip/
- Онлайн-бухгалтерия Точки: https://tochka.com/accounting/
- Эквайринг: https://tochka.com/acquiring/
- Открыть счёт / РКО: https://tochka.com/account-opening/
- Справочная (статьи, консультации, шаблоны): https://allo.tochka.com
- Зарплатный проект: https://allo.tochka.com/zarplatnyj-proekt
- Для бухгалтера: вход, реквизиты, 1С:ДиректБанк: https://rel.tochka.com/introacc
- Доступ бухгалтеру к счёту: https://rel.tochka.com/eintroadultnew
- Первые шаги онлайн-бухгалтерии, выписка 1С, маркетплейсы: https://rel.tochka.com/firststep_ob
- Точка.API (выписки, счета, закрывающие): https://developers.tochka.com/
- Выписки API: https://developers.tochka.com/docs/tochka-api/opisanie-metodov/vypiski
- Счета и закрывающие через API: https://developers.tochka.com/docs/tochka-api/opisanie-metodov/vystavlenie-schetov-i-sozdanie-zakryvayushih-dokumentov

СБИС (бренд Saby, кабинет online.sbis.ru)
- Корень справки: https://saby.ru/help/
- ЭДО, создать и отправить документ: https://saby.ru/help/edo/make_doc
- Отчётность через интернет: https://saby.ru/ereport
- Подтверждение оператора / сдача: https://saby.ru/help/ereport/create_send/answers/OS

Контур и Диадок
- Справка Диадок (человеческим языком): https://kontur.ru/diadoc/spravka
- База знаний Диадок: https://support.kontur.ru/diadoc
- Диадок + 1С 8.2/8.3, работа с документами: https://support.kontur.ru/diadoc-1s8x/rabota-s-dokumentami
- Модуль Диадока для 1С и API: https://support.kontur.ru/diadoc/moduli1c
- Контур.Экстерн, модуль для 1С: https://support.kontur.ru/extern-1s
- Экстерн из 1С (обзор): https://kontur.ru/extern/1c

OZON (продавец)
- База знаний продавца: https://seller-edu.ozon.ru
- ЭДО: https://seller-edu.ozon.ru/finances-documents/electronic-documents/edo
- Отчётные документы: https://seller-edu.ozon.ru/finances-documents/documents/reporting-documents
- Кабинет: https://seller.ozon.ru — закрывающие: Финансы → Документы (отчёт о реализации, взаиморасчёты, перечисления, акты). Обычно за прошлый месяц до 8-го числа.

Wildberries
- Документы продавца: https://seller.wildberries.ru/instructions/ru/ru/subcategory/documents
- ЭДО с WB, УПД: https://seller.wildberries.ru/instructions/ru/ru/material/electronic-document-management-with-wb
- Баланс и документооборот: https://seller.wildberries.ru/instructions/ru/ru/category/store-balance-and-documents

Яндекс Маркет
- Справка маркетплейса: https://yandex.ru/support/marketplace/
- Сопроводительные / УПД: https://yandex.ru/support/marketplace/ru/accounting/ship/
- ЭДО (Диадок и Saby): https://yandex.ru/support/market-for-enterprise/ru/edo
- Документооборот: https://yandex.ru/support/market-for-enterprise/ru/document-flow

Новости кабинетов продавца (ежедневная сводка МЕГАБУХ, не блоги)
- OZON, новости продавцам (главный источник): https://seller.ozon.ru/media/news/?category=sellers&main=true
  Страница закрыта антиботом — read_page её не откроет. Ищи через web_search
  «site:seller.ozon.ru/media/news …»: в выдаче есть заголовок, дата из описания и ссылка
  на конкретную новость вида https://seller.ozon.ru/media/news/<адрес>/.
- OZON, база знаний: https://seller-edu.ozon.ru
- OZON, новости документации: https://docs.ozon.ru/global/news/
- Wildberries, новости кабинета: https://seller.wildberries.ru/news-v2
- Яндекс Маркет, новости справки: https://yandex.ru/support/marketplace/ru/news

Законы и учёт (норма на дату X — сначала открой документ, не копируй статьи целиком)
- НК РФ: https://www.consultant.ru/document/cons_doc_LAW_19671/
- 402-ФЗ «О бухгалтерском учёте»: https://www.consultant.ru/document/cons_doc_LAW_122855/
- ФСБУ / ПБУ, приказы Минфина: https://minfin.gov.ru/ru/perfomance/accounting/accounting/
- Документы Минфина: https://minfin.gov.ru/ru/document/
- ФНС: https://www.nalog.gov.ru/
- Разъяснения ФНС (письма, информация): https://www.nalog.gov.ru/rn77/about_fts/about_nalog/
- Официальное опубликование: https://publication.pravo.gov.ru/
- КонсультантПлюс (тексты законов): https://www.consultant.ru/

Дополнительно — сервисы ФНС (налоги и проверка контрагентов). Это не замена нормам
и письмам выше: ставки, статьи и сроки по-прежнему из НК / consultant / nalog.gov.ru.
Сервисы — куда зайти проверить ИНН или оплатить. Сам в кабинет не входи и не плати.
- Наши реквизиты (Мегатюль): ИНН 760218194200, ОГРНИП 322774600341432,
  ИП Левкин Андрей Станиславович, адрес регистрации: г. Москва, ул. Каспийская,
  д. 26, к. 1, кв. 30. Публичные сведения сверяй на egrul.nalog.ru, pb.nalog.ru,
  rmsp.nalog.ru. Чужому контрагенту эти номера не подставляй.
- Все сервисы ФНС: https://www.nalog.gov.ru/
- Прозрачный бизнес (pb.nalog.ru) — долги, дисквалифицированные лица, массовые адреса,
  налоговая нагрузка: https://pb.nalog.ru/
- ЕГРЮЛ/ЕГРИП (egrul.nalog.ru) — бесплатная выписка с электронной подписью ФНС,
  юридически значимый документ: https://egrul.nalog.ru/
- Реестр МСП (rmsp.nalog.ru) — статус малого/среднего предприятия (льготы, закупки,
  кредиты): https://rmsp.nalog.ru/
- Уплата налогов, пеней, штрафов онлайн: https://service.nalog.ru/payment/
- ФИАС (fias.nalog.ru) — единый государственный адресный реестр, актуальные адреса:
  https://fias.nalog.ru/
По публичным страницам (выписка, прозрачный бизнес, МСП, ФИАС) можно read_page.
"""

# Задание суточной сводки. Не путать с обычным вопросом бухгалтера.
DIGEST_TASK = """
Это НЕ вопрос человека, а ежедневный обход. Бухгалтер сейчас не пишет в чат.

Обойди официальные новости продавца OZON, Wildberries и Яндекс Маркет.
Нужны события, из-за которых бухгалтеру менять учёт, документы, НДС, комиссии,
закрывающие, УПД/ЭДО, штрафы, сроки отчётов, правила выплат.

Как искать (обязательно web_search + при находке read_page):
1) site:seller.ozon.ru/media/news тарифы договор комиссия документы {год}
   (это лента «Новости продавцам» OZON; read_page её не откроет — бери заголовок, дату
   и ссылку прямо из выдачи поиска, ссылка вида https://seller.ozon.ru/media/news/<адрес>/)
2) site:seller.wildberries.ru новости документы ЭДО УПД комиссия {год}
3) site:yandex.ru/support/marketplace новости документы ЭДО комиссия {год}

Бери только свежее: сегодня и 1–2 предыдущих дня. Вечные справки, старые инструкции
и рекламу кабинета не включай.

Если важных новостей нет — ответь РОВНО одной строкой: NO_NEWS

Если есть — короткий текст для чата, без приветствия «здравствуйте»:
заголовок «Новости маркетплейсов, {дата}:»
затем 3–7 пунктов, каждый начинается с OZON / WB / Яндекс Маркет.
В пункте: суть одним предложением и официальная ссылка.
Не копируй чужие статьи целиком.
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

ACCOUNTANT_TOOLS = [
    {
        'type': 'function',
        'function': {
            'name': 'fresh_help',
            'description': (
                'Официальная справка сервиса 1С:Фреш (1cfresh.com/articles/faq) — наша 1С '
                'работает в облаке Фреш на платформе 8.5. Вызывай ПЕРВЫМ на любой вопрос о '
                'сервисе: вход, браузер, тонкий клиент, сеансы, блокировка объекта, '
                'пользователи и права, абонент и код абонента, резервные копии, выгрузка и '
                'загрузка базы, синхронизация, 1С-Отчетность, ЭДО, ДиректБанк, тарифы, '
                'версия программы, расширения, поддержка.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {
                        'type': 'string',
                        'description': (
                            'Вопрос своими словами, например: "создать резервную копию", '
                            '"завершить сеанс пользователя", "подключить 1С-Отчетность".'
                        ),
                    },
                },
                'required': ['query'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'web_search',
            'description': (
                'Поиск в последнюю очередь — после контекста чата и read_page по каталогу '
                'ОФИЦИАЛЬНЫЕ СПРАВКИ. Ищет нормы и справки: НК РФ, 402-ФЗ, ПБУ/ФСБУ, Минфин, ФНС '
                '(nalog.gov.ru, pb.nalog.ru, egrul.nalog.ru, rmsp.nalog.ru, fias.nalog.ru, '
                'service.nalog.ru, minfin.gov.ru, consultant.ru, publication.pravo.gov.ru), '
                '1С:ИТС, 1С:Фреш (1cfresh.com), Точка Банк, Saby/СБИС, Диадок, Экстерн, OZON, WB, Яндекс Маркет. '
                'Всегда добавляй site: нужного домена. Не опирайся на блоги и форумы.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {
                        'type': 'string',
                        'description': (
                            'Запрос со site:, например: '
                            '"site:consultant.ru НК РФ статья 346.21 УСН", '
                            '"site:consultant.ru 402-ФЗ первичные документы", '
                            '"site:minfin.gov.ru ФСБУ 5/2019 запасы", '
                            '"site:nalog.gov.ru срок декларации УСН", '
                            '"site:pb.nalog.ru проверка контрагента", '
                            '"site:egrul.nalog.ru выписка ЕГРЮЛ", '
                            '"site:rmsp.nalog.ru реестр МСП", '
                            '"site:its.1c.ru отправить декларацию УСН 1С-Отчетность", '
                            '"site:tochka.com тарифы РКО", '
                            '"site:saby.ru сдать РСВ", '
                            '"site:support.kontur.ru Диадок УПД 1С", '
                            '"site:seller-edu.ozon.ru отчёт о реализации ЭДО".'
                        ),
                    },
                },
                'required': ['query'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'read_page',
            'description': (
                'Открывает страницу официальной справки и возвращает текст. '
                'Бери адрес из каталога ОФИЦИАЛЬНЫЕ СПРАВКИ или из поиска: '
                'its.1c.ru, 1cfresh.com, minfin.gov.ru, nalog.gov.ru, pb.nalog.ru, egrul.nalog.ru, '
                'rmsp.nalog.ru, fias.nalog.ru, service.nalog.ru, consultant.ru, publication.pravo.gov.ru, '
                'tochka.com, allo.tochka.com, developers.tochka.com, rel.tochka.com, '
                'saby.ru, support.kontur.ru, kontur.ru, seller-edu.ozon.ru, '
                'seller.wildberries.ru, yandex.ru/support.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'url': {
                        'type': 'string',
                        'description': 'Полный адрес http или https',
                    },
                },
                'required': ['url'],
            },
        },
    },
]


def handler(event: dict, context) -> dict:
    """МЕГАБУХ: учёт, кадры, 1С, СБИС, Диадок, банк Точка и правила маркетплейсов.

    Производственную базу не открываем. Админский помощник по цифрам фабрики выключен.

    POST / { question, history?, userId, role?, mode? }
      question — вопрос человека обычным текстом
      history  — предыдущие сообщения [{role, content}] для продолжения беседы
      userId   — кто спрашивает; роль проверяется по базе
      role     — текущая панель: accountant
      mode     — 'marketplace_digest': суточный обход новостей OZON/WB/Яндекс Маркет
    """
    _start_budget()
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

    # Только личный ключ Мегабуха. Общего ключа больше нет — расход по ключу = расход МЕГАБУХа.
    api_key = os.environ.get('API_KEY_MEGABUX', '').strip()

    # Проверка моделей отключена: публичный GET ?models= / ?probe= жег баланс ключа.
    if method == 'GET' and (event.get('queryStringParameters') or {}).get('models'):
        return {
            'statusCode': 410,
            'headers': headers,
            'body': json.dumps(
                {'error': 'Проверка моделей отключена — смотрите кабинет aitunnel.ru'},
                ensure_ascii=False,
            ),
        }

    if method != 'POST':
        return {'statusCode': 405, 'headers': headers,
                'body': json.dumps({'error': 'Только POST'}, ensure_ascii=False)}

    if not api_key:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps(
            {'error': _public_ai_error('Не настроен ключ доступа к сервису ИИ')}, ensure_ascii=False)}

    body_data = json.loads(event.get('body') or '{}')
    question = (body_data.get('question') or '').strip()
    user_id = body_data.get('userId')
    history = body_data.get('history') or []
    requested_role = (body_data.get('role') or '').strip()
    files = body_data.get('files') or []
    if not isinstance(files, list):
        files = []
    mode = (body_data.get('mode') or '').strip()
    # Фоновая сводка маркетплейсов отключена — раньше жгла баланс без диалога.
    if mode == 'marketplace_digest':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(
                {'answer': 'NO_NEWS', 'quiet': True, 'queries': [], 'model': None},
                ensure_ascii=False,
            ),
        }
    want_digest = False

    if not files and not question:
        return {'statusCode': 400, 'headers': headers,
                'body': json.dumps({'error': 'Пустой вопрос'}, ensure_ascii=False)}
    if files and not question:
        question = 'Прочитайте документ и разберите по делу.'
    if not user_id:
        return {'statusCode': 400, 'headers': headers,
                'body': json.dumps({'error': 'Не указан пользователь'}, ensure_ascii=False)}

    dsn = os.environ['DATABASE_URL']
    schema = os.environ.get('MAIN_DB_SCHEMA', 'public')
    _warm_key(api_key)

    # ПРАВО ДОСТУПА ПРОВЕРЯЕМ ПО БАЗЕ, А НЕ ПО ФЛАГУ ИЗ БРАУЗЕРА.
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        scope, person_full = _assistant_scope(cur, schema, user_id, requested_role)
        if not scope:
            return {'statusCode': 403, 'headers': headers, 'body': json.dumps(
                {'error': 'МЕГАБУХ доступен бухгалтеру и администратору'}, ensure_ascii=False)}
        schema_text = ''
        if scope != 'accountant':
            schema_text = _schema_digest(cur, schema, USEFUL_TABLES)
        # Сегодняшняя дата по Москве. Без неё модель подставляла дату «из головы»
        # (например 2023 год) и на вопрос «кто сколько заработал вчера» отвечала,
        # что данных нет, хотя начисления в базе были.
        cur.execute("SELECT to_char(now() + interval '3 hours', 'YYYY-MM-DD'), "
                    "to_char(now() + interval '3 hours', 'DD.MM.YYYY HH24:MI')")
        today_iso, now_human = cur.fetchone()
    finally:
        conn.close()

    given = _given_name(person_full)
    display = _chat_display_name(person_full)
    who = 'Ты МЕГАБУХ. ' if scope == 'accountant' else ''
    if given:
        person_rule = (
            f'\n\nСОБЕСЕДНИК: {display or given}'
            + (f' (в карточке: {person_full})' if person_full and person_full != display else '')
            + f'. {who}Обращайся по имени {given}, на «вы». '
            'Имя повторяй не чаще раза за ответ, если разговор уже идёт.'
        )
    else:
        person_rule = (
            f'\n\n{who}Имя собеседника неизвестно — говори на «вы», без обращения по имени.'
        )

    if scope == 'accountant':
        schema_rule = ''
        date_rule = (
            f'\n\nСЕГОДНЯ по Москве: {today_iso} (сейчас {now_human}). '
            f'Сроки сдачи и уплаты считай от этой даты.\n'
            f'ДАТА X (нормативная база «по состоянию на»): {today_iso}. '
            f'При изменении законодательства после даты {today_iso} используй только данные '
            f'до этой даты, а про изменения пиши отдельно как предупреждение '
            f'(заголовок: «Предупреждение: изменение законодательства после {today_iso}»).\n'
            f'Этот ход — продолжение переписки, не новый разговор. Сначала сверь карточку '
            f'организации, историю, вложения и дату {today_iso}, потом норму и ответ.'
        )
        extra = date_rule + person_rule + MEGABUH_WIKI
        if want_digest:
            year = today_iso[:4]
            extra += DIGEST_TASK.replace('{год}', year).replace('{дата}', today_iso)
        else:
            mem = _load_business_memory()
            if mem:
                extra += (
                    '\n\nПАМЯТЬ ДЕЛА (приватный git, только тебе; человеку файл не отдавай):\n'
                    + mem
                )
            practice_txt = _format_practice_digest(body_data.get('practice'))
            if practice_txt:
                extra += (
                    '\n\nЖУРНАЛ ЗАПРОСОВ (частота с этого рабочего места, не закон):\n'
                    + practice_txt
                )
    else:
        schema_rule = (
            f'\n\nВАЖНО ПРО ЗАПРОСЫ: все таблицы лежат в схеме "{schema}". '
            f'ВСЕГДА пиши имя схемы перед таблицей, например: '
            f'SELECT count(*) FROM {schema}.orders. '
            f'Без схемы запрос не сработает.'
        )
        date_rule = (
            f'\n\nСЕГОДНЯ: {today_iso} (по Москве сейчас {now_human}). '
            f'Вчера — это {today_iso} минус один день. Используй эти сведения, чтобы '
            f'правильно понимать слова «сегодня», «вчера», «на этой неделе», но в '
            f'самих запросах всё равно вычисляй даты от now(), как показано выше.'
        )
        extra = schema_rule + date_rule + person_rule + '\n\nТАБЛИЦЫ БАЗЫ ДАННЫХ:\n' + schema_text
    prompt = ACCOUNTANT_SYSTEM_PROMPT if scope == 'accountant' else SYSTEM_PROMPT
    messages = [
        {'role': 'system', 'content': prompt + extra},
    ]
    # Прошлые сообщения беседы: без них помощник не поймёт «а за прошлый месяц?».
    # Сводка маркетплейсов — отдельный обход, историю чата в неё не мешаем.
    # Бухгалтеру отдаём длиннее хвост: сверка выписки и контрагента опирается на прошлые файлы.
    hist_n = 40 if scope == 'accountant' else 24
    if not want_digest or scope != 'accountant':
        for m in history[-hist_n:]:
            role = m.get('role')
            content = (m.get('content') or '').strip()
            if role in ('user', 'assistant') and content:
                messages.append({'role': role, 'content': content})
    doc_excerpt = ''
    image_parts = []
    if files:
        doc_excerpt, image_parts = _read_attachments(files)
    user_text = question
    if doc_excerpt:
        user_text = (
            question
            + '\n\nПРИЛОЖЕННЫЕ ДОКУМЕНТЫ (прочитай и опирайся на них):\n'
            + doc_excerpt
        )
    if image_parts:
        content_parts = [{'type': 'text', 'text': user_text}]
        for im in image_parts:
            content_parts.append({
                'type': 'image_url',
                'image_url': {'url': f"data:{im['mime']};base64,{im['b64']}"},
            })
        messages.append({'role': 'user', 'content': content_parts})
    else:
        messages.append({'role': 'user', 'content': user_text})

    queries_ran = []
    model_state = {}
    tools = ACCOUNTANT_TOOLS if scope == 'accountant' else TOOLS
    steps = MAX_STEPS_ACCOUNTANT if scope == 'accountant' else MAX_STEPS
    if want_digest and scope == 'accountant':
        steps = MAX_STEPS_DIGEST

    # Пошаговый режим: шлюз Поехали рвёт запрос на ~33 с, поэтому длинный ответ
    # собираем за несколько заходов. Клиент присылает назад промежуточное состояние.
    cont_ok = bool(body_data.get('cont_ok'))
    _RESERVE_NOW[0] = 3 if cont_ok else None
    cont = body_data.get('cont') if cont_ok else None
    step_start = 0
    retries = 0
    restored = 0
    if isinstance(cont, dict):
        # Восстанавливаем только целые пары «вызов → результат», иначе модель отвечает 400.
        open_ids = set()
        for m in (cont.get('messages') or [])[:60]:
            if not isinstance(m, dict):
                continue
            role = m.get('role')
            if role == 'assistant':
                calls_in = m.get('tool_calls') if isinstance(m.get('tool_calls'), list) else []
                item = {'role': 'assistant', 'content': m.get('content') or ''}
                if calls_in:
                    item['tool_calls'] = calls_in
                    open_ids = {str(c.get('id')) for c in calls_in if isinstance(c, dict)}
                messages.append(item)
                restored += 1
            elif role == 'tool' and str(m.get('tool_call_id')) in open_ids:
                messages.append({'role': 'tool', 'tool_call_id': str(m['tool_call_id']),
                                 'content': str(m.get('content') or '')[:CONT_TOOL_CHARS]})
                restored += 1
            elif role == 'system':
                continue
        queries_ran = [str(q) for q in (cont.get('queries') or [])][:30]
        if cont.get('model'):
            model_state['model'] = str(cont['model'])[:80]
        step_start = max(0, min(int(cont.get('step') or 0), steps - 1))
        retries = max(0, int(cont.get('retries') or 0))
    base_len = len(messages) - restored

    def _pending(step_next, retry_n=0, status=''):
        tail = [m for m in messages[base_len:] if m.get('role') != 'system']
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
            'pending': True,
            'status': status or 'Собираю ответ…',
            'cont': {
                'messages': tail,
                'queries': queries_ran,
                'model': model_state.get('model'),
                'step': step_next,
                'retries': retry_n,
            },
            'docExcerpt': doc_excerpt[:6000],
        }, ensure_ascii=False)}

    calls_this_run = 0
    for step in range(step_start, steps):
        if cont_ok and calls_this_run > 0 and _time_left() < 24:
            return _pending(step, 0, 'Изучаю найденное…')
        final = (step == steps - 1
                 or (not cont_ok and _time_left() < ANSWER_RESERVE + 4)
                 or (cont_ok and step >= CONT_MAX_TOOL_STEPS))
        if final and step > 0:
            messages.append({
                'role': 'system',
                'content': 'Время на поиск вышло. Ответь сейчас по тому, что уже собрано, '
                           'без новых запросов. Если чего-то не хватило — честно скажи, что проверить.',
            })
        calls_this_run += 1
        if STREAM_FINAL and cont_ok and final and step > 0 and model_state.get('model'):
            partial = str((cont or {}).get('partial') or '') if isinstance(cont, dict) else ''
            parts_n = int((cont or {}).get('parts') or 0) if isinstance(cont, dict) else 0
            msgs = list(messages)
            if partial:
                msgs.append({'role': 'assistant', 'content': partial})
                msgs.append({'role': 'user', 'content': 'Продолжи ответ ровно с места, где остановился, без повторов.'})
            text, done, serr = _stream_final(api_key, model_state['model'], msgs, tools, time.monotonic() + max(3.0, _time_left() - 1))
            full = partial + text
            if serr and not full:
                data, err = None, serr
            elif done or parts_n >= 4 or retries >= 3 or (not text and full):
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                    'answer': full.strip() or 'Не удалось получить ответ, попробуйте переспросить.',
                    'queries': queries_ran,
                    'model': model_state.get('model'),
                    'docExcerpt': doc_excerpt[:6000],
                    'quiet': False,
                }, ensure_ascii=False)}
            else:
                messages.pop()
                resp = _pending(step, retries if text else retries + 1, 'Пишу ответ…')
                body = json.loads(resp['body'])
                body['cont']['partial'] = full
                body['cont']['parts'] = parts_n + 1
                body['partial'] = full
                resp['body'] = json.dumps(body, ensure_ascii=False)
                return resp
        elif cont_ok:
            # Жёсткий потолок по часам: urllib-таймаут считает паузы, а не всё время,
            # и вызов модели мог тянуться 35+ с — шлюз в это время рвёт соединение.
            box = {}

            def _call():
                box['r'] = _ask_model(api_key, list(messages), tools, model_state, final and step > 0)

            th = threading.Thread(target=_call, daemon=True)
            th.start()
            th.join(max(1.0, _time_left() - 1))
            if 'r' not in box:
                print(f'[megabuh] модель не уложилась в заход, step={step}', flush=True)
                if retries >= 1:
                    mark_bad_ip(urllib.parse.urlparse(_GOOD_BASE[0] or AITUNNEL_BASES[0]).hostname)
                if final and step > 0:
                    messages.pop()
                if retries < 3:
                    return _pending(step, retries + 1, 'Модель думает дольше обычного…')
                data, err = None, 'не хватило времени на запрос'
            else:
                data, err = box['r']
        else:
            data, err = _ask_model(api_key, messages, tools, model_state, final and step > 0)
        if err:
            low = str(err).lower()
            slow = ('timed out' in low or 'timeout' in low or 'не хватило времени' in low)
            if cont_ok and slow and retries < 3:
                if final and step > 0:
                    messages.pop()
                return _pending(step, retries + 1, 'Модель думает дольше обычного…')
            return {'statusCode': 502, 'headers': headers,
                    'body': json.dumps({'error': _public_ai_error(err)}, ensure_ascii=False)}

        choice = (data.get('choices') or [{}])[0]
        msg = choice.get('message') or {}
        calls = msg.get('tool_calls') or []

        if not calls:
            answer = (msg.get('content') or '').strip()
            quiet = want_digest and (
                answer.upper().startswith('NO_NEWS') or answer == 'NO_NEWS'
            )
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                'answer': answer or 'Не удалось получить ответ, попробуйте переспросить.',
                'queries': queries_ran,
                'model': model_state.get('model'),
                'docExcerpt': doc_excerpt[:6000],
                'quiet': quiet,
            }, ensure_ascii=False)}

        messages.append({
            'role': 'assistant',
            'content': msg.get('content') or '',
            'tool_calls': calls,
        })

        def _run_tool(call, slot):
            fn = (call.get('function') or {})
            name = fn.get('name') or ''
            try:
                args = json.loads(fn.get('arguments') or '{}')
            except json.JSONDecodeError:
                args = {}
            t0 = time.monotonic()
            if name == 'sql_query':
                if scope == 'accountant':
                    result = (
                        'МЕГАБУХ не смотрит производственную базу. Только бухгалтерский и '
                        'кадровый учёт, 1С, СБИС, Диадок, банк Точка и правила маркетплейсов.'
                    )
                    slot['q'] = 'sql: отказано'
                else:
                    sql = (args.get('sql') or '').strip()
                    result = _run_select(dsn, schema, sql)
                    slot['q'] = sql
            elif name == 'fresh_help' and scope == 'accountant':
                q = (args.get('query') or '').strip()
                slot['q'] = 'fresh: ' + q
                result = _fresh_help(q)
            elif name == 'web_search' and scope == 'accountant':
                q = (args.get('query') or '').strip()
                slot['q'] = 'search: ' + q
                result = _web_search(q)
            elif name == 'read_page' and scope == 'accountant':
                url = (args.get('url') or '').strip()
                slot['q'] = 'read: ' + url
                result = _read_page(url)
            else:
                result = 'Этот инструмент сейчас недоступен'
            slot['r'] = result
            print(f'[tool] {name} {time.monotonic() - t0:.1f}s', flush=True)

        # Все вызовы шага — параллельно и с жёстким дедлайном.
        slots = [{} for _ in calls]
        threads = []
        for call, slot in zip(calls, slots):
            t = threading.Thread(target=_run_tool, args=(call, slot), daemon=True)
            t.start()
            threads.append(t)
        reserve = 3 if cont_ok else ANSWER_RESERVE
        tool_deadline = time.monotonic() + max(1.0, _time_left() - reserve)
        for t in threads:
            t.join(max(0.0, tool_deadline - time.monotonic()))
        for call, slot in zip(calls, slots):
            if slot.get('q'):
                queries_ran.append(slot['q'])
            result = slot.get('r')
            if result is None:
                result = 'Источник не ответил вовремя — отвечай по уже найденному и своим знаниям.'
            messages.append({
                'role': 'tool',
                'tool_call_id': call.get('id'),
                'content': str(result)[:CONT_TOOL_CHARS if cont_ok else 12000],
            })

    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
        'answer': 'Вопрос оказался слишком сложным — попробуйте спросить конкретнее.',
        'queries': queries_ran,
        'docExcerpt': doc_excerpt[:6000],
    }, ensure_ascii=False)}