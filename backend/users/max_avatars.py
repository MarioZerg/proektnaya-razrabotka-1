"""Подтягивает фото профилей MAX в users.max_avatar_url.

Аватар пишется при входе через бота. Если человек сменил фото или бот его
не запомнил — админ жмёт синхронизацию в «Пользователи». Ручное фото
(avatar_url) не трогаем: оно главнее мессенджера.
"""

import os

import certifi
import requests

MAX_API_URL = 'https://platform-api2.max.ru'
CHUNK = 50


def _max_get(user_ids: list[str]) -> dict:
    token = os.environ.get('MAX_BOT_TOKEN')
    if not token:
        raise RuntimeError('В функции users нет MAX_BOT_TOKEN — синхронизация недоступна')
    params = [('user_ids', uid) for uid in user_ids]
    kwargs = {
        'params': params,
        'headers': {'Authorization': token},
        'timeout': 20,
    }
    try:
        resp = requests.get(f'{MAX_API_URL}/users', verify=certifi.where(), **kwargs)
    except requests.exceptions.SSLError:
        # Сайт MAX подписан российским УЦ, которого нет в стандартном certifi.
        resp = requests.get(f'{MAX_API_URL}/users', verify=False, **kwargs)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


def _avatar_of(user: dict) -> str:
    return (user.get('avatar_url') or user.get('photo_url') or '').strip()


def sync_max_avatars(cur) -> dict:
    """Обновляет max_avatar_url у всех, у кого есть max_user_id."""
    cur.execute(
        "SELECT id, max_user_id FROM users "
        "WHERE max_user_id IS NOT NULL AND max_user_id <> '' "
        "AND archived_at IS NULL"
    )
    rows = cur.fetchall()
    if not rows:
        return {'updated': 0, 'missing': 0, 'total': 0}

    by_max = {str(max_id): user_id for user_id, max_id in rows}
    ids = list(by_max.keys())
    found: dict[str, str] = {}
    for i in range(0, len(ids), CHUNK):
        data = _max_get(ids[i:i + CHUNK])
        users = data.get('users') or data.get('members') or []
        if isinstance(data, list):
            users = data
        for user in users:
            uid = str(user.get('user_id') or user.get('id') or '')
            url = _avatar_of(user)
            if uid and url:
                found[uid] = url

    updated = 0
    for max_id, url in found.items():
        user_id = by_max.get(max_id)
        if not user_id:
            continue
        cur.execute(
            "UPDATE users SET max_avatar_url = %s, updated_at = now() WHERE id = %s",
            (url, user_id),
        )
        updated += 1

    return {
        'updated': updated,
        'missing': len(rows) - updated,
        'total': len(rows),
    }
