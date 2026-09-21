"""Кто именно делает запрос — единая проверка для всех функций.

ЗАЧЕМ ЭТОТ ФАЙЛ.

Раньше исполнитель приходил в теле запроса: actorId, actorRole. Проверки прав
в коде были, но опирались на данные, которые сотрудник задаёт сам. Из консоли
браузера любой мог отправить запрос с чужим id или с ролью admin — и списать
материал от чужого имени. Кнопки на экране при этом ничего не решают: кнопку
можно не нажимать, а запрос отправить напрямую.

Теперь при входе выдаётся токен. Он лежит в таблице auth_sessions, и сервер по
нему сам определяет, кто пришёл и какая у него роль. Тело запроса на права
больше не влияет — подделывать нечего.

Файл одинаковый во всех функциях: правило доступа должно быть ОДНО. Разошлись
копии — разойдутся и права, а дыру потом ищут месяцами.
"""


class AuthError(Exception):
    """Доступа нет. code — что вернуть наружу: 401 (не вошёл) или 403 (не положено)."""

    def __init__(self, message: str, code: int = 403):
        super().__init__(message)
        self.message = message
        self.code = code


def _token_from_event(event: dict) -> str:
    """Достаёт токен из заголовков.

    Заголовок Authorization облачный провайдер до функции не доносит — платформа
    перекладывает его в X-Authorization. Поэтому читаем оба, плюс X-Auth-Token:
    так запрос работает и из браузера, и из наших внутренних вызовов.
    """
    headers = event.get('headers') or {}
    # Регистр заголовков зависит от того, кто прислал запрос, — сравниваем в нижнем.
    lower = {str(k).lower(): v for k, v in headers.items()}
    raw = (
        lower.get('x-auth-token')
        or lower.get('x-authorization')
        or lower.get('authorization')
        or ''
    )
    raw = str(raw).strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return raw


def current_user(cur, event: dict):
    """Возвращает того, кто прислал запрос, либо None.

    Никаких данных из тела запроса не читает — только токен. Заодно продлевает
    сессию: в цехе планшет не выключают неделями, и человек не должен
    внезапно оказаться разлогинен посреди смены.
    """
    token = _token_from_event(event)
    if not token:
        return None

    cur.execute(
        "SELECT s.user_id, s.role, s.real_user_id, u.full_name, u.is_active, "
        "       u.contract_terminated_at "
        "FROM auth_sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = %s AND s.expires_at > now()",
        (token,),
    )
    row = cur.fetchone()
    if not row:
        return None

    user_id, role, real_user_id, full_name, is_active, terminated_at = row
    # Уволенный сотрудник не работает, даже если токен у него остался.
    if not is_active or terminated_at:
        return None

    cur.execute(
        "UPDATE auth_sessions SET last_seen_at = now(), "
        "expires_at = now() + interval '30 days' WHERE token = %s",
        (token,),
    )

    return {
        'id': int(user_id),
        'name': full_name,
        'role': role,
        # Кто на самом деле за клавиатурой. Админ может смотреть панель сотрудника
        # его глазами — в журнале должно остаться имя администратора.
        'realUserId': int(real_user_id) if real_user_id else int(user_id),
    }


def require_auth(cur, event: dict):
    """Пускает только вошедшего. Иначе — 401."""
    user = current_user(cur, event)
    if not user:
        raise AuthError('Войдите в систему заново — сессия не найдена или истекла', 401)
    return user


def require_role(cur, event: dict, *roles: str):
    """Пускает только перечисленные роли.

    Пример: require_role(cur, event, 'admin') — только администратор.
    """
    user = require_auth(cur, event)
    if user['role'] not in roles:
        raise AuthError(_denied_text(roles), 403)
    return user


def require_admin(cur, event: dict):
    """Только администратор. Самая частая проверка — вынесена отдельно."""
    return require_role(cur, event, 'admin')


def _denied_text(roles) -> str:
    """Человеческий текст отказа вместо «403 Forbidden»."""
    titles = {
        'admin': 'администратор',
        'manager': 'менеджер',
        'senior_storekeeper': 'старший кладовщик',
        'storekeeper': 'кладовщик',
        'cutter': 'закройщик',
        'sewer': 'швея',
        'packer': 'упаковщик',
    }
    named = [titles.get(r, r) for r in roles]
    if len(named) == 1:
        return f'Это действие доступно только: {named[0]}'
    return 'Это действие доступно только: ' + ', '.join(named)


def auth_error_response(err: AuthError, headers: dict) -> dict:
    """Готовый ответ на отказ — чтобы во всех функциях он выглядел одинаково."""
    import json as _json

    return {
        'statusCode': err.code,
        'headers': headers,
        'body': _json.dumps({'error': err.message}, ensure_ascii=False),
    }
