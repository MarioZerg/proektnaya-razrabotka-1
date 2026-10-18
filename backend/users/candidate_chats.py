"""Чаты Авито с кандидатами на вакансии.

Мессенджер Авито один на весь кабинет: там и покупатели тюля, и люди,
которые пишут по вакансии. В ERP оставляем только вакансии. У объявления
работы в ссылке есть /vakansii/, либо в названии стоит должность.

Когда кандидат начинает диалог, администраторам уходит одно сообщение в MAX.
Сама переписка открывается во вкладке «Чаты с кандидатами».
"""

import json
import os
from datetime import datetime, timezone

import requests

from russian_ca import ca_bundle


AVITO_API = 'https://api.avito.ru'
MAX_API_URL = 'https://platform-api2.max.ru'
# Тот же адрес, что у функции пользователей: Авито шлёт webhook сюда.
WEBHOOK_URL = 'https://functions.poehali.dev/1db3a89a-f0f6-470e-bef4-fb5ca8fa02df'

_tokens = {}


def ensure_tables(cur) -> None:
    cur.execute(
        "CREATE TABLE IF NOT EXISTS avito_candidate_chats ("
        "  id SERIAL PRIMARY KEY,"
        "  avito_chat_id TEXT NOT NULL UNIQUE,"
        "  avito_account_id BIGINT NOT NULL,"
        "  shop_id INT,"
        "  item_id BIGINT,"
        "  item_title TEXT,"
        "  item_url TEXT,"
        "  candidate_name TEXT,"
        "  candidate_avito_id BIGINT,"
        "  last_message TEXT,"
        "  last_message_at TIMESTAMPTZ,"
        "  unread BOOLEAN NOT NULL DEFAULT true,"
        "  notified_at TIMESTAMPTZ,"
        "  status TEXT NOT NULL DEFAULT 'new',"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    )
    # Таблица могла появиться раньше, чем статусы. Колонку добавляем отдельно,
    # чтобы уже сохранённые диалоги не потерялись.
    cur.execute(
        "ALTER TABLE avito_candidate_chats "
        "ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'"
    )
    cur.execute(
        "CREATE TABLE IF NOT EXISTS avito_candidate_messages ("
        "  id SERIAL PRIMARY KEY,"
        "  chat_row_id INT NOT NULL REFERENCES avito_candidate_chats(id) ON DELETE CASCADE,"
        "  avito_message_id TEXT NOT NULL UNIQUE,"
        "  direction TEXT NOT NULL,"
        "  body TEXT,"
        "  created_at TIMESTAMPTZ NOT NULL"
        ")"
    )


def _credentials(cur):
    """Включённые кабинеты Avito. Ключи лежат в интеграциях, не в коде."""
    cur.execute(
        "SELECT shop_id, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'avito' AND is_enabled = true"
    )
    found = []
    for shop_id, raw in cur.fetchall():
        if isinstance(raw, str):
            raw = json.loads(raw or '{}')
        creds = raw if isinstance(raw, dict) else {}
        client_id = (creds.get('clientId') or '').strip()
        secret = (creds.get('clientSecret') or '').strip()
        if client_id and secret:
            found.append({'shopId': shop_id, 'clientId': client_id, 'clientSecret': secret})
    if not found:
        raise RuntimeError(
            'Подключите Avito в настройках интеграций: Client ID и Client Secret'
        )
    return found


def _token(client_id: str, client_secret: str) -> str:
    cached = _tokens.get(client_id)
    now = datetime.now(timezone.utc).timestamp()
    if cached and cached['exp'] > now + 30:
        return cached['token']
    resp = requests.post(
        f'{AVITO_API}/token',
        data={
            'grant_type': 'client_credentials',
            'client_id': client_id,
            'client_secret': client_secret,
        },
        timeout=15,
    )
    if resp.status_code >= 400:
        raise RuntimeError('Авито не принял ключи кабинета. Проверьте Client ID и Client Secret')
    data = resp.json()
    token = data.get('access_token')
    if not token:
        raise RuntimeError('Авито не выдал токен')
    _tokens[client_id] = {
        'token': token,
        'exp': now + int(data.get('expires_in') or 3600),
    }
    return token


def _headers(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


def _account_id(token: str) -> int:
    resp = requests.get(
        f'{AVITO_API}/core/v1/accounts/self',
        headers=_headers(token),
        timeout=15,
    )
    resp.raise_for_status()
    return int(resp.json()['id'])


def _message_text(content) -> str:
    if not isinstance(content, dict):
        return ''
    if content.get('text'):
        return str(content['text'])
    image = content.get('image')
    if isinstance(image, dict) and image:
        return 'Фото'
    link = content.get('link') or {}
    if isinstance(link, dict) and (link.get('text') or link.get('url')):
        return str(link.get('text') or link.get('url'))
    item = content.get('item') or {}
    if isinstance(item, dict) and item.get('title'):
        return str(item['title'])
    return ''


def _from_unix(value):
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def is_vacancy(chat: dict) -> bool:
    """Вакансия, а не карточка тюля. Покупательские чаты сюда не кладём."""
    value = ((chat.get('context') or {}).get('value') or {})
    url = str(value.get('url') or '').lower()
    title = str(value.get('title') or '').lower()
    if '/vakansii/' in url:
        return True
    return any(word in title for word in ('шве', 'закрой', 'бухгалтер', 'вакан'))


def _candidate(chat: dict, account_id: int):
    other = None
    for user in chat.get('users') or []:
        if int(user.get('id') or 0) != int(account_id):
            other = user
            break
    other = other or {}
    value = ((chat.get('context') or {}).get('value') or {})
    return {
        'name': other.get('name') or 'Кандидат',
        'avitoId': other.get('id'),
        'itemId': value.get('id'),
        'title': value.get('title') or 'Вакансия',
        'url': value.get('url') or '',
    }


def _upsert_chat(cur, chat: dict, account_id: int, shop_id) -> int:
    info = _candidate(chat, account_id)
    last = chat.get('last_message') or {}
    text = _message_text(last.get('content'))
    when = _from_unix(last.get('created') or chat.get('updated') or chat.get('created'))
    cur.execute(
        "INSERT INTO avito_candidate_chats ("
        "  avito_chat_id, avito_account_id, shop_id, item_id, item_title, item_url,"
        "  candidate_name, candidate_avito_id, last_message, last_message_at, updated_at"
        ") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now()) "
        "ON CONFLICT (avito_chat_id) DO UPDATE SET "
        "  avito_account_id = EXCLUDED.avito_account_id,"
        "  shop_id = EXCLUDED.shop_id,"
        "  item_id = EXCLUDED.item_id,"
        "  item_title = EXCLUDED.item_title,"
        "  item_url = EXCLUDED.item_url,"
        "  candidate_name = EXCLUDED.candidate_name,"
        "  candidate_avito_id = EXCLUDED.candidate_avito_id,"
        "  last_message = COALESCE(EXCLUDED.last_message, avito_candidate_chats.last_message),"
        "  last_message_at = COALESCE(EXCLUDED.last_message_at, avito_candidate_chats.last_message_at),"
        "  updated_at = now() "
        "RETURNING id",
        (
            chat['id'], account_id, shop_id, info['itemId'], info['title'], info['url'],
            info['name'], info['avitoId'], text or None, when,
        ),
    )
    return cur.fetchone()[0]


def _save_message(cur, row_id: int, message_id: str, direction: str, body: str, when) -> bool:
    """True, если такого сообщения ещё не было."""
    if not message_id or not when:
        return False
    cur.execute(
        "INSERT INTO avito_candidate_messages "
        "(chat_row_id, avito_message_id, direction, body, created_at) "
        "VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT (avito_message_id) DO NOTHING "
        "RETURNING id",
        (row_id, message_id, direction, body or '', when),
    )
    return cur.fetchone() is not None


def _notify_admins(cur, row_id: int, preview: str) -> None:
    cur.execute(
        "SELECT candidate_name, item_title, notified_at "
        "FROM avito_candidate_chats WHERE id = %s",
        (row_id,),
    )
    row = cur.fetchone()
    if not row or row[2]:
        return
    name, title, _ = row
    cur.execute(
        "UPDATE avito_candidate_chats SET notified_at = now() "
        "WHERE id = %s AND notified_at IS NULL",
        (row_id,),
    )
    if cur.rowcount == 0:
        return
    # Только утверждённые администраторы. Менеджер и остальные должности
    # этот чат в MAX не получают, даже если у них привязан мессенджер.
    cur.execute(
        "SELECT DISTINCT u.max_user_id FROM users u "
        "JOIN user_roles ur ON ur.user_id = u.id "
        "WHERE ur.role = 'admin' AND ur.is_approved = true "
        "  AND u.is_active = true AND u.archived_at IS NULL "
        "  AND u.max_user_id IS NOT NULL AND u.max_user_id <> ''"
    )
    targets = [r[0] for r in cur.fetchall()]
    text = (
        'Кандидат написал на Авито\n'
        f'{name or "Кандидат"} · {title or "вакансия"}\n'
        f'«{(preview or "новое сообщение")[:300]}»\n'
        'Откройте Настройки → Пользователи → Чаты с кандидатами'
    )
    for max_user_id in targets:
        try:
            requests.post(
                f'{MAX_API_URL}/messages',
                params={'user_id': max_user_id},
                json={'text': text},
                headers={'Authorization': os.environ['MAX_BOT_TOKEN']},
                timeout=8,
                verify=ca_bundle(),
            ).raise_for_status()
        except Exception:
            # Диалог уже сохранён. Сбой мессенджера не должен его откатывать.
            pass


def _pull_messages(cur, token: str, account_id: int, avito_chat_id: str, row_id: int) -> None:
    resp = requests.get(
        f'{AVITO_API}/messenger/v3/accounts/{account_id}/chats/{avito_chat_id}/messages/',
        headers=_headers(token),
        params={'limit': 100, 'offset': 0},
        timeout=20,
    )
    resp.raise_for_status()
    fresh_in = False
    preview = ''
    for message in resp.json() or []:
        when = _from_unix(message.get('created'))
        body = _message_text(message.get('content'))
        direction = message.get('direction') or 'in'
        if _save_message(cur, row_id, message.get('id'), direction, body, when) and direction == 'in':
            fresh_in = True
            preview = body or preview
    if fresh_in and preview:
        _notify_admins(cur, row_id, preview)


def _mark_old_as_seen(cur, row_id: int) -> None:
    """Старые диалоги, которые мы только что увидели, в MAX не дублируем."""
    cur.execute(
        "UPDATE avito_candidate_chats SET notified_at = now() "
        "WHERE id = %s AND notified_at IS NULL "
        "  AND (last_message_at IS NULL OR last_message_at < now() - interval '20 minutes')",
        (row_id,),
    )


def sync_chats(cur) -> dict:
    ensure_tables(cur)
    total = 0
    webhook_error = ''
    for account in _credentials(cur):
        token = _token(account['clientId'], account['clientSecret'])
        account_id = _account_id(token)
        offset = 0
        for _page in range(3):
            resp = requests.get(
                f'{AVITO_API}/messenger/v2/accounts/{account_id}/chats',
                headers=_headers(token),
                params={'chat_types': 'u2i', 'limit': 100, 'offset': offset},
                timeout=20,
            )
            resp.raise_for_status()
            chats = (resp.json() or {}).get('chats') or []
            for chat in chats:
                if not is_vacancy(chat):
                    continue
                row_id = _upsert_chat(cur, chat, account_id, account['shopId'])
                _mark_old_as_seen(cur, row_id)
                last = chat.get('last_message') or {}
                if last.get('id'):
                    _save_message(
                        cur, row_id, last['id'], last.get('direction') or 'in',
                        _message_text(last.get('content')),
                        _from_unix(last.get('created')),
                    )
                    if last.get('direction') == 'in':
                        _notify_admins(cur, row_id, _message_text(last.get('content')))
                total += 1
            if len(chats) < 100:
                break
            offset += 100
        try:
            hook = requests.post(
                f'{AVITO_API}/messenger/v3/webhook',
                headers={**_headers(token), 'Content-Type': 'application/json'},
                json={'url': WEBHOOK_URL},
                timeout=15,
            )
            if hook.status_code >= 400:
                webhook_error = 'Авито не включил уведомления о новых сообщениях'
        except requests.RequestException:
            webhook_error = 'Не удалось включить уведомления Авито'
    return {'synced': total, 'webhookError': webhook_error}


STATUSES = ('new', 'selected', 'meeting', 'rejected')


def list_chats(cur) -> dict:
    ensure_tables(cur)
    cur.execute(
        "SELECT id, candidate_name, item_title, item_url, last_message, "
        "       last_message_at, unread, COALESCE(status, 'new') "
        "FROM avito_candidate_chats "
        "ORDER BY last_message_at DESC NULLS LAST, id DESC"
    )
    chats = []
    for row in cur.fetchall():
        chats.append({
            'id': row[0],
            'candidateName': row[1] or 'Кандидат',
            'vacancyTitle': row[2] or 'Вакансия',
            'vacancyUrl': row[3] or '',
            'lastMessage': row[4] or '',
            'lastMessageAt': row[5].isoformat() if row[5] else None,
            'unread': bool(row[6]),
            'status': row[7] if row[7] in STATUSES else 'new',
        })
    return {'chats': chats}


def set_status(cur, row_id: int, status: str) -> None:
    if status not in STATUSES:
        raise RuntimeError('Неизвестный статус кандидата')
    ensure_tables(cur)
    cur.execute(
        "UPDATE avito_candidate_chats SET status = %s, updated_at = now() WHERE id = %s",
        (status, int(row_id)),
    )
    if cur.rowcount == 0:
        raise RuntimeError('Диалог не найден')


def load_thread(cur, row_id: int, live: bool = True) -> dict:
    ensure_tables(cur)
    cur.execute(
        "SELECT id, avito_chat_id, avito_account_id, shop_id, candidate_name, "
        "       item_title, item_url "
        "FROM avito_candidate_chats WHERE id = %s",
        (int(row_id),),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError('Диалог не найден')
    chat_id, avito_chat_id, account_id, shop_id = row[0], row[1], row[2], row[3]
    # live=False — только то, что webhook уже положил в базу. Экран опрашивает
    # это каждые несколько секунд и не ходит в Авито на каждый тик.
    if live:
        for account in _credentials(cur):
            if shop_id and account['shopId'] != shop_id:
                continue
            token = _token(account['clientId'], account['clientSecret'])
            try:
                _pull_messages(cur, token, account_id, avito_chat_id, chat_id)
                requests.post(
                    f'{AVITO_API}/messenger/v1/accounts/{account_id}/chats/{avito_chat_id}/read',
                    headers=_headers(token),
                    timeout=10,
                )
            except requests.RequestException:
                # Показываем то, что уже сохранено, даже если Авито сейчас не ответил.
                pass
            break
        cur.execute(
            "UPDATE avito_candidate_chats SET unread = false, updated_at = now() WHERE id = %s",
            (chat_id,),
        )
    cur.execute(
        "SELECT direction, body, created_at FROM avito_candidate_messages "
        "WHERE chat_row_id = %s ORDER BY created_at, id",
        (chat_id,),
    )
    messages = [
        {
            'direction': m[0],
            'text': m[1] or '',
            'createdAt': m[2].isoformat() if m[2] else None,
        }
        for m in cur.fetchall()
    ]
    return {
        'chat': {
            'id': chat_id,
            'candidateName': row[4] or 'Кандидат',
            'vacancyTitle': row[5] or 'Вакансия',
            'vacancyUrl': row[6] or '',
        },
        'messages': messages,
    }


def send_reply(cur, row_id: int, text: str) -> dict:
    text = (text or '').strip()
    if not text:
        raise RuntimeError('Напишите сообщение')
    if len(text) > 1000:
        raise RuntimeError('Авито принимает сообщение до 1000 символов')
    ensure_tables(cur)
    cur.execute(
        "SELECT avito_chat_id, avito_account_id, shop_id "
        "FROM avito_candidate_chats WHERE id = %s",
        (int(row_id),),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError('Диалог не найден')
    avito_chat_id, account_id, shop_id = row
    sent = None
    for account in _credentials(cur):
        if shop_id and account['shopId'] != shop_id:
            continue
        token = _token(account['clientId'], account['clientSecret'])
        resp = requests.post(
            f'{AVITO_API}/messenger/v1/accounts/{account_id}/chats/{avito_chat_id}/messages',
            headers={**_headers(token), 'Content-Type': 'application/json'},
            json={'message': {'text': text}, 'type': 'text'},
            timeout=15,
        )
        if resp.status_code >= 400:
            raise RuntimeError('Авито не принял сообщение')
        sent = resp.json()
        break
    if sent is None:
        raise RuntimeError('Не найден кабинет Avito для этого диалога')
    when = _from_unix(sent.get('created')) or datetime.now(timezone.utc)
    _save_message(cur, int(row_id), sent.get('id') or f'out-{when.timestamp()}', 'out', text, when)
    cur.execute(
        "UPDATE avito_candidate_chats SET last_message = %s, last_message_at = %s, "
        "updated_at = now() WHERE id = %s",
        (text, when, int(row_id)),
    )
    return {'ok': True}


def is_webhook(body: dict) -> bool:
    payload = body.get('payload') if isinstance(body, dict) else None
    if not isinstance(payload, dict) or payload.get('type') != 'message':
        return False
    value = payload.get('value')
    return isinstance(value, dict) and bool(value.get('chat_id'))


def handle_webhook(cur, body: dict) -> None:
    """Входящее сообщение. Не-вакансии молча пропускаем и отвечаем 200."""
    ensure_tables(cur)
    value = body['payload']['value']
    if value.get('chat_type') not in (None, 'u2i'):
        return
    account_id = int(value.get('user_id') or 0)
    author_id = int(value.get('author_id') or 0)
    direction = 'out' if account_id and author_id == account_id else 'in'
    chat_id = str(value['chat_id'])
    cur.execute(
        "SELECT id, shop_id FROM avito_candidate_chats WHERE avito_chat_id = %s",
        (chat_id,),
    )
    existing = cur.fetchone()
    if not existing:
        chat = _fetch_chat(cur, account_id, chat_id)
        if not chat or not is_vacancy(chat):
            return
        shop_id = _shop_for_account(cur, account_id)
        row_id = _upsert_chat(cur, chat, account_id, shop_id)
    else:
        row_id = existing[0]
    body_text = _message_text(value.get('content'))
    when = _from_unix(value.get('created')) or datetime.now(timezone.utc)
    created = _save_message(cur, row_id, value.get('id'), direction, body_text, when)
    cur.execute(
        "UPDATE avito_candidate_chats SET last_message = %s, last_message_at = %s, "
        "unread = %s, updated_at = now() WHERE id = %s",
        (body_text, when, direction == 'in', row_id),
    )
    if created and direction == 'in':
        _notify_admins(cur, row_id, body_text)


def _shop_for_account(cur, account_id: int):
    cur.execute(
        "SELECT shop_id FROM avito_candidate_chats "
        "WHERE avito_account_id = %s AND shop_id IS NOT NULL LIMIT 1",
        (account_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _fetch_chat(cur, account_id: int, chat_id: str):
    for account in _credentials(cur):
        token = _token(account['clientId'], account['clientSecret'])
        try:
            owner = _account_id(token)
        except (requests.RequestException, KeyError, ValueError, RuntimeError):
            continue
        if account_id and owner != account_id:
            continue
        resp = requests.get(
            f'{AVITO_API}/messenger/v2/accounts/{owner}/chats/{chat_id}',
            headers=_headers(token),
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json()
    return None
