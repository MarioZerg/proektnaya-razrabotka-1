import json
import os
import urllib.request
import urllib.error

# API сервиса грузоперевозок Газелька (gazelka.space). Только чтение заявок для привязки к
# нашим FBO-поставкам. Ключ — в секрете GAZELKA_API_KEY (Bearer). Стикеры коробов
# (упаковочные листы) в API отсутствуют — печатаются в ЛК Газельки по ссылке print-labels.
GAZELKA_API_BASE = 'https://gazelka.space/api'

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
        'body': json.dumps(body),
    }


def gazelka_request(method, path, token, payload=None):
    """Запрос к API Газельки. Возвращает (status_code, parsed_json_or_text)."""
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(GAZELKA_API_BASE + path, method=method, data=body)
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Accept', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
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


def handler(event: dict, context) -> dict:
    """Интеграция с сервисом грузоперевозок Газелька (gazelka.space) — только чтение заявок.

    Позволяет менеджеру выбрать заявку Газельки для нашей OZON FBO-поставки (вручную) и
    печатать стикеры коробов из ЛК Газельки. API-ключ берётся из секрета GAZELKA_API_KEY.

    POST /  { action: 'list_plans' }
        - список активных/запланированных заявок Газельки (метод my-plans) со статусом и
          маркетплейсом (расшифровка из descriptions): id, дата подачи, статус (текст),
          маркетплейс (текст), склад доставки, дата доставки, число коробов/паллет.
          Каждая заявка содержит ссылку на печать стикеров: printUrl.

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком заявок Газельки
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    if method != 'POST':
        return _resp(405, {'error': 'Method not allowed'})

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    if action != 'list_plans':
        return _resp(400, {'error': 'Неизвестное действие'})

    token = (os.environ.get('GAZELKA_API_KEY') or '').strip()
    if not token:
        return _resp(400, {'error': 'Не задан ключ Газельки (GAZELKA_API_KEY) в настройках проекта.'})

    # Расшифровка статусов и маркетплейсов.
    status_labels = {}
    marketplace_labels = {}
    d_code, d_data = gazelka_request('GET', '/descriptions', token)
    if d_code == 200 and isinstance(d_data, dict):
        status_labels = d_data.get('Статусы заявок', {}) or {}
        marketplace_labels = d_data.get('Маркетплейсы (ID -> Название)', {}) or {}

    p_code, p_data = gazelka_request('POST', '/my-plans', token)
    if p_code == 401 or p_code == 403:
        return _resp(400, {'error': 'Газелька отклонила ключ. Проверьте GAZELKA_API_KEY.'})
    if p_code != 200:
        msg = p_data.get('message') if isinstance(p_data, dict) else str(p_data)
        return _resp(502, {'error': f'Газелька вернула ошибку ({p_code}): {msg}'})

    raw_plans = p_data if isinstance(p_data, list) else (p_data.get('plans') or p_data.get('data') or [])

    plans = []
    for p in raw_plans:
        if not isinstance(p, dict):
            continue
        plan_id = p.get('id')
        st = str(p.get('status'))
        mp = str(p.get('marketplace_id'))
        plans.append({
            'id': plan_id,
            'applicationDate': p.get('application_date'),
            'status': p.get('status'),
            'statusLabel': status_labels.get(st, st),
            'marketplaceId': p.get('marketplace_id'),
            'marketplaceLabel': marketplace_labels.get(mp, mp),
            'deliveryAddress': p.get('delivery_address'),
            'deliveryDate': p.get('delivery_date'),
            'boxes': p.get('boxes'),
            'pallets': p.get('pallets'),
            'cargoPickup': p.get('cargo_pickup'),
            'printUrl': f'https://gazelka.space/print-labels?ids[]={plan_id}' if plan_id else None,
        })

    return _resp(200, {'plans': plans})
