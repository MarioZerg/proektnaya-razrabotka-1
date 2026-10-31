"""Чат поддержки мегатюль.рф: покупатели пишут из личного кабинета, ERP читает и отвечает."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

# Счётчик непрочитанных спрашивают все открытые вкладки админов раз в минуту —
# тёплая копия функции отдаёт его из памяти, не дёргая сайт на каждый запрос.
_UNREAD_CACHE = {}


def _call(method, url, api_key, payload=None):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={'Accept': 'application/json', 'Content-Type': 'application/json; charset=utf-8',
                 'X-Api-Key': api_key, 'Authorization': f'Bearer {api_key}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode('utf-8') or '{}')
        except Exception:
            body = {}
        return e.code, body
    except Exception as e:
        return 0, {'error': str(e)}


def _error(code, body):
    if code in (401, 403):
        return 'Сайт не принял ключ доступа — проверьте ключ в «Подключении»'
    if code == 404:
        return 'Сайт пока не отдаёт чаты (адрес /api/crm/chats не найден)'
    if code == 0:
        return f'Сайт не отвечает: {body.get("error", "")}'.strip()
    return body.get('error') or f'Сайт ответил ошибкой {code}'


def list_chats(site_url, api_key):
    code, body = _call('GET', f'{site_url}/api/crm/chats', api_key)
    if code != 200:
        return 502, {'error': _error(code, body)}
    chats = body.get('chats') or []
    chats.sort(key=lambda c: c.get('updatedAt') or '', reverse=True)
    unread = sum(int(c.get('unread') or 0) for c in chats)
    _UNREAD_CACHE.update({'at': time.monotonic(), 'value': _unread_payload(chats)})
    return 200, {'chats': chats, 'unread': unread}


def _unread_payload(chats):
    with_unread = [c for c in chats if int(c.get('unread') or 0) > 0]
    last = with_unread[0] if with_unread else None
    return {
        'unread': sum(int(c.get('unread') or 0) for c in with_unread),
        'chats': len(with_unread),
        'lastClient': ((last or {}).get('client') or {}).get('name') if last else None,
        'lastText': ((last or {}).get('lastMessage') or {}).get('text') if last else None,
    }


def unread(site_url, api_key):
    cached = _UNREAD_CACHE.get('value')
    if cached is not None and time.monotonic() - _UNREAD_CACHE.get('at', 0) < 30:
        return 200, cached
    code, body = _call('GET', f'{site_url}/api/crm/chats', api_key)
    if code != 200:
        return 502, {'error': _error(code, body), 'unread': 0}
    chats = sorted(body.get('chats') or [], key=lambda c: c.get('updatedAt') or '', reverse=True)
    payload = _unread_payload(chats)
    _UNREAD_CACHE.update({'at': time.monotonic(), 'value': payload})
    return 200, payload


def get_chat(site_url, api_key, account_id):
    aid = urllib.parse.quote(str(account_id), safe='')
    code, body = _call('GET', f'{site_url}/api/crm/chats/{aid}', api_key)
    if code != 200:
        return 502, {'error': _error(code, body)}
    chat = body.get('chat') if isinstance(body.get('chat'), dict) else body
    return 200, {'chat': chat}


def mark_read(site_url, api_key, account_id):
    aid = urllib.parse.quote(str(account_id), safe='')
    code, body = _call('POST', f'{site_url}/api/crm/chats/{aid}/read', api_key, {})
    _UNREAD_CACHE.clear()
    if code >= 300 or code == 0:
        return 502, {'error': _error(code, body)}
    return 200, {'success': True}


def send(site_url, api_key, account_id, text, author, order_number):
    text = (text or '').strip()
    if not text:
        return 400, {'error': 'Напишите текст сообщения'}
    if len(text) > 4000:
        return 400, {'error': 'Сообщение слишком длинное'}
    payload = {'text': text}
    if author:
        payload['author'] = author
    if order_number:
        payload['orderNumber'] = order_number
    aid = urllib.parse.quote(str(account_id), safe='')
    code, body = _call('POST', f'{site_url}/api/crm/chats/{aid}/messages', api_key, payload)
    if code >= 300 or code == 0:
        return 502, {'error': _error(code, body)}
    # Ответили — значит прочитали.
    _call('POST', f'{site_url}/api/crm/chats/{aid}/read', api_key, {})
    _UNREAD_CACHE.clear()
    return 200, {'success': True}
