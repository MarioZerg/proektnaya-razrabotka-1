"""Гонка живого цеха: от ателье до замка.

Длина пути — норма п.м. швеи из настроек цеха (seamstress_daily_limit).
Швея двигается по фактически сшитому сегодня метражу. Первая, кто набрала
норму, входит в замок и получает 50 вариков. Один приз в московские сутки.
На телевизоре метраж не показываем — только кто где на тропе.
"""

from shared import CANCELLED_SQL, get_setting_int

RACE_PRIZE = 50
DEFAULT_METERS = 250
_MSK_TODAY = "((now() + interval '3 hours')::date)"
_MSK_TODAY_START = "((now() + interval '3 hours')::date - interval '3 hours')"


def workshop_race_meters(cur, people: list) -> int:
    ids = {p.get('workshopId') for p in people if p.get('workshopId')}
    best = 0
    for wid in ids or [None]:
        m = get_setting_int(cur, wid, 'live_race_meters', 0)
        if not m:
            m = get_setting_int(cur, wid, 'seamstress_daily_limit', 0)
        if m > best:
            best = m
    return best or DEFAULT_METERS


def _meters_map(cur, people: list) -> dict:
    """Сколько п.м. сегодня у каждого, по роли на смене. width в заказах — см."""
    out = {p['id']: 0.0 for p in people}
    groups = {
        'sewer': [p['id'] for p in people if p.get('role') == 'sewer'],
        'cutter': [p['id'] for p in people if p.get('role') == 'cutter'],
        'packer': [
            p['id'] for p in people
            if p.get('role') in ('packer', 'packer_returns')
        ],
    }
    queries = [
        (
            groups['sewer'],
            "SELECT o.sewer_user_id, COALESCE(SUM(o.width), 0) FROM orders o "
            f"WHERE o.sewn_at >= {_MSK_TODAY_START} AND o.sewer_user_id = ANY(%s) "
            f"AND NOT ({CANCELLED_SQL}) GROUP BY o.sewer_user_id",
        ),
        (
            groups['cutter'],
            "SELECT o.cutter_user_id, COALESCE(SUM(o.width), 0) FROM orders o "
            f"WHERE o.cut_at >= {_MSK_TODAY_START} AND o.cutter_user_id = ANY(%s) "
            f"AND NOT ({CANCELLED_SQL}) GROUP BY o.cutter_user_id",
        ),
        (
            groups['packer'],
            "SELECT o.packer_user_id, COALESCE(SUM(o.width), 0) FROM orders o "
            f"WHERE o.packed_at >= {_MSK_TODAY_START} AND o.packer_user_id = ANY(%s) "
            f"AND NOT ({CANCELLED_SQL}) GROUP BY o.packer_user_id",
        ),
    ]
    for ids, sql in queries:
        if not ids:
            continue
        cur.execute(sql, (ids,))
        for uid, cm in cur.fetchall():
            out[int(uid)] = float(cm or 0) / 100.0
    return out


def _stored_winner(cur):
    try:
        cur.execute(
            "SELECT winner_user_id, winner_name, variki FROM floor_race_wins "
            f"WHERE race_date = {_MSK_TODAY}"
        )
        row = cur.fetchone()
        if not row:
            return None
        return {'id': row[0], 'name': row[1], 'variki': row[2]}
    except Exception:
        return 'missing-table'


def _award_first_sewer(cur, conn, meters: int, people: list):
    sewer_ids = [p['id'] for p in people if p.get('role') == 'sewer']
    if not sewer_ids:
        return None
    goal_cm = int(round(max(1, meters) * 100))
    cur.execute(
        "SELECT sewer_user_id FROM ("
        "  SELECT o.sewer_user_id, o.sewn_at, o.id, "
        "         SUM(o.width) OVER ("
        "           PARTITION BY o.sewer_user_id ORDER BY o.sewn_at, o.id"
        "         ) AS cum "
        "  FROM orders o "
        f"  WHERE o.sewn_at >= {_MSK_TODAY_START} AND o.sewer_user_id = ANY(%s) "
        f"    AND NOT ({CANCELLED_SQL})"
        ") t WHERE cum >= %s ORDER BY sewn_at, id LIMIT 1",
        (sewer_ids, goal_cm),
    )
    hit = cur.fetchone()
    if not hit:
        return None
    uid = hit[0]
    name = next((p['name'] for p in people if p['id'] == uid), '')
    cur.execute(
        "INSERT INTO floor_race_wins (race_date, winner_user_id, winner_name, steps, variki) "
        f"VALUES ({_MSK_TODAY}, %s, %s, %s, %s) "
        "ON CONFLICT (race_date) DO NOTHING RETURNING winner_user_id",
        (uid, name, meters, RACE_PRIZE),
    )
    inserted = cur.fetchone()
    if inserted:
        cur.execute(
            "UPDATE users SET variki = COALESCE(variki, 0) + %s WHERE id = %s",
            (RACE_PRIZE, uid),
        )
        cur.execute(
            "INSERT INTO audit_log (category, user_id, user_name, action, "
            "  entity_type, entity_id, description) "
            "VALUES ('variki', %s, %s, 'floor_race_win', 'user', %s, %s)",
            (uid, name, uid,
             f'Гонка живого цеха: первая в замке, +{RACE_PRIZE} вариков'),
        )
        conn.commit()
    return {'id': uid, 'name': name, 'variki': RACE_PRIZE}


def build_race(cur, conn, people: list, _today: dict) -> dict:
    meters = workshop_race_meters(cur, people)
    goal = float(max(1, meters))
    winner = None
    stored = _stored_winner(cur)
    if stored == 'missing-table':
        try:
            conn.rollback()
        except Exception:
            pass
        stored = None
    elif stored:
        winner = stored
    else:
        try:
            winner = _award_first_sewer(cur, conn, meters, people)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            winner = None

    done_map = _meters_map(cur, people)
    runners = []
    for p in people:
        done = float(done_map.get(p['id']) or 0)
        progress = min(1.0, done / goal)
        runners.append({
            'id': p['id'],
            'name': p['name'],
            'role': p['role'],
            'avatarUrl': p.get('avatarUrl'),
            'progress': round(progress, 4),
            'finished': progress >= 1,
        })
    runners.sort(key=lambda r: (-r['progress'], r['name']))
    for i, r in enumerate(runners):
        r['place'] = i + 1

    return {
        'prize': RACE_PRIZE,
        'winner': winner,
        'runners': runners,
    }
