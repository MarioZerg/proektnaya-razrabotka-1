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
        'accountant': 'бухгалтер',
        'senior_storekeeper': 'старший кладовщик',
        'storekeeper': 'кладовщик',
        'cutter': 'закройщик',
        'sewer': 'швея',
        'packer': 'упаковщик',
        'packer_returns': 'упаковщица-возвраты',
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


# ---------------------------------------------------------------------------
# ПРИВРАТНИК ДЛЯ ФУНКЦИЙ, КОТОРЫЕ ЕЩЁ ВЕРЯТ actorId ИЗ ЗАПРОСА.
#
# Часть функций писалась до токенов: «кто я» они берут из actorId в запросе,
# а их адреса видны любому, кто открыл сайт. guard_request() ставится первой
# строкой обработчика и:
#   * пропускает служебные вызовы — расписание и функции друг друга — по ключу
#     CRON_SECRET (заголовок X-Cron-Secret или cronSecret в запросе);
#   * всех остальных пускает только с действующим токеном входа;
#   * ЗАМЕНЯЕТ actorId (и actorRole, если прислан) на того, кто вошёл.
#     Все старые проверки «только админ» / «только свои данные» начинают
#     опираться на правду, а не на то, что прислал браузер.
# Кто вошёл — кладётся в event['authUser'] для новых проверок.
# ---------------------------------------------------------------------------

_ACTOR_ID_KEYS = ('actorId', 'actor_id')
_ACTOR_ROLE_KEYS = ('actorRole', 'actor_role')


def request_method(event: dict) -> str:
    return str(event.get('httpMethod') or 'GET').upper()


def request_query(event: dict) -> dict:
    return event.get('queryStringParameters') or {}


def request_body(event: dict) -> dict:
    """Тело запроса как dict; не JSON или не объект — пустой dict."""
    import json as _json

    try:
        data = _json.loads(event.get('body') or '{}')
    except (ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def service_call(event: dict) -> bool:
    """Вызов от расписания или другой функции: верный CRON_SECRET в запросе."""
    import hmac
    import json as _json
    import os

    secret = os.environ.get('CRON_SECRET') or ''
    if not secret:
        return False
    lower = {str(k).lower(): v for k, v in (event.get('headers') or {}).items()}
    candidates = [lower.get('x-cron-secret'), (event.get('queryStringParameters') or {}).get('cronSecret')]
    try:
        body = _json.loads(event.get('body') or '{}')
        if isinstance(body, dict):
            candidates.append(body.get('cronSecret'))
    except (ValueError, TypeError):
        pass
    return any(
        isinstance(c, str) and c and hmac.compare_digest(c.encode(), secret.encode())
        for c in candidates
    )


def _pin_actor(event: dict, user: dict) -> None:
    """actorId в адресе и в теле запроса — всегда тот, кто вошёл."""
    import json as _json

    qs = dict(event.get('queryStringParameters') or {})
    qs['actorId'] = str(user['id'])
    if 'actor_id' in qs:
        qs['actor_id'] = str(user['id'])
    for k in _ACTOR_ROLE_KEYS:
        if k in qs:
            qs[k] = user['role']
    event['queryStringParameters'] = qs

    raw = event.get('body')
    if not raw:
        return
    try:
        data = _json.loads(raw)
    except (ValueError, TypeError):
        return
    if not isinstance(data, dict):
        return
    data['actorId'] = user['id']
    if 'actor_id' in data:
        data['actor_id'] = user['id']
    for k in _ACTOR_ROLE_KEYS:
        if k in data:
            data[k] = user['role']
    event['body'] = _json.dumps(data, ensure_ascii=False)
    event['isBase64Encoded'] = False


GUARD_HEADERS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}


def guard_request(event: dict, headers: dict = None, public=None, roles=None):
    """Первая строка обработчика. None — пропускаем дальше, иначе готовый отказ.

    public(event) -> bool — запросы, которым вход не нужен (телевизор, вебхук).
    roles — если задано, пускает только эти роли (кроме служебных вызовов).
    """
    import os

    import psycopg2

    headers = headers or GUARD_HEADERS
    if str(event.get('httpMethod') or '').upper() == 'OPTIONS':
        return None
    if public is not None and public(event):
        return None
    if service_call(event):
        event['serviceCall'] = True
        return None

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        user = current_user(cur, event)
        conn.commit()
    finally:
        conn.close()

    if not user:
        return auth_error_response(
            AuthError('Войдите в систему заново — сессия не найдена или истекла', 401), headers)
    if roles and user['role'] not in roles:
        return auth_error_response(AuthError(_denied_text(roles), 403), headers)

    _pin_actor(event, user)
    event['authUser'] = user
    return None
