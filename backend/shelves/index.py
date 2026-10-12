import base64
import json
import os
import uuid

import boto3
import psycopg2

# Снимок полки — пометка «контейнер стоит здесь», не архив. Браузер уже
# сжимает кадр, а сервер не принимает то, что всё равно не влезет в вызов.
PHOTO_MAX_BYTES = 1_200_000
PHOTO_ROLES = ('admin', 'storekeeper', 'senior_storekeeper')


def _role(cur, actor_id):
    if not actor_id:
        return None
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return row[0] if row else None


def _decode_jpeg(data_url):
    """Проверяет снимок и возвращает (байты, текст ошибки)."""
    if not isinstance(data_url, str) or not data_url.startswith('data:image/jpeg'):
        return None, 'Это не фото — выберите снимок полки'
    _, _, data = data_url.partition(',')
    if not data:
        return None, 'Пустое фото'
    # Размер по длине base64, без декодирования: большой мусор не должен
    # сначала занять память, а потом получить отказ.
    if len(data) * 3 // 4 > PHOTO_MAX_BYTES:
        return None, 'Фото слишком большое — снимите ещё раз'
    try:
        binary = base64.b64decode(data, validate=True)
    except (ValueError, TypeError):
        return None, 'Файл повреждён — попробуйте другое фото'
    if not binary:
        return None, 'Пустое фото'
    return binary, None


def _store_photo(binary):
    """Кладёт снимок в хранилище и возвращает адрес для карточки товара."""
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'shelves/{uuid.uuid4().hex}.jpg'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType='image/jpeg')
    project = os.environ['AWS_ACCESS_KEY_ID']
    return f'https://cdn.poehali.dev/projects/{project}/bucket/{key}'


def handler(event: dict, context) -> dict:
    """Справочник полок на складе готового товара.

    GET  /                  - список полок (у полки со снимком есть photoUrl)
    POST /  { action: 'create', name }
    POST /  { action: 'delete', id }
        - запрещено, если на полке есть товар
    POST /  { action: 'set_photo', id, photo, actorId }
        - снимок, где стоит контейнер. Картинка в хранилище, в базе только адрес
    POST /  { action: 'clear_photo', id, actorId }

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над полками
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
                "SELECT s.id, s.name, s.created_at, "
                "(SELECT COUNT(*) FROM goods_warehouse gw WHERE gw.shelf_id = s.id AND gw.status = 'in_stock'), "
                "s.photo_url "
                "FROM shelves s ORDER BY s.name"
            )
            shelves = [
                {
                    'id': r[0],
                    'name': r[1],
                    'createdAt': r[2].isoformat() + 'Z',
                    'itemsCount': r[3],
                    # Пустой адрес не шлём: у большинства полок снимка нет,
                    # а список и так запрашивают вместе со складом.
                    **({'photoUrl': r[4]} if r[4] else {}),
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'shelves': shelves})}

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            # Создавать и удалять полки может только администратор. Роль проверяем по actorId
            # (в будущем кладовщик сможет только раскладывать товар по полкам, но не менять их).
            if action in ('create', 'delete', 'rename'):
                actor_id = body_data.get('actorId')
                actor_role = None
                if actor_id:
                    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
                    row = cur.fetchone()
                    actor_role = row[0] if row else None
                if actor_role != 'admin':
                    return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': 'Полки может изменять только администратор'})}

            if action == 'create':
                name = (body_data.get('name') or '').strip()
                if not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите название полки'})}
                name_esc = name.replace("'", "''")
                cur.execute(f"SELECT id FROM shelves WHERE name = '{name_esc}'")
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Полка с таким названием уже существует'})}
                cur.execute(f"INSERT INTO shelves (name) VALUES ('{name_esc}') RETURNING id")
                new_id = cur.fetchone()[0]
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': new_id})}

            if action == 'rename':
                # Переименование полки. Названия на стеллажах меняются: склад
                # переставили, ряды перенумеровали — раньше приходилось удалять
                # полку и заводить заново, а удалить полку с товаром нельзя.
                item_id = body_data.get('id')
                name = (body_data.get('name') or '').strip()
                if not item_id or not name:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите полку и название'})}
                name_esc = name.replace("'", "''")
                cur.execute(
                    f"SELECT id FROM shelves WHERE name = '{name_esc}' AND id <> {int(item_id)}"
                )
                if cur.fetchone():
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Полка с таким названием уже существует'})}
                cur.execute(
                    f"UPDATE shelves SET name = '{name_esc}' WHERE id = {int(item_id)}"
                )
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            if action == 'delete':
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}
                cur.execute(
                    "SELECT COUNT(*) FROM goods_warehouse WHERE shelf_id = %s AND status = 'in_stock'",
                    (int(item_id),),
                )
                if cur.fetchone()[0] > 0:
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'На полке есть товар — сначала переместите его'})}
                cur.execute(f"DELETE FROM shelves WHERE id = {int(item_id)}")
                conn.commit()
                return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

            # Снимок полки ставит кладовщик: он стоит у стеллажа. Админ тоже
            # может. Остальным ролям это не нужно — они товар не раскладывают.
            if action in ('set_photo', 'clear_photo'):
                if _role(cur, body_data.get('actorId')) not in PHOTO_ROLES:
                    return {
                        'statusCode': 403,
                        'headers': headers,
                        'body': json.dumps({'error': 'Фото полки ставит кладовщик'}),
                    }
                item_id = body_data.get('id')
                if not item_id:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите полку'})}
                cur.execute("SELECT id FROM shelves WHERE id = %s", (int(item_id),))
                if not cur.fetchone():
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Полка не найдена'})}

                if action == 'clear_photo':
                    cur.execute("UPDATE shelves SET photo_url = NULL WHERE id = %s", (int(item_id),))
                    conn.commit()
                    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

                binary, photo_error = _decode_jpeg(body_data.get('photo'))
                if photo_error:
                    return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': photo_error})}
                photo_url = _store_photo(binary)
                cur.execute(
                    "UPDATE shelves SET photo_url = %s WHERE id = %s",
                    (photo_url, int(item_id)),
                )
                conn.commit()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'success': True, 'photoUrl': photo_url}),
                }

            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
        finally:
            conn.close()

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}