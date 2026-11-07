"""Возвраты интернет-магазина мегатюль.рф через Ozon Доставку (Ozon Delivery API).

Сайт отправляет посылки через Ozon Доставку для интернет-магазинов. У неё свой
API (https://api-delivery.ozon.ru), свой штрихкод получения возвратов и свой
список возвратов — с кабинетом продавца OZON (МЕГАТЮЛЬ) он не пересекается.

Доступ — OAuth client_credentials: Client ID и Client Secret из кабинета Ozon
Доставки, право delivery-api.all. Ключи вписываются в «Интеграции», магазин
«мегатюль.рф», карточка «Ozon Доставка».

Что берём:
- штрихкод получения возвратов (выпустить новый — /v1/return/reset_barcode);
- возвраты и отмены с их статусом и местом (/v1/return/search);
- статусы наших посылок (/v1/posting/info) — пишем в orders.delivery_status.

Особенность: на первый запрос сервер Ozon отвечает 307 на тот же адрес с
?__rr=1 и ставит куки — без сессии с куками запросы не проходят.
"""

import json
import time

import requests

TOKEN_URL = 'https://xapi.ozon.ru/oauth/token'
API_URL = 'https://api-delivery.ozon.ru'
SCOPE = 'delivery-api.all'
SITE_SHOP_CODE = 'megatul_site'
CODE_MP = 'ozon_delivery'

# Статус возврата Ozon -> (подпись, группа на экране).
RETURN_STATUS = {
    'moving': ('Едет к нам', 'coming'),
    'at_pickup_point': ('Ждёт нас в пункте выдачи', 'ready'),
    'received': ('Получен нами', 'done'),
    'utilization': ('Отправлен на утилизацию', 'problem'),
    'utilized': ('Утилизирован', 'problem'),
    'written_off': ('Списан', 'problem'),
}
# Посылка выдана покупателю или отменена окончательно — дальше не опрашиваем.
FINAL_POSTING = {'delivered', 'cancelled', 'returned', 'utilized'}

_state = {'token': None, 'until': 0.0, 'client': None, 'session': None}


class DeliveryError(Exception):
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


def _http():
    if _state['session'] is None:
        s = requests.Session()
        s.headers['User-Agent'] = 'megatulle-crm/1.0'
        _state['session'] = s
    return _state['session']


def _token(client_id, client_secret):
    if _state['token'] and _state['client'] == client_id and time.time() < _state['until']:
        return _state['token']
    try:
        r = _http().post(TOKEN_URL, json={
            'client_id': client_id, 'client_secret': client_secret,
            'grant_type': 'client_credentials', 'scope': [SCOPE],
        }, timeout=20)
    except requests.RequestException as e:
        raise DeliveryError(f'Нет связи с Ozon Доставкой: {type(e).__name__}')
    if r.status_code != 200:
        if 'invalid_client' in r.text:
            raise DeliveryError('Ozon Доставка не приняла ключи — проверьте Client ID и Client Secret '
                                'в «Интеграциях» (магазин мегатюль.рф)')
        if 'invalid_scope' in r.text:
            raise DeliveryError('У ключей нет доступа к API Ozon Доставки (delivery-api.all) — '
                                'включите его в кабинете Ozon Доставки')
        raise DeliveryError(f'Ozon Доставка не выдала доступ (код {r.status_code})')
    data = r.json()
    _state.update(token=data['access_token'], client=client_id,
                  until=time.time() + max(30, int(data.get('expires_in') or 3600) - 60))
    return _state['token']


def _post(token, path, body, raw=False):
    s = _http()
    headers = {'Authorization': f'Bearer {token}'}
    try:
        r = s.post(API_URL + path, json=body, headers=headers, timeout=25, allow_redirects=False)
        # Защита Ozon: 307 на тот же адрес с ?__rr=1 и кука — повторяем по ней.
        for _ in range(2):
            if r.status_code not in (301, 302, 307, 308):
                break
            r = s.post(requests.compat.urljoin(r.url, r.headers.get('Location', '')), json=body,
                       headers=headers, timeout=25, allow_redirects=False)
    except requests.RequestException as e:
        raise DeliveryError(f'Нет связи с Ozon Доставкой: {type(e).__name__}')
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        try:
            msg = (r.json().get('error') or {}).get('message') or r.json().get('message') or ''
        except ValueError:
            msg = ''
        raise DeliveryError(f'Ozon Доставка ответила ошибкой {r.status_code}'
                            f'{": " + str(msg)[:150] if msg else ""}')
    return r.content if raw else (r.json() if r.content else {})


def _session(cur):
    client_id, client_secret, enabled = credentials(cur)
    if not client_id or not client_secret:
        return None
    if not enabled:
        raise DeliveryError('Интеграция «Ozon Доставка» выключена')
    return _token(client_id, client_secret)


def site_shop_id(cur):
    cur.execute("SELECT id FROM shops WHERE code = %s", (SITE_SHOP_CODE,))
    row = cur.fetchone()
    return row[0] if row else None


def issue_barcode(cur, actor_id=None):
    """Выпустить новый штрихкод получения возвратов и сохранить в карточку сайта.

    Старый штрихкод при этом перестаёт действовать — как кнопка в кабинете.
    """
    token = _session(cur)
    if not token:
        raise DeliveryError('Не заполнены ключи «Ozon Доставка» в «Интеграциях» (магазин мегатюль.рф)')
    data = _post(token, '/v1/return/reset_barcode', {}) or {}
    code = ((data.get('barcode_content') or {}).get('barcode') or '').strip()
    if not code:
        raise DeliveryError('Ozon Доставка не выдала штрихкод возвратов')
    cur.execute(
        "UPDATE return_pickup_codes SET code = %s, code_image = NULL, updated_at = now(), "
        "updated_by = %s WHERE marketplace_code = %s AND shop_id = %s",
        (code, int(actor_id) if str(actor_id or '').isdigit() else None, CODE_MP, site_shop_id(cur)),
    )
    return code


def _sync_posting_statuses(cur, token):
    """Статусы наших посылок сайта у Ozon — в orders.delivery_status."""
    cur.execute(
        "SELECT id, delivery_tracking_number FROM orders "
        "WHERE marketplace = 'IM' AND delivery_tracking_number IS NOT NULL "
        "  AND created_at > now() - interval '120 days' "
        "  AND COALESCE(delivery_status, '') NOT IN ('delivered', 'cancelled', 'returned', 'utilized') "
        "ORDER BY id DESC LIMIT 300"
    )
    by_num = {}
    for oid, num in cur.fetchall():
        by_num.setdefault(num, []).append(oid)
    nums = list(by_num)
    for i in range(0, len(nums), 50):
        data = _post(token, '/v1/posting/info', {'posting_numbers': nums[i:i + 50]}) or {}
        for p in data.get('postings') or []:
            st = p.get('status')
            for oid in by_num.get(p.get('posting_number'), []):
                cur.execute(
                    "UPDATE orders SET delivery_status = %s, delivery_status_at = %s "
                    "WHERE id = %s AND delivery_status IS DISTINCT FROM %s",
                    (st, p.get('status_changed_at'), oid, st),
                )


def site_returns(cur):
    """Возвраты сайта для вкладки «мегатюль.рф».

    {connected, error, returns: [...], waiting}. Без ключей — connected=False.
    """
    out = {'connected': False, 'error': None, 'returns': [], 'waiting': 0}
    try:
        token = _session(cur)
    except DeliveryError as e:
        out['error'] = str(e)
        return out
    if not token:
        return out
    out['connected'] = True
    try:
        items, cursor = [], None
        for _ in range(10):
            body = {'pagination': {'limit': 100, **({'cursor': cursor} if cursor else {})}}
            data = _post(token, '/v1/return/search', body) or {}
            items += data.get('returns') or []
            cursor = data.get('next_cursor')
            if not cursor:
                break
        # Номер возврата у продавца совпадает с номером отправления сайта
        # (MT-2407-1): по нему находим заказ у нас.
        for r in items:
            label, group = RETURN_STATUS.get(r.get('status'), (r.get('status') or '—', 'coming'))
            # Полученные давно — не показываем, чтобы список не рос бесконечно.
            if group == 'done' and (r.get('status_changed_at') or '') < \
                    time.strftime('%Y-%m-%d', time.gmtime(time.time() - 30 * 86400)):
                continue
            ext = r.get('return_external_id')
            order = None
            if ext:
                cur.execute(
                    "SELECT id, order_number FROM orders WHERE marketplace = 'IM' AND "
                    "((site_order_id || '-' || COALESCE(group_position, 1)) = %s "
                    " OR site_order_id = %s) ORDER BY id LIMIT 1",
                    (ext, ext),
                )
                order = cur.fetchone()
            out['returns'].append({
                'number': r.get('return_number'),
                'barcode': r.get('barcode'),
                'type': 'Отмена' if r.get('return_type') == 'cancellation' else 'Возврат',
                'status': r.get('status'),
                'statusText': label,
                'group': group,
                'description': r.get('description'),
                'reason': r.get('cancellation_reason'),
                'place': r.get('current_placement_name'),
                'address': r.get('current_placement_address'),
                'changedAt': r.get('status_changed_at') or r.get('created_at'),
                'orderId': order[0] if order else None,
                'orderNumber': order[1] if order else ext,
            })
        out['waiting'] = sum(1 for r in out['returns'] if r['group'] == 'ready')
        _sync_posting_statuses(cur, token)
    except DeliveryError as e:
        out['error'] = str(e)
    order_ = {'ready': 0, 'problem': 1, 'coming': 2, 'done': 3}
    out['returns'].sort(key=lambda r: (order_.get(r['group'], 9), r['changedAt'] or ''))
    return out
