import json
import os
import urllib.error
import urllib.request

import psycopg2

OZON_API_BASE = 'https://api-seller.ozon.ru'


def get_ozon_credentials(cur):
    """Ключи OZON из настроек интеграций."""
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = 'ozon'"
    )
    row = cur.fetchone()
    if not row:
        return None, None, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return (creds.get('clientId') or '').strip(), (creds.get('apiKey') or '').strip(), bool(row[0])


def ozon_post(path, client_id, api_key, payload=None):
    """POST к OZON Seller API. Возвращает (код ответа, разобранный JSON)."""
    body = json.dumps(payload or {}).encode('utf-8')
    req = urllib.request.Request(OZON_API_BASE + path, method='POST', data=body)
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read().decode('utf-8')
            return r.status, (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw[:300]}
    except Exception as e:
        return 0, {'raw': str(e)[:300]}


# Возможные методы OZON для штрихкода возвратов. Проверяем по одному: документация
# по этому разделу менялась, и надёжнее определить рабочий путь опытным путём.
# Рабочие методы OZON для штрихкода выдачи возвратов:
# barcode      — текущее значение кода,
# get-png      — картинка штрихкода,
# barcode-reset — выпустить новый код (старый перестаёт действовать).
OZON_BARCODE_PATHS = {
    'value': '/v1/return/giveout/barcode',
    'png': '/v1/return/giveout/get-png',
    'reset': '/v1/return/giveout/barcode-reset',
}


def extract_barcode(data):
    """Достаёт значение штрихкода из ответа OZON: структура ответа у методов разная."""
    if not isinstance(data, dict):
        return None
    for holder in (data.get('result'), data):
        if isinstance(holder, dict):
            for key in ('barcode', 'barcode_value', 'value', 'code'):
                val = holder.get(key)
                if val:
                    return val
        elif isinstance(holder, str) and holder.strip():
            return holder
    return None


def refresh_ozon_code(cur, reset=True):
    """Выпускает свежий штрихкод выдачи возвратов OZON.

    По умолчанию именно ВЫПУСКАЕТ новый код, а не читает текущий: метод barcode отдаёт
    то же самое значение сколько его ни дёргай, поэтому кнопка «Обновить» с ним выглядела
    сломанной. Новый код выпускает barcode-reset — так же, как кнопка в личном кабинете.
    Старый код при этом перестаёт действовать.

    reset=False оставлен для случая, когда нужно просто прочитать действующий код,
    ничего не меняя (например, при автоподтягивании раз в сутки).

    Возвращает (код, ошибка, картинка_штрихкода_base64).
    """
    client_id, api_key, enabled = get_ozon_credentials(cur)
    if not client_id or not api_key:
        return None, 'Не заполнены ключи OZON в интеграциях', None
    if not enabled:
        return None, 'Интеграция OZON выключена', None

    path = OZON_BARCODE_PATHS['reset'] if reset else OZON_BARCODE_PATHS['value']
    st, data = ozon_post(path, client_id, api_key)
    code = extract_barcode(data)

    # Сброс возвращает сразу картинку — значение кода дозапрашиваем отдельно.
    if not code:
        st, data_val = ozon_post(OZON_BARCODE_PATHS['value'], client_id, api_key)
        code = extract_barcode(data_val)
    if not code:
        msg = data.get('message') or data.get('raw') or '' if isinstance(data, dict) else ''
        return None, f'OZON не вернул штрихкод{": " + str(msg)[:180] if msg else ""}', None

    # Картинку штрихкода рисует сам OZON — берём её, чтобы на ПВЗ сканировали
    # ровно тот код, который выдал маркетплейс.
    st_png, data_png = ozon_post(OZON_BARCODE_PATHS['png'], client_id, api_key)
    png = (data_png or {}).get('png') if isinstance(data_png, dict) else None

    return str(code).strip(), None, (png or None)


CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


# Возвраты, которые лежат на пункте выдачи и ждут, когда их заберут. Статусы OZON:
# ждём именно те, что доехали до ПВЗ и готовы к выдаче продавцу.
# ReturnedToOzon — возврат доехал до склада OZON и ждёт, когда продавец его заберёт.
# ReceivedBySeller означает, что забрали, — такие в список не попадают.
OZON_WAITING_STATUSES = {'ReturnedToOzon'}


def fetch_ozon_giveouts(cur):
    """Отправления возвратов OZON, готовые к выдаче продавцу.

    Это то, за чем реально едет кладовщик: OZON собирает возвраты в отправление и
    выдаёт его по штрихкоду. Пока отправление не сформировано, забирать нечего.

    Возвращает (список, ошибка).
    """
    client_id, api_key, enabled = get_ozon_credentials(cur)
    if not client_id or not api_key or not enabled:
        return [], 'Интеграция OZON не настроена'

    st, data = ozon_post('/v1/return/giveout/list', client_id, api_key, {'limit': 100})
    if st != 200 or not isinstance(data, dict):
        msg = (data or {}).get('message') if isinstance(data, dict) else ''
        return [], f'OZON не отдал список выдачи{": " + str(msg)[:150] if msg else ""}'

    out = []
    for g in data.get('giveouts') or []:
        out.append({
            'giveoutId': g.get('giveout_id') or g.get('id'),
            'placeName': (g.get('warehouse_address') or g.get('address')
                          or g.get('warehouse_name') or 'Пункт выдачи'),
            'count': g.get('giveout_count') or g.get('count') or 0,
            'status': g.get('giveout_status') or g.get('status') or '',
        })
    return out, None


def fetch_ozon_giveout_info(cur, giveout_id):
    """Ход приёмки отправления: сколько коробок сотрудник ПВЗ уже отсканировал.

    Пока идёт выдача, OZON помечает подтверждённые позиции — по ним и считаем
    прогресс. Кладовщик видит на телефоне, сколько принято и сколько осталось,
    и может сверить итог, не пересчитывая вручную.
    """
    client_id, api_key, enabled = get_ozon_credentials(cur)
    if not client_id or not api_key or not enabled:
        return None, 'Интеграция OZON не настроена'

    st, data = ozon_post('/v1/return/giveout/info', client_id, api_key,
                         {'giveout_id': giveout_id})
    if st != 200 or not isinstance(data, dict):
        msg = (data or {}).get('message') if isinstance(data, dict) else ''
        return None, f'OZON не отдал данные приёмки{": " + str(msg)[:150] if msg else ""}'

    articles = data.get('articles') or []
    scanned = sum(1 for a in articles if a.get('approved'))
    total = len(articles) or data.get('giveout_count') or 0

    # Сотрудник ПВЗ отсканировал всё — значит коробки физически переданы кладовщику.
    # Помечаем возвраты забранными, чтобы никто не отмечал это руками. Решение по
    # каждой вещи (полка / перепаковка / утиль) кладовщик примет уже на складе.
    if total and scanned >= total:
        cur.execute(
            "UPDATE marketplace_returns SET status = 'picked_up', picked_up_at = now(), "
            "giveout_id = %s WHERE marketplace = 'OZON' AND status = 'approved'",
            (giveout_id,),
        )

    return {
        'giveoutId': giveout_id,
        'status': data.get('giveout_status') or data.get('status') or '',
        'total': total,
        # Сколько уже отсканировал сотрудник пункта выдачи.
        'scanned': scanned,
        'items': [
            {'name': a.get('name') or '', 'approved': bool(a.get('approved'))}
            for a in articles[:200]
        ],
    }, None


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def handler(event: dict, context) -> dict:
    """Штрихкоды продавца для получения возвратов в пунктах выдачи.

    Чтобы забрать возвраты на ПВЗ, кладовщик показывает штрихкод кабинета продавца —
    у каждого маркетплейса он свой и постоянный. Коды заводит администратор, кладовщик
    открывает их с телефона и даёт отсканировать.

    GET  /                                  - список кодов по маркетплейсам
    POST /  { action: 'save', marketplaceCode, code, codeType?, comment?, actorId? }
    POST /  { action: 'refresh', marketplaceCode, actorId? }  - свежий код из кабинета
    POST /  { action: 'pickup_list' }        - что и где ждёт получения на ПВЗ
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            # Сколько возвратов ждёт забора на ПВЗ по каждой площадке. Одобренные, но ещё
            # не принятые — это ровно те посылки, за которыми нужно ехать. По счётчику
            # кладовщик понимает, есть ли смысл в поездке и сколько мест забирать.
            cur.execute(
                "SELECT marketplace, COUNT(*) FROM marketplace_returns "
                "WHERE status = 'approved' GROUP BY marketplace"
            )
            # В возвратах площадка записана коротким именем (WB, OZON), а у кодов —
            # системным (wildberries, ozon). Сводим их вместе.
            alias = {
                'WB': 'wildberries',
                'OZON': 'ozon',
                'Yandex': 'yandex_market',
                'YANDEX': 'yandex_market',
            }
            waiting = {}
            for mp, cnt in cur.fetchall():
                key = alias.get((mp or '').strip(), (mp or '').strip().lower())
                waiting[key] = waiting.get(key, 0) + int(cnt)

            cur.execute(
                "SELECT marketplace_code, title, code, code_type, COALESCE(comment, ''), updated_at, "
                "COALESCE(code_image, ''), daily_refresh, "
                # Свежесть кода: у площадок с ежедневным обновлением вчерашний уже не примут.
                "(updated_at::date = CURRENT_DATE) "
                "FROM return_pickup_codes ORDER BY title"
            )
            items = [
                {
                    'marketplaceCode': r[0],
                    'title': r[1],
                    'code': r[2],
                    'codeType': r[3],
                    'comment': r[4],
                    'updatedAt': r[5].isoformat() + 'Z' if r[5] else None,
                    # Сколько посылок ждёт на ПВЗ по этой площадке.
                    'waitingCount': waiting.get(r[0], 0),
                    # Готовая картинка штрихкода от маркетплейса.
                    'codeImage': r[6] or None,
                    # Код обновляется раз в сутки (OZON) — вчерашний не сработает.
                    'dailyRefresh': bool(r[7]),
                    'updatedToday': bool(r[8]),
                }
                for r in cur.fetchall()
            ]
            return _resp(200, {'items': items, 'totalWaiting': sum(waiting.values())})

        body_data = json.loads(event.get('body') or '{}')

        # Обновление кода из личного кабинета маркетплейса по API. Доступно и кладовщику:
        # код OZON живёт сутки, и человеку перед выездом на ПВЗ нужно уметь получить
        # свежий самому, не дожидаясь администратора.
        if body_data.get('action') == 'refresh':
            mp = (body_data.get('marketplaceCode') or 'ozon').strip()
            if mp != 'ozon':
                return _resp(400, {
                    'error': 'Автообновление доступно только для OZON — у Wildberries '
                             'и Яндекса код постоянный, он задаётся вручную'
                })

            # Нажатие «Обновить» должно давать НОВЫЙ код — иначе кнопка выглядит
            # сломанной: OZON отдаёт одно и то же значение, пока его не сбросить.
            # Автоподтягивание раз в сутки (silent) просто читает действующий код,
            # чтобы не гасить штрихкод, который кладовщик уже везёт на пункт выдачи.
            issue_new = not bool(body_data.get('readOnly'))
            code, err, png = refresh_ozon_code(cur, reset=issue_new)
            if err:
                return _resp(502, {'error': err})

            actor_id = body_data.get('actorId')
            cur.execute(
                "UPDATE return_pickup_codes SET code = %s, code_image = %s, updated_at = now(), "
                "updated_by = %s WHERE marketplace_code = 'ozon'",
                (code, png, int(actor_id) if actor_id else None),
            )
            conn.commit()
            return _resp(200, {'success': True, 'code': code})

        # Что и где ждёт получения на пунктах выдачи OZON.
        # Отправления, ожидающие получения в пункте выдачи.
        if body_data.get('action') == 'pickup_list':
            giveouts, gerr = fetch_ozon_giveouts(cur)
            if gerr:
                return _resp(502, {'error': gerr})
            return _resp(200, {
                'giveouts': giveouts,
                'total': sum(g['count'] for g in giveouts),
            })

        # Ход приёмки: сотрудник ПВЗ сканирует коробки, а мы показываем прогресс.
        if body_data.get('action') == 'giveout_progress':
            giveout_id = body_data.get('giveoutId')
            if not giveout_id:
                return _resp(400, {'error': 'Не указано отправление'})
            info, err = fetch_ozon_giveout_info(cur, int(giveout_id))
            if err:
                return _resp(502, {'error': err})
            # Отметки о заборе, сделанные внутри, нужно сохранить.
            conn.commit()
            return _resp(200, info)

        if body_data.get('action') == 'save':
            mp = (body_data.get('marketplaceCode') or '').strip()
            if not mp:
                return _resp(400, {'error': 'Укажите маркетплейс'})
            code = (body_data.get('code') or '').strip() or None
            code_type = (body_data.get('codeType') or 'CODE128').strip().upper()
            if code_type not in ('CODE128', 'QR', 'EAN13'):
                code_type = 'CODE128'
            actor_id = body_data.get('actorId')

            # Проверяем существование до обновления: rowcount после UPDATE равен нулю
            # и когда строки нет, и когда значения не изменились — различить нельзя.
            cur.execute(
                "SELECT 1 FROM return_pickup_codes WHERE marketplace_code = %s", (mp,)
            )
            if not cur.fetchone():
                return _resp(404, {'error': 'Маркетплейс не найден'})

            cur.execute(
                "UPDATE return_pickup_codes SET code = %s, code_type = %s, comment = %s, "
                "updated_at = now(), updated_by = %s WHERE marketplace_code = %s",
                (
                    code,
                    code_type,
                    (body_data.get('comment') or '').strip() or None,
                    int(actor_id) if actor_id else None,
                    mp,
                ),
            )
            conn.commit()
            return _resp(200, {'success': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()