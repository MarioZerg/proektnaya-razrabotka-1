import json
import os

import psycopg2

MARKETPLACES = ('ozon', 'wildberries', 'yandex_market', 'megamarket', 'lemana_pro', 'avito')


def handler(event: dict, context) -> dict:
    """Управляет настройками интеграций с маркетплейсами (API-ключи и токены).

    Хранит учётные данные для подключения к API маркетплейсов (OZON, Wildberries,
    Яндекс Маркет, МегаМаркет, Леруа Мерлен/Лемана PRO, Avito) — отсюда в дальнейшем
    будут браться данные для синхронизации заказов, остатков и цен. Сами интеграции
    (обращения к внешним API) реализуются отдельно и используют эти сохранённые
    учётные данные — этот backend только хранит и отдаёт их администратору.

    GET  /  - список всех 6 маркетплейсов с текущими настройками (credentials, isEnabled)
    POST /  { action: 'update', marketplaceCode, isEnabled?, credentials? }
        - обновляет настройки одного маркетплейса; credentials — словарь произвольных
          полей (например {apiKey, clientId, sellerId}) — заменяет полностью, если передан

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над настройками интеграций
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
        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT marketplace_code, is_enabled, credentials, updated_at "
                "FROM marketplace_integrations ORDER BY id"
            )
            integrations = [
                {
                    'marketplaceCode': r[0],
                    'isEnabled': r[1],
                    'credentials': r[2] if isinstance(r[2], dict) else json.loads(r[2] or '{}'),
                    'updatedAt': r[3].isoformat() + 'Z',
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'integrations': integrations})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'update':
                marketplace_code = body_data.get('marketplaceCode')
                if marketplace_code not in MARKETPLACES:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестный маркетплейс'})}

                fields = []
                params = []
                if 'isEnabled' in body_data:
                    fields.append("is_enabled = %s")
                    params.append(bool(body_data['isEnabled']))
                if 'credentials' in body_data and isinstance(body_data['credentials'], dict):
                    fields.append("credentials = %s")
                    params.append(json.dumps(body_data['credentials']))

                if not fields:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нет полей для обновления'})}

                fields.append("updated_at = now()")
                fields.append("updated_by = %s")
                params.append(int(actor_id) if actor_id not in (None, '') else None)
                params.append(marketplace_code)

                cur.execute(
                    f"UPDATE marketplace_integrations SET {', '.join(fields)} WHERE marketplace_code = %s",
                    tuple(params),
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
