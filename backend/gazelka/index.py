import json
import os
import urllib.request
import urllib.error
import re

import psycopg2

# API сервиса грузоперевозок Газелька (gazelka.space). Только чтение заявок для привязки к
# нашим FBO-поставкам. Ключ — в секрете GAZELKA_API_KEY (Bearer).
#
# ПЕЧАТЬ СТИКЕРОВ. Отдачи готового PDF у Газельки нет: API умеет только список заявок
# (my-plans) и справочники, а прежняя страница print-labels отвечает 404. Поэтому
# упаковочный лист мы рисуем сами (src/lib/gazelkaPackingLabel.ts), а отсюда берём
# только исходные данные для штрихкода: IDO, номер заявки, даты, паллеты, забор.
# Если Газелька пришлёт адрес эндпоинта с PDF — добавлять его нужно сюда.
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


def _norm(text):
    t = (text or '').lower().replace('ё', 'е')
    return re.sub(r'[^a-zа-я0-9]+', ' ', t).strip()


# Служебные слова в названиях складов: по ним город не узнать.
_STOP_WORDS = {'рфц', 'сц', 'мрфц', 'кгт', 'фф', 'склад', 'ozon', 'озон', 'wb', 'город', 'обл', 'область'}


def _city_words(text):
    return [w for w in _norm(text).split() if len(w) >= 4 and w not in _STOP_WORDS]


_PLATE = re.compile(r'[A-ZА-ЯЁ]\d{3}[A-ZА-ЯЁ]{2}\d{2,3}', re.I)
_PLATE_KEYS = re.compile(r'car|auto|vehicle|plate|gos|номер|driver|transport', re.I)


def _find_plate(obj, depth=0):
    """Госномер в заявке Газельки. Пока водителя нет, там стоит запасная машина."""
    if depth > 4 or obj is None:
        return None
    if isinstance(obj, str):
        compact = re.sub(r'[\s-]', '', obj)
        found = _PLATE.search(compact)
        return found.group(0) if found else None
    if isinstance(obj, dict):
        for key, value in obj.items():
            if _PLATE_KEYS.search(str(key)):
                found = _find_plate(value, depth + 1)
                if found:
                    return found
        for value in obj.values():
            found = _find_plate(value, depth + 1)
            if found:
                return found
    if isinstance(obj, list):
        for value in obj[:30]:
            found = _find_plate(value, depth + 1)
            if found:
                return found
    return None


def _same_place(cluster, address):
    """Кластер поставки («САНКТ-ПЕТЕРБУРГ_РФЦ») и адрес заявки («Санкт-Петербург (Петрославянка)»)
    про один город? Сравниваем по словам: хоть одно слово кластера есть в адресе или наоборот."""
    a, b = _city_words(cluster), _city_words(address)
    if not a or not b:
        return False
    a_text, b_text = ' '.join(a), ' '.join(b)
    return any(w in b_text for w in a) or any(w in a_text for w in b)


def _supply_context(supply_id):
    """Площадка, кластер и привязанная заявка поставки + заявки, занятые другими поставками."""
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT marketplace, cluster, gazelka_plan_id FROM marketplace_supplies WHERE id = %s",
            (int(supply_id),),
        )
        row = cur.fetchone()
        cur.execute(
            "SELECT gazelka_plan_id FROM marketplace_supplies "
            "WHERE gazelka_plan_id IS NOT NULL AND id <> %s",
            (int(supply_id),),
        )
        taken = {r[0] for r in cur.fetchall()}
        return row, taken
    finally:
        conn.close()


def handler(event: dict, context) -> dict:
    """Интеграция с сервисом грузоперевозок Газелька (gazelka.space) — только чтение заявок.

    Позволяет менеджеру выбрать заявку Газельки для нашей OZON FBO-поставки (вручную) и
    печатать упаковочные листы коробов (генерируются у нас). API-ключ — в секрете GAZELKA_API_KEY.

    POST /  { action: 'list_plans', supplyId?: number }
        - если передан supplyId — отдаём только заявки, подходящие ЭТОЙ поставке:
          та же площадка, тот же город доставки и не привязанные к другой поставке.
          Уже привязанная к ней заявка показывается всегда. В ответе также allCount —
          сколько заявок всего, чтобы менеджер видел, что часть скрыта.
        - список активных/запланированных заявок Газельки (метод my-plans) со статусом и
          маркетплейсом (расшифровка из descriptions): id, дата подачи, статус (текст),
          маркетплейс (текст), склад доставки, дата доставки, число коробов/паллет,
          плюс поля для штрихкода упаковочного листа (onBehalf, shipDate, pallets).

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
        route = p.get('route') if isinstance(p.get('route'), dict) else {}
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
            # Данные для генерации собственного упаковочного листа (штрихкод Code128):
            'onBehalf': p.get('on_behalf'),   # IDO — id организации
            'payer': p.get('payer'),
            'palleting': 1 if p.get('pallets') else 0,  # PLT — паллетирование
            'shipDate': route.get('date'),    # DTS — дата отгрузки (из маршрута)
            # P303PE797 — запасной номер, пока водителя на заявку не назначили.
            'vehicleNumber': _find_plate(p),
        })

    supply_id = body_data.get('supplyId')
    if not supply_id:
        return _resp(200, {'plans': plans, 'allCount': len(plans)})

    row, taken = _supply_context(supply_id)
    if not row:
        return _resp(404, {'error': 'Поставка не найдена'})
    marketplace, cluster, linked_id = row
    mp = _norm(marketplace)

    def fits(p):
        if p['id'] == linked_id:
            return True
        if p['id'] in taken:
            return False
        if mp and _norm(p['marketplaceLabel']) and _norm(p['marketplaceLabel']) != mp:
            return False
        return _same_place(cluster, p['deliveryAddress'])

    matched = [p for p in plans if fits(p)]
    return _resp(200, {'plans': matched, 'allCount': len(plans)})