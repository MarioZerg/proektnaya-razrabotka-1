"""Возвраты посылок интернет-магазина мегатюль.рф через Ozon Доставку (Rocket API).

У магазина сайта нет кабинета продавца OZON и штрихкода для ПВЗ: посылки он
отправляет через Ozon Доставку для интернет-магазинов. Невостребованное и
отказы едут на «склад возврата», а там их выдают отправителю по расходному
документу. Поэтому вместо штрихкода показываем:

- адрес склада возврата (куда ехать);
- посылки, которые едут обратно или уже ждут нас, — по трекингу Ozon;
- расходные документы на выдачу с печатью PDF.

Документация: https://docs.ozon.ru/api/rocket/
Ключи (client_id + client_secret) — «Интеграции», магазин «мегатюль.рф»,
карточка «Ozon Доставка».
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

AUTH_URL = 'https://xapi.ozon.ru/principal-auth-api/connect/token'
API_URL = 'https://xapi.ozon.ru/principal-integration-api'
SITE_SHOP_CODE = 'megatul_site'

# Последнее событие трекинга -> (код статуса, подпись, группа для экрана).
# Таблица «Статусы EventID» из документации Rocket API.
RETURN_EVENTS = {
    70: ('NotInDemand', 'Покупатель отказался', 'coming'),
    80: ('NotInDemand', 'Не востребован', 'coming'),
    60: ('PartialDelivered', 'Выдан частично — часть едет обратно', 'coming'),
    65: ('PartialDelivered', 'Частичный возврат после выдачи', 'coming'),
    100: ('Returning', 'Возврат едет на склад', 'coming'),
    110: ('Returning', 'Возврат прибыл на склад', 'coming'),
    115: ('ReturnReadyForSender', 'Готов к выдаче нам', 'ready'),
    120: ('ReturnedToSender', 'Передан нам', 'done'),
    51: ('DeliveredForResale', 'Возвращён через склад', 'done'),
    52: ('Disposed', 'Утилизирован', 'done'),
    99: ('Problem', 'Проблема с посылкой', 'problem'),
}
# Посылка у покупателя — возврата не будет, дальше не следим.
DELIVERED_EVENTS = {50, 93, 94}

_token = {'value': None, 'until': 0.0, 'client': None}


class RocketError(Exception):
    pass


def credentials(cur):
    """(client_id, client_secret, включено) интеграции «Ozon Доставка» магазина сайта."""
    cur.execute(
        "SELECT mi.is_enabled, mi.credentials FROM marketplace_integrations mi "
        "JOIN shops s ON s.id = mi.shop_id "
        "WHERE mi.marketplace_code = 'ozon_delivery' AND s.code = %s LIMIT 1",
        (SITE_SHOP_CODE,),
    )
    row = cur.fetchone()
    if not row:
        return None, None, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return ((creds.get('clientId') or '').strip(), (creds.get('clientSecret') or '').strip(),
            bool(row[0]))


def _token_for(client_id, client_secret):
    # Токен живёт около минуты — держим его, пока не истечёт, с запасом.
    if _token['value'] and _token['client'] == client_id and time.time() < _token['until']:
        return _token['value']
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': client_id,
        'client_secret': client_secret,
    }).encode()
    req = urllib.request.Request(AUTH_URL, data=body, method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        if e.code in (400, 401):
            raise RocketError('Ozon Доставка не приняла ключи — проверьте Client ID и Client Secret '
                              'в «Интеграциях» (магазин мегатюль.рф)')
        raise RocketError(f'Ozon Доставка не выдала доступ (код {e.code})')
    except Exception as e:  # noqa: BLE001
        raise RocketError(f'Нет связи с Ozon Доставкой: {type(e).__name__}')
    token = data.get('access_token')
    if not token:
        raise RocketError('Ozon Доставка не выдала доступ')
    _token.update(value=token, client=client_id,
                  until=time.time() + max(10, int(data.get('expires_in') or 60) - 10))
    return token


def _call(token, method, path, params=None, body=None):
    url = API_URL + path
    if params:
        url += '?' + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read().decode('utf-8')
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}
        try:
            msg = json.loads(e.read().decode('utf-8') or '{}').get('message') or ''
        except Exception:  # noqa: BLE001
            msg = ''
        raise RocketError(f'Ozon Доставка ответила ошибкой {e.code}{": " + msg[:150] if msg else ""}')
    except Exception as e:  # noqa: BLE001
        raise RocketError(f'Нет связи с Ozon Доставкой: {type(e).__name__}')


def _session(cur):
    client_id, client_secret, enabled = credentials(cur)
    if not client_id or not client_secret:
        return None
    if not enabled:
        raise RocketError('Интеграция «Ozon Доставка» выключена')
    return _token_for(client_id, client_secret)


def _last_event(events):
    best = None
    for ev in events or []:
        moment = ev.get('moment') or ''
        if best is None or moment >= (best.get('moment') or ''):
            best = ev
    return best


def site_returns(cur):
    """Сводка возвратов сайта для вкладки «мегатюль.рф».

    Возвращает {connected, error, places, parcels, documents}. Без ключей —
    connected=False: страница подскажет, где их вписать.
    """
    out = {'connected': False, 'error': None, 'places': [], 'parcels': [], 'documents': []}
    try:
        token = _session(cur)
    except RocketError as e:
        out['error'] = str(e)
        return out
    if not token:
        return out
    out['connected'] = True
    try:
        data = _call(token, 'GET', '/v1/delivery/return_places')
        out['places'] = [
            {'id': p.get('id'), 'name': p.get('name'), 'city': p.get('city'),
             'address': p.get('address')}
            for p in (data.get('places') or [])
        ]

        # Отправленные посылки сайта за 4 месяца, которые ещё не закрыты как
        # выданные покупателю или уже принятые нами обратно.
        cur.execute(
            "SELECT id, order_number, product, delivery_tracking_number, site_order_id "
            "FROM orders WHERE marketplace = 'IM' AND delivery_tracking_number IS NOT NULL "
            "  AND created_at > now() - interval '120 days' "
            "  AND COALESCE(delivery_status, '') NOT IN ('Delivered', 'ReturnedToSender', "
            "      'DeliveredForResale', 'Disposed') "
            "ORDER BY id DESC LIMIT 400"
        )
        orders = cur.fetchall()
        by_track = {}
        for oid, onum, product, track, sid in orders:
            by_track.setdefault(track, []).append((oid, onum, product, sid))
        tracks = list(by_track)
        for i in range(0, len(tracks), 50):
            res = _call(token, 'POST', '/v1/tracking/list', body={'articles': tracks[i:i + 50]})
            for item in res.get('items') or []:
                key = item.get('postingNumber') if item.get('postingNumber') in by_track \
                    else item.get('postingBarcode')
                if key not in by_track:
                    continue
                ev = _last_event(item.get('events'))
                if not ev:
                    continue
                eid = int(ev.get('eventId') or 0)
                if eid in DELIVERED_EVENTS:
                    status, label, group = 'Delivered', 'Выдан покупателю', None
                elif eid in RETURN_EVENTS:
                    status, label, group = RETURN_EVENTS[eid]
                else:
                    status, label, group = None, None, None
                for oid, onum, product, sid in by_track[key]:
                    if status:
                        cur.execute(
                            "UPDATE orders SET delivery_status = %s, delivery_status_at = %s "
                            "WHERE id = %s AND delivery_status IS DISTINCT FROM %s",
                            (status, ev.get('moment'), oid, status),
                        )
                    if group:
                        out['parcels'].append({
                            'orderId': oid, 'orderNumber': onum, 'siteOrder': sid,
                            'product': product, 'tracking': key, 'status': status,
                            'statusText': label, 'group': group,
                            'at': ev.get('moment'), 'place': ev.get('placeName'),
                        })

        docs = _call(token, 'GET', '/v1/document/return_documents', params={
            'pagination.size': 50,
            'dateFrom': time.strftime('%Y-%m-%dT00:00:00Z', time.gmtime(time.time() - 60 * 86400)),
        })
        out['documents'] = [
            {'id': d.get('documentID'), 'number': d.get('number'), 'date': d.get('date'),
             'state': d.get('stateTransitName'), 'place': d.get('pickupPlaceName')}
            for d in (docs.get('items') or [])
        ]
    except RocketError as e:
        out['error'] = str(e)
    order = {'ready': 0, 'problem': 1, 'coming': 2, 'done': 3}
    out['parcels'].sort(key=lambda p: (order.get(p['group'], 9), p['at'] or ''))
    return out


def return_document_pdf(cur, document_id):
    """PDF расходного документа на выдачу возвратов (base64)."""
    token = _session(cur)
    if not token:
        raise RocketError('Не заполнены ключи «Ozon Доставка» в «Интеграциях»')
    for doc_type in ('ActSales', 'T12Sales'):
        data = _call(token, 'GET', '/v1/document',
                     params={'id': str(document_id), 'type': doc_type, 'format': 'PDF'})
        raw = data.get('documentBytes')
        if raw:
            return raw
    raise RocketError('Ozon Доставка не отдала документ')
