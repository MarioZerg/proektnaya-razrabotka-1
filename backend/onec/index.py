import base64
import json
import os
import urllib.error
import urllib.request

import psycopg2


def handler(event: dict, context) -> dict:
    """Очередь обмена с 1С:Бухгалтерией.

    Документы и справочники сначала попадают в onec_outbox (поставки после
    подтверждения бухгалтером, поставщики, сотрудники, материалы, начисления,
    остатки склада). Эта функция забирает очередь и POST-ит JSON на URL
    из виджета интеграций (marketplace_code='onec_buh').

    GET  /              — сколько ещё не ушло
    POST / {action:'flush'} — отправить пачку pending
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    dsn = os.environ['DATABASE_URL']

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        if method == 'GET':
            cur.execute(
                "SELECT status, COUNT(*) FROM onec_outbox GROUP BY status"
            )
            counts = {r[0]: int(r[1]) for r in cur.fetchall()}
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'counts': counts}, ensure_ascii=False),
            }

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action') or 'flush'
        if action != 'flush':
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Неизвестное действие'}),
            }

        result = flush_onec_outbox(cur, limit=int(body_data.get('limit') or 20))
        conn.commit()
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(result, ensure_ascii=False),
        }
    finally:
        conn.close()


def load_onec_creds(cur):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'onec_buh' "
        "ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return None
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    base = (creds.get('baseUrl') or '').strip().rstrip('/')
    if not base:
        return None
    return {
        'baseUrl': base,
        'username': (creds.get('username') or '').strip(),
        'password': creds.get('password') or '',
    }


def post_to_onec(creds, entity, entity_id, payload):
    body = json.dumps({
        'source': 'crm',
        'entity': entity,
        'id': entity_id,
        'payload': payload,
    }, ensure_ascii=False, default=str).encode('utf-8')
    req = urllib.request.Request(
        creds['baseUrl'],
        data=body,
        method='POST',
        headers={'Content-Type': 'application/json'},
    )
    if creds['username']:
        token = base64.b64encode(
            f"{creds['username']}:{creds['password']}".encode('utf-8')
        ).decode('ascii')
        req.add_header('Authorization', f'Basic {token}')
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            resp.read()
        return True, None
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', errors='replace')[:400]
        return False, f'HTTP {e.code}: {raw}'
    except Exception as e:
        return False, str(e)[:400]


def flush_onec_outbox(cur, limit=20):
    creds = load_onec_creds(cur)
    if not creds:
        return {'sent': 0, 'failed': 0, 'error': '1С не подключена: включите интеграцию и укажите URL'}

    cur.execute(
        "SELECT id, entity, entity_id, payload FROM onec_outbox "
        "WHERE status = 'pending' ORDER BY id LIMIT %s",
        (limit,),
    )
    rows = cur.fetchall()
    sent = 0
    failed = 0
    last_error = None
    for oid, entity, entity_id, payload in rows:
        data = payload if isinstance(payload, dict) else json.loads(payload or '{}')
        ok, err = post_to_onec(creds, entity, entity_id, data)
        if ok:
            cur.execute(
                "UPDATE onec_outbox SET status = 'sent', sent_at = now(), "
                "last_error = NULL, attempts = attempts + 1 WHERE id = %s",
                (oid,),
            )
            if entity == 'supplier_supply':
                cur.execute(
                    "UPDATE shipments SET onec_synced_at = now(), onec_error = NULL "
                    "WHERE id = %s",
                    (int(entity_id),),
                )
            sent += 1
        else:
            last_error = err
            cur.execute(
                "UPDATE onec_outbox SET attempts = attempts + 1, last_error = %s WHERE id = %s",
                (err, oid),
            )
            if entity == 'supplier_supply':
                cur.execute(
                    "UPDATE shipments SET onec_error = %s WHERE id = %s",
                    (err, int(entity_id)),
                )
            failed += 1
    return {'sent': sent, 'failed': failed, 'error': last_error}
