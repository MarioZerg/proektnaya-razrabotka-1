import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
}

OZON_API = 'https://api-seller.ozon.ru'
WB_API = 'https://marketplace-api.wildberries.ru'
YM_API = 'https://api.partner.market.yandex.ru'


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def _creds(cur, code):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = %s ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1", (code,)
    )
    row = cur.fetchone()
    if not row or not row[0] or not row[1]:
        return None
    return row[1] if isinstance(row[1], dict) else json.loads(row[1])


def _request(url, headers, payload=None, timeout=20):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method='POST' if data else 'GET', data=data)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode('utf-8')
            return r.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')
    except Exception as e:
        return 0, str(e)


def _ozon(cur, creds):
    """Сколько отправлений ждёт сборки и отгрузки на OZON — и все ли они есть у нас."""
    cid = (creds.get('clientId') or creds.get('client_id') or '').strip()
    key = (creds.get('apiKey') or creds.get('api_key') or '').strip()
    if not cid or not key:
        return None
    headers = {'Client-Id': cid, 'Api-Key': key, 'Content-Type': 'application/json'}

    now = datetime.now(timezone.utc)
    out = []
    for status, title in (('awaiting_packaging', 'Ожидают сборки'),
                          ('awaiting_deliver', 'Ожидают отгрузки')):
        found = set()
        # Период OZON ограничивает по длине, поэтому идём окнами по 45 дней.
        for w in range(3):
            to_dt = now - timedelta(days=45 * w)
            since = now - timedelta(days=45 * (w + 1))
            offset = 0
            for _ in range(4):
                sc, d = _request(OZON_API + '/v3/posting/fbs/list', headers, {
                    'dir': 'DESC',
                    'filter': {
                        'since': since.strftime('%Y-%m-%dT%H:%M:%SZ'),
                        'to': to_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                        'status': status,
                    },
                    'limit': 1000, 'offset': offset, 'with': {},
                })
                if sc != 200:
                    return {'error': f'OZON не ответил ({sc})'}
                res = d.get('result') or {}
                for p in (res.get('postings') or []):
                    if p.get('posting_number'):
                        found.add(p['posting_number'])
                if not res.get('has_next'):
                    break
                offset += 1000

        nums = list(found)
        have_set = set()
        if nums:
            cur.execute(
                "SELECT DISTINCT ozon_posting_number FROM orders "
                "WHERE ozon_posting_number = ANY(%s)", (nums,)
            )
            have_set = {r[0] for r in cur.fetchall()}
        # Отдаём и САМИ НОМЕРА недостающих отправлений, а не только их количество:
        # по ним кнопка «Догрузить» забирает заказы точечно, не перебирая всю ленту.
        # Больше двадцати в подсказке не нужно — остальное доберёт планировщик.
        missing_numbers = [n for n in nums if n not in have_set]
        out.append({'title': title, 'onMarketplace': len(nums), 'inSystem': len(have_set),
                    'missing': len(missing_numbers),
                    'missingNumbers': missing_numbers[:20]})
    return out


def _wb(cur, creds):
    """Новые сборочные задания WB: все ли они доехали до нашего конвейера."""
    key = (creds.get('apiKey') or '').strip()
    if not key:
        return None
    sc, d = _request(WB_API + '/api/v3/orders/new',
                     {'Authorization': key, 'Content-Type': 'application/json'})
    if sc != 200:
        return {'error': f'WB не ответил ({sc})'}

    ids = [o.get('id') for o in (d.get('orders') or []) if o.get('id')]
    have = 0
    if ids:
        cur.execute(
            "SELECT COUNT(DISTINCT wb_order_id) FROM orders WHERE wb_order_id = ANY(%s)",
            ([int(i) for i in ids],)
        )
        have = int(cur.fetchone()[0] or 0)
    return [{'title': 'Новые заказы', 'onMarketplace': len(ids), 'inSystem': have,
             'missing': len(ids) - have}]


def _ym(cur, creds):
    """Заказы Яндекса в работе: все ли они есть у нас."""
    key = (creds.get('apiKey') or '').strip()
    campaign = (creds.get('campaignId') or '').strip()
    if not key or not campaign:
        return None

    ids, page_token = [], None
    for _ in range(5):
        path = f'/campaigns/{campaign}/orders?status=PROCESSING&pageSize=50'
        if page_token:
            path += f'&page_token={page_token}'
        sc, d = _request(YM_API + path, {'Api-Key': key, 'Content-Type': 'application/json'})
        if sc != 200:
            return {'error': f'Яндекс не ответил ({sc})'}
        ids.extend([str(o.get('id')) for o in (d.get('orders') or []) if o.get('id')])
        page_token = ((d.get('paging') or {}).get('nextPageToken'))
        if not page_token:
            break

    have = 0
    if ids:
        cur.execute(
            "SELECT COUNT(DISTINCT ym_order_id) FROM orders WHERE ym_order_id::text = ANY(%s)",
            (ids,)
        )
        have = int(cur.fetchone()[0] or 0)
    return [{'title': 'Заказы в работе', 'onMarketplace': len(ids), 'inSystem': have,
             'missing': len(ids) - have}]


def handler(event: dict, context) -> dict:
    """Сверка с маркетплейсами: сколько заказов у них и сколько доехало до нас.

    Показывает администратору, не теряются ли заказы по дороге. Только чтение —
    ничего не создаёт и не меняет ни у нас, ни на площадках.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    if event.get('httpMethod', 'GET') != 'GET':
        return _resp(405, {'error': 'Method not allowed'})

    params = event.get('queryStringParameters') or {}
    only = (params.get('marketplace') or '').strip()

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        # Площадки опрашиваем по одной отдельными запросами: опрос всех трёх разом
        # не укладывается в отведённое функции время, и страница не получала ничего.
        sources = [
            ('ozon', 'OZON', 'ozon', _ozon),
            ('wb', 'WildBerries', 'wildberries', _wb),
            ('ym', 'Яндекс Маркет', 'yandex_market', _ym),
        ]
        result = []
        for key, title, code, fn in sources:
            if only and only != key:
                continue
            creds = _creds(cur, code)
            if not creds:
                result.append({'key': key, 'title': title, 'enabled': False, 'rows': []})
                continue
            data = fn(cur, creds)
            if data is None:
                result.append({'key': key, 'title': title, 'enabled': False, 'rows': []})
            elif isinstance(data, dict) and data.get('error'):
                result.append({'key': key, 'title': title, 'enabled': True,
                               'error': data['error'], 'rows': []})
            else:
                result.append({'key': key, 'title': title, 'enabled': True, 'rows': data})

        total_missing = sum(
            r['missing'] for m in result for r in m.get('rows', []) if r['missing'] > 0
        )
        return _resp(200, {
            'marketplaces': result,
            'totalMissing': total_missing,
            'checkedAt': datetime.now(timezone.utc).isoformat(),
        })
    finally:
        conn.close()
