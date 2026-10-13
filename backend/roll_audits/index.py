import json
import os

import psycopg2

from authz import AuthError, auth_error_response, require_role

HEADERS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

# Сверку проводят кладовщики и админ. Остальные (менеджер) только смотрят результаты.
SCAN_ROLES = ('storekeeper', 'senior_storekeeper', 'admin')
VIEW_ROLES = SCAN_ROLES + ('manager',)

# Что «должно лежать на складе»: рулон числится на складе, не убран, остаток есть.
EXPECTED_SQL = (
    "SELECT r.id, r.barcode, m.name, m.unit, r.remaining_quantity, r.created_at "
    "FROM rolls r JOIN materials m ON m.id = r.material_id "
    "WHERE r.status = 'in_storage' AND r.removed_at IS NULL AND r.remaining_quantity > 0 "
    "ORDER BY m.name, r.barcode"
)

STATUS_LABEL = {
    'in_storage': 'на складе',
    'in_workshop': 'в цехе',
    'completed': 'израсходован',
}


def _resp(code, body):
    return {'statusCode': code, 'headers': HEADERS, 'body': json.dumps(body, ensure_ascii=False, default=str)}


def _expected(cur):
    cur.execute(EXPECTED_SQL)
    return [
        {'rollId': r[0], 'barcode': r[1], 'material': r[2], 'unit': r[3],
         'remaining': float(r[4] or 0), 'since': r[5].isoformat() if r[5] else None}
        for r in cur.fetchall()
    ]


def _scans(cur, audit_id):
    cur.execute(
        "SELECT barcode, roll_id, result, roll_status, material_name, remaining_quantity, "
        "scanned_by_name, scanned_at FROM roll_audit_scans WHERE audit_id = %s ORDER BY scanned_at DESC, id DESC",
        (audit_id,),
    )
    return [
        {'barcode': r[0], 'rollId': r[1], 'result': r[2], 'rollStatus': r[3], 'material': r[4],
         'remaining': float(r[5]) if r[5] is not None else None, 'by': r[6],
         'at': r[7].isoformat() if r[7] else None}
        for r in cur.fetchall()
    ]


def _audit_row(r):
    return {
        'id': r[0], 'status': r[1], 'startedByName': r[2],
        'startedAt': r[3].isoformat() if r[3] else None,
        'finishedAt': r[4].isoformat() if r[4] else None,
        'finishedByName': r[5], 'expected': r[6], 'found': r[7], 'missing': r[8], 'extra': r[9],
    }


AUDIT_COLS = ("id, status, started_by_name, started_at, finished_at, finished_by_name, "
              "expected_count, found_count, missing_count, extra_count")


def _detail(cur, audit_id):
    cur.execute(f"SELECT {AUDIT_COLS}, missing_snapshot FROM roll_audits WHERE id = %s", (audit_id,))
    row = cur.fetchone()
    if not row:
        return None
    audit = _audit_row(row)
    scans = _scans(cur, audit_id)
    if audit['status'] == 'in_progress':
        scanned = {s['barcode'] for s in scans}
        expected = _expected(cur)
        missing = [e for e in expected if e['barcode'] not in scanned]
        audit['expected'] = len(expected)
        audit['found'] = sum(1 for s in scans if s['result'] == 'ok')
        audit['missing'] = len(missing)
        audit['extra'] = sum(1 for s in scans if s['result'] != 'ok')
    else:
        missing = json.loads(row[10] or '[]')
    return {'audit': audit, 'scans': scans, 'missing': missing}


def handler(event: dict, context) -> dict:
    """Сверка склада материалов: кладовщик сканирует стикеры рулонов, система показывает,
    что найдено и чего не хватает. Ничего не удаляет и не меняет в рулонах.

    GET  /                 — список сверок
    GET  /?id=N            — сверка: отсканированные, недостающие
    POST {action:'start'}  — начать (или вернуть уже идущую)
    POST {action:'scan', id, barcode}
    POST {action:'finish', id}
    POST {action:'cancel', id}
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id, X-Authorization',
            'Access-Control-Max-Age': '86400'}, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        if method == 'GET':
            require_role(cur, event, *VIEW_ROLES)
            params = event.get('queryStringParameters') or {}
            if params.get('id'):
                d = _detail(cur, int(params['id']))
                conn.commit()
                return _resp(200, d) if d else _resp(404, {'error': 'Сверка не найдена'})
            cur.execute(f"SELECT {AUDIT_COLS} FROM roll_audits WHERE status <> 'cancelled' ORDER BY id DESC LIMIT 100")
            audits = [_audit_row(r) for r in cur.fetchall()]
            conn.commit()
            return _resp(200, {'audits': audits})

        user = require_role(cur, event, *SCAN_ROLES)
        body = json.loads(event.get('body') or '{}')
        action = body.get('action')

        if action == 'start':
            cur.execute("SELECT id FROM roll_audits WHERE status = 'in_progress' ORDER BY id DESC LIMIT 1")
            row = cur.fetchone()
            if row:
                audit_id = row[0]
            else:
                cur.execute(
                    "INSERT INTO roll_audits (started_by, started_by_name) VALUES (%s, %s) RETURNING id",
                    (user['id'], user['name']),
                )
                audit_id = cur.fetchone()[0]
            d = _detail(cur, audit_id)
            conn.commit()
            return _resp(200, d)

        audit_id = int(body.get('id') or 0)
        cur.execute("SELECT status FROM roll_audits WHERE id = %s", (audit_id,))
        row = cur.fetchone()
        if not row:
            return _resp(404, {'error': 'Сверка не найдена'})
        if row[0] != 'in_progress':
            return _resp(409, {'error': 'Сверка уже завершена'})

        if action == 'scan':
            barcode = str(body.get('barcode') or '').strip().upper()
            if not barcode:
                return _resp(400, {'error': 'Пустой стикер'})
            cur.execute(
                "SELECT r.id, r.status, r.removed_at, r.remaining_quantity, m.name, m.unit "
                "FROM rolls r JOIN materials m ON m.id = r.material_id WHERE upper(r.barcode) = %s LIMIT 1",
                (barcode,),
            )
            r = cur.fetchone()
            if not r:
                result, roll_id, status_txt, mat, rem = 'unknown', None, None, None, None
            else:
                roll_id, st, removed, rem, mat, _unit = r
                on_stock = st == 'in_storage' and not removed and float(rem or 0) > 0
                result = 'ok' if on_stock else 'extra'
                status_txt = 'убран' if removed else STATUS_LABEL.get(st, st)
            cur.execute(
                "INSERT INTO roll_audit_scans (audit_id, barcode, roll_id, result, roll_status, material_name, "
                "remaining_quantity, scanned_by, scanned_by_name) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (audit_id, barcode) DO NOTHING RETURNING id",
                (audit_id, barcode, roll_id, result, status_txt, mat, rem, user['id'], user['name']),
            )
            duplicate = cur.fetchone() is None
            d = _detail(cur, audit_id)
            conn.commit()
            d['last'] = {'barcode': barcode, 'result': result, 'duplicate': duplicate,
                         'material': mat, 'rollStatus': status_txt}
            return _resp(200, d)

        if action == 'finish':
            d = _detail(cur, audit_id)
            a = d['audit']
            cur.execute(
                "UPDATE roll_audits SET status = 'done', finished_at = now(), finished_by_name = %s, "
                "expected_count = %s, found_count = %s, missing_count = %s, extra_count = %s, "
                "missing_snapshot = %s WHERE id = %s",
                (user['name'], a['expected'], a['found'], a['missing'], a['extra'],
                 json.dumps(d['missing'], ensure_ascii=False), audit_id),
            )
            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description) "
                "VALUES ('warehouse', %s, %s, 'roll_audit_finish', 'roll_audit', %s, %s)",
                (user['id'], user['name'], audit_id,
                 f"Сверка склада материалов №{audit_id}: числилось {a['expected']}, найдено {a['found']}, "
                 f"не найдено {a['missing']}, лишних {a['extra']}"),
            )
            d = _detail(cur, audit_id)
            conn.commit()
            return _resp(200, d)

        if action == 'cancel':
            cur.execute("UPDATE roll_audits SET status = 'cancelled', finished_at = now(), "
                        "finished_by_name = %s WHERE id = %s", (user['name'], audit_id))
            conn.commit()
            return _resp(200, {'success': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    except AuthError as e:
        conn.rollback()
        return auth_error_response(e, HEADERS)
    finally:
        conn.close()
