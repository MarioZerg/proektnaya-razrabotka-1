import base64
import json
import urllib.error
import urllib.request


def flush_onec_outbox(cur, limit=20):
    """Отправляем очередь в 1С. Ошибка обмена не должна ронять карточку поставщика."""
    cur.execute('SAVEPOINT onec_flush')
    try:
        cur.execute(
            "SELECT is_enabled, credentials FROM marketplace_integrations "
            "WHERE marketplace_code = 'onec_buh' "
            "ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
        )
        row = cur.fetchone()
        if not row or not row[0]:
            cur.execute('RELEASE SAVEPOINT onec_flush')
            return
        creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
        base = (creds.get('baseUrl') or '').strip().rstrip('/')
        if not base:
            cur.execute('RELEASE SAVEPOINT onec_flush')
            return
        username = (creds.get('username') or '').strip()
        password = creds.get('password') or ''
        cur.execute(
            "SELECT id, entity, entity_id, payload FROM onec_outbox "
            "WHERE status = 'pending' ORDER BY id LIMIT %s",
            (limit,),
        )
        for oid, entity, entity_id, payload in cur.fetchall():
            data = payload if isinstance(payload, dict) else json.loads(payload or '{}')
            body = json.dumps({
                'source': 'crm',
                'entity': entity,
                'id': entity_id,
                'payload': data,
            }, ensure_ascii=False, default=str).encode('utf-8')
            req = urllib.request.Request(
                base, data=body, method='POST',
                headers={'Content-Type': 'application/json'},
            )
            if username:
                token = base64.b64encode(f'{username}:{password}'.encode('utf-8')).decode('ascii')
                req.add_header('Authorization', f'Basic {token}')
            try:
                with urllib.request.urlopen(req, timeout=12) as resp:
                    resp.read()
                cur.execute(
                    "UPDATE onec_outbox SET status = 'sent', sent_at = now(), "
                    "last_error = NULL, attempts = attempts + 1 WHERE id = %s",
                    (oid,),
                )
            except urllib.error.HTTPError as e:
                raw = e.read().decode('utf-8', errors='replace')[:400]
                cur.execute(
                    "UPDATE onec_outbox SET attempts = attempts + 1, last_error = %s WHERE id = %s",
                    (f'HTTP {e.code}: {raw}', oid),
                )
            except Exception as e:
                cur.execute(
                    "UPDATE onec_outbox SET attempts = attempts + 1, last_error = %s WHERE id = %s",
                    (str(e)[:400], oid),
                )
        cur.execute('RELEASE SAVEPOINT onec_flush')
    except Exception:
        cur.execute('ROLLBACK TO SAVEPOINT onec_flush')
