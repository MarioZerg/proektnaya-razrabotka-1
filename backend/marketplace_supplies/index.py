"""Поставки готового товара на маркетплейс — точка входа облачной функции.

Модуль разбит на три файла, потому что в одном было 3556 строк и любая правка
требовала листать его целиком:
  shared.py            — константы, доступ к OZON, общие проверки
  supplies_read.py     — чтение: список, карточка, кандидаты, сводка дашборда
  supplies_actions.py  — действия: сборка, короба, статусы, отгрузка

Логика не менялась: код перенесён как есть.
"""

import json
import os
import time

import psycopg2

from shared import log_action, run_auto_statuses

from supplies_read import handle_get
from supplies_actions import handle_post


def handler(event: dict, context) -> dict:
    """Поставки готового товара на маркетплейс (полный цикл, как на физическом складе):

    Жизненный цикл поставки:
      Открытая -> На сборке -> Отгрузка -> [Отгружено (FBS) | Принята (FBO OZON)] -> Выполнена

    POST { action: 'auto_statuses', cronSecret } — фоновое задание: ставит «Отгружено»
      FBS-поставкам, где всё отсканировано, «Принята» — FBO, которые OZON
      принял, и закрывает их через 12/24 часа.

    Товар берётся со склада готового товара (goods_warehouse, статус in_stock).
    При добавлении в поставку товар резервируется (status='reserved'), при переводе
    поставки в статус "Отгрузка" — считается отгруженным (status='shipped').

    Для FBO поставок сборка идёт через короба: кладовщик создаёт короб кнопкой
    "Добавить короб", затем добавляет в него заказы (готовый товар резервируется и
    привязывается к конкретному коробу). Каждый короб получает свой номер и штрихкод.

    GET  /                       - список поставок, фильтры: ?status=, ?type=FBO|FBS,
                                     ?marketplace=OZON|WB|Yandex, ?date_from=, ?date_to=, ?search=
    GET  /?id=1                  - детальная карточка поставки с товарами и коробами
    GET  /?id=1&candidates=1     - список заказов, которые должны быть в этой FBO поставке

    POST /  { action: ... }      - действия по поставке: сборка, короба, статусы,
                                     отгрузка. Полный список — в supplies_actions.py

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/детальными данными/результатом операции
    """
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        return handle_get(event, headers, dsn)

    if method == 'POST':
        body = json.loads(event.get('body') or '{}')
        # Фоновое задание: «Отгружено» / «Принята» и автозакрытие по таймеру.
        if body.get('action') == 'auto_statuses':
            secret = os.environ.get('CRON_SECRET', '')
            if not secret or body.get('cronSecret') != secret:
                return {'statusCode': 403, 'headers': headers,
                        'body': json.dumps({'error': 'Неверный ключ планировщика'}, ensure_ascii=False)}
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                summary = run_auto_statuses(cur, conn, time.time() + 3.0)
                log_action(cur, None, 'Планировщик', 'supplies_auto_statuses', 'marketplace_supply', None,
                           f"Отгружено: {summary['shipped']}, с недостачей: {summary['missing']}, "
                           f"принято OZON: {summary['accepted']}, закрыто: {summary['closed']}")
                conn.commit()
            finally:
                conn.close()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps(summary)}
        return handle_post(event, headers, dsn)

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}