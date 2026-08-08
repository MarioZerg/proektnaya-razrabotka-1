import json
import os

import psycopg2

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
            cur.execute(
                "SELECT marketplace_code, title, code, code_type, COALESCE(comment, ''), updated_at "
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
                }
                for r in cur.fetchall()
            ]
            return _resp(200, {'items': items})

        body_data = json.loads(event.get('body') or '{}')
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