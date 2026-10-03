"""МЕГАМАГ — помощник менеджера по кабинетам маркетплейсов (OZON, WB, Яндекс Маркет).

Это не МЕГАБУХ. Бухгалтерию, 1С, налоги, зарплаты, раскрой и склад цеха не трогает.
Только витрина и кабинет продавца: карточки, SEO, реклама, что требует внимания.

ГЛАВНОЕ ПРАВИЛО — ТОЛЬКО ЧТЕНИЕ.
- Postgres: соединение READ ONLY, запросы — фиксированные SELECT из кода
  (модель SQL не пишет).
- Площадки: только методы из белого списка READ_ENDPOINTS. У OZON / WB / Яндекса
  списки карточек часто отдаются через POST — это чтение, а не запись.
  Цены, карточки, кампании и объявления агент не меняет.
- Ключи площадок читаются из marketplace_integrations (вкладка «Интеграции
  маркетплейсов» в CRM) и никогда не попадают в текст для модели.

POST { question, history?, userId, role?, files? }
Файлы — выгрузки с маркетплейсов (PDF, Excel, CSV, фото карточек): агент читает и разбирает.
"""

import base64
import io
import json
import os
import socket
import threading
import time
import re
import html as html_lib
import ipaddress
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
import xml.etree.ElementTree as ET

import psycopg2

import knowledge

# Основной API и зеркало: у части провайдеров блокируют api.aitunnel.ru —
# тогда тот же ключ и пути работают на ru-api.
AITUNNEL_BASES = (
    'https://api.aitunnel.ru/v1',
    'https://ru-api.aitunnel.ru/v1',
)
# Модель МЕГАМАГа: GPT 6 Luna Pro. AITUNNEL_MODEL перекрывает при необходимости.
DEFAULT_MODEL = 'openai/gpt-6-luna-pro'
# Ключ API_KEY_MEGAMAG пускает только пресет MEGAMAG (модель GPT 6 Luna Pro внутри пресета).
MEGAMAG_PRESET = 'MEGAMAG'
MODEL_CANDIDATES = [
    DEFAULT_MODEL,
    'gpt-6-luna-pro',
]
MAX_STEPS = 6
MAX_TOOL_CHARS = 14000
MP_TIMEOUT = 8
# Живое чтение кабинета (prefetch) должно уложиться сюда — остальное время модели.
LIVE_BUDGET = 14


def _parallel(jobs, budget):
    """Запускает [(key, fn, args)] параллельно; что не успело за budget секунд — None."""
    from concurrent.futures import ThreadPoolExecutor, wait
    if not jobs:
        return {}
    ex = ThreadPoolExecutor(max_workers=min(8, len(jobs)))
    futs = {ex.submit(fn, *args): key for key, fn, args in jobs}
    done, _ = wait(futs, timeout=max(1, budget))
    out = {}
    for f, key in futs.items():
        if f in done:
            try:
                out[key] = f.result()
            except Exception as e:
                out[key] = e
        else:
            out[key] = None
    ex.shutdown(wait=False, cancel_futures=True)
    return out

OZON_API = 'https://api-seller.ozon.ru'
WB_CONTENT_API = 'https://content-api.wildberries.ru'
WB_ADVERT_API = 'https://advert-api.wildberries.ru'
YM_API = 'https://api.partner.market.yandex.ru'

MARKETPLACES = ('ozon', 'wildberries', 'yandex_market')
MP_TITLES = {'ozon': 'OZON', 'wildberries': 'Wildberries', 'yandex_market': 'Яндекс Маркет'}

# Официальные справки площадок — единственное, что агент ищет и читает в сети.
ALLOWED_DOMAINS = (
    'seller-edu.ozon.ru',
    'docs.ozon.ru',
    'seller.wildberries.ru',
    'dev.wildberries.ru',
    'partner.market.yandex.ru',
)
# yandex.ru — только раздел /support (старые ссылки).
YANDEX_SUPPORT_HOST = 'yandex.ru'
YANDEX_SUPPORT_PATH = '/support'
ALLOWED_SITE_TOKENS = ALLOWED_DOMAINS + (
    'seller.wildberries.ru/instructions',
    'yandex.ru/support',
    'yandex.ru/support/marketplace',
)

# Образовательный центр — каталог ссылок в MEGAMAG_EDU ниже.
# Вложения из чата: отчёты, выгрузки и скрины кабинетов маркетплейсов.
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
    """Текст и картинки из вложений чата. Без сторонних библиотек."""
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
                    texts.append(
                        f'--- {name} ---\nВ PDF не нашлось текста. Это, похоже, скан без распознавания.'
                    )
            elif ext in ('txt', 'csv', 'rtf'):
                texts.append(f'--- {name} ---\n{_plain_text(raw)[:MAX_DOC_CHARS]}')
            elif ext in ('doc', 'xls'):
                texts.append(
                    f'--- {name} ---\nСтарый формат .{ext}. Сохраните в .docx / .xlsx или PDF.'
                )
            else:
                texts.append(f'--- {name} ---\nНе умею открыть этот файл.')
        except Exception as e:
            texts.append(f'--- {name} ---\nНе получилось открыть: {e}')
    excerpt = '\n\n'.join(t for t in texts if t).strip()
    return excerpt[:MAX_DOC_CHARS * 2], images[:4]


# Официальные базы — вшиты в контекст. Тексты страниц не копируем: только каталог + как работать.
MEGAMAG_EDU = """
ОБРАЗОВАТЕЛЬНЫЙ ЦЕНТР И СПРАВКИ (только официальные; блоги, Telegram и totalcrm не используй)

OZON — общая база знаний селлера (карточки и SEO, FBO/FBS, финансы и комиссии,
продвижение, API, гайды по категориям, в т.ч. Ozon Global):
https://docs.ozon.ru
Образовательный центр / Libra (старт обучения):
https://seller-edu.ozon.ru/libra/how-to-start
База обучения: https://seller-edu.ozon.ru

Wildberries — Справочный центр (регистрация, заказы, FBS/FBO, упаковка, приёмка,
отзывы, частые проблемы):
https://seller.wildberries.ru/instructions
Кабинет и API-справка: https://seller.wildberries.ru , https://dev.wildberries.ru

Яндекс Маркет — Справка для продавцов в кабинете партнёра (подключение магазина,
товары и каталог, склады и логистика, заказы, расчёты, продвижение, аналитика, поддержка):
https://partner.market.yandex.ru
Доп. раздел поддержки: https://yandex.ru/support

КАК РАБОТАТЬ СО СПРАВКАМИ (обязательно):
1) Обращайся к этим источникам, если вопрос про правила площадки: модерация карточки,
   требования к фото/названию/атрибутам, логистика FBS/FBO, упаковка, приёмка, отзывы,
   комиссии, акции, продвижение. Схема: web_search site:<домен> … → read_page по найденной
   ссылке → в ответе дай кликабельную ссылку на конкретную страницу.
2) Сравнивай правила площадок, если менеджер спрашивает «для WB и OZON» или ведёт
   несколько витрин. Явно пиши, что актуально для WB, что для OZON, что для Яндекс Маркета
   (лимиты символов, обязательные поля, фильтры, модерация).
3) Ищи свежие версии правил: в материале смотри дату публикации/обновления; если дата
   старая или страница противоречит другой официальной — скажи об этом и предложи
   перепроверить в кабинете. Тарифы, оферта и документы часто меняются.
4) Если в официальной базе нет ответа — честно скажи: «в справке площадки этого не нашёл».
   Не выдумывай требования и цифры. Можно предложить, какой раздел открыть в кабинете
   или какой запрос поиска повторить.

Поиск:
- OZON: site:docs.ozon.ru или site:seller-edu.ozon.ru
- WB: site:seller.wildberries.ru/instructions (или site:seller.wildberries.ru)
- Яндекс: site:partner.market.yandex.ru (или site:yandex.ru/support)
"""


# ---------------------------------------------------------------- доступ

def _access(cur, schema, user_id, requested_role):
    """МЕГАМАГ — менеджеру и админу (раздел «Агенты»)."""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return False, ''
    cur.execute(
        f"SELECT role, is_active, full_name FROM {schema}.users WHERE id = %s", (uid,),
    )
    row = cur.fetchone()
    if not row or not row[1]:
        return False, ''
    roles = set()
    if row[0]:
        roles.add(row[0])
    cur.execute(
        f"SELECT role FROM {schema}.user_roles WHERE user_id = %s AND is_approved = true",
        (uid,),
    )
    roles |= {r[0] for r in cur.fetchall()}
    full_name = (row[2] or '').strip()
    # Админ из «Агенты» — полный доступ к МЕГАМАГу (любая requested_role).
    if 'admin' in roles:
        return True, full_name
    want = (requested_role or '').strip()
    if 'manager' in roles and want in ('', 'manager'):
        return True, full_name
    return False, ''


def _given_name(full_name):
    parts = [p for p in re.split(r'\s+', (full_name or '').strip()) if p]
    if not parts:
        return ''
    if len(parts) >= 3:
        return parts[1]
    if len(parts) == 2 and re.search(
        r'(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкая)$', parts[0], re.I,
    ):
        return parts[1]
    return parts[0]


def _chat_display_name(full_name):
    """Имя и фамилия для подписи собеседника."""
    parts = [p for p in re.split(r'\s+', (full_name or '').strip()) if p]
    if not parts:
        return ''
    if len(parts) >= 3:
        return f'{parts[1]} {parts[0]}'
    if len(parts) == 2 and re.search(
        r'(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкая)$', parts[0], re.I,
    ):
        return f'{parts[1]} {parts[0]}'
    if len(parts) == 2:
        return f'{parts[0]} {parts[1]}'
    return parts[0]


# ---------------------------------------------------------------- база (только чтение)

def _ro_conn(dsn):
    conn = psycopg2.connect(dsn, connect_timeout=5)
    # ГЛАВНАЯ ЗАЩИТА: транзакция только для чтения — запись отклонит сама база.
    # Через set_session(readonly) прокси базы зависал, поэтому команда идёт первой
    # в транзакции. Коммита нет: соединение закрывается после чтения.
    conn.cursor().execute("SET TRANSACTION READ ONLY")
    return conn


def _table_columns(cur, schema, table):
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s",
        (schema, table),
    )
    return {r[0] for r in cur.fetchall()}


def _shops(cur, schema):
    cur.execute(f"SELECT id, code, name FROM {schema}.shops WHERE is_active = true ORDER BY sort_order, id")
    return [{'id': r[0], 'code': r[1], 'name': r[2]} for r in cur.fetchall()]


def _resolve_shop(cur, schema, shop_ref):
    """shop_id может прийти числом, кодом (megatul/duna) или названием (МЕГАТЮЛЬ/ДЮНА)."""
    if shop_ref in (None, '', 0, '0', 'all'):
        return None
    ref = str(shop_ref).strip().lower()
    for s in _shops(cur, schema):
        if ref in (str(s['id']), (s['code'] or '').lower(), (s['name'] or '').lower()):
            return s
    return 'unknown'


def _load_creds(cur, schema, marketplace, shop_id):
    """Ключи площадки из CRM. Наружу (модели) не отдаются."""
    if shop_id:
        cur.execute(
            f"SELECT is_enabled, credentials, shop_id FROM {schema}.marketplace_integrations "
            f"WHERE marketplace_code = %s AND shop_id = %s LIMIT 1",
            (marketplace, int(shop_id)),
        )
    else:
        cur.execute(
            f"SELECT is_enabled, credentials, shop_id FROM {schema}.marketplace_integrations "
            f"WHERE marketplace_code = %s "
            f"ORDER BY is_enabled DESC, (credentials::text <> '{{}}') DESC, shop_id LIMIT 1",
            (marketplace,),
        )
    row = cur.fetchone()
    if not row:
        return None, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds or {}, bool(row[0])


def _rows_text(cur, title, limit=40):
    rows = cur.fetchmany(limit)
    if not rows:
        return f'{title}: нет'
    cols = [d[0] for d in cur.description]
    lines = [f'{title}:', ' | '.join(cols)]
    for r in rows:
        lines.append(' | '.join('' if v is None else str(v) for v in r))
    if len(rows) == limit:
        lines.append(f'... показаны первые {limit}')
    return '\n'.join(lines)


def _mp_list(marketplace):
    m = (marketplace or 'all').strip().lower()
    if m in ('wb', 'вб'):
        m = 'wildberries'
    if m in ('ym', 'yandex', 'яндекс'):
        m = 'yandex_market'
    if m in MARKETPLACES:
        return [m]
    return list(MARKETPLACES)


def _overview(cur, schema, shop):
    out = []
    shops = _shops(cur, schema)
    out.append('МАГАЗИНЫ (shop_id | код | название):')
    for s in shops:
        out.append(f"{s['id']} | {s['code']} | {s['name']}")
    cur.execute(
        f"SELECT mi.shop_id, mi.marketplace_code, mi.is_enabled, "
        f"  (mi.credentials::text <> '{{}}') AS has_keys, mi.updated_at "
        f"FROM {schema}.marketplace_integrations mi "
        f"WHERE mi.marketplace_code = ANY(%s) "
        f"  AND (%s::int IS NULL OR mi.shop_id = %s::int) "
        f"ORDER BY mi.shop_id, mi.marketplace_code",
        (list(MARKETPLACES), shop and shop['id'], shop and shop['id']),
    )
    out.append(_rows_text(cur, 'ПОДКЛЮЧЕНИЯ КАБИНЕТОВ (ключи не показываются)'))
    cols = _table_columns(cur, schema, 'marketplace_items')
    ym = "count(*) FILTER (WHERE COALESCE(ym_sku,'') <> '')" if 'ym_sku' in cols else 'NULL'
    cur.execute(
        f"SELECT s.name AS shop, count(i.id) AS items, "
        f"  count(*) FILTER (WHERE COALESCE(i.ozon_sku,'') <> '') AS on_ozon, "
        f"  count(*) FILTER (WHERE i.wb_nm_id IS NOT NULL OR COALESCE(i.wb_sku,'') <> '') AS on_wb, "
        f"  {ym.replace('ym_sku', 'i.ym_sku')} AS on_ym "
        f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
        f"WHERE (%s::int IS NULL OR i.shop_id = %s::int) GROUP BY s.name ORDER BY s.name",
        (shop and shop['id'], shop and shop['id']),
    )
    out.append(_rows_text(cur, 'КАРТОЧКИ В НАШЕМ СПРАВОЧНИКЕ'))
    out.append(
        'Примечание: реклама, остатки и отзывы в нашей базе хранятся по площадке, '
        'без разделения на магазин. Живые данные по магазину — what=live.'
    )
    return '\n\n'.join(out)


def _listings(cur, schema, shop, mps):
    out = []
    cols = _table_columns(cur, schema, 'marketplace_items')
    sid = shop and shop['id']
    ym_col = ", i.ym_sku" if 'ym_sku' in cols else ''
    # Сначала живые привязанные карточки из нашего справочника — без них агент
    # не может разобрать SEO и витрину по артикулу.
    cur.execute(
        f"SELECT i.id, s.name AS shop, i.sku, i.name, i.width, i.height, i.material, "
        f"  i.ozon_sku, i.wb_nm_id, i.wb_sku{ym_col}, i.barcode "
        f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
        f"WHERE (%s::int IS NULL OR i.shop_id = %s::int) "
        f"  AND (COALESCE(i.ozon_sku,'') <> '' OR i.wb_nm_id IS NOT NULL "
        f"       OR COALESCE(i.wb_sku,'') <> ''"
        + (" OR COALESCE(i.ym_sku,'') <> ''" if 'ym_sku' in cols else '')
        + ") "
        f"ORDER BY i.updated_at DESC NULLS LAST, i.id DESC",
        (sid, sid),
    )
    out.append(_rows_text(cur, 'КАРТОЧКИ В СПРАВОЧНИКЕ (привязаны к площадкам)', 60))
    conds = []
    if 'ozon' in mps:
        conds.append("COALESCE(i.ozon_sku,'') = ''")
    if 'wildberries' in mps:
        conds.append("(i.wb_nm_id IS NULL AND COALESCE(i.wb_sku,'') = '')")
    if 'yandex_market' in mps and 'ym_sku' in cols:
        conds.append("COALESCE(i.ym_sku,'') = ''")
    if conds:
        cur.execute(
            f"SELECT i.id, s.name AS shop, i.sku, i.name, i.ozon_sku, i.wb_nm_id{ym_col} "
            f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
            f"WHERE (%s::int IS NULL OR i.shop_id = %s::int) AND ({' OR '.join(conds)}) "
            f"ORDER BY i.id DESC",
            (sid, sid),
        )
        out.append(_rows_text(cur, 'КАРТОЧКИ БЕЗ ПРИВЯЗКИ К ПЛОЩАДКЕ (нет кода товара на площадке)', 50))
    cur.execute(
        f"SELECT marketplace_code, sku, offer_id, product_name, free_amount, reserved_amount, synced_at "
        f"FROM {schema}.marketplace_stocks WHERE marketplace_code = ANY(%s) AND free_amount <= 0 "
        f"ORDER BY synced_at DESC",
        (mps,),
    )
    out.append(_rows_text(cur, 'НА СКЛАДАХ ПЛОЩАДКИ НОЛЬ (карточка выпадает из выдачи)', 50))
    price_cols = _table_columns(cur, schema, 'marketplace_prices')
    if price_cols and 'marketplace_item_id' in price_cols:
        cur.execute(
            f"SELECT p.marketplace_code, i.sku, i.name, p.price, p.price_before_discount, p.synced_at "
            f"FROM {schema}.marketplace_prices p "
            f"JOIN {schema}.marketplace_items i ON i.id = p.marketplace_item_id "
            f"WHERE p.marketplace_code = ANY(%s) "
            f"  AND (%s::int IS NULL OR i.shop_id = %s::int) "
            f"ORDER BY p.synced_at DESC NULLS LAST",
            (mps, sid, sid),
        )
        out.append(_rows_text(cur, 'ЦЕНЫ НА ПЛОЩАДКАХ (срез)', 40))
    out.append(
        'Чтобы разобрать конкретную карточку на площадке — what=card и query=артикул '
        '(sku / offer_id / nmID / часть названия).'
    )
    return '\n\n'.join(out)


def _ads(cur, schema, mps):
    out = []
    cur.execute(
        f"SELECT marketplace_code, period_days, ad_spend, revenue, ad_percent AS drr, calculated_at "
        f"FROM {schema}.marketplace_ad_spend "
        f"WHERE marketplace_item_id IS NULL AND marketplace_code = ANY(%s) ORDER BY marketplace_code",
        (mps,),
    )
    out.append(_rows_text(cur, 'РЕКЛАМА ИТОГО ПО ПЛОЩАДКЕ (ДРР, %)'))
    cur.execute(
        f"SELECT a.marketplace_code, i.sku, i.name, a.ad_spend, a.revenue, a.ad_percent AS drr "
        f"FROM {schema}.marketplace_ad_spend a "
        f"JOIN {schema}.marketplace_items i ON i.id = a.marketplace_item_id "
        f"WHERE a.marketplace_code = ANY(%s) AND a.ad_spend > 0 "
        f"ORDER BY a.ad_percent DESC NULLS LAST LIMIT 30",
        (mps,),
    )
    out.append(_rows_text(cur, 'ТОВАРЫ С САМЫМ ВЫСОКИМ ДРР'))
    cur.execute(
        f"SELECT marketplace_code, to_char(month, 'YYYY-MM') AS month, ad_spend, revenue, ad_percent AS drr "
        f"FROM {schema}.marketplace_ad_monthly "
        f"WHERE marketplace_code = ANY(%s) AND month >= date_trunc('month', now()) - interval '6 months' "
        f"ORDER BY marketplace_code, month",
        (mps,),
    )
    out.append(_rows_text(cur, 'ДРР ПО МЕСЯЦАМ (полгода)', 60))
    return '\n\n'.join(out)


def _attention(cur, schema, shop, mps):
    out = []
    rv_codes = []
    if 'ozon' in mps:
        rv_codes.append('OZON')
    if 'wildberries' in mps:
        rv_codes.append('WB')
    if rv_codes:
        cur.execute(
            f"SELECT marketplace, rating, product_sku, product_name, left(text, 200) AS text, review_date "
            f"FROM {schema}.reviews WHERE marketplace = ANY(%s) AND rating <= 3 "
            f"AND review_date >= now() - interval '30 days' ORDER BY review_date DESC",
            (rv_codes,),
        )
        out.append(_rows_text(cur, 'ПЛОХИЕ ОТЗЫВЫ ЗА 30 ДНЕЙ (1–3 звезды)', 30))
    cur.execute(
        f"SELECT a.marketplace_code, i.sku, i.name, a.ad_spend, a.revenue, a.ad_percent AS drr "
        f"FROM {schema}.marketplace_ad_spend a "
        f"JOIN {schema}.marketplace_items i ON i.id = a.marketplace_item_id "
        f"WHERE a.marketplace_code = ANY(%s) AND a.ad_spend > 0 "
        f"  AND (a.ad_percent >= 20 OR a.revenue = 0) "
        f"ORDER BY a.ad_spend DESC LIMIT 25",
        (mps,),
    )
    out.append(_rows_text(cur, 'РЕКЛАМА ЖЖЁТ: ДРР ≥ 20% или расход без выручки'))
    cur.execute(
        f"SELECT marketplace_code, count(*) AS zero_stock_skus FROM {schema}.marketplace_stocks "
        f"WHERE marketplace_code = ANY(%s) AND free_amount <= 0 GROUP BY marketplace_code",
        (mps,),
    )
    out.append(_rows_text(cur, 'НУЛЕВЫЕ ОСТАТКИ НА СКЛАДАХ ПЛОЩАДКИ'))
    sid = shop and shop['id']
    cur.execute(
        f"SELECT mi.shop_id, mi.marketplace_code, mi.is_enabled, (mi.credentials::text <> '{{}}') AS has_keys "
        f"FROM {schema}.marketplace_integrations mi "
        f"WHERE mi.marketplace_code = ANY(%s) AND (%s::int IS NULL OR mi.shop_id = %s::int) "
        f"  AND (NOT mi.is_enabled OR mi.credentials::text = '{{}}')",
        (mps, sid, sid),
    )
    out.append(_rows_text(cur, 'КАБИНЕТЫ НЕ ПОДКЛЮЧЕНЫ ИЛИ БЕЗ КЛЮЧЕЙ'))
    return '\n\n'.join(out)


# ---------------------------------------------------------------- площадки (только чтение)

# Белый список: (метод, хост+путь). Всё, чего тут нет, не уходит в кабинет.
READ_ENDPOINTS = {
    ('POST', OZON_API + '/v3/product/list'),
    ('POST', OZON_API + '/v3/product/info/list'),
    ('POST', OZON_API + '/v1/product/rating-by-sku'),
    ('POST', WB_CONTENT_API + '/content/v2/get/cards/list'),
    ('GET', WB_CONTENT_API + '/content/v2/cards/error/list'),
    ('GET', WB_ADVERT_API + '/adv/v1/promotion/count'),
    ('GET', YM_API + '/campaigns/{id}'),
    ('POST', YM_API + '/businesses/{id}/offer-mappings'),
    ('POST', YM_API + '/businesses/{id}/offer-cards'),
}


def _endpoint_allowed(method, url):
    base = url.split('?', 1)[0]
    norm = re.sub(r'/(campaigns|businesses)/\d+', r'/\1/{id}', base)
    return (method, norm) in READ_ENDPOINTS


def _mp_call(method, url, headers, payload=None):
    """Единственная дверь в кабинеты площадок. Проверяет белый список чтения."""
    if not _endpoint_allowed(method, url):
        return -1, 'ОТКАЗАНО: этот метод площадки не входит в список чтения'
    data = None
    if method == 'POST':
        data = json.dumps(payload or {}).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=max(3, min(MP_TIMEOUT, _time_left() - 40))) as r:
            raw = r.read().decode('utf-8', 'replace')
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')[:300]
        return e.code, raw
    except Exception as e:
        return 0, str(e)[:300]


def _ozon_photo_count(it):
    images = it.get('images') or []
    if isinstance(images, str):
        images = [images] if images else []
    n = len(images) if isinstance(images, list) else 0
    prim = it.get('primary_image')
    if prim and (prim if isinstance(prim, str) else (prim[0] if isinstance(prim, list) and prim else None)) not in images:
        n += 1
    return n


def _ozon_weak_reasons(it):
    """Чеклист OZON по ответу product/info: заголовок, фото, штрихкод, статус."""
    name = (it.get('name') or '').strip()
    img_n = _ozon_photo_count(it)
    barcodes = it.get('barcodes') or ([] if not it.get('barcode') else [it.get('barcode')])
    score = 0
    reasons = []
    if len(name) < 50:
        score += 2
        reasons.append(f'короткий title {len(name)} симв. (цель 60–120)')
    if len(name) > 200:
        score += 1
        reasons.append(f'title {len(name)} симв. — переспам')
    if name and name.upper() == name and any(ch.isalpha() for ch in name):
        score += 1
        reasons.append('title капсом')
    if img_n < 4:
        score += 2
        reasons.append(f'фото {img_n} (цель ≥5)')
    if not barcodes:
        score += 1
        reasons.append('нет штрихкода')
    if it.get('errors'):
        score += 3
        reasons.append('ошибки: ' + '; '.join(
            ((e.get('texts') or {}).get('short_description') or e.get('code') or '')[:80]
            for e in (it.get('errors') or [])[:2]))
    return score, name, reasons


def _live_ozon(creds):
    client_id = str(creds.get('clientId') or '').strip()
    api_key = str(creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return 'OZON: в CRM нет Client-Id или Api-Key'
    h = {'Client-Id': client_id, 'Api-Key': api_key}
    lines = ['OZON (живые данные кабинета):']
    url = OZON_API + '/v3/product/list'
    # Первый круг — всё параллельно: счётчики + id ошибочных + id видимых.
    jobs = [
        (vis, _mp_call, ('POST', url, h, {'filter': {'visibility': vis}, 'limit': 1, 'last_id': ''}))
        for vis in ('ALL', 'VISIBLE', 'EMPTY_STOCK')
    ]
    jobs.append(('FAILED', _mp_call, ('POST', url, h,
                 {'filter': {'visibility': 'STATE_FAILED'}, 'limit': 10, 'last_id': ''})))
    jobs.append(('VIS_LIST', _mp_call, ('POST', url, h,
                 {'filter': {'visibility': 'VISIBLE'}, 'limit': 50, 'last_id': ''})))
    r1 = _parallel(jobs, min(LIVE_BUDGET * 0.5, _time_left() - 45))

    def _total(res):
        if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
            return (res[1].get('result') or {}).get('total')
        return None

    def _ids(res):
        if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
            return [it.get('product_id') for it in (res[1].get('result') or {}).get('items') or []
                    if it.get('product_id')]
        return []

    # Повтор для тех, кому OZON отказал (429 при параллельных запросах).
    retry = [(k, f, a) for k, f, a in jobs
             if not (isinstance(r1.get(k), tuple) and r1[k][0] == 200) and _time_left() > 50]
    if retry:
        time.sleep(0.5)
        r1.update({k: v for k, v in _parallel(retry, 4).items() if v is not None})
    for key, title in (('ALL', 'всего карточек'), ('VISIBLE', 'видны покупателю'),
                       ('EMPTY_STOCK', 'нет в наличии'), ('FAILED', 'ошибка создания/модерации')):
        t = _total(r1.get(key))
        code = r1.get(key)[0] if isinstance(r1.get(key), tuple) else 'таймаут'
        lines.append(f'- {title}: {t if t is not None else f"не получено (код {code})"}')
    failed_ids = _ids(r1.get('FAILED'))
    vis_ids = _ids(r1.get('VIS_LIST'))
    # Второй круг — info по ошибочным и видимым параллельно.
    info_url = OZON_API + '/v3/product/info/list'
    jobs2 = []
    if failed_ids:
        jobs2.append(('F', _mp_call, ('POST', info_url, h, {'product_id': failed_ids[:10]})))
    if vis_ids:
        jobs2.append(('V', _mp_call, ('POST', info_url, h, {'product_id': vis_ids[:50]})))
    r2 = _parallel(jobs2, min(LIVE_BUDGET * 0.5, _time_left() - 42)) if _time_left() > 45 else {}
    res = r2.get('F')
    if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
        lines.append('Карточки с ошибкой модерации (offer_id | название | ошибки):')
        for it in (res[1].get('items') or [])[:10]:
            errs = '; '.join(
                (e.get('texts') or {}).get('short_description') or e.get('code') or ''
                for e in (it.get('errors') or [])[:3]
            )
            lines.append(f"  {it.get('offer_id')} | {(it.get('name') or '')[:80]} | {errs}")
    res = r2.get('V')
    if isinstance(res, tuple) and res[0] == 200 and isinstance(res[1], dict):
        items = res[1].get('items') or []
        weak = []
        for it in items:
            score, name, reasons = _ozon_weak_reasons(it)
            if score:
                weak.append((score, it.get('offer_id'), it.get('sku'), name[:200], ', '.join(reasons)))
        weak.sort(key=lambda x: -x[0])
        name_lens = sorted(len((it.get('name') or '')) for it in items) or [0]
        photo_ns = sorted(_ozon_photo_count(it) for it in items) or [0]
        lines.append(f'SEO-срез видимых (проверено {len(items)} из первых): '
                     f'слабых по чеклисту OZON — {len(weak)}')
        lines.append(f'  длина названия: мин {name_lens[0]}, медиана {name_lens[len(name_lens)//2]}, '
                     f'макс {name_lens[-1]}; фото: мин {photo_ns[0]}, медиана {photo_ns[len(photo_ns)//2]}, '
                     f'макс {photo_ns[-1]}')
        if weak:
            lines.append('Слабые карточки (offer_id | sku | название | что не так):')
            for _, offer, sku, name, why in weak[:15]:
                lines.append(f'  {offer} | {sku} | {name} | {why}')
        else:
            # Явных дыр нет — даём самые «бедные» по контенту, чтобы было что улучшать.
            poorest = sorted(items, key=lambda it: (_ozon_photo_count(it), len(it.get('name') or '')))[:8]
            lines.append('Явных провалов нет. Наименее наполненные (offer_id | sku | фото | длина назв. | название):')
            for it in poorest:
                lines.append(f"  {it.get('offer_id')} | {it.get('sku')} | {_ozon_photo_count(it)} | "
                             f"{len(it.get('name') or '')} | {(it.get('name') or '')[:200]}")
        lines.append('  (рейтинг контента, описание и атрибуты в этом срезе не читаются — '
                     'для них разберите конкретную карточку)')
    elif vis_ids:
        lines.append('SEO-срез видимых: OZON не ответил вовремя — повторите вопрос.')
    return '\n'.join(lines)


def _live_wb(creds):
    api_key = str(creds.get('apiKey') or '').strip()
    if not api_key:
        return 'Wildberries: в CRM нет токена'
    if creds.get('useSandbox'):
        return 'Wildberries: в CRM включена песочница — живой кабинет не читаем'
    h = {'Authorization': api_key}
    lines = ['Wildberries (живые данные кабинета):']
    r = _parallel([
        ('cards', _mp_call, ('POST', WB_CONTENT_API + '/content/v2/get/cards/list', h,
                             {'settings': {'cursor': {'limit': 100}, 'filter': {'withPhoto': -1}}})),
        ('errs', _mp_call, ('GET', WB_CONTENT_API + '/content/v2/cards/error/list', h)),
        ('adv', _mp_call, ('GET', WB_ADVERT_API + '/adv/v1/promotion/count', h)),
    ], LIVE_BUDGET - 1)
    st, data = r.get('cards') if isinstance(r.get('cards'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        cards = data.get('cards') or []
        total = (data.get('cursor') or {}).get('total')
        no_photo = [c for c in cards if not c.get('photos')]
        short_title = [c for c in cards if len((c.get('title') or '')) < 20]
        no_descr = [c for c in cards if len((c.get('description') or '')) < 300]
        lines.append(f'- карточек в первой выборке: {len(cards)} (всего по курсору: {total})')
        lines.append(f'- без фото: {len(no_photo)}')
        lines.append(f'- короткий заголовок (<20 симв.): {len(short_title)}')
        lines.append(f'- короткое описание (<300 симв.): {len(no_descr)}')
        for c in (no_photo + short_title + no_descr)[:12]:
            lines.append(f"  {c.get('vendorCode')} | nmID {c.get('nmID')} | {(c.get('title') or '')[:70]}")
    else:
        lines.append(f'- карточки: не получено (код {st})')
    st, data = r.get('errs') if isinstance(r.get('errs'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        errs = data.get('data') or []
        lines.append(f'- несозданные карточки с ошибками: {len(errs)}')
        for e in errs[:10]:
            lines.append(f"  {e.get('vendorCode')} | {'; '.join((e.get('errors') or [])[:2])[:160]}")
    else:
        lines.append(f'- ошибки карточек: не получено (код {st})')
    st, data = r.get('adv') if isinstance(r.get('adv'), tuple) else (0, 'нет ответа')
    status_names = {4: 'готова к запуску', 7: 'завершена', 8: 'отказ', 9: 'идёт показ', 11: 'на паузе', -1: 'удаляется'}
    if st == 200 and isinstance(data, dict):
        lines.append(f"- рекламных кампаний всего: {data.get('all')}")
        for g in data.get('adverts') or []:
            lines.append(f"  статус «{status_names.get(g.get('status'), g.get('status'))}»: {g.get('count')}")
    else:
        lines.append(f'- реклама: не получено (код {st}; возможно, у токена нет доступа к «Продвижению»)')
    return '\n'.join(lines)


def _live_ym(creds):
    api_key = str(creds.get('apiKey') or '').strip()
    campaign_id = str(creds.get('campaignId') or '').strip()
    if not api_key or not campaign_id.isdigit():
        return 'Яндекс Маркет: в CRM нет Api-Key или номера кампании'
    h = {'Api-Key': api_key}
    lines = ['Яндекс Маркет (живые данные кабинета):']
    st, camp = _mp_call('GET', f'{YM_API}/campaigns/{campaign_id}', h)
    business_id = None
    if st == 200 and isinstance(camp, dict):
        c = camp.get('campaign') or {}
        business_id = (c.get('business') or {}).get('id')
        lines.append(f"- магазин: {c.get('domain') or ''}, модель: {c.get('placementType') or ''}")
    else:
        return f'Яндекс Маркет: кампания не прочиталась (код {st})'
    if not business_id:
        return '\n'.join(lines + ['- кабинет (business) не определён'])
    bid = int(business_id)
    r = _parallel([
        ('maps', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-mappings?limit=100', h, {})),
        ('cards', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-cards?limit=100', h, {})),
    ], LIVE_BUDGET - 4)
    st, data = r.get('maps') if isinstance(r.get('maps'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        maps = (data.get('result') or {}).get('offerMappings') or []
        rejected = [m for m in maps if m.get('rejectedMapping')]
        awaiting = [m for m in maps if m.get('awaitingModerationMapping')]
        no_card = [m for m in maps if not m.get('mapping')]
        lines.append(f'- товаров в первой выборке: {len(maps)}')
        lines.append(f'- без карточки Маркета: {len(no_card)}, на модерации: {len(awaiting)}, отклонено: {len(rejected)}')
        for m in (rejected + no_card)[:10]:
            o = m.get('offer') or {}
            lines.append(f"  {o.get('offerId')} | {(o.get('name') or '')[:80]}")
    else:
        lines.append(f'- каталог: не получено (код {st})')
    st, data = r.get('cards') if isinstance(r.get('cards'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        cards = (data.get('result') or {}).get('offerCards') or []
        weak = sorted(
            [c for c in cards if c.get('contentRating') is not None],
            key=lambda c: c.get('contentRating') or 0,
        )
        with_err = [c for c in cards if c.get('errors')]
        lines.append(f'- карточек с ошибками: {len(with_err)}')
        if weak:
            lines.append('- самый низкий рейтинг контента (offerId | рейтинг):')
            for c in weak[:10]:
                lines.append(f"  {c.get('offerId')} | {c.get('contentRating')}")
    else:
        lines.append(f'- качество карточек: не получено (код {st})')
    return '\n'.join(lines)


def _scrub(text, secrets):
    for s in secrets:
        if s and len(s) >= 6:
            text = text.replace(s, '***')
    return text


def _live(cur, schema, shop, mps):
    """Обход кабинетов: все магазины × площадки параллельно, общий бюджет LIVE_BUDGET."""
    shops = [shop] if shop else _shops(cur, schema)
    fns = {'ozon': _live_ozon, 'wildberries': _live_wb, 'yandex_market': _live_ym}
    slots = []
    jobs = []
    for s in shops:
        for mp in mps:
            creds, enabled = _load_creds(cur, schema, mp, s['id'])
            key = (s['id'], mp)
            if not creds:
                slots.append((s, mp, f'{MP_TITLES[mp]}: кабинет не подключён в CRM', None))
            elif not enabled:
                slots.append((s, mp, f'{MP_TITLES[mp]}: интеграция выключена в CRM — не читаем', None))
            else:
                slots.append((s, mp, None, creds))
                jobs.append((key, fns[mp], (creds,)))
    res = _parallel(jobs, min(LIVE_BUDGET, _time_left() - 40))
    out = []
    cur_shop = None
    for s, mp, text, creds in slots:
        if cur_shop != s['id']:
            out.append(f"=== Магазин {s['name']} (shop_id {s['id']}) ===")
            cur_shop = s['id']
        if creds is None:
            out.append(text)
            continue
        txt = res.get((s['id'], mp))
        if txt is None:
            txt = f'{MP_TITLES[mp]}: кабинет не ответил за {LIVE_BUDGET} с — повторите вопрос'
        elif isinstance(txt, Exception):
            txt = f'{MP_TITLES[mp]}: ошибка чтения ({str(txt)[:150]})'
        secrets = [str(v) for v in creds.values() if isinstance(v, (str, int))]
        out.append(_scrub(txt, secrets))
    return '\n\n'.join(out)


def _find_items(cur, schema, shop, query):
    """Ищет карточки в нашем справочнике по sku / ozon / wb / ym / названию."""
    q = (query or '').strip()
    if not q:
        return []
    cols = _table_columns(cur, schema, 'marketplace_items')
    sid = shop and shop['id']
    ym_select = "i.ym_sku" if 'ym_sku' in cols else "NULL::text AS ym_sku"
    like = f'%{q}%'
    nm = None
    if q.isdigit():
        try:
            nm = int(q)
        except ValueError:
            nm = None
    where = [
        "(%s::int IS NULL OR i.shop_id = %s::int)",
        "(i.sku ILIKE %s OR i.name ILIKE %s OR COALESCE(i.ozon_sku,'') ILIKE %s "
        "OR COALESCE(i.wb_sku,'') ILIKE %s OR COALESCE(i.barcode,'') ILIKE %s",
    ]
    params = [sid, sid, like, like, like, like, like]
    if 'ym_sku' in cols:
        where[1] += " OR COALESCE(i.ym_sku,'') ILIKE %s"
        params.append(like)
    if nm is not None:
        where[1] += " OR i.wb_nm_id = %s"
        params.append(nm)
    where[1] += ")"
    params.extend([q, q, q])
    cur.execute(
        f"SELECT i.id, s.name AS shop, i.shop_id, i.sku, i.name, i.width, i.height, i.material, "
        f"  i.ozon_sku, i.wb_nm_id, i.wb_sku, {ym_select}, i.barcode "
        f"FROM {schema}.marketplace_items i LEFT JOIN {schema}.shops s ON s.id = i.shop_id "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY "
        f"  CASE WHEN i.sku = %s THEN 0 WHEN i.ozon_sku = %s THEN 1 "
        f"       WHEN CAST(i.wb_nm_id AS text) = %s THEN 2 ELSE 3 END, i.id DESC "
        f"LIMIT 12",
        params,
    )
    cols_out = [d[0] for d in cur.description]
    return [dict(zip(cols_out, r)) for r in cur.fetchall()]


def _ozon_card_lines(item):
    """Разбор одной карточки OZON из product/info — SEO и модерация."""
    name = (item.get('name') or '').strip()
    offer = (item.get('offer_id') or '').strip()
    sku = item.get('sku') or item.get('fbo_sku') or item.get('fbs_sku') or ''
    barcodes = item.get('barcodes') or ([] if not item.get('barcode') else [item.get('barcode')])
    images = item.get('images') or item.get('primary_image') or []
    if isinstance(images, str):
        images = [images] if images else []
    img_n = len(images) if isinstance(images, list) else (1 if images else 0)
    descr = (item.get('description') or item.get('rich_content_json') or '')
    if isinstance(descr, dict):
        descr = json.dumps(descr, ensure_ascii=False)
    descr = str(descr or '')
    attrs = item.get('attributes') or []
    errs = item.get('errors') or []
    status = item.get('statuses') or item.get('status') or {}
    issues = []
    if len(name) < 40:
        issues.append(f'короткий заголовок ({len(name)} симв., лучше ≥60)')
    if len(name) > 150:
        issues.append(f'очень длинный заголовок ({len(name)} симв.)')
    if img_n < 3:
        issues.append(f'мало фото ({img_n}, желательно ≥5)')
    if not barcodes:
        issues.append('нет штрихкода')
    has_descr = 'description' in item or 'rich_content_json' in item
    has_attrs = 'attributes' in item
    if has_descr and len(descr) < 200:
        issues.append(f'короткое описание ({len(descr)} симв.)')
    if has_attrs and isinstance(attrs, list) and len(attrs) < 5:
        issues.append(f'мало характеристик ({len(attrs)})')
    if errs:
        issues.append('ошибки модерации/контента: ' + '; '.join(
            ((e.get('texts') or {}).get('short_description') or e.get('code') or str(e))[:120]
            for e in errs[:4]
        ))
    lines = [
        f"OZON live: offer_id={offer} | sku={sku} | название ({len(name)}): {name[:160]}",
        f"  фото≈{img_n}, штрихкодов={len(barcodes) if isinstance(barcodes, list) else 0}, "
        f"атрибуты: {len(attrs) if has_attrs else 'НЕ ЧИТАЮТСЯ этим методом API (не значит, что пусто)'}, "
        f"описание: {str(len(descr)) + ' симв.' if has_descr else 'НЕ ЧИТАЕТСЯ этим методом API (не значит, что пусто)'}; "
        f"заполненность характеристик/описания смотри по группам рейтинга контента ниже",
    ]
    if status:
        lines.append(f"  статус: {json.dumps(status, ensure_ascii=False)[:240]}")
    if issues:
        lines.append('  SEO/качество: ' + '; '.join(issues))
    else:
        lines.append('  SEO/качество: явных дыр в ответе API не видно')
    return lines


def _rating_groups_text(g):
    """Компактно: группа рейтинг/вес и невыполненные условия — это и есть чеклист OZON."""
    parts = []
    for grp in (g.get('groups') or [])[:6]:
        miss = [c.get('description') for c in (grp.get('conditions') or [])
                if not c.get('fulfilled') and c.get('description')]
        txt = f"{grp.get('name')} {grp.get('rating')}/100 (вес {grp.get('weight')}%)"
        if miss:
            txt += ' — не выполнено: ' + '; '.join(m[:70] for m in miss[:4])
        parts.append(txt)
    return ' | '.join(parts) or json.dumps(g, ensure_ascii=False)[:300]


def _card_live_ozon(creds, item_row, query):
    client_id = str(creds.get('clientId') or '').strip()
    api_key = str(creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return ['OZON: в CRM нет Client-Id или Api-Key']
    h = {'Client-Id': client_id, 'Api-Key': api_key}
    offer_ids = []
    skus = []
    if item_row:
        if item_row.get('sku'):
            offer_ids.append(str(item_row['sku']))
        if item_row.get('ozon_sku'):
            skus.append(str(item_row['ozon_sku']))
    q = (query or '').strip()
    if q:
        offer_ids.append(q)
        if q.isdigit():
            skus.append(q)
    offer_ids = list(dict.fromkeys([x for x in offer_ids if x]))[:20]
    skus = list(dict.fromkeys([x for x in skus if x]))[:20]
    lines = []
    if not offer_ids and not skus:
        return ['OZON: нечего искать — нужен артикул (offer_id) или sku']
    info_url = OZON_API + '/v3/product/info/list'
    jobs = []
    if offer_ids:
        jobs.append(('offer', _mp_call, ('POST', info_url, h, {'offer_id': offer_ids})))
    sku_int = [int(x) for x in skus if str(x).isdigit()][:20]
    if sku_int:
        jobs.append(('sku', _mp_call, ('POST', info_url, h, {'sku': sku_int})))
    r = _parallel(jobs, min(LIVE_BUDGET * 0.6, _time_left() - 42))
    items = []
    st = 0
    seen = set()
    for key in ('offer', 'sku'):
        res = r.get(key)
        if isinstance(res, tuple):
            st = res[0] if not items else st
            if res[0] == 200 and isinstance(res[1], dict):
                for it in res[1].get('items') or (res[1].get('result') or {}).get('items') or []:
                    pid = it.get('id') or it.get('product_id') or it.get('offer_id')
                    if pid not in seen:
                        seen.add(pid)
                        items.append(it)
    if not items:
        return [f'OZON: карточка не найдена в кабинете (код {st}). Проверьте артикул и магазин.']
    for it in items[:5]:
        lines.extend(_ozon_card_lines(it))
    # Контент-рейтинг по sku, если есть.
    rating_skus = []
    for it in items[:10]:
        s = it.get('sku') or it.get('fbo_sku') or it.get('fbs_sku')
        if s:
            try:
                rating_skus.append(int(s))
            except (TypeError, ValueError):
                pass
    if rating_skus and _time_left() >= 45:
        st, rating = _mp_call(
            'POST', OZON_API + '/v1/product/rating-by-sku', h, {'skus': rating_skus[:10]},
        )
        if st == 200 and isinstance(rating, dict):
            for g in (rating.get('products') or rating.get('result') or [])[:5]:
                lines.append(
                    f"  рейтинг контента OZON sku={g.get('sku')}: {g.get('rating')} "
                    f"(группы: {_rating_groups_text(g)})"
                )
        else:
            lines.append(f'  рейтинг контента: не получен (код {st})')
    elif rating_skus:
        lines.append('  рейтинг контента: пропуск (мало времени на ответ)')
    return lines


def _card_live_wb(creds, item_row, query):
    api_key = str(creds.get('apiKey') or '').strip()
    if not api_key:
        return ['Wildberries: в CRM нет токена']
    if creds.get('useSandbox'):
        return ['Wildberries: в CRM включена песочница — живой кабинет не читаем']
    h = {'Authorization': api_key}
    search = (query or '').strip()
    if item_row and item_row.get('sku'):
        search = str(item_row['sku'])
    nm = item_row.get('wb_nm_id') if item_row else None
    if not nm and search.isdigit() and len(search) >= 6:
        nm = int(search)
    if nm:
        search = str(nm)  # textSearch WB ищет и по nmID, и по vendorCode
    lines = []
    payload = {
        'settings': {
            'cursor': {'limit': 100},
            'filter': {'withPhoto': -1},
        },
    }
    if search:
        payload['settings']['filter']['textSearch'] = search
    st, data = _mp_call('POST', WB_CONTENT_API + '/content/v2/get/cards/list', h, payload)
    cards = []
    if st == 200 and isinstance(data, dict):
        cards = data.get('cards') or []
    if nm and cards:
        cards = [c for c in cards if c.get('nmID') == nm] or cards
    elif nm and not cards:
        # Повтор без textSearch — ищем nmID в первой сотне (редко, но лучше чем пусто).
        st2, data2 = _mp_call(
            'POST', WB_CONTENT_API + '/content/v2/get/cards/list', h,
            {'settings': {'cursor': {'limit': 100}, 'filter': {'withPhoto': -1}}},
        )
        if st2 == 200 and isinstance(data2, dict):
            cards = [c for c in (data2.get('cards') or []) if c.get('nmID') == nm]
    if not cards:
        return [f'Wildberries: карточка не найдена (код {st}). Проверьте vendorCode / nmID.']
    for c in cards[:5]:
        title = (c.get('title') or '').strip()
        descr = (c.get('description') or '').strip()
        photos = c.get('photos') or []
        chars = c.get('characteristics') or []
        sizes = c.get('sizes') or []
        issues = []
        if len(title) < 40:
            issues.append(f'короткий заголовок ({len(title)})')
        if len(descr) < 300:
            issues.append(f'короткое описание ({len(descr)})')
        if not photos:
            issues.append('нет фото')
        elif len(photos) < 3:
            issues.append(f'мало фото ({len(photos)})')
        if len(chars) < 5:
            issues.append(f'мало характеристик ({len(chars)})')
        lines.append(
            f"WB live: vendorCode={c.get('vendorCode')} | nmID={c.get('nmID')} | "
            f"название ({len(title)}): {title[:160]}"
        )
        lines.append(
            f"  фото={len(photos)}, описание={len(descr)} симв., "
            f"характеристик={len(chars)}, размеров={len(sizes)}"
        )
        if issues:
            lines.append('  SEO/качество: ' + '; '.join(issues))
        else:
            lines.append('  SEO/качество: явных дыр в ответе API не видно')
        # Короткий срез характеристик — менеджеру видно, что заполнено.
        for ch in chars[:8]:
            val = ch.get('value')
            if isinstance(val, (list, tuple)):
                val = ', '.join(str(v) for v in val)
            lines.append(f"  · {(ch.get('name') or '')}: {'' if val is None else val}"[:180])
    return lines


def _card_live_ym(creds, item_row, query):
    api_key = str(creds.get('apiKey') or '').strip()
    campaign_id = str(creds.get('campaignId') or '').strip()
    if not api_key or not campaign_id.isdigit():
        return ['Яндекс Маркет: в CRM нет Api-Key или номера кампании']
    h = {'Api-Key': api_key}
    st, camp = _mp_call('GET', f'{YM_API}/campaigns/{campaign_id}', h)
    if st != 200 or not isinstance(camp, dict):
        return [f'Яндекс Маркет: кампания не прочиталась (код {st})']
    business_id = ((camp.get('campaign') or {}).get('business') or {}).get('id')
    if not business_id:
        return ['Яндекс Маркет: business id не определён']
    offer_ids = []
    if item_row and item_row.get('sku'):
        offer_ids.append(str(item_row['sku']))
    if item_row and item_row.get('ym_sku'):
        offer_ids.append(str(item_row['ym_sku']))
    q = (query or '').strip()
    if q:
        offer_ids.append(q)
    offer_ids = list(dict.fromkeys([x for x in offer_ids if x]))[:20]
    payload = {'offerIds': offer_ids} if offer_ids else {}
    lines = []
    bid = int(business_id)
    r = _parallel([
        ('maps', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-mappings?limit=20', h, payload)),
        ('cards', _mp_call, ('POST', f'{YM_API}/businesses/{bid}/offer-cards?limit=20', h, payload)),
    ], LIVE_BUDGET - 4)
    st, data = r.get('maps') if isinstance(r.get('maps'), tuple) else (0, 'нет ответа')
    maps = []
    if st == 200 and isinstance(data, dict):
        maps = (data.get('result') or {}).get('offerMappings') or []
    if not maps:
        lines.append(f'Яндекс Маркет: offer-mappings пусто (код {st})')
    for m in maps[:5]:
        o = m.get('offer') or {}
        lines.append(
            f"YM live: offerId={o.get('offerId')} | {(o.get('name') or '')[:120]} | "
            f"mapping={'есть' if m.get('mapping') else 'нет'} | "
            f"модерация={'ждёт' if m.get('awaitingModerationMapping') else 'нет'} | "
            f"reject={'да' if m.get('rejectedMapping') else 'нет'}"
        )
    st, data = r.get('cards') if isinstance(r.get('cards'), tuple) else (0, 'нет ответа')
    if st == 200 and isinstance(data, dict):
        for c in ((data.get('result') or {}).get('offerCards') or [])[:5]:
            errs = c.get('errors') or []
            lines.append(
                f"  карточка offerId={c.get('offerId')} | contentRating={c.get('contentRating')} | "
                f"ошибок={len(errs)}"
            )
            for e in errs[:3]:
                lines.append(f"    ! {json.dumps(e, ensure_ascii=False)[:200]}")
    else:
        lines.append(f'  качество карточек YM: не получено (код {st})')
    return lines or ['Яндекс Маркет: карточка не найдена']


def _card_context(cur, schema, item_row, mps):
    """Остатки, цены, реклама, отзывы по найденной карточке из нашей базы."""
    if not item_row:
        return []
    lines = []
    sku = str(item_row.get('sku') or '')
    ozon = str(item_row.get('ozon_sku') or '')
    nm = item_row.get('wb_nm_id')
    lines.append(
        f"Из CRM: id={item_row.get('id')} | магазин={item_row.get('shop')} | "
        f"sku={sku} | {item_row.get('name')} | "
        f"{item_row.get('width')}×{item_row.get('height')} | материал={item_row.get('material')}"
    )
    lines.append(
        f"  привязки: ozon_sku={ozon or '—'} | wb_nm_id={nm or '—'} | "
        f"wb_sku={item_row.get('wb_sku') or '—'} | ym_sku={item_row.get('ym_sku') or '—'} | "
        f"barcode={item_row.get('barcode') or '—'}"
    )
    keys = [k for k in (sku, ozon, str(nm) if nm else '') if k]
    if keys:
        cur.execute(
            f"SELECT marketplace_code, sku, offer_id, product_name, free_amount, reserved_amount, synced_at "
            f"FROM {schema}.marketplace_stocks "
            f"WHERE marketplace_code = ANY(%s) AND (sku = ANY(%s) OR offer_id = ANY(%s)) "
            f"ORDER BY synced_at DESC NULLS LAST LIMIT 20",
            (mps, keys, keys),
        )
        lines.append(_rows_text(cur, 'ОСТАТКИ НА ПЛОЩАДКЕ', 20))
        if _table_columns(cur, schema, 'marketplace_prices'):
            cur.execute(
                f"SELECT p.marketplace_code, p.price, p.price_before_discount, "
                f"  p.price_with_marketplace_discount, p.synced_at "
                f"FROM {schema}.marketplace_prices p "
                f"WHERE p.marketplace_item_id = %s AND p.marketplace_code = ANY(%s) "
                f"ORDER BY p.synced_at DESC NULLS LAST LIMIT 20",
                (item_row.get('id'), mps),
            )
            lines.append(_rows_text(cur, 'ЦЕНЫ', 20))
        cur.execute(
            f"SELECT a.marketplace_code, a.ad_spend, a.revenue, a.ad_percent AS drr, a.period_days "
            f"FROM {schema}.marketplace_ad_spend a "
            f"WHERE a.marketplace_item_id = %s",
            (item_row.get('id'),),
        )
        lines.append(_rows_text(cur, 'РЕКЛАМА ПО ЭТОЙ КАРТОЧКЕ', 10))
        rv_codes = []
        if 'ozon' in mps:
            rv_codes.append('OZON')
        if 'wildberries' in mps:
            rv_codes.append('WB')
        if rv_codes:
            cur.execute(
                f"SELECT marketplace, rating, product_sku, left(text, 180) AS text, review_date "
                f"FROM {schema}.reviews "
                f"WHERE marketplace = ANY(%s) AND ("
                f"  product_sku = ANY(%s) OR product_sku = %s OR product_sku = %s"
                f") ORDER BY review_date DESC LIMIT 15",
                (rv_codes, keys, sku, ozon),
            )
            lines.append(_rows_text(cur, 'ОТЗЫВЫ ПО КАРТОЧКЕ', 15))
    return lines


def _card_analyze(dsn, schema, shop, mps, query):
    """Разбор конкретной карточки: справочник CRM + живой кабинет площадки."""
    q = (query or '').strip()
    if not q:
        return (
            'Укажите query: артикул (sku), offer_id OZON, nmID WB, ym offerId '
            'или часть названия товара.'
        )
    conn = _ro_conn(dsn)
    try:
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 8000")
        items = _find_items(cur, schema, shop, q)
        out = [f'ЗАПРОС КАРТОЧКИ: «{q}»']
        if not items:
            out.append('В справочнике CRM точного совпадения нет — ищу только в живых кабинетах.')
        else:
            out.append(f'Найдено в CRM: {len(items)}')
        # Живой кабинет — только по лучшему совпадению (укладываемся в шлюз);
        # остальные совпадения перечисляем, чтобы менеджер уточнил артикул.
        targets = items[:1] if items else [None]
        if len(items) > 1:
            out.append('Другие совпадения в CRM (sku | название | магазин): ' + '; '.join(
                f"{r.get('sku')} | {(r.get('name') or '')[:50]} | {r.get('shop')}" for r in items[1:6]))
        shops = [shop] if shop else _shops(cur, schema)
        for item_row in targets:
            if item_row:
                out.extend(_card_context(cur, schema, item_row, mps))
                shop_id = item_row.get('shop_id')
                shop_loop = [s for s in shops if s['id'] == shop_id] or shops
                # Только площадки, куда карточка реально привязана — быстрее и точнее.
                bound = []
                if item_row.get('ozon_sku') and 'ozon' in mps:
                    bound.append('ozon')
                if (item_row.get('wb_nm_id') or item_row.get('wb_sku')) and 'wildberries' in mps:
                    bound.append('wildberries')
                if item_row.get('ym_sku') and 'yandex_market' in mps:
                    bound.append('yandex_market')
                use_mps = bound or list(mps)
            else:
                shop_loop = shops[:1]  # без CRM-попадания не обходим все магазины
                use_mps = list(mps)[:1] if len(mps) > 1 else list(mps)
            fns = {'ozon': _card_live_ozon, 'wildberries': _card_live_wb, 'yandex_market': _card_live_ym}
            s = shop_loop[0] if shop_loop else None
            if s is None:
                out.append('Живой кабинет: нет активных магазинов.')
                continue
            out.append(f"--- Живой кабинет: {s['name']} (shop_id {s['id']}) ---")
            jobs, creds_map = [], {}
            for mp in use_mps:
                creds, enabled = _load_creds(cur, schema, mp, s['id'])
                if not creds or not enabled:
                    out.append(f'{MP_TITLES[mp]}: нет ключей или выключено')
                    continue
                creds_map[mp] = creds
                jobs.append((mp, fns[mp], (creds, item_row, q)))
            res = _parallel(jobs, min(LIVE_BUDGET, _time_left() - 40))
            for mp, creds in creds_map.items():
                lines = res.get(mp)
                if lines is None:
                    lines = [f'{MP_TITLES[mp]}: кабинет не ответил за {LIVE_BUDGET} с']
                elif isinstance(lines, Exception):
                    lines = [f'{MP_TITLES[mp]}: ошибка ({str(lines)[:150]})']
                secrets = [str(v) for v in creds.values() if isinstance(v, (str, int))]
                out.append(_scrub('\n'.join(lines), secrets))
        out.append(
            'Формат ответа: разбор по чеклисту площадки из инструкции (каждый пункт: ✅/⚠️/❌ + '
            'факт из данных), коммерция, приоритетный план правок руками в кабинете.'
        )
        return '\n'.join(out)
    except Exception as e:
        return f'Не удалось разобрать карточку: {str(e)[:300]}'
    finally:
        conn.close()


def _cabinet_read(dsn, schema, args):
    what = (args.get('what') or 'overview').strip().lower()
    mps = _mp_list(args.get('marketplace'))
    query = (args.get('query') or args.get('sku') or args.get('offer_id') or '').strip()
    if what == 'card':
        shop = None
        conn = _ro_conn(dsn)
        try:
            cur = conn.cursor()
            shop = _resolve_shop(cur, schema, args.get('shop_id'))
        finally:
            conn.close()
        if shop == 'unknown':
            return 'Магазин не найден. Возьмите shop_id из what=overview.'
        return _card_analyze(dsn, schema, shop, mps, query)
    conn = _ro_conn(dsn)
    try:
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 8000")
        shop = _resolve_shop(cur, schema, args.get('shop_id'))
        if shop == 'unknown':
            return 'Магазин не найден. Возьмите shop_id из what=overview.'
        if what == 'overview':
            return _overview(cur, schema, shop)
        if what == 'listings':
            return _listings(cur, schema, shop, mps)
        if what == 'ads':
            return _ads(cur, schema, mps)
        if what == 'attention':
            return _attention(cur, schema, shop, mps)
        if what == 'live':
            return _live(cur, schema, shop, mps)
        return (
            'Неизвестный what. Допустимо: overview | listings | ads | attention | live | card'
        )
    except Exception as e:
        return f'Не удалось прочитать данные: {str(e)[:300]}'
    finally:
        conn.close()


# ---------------------------------------------------------------- официальные справки

def _host_is_private(host):
    if not host or host in ('localhost',) or host.endswith('.local') or host.endswith('.internal'):
        return True
    try:
        ipaddress.ip_address(host)
        return True  # голые IP (внутренние и любые другие) не открываем
    except ValueError:
        return False


def _url_allowed(url):
    try:
        p = urllib.parse.urlparse(url)
    except Exception:
        return False
    if p.scheme not in ('http', 'https'):
        return False
    host = (p.hostname or '').lower()
    if _host_is_private(host) or p.port not in (None, 80, 443):
        return False
    for d in ALLOWED_DOMAINS:
        if host == d or host.endswith('.' + d):
            return True
    if host == YANDEX_SUPPORT_HOST and (p.path or '').startswith(YANDEX_SUPPORT_PATH):
        return True
    return False


def _http_get(url, timeout=12):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; MegatulMarketplace/1.0)',
        'Accept': 'text/plain, text/html;q=0.9, */*;q=0.8',
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()[:80000].decode('utf-8', 'ignore')


def _strip_tags(text):
    text = re.sub(r'(?is)<script.*?>.*?</script>', ' ', text)
    text = re.sub(r'(?is)<style.*?>.*?</style>', ' ', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', html_lib.unescape(text)).strip()


def _web_search(query):
    q = (query or '').strip()[:200]
    if not q:
        return 'Пустой поисковый запрос'
    sites = re.findall(r'site:(\S+)', q, re.I)
    if not sites:
        return ('ОТКАЗАНО: добавьте site: — разрешены только ' + ', '.join(ALLOWED_SITE_TOKENS))
    for s in sites:
        s = s.lower().rstrip('/')
        if s not in ALLOWED_SITE_TOKENS:
            return f'ОТКАЗАНО: site:{s} не официальная справка площадки'
    try:
        body = urllib.parse.urlencode({'q': q, 'kl': 'ru-ru'}).encode('utf-8')
        req = urllib.request.Request(
            'https://html.duckduckgo.com/html/', data=body,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; MegatulMarketplace/1.0)',
                     'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            page = r.read()[:120000].decode('utf-8', 'ignore')
        blocks = re.findall(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</(?:a|td|span)',
            page, re.S | re.I,
        )
        items = []
        for href, title, snip in blocks:
            href = html_lib.unescape(href)
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            if qs.get('uddg'):
                href = qs['uddg'][0]
            if href.startswith('//'):
                href = 'https:' + href
            if not _url_allowed(href):
                continue
            items.append(f'{_strip_tags(title)}\n{_strip_tags(snip)}\n{href}')
            if len(items) >= 8:
                break
        if items:
            return '\n\n'.join(items)[:MAX_TOOL_CHARS]
        return 'В официальных справках ничего не нашлось. Переформулируйте запрос.'
    except Exception as e:
        return f'Поиск сейчас недоступен: {e}'


def _fetch_doc(url, limit=9000, timeout=8):
    """Текст официальной страницы без меню и скриптов. Пусто — если закрыта (антибот OZON)."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                          '(KHTML, like Gecko) Chrome/126 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ru-RU,ru;q=0.9',
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(3_500_000).decode('utf-8', 'ignore')
    except Exception:
        return ''
    if 'Antibot' in raw[:20000] or 'enable JavaScript' in raw[:20000]:
        return ''
    m = re.search(r'(?is)<title>(.*?)</title>', raw)
    title = _strip_tags(m.group(1)) if m else ''
    body = re.sub(r'(?is)<(script|style|nav|header|footer|aside|svg|noscript)\b.*?</\1>', ' ', raw)
    main = re.search(r'(?is)<(main|article)\b.*?</\1>', body)
    text = _strip_tags(main.group(0) if main else body)
    # WB: сначала идёт длинное меню справки — режем до заголовка страницы
    if title:
        head = title.split('|')[0].strip()
        i = text.find(head, 0)
        j = text.find(head, i + len(head)) if i >= 0 else -1
        if j > 0 and j < len(text) - 200:
            text = text[j:]
        elif i > 0:
            text = text[i:]
    text = text.strip()
    if len(text) < 200:
        return ''
    return (f'{title}\n{url}\n\n' + text)[:limit]


def _doc_search_items(query, max_items=5):
    """[(title, snippet, url)] из официальных справок через поиск."""
    try:
        body = urllib.parse.urlencode({'q': query[:200], 'kl': 'ru-ru'}).encode('utf-8')
        req = urllib.request.Request(
            'https://html.duckduckgo.com/html/', data=body,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; MegatulMarketplace/1.0)',
                     'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(req, timeout=6) as r:
            page = r.read()[:150000].decode('utf-8', 'ignore')
    except Exception:
        return []
    out = []
    for href, title, snip in re.findall(
        r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</(?:a|td|span)',
        page, re.S | re.I,
    ):
        href = html_lib.unescape(href)
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        if qs.get('uddg'):
            href = qs['uddg'][0]
        if href.startswith('//'):
            href = 'https:' + href
        href = href.replace('://m.yandex.ru/', '://yandex.ru/').split('#')[0]
        if href.endswith('.md'):
            href = href[:-3]
        if not _url_allowed(href) or any(href == o[2] for o in out):
            continue
        out.append((_strip_tags(title), _strip_tags(snip), href))
        if len(out) >= max_items:
            break
    return out


_DOC_SITES = {
    'ozon': 'site:docs.ozon.ru',
    'wildberries': 'site:seller.wildberries.ru',
    'yandex_market': 'site:yandex.ru/support/marketplace',
}
_RULES_INTENT = re.compile(
    r'правил|требован|модерац|лимит|сколько символ|длин|фото|изображен|инфограф|видео|'
    r'заголов|назван|описан|характерист|атрибут|категор|fbo|fbs|fbw|dbs|fby|упаков|маркиров|'
    r'при[её]мк|поставк|комисси|тариф|логистик|хранен|акци|продвиж|реклам|отзыв|рейтинг|'
    r'штрихкод|баркод|склейк|возврат|выкуп|штраф|можно ли|разрешен|запрещ|как (добавить|создать|загрузить)',
    re.I,
)


# Индекс официальных страниц (заголовок → url), собран из sitemap WB и llms.txt Маркета.
# OZON закрыт антиботом — для него только точки входа.
_DOCS_INDEX = None
_OZON_HUBS = [
    ('База знаний продавца OZON', 'https://docs.ozon.ru/global/'),
    ('Образовательный центр OZON', 'https://seller-edu.ozon.ru/libra/how-to-start'),
]
_STOP = set('как что где для при или это его она они ли не на по из от до за без над под the and '
            'можно нужно какие какой какая каких сколько товар товары товара товаров карточк '
            'ozon озон wildberries вайлдберриз яндекс маркет маркета маркете маркетплейс '
            'продавец продавца продавцов работ правил требован'.split())
_SYN = {
    'фото': 'изобр фотог медиа какие', 'фотки': 'изобр фотог', 'картин': 'изобр',
    'назван': 'наиме назва загол созда соста', 'заголо': 'наиме назва соста', 'наимен': 'назва',
    'символ': 'наиме назва длина созда', 'описан': 'описа контен созда', 'характ': 'харак парам атриб',
    'атриб': 'харак парам', 'отзыв': 'отзыв оценк', 'модер': 'модер прове ошибк отклон',
    'ошибк': 'ошибк отклон', 'остат': 'остат склад', 'постав': 'поста приём приемк',
    'упаков': 'упако марки', 'реклам': 'продв рекла', 'продви': 'продв рекла буст',
    'комисс': 'тариф комис стоим', 'тариф': 'тариф комис стоим', 'акци': 'акция скидк',
    'скидк': 'скидк акция', 'рейтин': 'рейти качес повыс', 'качест': 'качес рейти',
    'возвра': 'возвр', 'штриха': 'штрих баркод', 'баркод': 'штрих баркод', 'видео': 'видео медиа',
}
_WB_HOT = ('item-photo-rules', 'how-to-create-card', 'how-to-improve-photos',
           'main-fields/images', 'main-fields/title-description', 'content/quality')
_W_NOISE = re.compile(r'(?i)\b(wb|вб|ym)\b')


def _stems(text):
    words = re.findall(r'[a-zа-яё0-9]{3,}', _W_NOISE.sub(' ', (text or '').lower().replace('ё', 'е')))
    out = set()
    for w in words:
        if any(w.startswith(sw) for sw in _STOP if len(sw) >= 5) or w in _STOP:
            continue
        st = w[:5]
        out.add(st)
        for k, extra in _SYN.items():
            if w.startswith(k):
                out.update(extra.split())
    return out


def _docs_index():
    global _DOCS_INDEX
    if _DOCS_INDEX is None:
        try:
            from docs_index import DOCS_INDEX
            _DOCS_INDEX = DOCS_INDEX
        except Exception as e:
            print(f'[megamag] docs_index не загружен: {e}', flush=True)
            _DOCS_INDEX = {}
    return _DOCS_INDEX


def _doc_search_local(question, mp, limit=3):
    q = _stems(question)
    if not q:
        return []
    scored = []
    for title, url in _docs_index().get(mp, []):
        t = _stems(title)
        hit = len(q & t)
        if hit:
            if any(h in url for h in _WB_HOT):
                hit += 1
            scored.append((-hit, len(title), title, url))
    scored.sort()
    return [(title, '', url) for _, _, title, url in scored[:limit]]


def _wb_article_text(raw):
    """WB Справочный центр — Next.js: текст статьи лежит в self.__next_f как "children":"…".

    Берём строки из блоков Text/Title, кроме меню (category-tree) и служебных подписей.
    """
    out = []
    for chunk in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', raw, re.S):
        if 'category-tree' in chunk or 'Not-found' in chunk or '"messages' in chunk:
            continue
        for m in re.finditer(r'\\"typography\\":\\"([a-z0-9\-]+)\\",\\"children\\":\\"((?:[^"\\\\]|\\\\.)*?)\\"', chunk):
            typo, txt = m.group(1), m.group(2)
            try:
                txt = json.loads('"' + txt.replace('\\\\', '\\') + '"')
            except Exception:
                txt = txt.replace('\\\\n', ' ')
            txt = re.sub(r'\s+', ' ', txt).strip()
            if len(txt) < 3:
                continue
            if typo.startswith(('h', 'title', 'headline')) or 'bold' in typo:
                txt = '## ' + txt
            if not out or out[-1] != txt:
                out.append(txt)
    return '\n'.join(out)


def _fetch_official(url, limit=6000, timeout=6):
    """Яндекс отдаёт чистый markdown (.md), WB — HTML. OZON — закрыт."""
    if 'yandex.ru/support/marketplace' in url:
        md = url.rstrip('/') + ('/index.md' if url.endswith('/') else '.md')
        try:
            req = urllib.request.Request(md, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                text = r.read(400000).decode('utf-8', 'ignore')
            text = re.sub(r'(?s)^---.*?---\s*', '', text)
            text = re.sub(r'(?m)^> \*\*Documentation Index.*$', '', text)
            text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text).strip()
            if len(text) > 200:
                return f'{url}\n\n{text}'[:limit]
        except Exception:
            pass
    if 'seller.wildberries.ru/instructions' in url:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read(3_000_000).decode('utf-8', 'ignore')
            m = re.search(r'(?is)<title>(.*?)</title>', raw)
            title = _strip_tags(m.group(1)).split('|')[0].strip() if m else ''
            text = _wb_article_text(raw)
            if len(text) > 200:
                return f'# {title}\n{url}\n\n{text}'[:limit]
        except Exception as e:
            print(f'[megamag] WB справка {url}: {e}', flush=True)
        return ''
    return _fetch_doc(url, limit, timeout)


def _official_refs(question, marketplaces, status_cb=None, budget=9.0):
    """До ответа модели: ищем по официальным справкам и читаем 1–2 страницы.

    Возвращает блок «ОФИЦИАЛЬНАЯ СПРАВКА (прочитано сейчас)» и список ссылок.
    Всё параллельно и в пределах budget секунд — шлюз Поехали не ждёт.
    """
    q = re.sub(r'\s+', ' ', question or '').strip()[:150]
    if not q or not _RULES_INTENT.search(q):
        return '', []
    mps = [m for m in (marketplaces or []) if m in _DOC_SITES] or list(_DOC_SITES)
    t0 = time.monotonic()
    hits = []
    for mp in mps:
        if mp == 'ozon':
            continue
        for item in _doc_search_local(q, mp, 2):
            hits.append((mp, *item))
    to_read = [(url, _fetch_official, (url, 6000, 6)) for mp, title, snip, url in hits[:3]]
    if 'ozon' in mps:
        for title, url in _OZON_HUBS:
            hits.append(('ozon', title, 'Страницы OZON закрыты от роботов — откройте сами.', url))
    if not hits:
        return '', []
    for url, _, _ in to_read:
        if status_cb:
            status_cb(url)
    left = max(1.5, budget - (time.monotonic() - t0))
    pages = _parallel(to_read, left)
    out = ['ОФИЦИАЛЬНАЯ СПРАВКА (прочитано сейчас; опирайся на это и давай эти ссылки):']
    links = []
    for mp, title, snip, url in hits:
        text = pages.get(url)
        label = MP_TITLES.get(mp, mp)
        if isinstance(text, str) and text:
            out.append(f'=== {label}: {title}\n{text[:4500]}')
        elif mp == 'ozon':
            out.append(f'--- {label}: {title} — {url} (текст недоступен роботу; давай как ссылку '
                       f'«сверьте в справке», правило — как ориентир)')
        else:
            out.append(f'--- {label}: {title} — {url} (страница не открылась за отведённое время)')
        links.append(url)
    print(f'[megamag] справка {len(hits)} ссылок, прочитано '
          f'{sum(1 for u in pages.values() if isinstance(u, str) and u)} за '
          f'{time.monotonic() - t0:.1f}s', flush=True)
    return '\n\n'.join(out)[:11000], links


def _read_page(url):
    url = (url or '').strip()
    if not _url_allowed(url):
        return ('ОТКАЗАНО: читаю только официальные справки: ' + ', '.join(ALLOWED_SITE_TOKENS))
    text = _fetch_doc(url)
    if not text:
        return ('Страницу открыть не удалось (площадка закрыла её от роботов). '
                f'Менеджер может открыть её сам: {url}')
    return text[:MAX_TOOL_CHARS]


# ---------------------------------------------------------------- модель

# Лимит функции на Поехали — 90 с. Держим запас, чтобы успеть вернуть ответ самим.
REQUEST_BUDGET = 82
_DEADLINE = [0.0]


def _start_budget():
    _DEADLINE[0] = time.monotonic() + REQUEST_BUDGET


def _time_left():
    if not _DEADLINE[0]:
        return float(REQUEST_BUDGET)
    return _DEADLINE[0] - time.monotonic()


# База, до которой уже достучались (живёт, пока жив тёплый контейнер).
_GOOD_BASE = ['']

# У api.aitunnel.ru два IP; из облака Поехали один (8.6.112.0) не отвечает по TCP,
# и urllib висел на нём ~25 с, прежде чем пробовать второй. Проверяем адреса
# параллельно за 2 с и отдаём urllib только живые (кеш на 10 минут).
_AITUNNEL_HOSTS = ('api.aitunnel.ru', 'ru-api.aitunnel.ru')
_LIVE_IPS = {}
_orig_getaddrinfo = socket.getaddrinfo


_BAD_IPS = {}  # ip -> monotonic, когда на нём завис запрос


def _probe_ips(host, infos):
    """TCP-проба всех IP параллельно; возвращает живые, самые быстрые первыми."""
    from concurrent.futures import ThreadPoolExecutor
    ips = list(dict.fromkeys(i[4][0] for i in infos if i[0] == socket.AF_INET))

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
    print(f'[aitunnel] {host}: IP по скорости {alive} из {ips}', flush=True)
    return alive


def mark_bad_ip(host):
    """Запрос завис — исключаем IP, через который шли, на 10 минут."""
    cached = _LIVE_IPS.get(host)
    if cached and cached[1]:
        ip = cached[1][0]
        _BAD_IPS[ip] = time.monotonic()
        _LIVE_IPS[host] = (cached[0], [x for x in cached[1] if x != ip])
        print(f'[aitunnel] {host}: IP {ip} завис — исключаю', flush=True)


def _fast_getaddrinfo(host, port, *args, **kwargs):
    infos = _orig_getaddrinfo(host, port, *args, **kwargs)
    if host not in _AITUNNEL_HOSTS:
        return infos
    cached = _LIVE_IPS.get(host)
    if not cached or time.monotonic() - cached[0] > 600 or not cached[1]:
        now = time.monotonic()
        alive = [ip for ip in _probe_ips(host, infos) if now - _BAD_IPS.get(ip, -1e9) > 600]
        _LIVE_IPS[host] = (now, alive)
        cached = _LIVE_IPS[host]
    if not cached[1]:
        return infos
    best = cached[1][0]  # только один, самый быстрый IP — urllib не будет перебирать мёртвые
    return [i for i in infos if i[4][0] == best] or infos


socket.getaddrinfo = _fast_getaddrinfo
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
            print(f'[aitunnel] {path} via {urllib.parse.urlparse(base).hostname} {time.monotonic() - t_req:.1f}s', flush=True)
            _GOOD_BASE[0] = base
            _DEAD_BASES.pop(base, None)
            return out, None, 0
        except urllib.error.HTTPError as e:
            _GOOD_BASE[0] = base
            raw = e.read().decode('utf-8', 'ignore')
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


_KEY_CACHE = {}
_PRESET_CACHE = {}  # api_key -> имена из ошибки 403 «Разрешённые: …»
_KEY_TTL = 600


def _key_allowed_models(api_key):
    """Белый список моделей ключа AITUNNEL. None — ограничений нет или ключ не ответил."""
    cached = _KEY_CACHE.get(api_key)
    if cached and time.monotonic() - cached[0] < _KEY_TTL:
        return cached[1]
    data, err, _code = _aitunnel_open('aitunnel/key', api_key, None, timeout=8)
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


_ALLOWED_RE = re.compile(r'Разреш[её]нные:\s*([^"}]+?)(?:\.\s*["}]|\.?$|["}])')


def _allowed_from_error(raw):
    """AITUNNEL пишет «Разрешённые: MEGAMAG.» — берём имена один в один (пресет ключа)."""
    m = _ALLOWED_RE.search(raw or '')
    if not m:
        return []
    names = [n.strip().strip('.').strip() for n in m.group(1).split(',')]
    return [n for n in names if n]


def _model_candidates(api_key, state):
    """Сначала GPT 6 Luna Pro; если ключ ограничен — пересечение с его списком."""
    if state.get('candidates'):
        return state['candidates']
    # Пресет AITUNNEL ключа МЕГАМАГ (внутри него — GPT 6 Luna Pro). Имя — один в один.
    preset = os.environ.get('MEGAMAG_MODEL', '').strip() or MEGAMAG_PRESET
    if preset and not state.get('preset_failed'):
        state['candidates'] = [preset]
        return state['candidates']
    if _PRESET_CACHE.get(api_key):
        state['candidates'] = list(_PRESET_CACHE[api_key])
        return state['candidates']
    preferred = os.environ.get('AITUNNEL_MODEL', '').strip() or DEFAULT_MODEL
    t0 = time.monotonic()
    allowed = None if state.get('skip_key_lookup') else _key_allowed_models(api_key)
    print(f'[megamag] key models={allowed} {time.monotonic() - t0:.1f}s', flush=True)
    state['allowed_models'] = allowed
    ordered = []
    if allowed:
        pref_set = set(_model_aliases(preferred))
        for name in allowed:
            if pref_set & set(_model_aliases(name)):
                _add_models(ordered, name)
                break
        for name in MODEL_CANDIDATES:
            for a in allowed:
                if set(_model_aliases(name)) & set(_model_aliases(a)):
                    _add_models(ordered, a)
        for name in allowed:
            if name not in ordered:
                ordered.insert(0, name) if not (set(_model_aliases(preferred)) & set(_model_aliases(ordered[0] if ordered else ''))) else ordered.append(name)
        _PRESET_CACHE[api_key] = list(ordered[:8])
        state['candidates'] = ordered[:8]
        return state['candidates']
    _add_models(ordered, preferred)
    for name in MODEL_CANDIDATES:
        _add_models(ordered, name)
    state['candidates'] = ordered[:5]
    return state['candidates']


def _call_model(api_key, model, messages, tools):
    payload = {
        'model': model,
        'messages': messages,
        'temperature': 0.2,
        'max_tokens': 2500,
    }
    if tools:
        payload['tools'] = tools
    return _aitunnel_open('chat/completions', api_key, payload, timeout=75)


ANSWER_DEADLINE = 31  # с от старта: шлюз Поехали рвёт соединение на 33–50 с → держим запас
TTFT_TIMEOUT = 24  # с: connect + ожидание первого токена GPT 6 Luna Pro


def _set_sock_timeout(r, seconds):
    try:
        r.fp.raw._sock.settimeout(seconds)
    except Exception:
        pass


def _stream_answer(api_key, messages, state, deadline_left):
    """Потоковый ответ модели без инструментов. Возвращает (text, err, truncated).

    Если время подходит к концу — останавливаемся и отдаём уже написанное,
    вместо обрыва шлюзом с 503 / Failed to fetch в браузере.
    """
    # Не выходим за ANSWER_DEADLINE от старта запроса — иначе шлюз рвёт → Failed to fetch.
    hard_left = ANSWER_DEADLINE - (REQUEST_BUDGET - _time_left())
    stop_at = time.monotonic() + max(4, min(deadline_left, hard_left))
    last_err = 'модель не ответила'
    order = list(_model_candidates(api_key, state))
    if state.get('model') and state['model'] not in order:
        order.insert(0, state['model'])
    for model in order:
        payload = {
            'model': model, 'messages': messages,
            'max_tokens': 2500, 'stream': True,
            'temperature': 0.2,
        }
        # reasoning_effort у Luna сильно тянет TTFT — шлюз не ждёт.
        # Включать только явно: MEGAMAG_REASONING=low|medium|high
        reason = os.environ.get('MEGAMAG_REASONING', '').strip().lower()
        if reason and reason not in ('0', 'off', 'none', 'false') and not state.get('no_reasoning_param'):
            payload['reasoning_effort'] = reason
            payload.pop('temperature', None)
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        for base in _aitunnel_bases()[:2]:
            left = stop_at - time.monotonic()
            if left < 4:
                return '', 'не хватило времени на ответ модели', True
            # Luna Pro часто 10–18 с до первого токена — 8 с мало.
            # Заголовки ответа на живом IP приходят за ~1 с; если их нет 7 с — IP завис,
            # меняем его и повторяем. Первый токен потом ждём до TTFT_TIMEOUT.
            connect_timeout = max(3.0, min(7.0, left - 1))
            req = urllib.request.Request(
                base.rstrip('/') + '/chat/completions', data=body, method='POST',
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json',
                         'Accept': 'text/event-stream'},
            )
            parts = []
            t0 = time.monotonic()
            try:
                r = urllib.request.urlopen(req, timeout=connect_timeout)
            except urllib.error.HTTPError as e:
                raw = e.read().decode('utf-8', 'ignore')[:300]
                last_err = f'Сервис ИИ ответил ошибкой {e.code}: {raw}'
                _GOOD_BASE[0] = base
                print(f'[megamag] stream http {e.code}: {raw[:200]}', flush=True)
                if e.code in (401, 402):
                    return '', _public_ai_error(last_err, e.code), False
                allowed_names = _allowed_from_error(raw) if e.code == 403 else []
                if allowed_names and not state.get('preset_retry'):
                    print(f'[megamag] ключ пускает только {allowed_names} — повторяю с ними', flush=True)
                    _PRESET_CACHE[api_key] = allowed_names
                    state['candidates'] = allowed_names
                    state['allowed_models'] = allowed_names
                    state['preset_retry'] = True
                    state.pop('model', None)
                    return _stream_answer(api_key, messages, state, stop_at - time.monotonic())
                if e.code == 400 and 'reasoning' in raw.lower() and not state.get('no_reasoning_param'):
                    state['no_reasoning_param'] = True
                    return _stream_answer(api_key, messages, state, stop_at - time.monotonic())
                if e.code in (400, 403, 404):
                    break  # следующая модель
                continue
            except Exception as e:
                last_err = f'нет связи с {base}: {type(e).__name__}'
                print(f'[megamag] stream connect fail {base}: {e}', flush=True)
                mark_bad_ip(urllib.parse.urlparse(base).hostname)
                if not state.get('ip_retry') and stop_at - time.monotonic() > 8:
                    state['ip_retry'] = True
                    return _stream_answer(api_key, messages, state, stop_at - time.monotonic())
                _DEAD_BASES[base] = time.monotonic()
                continue
            _GOOD_BASE[0] = base
            truncated = False
            first = [None]
            try:
                # Заголовки SSE приходят сразу, а первый токен Luna — через 10–18 с.
                # До первого токена ждём до TTFT_TIMEOUT, дальше — короткий таймаут между кусками.
                ttft_until = t0 + TTFT_TIMEOUT
                _set_sock_timeout(r, max(1.0, min(ttft_until, stop_at) - time.monotonic()))
                with r:
                    for raw_line in r:
                        if time.monotonic() > stop_at:
                            truncated = True
                            break
                        line = raw_line.decode('utf-8', 'ignore').strip()
                        if not line.startswith('data:'):
                            # keep-alive / комментарии SSE — это ещё не токен
                            if first[0] is None:
                                if time.monotonic() > ttft_until:
                                    raise socket.timeout('нет первого токена за 18 с')
                                _set_sock_timeout(r, max(1.0, min(ttft_until, stop_at) - time.monotonic()))
                            continue
                        if first[0] is None:
                            first[0] = time.monotonic() - t0
                            print(f'[megamag] stream TTFT {first[0]:.1f}s model={model}', flush=True)
                        _set_sock_timeout(r, max(2.0, min(8.0, stop_at - time.monotonic())))
                        chunk = line[5:].strip()
                        if chunk == '[DONE]':
                            break
                        try:
                            d = json.loads(chunk)
                        except ValueError:
                            continue
                        for ch in d.get('choices') or []:
                            piece = (ch.get('delta') or {}).get('content') or \
                                    (ch.get('message') or {}).get('content') or ''
                            if piece:
                                parts.append(piece)
            except Exception as e:
                truncated = True
                last_err = f'обрыв потока: {type(e).__name__}'
                print(f'[megamag] stream read fail: {e}', flush=True)
            text = ''.join(parts).strip()
            stalled = not text and first[0] is None
            print(f'[megamag] stream {model} {time.monotonic() - t0:.1f}s first_byte={first[0]} '
                  f'{len(text)} chars truncated={truncated}', flush=True)
            if text:
                state['model'] = model
                return text, None, truncated
            if stalled or (not text and not truncated):
                break  # следующая модель
            if truncated and not text:
                return '', _public_ai_error(last_err), True
            # следующая модель в order
    return '', _public_ai_error(last_err), False


def _ask_model(api_key, messages, tools, state):
    if state.get('model'):
        return _call_model(api_key, state['model'], messages, tools)[:2]
    last_err = 'Не удалось подобрать доступную модель'
    for model in _model_candidates(api_key, state):
        data, err, code = _call_model(api_key, model, messages, tools)
        if data is not None:
            state['model'] = model
            return data, None
        last_err = err
        names = _allowed_from_error(err) if code == 403 else []
        if names and not state.get('preset_retry'):
            state['preset_retry'] = True
            _PRESET_CACHE[api_key] = names
            state['candidates'] = names
            state['allowed_models'] = names
            return _ask_model(api_key, messages, tools, state)
        if int(code or 0) in (401, 402):
            return None, _public_ai_error(err, code)
        if code not in (400, 403, 404):
            break
    return None, _public_ai_error(last_err, 403 if state.get('allowed_models') else 0)


SYSTEM_PROMPT = """Ты — МЕГАМАГ, агент по работе с маркетплейсами (OZON, Wildberries, Яндекс Маркет) для продавца штор и тюля (производство + онлайн‑продажи). Магазины: МЕГАТЮЛЬ и ДЮНА.

Специализация: карточки товаров, SEO, аналитика конкурентов, управление продажами и базовое планирование остатков/цен. Главная задача — помогать быстро и качественно заполнять карточки, чтобы они лучше ранжировались и конвертировались. Плюс аналитика продаж/выгрузок и текстильная специфика (плотность, прозрачность, усадка, драпировка, крепление, уход) и кабинеты продавца.

ПАМЯТЬ И БАЗА ЗНАНИЙ (внутренняя опора):
- Правила площадок: запрет накрутки отзывов/рейтинга/кликов; требования к фото и описаниям; модерация. Не советуй «серые» и «волшебные» методы продвижения.
- Метрики: CTR, конверсия в заказ, % выкупа, оборачиваемость, маржинальность, юнит‑экономика, ДРР.
- Типовые причины падения позиций: низкий рейтинг, слабые фото, рост цены относительно рынка, падение CTR, срыв SLA/задержки отгрузки, нет остатка, слабый контент.
- Цикл карточки: семантика → заголовок → характеристики → описание → фото → rich‑контент → отзывы.
- Актуальные правила — только из официальных справок площадок (см. ниже), не из блогов.

ТВОИ СИЛЬНЫЕ СТОРОНЫ ПО КАРТОЧКАМ:
- продающие заголовки с учётом лимитов символов и правил площадок (без КАПСА, без лишних спецсимволов);
- SEO‑описания с органично встроенными ключами, без переспама;
- релевантные характеристики и атрибуты под категорию («Шторы», «Тюль», «Комплекты штор» и др.);
- требования к фото и инфографике (размер, фон, композиция, драпировка, масштаб);
- разница в модерации между OZON, Wildberries и Яндекс Маркетом.

КАК ТЫ ОБЩАЕШЬСЯ:
- Как живой человек и коллега: тепло, по-деловому, на «вы», без канцелярита и без роботизированных шаблонов.
- На приветствие или «что умеешь» — коротко: 1–2 фразы + до 5 пунктов списком. Без портянки.
- Модель может меняться автоматически: не требуй конкретную модель и не обрывай диалог.
- Отвечай на ТОТ вопрос, который задан. Простой вопрос — простой ответ; разбор — развёрнуто.
- Ты АНАЛИТИК, а не пересказчик. Данные кабинета и выгрузок — сырьё. Сначала главный вывод/решение, потом обоснование и шаги (с разделом кабинета, если уместно).
- Связывай факты: нет остатка → реклама бесполезна; низкий выкуп → возвраты/размер/ожидания; акция жрёт маржу без заказов → вывести из акции.
- В разборе задачи предлагай 2–3 варианта: быстрый / надёжный / оптимальный — с плюсами и минусами.
- Приоритеты: сегодня / на неделе / можно отложить.
- Нет поля в данных — честно скажи, не выдумывай. Задай 3–5 точных вопросов, чтобы собрать базу.
- В конце содержательного ответа — короткий чек‑лист из 3–5 пунктов «сделать прямо сейчас».
- Таблицы — для характеристик, сравнения и экономики. Иначе — текст и списки.
- Когда идёшь в официальную справку — в статусе/ходе работы явно пиши: Пошёл смотреть информацию: <ссылка>.

ОБЯЗАТЕЛЬНЫЕ ФОРМАТЫ:
- Сравнения (конкуренты, цены, карточки): таблица «Параметр | Наш товар | Конкурент 1 | Конкурент 2 | … | Рекомендация».
- Юнит‑экономика: «Формула: …; Пример расчёта: …; Важные допущения: …».
- SEO: список ключевых фраз с приоритетом (высокий / средний / низкий) и куда ставить (заголовок, характеристики, описание, rich).

ЛОГИКА РАБОТЫ (по шагам, когда задача нетривиальная):
1) Приём: цель, критерии успеха, ограничения (площадка, бюджет, сроки).
2) Сбор базы: артикул/ссылка, категория, метрики (CTR, конверсия, выкуп, остатки), цены, фото (или краткое описание), склады/гео.
3) Анализ: 2–3 релевантных конкурента, сильные/слабые стороны.
4) Решение: шаги по 10–30 минут каждый.
5) Валидация: риски и как проверить.
6) Итерация: «Какой вариант делаем первым? Нужны ещё данные?»

ТВОЯ ЗОНА (карточки + аналитика + текстиль):
- Заполнять и править карточки: заголовок, SEO‑описание, атрибуты, фото/инфографика, модерация площадок.
- Шторы/тюль: Ш×В, крепление, плотность, светопроницаемость; не путать ширину полотна и ширину в готовом виде; замеры; уход и усадка против возвратов.
- Сравнение с конкурентами: наша карточка vs 3–5 чужих по тем же товарам (название, описание, характеристики, визуал, цена, УТП, отзывы/рейтинг).
- Выгрузки CSV/Excel: выкуп, возвраты, остатки, оборачиваемость, акции; экономика (маржа, комиссия, логистика); сезонность и гипотезы по конкурентам.
- Базовое планирование: остатки vs спрос/оборачиваемость; цена vs маржа и видимость; акции без «съедания» прибыли.
- Кабинет: SEO, рейтинг контента, модерация, остатки, цены, акции, реклама и ДРР, отзывы, воронка.

НЕ ТВОЯ ЗОНА: бухгалтерия, 1С, налоги, зарплаты, раскрой, склад цеха — это к МЕГАБУХу или администратору. Только юнит‑экономика товара для витрины и акций.

ЧТО НЕ ДЕЛАЕШЬ:
- Не меняешь базу и кабинеты сам (только чтение). Если просят «нажми / оформи» — объясни, где менеджер сделает сам, со ссылкой на справку.
- Не обещаешь готовые .xlsx / .pptx: дай структуру таблицы и текст для вставки.
- Не даёшь финансовых и юридических гарантий. В спорных местах добавляй: «Проверьте актуальные правила площадки и при необходимости проконсультируйтесь со специалистом».
- Не советуешь накрутку, серый трафик и обход правил модерации.

ОБРАЗОВАТЕЛЬНЫЙ ЦЕНТР И СПРАВКИ (только официальные; блоги, Telegram и totalcrm не используй)

OZON — база знаний селлера (карточки и SEO, FBO/FBS, финансы и комиссии, продвижение, API, гайды по категориям, Ozon Global):
https://docs.ozon.ru
Образовательный центр / Libra:
https://seller-edu.ozon.ru/libra/how-to-start
https://seller-edu.ozon.ru

Wildberries — Справочный центр (регистрация, заказы, FBS/FBO, упаковка, приёмка, отзывы, частые проблемы):
https://seller.wildberries.ru/instructions
https://seller.wildberries.ru
https://dev.wildberries.ru

Яндекс Маркет — Справка для продавцов (подключение магазина, товары и каталог, склады и логистика, заказы, расчёты, продвижение, аналитика, поддержка):
https://partner.market.yandex.ru
https://yandex.ru/support

КАК РАБОТАТЬ СО СПРАВКАМИ (обязательно):
1) Вопрос про правила площадки (модерация, карточка, FBS/FBO, упаковка, отзывы, комиссии, продвижение) — открой официальную базу (web_search site:… → read_page). Не отвечай «из головы». Перед открытием страницы напиши: Пошёл смотреть информацию: <url>.
2) Сравнивай правила разных площадок: лимиты заголовка, обязательные поля, фото, модерация — явно помечай «для WB / для OZON / для Маркета».
3) Ищи свежие версии: смотри дату публикации/обновления; если сомневаешься в тарифах/оферте/документах — скажи об этом.
4) Нет в базе — честно скажи «в справке площадки этого не нашёл»; не выдумывай. В ответе всегда давай кликабельную ссылку на конкретную официальную страницу.
Поиск:
- OZON: site:docs.ozon.ru или site:seller-edu.ozon.ru
- WB: site:seller.wildberries.ru/instructions
- Яндекс: site:partner.market.yandex.ru

ДАННЫЕ:
Система может дать блок «ДАННЫЕ КАБИНЕТА» и справку. Данные — что происходит, справка — как исправить. Нет данных — подскажи, как спросить: «разберите артикул …», «какие слабые карточки на OZON», «что горит на WB».

ФАЙЛЫ / ФОТО / ВЫГРУЗКИ:
- Фото или ссылка на товар: сначала плюсы и слабые места, потом готовая карточка. Нет цвета/размера/материала — спроси конкретно.
- Сравнение с конкурентами: прими наши карточки + 3–5 конкурентов (текст, скрины, ссылки, Excel). Не хватает полей — спроси только недостающее.
- Выгрузка продаж/остатков: сначала свод (товары, динамика по неделям, топ‑3 проблемных), затем рекомендации. Данных мало — запроси период, площадку и список полей.
Не проси переслать то, что уже во вложении.

КОГДА ЗАПОЛНЯЕШЬ ИЛИ ПРАВИШЬ КАРТОЧКУ:
1) Заголовок ≤60 символов, без КАПСА, без лишних спецсимволов. Для OZON при необходимости отдельно расширенный вариант 60–120 с пометкой «для OZON».
2) Описание — 2–3 абзаца: выгоды → характеристики и применение → призыв к действию. Ключи без переспама.
3) SEO‑ключи: 5–12 фраз с приоритетом (высокий / средний / низкий) и куда ставить (заголовок / характеристики / описание / rich).
4) Таблица характеристик: поле — значение (для штор/тюля: Ш×В с пояснением полотно/готовый вид, крепление, плотность/светопроницаемость, состав, цвет, уход — если известны).
Не хватает данных — спроси, не выдумывай. Можно добавить чек‑лист из 5 пунктов перед публикацией и советы по фото.

КОГДА СРАВНИВАЕШЬ С КОНКУРЕНТАМИ (аналитик по карточкам):
Вход: наши карточки (название, описание, характеристики, фото, цена, отзывы, рейтинг, остатки) + карточки 3–5 конкурентов по тем же товарам. Нет поля — пиши «нет в данных», не выдумывай.
Сделай:
1) Ключевые отличия по полям: название, описание, характеристики, визуал, цена, УТП.
2) Сильные стороны конкурентов (цена, наполнение, оформление, отзывы).
3) Слабые стороны конкурентов (дыры в атрибутах, слабые формулировки, мало фото/параметров).
4) Сопоставление с нами: где проигрываем / где выигрываем.
5) 5–7 конкретных рекомендаций, выполнимых за 1–2 рабочих дня (что добавить/убрать/перефразировать, какие характеристики подчеркнуть, какие фото снять).
6) На каждый товар: 3 варианта улучшенного названия + 1 описание ≤800 символов.
Формат ответа (строго):
A) Таблица: Параметр | Наша карточка | Конкурент 1 | Конкурент 2 | Конкурент 3 | Вывод/Рекомендация (если конкурентов больше — добавь колонки).
B) Нумерованный список рекомендаций.
C) В конце — 3 названия и 1 описание на товар.
Тон: деловой, без воды. В конце — чек‑лист «сделать прямо сейчас».

КОГДА АНАЛИЗИРУЕШЬ ПРОДАЖИ / ВЫГРУЗКУ / ЭКОНОМИКУ:
1) Краткий вывод (3–4 строки).
2) 3–5 рекомендаций с приоритетом.
3) Юнит‑экономика: «Формула: …; Пример расчёта: …; Важные допущения: …». Таблица по 2–3 товарам: себестоимость, комиссия, логистика, прибыль, маржа %. Нет поля — «нет в данных».
4) Риски и допущения (пример: если логистика +15 %, маржа −X %).
5) В конце — чек‑лист «сделать прямо сейчас» (3–5 пунктов).

ЧЕКЛИСТЫ ПЛОЩАДОК:
OZON: модерация ок + остаток; название 60–120; фото ≥5 (цель 8–15); атрибуты; описание 1000+; Rich; рейтинг контента 80+.
WB: без ошибок; название до 60; фото 5–10 формата 3:4; описание 1000–2000; характеристики; склейка.
Яндекс Маркет: сопоставление ок; рейтинг качества 80+; фото ≥5; параметры, штрихкод, габариты и вес.

БЕЗОПАСНОСТЬ: никогда не показывай ключи, токены, Client-Id, пароли."""

TOOLS = [
    {'type': 'function', 'function': {
        'name': 'cabinet_read',
        'description': (
            'Читает данные кабинетов маркетплейсов (только чтение). '
            'Карточка: what=card + query. Витрина/SEO кабинета: what=live.'
        ),
        'parameters': {'type': 'object', 'properties': {
            'what': {
                'type': 'string',
                'enum': ['overview', 'listings', 'ads', 'attention', 'live', 'card'],
            },
            'marketplace': {
                'type': 'string',
                'enum': ['ozon', 'wildberries', 'yandex_market', 'all'],
            },
            'shop_id': {
                'type': 'string',
                'description': 'id магазина из overview (МЕГАТЮЛЬ / ДЮНА); пусто — все',
            },
            'query': {
                'type': 'string',
                'description': (
                    'Для what=card: sku, offer_id OZON, nmID WB, offerId Яндекса '
                    'или часть названия товара'
                ),
            },
        }, 'required': ['what']},
    }},
    {'type': 'function', 'function': {
        'name': 'web_search',
        'description': (
            'Поиск только по официальным справкам. '
            'OZON: site:docs.ozon.ru или site:seller-edu.ozon.ru. '
            'WB: site:seller.wildberries.ru/instructions. '
            'Яндекс: site:partner.market.yandex.ru. '
            'Разрешены: ' + ', '.join(ALLOWED_SITE_TOKENS)
        ),
        'parameters': {'type': 'object', 'properties': {
            'query': {'type': 'string'},
        }, 'required': ['query']},
    }},
    {'type': 'function', 'function': {
        'name': 'read_page',
        'description': (
            'Открыть страницу официальной справки. '
            'OZON — docs.ozon.ru / seller-edu.ozon.ru; '
            'WB — seller.wildberries.ru/instructions; '
            'Яндекс — partner.market.yandex.ru. '
            'В тексте ищи дату обновления правила.'
        ),
        'parameters': {'type': 'object', 'properties': {
            'url': {'type': 'string'},
        }, 'required': ['url']},
    }},
]


def _resp(code, body, headers):
    return {'statusCode': code, 'headers': headers, 'body': json.dumps(body, ensure_ascii=False)}


# Технические пометки к промпту: что реально происходит в этом чате.
RUNTIME_NOTES = """

ТЕХНИЧЕСКИ В ЭТОМ ЧАТЕ:
- У тебя ЕСТЬ доступ на чтение к кабинетам OZON, Wildberries и Яндекс Маркета через API
  (ключи из CRM). Когда в вопросе есть артикул, sku, nmID или offer_id, система сама находит
  карточку и даёт блок «ДАННЫЕ КАБИНЕТА». Никогда не пиши «не могу открыть кабинет» или
  «пришлите ссылку». Если данных по артикулу нет в блоке — скажи, что карточка не нашлась,
  и попроси уточнить артикул или площадку.
- Строку «Пошёл смотреть информацию: <url>» система сама показывает менеджеру в статусе,
  когда открывает справку. В тексте ответа её не повторяй — давай ссылку на страницу в конце.
- Если ниже есть блок «ОФИЦИАЛЬНАЯ СПРАВКА (прочитано сейчас)» — опирайся на него и ссылайся
  на его url. Если страницу открыть не удалось (OZON закрыт защитой от роботов) — так и скажи
  и дай ссылку, где менеджер посмотрит сам; правило площадки тогда давай как ориентир,
  с пометкой «сверьте в справке».
- Модель ИИ может подбираться автоматически. Не называй и не требуй конкретную модель.
  Если инструмент не ответил — продолжи по уже известному; диалог не обрывай.
"""


def _source_hub(question):
    """Точка входа в официальную справку по вопросу — для статуса в чате."""
    low = (question or '').lower()
    if 'wildberries' in low or re.search(r'\bwb\b|вб|вайлд', low):
        return 'https://seller.wildberries.ru/instructions'
    if re.search(r'яндекс|yandex|\bym\b', low) and re.search(
        r'маркет|справк|правил|партн|логист|заказ', low,
    ):
        return 'https://partner.market.yandex.ru'
    if 'ozon' in low or 'озон' in low or 'seller-edu' in low:
        return 'https://docs.ozon.ru'
    if re.search(r'модерац|справк|правил|инструкц|требован|fbo|fbs|упаков|при[её]мк|комисси', low):
        return 'https://docs.ozon.ru'
    return ''


def _looking_text(url):
    return f'Пошёл смотреть информацию: {url}'


_CARD_INTENT = re.compile(
    r'карточк|артикул|\bsku\b|\bскю\b|\bseo\b|\bсео\b|nmid|nm\s?id|offer_?id|разбер|провер|'
    r'товар|позици|найди|найти|покажи|посмотри|глянь|что\s+с\b|как\s+там|инф\w*\s+по',
    re.I,
)
# Сообщение — только артикул (например «2vyal8_290» или «1055690496»): тоже карточка.
_ONLY_ART = re.compile(r'^\s*[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_\-./]{3,}\s*[?!.]*\s*$')
_ART_TOKEN = re.compile(r'(?<![\wА-Яа-яЁё])(?=[A-Za-zА-Яа-яЁё0-9_\-./]*\d)[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_\-./]{3,}')
_LIVE_INTENT = re.compile(
    r'витрин|кабинет|seo|сео|карточк|качеств|слаб|плох|ошибк|модерац|что.*смотр',
    re.I,
)
_FILL_INTENT = re.compile(
    r'(заполн|напиш|состав|созда|сдела|придума|подготов|сгенер|перепиш)\w*\s+(мне\s+)?'
    r'(нов\w+\s+)?(карточк|заголов|назван|описан|seo|сео|характерист)',
    re.I,
)
_SIZE_TOKEN = re.compile(r'\d{2,4}\s*[xх×*]\s*\d{2,4}(\s*(см|мм|м))?', re.I)
_ATTENTION_INTENT = re.compile(r'вниман|что горит|проблем|срочн|горит', re.I)


def _guess_marketplace(question):
    low = (question or '').lower()
    if 'ozon' in low or 'озон' in low:
        return 'ozon'
    if 'wildberries' in low or re.search(r'\bwb\b|вб|вайлдб', low):
        return 'wildberries'
    if 'яндекс' in low or 'yandex' in low or re.search(r'\bym\b', low):
        return 'yandex_market'
    return 'all'


def _cabinet_prefetch(question):
    """Сразу читаем кабинет до модели — шлюз Поехали рвёт долгие цепочки tool-calls."""
    q = question or ''
    mp = _guess_marketplace(q)
    if _FILL_INTENT.search(q):
        return None
    if _ONLY_ART.match(q) and re.search(r'\d', q) and not _SIZE_TOKEN.fullmatch(q.strip(' ?!.')):
        return {'what': 'card', 'marketplace': mp, 'query': q.strip(' ?!.')}
    if _CARD_INTENT.search(q):
        m = next((x for x in _ART_TOKEN.finditer(q) if not _SIZE_TOKEN.fullmatch(x.group(0))), None)
        if m:
            return {'what': 'card', 'marketplace': mp, 'query': m.group(0).strip('.-/')}
    if _ATTENTION_INTENT.search(q):
        return {'what': 'attention', 'marketplace': mp}
    if _LIVE_INTENT.search(q):
        return {'what': 'live', 'marketplace': mp if mp != 'all' else 'ozon'}
    return None


def _card_fallback_text(pre, raw):
    """Если ИИ не успел — показываем менеджеру, что нашли по артикулу на площадках."""
    raw = (raw or '').strip()
    if not raw or 'не найден' in raw[:300].lower() and 'Найдено в CRM' not in raw:
        return ''
    keep = []
    for line in raw.splitlines():
        if line.startswith('Формат ответа'):
            continue
        keep.append(line)
    body = '\n'.join(keep)[:3500]
    return (
        f'Нашёл карточку по артикулу **{pre.get("query")}** на площадках. Подробный разбор ИИ '
        'не успел подготовить — ниже данные из кабинетов, напишите «разбери подробнее», '
        'и я сделаю выводы.\n\n```\n' + body + '\n```'
    )


def handler(event: dict, context) -> dict:
    """МЕГАМАГ: помощник менеджера по кабинетам OZON / WB / Яндекс Маркета. Только чтение.

    POST / { question, history?, userId, role? }
    """
    _start_budget()
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }
    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    qs = event.get('queryStringParameters') or {}
    if method != 'POST':
        return _resp(405, {'error': 'Только POST'}, headers)

    try:
        body_data = json.loads(event.get('body') or '{}')
    except json.JSONDecodeError:
        return _resp(400, {'error': 'Неверный JSON'}, headers)
    question = (body_data.get('question') or '').strip()
    user_id = body_data.get('userId')
    history = body_data.get('history') or []
    requested_role = (body_data.get('role') or '').strip()
    files = body_data.get('files') or []
    want_stream = bool(body_data.get('stream'))
    status_log = []

    def note_looking(url):
        text = _looking_text(url)
        if not status_log or status_log[-1] != text:
            status_log.append(text)

    def finish(code, body):
        """При stream=true отдаём NDJSON: статусы «Пошёл смотреть…» + финальный ответ."""
        if want_stream and code == 200 and isinstance(body, dict) and 'answer' in body:
            nd_headers = dict(headers)
            nd_headers['Content-Type'] = 'application/x-ndjson; charset=utf-8'
            lines = [{'type': 'status', 'text': t} for t in status_log]
            lines.append({'type': 'done', **body})
            payload = '\n'.join(json.dumps(x, ensure_ascii=False) for x in lines) + '\n'
            return {'statusCode': 200, 'headers': nd_headers, 'body': payload}
        return _resp(code, body, headers)

    if not isinstance(files, list):
        files = []
    if files and not question:
        question = (
            'Прочитайте выгрузку с маркетплейса и разберите по делу: краткий свод '
            '(сколько товаров, динамика по неделям если есть, топ‑3 проблемных), '
            'затем рекомендации с приоритетом и экономику по 2–3 ключевым позициям.'
        )
    if not files and not question:
        return _resp(400, {'error': 'Пустой вопрос'}, headers)
    if not user_id:
        return _resp(400, {'error': 'Не указан пользователь'}, headers)

    hub = _source_hub(question)
    if hub:
        note_looking(hub)

    # Отдельный ключ агента менеджера. Не подставляйте сюда ключ МЕГАБУХа.
    api_key = os.environ.get('API_KEY_MEGAMAG', '').strip()
    if not api_key:
        return _resp(500, {'error': _public_ai_error('Не настроен ключ доступа к сервису ИИ')}, headers)

    dsn = os.environ['DATABASE_URL']
    schema = os.environ.get('MAIN_DB_SCHEMA', 'public')
    key_thread = _warm_key(api_key)

    conn = _ro_conn(dsn)
    try:
        cur = conn.cursor()
        ok, full_name = _access(cur, schema, user_id, requested_role)
        if not ok:
            return _resp(403, {'error': 'МЕГАМАГ доступен менеджеру и администратору'}, headers)
        cur.execute("SELECT to_char(now() + interval '3 hours', 'DD.MM.YYYY HH24:MI')")
        now_human = cur.fetchone()[0]
    finally:
        conn.close()

    given = _given_name(full_name)
    display = _chat_display_name(full_name)
    extra = f'\n\nСЕЙЧАС по Москве: {now_human}.'
    if given:
        extra += (
            f'\nСОБЕСЕДНИК: {display or given}. Обращайся по имени {given}, на «вы», '
            'не чаще раза за ответ.'
        )
    else:
        extra += '\nИмя собеседника неизвестно — говори на «вы».'

    messages = [{'role': 'system', 'content': SYSTEM_PROMPT + RUNTIME_NOTES + extra}]
    if isinstance(history, list):
        for m in history[-24:]:
            if not isinstance(m, dict):
                continue
            role = m.get('role')
            content = (m.get('content') or '').strip() if isinstance(m.get('content'), str) else ''
            if role in ('user', 'assistant') and content:
                messages.append({'role': role, 'content': content[:8000]})

    doc_excerpt = ''
    image_parts = []
    if files:
        doc_excerpt, image_parts = _read_attachments(files)
    user_text = question
    if doc_excerpt:
        user_text = (
            question
            + '\n\nПРИЛОЖЕННЫЕ ФАЙЛЫ С МАРКЕТПЛЕЙСА (прочитай и опирайся на них):\n'
            + doc_excerpt
        )
    if image_parts:
        content_parts = [{'type': 'text', 'text': user_text[:24000]}]
        for im in image_parts:
            content_parts.append({
                'type': 'image_url',
                'image_url': {'url': f"data:{im['mime']};base64,{im['b64']}"},
            })
        messages.append({'role': 'user', 'content': content_parts})
    else:
        messages.append({'role': 'user', 'content': user_text[:24000]})

    queries_ran = []
    state = {}
    t_start = time.monotonic()
    # Если прислали файл — сначала разбор вложения; prefetch кабинета только если в вопросе артикул/SKU.
    pre = None if (files and not re.search(
        r'(?i)\b(артикул|sku|offer[_ ]?id|nmid|nm[_ ]?id|разбери карточ)', question
    )) else _cabinet_prefetch(question)
    if pre:
        # Экономим один круг модели: шлюз Поехали рвёт долгие запросы.
        mp_title = MP_TITLES.get(pre.get('marketplace') or '', 'маркетплейса')
        note_looking({
            'ozon': 'https://docs.ozon.ru',
            'wildberries': 'https://seller.wildberries.ru/instructions',
            'yandex_market': 'https://partner.market.yandex.ru',
        }.get(pre.get('marketplace') or '', f'кабинет {mp_title}'))
        t1 = time.monotonic()
        pre_result = _cabinet_read(dsn, schema, pre)
        print(
            f"[megamag] prefetch {pre.get('what')} {pre} "
            f"{time.monotonic() - t1:.1f}s {len(pre_result or '')} chars: "
            f"{(pre_result or '')[:400]!r}",
            flush=True,
        )
        queries_ran.append(
            f"cabinet: {pre.get('what')} / {pre.get('marketplace') or 'all'}"
            + (f" / q {pre['query']}" if pre.get('query') else '')
        )
        messages.append({
            'role': 'assistant',
            'content': None,
            'tool_calls': [{
                'id': 'prefetch_cabinet',
                'type': 'function',
                'function': {'name': 'cabinet_read', 'arguments': json.dumps(pre, ensure_ascii=False)},
            }],
        })
        messages.append({
            'role': 'tool',
            'tool_call_id': 'prefetch_cabinet',
            'content': (pre_result or '')[:MAX_TOOL_CHARS],
        })
    if key_thread:
        # Не ждём список моделей ключа дольше пары секунд — модель важнее.
        # В простом чате не ждём вовсе: сразу стрим GPT 6 Luna Pro.
        key_thread.join(timeout=2 if pre else 0.3)
        if key_thread.is_alive():
            state['skip_key_lookup'] = True
    # Простой чат без prefetch: Luna через нестримовый tool-loop не успевает до шлюза.
    if not pre:
        elapsed = REQUEST_BUDGET - _time_left()
        plain = [m for m in messages if m.get('role') in ('system', 'user', 'assistant')
                 and not m.get('tool_calls')]
        mp_guess = _guess_marketplace(question)
        off, off_links = _official_refs(
            question, [mp_guess] if mp_guess != 'all' else None, note_looking,
            budget=min(10.0, ANSWER_DEADLINE - (REQUEST_BUDGET - _time_left()) - 18),
        )
        queries_ran.extend('read: ' + u for u in off_links)
        ref = off or knowledge.pick(question)
        if ref:
            plain.insert(1, {'role': 'system', 'content': ref})
        elapsed = REQUEST_BUDGET - _time_left()
        answer, err, truncated = _stream_answer(
            api_key, plain, state, ANSWER_DEADLINE - elapsed,
        )
        print(f'[megamag] chat-stream {time.monotonic() - t_start:.1f}s err={err} model={state.get("model")}', flush=True)
        if answer:
            if api_key in answer:
                answer = answer.replace(api_key, '***')
            if truncated:
                answer += '\n\n…Ответ сокращён по времени шлюза. Напишите «продолжи».'
            return finish(200, {
                'answer': answer,
                'queries': queries_ran,
                'model': state.get('model'),
                'docExcerpt': doc_excerpt[:6000],
            })
        # Если стрим не успел — не зависаем в tool-loop до Failed to fetch.
        return finish(200, {
            'answer': (
                'Извините, сервис ИИ сейчас отвечает медленно и я не успел сформулировать ответ. '
                'Повторите, пожалуйста, вопрос через минуту.'
            ),
            'queries': queries_ran,
            'model': state.get('model'),
            'error': err,
            'docExcerpt': doc_excerpt[:6000],
        })
    for step in range(MAX_STEPS):
        # Шлюз Поехали фактически рвёт ответ раньше заявленных 90 с.
        final = _time_left() < 50 or step == MAX_STEPS - 1
        if step == 0 and pre:
            if pre.get('what') == 'card':
                hint = (
                    'Это данные по карточке, о которой спросил коллега. Разбери её как агент '
                    'по карточкам штор и тюля: сначала плюсы и слабые места (SEO, фото, атрибуты, '
                    'модерация, остаток). Если просят заполнить или переписать — дай: '
                    'заголовок ≤60 симв. (без капса), описание из 2–3 абзацев '
                    '(выгоды → характеристики → призыв), 5–7 ключевых слов, таблицу характеристик. '
                    'Для OZON при необходимости добавь расширенный заголовок. '
                    'Поля «не читается методом API» не называй пустыми.'
                )
            elif pre.get('what') == 'attention':
                hint = (
                    'Это срез «что горит». Объясни коллеге по-человечески, что из этого действительно '
                    'срочно и почему, что подождёт, и что сделать в первую очередь.'
                )
            else:
                hint = (
                    'Это срез витрины кабинета. Не пересказывай цифры — сделай выводы: где главная '
                    'проблема, какие карточки слабее остальных и почему, какие проблемы системные '
                    '(касаются многих карточек), и дай план на неделю по приоритету.'
                )
            print(f'[megamag] one-shot start left={_time_left():.0f}s', flush=True)
            elapsed = REQUEST_BUDGET - _time_left()
            plain = [m for m in messages if m.get('role') in ('system', 'user', 'assistant')
                     and not m.get('tool_calls')]
            pre_mps = [pre.get('marketplace')] if pre.get('marketplace') in knowledge.DOCS else None
            off, off_links = ('', [])
            if pre.get('what') != 'card' or _RULES_INTENT.search(re.sub(r'(?i)разбер\w*|карточк\w*|артикул\w*', '', question)):
                off, off_links = _official_refs(
                    question, pre_mps, note_looking,
                    budget=min(8.0, ANSWER_DEADLINE - (REQUEST_BUDGET - _time_left()) - 20),
                )
                queries_ran.extend('read: ' + u for u in off_links)
            ref = (off + '\n\n' if off else '') + knowledge.pick(question, pre_mps)
            if ref.strip():
                plain.insert(1, {'role': 'system', 'content': ref})
            elapsed = REQUEST_BUDGET - _time_left()
            plain.append({'role': 'user', 'content': (
                'ДАННЫЕ КАБИНЕТА (только что прочитаны, только чтение):\n'
                + (pre_result or '')[:MAX_TOOL_CHARS] + '\n\n' + hint)})
            answer, err, truncated = _stream_answer(
                api_key, plain, state,
                ANSWER_DEADLINE - elapsed,
            )
            print(f'[megamag] one-shot {pre.get("what")} {time.monotonic() - t_start:.1f}s err={err}', flush=True)
            if answer:
                if api_key in answer:
                    answer = answer.replace(api_key, '***')
                if truncated:
                    answer += ('\n\n…Ответ сокращён по времени шлюза. Напишите «продолжи» — '
                               'допишу план правок.')
                return finish(200, {
                    'answer': answer,
                    'queries': queries_ran,
                    'model': state.get('model'),
                    'docExcerpt': doc_excerpt[:6000],
                })
            fallback = _card_fallback_text(pre, pre_result) if pre.get('what') == 'card' else ''
            return finish(200, {
                'answer': fallback or (
                    'Извините, сервис ИИ ответил слишком медленно, и я не успел разобрать данные. '
                    'Повторите вопрос через минуту.'),
                'queries': queries_ran,
                'model': state.get('model'),
                'error': err,
                'docExcerpt': doc_excerpt[:6000],
            })
        if final and step > 0:
            messages.append({
                'role': 'user',
                'content': 'Время на ответ заканчивается. Больше инструменты не вызывай — '
                           'дай развёрнутый ответ по уже полученным данным.',
            })
        t0 = time.monotonic()
        data, err = _ask_model(api_key, messages, None if (final and step > 0) else TOOLS, state)
        print(f'[megamag] step {step} model={state.get("model")} {time.monotonic() - t0:.1f}s left={_time_left():.0f}s err={bool(err)}', flush=True)
        if err:
            return _resp(502, {'error': _public_ai_error(err)}, headers)
        msg = ((data.get('choices') or [{}])[0]).get('message') or {}
        calls = msg.get('tool_calls') or []
        if not calls:
            answer = (msg.get('content') or '').strip()
            if api_key and api_key in answer:
                answer = answer.replace(api_key, '***')
            return finish(200, {
                'answer': answer or 'Не удалось получить ответ, попробуйте переспросить.',
                'queries': queries_ran,
                'model': state.get('model'),
                'docExcerpt': doc_excerpt[:6000],
            })
        messages.append(msg)
        for call in calls:
            fn = call.get('function') or {}
            name = fn.get('name') or ''
            try:
                args = json.loads(fn.get('arguments') or '{}')
            except json.JSONDecodeError:
                args = {}
            if name == 'cabinet_read':
                mp = args.get('marketplace') or 'all'
                note_looking({
                    'ozon': 'https://docs.ozon.ru',
                    'wildberries': 'https://seller.wildberries.ru/instructions',
                    'yandex_market': 'https://partner.market.yandex.ru',
                }.get(mp, 'https://docs.ozon.ru'))
                t1 = time.monotonic()
                result = _cabinet_read(dsn, schema, args)
                print(f'[megamag] cabinet {args.get("what")} {time.monotonic() - t1:.1f}s', flush=True)
                queries_ran.append(
                    f"cabinet: {args.get('what') or 'overview'} / {args.get('marketplace') or 'all'}"
                    + (f" / shop {args.get('shop_id')}" if args.get('shop_id') else '')
                    + (f" / q {args.get('query')}" if args.get('query') else '')
                )
            elif name == 'web_search':
                q = (args.get('query') or '').strip()
                sites = re.findall(r'site:(\S+)', q, re.I)
                if sites:
                    note_looking('https://' + sites[0].lstrip('/').rstrip('/'))
                elif hub:
                    note_looking(hub)
                else:
                    note_looking('https://docs.ozon.ru')
                result = _web_search(q)
                queries_ran.append('search: ' + q)
            elif name == 'read_page':
                url = (args.get('url') or '').strip()
                if url:
                    note_looking(url)
                result = _read_page(url)
                queries_ran.append('read: ' + url)
            else:
                result = 'Этот инструмент недоступен'
            print(f'[megamag] tool {name} {json.dumps(args, ensure_ascii=False)[:200]} -> {len(result or "")} chars', flush=True)
            messages.append({
                'role': 'tool',
                'tool_call_id': call.get('id'),
                'content': (result or '')[:MAX_TOOL_CHARS],
            })

    return finish(200, {
        'answer': 'Вопрос оказался слишком сложным — попробуйте спросить конкретнее.',
        'queries': queries_ran,
        'model': state.get('model'),
        'docExcerpt': doc_excerpt[:6000],
    })