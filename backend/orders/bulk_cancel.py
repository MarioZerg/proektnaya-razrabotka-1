"""Массовое снятие FBS-заказов с конвейера, когда закончился материал.

ЗАЧЕМ.

Ткань кончилась — а в очереди стоит сотня заказов именно из неё. Шить их нечем,
и каждый час простоя — это просрочка отгрузки и штраф от площадки. Раньше админ
снимал такие заказы по одному: открыть, отменить, потом руками отменить в кабинете
маркетплейса. На сотне заказов это полдня работы, и половину всё равно забывали
отменить на площадке — там они висели как «ожидают сборки».

Здесь это делается одной кнопкой: выбрать материал и снять всё, что по нему ещё
НЕ ТРОНУТО в цехе.

ЧТО СНИМАЕТСЯ, А ЧТО НЕТ.

Снимается только то, во что ещё не вложен труд и материал:
  · тип заказа FBS (FBO и индивидуальные не трогаем — там своя логика отгрузки);
  · этап «Новый» — заказ никто не взял;
  · по заказу нет ни одного списания материала (не раскроен);
  · заказ не попал в поставку (supply_id пуст).

Раскроенный, шьющийся, отшитый заказ не снимается НИКОГДА: ткань уже разрезана,
швея уже получила за него деньги — отменять поздно, вещь нужно довести и отгрузить.

СВЯЗКИ ЯНДЕКСА — ТОЛЬКО ЦЕЛИКОМ.

Заказ покупателя на Маркете бывает из нескольких вещей: на них ОДИН ярлык, и по
цеху они едут вместе. Половину такого заказа снять нельзя — оставшаяся вещь уедет
в никуда, отгрузить её будет нечем. Поэтому связка проверяется целиком: тронута
хоть одна вещь (раскроена, в работе, в поставке) — не трогаем всю связку. Если
не тронута ни одна — снимаем всю связку, включая вещи из другого материала: заказ
покупателя всё равно не собрать.

МЯГКАЯ ОТМЕНА НА ПЛОЩАДКЕ.

Сначала отменяем на маркетплейсе, и только если площадка подтвердила — снимаем у
себя. Иначе получилось бы худшее: у нас заказа нет, а площадка ждёт отгрузку.

Отменяем по нескольку штук за вызов и с оглядкой на часы: у облачной функции
времени мало, а площадка отвечает не мгновенно. Дошли до предела времени — отдаём
остаток фронту, он позвонит ещё раз. Так сотня заказов уходит спокойной чередой
коротких запросов, вместо одного длинного, который упадёт по таймауту на середине
и оставит половину заказов отменёнными только у нас.
"""

import json
import time
import urllib.error
import urllib.request

from shared import CANCELLED_SQL, log_action

# Сколько времени за один вызов тратим на разговор с площадками.
#
# У облачной функции жёсткий потолок, и упереться в него нельзя: оборвётся вся
# транзакция, и заказы, уже отменённые на маркетплейсе, останутся висеть на
# конвейере — самое неприятное расхождение из возможных. Поэтому останавливаемся
# сами, задолго до потолка, и сохраняем сделанное.
BATCH_DEADLINE_SEC = 6.0

# Сколько ждём ответ площадки на одну отмену. Не дождались — заказ остаётся на
# конвейере и попадёт в следующий заход, ничего не теряется.
API_TIMEOUT_SEC = 4.0

# Сколько заказов отдаём фронту за один заход максимум — чтобы ответ был лёгким,
# а прогресс на экране двигался заметными шажками.
MAX_PER_CALL = 12

# Причина отмены для OZON: «товар закончился у продавца». Если кабинет такую
# причину не предлагает, берём первую доступную из его же списка.
OZON_OUT_OF_STOCK_REASON = 352

WB_API_BASE = 'https://marketplace-api.wildberries.ru'
WB_API_SANDBOX_BASE = 'https://marketplace-api-sandbox.wildberries.ru'
OZON_API_BASE = 'https://api-seller.ozon.ru'
YM_API_BASE = 'https://api.partner.market.yandex.ru'


def _request(url, method, headers, payload=None):
    """Запрос к API площадки. Возвращает (status_code, parsed_json_or_text).

    Сеть в цехе рвётся, площадки отвечают по-разному — ошибку никогда не роняем
    наружу исключением, а возвращаем кодом: вызывающий сам решит, что с ней делать.
    """
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for key, value in headers.items():
        req.add_header(key, value)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=API_TIMEOUT_SEC) as r:
            data = r.read().decode('utf-8')
            return r.status, (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', errors='replace')
        try:
            detail = json.loads(detail)
        except Exception:
            pass
        return e.code, detail
    except Exception as e:
        return 0, str(e)


def _error_text(status_code, data):
    """Человеческий текст ошибки площадки — его увидит админ в списке неудач."""
    if isinstance(data, dict):
        text = (
            data.get('message')
            or data.get('detail')
            or data.get('title')
            or data.get('error')
            or json.dumps(data, ensure_ascii=False)
        )
        if isinstance(text, dict):
            text = text.get('message') or json.dumps(text, ensure_ascii=False)
    else:
        text = str(data)
    text = str(text)
    return f'{status_code}: {text[:200]}' if status_code else text[:200]


def _credentials(cur, cache, code, shop_id):
    """Ключи кабинета площадки для магазина заказа (МЕГАТЮЛЬ и ДЮНА — разные кабинеты).

    Читаем один раз на вызов и держим в cache: заказов в заходе десяток, а кабинет
    у них один и тот же — незачем дёргать базу на каждый.
    """
    key = (code, shop_id)
    if key in cache:
        return cache[key]
    if shop_id:
        cur.execute(
            "SELECT is_enabled, credentials FROM marketplace_integrations "
            "WHERE marketplace_code = %s AND shop_id = %s LIMIT 1",
            (code, int(shop_id)),
        )
    else:
        cur.execute(
            "SELECT is_enabled, credentials FROM marketplace_integrations "
            "WHERE marketplace_code = %s ORDER BY is_enabled DESC, "
            "(credentials::text <> '{}') DESC, shop_id LIMIT 1",
            (code,),
        )
    row = cur.fetchone()
    if not row:
        creds = {}
    else:
        creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
        creds = dict(creds)
        creds['_enabled'] = bool(row[0])
    cache[key] = creds
    return creds


def _cancel_on_wb(cur, cache, order):
    """Отмена сборочного задания на WB: POST /api/v3/orders/{id}/cancel."""
    wb_order_id = order['wbOrderId']
    if not wb_order_id:
        return True, 'нет номера задания WB — снят только у нас'
    creds = _credentials(cur, cache, 'wildberries', order['shopId'])
    api_key = (creds.get('apiKey') or '').strip()
    if not api_key:
        return False, 'не настроен ключ WB для магазина заказа'
    base = WB_API_SANDBOX_BASE if creds.get('useSandbox') else WB_API_BASE
    status, data = _request(
        f'{base}/api/v3/orders/{int(wb_order_id)}/cancel',
        'PATCH', {'Authorization': api_key},
    )
    # 409 — задание уже не в том состоянии (чаще всего отменено раньше нас),
    # 404 — его на WB вовсе нет. И то и другое означает: отгружать нечего.
    if status in (200, 204, 404, 409):
        return True, None
    return False, _error_text(status, data)


def _ozon_reason(cur, cache, order, creds):
    """Какую причину отмены примет этот кабинет OZON.

    Список причин у кабинетов разный, и неподходящая причина отбивается ошибкой.
    Спрашиваем список один раз за вызов и ищем в нём «товар закончился».
    """
    key = ('ozon_reason', order['shopId'])
    if key in cache:
        return cache[key]
    reason = OZON_OUT_OF_STOCK_REASON
    status, data = _request(
        f'{OZON_API_BASE}/v1/posting/fbs/cancel-reason/list',
        'POST',
        {'Client-Id': creds.get('clientId') or '', 'Api-Key': creds.get('apiKey') or ''},
        {'related_posting_numbers': [order['postingNumber']]},
    )
    if status == 200 and isinstance(data, dict):
        items = []
        for row in (data.get('result') or []):
            items.extend(row.get('reasons') or [])
        ids = {int(r.get('id')) for r in items if r.get('id') is not None}
        if OZON_OUT_OF_STOCK_REASON not in ids:
            preferred = [
                r for r in items
                if 'законч' in str(r.get('title', '')).lower()
                or 'наличи' in str(r.get('title', '')).lower()
            ]
            pick = preferred or items
            if pick:
                reason = int(pick[0].get('id'))
    cache[key] = reason
    return reason


def _cancel_on_ozon(cur, cache, order):
    """Отмена отправления OZON: POST /v2/posting/fbs/cancel."""
    posting = order['postingNumber']
    if not posting:
        return True, 'нет номера отправления OZON — снят только у нас'
    creds = _credentials(cur, cache, 'ozon', order['shopId'])
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return False, 'не настроены ключи OZON для магазина заказа'
    headers = {'Client-Id': client_id, 'Api-Key': api_key}
    reason_id = _ozon_reason(cur, cache, order, creds)
    status, data = _request(
        f'{OZON_API_BASE}/v2/posting/fbs/cancel', 'POST', headers,
        {
            'posting_number': posting,
            'cancel_reason_id': int(reason_id),
            'cancel_reason_message': 'Закончился материал, отшить заказ невозможно',
        },
    )
    if status == 200:
        return True, None
    text = _error_text(status, data)
    # Отправление уже отменено раньше нас — считаем задачу выполненной.
    if status in (404, 409) or 'cancel' in text.lower():
        return True, None
    return False, text


def _cancel_on_yandex(cur, cache, order):
    """Отмена заказа Маркета: PUT /campaigns/{id}/orders/{id}/status, SHOP_FAILED.

    Отменяется ЗАКАЗ ПОКУПАТЕЛЯ целиком — у Яндекса это одна сущность, отдельную
    вещь из неё убрать нельзя. Поэтому связка и снимается только целиком.
    """
    ym_id = order['ymOrderId']
    if not ym_id:
        return True, 'нет номера заказа Яндекса — снят только у нас'
    creds = _credentials(cur, cache, 'yandex_market', order['shopId'])
    api_key = (creds.get('apiKey') or '').strip()
    campaign_id = (creds.get('campaignId') or '').strip()
    if not api_key or not campaign_id:
        return False, 'не настроены ключи Яндекс Маркета для магазина заказа'
    status, data = _request(
        f'{YM_API_BASE}/campaigns/{campaign_id}/orders/{int(ym_id)}/status',
        'PUT', {'Api-Key': api_key},
        {'order': {'status': 'CANCELLED', 'substatus': 'SHOP_FAILED'}},
    )
    if status == 200:
        return True, None
    text = _error_text(status, data)
    if status in (404, 409) or 'cancel' in text.lower():
        return True, None
    return False, text


CANCEL_BY_MARKETPLACE = {
    'WB': _cancel_on_wb,
    'OZON': _cancel_on_ozon,
    'Yandex': _cancel_on_yandex,
}


# Заказ нетронут: его никто не взял, ткань на него не резали, в поставку он не попал.
UNTOUCHED_SQL = (
    "o.order_type = 'FBS' "
    "AND COALESCE(o.sewing_status, 'Новый') = 'Новый' "
    "AND o.supply_id IS NULL "
    "AND o.assigned_user_id IS NULL "
    "AND o.cut_at IS NULL AND o.taken_at IS NULL "
    "AND NOT EXISTS (SELECT 1 FROM order_material_usage u WHERE u.order_id = o.id) "
    f"AND NOT ({CANCELLED_SQL})"
)


def _fetch_candidates(cur, material, marketplace):
    """Заказы выбранного материала, которые ещё можно снять, и их связки.

    Возвращает (orders, blocked_groups) — где orders уже дополнены вещами связок
    (вся связка снимается целиком), а blocked_groups — связки, которые трогать
    нельзя: часть их вещей уже в раскрое или в пошиве.
    """
    params = [material]
    mp_cond = ''
    if marketplace and marketplace != 'all':
        mp_cond = ' AND o.marketplace = %s'
        params.append(marketplace)

    cur.execute(
        "SELECT o.id, o.group_key FROM orders o "
        f"WHERE o.material = %s{mp_cond} AND {UNTOUCHED_SQL}",
        params,
    )
    rows = cur.fetchall()
    single_ids = [r[0] for r in rows if not r[1]]
    group_keys = sorted({r[1] for r in rows if r[1]})

    # Связка проверяется целиком: тронута хоть одна вещь — не трогаем ни одной.
    good_groups = []
    blocked_groups = []
    if group_keys:
        cur.execute(
            "SELECT o.group_key, bool_and(" + UNTOUCHED_SQL + ") "
            "FROM orders o WHERE o.group_key = ANY(%s) GROUP BY o.group_key",
            (group_keys,),
        )
        for gkey, all_untouched in cur.fetchall():
            (good_groups if all_untouched else blocked_groups).append(gkey)

    ids = list(single_ids)
    if good_groups:
        cur.execute(
            "SELECT id FROM orders WHERE group_key = ANY(%s)", (good_groups,)
        )
        ids.extend(r[0] for r in cur.fetchall())

    return sorted(set(ids)), blocked_groups


def _load_orders(cur, ids):
    """Данные заказов, нужные для отмены на площадке."""
    if not ids:
        return []
    cur.execute(
        "SELECT id, order_number, marketplace, shop_id, wb_order_id, "
        "       ozon_posting_number, ym_order_id, group_key "
        "FROM orders WHERE id = ANY(%s) ORDER BY marketplace, group_key, id",
        (list(ids),),
    )
    return [
        {
            'id': r[0], 'orderNumber': r[1], 'marketplace': r[2], 'shopId': r[3],
            'wbOrderId': r[4], 'postingNumber': r[5], 'ymOrderId': r[6],
            'groupKey': r[7],
        }
        for r in cur.fetchall()
    ]


def handle_bulk_preview(cur, headers, body_data):
    """Что именно снимется — показываем админу ДО того, как что-то произойдёт.

    Отмена необратима: заказ уйдёт и с конвейера, и с маркетплейса. Поэтому сперва
    считаем и называем числа, а нажимает кнопку человек, уже их увидев.
    """
    material = (body_data.get('material') or '').strip()
    marketplace = (body_data.get('marketplace') or 'all').strip()
    if not material:
        return _resp(headers, 400, {'error': 'Выберите материал'})

    ids, blocked_groups = _fetch_candidates(cur, material, marketplace)
    orders = _load_orders(cur, ids)

    groups = sorted({o['groupKey'] for o in orders if o['groupKey']})
    by_marketplace = {}
    for o in orders:
        by_marketplace[o['marketplace']] = by_marketplace.get(o['marketplace'], 0) + 1

    # Сколько заказов этого материала остаётся в работе — админ должен понимать,
    # что снимется не всё: раскроенное и шьющееся придётся довести.
    cur.execute(
        "SELECT count(*) FROM orders o WHERE o.material = %s AND o.order_type = 'FBS' "
        f"AND COALESCE(o.sewing_status, 'Новый') <> 'Новый' AND NOT ({CANCELLED_SQL})",
        (material,),
    )
    in_work = int(cur.fetchone()[0] or 0)

    return _resp(headers, 200, {
        'material': material,
        'orderIds': [o['id'] for o in orders],
        'orderNumbers': [o['orderNumber'] for o in orders][:50],
        'total': len(orders),
        'groups': len(groups),
        'byMarketplace': by_marketplace,
        'keptInWork': in_work,
        'blockedGroups': len(blocked_groups),
    })


def handle_bulk_cancel(cur, conn, headers, body_data, actor_id, actor_name):
    """Снимает очередную порцию заказов: сперва маркетплейс, затем конвейер.

    Порядок именно такой. Снять сначала у себя и не достучаться до площадки —
    значит оставить её ждать отгрузку заказа, которого у нас уже нет: приедет
    просрочка и штраф. Не прошла отмена на площадке — заказ остаётся на конвейере
    и попадает в список неудач, его видно на экране.
    """
    ids = body_data.get('orderIds') or []
    if not isinstance(ids, list) or not ids:
        return _resp(headers, 400, {'error': 'Не передан список заказов'})
    ids = [int(i) for i in ids][:400]

    started = time.monotonic()
    orders = _load_orders(cur, ids)
    # Заказы, которые между заходами успели тронуть в цехе, из выборки выпадают
    # сами: условие «нетронут» проверяется заново прямо перед отменой.
    cur.execute(
        f"SELECT o.id FROM orders o WHERE o.id = ANY(%s) AND {UNTOUCHED_SQL}",
        (ids,),
    )
    still_ok = {r[0] for r in cur.fetchall()}

    cache = {}
    done, failed, skipped = [], [], []
    # Заказ Яндекса отменяется целиком — по одному обращению на связку, а не на вещь.
    cancelled_ym = set()
    processed = set()

    for order in orders:
        if len(processed) >= MAX_PER_CALL or time.monotonic() - started > BATCH_DEADLINE_SEC:
            break
        oid = order['id']
        if oid in processed:
            continue
        if oid not in still_ok:
            processed.add(oid)
            skipped.append({'id': oid, 'orderNumber': order['orderNumber']})
            continue

        cancel = CANCEL_BY_MARKETPLACE.get(order['marketplace'])
        if not cancel:
            processed.add(oid)
            failed.append({
                'id': oid, 'orderNumber': order['orderNumber'],
                'error': f"неизвестный маркетплейс «{order['marketplace']}»",
            })
            continue

        ym_id = order['ymOrderId']
        if ym_id and int(ym_id) in cancelled_ym:
            ok, note = True, None
        else:
            ok, note = cancel(cur, cache, order)
            if ok and ym_id:
                cancelled_ym.add(int(ym_id))

        processed.add(oid)
        if not ok:
            failed.append({'id': oid, 'orderNumber': order['orderNumber'], 'error': note})
            continue

        _cancel_locally(cur, oid)
        done.append({'id': oid, 'orderNumber': order['orderNumber'], 'note': note})

    if done:
        log_action(
            cur, actor_id, actor_name, 'bulk_cancel_orders', 'order', None,
            f"Снял с конвейера и отменил на маркетплейсе заказов: {len(done)}"
            f" (материал: {body_data.get('material') or '—'})",
            {'orderIds': [d['id'] for d in done], 'failed': len(failed)},
        )
    conn.commit()

    handled = {d['id'] for d in done} | {f['id'] for f in failed} | {s['id'] for s in skipped}
    remaining = [i for i in ids if i not in handled]

    return _resp(headers, 200, {
        'done': done,
        'failed': failed,
        'skipped': skipped,
        'remaining': remaining,
    })


def _cancel_locally(cur, order_id):
    """Снятие заказа у себя: с конвейера убран, из истории не стёрт.

    Заказ помечается отменённым, а не удаляется: по нему потом разбирают, почему
    сорвалась отгрузка. Невыплаченные начисления по нему снимаются — платить не за
    что, вещь не шили; уже выплаченные остаются, деньги человек получил.
    """
    cur.execute(
        "DELETE FROM salary_accruals WHERE order_id = %s AND paid_at IS NULL",
        (order_id,),
    )
    cur.execute(
        "UPDATE orders SET status = 'Отменён', sewing_status = 'Отменён', "
        "  cancelled_at = COALESCE(cancelled_at, now()), assigned_user_id = NULL "
        "WHERE id = %s",
        (order_id,),
    )


def _resp(headers, status, body):
    return {
        'statusCode': status,
        'headers': headers,
        'body': json.dumps(body, ensure_ascii=False),
    }
