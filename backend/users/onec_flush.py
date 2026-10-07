import base64
import json
import urllib.error
import urllib.request


def flush_onec_outbox(cur, limit=20):
    """Отправляем очередь в 1С. Ошибка обмена не должна ронять учётную запись."""
    sync_salary_accruals(cur)
    try:
        cur.execute(
            "SELECT is_enabled, credentials FROM marketplace_integrations "
            "WHERE marketplace_code = 'onec_buh' "
            "ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1"
        )
        row = cur.fetchone()
        if not row or not row[0]:
            return
        creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
        base = (creds.get('baseUrl') or '').strip().rstrip('/')
        if not base:
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
    except Exception:
        pass


_ENTITY_SQL = {
    'supplier': (
        "SELECT id, name, phone, address, comment, currency FROM suppliers WHERE id = %s",
        ('id', 'name', 'phone', 'address', 'comment', 'currency'),
    ),
    'employee': (
        "SELECT id, full_name, email, phone, role, login, workshop, salary FROM users WHERE id = %s",
        ('id', 'fullName', 'email', 'phone', 'role', 'login', 'workshop', 'salary'),
    ),
    'material': (
        "SELECT m.id, m.name, m.unit, m.status, m.type_id, t.name FROM materials m "
        "LEFT JOIN material_types t ON t.id = m.type_id WHERE m.id = %s",
        ('id', 'name', 'unit', 'status', 'typeId', 'typeName'),
    ),
}


def enqueue_onec_entity(cur, entity, entity_id):
    """Кладём поставщика / сотрудника / материал в очередь 1С.

    Триггеры в БД проекта создавать нельзя, поэтому очередь пишет код.
    Ошибка здесь не должна ронять карточку."""
    sql, keys = _ENTITY_SQL[entity]
    try:
        cur.execute(sql, (int(entity_id),))
        row = cur.fetchone()
        if row:
            payload = dict(zip(keys, row))
            cur.execute(
                "INSERT INTO onec_outbox (entity, entity_id, payload) VALUES (%s, %s, %s::jsonb)",
                (entity, int(entity_id), json.dumps(payload, ensure_ascii=False, default=str)),
            )
    except Exception:
        pass


def sync_salary_accruals(cur, limit=500):
    """Начисления пишут многие функции (киоск, конвейер, рулоны…). Вместо триггера
    догоняем очередь: всё, что новее последнего salary_accrual в onec_outbox
    (история до запуска отсечена строкой status='baseline')."""
    try:
        cur.execute(
            "INSERT INTO onec_outbox (entity, entity_id, payload) "
            "SELECT 'salary_accrual', a.id, jsonb_build_object("
            "  'id', a.id, 'userId', a.user_id, 'fullName', u.full_name, 'type', a.type, "
            "  'amount', a.amount, 'description', a.description, "
            "  'accruedFor', a.accrued_for, 'orderId', a.order_id) "
            "FROM salary_accruals a LEFT JOIN users u ON u.id = a.user_id "
            "WHERE a.id > (SELECT COALESCE(MAX(entity_id), 0) FROM onec_outbox WHERE entity = 'salary_accrual') "
            "ORDER BY a.id LIMIT %s "
            "ON CONFLICT (entity, entity_id) WHERE entity = 'salary_accrual' DO NOTHING",
            (limit,),
        )
    except Exception:
        pass
