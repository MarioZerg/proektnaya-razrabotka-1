"""Кнопка «Синхронизировать фото из MAX» в «Пользователях».

Фото берётся из описания личного чата сотрудника с ботом (см. max_avatar.py).
Номер чата бот запоминает при каждом входе, поэтому обновить можно только тех,
кто входил через MAX после 07.11.2026. Фото, поставленное вручную, не трогаем.
"""

from max_avatar import refresh_max_avatar


def sync_max_avatars(cur) -> dict:
    """Обновляет фото у всех, у кого известен личный чат с ботом."""
    cur.execute(
        "SELECT max_user_id FROM users "
        "WHERE max_user_id IS NOT NULL AND max_user_id <> '' AND is_active "
        "AND archived_at IS NULL"
    )
    ids = [r[0] for r in cur.fetchall()]
    updated = 0
    no_chat = 0
    for max_id in ids:
        cur.execute("SELECT max_chat_id FROM users WHERE max_user_id = %s LIMIT 1", (max_id,))
        row = cur.fetchone()
        if not row or not row[0]:
            no_chat += 1
            continue
        try:
            if refresh_max_avatar(cur, max_id, force=True) == 'updated':
                updated += 1
        except Exception as e:  # noqa: BLE001
            print(f'max avatar sync {max_id}: {type(e).__name__}: {e}')
    return {
        'updated': updated,
        # «Нет данных»: человек ещё не входил через бота после обновления.
        'missing': len(ids) - updated,
        'noChat': no_chat,
        'total': len(ids),
    }
