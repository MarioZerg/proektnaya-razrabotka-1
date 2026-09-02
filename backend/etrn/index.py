import base64
import json
import os
import uuid
from datetime import datetime

import boto3
import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
}

# Статусы накладной в нашей системе.
#
# «Подписана» ставится ТОЛЬКО после того, как подписанный файл вернулся от оператора
# ЭДО: сама подпись живёт в Диадоке, а у нас — её подтверждение. Пометить документ
# подписанным без файла нельзя, иначе система будет врать про юридический статус.
VALID_STATUSES = ['Черновик', 'На подписи', 'Подписана', 'Аннулирована']

# Кто и что может. Подписывает руководитель (ИП), поэтому смена статуса на
# «Подписана» и аннулирование закрыты для кладовщика: он готовит данные и печатает.
MANAGER_ROLES = ('admin', 'manager')


def _resp(status, body):
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(body, ensure_ascii=False, default=str),
        'isBase64Encoded': False,
    }


def _iso(v):
    return v.isoformat() if hasattr(v, 'isoformat') else v


def _role(cur, actor_id):
    """Роль сотрудника берём из базы, а не из запроса: роль в теле запроса
    подменяется, а подписание документа — не то место, где это допустимо."""
    if not actor_id:
        return None
    cur.execute('SELECT role FROM users WHERE id = %s', (int(actor_id),))
    row = cur.fetchone()
    return row[0] if row else None


ETRN_FIELDS = [
    'number', 'doc_date', 'status',
    'shipper_name', 'shipper_inn', 'shipper_address',
    'carrier_name', 'carrier_inn',
    'driver_name', 'driver_phone', 'vehicle_number', 'vehicle_model',
    'consignee_name', 'consignee_address',
    'pickup_address', 'pickup_at', 'delivery_at',
    'cargo_places', 'cargo_weight_kg', 'cargo_description',
    'operator_name', 'operator_doc_id',
    'signed_file_url', 'signed_file_name', 'signed_at', 'signed_by', 'signed_by_name',
    'comment', 'created_at', 'updated_at', 'created_by',
]

# camelCase для фронта: в базе snake_case, в интерфейсе — привычные имена.
FIELD_TO_JSON = {
    'doc_date': 'docDate',
    'shipper_name': 'shipperName',
    'shipper_inn': 'shipperInn',
    'shipper_address': 'shipperAddress',
    'carrier_name': 'carrierName',
    'carrier_inn': 'carrierInn',
    'driver_name': 'driverName',
    'driver_phone': 'driverPhone',
    'vehicle_number': 'vehicleNumber',
    'vehicle_model': 'vehicleModel',
    'consignee_name': 'consigneeName',
    'consignee_address': 'consigneeAddress',
    'pickup_address': 'pickupAddress',
    'pickup_at': 'pickupAt',
    'delivery_at': 'deliveryAt',
    'cargo_places': 'cargoPlaces',
    'cargo_weight_kg': 'cargoWeightKg',
    'cargo_description': 'cargoDescription',
    'operator_name': 'operatorName',
    'operator_doc_id': 'operatorDocId',
    'signed_file_url': 'signedFileUrl',
    'signed_file_name': 'signedFileName',
    'signed_at': 'signedAt',
    'signed_by': 'signedBy',
    'signed_by_name': 'signedByName',
    'created_at': 'createdAt',
    'updated_at': 'updatedAt',
    'created_by': 'createdBy',
}

# Поля, которые приходят с фронта при сохранении карточки.
EDITABLE = {
    'number': 'number',
    'docDate': 'doc_date',
    'shipperName': 'shipper_name',
    'shipperInn': 'shipper_inn',
    'shipperAddress': 'shipper_address',
    'carrierName': 'carrier_name',
    'carrierInn': 'carrier_inn',
    'driverName': 'driver_name',
    'driverPhone': 'driver_phone',
    'vehicleNumber': 'vehicle_number',
    'vehicleModel': 'vehicle_model',
    'consigneeName': 'consignee_name',
    'consigneeAddress': 'consignee_address',
    'pickupAddress': 'pickup_address',
    'pickupAt': 'pickup_at',
    'deliveryAt': 'delivery_at',
    'cargoPlaces': 'cargo_places',
    'cargoWeightKg': 'cargo_weight_kg',
    'cargoDescription': 'cargo_description',
    'operatorName': 'operator_name',
    'operatorDocId': 'operator_doc_id',
    'comment': 'comment',
}


def _row_to_dict(row):
    doc = {'id': row[0], 'supplyId': row[1]}
    for i, col in enumerate(ETRN_FIELDS, start=2):
        doc[FIELD_TO_JSON.get(col, col)] = _iso(row[i])
    # Числа отдаём числами: в JSON NUMERIC приходит строкой и ломает арифметику на фронте.
    if doc.get('cargoWeightKg') is not None:
        doc['cargoWeightKg'] = float(doc['cargoWeightKg'])
    return doc


def _select_sql():
    cols = ', '.join(ETRN_FIELDS)
    return f'SELECT id, supply_id, {cols} FROM etrn_documents '


def _get_doc(cur, supply_id):
    cur.execute(_select_sql() + 'WHERE supply_id = %s', (int(supply_id),))
    row = cur.fetchone()
    return _row_to_dict(row) if row else None


def _defaults(cur, supply_id):
    """Черновик накладной, заполненный тем, что система уже знает о поставке.

    Смысл в том, чтобы менеджер не переписывал руками данные, которые лежат в
    соседних таблицах: реквизиты отправителя, склад назначения, число мест.
    """
    cur.execute(
        "SELECT key, value FROM system_settings WHERE key IN "
        "('etrn_shipper_name', 'etrn_shipper_inn', 'etrn_shipper_address', 'etrn_pickup_address')"
    )
    s = {r[0]: r[1] for r in cur.fetchall()}

    cur.execute(
        'SELECT marketplace, cluster, supply_date, packaging_count, '
        '       (SELECT COUNT(*) FROM marketplace_supply_boxes b WHERE b.supply_id = ms.id), '
        '       (SELECT COUNT(*) FROM marketplace_supply_items i WHERE i.supply_id = ms.id) '
        'FROM marketplace_supplies ms WHERE ms.id = %s',
        (int(supply_id),),
    )
    row = cur.fetchone()
    if not row:
        return None
    marketplace, cluster, supply_date, packaging_count, boxes, items = row

    # Мест в машине: сколько коробов реально собрано, иначе — сколько обещали.
    places = boxes or packaging_count or None
    mp_name = {'OZON': 'OZON', 'WB': 'Wildberries', 'Yandex': 'Яндекс.Маркет'}.get(
        marketplace, marketplace or ''
    )
    return {
        'shipper_name': s.get('etrn_shipper_name') or '',
        'shipper_inn': s.get('etrn_shipper_inn') or '',
        'shipper_address': s.get('etrn_shipper_address') or '',
        'pickup_address': s.get('etrn_pickup_address') or '',
        'consignee_name': f'СЦ {mp_name}'.strip(),
        'consignee_address': cluster or '',
        'delivery_at': f'{supply_date}T00:00:00' if supply_date else None,
        'cargo_places': places,
        'cargo_description': f'Текстильные изделия, {items} шт.' if items else 'Текстильные изделия',
    }


def _upload_signed(base64_data, filename):
    """Кладёт подписанный файл от оператора в наше хранилище.

    Файл — единственное доказательство, что накладная подписана. Он должен лежать
    рядом с поставкой, а не в почте у бухгалтера: при проверке его ищут по отгрузке.
    """
    if ',' in base64_data[:100]:
        base64_data = base64_data.split(',', 1)[1]
    binary = base64.b64decode(base64_data)
    ext = (filename or '').rsplit('.', 1)[-1].lower() if '.' in (filename or '') else 'pdf'
    types = {
        'pdf': 'application/pdf',
        'xml': 'application/xml',
        'sig': 'application/pkcs7-signature',
        'p7s': 'application/pkcs7-signature',
        'zip': 'application/zip',
    }
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'etrn/{uuid.uuid4().hex}.{ext}'
    s3.put_object(
        Bucket='files',
        Key=key,
        Body=binary,
        ContentType=types.get(ext, 'application/octet-stream'),
    )
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def handler(event: dict, context) -> dict:
    """Электронная транспортная накладная (ЭТрН) по поставке FBO.

    С 01.09 сортировочные центры принимают только электронные транспортные документы:
    бумажные больше не принимаются, за нарушение порядка оформления предусмотрена
    ответственность по ст. 11.14.3 КоАП РФ.

    ВАЖНО: подписание ЭТрН по закону идёт только через аккредитованного оператора
    ИС ЭПД (Контур.Диадок). Эта функция ведёт карточку документа: собирает реквизиты
    перевозки, хранит статус и подписанный файл, который вернул оператор. Она сама
    ничего не подписывает и в ГИС ЭПД не ходит.

    GET  /?supplyId=12                  - накладная поставки (null, если ещё не заводили)
    POST /  { action: 'create', supplyId }
        - создать черновик, подставив реквизиты отправителя, склад и число мест
    POST /  { action: 'update', supplyId, ...поля }
        - сохранить реквизиты перевозки
    POST /  { action: 'set_status', supplyId, status, actorId }
        - сменить статус. «Подписана» — только при загруженном подписанном файле
    POST /  { action: 'attach_signed', supplyId, fileBase64, fileName, actorId }
        - приложить подписанный файл от оператора: документ становится «Подписана»

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с карточкой накладной
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    dsn = os.environ['DATABASE_URL']
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        if method == 'GET':
            supply_id = (event.get('queryStringParameters') or {}).get('supplyId')
            if not supply_id:
                return _resp(400, {'error': 'Укажите supplyId'})
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        if method != 'POST':
            return _resp(405, {'error': 'Method not allowed'})

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        # Действие проверяем ДО работы с базой: иначе опечатка в action возвращала
        # «накладная не заведена» — ошибка про данные вместо ошибки про запрос.
        if action not in ('create', 'update', 'set_status', 'attach_signed'):
            return _resp(400, {'error': 'Неизвестное действие'})
        supply_id = body_data.get('supplyId')
        if not supply_id:
            return _resp(400, {'error': 'Укажите supplyId'})

        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')
        role = _role(cur, actor_id)

        if action == 'create':
            if _get_doc(cur, supply_id):
                return _resp(400, {'error': 'Накладная по этой поставке уже заведена'})
            d = _defaults(cur, supply_id)
            if d is None:
                return _resp(404, {'error': 'Поставка не найдена'})
            cur.execute(
                'INSERT INTO etrn_documents '
                '(supply_id, status, doc_date, shipper_name, shipper_inn, shipper_address, '
                ' pickup_address, consignee_name, consignee_address, delivery_at, '
                ' cargo_places, cargo_description, created_by) '
                "VALUES (%s, 'Черновик', CURRENT_DATE, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    int(supply_id), d['shipper_name'], d['shipper_inn'], d['shipper_address'],
                    d['pickup_address'], d['consignee_name'], d['consignee_address'],
                    d['delivery_at'], d['cargo_places'], d['cargo_description'],
                    int(actor_id) if actor_id else None,
                ),
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        doc = _get_doc(cur, supply_id)
        if not doc:
            return _resp(404, {'error': 'Накладная не заведена'})

        if action == 'update':
            # Подписанный документ не редактируется: у него уже есть юридическая
            # сила, и правка реквизитов «задним числом» расходится с тем, что
            # подписано у оператора.
            if doc['status'] == 'Подписана':
                return _resp(400, {'error': 'Подписанную накладную изменить нельзя'})
            sets, params = [], []
            for json_key, col in EDITABLE.items():
                if json_key in body_data:
                    v = body_data[json_key]
                    sets.append(f'{col} = %s')
                    params.append(v if v != '' else None)
            if not sets:
                return _resp(400, {'error': 'Нечего сохранять'})
            params.append(int(supply_id))
            cur.execute(
                f"UPDATE etrn_documents SET {', '.join(sets)}, updated_at = now() "
                'WHERE supply_id = %s',
                params,
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        if action == 'attach_signed':
            if role not in MANAGER_ROLES:
                return _resp(403, {'error': 'Загрузить подписанный документ может только руководитель'})
            file_b64 = body_data.get('fileBase64')
            if not file_b64:
                return _resp(400, {'error': 'Файл не передан'})
            url = _upload_signed(file_b64, body_data.get('fileName'))
            cur.execute(
                'UPDATE etrn_documents SET signed_file_url = %s, signed_file_name = %s, '
                "signed_at = now(), signed_by = %s, signed_by_name = %s, status = 'Подписана', "
                'updated_at = now() WHERE supply_id = %s',
                (
                    url, body_data.get('fileName'),
                    int(actor_id) if actor_id else None, actor_name,
                    int(supply_id),
                ),
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        if action == 'set_status':
            status = body_data.get('status')
            if status not in VALID_STATUSES:
                return _resp(400, {'error': 'Неизвестный статус'})
            # «Подписана» ставится только загрузкой файла: иначе система показывала бы
            # юридически подписанный документ, которого на самом деле нет.
            if status == 'Подписана' and not doc.get('signedFileUrl'):
                return _resp(400, {
                    'error': 'Сначала приложите подписанный документ от оператора ЭДО'
                })
            if status == 'Аннулирована' and role not in MANAGER_ROLES:
                return _resp(403, {'error': 'Аннулировать накладную может только руководитель'})
            cur.execute(
                'UPDATE etrn_documents SET status = %s, updated_at = now() WHERE supply_id = %s',
                (status, int(supply_id)),
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        return _resp(400, {'error': 'Неизвестное действие'})
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()