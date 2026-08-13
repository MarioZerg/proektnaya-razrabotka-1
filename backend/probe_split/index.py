"""Разведка: поддерживает ли магазин частичную сборку отправлений OZON.

Временный служебный файл, удаляется после проверки. Ничего не меняет:
шлём заведомо некорректные данные, чтобы по коду ошибки понять, СУЩЕСТВУЕТ ли метод
(404/400 «метод не найден» против осмысленной ошибки валидации).
"""
import json
import os
import urllib.error
import urllib.request

import psycopg2

OZON_API_BASE = 'https://api-seller.ozon.ru'


def call(path, client_id, api_key, payload):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(OZON_API_BASE + path, method='POST', data=body)
    req.add_header('Client-Id', client_id)
    req.add_header('Api-Key', api_key)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode('utf-8', errors='replace')[:6000]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')[:600]
    except Exception as e:
        return 0, str(e)[:300]


def handler(event, context):
    """Проверяет доступность методов разделения/частичной сборки FBS."""
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute(
        "SELECT credentials FROM marketplace_integrations WHERE marketplace_code = 'ozon'"
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return {'statusCode': 200, 'body': json.dumps({'error': 'нет ключей OZON'})}
    creds = row[0] if isinstance(row[0], dict) else json.loads(row[0] or '{}')
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()

    posting = (event.get('queryStringParameters') or {}).get('posting') or ''

    out = {}
    # 1. Состав отправления — эталон: сколько там товаров и какие.
    st, data = call('/v3/posting/fbs/get', client_id, api_key,
                    {'posting_number': posting, 'with': {}})
    out['get'] = {'status': st, 'body': data}

    # 2. Структуру запроса на деление выясняем ступенчато, НЕ выполняя реального
    # деления: шлём заведомо неполные данные и читаем, чего именно не хватает.
    st, data = call('/v1/posting/fbs/split', client_id, api_key,
                    {'posting_number': posting, 'postings': [{}, {}]})
    out['split_empty_items'] = {'status': st, 'body': data}

    st, data = call('/v1/posting/fbs/split', client_id, api_key,
                    {'posting_number': posting,
                     'postings': [{'products': []}, {'products': []}]})
    out['split_empty_products'] = {'status': st, 'body': data}

    # Заведомо несуществующий товар: OZON ответит «товара нет в отправлении»,
    # но реального деления не произойдёт.
    st, data = call('/v1/posting/fbs/split', client_id, api_key,
                    {'posting_number': posting,
                     'postings': [
                         {'products': [{'product_id': 1, 'quantity': 1}]},
                         {'products': [{'product_id': 2, 'quantity': 1}]},
                     ]})
    out['split_fake_products'] = {'status': st, 'body': data}

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(out, ensure_ascii=False),
    }
