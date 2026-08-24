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
    """Сверка цены: что стоит в кабинете площадки и что записано у нас.

    Нужна, когда есть сомнение, менял ли кто-то цену на витрине. Спрашиваем
    OZON напрямую и кладём рядом свою запись — расхождение видно сразу.

    GET ?action=check&offerId=2vyal2_240&actorId=10
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

        offer_id = (params.get('offerId') or '').strip()
        if not offer_id:
            return _resp(400, {'error': 'Укажите артикул'})

        cur.execute(
            "SELECT credentials FROM marketplace_integrations "
            "WHERE marketplace_code = 'ozon'")
        r = cur.fetchone()
        creds = r[0] if isinstance(r[0], dict) else json.loads(r[0] or '{}')

        body = json.dumps({
            'filter': {'offer_id': [offer_id], 'visibility': 'ALL'},
            'limit': 10,
        }).encode()
        req = urllib.request.Request(
            f'{OZON_API}/v5/product/info/prices', method='POST', data=body)
        req.add_header('Client-Id', str(creds.get('clientId', '')).strip())
        req.add_header('Api-Key', str(creds.get('apiKey', '')).strip())
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())

        on_ozon = []
        for it in (data.get('items') or []):
            p = it.get('price') or {}
            on_ozon.append({
                'offerId': it.get('offer_id'),
                'productId': it.get('product_id'),
                # price — наша цена продавца, её мы и отправляем.
                'price': p.get('price'),
                'oldPrice': p.get('old_price'),
                # marketing_price — что видит покупатель после скидки площадки.
                'marketingPrice': p.get('marketing_price'),
                'marketingSellerPrice': p.get('marketing_seller_price'),
                'minPrice': p.get('min_price'),
                'autoActionEnabled': p.get('auto_action_enabled'),
            })

        cur.execute(
            "SELECT mi.id, mi.sku, mi.ozon_sku, mi.name, mp.price, "
            "  mp.price_before_discount, mp.price_with_marketplace_discount, "
            "  mp.updated_at "
            "FROM marketplace_items mi "
            "LEFT JOIN marketplace_prices mp "
            "  ON mp.marketplace_item_id = mi.id "
            "  AND mp.marketplace_code = 'ozon' "
            "WHERE mi.sku = %s", (offer_id,))
        row = cur.fetchone()
        ours = None
        if row:
            ours = {
                'itemId': row[0], 'sku': row[1], 'ozonSku': row[2],
                'name': row[3],
                'price': float(row[4]) if row[4] is not None else None,
                'priceBeforeDiscount': float(row[5]) if row[5] is not None else None,
                'shownPrice': float(row[6]) if row[6] is not None else None,
                'updatedAt': row[7],
            }

        return _resp(200, {'onOzon': on_ozon, 'ours': ours})
    finally:
        cur.close()
        conn.close()
