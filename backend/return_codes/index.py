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
OZON_BARCODE_PATHS = {
    'return_barcode': '/v1/return/company/barcode',
    'return_reset': '/v1/return/company/barcode/reset',
    'barcode_add': '/v1/barcode/add',
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


def refresh_ozon_code(cur):
    """Забирает свежий штрихкод возвратов OZON по API.

    Код привязан к продавцу, но обновляется раз в сутки — вчерашний на пункте выдачи
    не примут. Метод /v1/barcode/add возвращает действующий на сегодня код; если он
    почему-то ещё не создан, просим OZON сгенерировать новый.

    Возвращает (код, ошибка).
    """
    client_id, api_key, enabled = get_ozon_credentials(cur)
    if not client_id or not api_key:
        return None, 'Не заполнены ключи OZON в интеграциях'
    if not enabled:
        return None, 'Интеграция OZON выключена'

    st, data = ozon_post(OZON_BARCODE_PATHS['return_barcode'], client_id, api_key)
    code = extract_barcode(data)

    # Кода на сегодня ещё нет — просим OZON выпустить новый.
    if not code:
        st, data = ozon_post(OZON_BARCODE_PATHS['return_reset'], client_id, api_key)
        code = extract_barcode(data)

    if not code:
        # Метод получения штрихкода возвратов в Seller API сейчас недоступен: все
        # известные пути отвечают 404. Значит, автообновление невозможно — говорим
        # об этом прямо, чтобы человек не гадал, почему кнопка не сработала.
        return None, (
            'OZON не отдаёт штрихкод возвратов через API — метод недоступен в Seller API. '
            'Скопируйте код из личного кабинета вручную'
        )

    return str(code).strip(), None


CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


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
                "COALESCE(hint, ''), daily_refresh, "
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
                    # Где взять код в личном кабинете площадки.
                    'hint': r[6],
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

            code, err = refresh_ozon_code(cur)
            if err:
                return _resp(502, {'error': err})

            actor_id = body_data.get('actorId')
            cur.execute(
                "UPDATE return_pickup_codes SET code = %s, updated_at = now(), updated_by = %s "
                "WHERE marketplace_code = 'ozon'",
                (code, int(actor_id) if actor_id else None),
            )
            conn.commit()
            return _resp(200, {'success': True, 'code': code})

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