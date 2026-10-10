"""Дуэль за шляпу: швея без шляпы вызывает швею со шляпой.

Жребий кидает компьютер, жесты ни на что не влияют.
Если шляпа остаётся у хозяйки — ей +5000 вариков, а с вызвавшей списывают 2500.
Если шляпу забирают — переходит только она и оставшийся срок, варики не трогают.
Баланс вызвавшей можно увести в минус, но не ниже −10000.
"""

import secrets
from datetime import datetime, timedelta, timezone

DUEL_STAKE = 2500
HAT_BONUS = 5000
DUEL_FLOOR = -10000
DRAW_SEC = 8
PENDING_MINUTES = 2
COOLDOWN_DAYS = 5

HAT_TITLES = {
    'cowboy': 'Ковбойская шляпа',
    'crown': 'Бутафорская корона',
    'propeller': 'Пропеллер',
    'chef': 'Колпак повара',
    'wizard': 'Колпак мага',
    'sombrero': 'Сомбреро',
    'party': 'Колпак именинника',
    'ushanka': 'Ушанка',
    'tophat': 'Цилиндр',
    'viking': 'Шлем викинга',
    'catears': 'Кошачьи ушки',
    'duck': 'Уточка на голове',
    'cone': 'Дорожный конус',
    'banana': 'Банановая корона',
}


_DUEL_SCHEMA_READY = False


def ensure_duel_tables(cur):
    global _DUEL_SCHEMA_READY
    if not _DUEL_SCHEMA_READY:
        _create_duel_schema(cur)
        _DUEL_SCHEMA_READY = True
    cur.execute(
        "UPDATE variki_duels SET status = 'expired', finished_at = now() "
        "WHERE status = 'pending' AND created_at < now() - make_interval(mins => %s)",
        (PENDING_MINUTES,)
    )


def _create_duel_schema(cur):
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS bubble_hat VARCHAR(40)")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hat_boost_until TIMESTAMPTZ")
    cur.execute(
        "CREATE TABLE IF NOT EXISTS variki_duels ("
        "  id SERIAL PRIMARY KEY,"
        "  challenger_id INTEGER NOT NULL,"
        "  challenger_name TEXT,"
        "  opponent_id INTEGER NOT NULL,"
        "  opponent_name TEXT,"
        "  hat_key TEXT,"
        "  hat_title TEXT,"
        "  hat_boost_until TIMESTAMPTZ,"
        "  status TEXT NOT NULL DEFAULT 'pending',"
        "  stake INTEGER NOT NULL DEFAULT 2500,"
        "  challenger_score INTEGER NOT NULL DEFAULT 0,"
        "  opponent_score INTEGER NOT NULL DEFAULT 0,"
        "  winner_id INTEGER,"
        "  round_no INTEGER NOT NULL DEFAULT 1,"
        "  challenger_pick TEXT,"
        "  opponent_pick TEXT,"
        "  reveal_until TIMESTAMPTZ,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  accepted_at TIMESTAMPTZ,"
        "  finished_at TIMESTAMPTZ"
        ")"
    )


def _iso(value):
    if not value:
        return None
    if getattr(value, 'tzinfo', None) is None:
        return value.isoformat() + 'Z'
    return value.isoformat()


def _hat_alive(hat, until):
    if not hat or not until:
        return False
    now = datetime.now(until.tzinfo) if getattr(until, 'tzinfo', None) else datetime.utcnow()
    return until > now


def _can_pay(balance):
    return int(balance) - DUEL_STAKE >= DUEL_FLOOR


def _locks_for(cur, challenger_id):
    """Швеи со шляпой, которые уже отыграли с этой вызывающей и не проиграли.

    Замок на 5 дней только у пары: другая швея без шляпы вызвать её всё ещё может.
    Отказ и просроченный вызов замка не ставят — дуэль не состоялась.
    """
    cur.execute(
        "SELECT opponent_id, MAX(finished_at) "
        "FROM variki_duels "
        "WHERE challenger_id = %s AND status = 'finished' "
        "  AND winner_id = opponent_id "
        "  AND finished_at > now() - make_interval(days => %s) "
        "GROUP BY opponent_id",
        (int(challenger_id), COOLDOWN_DAYS),
    )
    now = datetime.now(timezone.utc)
    locks = {}
    for opponent_id, finished_at in cur.fetchall():
        if not finished_at:
            continue
        until = finished_at + timedelta(days=COOLDOWN_DAYS)
        until_aware = until if until.tzinfo else until.replace(tzinfo=timezone.utc)
        if until_aware > now:
            locks[opponent_id] = until_aware
    return locks


def _left_label(until):
    seconds = max(0, int((until - datetime.now(timezone.utc)).total_seconds()))
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    if days:
        return f'{days} д {hours} ч'
    return f'{max(1, hours)} ч'


def _busy(cur, user_id):
    cur.execute(
        "SELECT id FROM variki_duels "
        "WHERE (challenger_id = %s OR opponent_id = %s) "
        "  AND (status IN ('pending', 'active') "
        "       OR (status = 'finished' AND finished_at > now() - interval '28 seconds')) "
        "LIMIT 1",
        (int(user_id), int(user_id)),
    )
    return cur.fetchone() is not None


def _advance(cur):
    """Старые жестовые дуэли больше не продолжаются: компьютер уже решает жребий."""
    return None


_DUEL_SQL = (
    "SELECT id, challenger_id, challenger_name, opponent_id, opponent_name, "
    "  hat_key, hat_title, hat_boost_until, status, stake, "
    "  challenger_score, opponent_score, winner_id, round_no, "
    "  challenger_pick, opponent_pick, reveal_until, finished_at "
    "FROM variki_duels WHERE id = %s"
)


def _load(cur, duel_id):
    cur.execute(_DUEL_SQL, (int(duel_id),))
    return cur.fetchone()


def _avatars(cur, ids):
    if not ids:
        return {}
    cur.execute(
        "SELECT id, NULLIF(COALESCE(avatar_url, max_avatar_url), ''), "
        "  NULLIF(bubble_hat, '') "
        "FROM users WHERE id IN %s",
        (tuple(int(i) for i in ids),),
    )
    return {r[0]: {'avatarUrl': r[1], 'hat': r[2]} for r in cur.fetchall()}


def _reveal_open(reveal):
    if not reveal:
        return False
    now = datetime.now(reveal.tzinfo) if getattr(reveal, 'tzinfo', None) else datetime.utcnow()
    return reveal > now


def _phase(row, user_id):
    status = row[8]
    reveal = row[16]
    you_challenger = row[1] == int(user_id)
    if status == 'pending':
        return 'incoming' if not you_challenger else 'outgoing'
    if status == 'finished' and _reveal_open(reveal):
        return 'draw'
    if status == 'finished':
        return 'award'
    if status != 'active':
        return status
    return 'draw'


def _view_for(cur, row, user_id):
    if not row:
        return None
    you_challenger = row[1] == int(user_id)
    av = _avatars(cur, [row[1], row[3]])
    c_av = av.get(row[1], {})
    o_av = av.get(row[3], {})
    phase = _phase(row, user_id)
    revealed = phase == 'award'
    you_id = row[1] if you_challenger else row[3]
    them_id = row[3] if you_challenger else row[1]
    you = {
        'id': you_id,
        'name': row[2] if you_challenger else row[4],
        'avatarUrl': (c_av if you_challenger else o_av).get('avatarUrl'),
        'hat': None,
    }
    them = {
        'id': them_id,
        'name': row[4] if you_challenger else row[2],
        'avatarUrl': (o_av if you_challenger else c_av).get('avatarUrl'),
        'hat': None,
    }
    # Пока жребий крутится, шляпа ещё у хозяйки. На награждении — у той, кому выпал жребий.
    if revealed:
        you['hat'] = row[5] if row[12] == you_id else None
        them['hat'] = row[5] if row[12] == them_id else None
    elif you_challenger:
        them['hat'] = row[5]
    else:
        you['hat'] = row[5]
    return {
        'id': row[0],
        'status': row[8],
        'youAre': 'challenger' if you_challenger else 'opponent',
        'stake': row[9],
        'hatBonus': HAT_BONUS,
        'phase': phase,
        'you': you,
        'them': them,
        'hatTitle': row[6],
        'hatKey': row[5],
        'boostUntil': _iso(row[7]),
        'winnerId': row[12] if revealed else None,
        'youWon': (row[12] == int(user_id)) if revealed and row[12] else None,
    }


def _tv_view(cur, row):
    if not row:
        return None
    av = _avatars(cur, [row[1], row[3]])
    drawing = row[8] != 'finished' or _reveal_open(row[16])
    phase = 'draw' if drawing else 'award'
    winner_side = None
    if phase == 'award' and row[12] == row[1]:
        winner_side = 'left'
    elif phase == 'award' and row[12] == row[3]:
        winner_side = 'right'
    # Пока крутится жребий, шляпа ещё справа. На награждении она у той, кому выпало.
    hat_on = winner_side if phase == 'award' else 'right'
    return {
        'id': row[0],
        'status': row[8],
        'phase': phase,
        'stake': row[9],
        'hatBonus': HAT_BONUS,
        'hatTitle': row[6],
        'hatKey': row[5],
        'hatOn': hat_on,
        'boostUntil': _iso(row[7]),
        'winnerSide': winner_side,
        'winnerName': row[2] if winner_side == 'left' else (row[4] if winner_side == 'right' else None),
        'left': {
            'id': row[1],
            'name': row[2],
            'avatarUrl': av.get(row[1], {}).get('avatarUrl'),
        },
        'right': {
            'id': row[3],
            'name': row[4],
            'avatarUrl': av.get(row[3], {}).get('avatarUrl'),
        },
    }


def _open_for(cur, user_id):
    cur.execute(
        "SELECT id FROM variki_duels "
        "WHERE status IN ('pending', 'active') "
        "  AND (challenger_id = %s OR opponent_id = %s) "
        "ORDER BY id DESC LIMIT 1",
        (int(user_id), int(user_id)),
    )
    found = cur.fetchone()
    if not found:
        cur.execute(
            "SELECT id FROM variki_duels "
            "WHERE status = 'finished' AND finished_at > now() - interval '28 seconds' "
            "  AND (challenger_id = %s OR opponent_id = %s) "
            "ORDER BY id DESC LIMIT 1",
            (int(user_id), int(user_id)),
        )
        found = cur.fetchone()
    return _load(cur, found[0]) if found else None


def _history(cur):
    """Сыгранные дуэли: кто вышел и кто забрал победу. Отказы сюда не попадают."""
    cur.execute(
        "SELECT d.id, d.finished_at, d.winner_id, d.hat_title, "
        "  d.challenger_id, d.challenger_name, "
        "  NULLIF(COALESCE(lc.avatar_url, lc.max_avatar_url), ''), "
        "  d.opponent_id, d.opponent_name, "
        "  NULLIF(COALESCE(lo.avatar_url, lo.max_avatar_url), '') "
        "FROM variki_duels d "
        "LEFT JOIN users lc ON lc.id = d.challenger_id "
        "LEFT JOIN users lo ON lo.id = d.opponent_id "
        "WHERE d.status = 'finished' "
        "ORDER BY d.finished_at DESC NULLS LAST "
        "LIMIT 40"
    )
    out = []
    for row in cur.fetchall():
        winner = row[2]
        out.append({
            'id': row[0],
            'at': _iso(row[1]),
            'hatTitle': row[3],
            'winnerId': winner,
            'challenger': {
                'id': row[4],
                'name': row[5] or '',
                'avatarUrl': row[6],
                'won': winner == row[4],
            },
            'opponent': {
                'id': row[7],
                'name': row[8] or '',
                'avatarUrl': row[9],
                'won': winner == row[7],
            },
        })
    return out


def desk(cur, user_id):
    ensure_duel_tables(cur)
    _advance(cur)
    cur.execute(
        "SELECT full_name, role, COALESCE(variki, 0), NULLIF(bubble_hat, ''), hat_boost_until "
        "FROM users WHERE id = %s",
        (int(user_id),),
    )
    me = cur.fetchone()
    if not me:
        return 404, {'error': 'Сотрудник не найден'}
    name, role, balance, hat, until = me
    has_hat = _hat_alive(hat, until)
    cur.execute(
        "SELECT u.id, u.full_name, NULLIF(u.bubble_hat, ''), u.hat_boost_until, "
        "  NULLIF(COALESCE(u.avatar_url, u.max_avatar_url), '') "
        "FROM users u "
        "WHERE u.role = 'sewer' AND u.is_active = true AND u.id <> %s "
        "  AND NULLIF(u.bubble_hat, '') IS NOT NULL AND u.hat_boost_until > now() "
        "ORDER BY u.full_name",
        (int(user_id),),
    )
    targets = [
        {
            'id': r[0],
            'name': r[1],
            'hat': r[2],
            'hatTitle': HAT_TITLES.get(r[2], r[2]),
            'boostUntil': _iso(r[3]),
            'avatarUrl': r[4],
        }
        for r in cur.fetchall()
    ]
    locks = _locks_for(cur, user_id)
    for person in targets:
        until = locks.get(person['id'])
        person['lockedUntil'] = _iso(until) if until else None
    block = ''
    can = True
    if role != 'sewer':
        can = False
        block = 'На дуэль вызывают только швеи, и только швею'
    elif has_hat:
        can = False
        block = 'Со шляпой вызвать нельзя. Ждите, пока вызовут вас'
    elif not _can_pay(balance):
        can = False
        block = f'Проигрыш спишет {DUEL_STAKE} вариков, а баланс нельзя опустить ниже {DUEL_FLOOR}'
    elif _busy(cur, user_id):
        can = False
        block = 'У вас уже есть вызов'
    live = _view_for(cur, _open_for(cur, user_id), user_id)
    incoming = live if live and live['phase'] == 'incoming' else None
    outgoing = live if live and live['phase'] == 'outgoing' else None
    return 200, {
        'balance': int(balance),
        'role': role,
        'hasHat': has_hat,
        'hatTitle': HAT_TITLES.get(hat) if has_hat else None,
        'canChallenge': can and not live,
        'blockReason': block,
        'stake': DUEL_STAKE,
        'hatBonus': HAT_BONUS,
        'floor': DUEL_FLOOR,
        'targets': targets,
        'incoming': incoming,
        'outgoing': outgoing,
        'live': live,
        'name': name,
        'history': _history(cur),
    }


def tv_state(cur):
    ensure_duel_tables(cur)
    _advance(cur)
    cur.execute(
        "SELECT id FROM variki_duels "
        "WHERE status = 'active' "
        "   OR (status = 'finished' AND finished_at > now() - interval '28 seconds') "
        "ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC LIMIT 1"
    )
    found = cur.fetchone()
    row = _load(cur, found[0]) if found else None
    return 200, {'duel': _tv_view(cur, row)}


def challenge(cur, user_id, opponent_id):
    ensure_duel_tables(cur)
    _advance(cur)
    if not user_id or not opponent_id or int(user_id) == int(opponent_id):
        return 400, {'error': 'Выберите соперницу'}
    ids = sorted((int(user_id), int(opponent_id)))
    cur.execute(
        "SELECT id, full_name, role, COALESCE(variki, 0), NULLIF(bubble_hat, ''), hat_boost_until "
        "FROM users WHERE id IN %s ORDER BY id FOR UPDATE",
        (tuple(ids),),
    )
    people = {r[0]: r for r in cur.fetchall()}
    me = people.get(int(user_id))
    other = people.get(int(opponent_id))
    if not me or not other:
        return 404, {'error': 'Сотрудник не найден'}
    if me[2] != 'sewer' or other[2] != 'sewer':
        return 409, {'error': 'Дуэль только между швеями'}
    if _hat_alive(me[4], me[5]):
        return 409, {'error': 'Со шляпой вызвать на дуэль нельзя'}
    if not _hat_alive(other[4], other[5]):
        return 409, {'error': 'У этой швеи нет действующей шляпы'}
    if not _can_pay(me[3]):
        return 409, {'error': f'Проигрыш спишет {DUEL_STAKE} вариков, а баланс нельзя опустить ниже {DUEL_FLOOR}'}
    if _busy(cur, user_id) or _busy(cur, opponent_id):
        return 409, {'error': 'Кто-то из вас уже в дуэли'}
    locked_until = _locks_for(cur, user_id).get(int(opponent_id))
    if locked_until:
        return 409, {'error': f'{other[1]} уже отыграла дуэль и не отдала шляпу. Снова вызвать её можно через {_left_label(locked_until)}'}
    cur.execute(
        "INSERT INTO variki_duels (challenger_id, challenger_name, opponent_id, opponent_name, "
        "  hat_key, hat_title, hat_boost_until, status, stake) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending', %s) RETURNING id",
        (int(user_id), me[1], int(opponent_id), other[1], other[4],
         HAT_TITLES.get(other[4], other[4]), other[5], DUEL_STAKE),
    )
    duel_id = cur.fetchone()[0]
    return 200, {'duel': _view_for(cur, _load(cur, duel_id), user_id)}


def answer(cur, user_id, duel_id, accept):
    ensure_duel_tables(cur)
    cur.execute(
        "SELECT id FROM variki_duels WHERE id = %s AND status = 'pending' "
        "AND opponent_id = %s FOR UPDATE",
        (int(duel_id), int(user_id)),
    )
    if not cur.fetchone():
        return 404, {'error': 'Вызов уже не актуален'}
    if not accept:
        cur.execute(
            "UPDATE variki_duels SET status = 'declined', finished_at = now() WHERE id = %s",
            (int(duel_id),),
        )
        return 200, {'declined': True}
    row = _load(cur, duel_id)
    ids = sorted((row[1], row[3]))
    cur.execute(
        "SELECT id, COALESCE(variki, 0), NULLIF(bubble_hat, ''), hat_boost_until, role "
        "FROM users WHERE id IN %s ORDER BY id FOR UPDATE",
        (tuple(ids),),
    )
    people = {r[0]: r for r in cur.fetchall()}
    me = people[row[3]]
    other = people[row[1]]
    if not _hat_alive(me[2], me[3]) or me[4] != 'sewer' or other[4] != 'sewer':
        cur.execute(
            "UPDATE variki_duels SET status = 'expired', finished_at = now() WHERE id = %s",
            (int(duel_id),),
        )
        return 409, {'error': 'Шляпа уже не действует'}
    if _hat_alive(other[2], other[3]):
        return 409, {'error': 'Соперница уже со шляпой — дуэль не начать'}
    if not _can_pay(other[1]):
        return 409, {'error': f'У вызвавшей проигрыш спишет {DUEL_STAKE}, а баланс нельзя опустить ниже {DUEL_FLOOR}'}
    winner_id = row[1] if secrets.randbelow(2) == 0 else row[3]
    cur.execute(
        "UPDATE variki_duels SET accepted_at = now(), "
        "  hat_key = %s, hat_title = %s, hat_boost_until = %s "
        "WHERE id = %s",
        (me[2], HAT_TITLES.get(me[2], me[2]), me[3], int(duel_id)),
    )
    _finish(cur, _load(cur, duel_id), winner_id)
    return 200, {'duel': _view_for(cur, _load(cur, duel_id), user_id)}


def _audit(cur, user_id, name, duel_id, text):
    cur.execute(
        "INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description) "
        "VALUES ('variki', %s, %s, 'variki_duel', 'variki_duel', %s, %s)",
        (int(user_id), name or '', int(duel_id), text),
    )


def _finish(cur, row, winner_id):
    """Жребий уже выпал. Шляпа и варики двигаются сразу, телевизор ещё крутит паузу."""
    challenger_id, opponent_id = row[1], row[3]
    hat_owner_won = int(winner_id) == int(opponent_id)
    if hat_owner_won:
        cur.execute(
            "UPDATE users SET variki = GREATEST(%s, COALESCE(variki, 0) - %s) WHERE id = %s "
            "RETURNING COALESCE(variki, 0)",
            (DUEL_FLOOR, DUEL_STAKE, int(challenger_id)),
        )
        challenger_balance = cur.fetchone()[0]
        cur.execute(
            "UPDATE users SET variki = COALESCE(variki, 0) + %s WHERE id = %s "
            "RETURNING COALESCE(variki, 0)",
            (HAT_BONUS, int(opponent_id)),
        )
        owner_balance = cur.fetchone()[0]
        _audit(
            cur, challenger_id, row[2], row[0],
            f'Жребий: шляпа осталась у соперницы, −{DUEL_STAKE} вариков, баланс {challenger_balance}',
        )
        _audit(
            cur, opponent_id, row[4], row[0],
            f'Жребий: шляпа осталась, +{HAT_BONUS} вариков, баланс {owner_balance}',
        )
    else:
        cur.execute(
            "UPDATE users SET bubble_hat = %s, hat_boost_until = %s WHERE id = %s",
            (row[5], row[7], int(challenger_id)),
        )
        cur.execute(
            "UPDATE users SET bubble_hat = NULL, hat_boost_until = NULL "
            "WHERE id = %s AND bubble_hat = %s",
            (int(opponent_id), row[5]),
        )
        _audit(
            cur, challenger_id, row[2], row[0],
            f'Жребий: забрала шляпу «{row[6] or ""}», варики не менялись',
        )
        _audit(
            cur, opponent_id, row[4], row[0],
            f'Жребий: шляпа «{row[6] or ""}» ушла, варики не менялись',
        )
    cur.execute(
        "UPDATE variki_duels SET status = 'finished', winner_id = %s, finished_at = now(), "
        "  reveal_until = now() + make_interval(secs => %s) WHERE id = %s",
        (int(winner_id), DRAW_SEC, row[0]),
    )


def pick(cur, user_id, duel_id, gesture):
    return 409, {'error': 'Жест больше не нужен: жребий решает компьютер'}


def handle_duel_get(cur, params):
    if params.get('duelTv'):
        return tv_state(cur)
    if params.get('duel'):
        user_id = params.get('userId')
        if not str(user_id or '').isdigit():
            return 400, {'error': 'Укажите сотрудника'}
        return desk(cur, user_id)
    return None


def handle_duel_post(cur, action, body):
    user_id = body.get('userId')
    if not str(user_id or '').isdigit():
        return 400, {'error': 'Укажите сотрудника'}
    if action == 'duel_challenge':
        return challenge(cur, user_id, body.get('opponentId'))
    if action == 'duel_answer':
        return answer(cur, user_id, body.get('duelId'), bool(body.get('accept')))
    if action == 'duel_pick':
        return pick(cur, user_id, body.get('duelId'), (body.get('pick') or '').strip())
    return None
