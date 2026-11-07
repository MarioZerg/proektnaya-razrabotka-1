"""Сообщаем сайту мегатюль.рф, что заказ ушёл из «Новых» в работу.

Покупатель на сайте может сам отменить оплаченный заказ, пока тот в «Новых».
Как только хоть одну вещь заказа отдали на конвейер (взяли в крой, закрыли со
склада, сменили статус руками), отменять нельзя — кнопку отмены на сайте нужно
убрать. Сам сайт стадию в ERP не знает, поэтому ERP сообщает её:

    POST <сайт>/api/crm/orders/<site_order_id>/stage   {"stage": "work" | "new"}

Что уже сообщили, хранится в orders.site_stage_sent — повторно не шлём, а
расхождение (стадия изменилась, прошлый вызов не дошёл) находит sweep(). Его
зовут после каждого действия в функции заказов и планировщик раз в 5 минут.
Ошибка связи с сайтом конвейеру не мешает: только запись в журнал.

Файл одинаковый в backend/orders и backend/site_orders.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

SHOP_CODE = 'megatul_site'
DEFAULT_SITE_URL = 'https://xn--80aff0ab3b6do.xn--p1ai'

# Стадия заказа сайта по его вещам: «work», если хоть одна живая вещь ушла
# дальше «Новых»; «new», если все живые вещи в «Новых». Целиком отменённые
# заказы не трогаем — отмену сайт знает сам.
_STAGE_SQL = (
    "SELECT site_order_id, "
    "  bool_or(COALESCE(sewing_status, 'Новый') NOT IN ('Новый', 'Отменён')) AS work, "
    "  max(site_stage_sent) AS sent "
    "FROM orders "
    "WHERE marketplace = 'IM' AND site_order_id IS NOT NULL "
    "  AND created_at > now() - interval '60 days' "
    "  AND cancelled_at IS NULL AND COALESCE(status, '') <> 'Отменён' "
    "  AND COALESCE(sewing_status, '') <> 'Отменён' "
    "GROUP BY site_order_id "
    "HAVING (bool_or(COALESCE(sewing_status, 'Новый') NOT IN ('Новый', 'Отменён')) "
    "        AND max(site_stage_sent) IS DISTINCT FROM 'work') "
    "    OR (NOT bool_or(COALESCE(sewing_status, 'Новый') NOT IN ('Новый', 'Отменён')) "
    "        AND max(site_stage_sent) = 'work') "
    "LIMIT 30"
)


def _site(cur):
    cur.execute(
        "SELECT mi.is_enabled, mi.credentials FROM marketplace_integrations mi "
        "JOIN shops s ON s.id = mi.shop_id "
        "WHERE mi.marketplace_code = 'internet_shop' AND s.code = %s LIMIT 1",
        (SHOP_CODE,),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return None, None
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    key = (creds.get('apiKey') or '').strip()
    url = (creds.get('siteUrl') or DEFAULT_SITE_URL).strip().rstrip('/')
    if not url.startswith('http'):
        url = 'https://' + url
    return (url, key) if key else (None, None)


def _send(url, key, sid, stage):
    req = urllib.request.Request(
        f'{url}/api/crm/orders/{urllib.parse.quote(str(sid))}/stage',
        data=json.dumps({'stage': stage}).encode(),
        method='POST',
        headers={'Content-Type': 'application/json', 'X-Api-Key': key,
                 'Authorization': f'Bearer {key}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:  # noqa: BLE001
        return 0


def _log(cur, sid, text):
    try:
        cur.execute(
            "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, "
            "  entity_id, description) "
            "VALUES (NULL, 'Система', 'integration', 'site_stage', 'site_order', NULL, %s)",
            (f'мегатюль.рф {sid}: {text}'[:900],),
        )
    except Exception:  # noqa: BLE001
        pass


def sweep(cur):
    """Сообщить сайту все расхождения стадий. Возвращает {sent, failed}."""
    cur.execute(_STAGE_SQL)
    rows = cur.fetchall()
    if not rows:
        return {'sent': 0, 'failed': 0}
    url, key = _site(cur)
    if not url:
        return {'sent': 0, 'failed': 0}
    sent = failed = 0
    for sid, work, _prev in rows:
        stage = 'work' if work else 'new'
        status = _send(url, key, sid, stage)
        if status in (200, 404):
            # 404 — заказа на сайте нет: повторять бессмысленно.
            cur.execute(
                "UPDATE orders SET site_stage_sent = %s WHERE marketplace = 'IM' AND site_order_id = %s",
                (stage, sid),
            )
            sent += 1
            _log(cur, sid, f'стадия «{stage}» передана сайту'
                 + (' (заказа на сайте нет)' if status == 404 else ''))
        else:
            failed += 1
            _log(cur, sid, f'не удалось передать стадию «{stage}» (ответ {status or "нет связи"}), '
                           'повтор через 5 минут')
    return {'sent': sent, 'failed': failed}


def sweep_safely(dsn):
    """Отдельное соединение: сбой здесь не откатывает и не задерживает работу цеха."""
    try:
        import psycopg2
        conn = psycopg2.connect(dsn)
        try:
            res = sweep(conn.cursor())
            conn.commit()
            return res
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        print(f'site_stage sweep failed: {type(e).__name__}: {e}')
        return None
