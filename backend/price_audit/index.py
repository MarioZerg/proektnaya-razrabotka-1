import json
import os
import urllib.request

import psycopg2

OZON_API = 'https://api-seller.ozon.ru'

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Content-Type': 'application/json',
}


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def handler(event: dict, context) -> dict:
    """Сверка цен: что стоит в кабинете OZON и что записано у нас.

    Нужна, когда есть сомнение, кто и на сколько двинул цену. Спрашиваем
    площадку напрямую и кладём рядом свою запись и эталон из истории —
    расхождение видно сразу.

    GET ?action=check&offerIds=a,b,c&actorId=10
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    if params.get('action') != 'check':
        return _resp(400, {'error': 'Неизвестное действие'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()
    try:
        actor_id = params.get('actorId')
        if not actor_id:
            return _resp(403, {'error': 'Только для администратора'})
        cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
        row = cur.fetchone()
        if not row or row[0] != 'admin':
            return _resp(403, {'error': 'Только для администратора'})

        offer_ids = [x.strip() for x in
                     (params.get('offerIds') or '').split(',') if x.strip()]
        if not offer_ids:
            return _resp(400, {'error': 'Укажите артикулы'})

        cur.execute(
            "SELECT credentials FROM marketplace_integrations "
            "WHERE marketplace_code = 'ozon'")
        r = cur.fetchone()
        creds = r[0] if isinstance(r[0], dict) else json.loads(r[0] or '{}')

        body = json.dumps({
            'filter': {'offer_id': offer_ids, 'visibility': 'ALL'},
            'limit': 100,
        }).encode()
        req = urllib.request.Request(
            f'{OZON_API}/v5/product/info/prices', method='POST', data=body)
        req.add_header('Client-Id', str(creds.get('clientId', '')).strip())
        req.add_header('Api-Key', str(creds.get('apiKey', '')).strip())
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=40) as resp:
            data = json.loads(resp.read().decode())

        out = []
        for it in (data.get('items') or []):
            p = it.get('price') or {}
            offer = it.get('offer_id')
            cur.execute(
                "SELECT mi.id, mp.price, "
                "  mp.price_with_marketplace_discount, mp.updated_at, "
                "  (SELECT h.price FROM price_history h "
                "   WHERE h.marketplace_item_id = mi.id "
                "     AND h.marketplace_code = 'ozon' "
                "   ORDER BY h.captured_on DESC LIMIT 1) "
                "FROM marketplace_items mi "
                "LEFT JOIN marketplace_prices mp "
                "  ON mp.marketplace_item_id = mi.id "
                "  AND mp.marketplace_code = 'ozon' "
                "WHERE mi.sku = %s", (offer,))
            o = cur.fetchone()
            out.append({
                'offerId': offer,
                # ЦЕНА В КАБИНЕТЕ — то, что площадка считает нашей ценой.
                'ozonPrice': p.get('price'),
                'ozonOldPrice': p.get('old_price'),
                'ozonMinPrice': p.get('min_price'),
                'ozonMarketingPrice': p.get('marketing_price'),
                'ozonMarketingSellerPrice': p.get('marketing_seller_price'),
                'ourPrice': float(o[1]) if o and o[1] is not None else None,
                'ourShown': float(o[2]) if o and o[2] is not None else None,
                'ourUpdatedAt': o[3] if o else None,
                'historyPrice': float(o[4]) if o and o[4] is not None else None,
            })
        return _resp(200, {'items': out})
    finally:
        cur.close()
        conn.close()
