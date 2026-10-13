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

def _resp(code, body):
    return {'statusCode': code, 'headers': HEADERS, 'body': json.dumps(body, ensure_ascii=False, default=str)}


def _expected(cur):
    cur.execute(EXPECTED_SQL)
    return [
        {'rollId': r[0], 'barcode': r[1], 'material': r[2], 'unit': r[3],
         'remaining': float(r[4] or 0), 'since': r[5].isoformat() if r[5] else None}
        for r in cur.fetchall()
    ]


def _scanned_barcodes(cur, audit_id):
    cur.execute("SELECT barcode FROM roll_audit_scans WHERE audit_id = %s AND result = 'ok'", (audit_id,))
    return [r[0] for r in cur.fetchall()]


def _audit_row(r):
    return {
        'id': r[0], 'status': r[1], 'startedByName': r[2],
        'startedAt': r[3].isoformat() if r[3] else None,
        'finishedAt': r[4].isoformat() if r[4] else None,
        'finishedByName': r[5], 'expected': r[6], 'found': r[7], 'missing': r[8],
    }


AUDIT_COLS = ("id, status, started_by_name, started_at, finished_at, finished_by_name, "
              "expected_count, found_count, missing_count")


def _get_audit(cur, audit_id):
    cur.execute(f"SELECT {AUDIT_COLS}, missing_snapshot FROM roll_audits WHERE id = %s", (audit_id,))
    return cur.fetchone()


def handler(event: dict, context) -> dict:
    """Сверка склада материалов: кладовщик сканирует стикеры рулонов, система показывает,
    что найдено и чего не хватает. Ничего не удаляет и не меняет в рулонах.

    GET  /                 — список сверок
    GET  /?id=N            — сверка: найденные стикеры, недостающие рулоны
    POST {action:'start'}  — начать/продолжить; отдаёт список «числится на складе» целиком
    POST {action:'scan', id, barcodes:[...]} — сохранить пачку сканов (только числящиеся на складе)
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
                row = _get_audit(cur, int(params['id']))
                if not row:
                    return _resp(404, {'error': 'Сверка не найдена'})
                audit = _audit_row(row)
                found = _scanned_barcodes(cur, audit['id'])
                if audit['status'] == 'in_progress':
                    done = set(found)
                    missing = [e for e in _expected(cur) if e['barcode'] not in done]
                    audit['found'], audit['missing'] = len(found), len(missing)
                    audit['expected'] = len(found) + len(missing)
                else:
                    missing = json.loads(row[9] or '[]')
                conn.commit()
                return _resp(200, {'audit': audit, 'found': found, 'missing': missing})
            cur.execute(f"SELECT {AUDIT_COLS} FROM roll_audits WHERE status <> 'cancelled' ORDER BY id DESC LIMIT 100")
            audits = [_audit_row(r) for r in cur.fetchall()]
            conn.commit()
            return _resp(200, {'audits': audits})

        user = require_role(cur, event, *SCAN_ROLES)
        body = json.loads(event.get('body') or '{}')
        action = body.get('action')

        # Старт: один раз отдаём весь список «что числится на складе» и уже
        # засчитанные стикеры. Дальше сверка идёт в браузере, без запроса на каждый скан.
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
            audit = _audit_row(_get_audit(cur, audit_id))
            expected = _expected(cur)
            found = _scanned_barcodes(cur, audit_id)
            conn.commit()
            return _resp(200, {'audit': audit, 'expected': expected, 'found': found})

        audit_id = int(body.get('id') or 0)
        cur.execute("SELECT status FROM roll_audits WHERE id = %s", (audit_id,))
        row = cur.fetchone()
        if not row:
            return _resp(404, {'error': 'Сверка не найдена'})
        if row[0] != 'in_progress':
            return _resp(409, {'error': 'Сверка уже завершена'})

        # Сохранение пачкой: браузер копит сканы и присылает их разом. Засчитываем
        # только стикеры рулонов, которые числятся на складе, — всё остальное отбрасываем.
        if action == 'scan':
            codes = body.get('barcodes')
            if codes is None:
                codes = [body.get('barcode')]
            codes = list({str(c).strip().upper() for c in codes if c and str(c).strip()})[:500]
            if not codes:
                return _resp(200, {'saved': []})
            cur.execute(
                "INSERT INTO roll_audit_scans (audit_id, barcode, roll_id, result, roll_status, material_name, "
                "remaining_quantity, scanned_by, scanned_by_name) "
                "SELECT %s, upper(r.barcode), r.id, 'ok', 'на складе', m.name, r.remaining_quantity, %s, %s "
                "FROM rolls r JOIN materials m ON m.id = r.material_id "
                "WHERE upper(r.barcode) = ANY(%s) AND r.status = 'in_storage' AND r.removed_at IS NULL "
                "AND r.remaining_quantity > 0 "
                "ON CONFLICT (audit_id, barcode) DO NOTHING RETURNING barcode",
                (audit_id, user['id'], user['name'], codes),
            )
            saved = [r[0] for r in cur.fetchall()]
            conn.commit()
            return _resp(200, {'saved': saved})

        if action == 'finish':
            found = _scanned_barcodes(cur, audit_id)
            done = set(found)
            missing = [e for e in _expected(cur) if e['barcode'] not in done]
            expected_n = len(found) + len(missing)
            cur.execute(
                "UPDATE roll_audits SET status = 'done', finished_at = now(), finished_by_name = %s, "
                "expected_count = %s, found_count = %s, missing_count = %s, extra_count = 0, "
                "missing_snapshot = %s WHERE id = %s",
                (user['name'], expected_n, len(found), len(missing),
                 json.dumps(missing, ensure_ascii=False), audit_id),
            )
            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description) "
                "VALUES ('warehouse', %s, %s, 'roll_audit_finish', 'roll_audit', %s, %s)",
                (user['id'], user['name'], audit_id,
                 f"Сверка склада материалов №{audit_id}: числилось {expected_n}, найдено {len(found)}, "
                 f"не найдено {len(missing)}"),
            )
            conn.commit()
            return _resp(200, {'success': True})

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
