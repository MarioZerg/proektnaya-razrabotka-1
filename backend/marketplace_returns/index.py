import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2

# Возвраты тянем ТОЛЬКО НА ЧТЕНИЕ: списки заявок на возврат у OZON и WB. Ничего на стороне
# маркетплейса не подтверждаем и не отклоняем — решение принимает кладовщик, когда вещь
# физически доехала до склада.
OZON_API_BASE = 'https://api-seller.ozon.ru'
# Заявки покупателей на возврат WB отдаёт отдельный хост returns-api (не marketplace-api).
WB_RETURNS_API_BASE = 'https://returns-api.wildberries.ru'
YM_API_BASE = 'https://api.partner.market.yandex.ru'

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


def log_action(cur, actor_id, actor_name, action, description, details=None):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, description, details) "
        "VALUES (%s, %s, 'returns', %s, 'marketplace_return', %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            action,
            description,
            json.dumps(details) if details else None,
        ),
    )


def get_credentials(cur, code):
    """Учётные данные маркетплейса из marketplace_integrations."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = %s",
        (code,),
    )
    row = cur.fetchone()
    if not row:
        return {}, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds, bool(row[0])


def http_json(url, method, headers, payload=None):
    """HTTP-запрос с JSON. Возвращает (status_code, parsed_json_or_text)."""
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
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


def error_text(data):
    if isinstance(data, dict):
        return data.get('message') or data.get('error') or data.get('detail') or json.dumps(data, ensure_ascii=False)
    return str(data)


def find_item(cur, sku, offer_id):
    """Находит товар в справочнике по SKU маркетплейса или артикулу продавца."""
    if sku:
        cur.execute(
            "SELECT id, name FROM marketplace_items WHERE ozon_sku = %s OR wb_sku = %s LIMIT 1",
            (str(sku), str(sku)),
        )
        row = cur.fetchone()
        if row:
            return row
    if offer_id:
        cur.execute("SELECT id, name FROM marketplace_items WHERE sku = %s LIMIT 1", (str(offer_id),))
        row = cur.fetchone()
        if row:
            return row
    return None, None


def find_order(cur, marketplace, posting_number):
    """Заказ, по которому оформлен возврат.

    У OZON это номер отправления (ozon_posting_number), у WB — srid заявки, который
    совпадает с order_number заказа (там он берётся из поля rid сборочного задания).
    У Яндекса — номер заказа кампании, он же order_number.
    """
    if not posting_number:
        return None
    if marketplace == 'OZON':
        cur.execute(
            "SELECT id FROM orders WHERE ozon_posting_number = %s ORDER BY id LIMIT 1",
            (str(posting_number),),
        )
    else:
        # Ищем строго среди заказов своей площадки: номера у разных маркетплейсов
        # могут совпасть, и возврат прицепился бы к чужому заказу.
        cur.execute(
            "SELECT id FROM orders WHERE order_number = %s AND marketplace = %s "
            "ORDER BY id LIMIT 1",
            (str(posting_number), marketplace),
        )
    row = cur.fetchone()
    return row[0] if row else None


def save_return(cur, marketplace, r):
    """Сохраняет одну заявку на возврат. Повторная загрузка обновляет статус, но не плодит
    дубли (уникальный индекс marketplace + external_id). Возвращает 'created'/'updated'."""
    cur.execute(
        "SELECT id, status FROM marketplace_returns WHERE marketplace = %s AND external_id = %s",
        (marketplace, r['externalId']),
    )
    existing = cur.fetchone()
    if existing:
        # Свой статус обработки не трогаем — обновляем только данные со стороны маркетплейса.
        cur.execute(
            "UPDATE marketplace_returns SET mp_status = %s, return_reason = %s, "
            "product_name = COALESCE(%s, product_name) WHERE id = %s",
            (r.get('mpStatus'), r.get('reason'), r.get('productName'), existing[0]),
        )
        return 'updated'

    item_id, item_name = find_item(cur, r.get('sku'), r.get('offerId'))
    order_id = find_order(cur, marketplace, r.get('postingNumber'))
    cur.execute(
        "INSERT INTO marketplace_returns (marketplace, external_id, posting_number, order_id, "
        "offer_id, sku, product_name, marketplace_item_id, quantity, mp_status, return_reason, "
        "mp_created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            marketplace,
            r['externalId'],
            r.get('postingNumber'),
            order_id,
            r.get('offerId'),
            str(r.get('sku')) if r.get('sku') else None,
            r.get('productName') or item_name,
            item_id,
            int(r.get('quantity') or 1),
            r.get('mpStatus'),
            r.get('reason'),
            r.get('createdAt'),
        ),
    )
    return 'created'


def sync_ozon(cur, days):
    """Заявки на возврат OZON (FBS и FBO). Читаем список возвратов за период."""
    creds, enabled = get_credentials(cur, 'ozon')
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция OZON выключена'}
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнены Client Id и Api Key OZON'}

    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    headers = {'Client-Id': client_id, 'Api-Key': api_key}
    created = updated = 0
    last_id = 0
    for _ in range(20):  # страховка от бесконечной постраничной выборки
        status, data = http_json(
            OZON_API_BASE + '/v1/returns/list',
            'POST',
            headers,
            {
                'filter': {'logistic_return_date': {'time_from': since}},
                'limit': 500,
                'last_id': last_id,
            },
        )
        if status != 200:
            return {'created': created, 'updated': updated, 'error': error_text(data)}

        returns = (data or {}).get('returns') or []
        if not returns:
            break
        for it in returns:
            product = it.get('product') or {}
            exchange = it.get('exchange_order') or {}
            rec = {
                'externalId': str(it.get('id') or exchange.get('id') or ''),
                'postingNumber': it.get('posting_number'),
                'offerId': product.get('offer_id'),
                'sku': product.get('sku'),
                'productName': product.get('name'),
                'quantity': product.get('quantity') or 1,
                'mpStatus': (it.get('visual') or {}).get('status', {}).get('display_name')
                or it.get('status'),
                'reason': it.get('return_reason_name') or it.get('reason'),
                'createdAt': it.get('logistic', {}).get('return_date')
                or it.get('created_at'),
            }
            if not rec['externalId']:
                continue
            if save_return(cur, 'OZON', rec) == 'created':
                created += 1
            else:
                updated += 1
        if not (data or {}).get('has_next'):
            break
        last_id = returns[-1].get('id') or 0
    return {'created': created, 'updated': updated, 'error': None}


def sync_wb(cur, days):
    """Заявки покупателей на возврат Wildberries."""
    creds, enabled = get_credentials(cur, 'wildberries')
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция Wildberries выключена'}
    api_key = (creds.get('apiKey') or '').strip()
    if not api_key:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнен Api Key Wildberries'}

    # WB отдаёт заявки постранично и НЕ принимает фильтр по дате — берём свежие
    # (is_archive=false: ещё не закрытые) и отсеиваем старые уже у себя.
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    created = updated = 0
    claims = []
    for offset in range(0, 1000, 200):
        status, data = http_json(
            f'{WB_RETURNS_API_BASE}/api/v1/claims?is_archive=false&limit=200&offset={offset}',
            'GET',
            {'Authorization': api_key},
        )
        if status != 200:
            return {'created': created, 'updated': updated, 'error': error_text(data)}
        page = (data or {}).get('claims') or []
        claims.extend(page)
        if len(page) < 200:
            break

    for it in claims:
        # WB отдаёт статус числом: 0 — заявка на рассмотрении, 1 — одобрена продавцом,
        # 2 — отклонена, 3 — автоматически одобрена площадкой.
        wb_status_labels = {
            0: 'На рассмотрении',
            1: 'Одобрен продавцом',
            2: 'Отклонён',
            3: 'Одобрен автоматически',
        }
        raw_status = it.get('status')
        status_text = it.get('status_name') or wb_status_labels.get(
            raw_status if isinstance(raw_status, int) else -1, ''
        )
        rec = {
            'externalId': str(it.get('id') or ''),
            'postingNumber': str(it.get('srid') or ''),
            'offerId': str(it.get('nm_id')) if it.get('nm_id') else None,
            'sku': it.get('nm_id'),
            'productName': it.get('imt_name'),
            'quantity': 1,
            'mpStatus': status_text or None,
            'reason': it.get('user_comment') or it.get('claim_type'),
            'createdAt': it.get('dt'),
        }
        if not rec['externalId']:
            continue
        # Старые заявки за пределами запрошенного периода пропускаем.
        if rec['createdAt']:
            try:
                dt = datetime.fromisoformat(str(rec['createdAt']).replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt < since_dt:
                    continue
            except ValueError:
                pass
        if save_return(cur, 'WB', rec) == 'created':
            created += 1
        else:
            updated += 1
    return {'created': created, 'updated': updated, 'error': None}


def sync_yandex(cur, days):
    """Возвраты Яндекс Маркета.

    Яндекс отдаёт возвраты по кампании и требует период — просим за последние дни.
    Отдельного «статуса заявки» как у WB здесь нет: возврат уже согласован площадкой,
    поэтому показываем его состояние доставки.
    """
    creds, enabled = get_credentials(cur, 'yandex_market')
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция Яндекс Маркета выключена'}
    api_key = (creds.get('apiKey') or '').strip()
    campaign_id = (creds.get('campaignId') or '').strip()
    if not api_key or not campaign_id:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнены Api Key и Campaign Id Яндекс Маркета'}

    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%d-%m-%Y')
    created = updated = 0
    page_token = None

    for _ in range(10):
        path = (
            f'/campaigns/{campaign_id}/returns'
            f'?fromDate={since}&limit=50'
        )
        if page_token:
            path += f'&page_token={page_token}'
        status, data = http_json(
            YM_API_BASE + path, 'GET', {'Api-Key': api_key},
        )
        if status != 200:
            return {'created': created, 'updated': updated, 'error': error_text(data)}

        result = (data or {}).get('result') or {}
        rows = result.get('returns') or []
        if not rows:
            break

        for it in rows:
            # В одном возврате может быть несколько позиций — заводим каждую отдельно,
            # чтобы кладовщик сканировал вещи поштучно, как и у других площадок.
            items = it.get('items') or [{}]
            for idx, item in enumerate(items):
                ret_id = str(it.get('id') or '')
                if not ret_id:
                    continue
                decision = (item.get('decision') or {}) if isinstance(item, dict) else {}
                rec = {
                    # У Яндекса номер один на весь возврат — добавляем номер позиции,
                    # иначе вторая вещь затрёт первую.
                    'externalId': ret_id if len(items) == 1 else f'{ret_id}-{idx + 1}',
                    'postingNumber': str(it.get('orderId') or ''),
                    'offerId': str(item.get('offerId') or '') or None,
                    'sku': item.get('marketSku'),
                    'productName': item.get('offerName') or item.get('offerId'),
                    'quantity': item.get('count') or 1,
                    'mpStatus': it.get('logisticPickupPoint', {}).get('name')
                    or it.get('refundStatus') or it.get('status'),
                    'reason': decision.get('reasonType')
                    or item.get('reasonType')
                    or it.get('returnReason'),
                    'createdAt': it.get('creationDate') or it.get('createdAt'),
                }
                if save_return(cur, 'Yandex', rec) == 'created':
                    created += 1
                else:
                    updated += 1

        page_token = ((data or {}).get('paging') or {}).get('nextPageToken')
        if not page_token:
            break

    return {'created': created, 'updated': updated, 'error': None}


def next_storage_barcode(cur):
    cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM goods_warehouse")
    return 'GW-' + str(cur.fetchone()[0]).zfill(6)


def handler(event: dict, context) -> dict:
    """Возвраты с маркетплейсов: загрузка заявок по API и приём вещей на склад.

    Кладовщик больше не вбивает номера заказов руками — система сама тянет с OZON и WB
    список того, что покупатели вернули. Когда коробка физически доехала, кладовщик
    отмечает возврат принятым, и вещь встаёт на склад в очередь «Ждёт полку».

    GET  /                            - список возвратов (фильтры: status, marketplace)
    GET  /?report=1&days=90           - отчёт: возвраты по швеям (сколько отшила, сколько
                                        вернулось, процент) и топ причин возврата
    POST /  { action: 'sync' }                 - загрузить свежие заявки с OZON и WB
    POST /  { action: 'approve', id }          - админ одобряет заявку (вещь поедет к нам)
    POST /  { action: 'reject', id }           - админ отклоняет заявку
    POST /  { action: 'scan', code }           - кладовщик сканирует стикер возврата.
                                                 Код вида TR{id} — внутренний стикер из
                                                 пакета: показывает, кто шил эту штуку
    POST /  { action: 'process', id, outcome } - судьба вещи: utilized (утилизация),
                                                 repack (на перепаковку), stored (на полку)

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком возвратов или результатом действия
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        params = event.get('queryStringParameters') or {}

        # Запуск по расписанию. Планировщик умеет дёргать только простую ссылку без тела
        # запроса, поэтому загрузку возвратов разрешаем и через адрес:
        # ?action=sync&cronSecret=... Ключ обязателен — иначе загрузку запустит любой,
        # кто знает адрес.
        if params.get('action') == 'sync':
            cron_secret = os.environ.get('CRON_SECRET', '')
            if not cron_secret or params.get('cronSecret') != cron_secret:
                return _resp(403, {'error': 'Неверный ключ планировщика'})
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                days = int(params.get('days') or 30)
                ozon = sync_ozon(cur, days)
                wb = sync_wb(cur, days)
                yandex = sync_yandex(cur, days)
                total_created = ozon['created'] + wb['created'] + yandex['created']
                if total_created:
                    log_action(
                        cur, None, 'Планировщик', 'sync',
                        f'Загрузка возвратов: новых {total_created}',
                        {'ozon': ozon, 'wb': wb, 'yandex': yandex},
                    )
                conn.commit()
                return _resp(200, {
                    'ozon': ozon,
                    'wildberries': wb,
                    'yandexMarket': yandex,
                    'created': total_created,
                })
            finally:
                conn.close()

        status_filter = (params.get('status') or '').strip()
        mp_filter = (params.get('marketplace') or '').strip()

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if params.get('report'):
                # Отчёт по возвратам в разрезе сотрудников: у кого чаще возвращают товар и
                # чем это заканчивается. Считаем только те возвраты, где известен исполнитель
                # (заказ найден в системе) — по остальным винить некого.
                days = int(params.get('days') or 90)
                cur.execute(
                    "SELECT COALESCE(su.full_name, 'Не определена') AS sewer, "
                    "COUNT(*) AS total, "
                    "COUNT(*) FILTER (WHERE r.outcome = 'utilized') AS utilized, "
                    "COUNT(*) FILTER (WHERE r.outcome = 'repack') AS repack, "
                    "COUNT(*) FILTER (WHERE r.outcome = 'stored') AS stored, "
                    "COALESCE(cu.full_name, '—') AS cutter "
                    "FROM marketplace_returns r "
                    "JOIN orders o ON o.id = r.order_id "
                    "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                    f"WHERE r.created_at >= now() - interval '{int(days)} days' "
                    "GROUP BY su.full_name, cu.full_name ORDER BY total DESC LIMIT 100"
                )
                by_sewer = [
                    {
                        'sewerName': r[0],
                        'total': r[1],
                        'utilized': r[2],
                        'repack': r[3],
                        'stored': r[4],
                        'cutterName': r[5],
                    }
                    for r in cur.fetchall()
                ]

                # Сколько всего вещей эти швеи отшили за тот же период — без этого числа
                # сравнивать нельзя: у кого больше объём, у того и возвратов больше.
                cur.execute(
                    "SELECT COALESCE(su.full_name, 'Не определена'), COUNT(*) "
                    "FROM orders o "
                    "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    "WHERE o.sewing_status IN ('Стикеровка', 'Готовые') "
                    f"AND o.created_at >= now() - interval '{int(days)} days' "
                    "GROUP BY su.full_name"
                )
                made = {r[0]: r[1] for r in cur.fetchall()}
                for row in by_sewer:
                    row['madeTotal'] = made.get(row['sewerName'], 0)
                    row['returnRate'] = (
                        round(row['total'] * 100.0 / row['madeTotal'], 1)
                        if row['madeTotal']
                        else None
                    )

                # Топ причин возврата — что чаще всего не устраивает покупателей.
                cur.execute(
                    "SELECT COALESCE(NULLIF(TRIM(r.damage_note), ''), "
                    "        NULLIF(TRIM(r.return_reason), ''), 'Без причины') AS reason, "
                    "COUNT(*) FROM marketplace_returns r "
                    f"WHERE r.created_at >= now() - interval '{int(days)} days' "
                    "GROUP BY reason ORDER BY COUNT(*) DESC LIMIT 20"
                )
                reasons = [{'reason': r[0], 'count': r[1]} for r in cur.fetchall()]

                return _resp(200, {'bySewer': by_sewer, 'reasons': reasons, 'days': days})

            conditions = []
            if status_filter and status_filter != 'all':
                conditions.append(f"r.status = '{status_filter.replace(chr(39), chr(39) * 2)}'")
            if mp_filter and mp_filter != 'all':
                conditions.append(f"r.marketplace = '{mp_filter.replace(chr(39), chr(39) * 2)}'")
            where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ''

            cur.execute(
                "SELECT r.id, r.marketplace, r.external_id, r.posting_number, r.offer_id, "
                "r.product_name, r.quantity, r.mp_status, r.return_reason, r.status, "
                "r.mp_created_at, r.received_at, u.full_name, gw.storage_barcode, "
                "mi.material, mi.width, mi.height, o.order_number, r.outcome, r.damage_note, "
                "r.return_barcode, r.outcome_at, ou.full_name "
                "FROM marketplace_returns r "
                "LEFT JOIN users u ON u.id = r.received_by "
                "LEFT JOIN users ou ON ou.id = r.outcome_by "
                "LEFT JOIN goods_warehouse gw ON gw.id = r.goods_warehouse_id "
                "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                "LEFT JOIN orders o ON o.id = r.order_id "
                f"{where_sql} ORDER BY r.mp_created_at DESC NULLS LAST, r.id DESC LIMIT 500"
            )
            returns = [
                {
                    'id': r[0],
                    'marketplace': r[1],
                    'externalId': r[2],
                    'postingNumber': r[3],
                    'offerId': r[4],
                    'productName': r[5],
                    'quantity': r[6],
                    'mpStatus': r[7],
                    'returnReason': r[8],
                    'status': r[9],
                    'mpCreatedAt': r[10].isoformat() + 'Z' if r[10] else None,
                    'receivedAt': r[11].isoformat() + 'Z' if r[11] else None,
                    'receivedByName': r[12],
                    'storageBarcode': r[13],
                    'material': r[14],
                    'width': r[15],
                    'height': r[16],
                    'orderNumber': r[17],
                    'outcome': r[18],
                    'damageNote': r[19],
                    'returnBarcode': r[20],
                    'outcomeAt': r[21].isoformat() + 'Z' if r[21] else None,
                    'outcomeByName': r[22],
                }
                for r in cur.fetchall()
            ]

            cur.execute(
                "SELECT status, COUNT(*) FROM marketplace_returns GROUP BY status"
            )
            counts = {row[0]: row[1] for row in cur.fetchall()}

            # Разбивка обработанных возвратов по судьбе вещи — админ видит, сколько
            # товара утилизировано, сколько ушло на перепаковку, сколько легло на полку.
            cur.execute(
                "SELECT outcome, COUNT(*) FROM marketplace_returns "
                "WHERE outcome IS NOT NULL GROUP BY outcome"
            )
            outcomes = {row[0]: row[1] for row in cur.fetchall()}
            return _resp(200, {'returns': returns, 'counts': counts, 'outcomes': outcomes})
        finally:
            conn.close()

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'sync':
                days = int(body_data.get('days') or 30)
                ozon = sync_ozon(cur, days)
                wb = sync_wb(cur, days)
                yandex = sync_yandex(cur, days)
                total_created = ozon['created'] + wb['created'] + yandex['created']
                if total_created:
                    log_action(
                        cur, actor_id, actor_name, 'sync',
                        f'Загрузка возвратов: новых {total_created}',
                        {'ozon': ozon, 'wb': wb, 'yandex': yandex},
                    )
                conn.commit()
                return _resp(200, {
                    'ozon': ozon,
                    'wildberries': wb,
                    'yandexMarket': yandex,
                    'created': total_created,
                })

            if action == 'approve':
                # Решение по заявке принимает ТОЛЬКО админ: одобрил — вещь поедет к нам,
                # и она появится у кладовщика в списке ожидаемых.
                if (body_data.get('actorRole') or '') != 'admin':
                    return _resp(403, {'error': 'Решение по заявке принимает администратор'})
                return_id = body_data.get('id')
                if not return_id:
                    return _resp(400, {'error': 'Укажите id возврата'})
                cur.execute(
                    "UPDATE marketplace_returns SET status = 'approved', approved_at = now(), "
                    "approved_by = %s WHERE id = %s AND status = 'new' RETURNING external_id",
                    (int(actor_id) if actor_id else None, int(return_id)),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(409, {'error': 'Заявка уже обработана'})
                log_action(cur, actor_id, actor_name, 'approve', f'Заявка на возврат {row[0]} одобрена')
                conn.commit()
                return _resp(200, {'success': True})

            if action == 'reject':
                if (body_data.get('actorRole') or '') != 'admin':
                    return _resp(403, {'error': 'Решение по заявке принимает администратор'})
                return_id = body_data.get('id')
                if not return_id:
                    return _resp(400, {'error': 'Укажите id возврата'})
                cur.execute(
                    "UPDATE marketplace_returns SET status = 'rejected' WHERE id = %s",
                    (int(return_id),),
                )
                log_action(cur, actor_id, actor_name, 'reject', f'Заявка на возврат #{return_id} отклонена')
                conn.commit()
                return _resp(200, {'success': True})

            if action == 'scan':
                # Кладовщик сканирует стикер возврата с коробки. Ищем заявку по штрихкоду
                # возврата, номеру отправления или внешнему номеру — что напечатано, то и
                # сработает. Показываем только одобренные админом.
                code = (body_data.get('code') or '').strip()
                if not code:
                    return _resp(400, {'error': 'Отсканируйте стикер возврата'})

                # Внутренний стикер прослеживаемости TR{id заказа}: его кладёт в пакет
                # упаковщик. По нему сразу видно, КТО шил именно эту штуку — на FBO
                # маркетплейс такой информации не даёт вовсе.
                if code.upper().startswith('TR') and code[2:].isdigit():
                    cur.execute(
                        "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.material, "
                        "o.width, o.height, su.full_name, cu.full_name, pu.full_name, o.cut_at "
                        "FROM orders o "
                        "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                        "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                        "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                        "WHERE o.id = %s",
                        (int(code[2:]),),
                    )
                    o = cur.fetchone()
                    if not o:
                        return _resp(404, {'error': f'Заказ по коду {code} не найден'})

                    # Возврат по этому заказу мог быть уже загружен с маркетплейса — тогда
                    # продолжаем работу с ним. Если нет, заводим заявку сами: вещь физически
                    # перед кладовщиком, значит возврат состоялся.
                    cur.execute(
                        "SELECT id, status FROM marketplace_returns WHERE order_id = %s "
                        "AND status <> 'processed' ORDER BY id DESC LIMIT 1",
                        (o[0],),
                    )
                    existing = cur.fetchone()
                    if existing:
                        ret_id = existing[0]
                        # Не откатываем статус назад: если возврат уже отмечен
                        # забранным с ПВЗ, он таким и остаётся.
                        cur.execute(
                            "UPDATE marketplace_returns SET "
                            "status = CASE WHEN status = 'new' THEN 'approved' ELSE status END, "
                            "return_barcode = COALESCE(return_barcode, %s) WHERE id = %s",
                            (code, ret_id),
                        )
                    else:
                        cur.execute(
                            "INSERT INTO marketplace_returns (marketplace, external_id, "
                            "posting_number, order_id, product_name, quantity, status, "
                            "return_barcode, approved_at, mp_created_at) "
                            "VALUES (%s, %s, %s, %s, %s, 1, 'approved', %s, now(), now()) "
                            "RETURNING id",
                            (
                                o[2] or 'OZON',
                                f'TRACE-{o[0]}',
                                o[1],
                                o[0],
                                f'{o[4]} {o[5]}x{o[6]}' if o[4] and o[5] else o[1],
                                code,
                            ),
                        )
                        ret_id = cur.fetchone()[0]
                    conn.commit()
                    return _resp(200, {'return': {
                        'id': ret_id,
                        'marketplace': o[2],
                        'externalId': f'TRACE-{o[0]}',
                        'postingNumber': o[1],
                        'productName': f'{o[4]} {o[5]}x{o[6]}' if o[4] and o[5] else o[1],
                        'returnReason': None,
                        'status': 'approved',
                        'material': o[4],
                        'width': o[5],
                        'height': o[6],
                        # Кто именно делал эту вещь — главная польза внутреннего стикера.
                        'sewerName': o[7],
                        'cutterName': o[8],
                        'packerName': o[9],
                        'orderNumber': o[1],
                    }})

                cur.execute(
                    "SELECT r.id, r.marketplace, r.external_id, r.posting_number, r.product_name, "
                    "r.return_reason, r.status, r.outcome, mi.material, mi.width, mi.height "
                    "FROM marketplace_returns r "
                    "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                    "WHERE r.return_barcode = %s OR r.posting_number = %s OR r.external_id = %s "
                    "LIMIT 1",
                    (code, code, code),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': f'Возврат по коду {code} не найден'})
                if row[6] == 'new':
                    return _resp(409, {'error': 'Заявка ещё не одобрена администратором'})
                if row[6] == 'rejected':
                    return _resp(409, {'error': 'Эта заявка отклонена'})
                if row[6] == 'processed':
                    return _resp(409, {'error': 'Этот возврат уже обработан'})
                # Статус picked_up (забран с ПВЗ, но не разобран) — рабочий:
                # именно такие вещи кладовщик и осматривает на складе.
                # Запоминаем штрихкод, которым реально сканируют — в следующий раз найдётся сразу.
                cur.execute(
                    "UPDATE marketplace_returns SET return_barcode = COALESCE(return_barcode, %s) "
                    "WHERE id = %s",
                    (code, row[0]),
                )
                conn.commit()
                return _resp(200, {'return': {
                    'id': row[0],
                    'marketplace': row[1],
                    'externalId': row[2],
                    'postingNumber': row[3],
                    'productName': row[4],
                    'returnReason': row[5],
                    'status': row[6],
                    'material': row[8],
                    'width': row[9],
                    'height': row[10],
                }})

            if action == 'process':
                # Кладовщик осмотрел вещь и решил её судьбу:
                #   utilized — повреждена, утилизируем (попадёт в отчёт админу);
                #   repack   — годная, но помята упаковка: едет к упаковщику на перепаковку;
                #   stored   — сразу на полку хранения со стикером.
                return_id = body_data.get('id')
                outcome = (body_data.get('outcome') or '').strip()
                if not return_id or outcome not in ('utilized', 'repack', 'stored'):
                    return _resp(400, {'error': 'Укажите возврат и решение по нему'})

                cur.execute(
                    "SELECT status, order_id, product_name, marketplace, external_id "
                    "FROM marketplace_returns WHERE id = %s",
                    (int(return_id),),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Возврат не найден'})
                if row[0] == 'processed':
                    return _resp(409, {'error': 'Этот возврат уже обработан'})
                # Разбирать можно и одобренный, и уже забранный с пункта выдачи.
                if row[0] not in ('approved', 'picked_up'):
                    return _resp(409, {'error': 'Возврат не одобрен администратором'})

                order_id = row[1]
                gw_id = None
                storage_barcode = None

                # Возврат приехал по заказу, которого нет в системе (типичный случай FBO:
                # маркетплейс не сообщает, какую именно штуку из партии выкупили). Чтобы вещь
                # всё равно встала на склад и её можно было переупаковать, заводим
                # технический заказ-возврат: он не идёт на конвейер, а служит карточкой вещи.
                if outcome != 'utilized' and not order_id:
                    cur.execute(
                        "SELECT mi.material, mi.width, mi.height, mi.name, r.marketplace, "
                        "r.external_id, r.product_name FROM marketplace_returns r "
                        "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                        "WHERE r.id = %s",
                        (int(return_id),),
                    )
                    info = cur.fetchone()
                    material, width, height = info[0], info[1], info[2]
                    product = (
                        f'{material} {width}x{height}'
                        if material and width and height
                        else (info[6] or info[3] or 'Возврат')
                    )
                    cur.execute(
                        "INSERT INTO orders (order_number, marketplace, order_type, status, "
                        "sewing_status, product, quantity, source, material, width, height) "
                        "VALUES (%s, %s, 'FBO', 'Выполнен', 'Готовые', %s, 1, 'return', %s, %s, %s) "
                        "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                        (
                            f'RET-{info[4]}-{info[5]}',
                            info[4],
                            product,
                            material,
                            width,
                            height,
                        ),
                    )
                    created_order = cur.fetchone()
                    if created_order:
                        order_id = created_order[0]
                    else:
                        cur.execute(
                            "SELECT id FROM orders WHERE order_number = %s",
                            (f'RET-{info[4]}-{info[5]}',),
                        )
                        order_id = cur.fetchone()[0]
                    cur.execute(
                        "UPDATE marketplace_returns SET order_id = %s WHERE id = %s",
                        (order_id, int(return_id)),
                    )

                # Полку можно указать сразу при осмотре: если вещь целая (клиент отказался
                # при вручении, коробку даже не вскрывали), гонять её через отдельный шаг
                # «разложить по полкам» незачем — кладовщик уже держит её в руках.
                shelf_id = body_data.get('shelfId')
                place_now = outcome == 'stored' and shelf_id not in (None, '')
                if place_now:
                    cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                    shelf_row = cur.fetchone()
                    if not shelf_row:
                        return _resp(404, {'error': 'Полка не найдена'})

                if outcome != 'utilized':
                    # Вещь остаётся в обороте — заводим её на складе. Повреждённая
                    # (utilized) на склад не попадает вовсе: она физически уничтожена.
                    # Полку указали сразу — вещь сразу считается проверенной и лежащей
                    # на месте, отдельная укладка не нужна.
                    if place_now:
                        gw_status = 'in_stock'
                    else:
                        gw_status = 'repacking' if outcome == 'repack' else 'awaiting_shelf'
                    if order_id:
                        cur.execute(
                            "SELECT id, storage_barcode FROM goods_warehouse WHERE order_id = %s",
                            (int(order_id),),
                        )
                        gw_row = cur.fetchone()
                        if gw_row:
                            gw_id, storage_barcode = gw_row
                            cur.execute(
                                "UPDATE goods_warehouse SET status = %s, shelf_id = %s, "
                                "shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
                                "reserved_order_id = NULL, shipping_labeled_at = NULL, "
                                "receive_reason = 'return', received_at = now(), "
                                "repack_return_id = %s WHERE id = %s",
                                (
                                    gw_status,
                                    int(shelf_id) if place_now else None,
                                    int(return_id) if outcome == 'repack' else None,
                                    gw_id,
                                ),
                            )
                        else:
                            storage_barcode = next_storage_barcode(cur)
                            cur.execute(
                                "INSERT INTO goods_warehouse (order_id, status, storage_barcode, "
                                "receive_reason, repack_return_id, shelf_id) "
                                "VALUES (%s, %s, %s, 'return', %s, %s) "
                                "RETURNING id",
                                (
                                    int(order_id),
                                    gw_status,
                                    storage_barcode,
                                    int(return_id) if outcome == 'repack' else None,
                                    int(shelf_id) if place_now else None,
                                ),
                            )
                            gw_id = cur.fetchone()[0]

                cur.execute(
                    "UPDATE marketplace_returns SET status = 'processed', outcome = %s, "
                    "outcome_at = now(), outcome_by = %s, damage_note = %s, received_at = now(), "
                    "received_by = %s, goods_warehouse_id = %s WHERE id = %s",
                    (
                        outcome,
                        int(actor_id) if actor_id else None,
                        (body_data.get('damageNote') or '').strip() or None,
                        int(actor_id) if actor_id else None,
                        gw_id,
                        int(return_id),
                    ),
                )
                shelf_name = shelf_row[0] if place_now else None
                outcome_labels = {
                    'utilized': 'утилизирован',
                    'repack': 'отправлен на перепаковку',
                    'stored': f'положен на полку {shelf_name}' if place_now else 'принят на склад',
                }
                log_action(
                    cur, actor_id, actor_name, 'process',
                    f'Возврат {row[3]} {row[4]} ({row[2] or "товар"}) — {outcome_labels[outcome]}',
                    {
                        'outcome': outcome,
                        'damageNote': body_data.get('damageNote'),
                        'shelf': shelf_name,
                    },
                )

                # Подбор заказов под эту вещь запустится сам при следующем обращении
                # к складу — своей копии этой логики здесь держать не будем.

                conn.commit()
                return _resp(200, {
                    'success': True,
                    'outcome': outcome,
                    'storageBarcode': storage_barcode,
                    'shelfName': shelf_name,
                    'placedOnShelf': place_now,
                    'needsManualOrder': order_id is None and outcome != 'utilized',
                })

            return _resp(400, {'error': 'Неизвестное действие'})
        finally:
            conn.close()

    return _resp(405, {'error': 'Method not allowed'})