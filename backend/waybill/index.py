import json
import os
from datetime import date, datetime

import boto3
import psycopg2
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
}

# Заполняет и подтверждает накладную менеджер. Кладовщик её только скачивает:
# документ юридический, и правки «на ходу» у погрузки недопустимы.
MANAGER_ROLES = ('admin', 'manager')

# Колонки таблицы в том же порядке, что и в форме Приложения № 4 — так проще
# сверять код с бумагой, когда меняется форма.
FIELDS = [
    'number', 'doc_date', 'order_number', 'order_date', 'copy_number',
    'shipper_details', 'shipper_is_forwarder',
    'customer_details', 'customer_contract',
    'consignee_details', 'delivery_address',
    'cargo_name', 'cargo_places', 'cargo_weight', 'cargo_value', 'cargo_danger',
    'accompanying_docs',
    'special_route', 'special_readdress', 'special_requirements', 'special_temperature',
    'carrier_details', 'driver_details',
    'vehicle_details', 'vehicle_number', 'vehicle_ownership',
    'vehicle_ownership_doc', 'vehicle_permit',
    'loader_details', 'loading_point_owner', 'loading_address',
    'planned_loading_at', 'actual_arrival_at', 'actual_departure_at',
    'loading_weight', 'loading_places', 'packaging', 'carrier_remarks',
    'loader_signature', 'driver_signature',
    'unloading_address', 'planned_unloading_at', 'cargo_condition',
    'unload_places', 'unload_weight',
    'transport_cost', 'transport_cost_vat', 'transport_cost_total',
    'file_url', 'file_name', 'file_generated_at',
    'is_ready', 'ready_at', 'ready_by_name',
    'comment', 'created_at', 'updated_at',
]


def _camel(snake):
    head, *rest = snake.split('_')
    return head + ''.join(w.capitalize() for w in rest)


# Поля, которые правит менеджер. Служебные (файл, готовность, даты) сюда не входят:
# их ставит система, иначе интерфейс мог бы объявить документ готовым в обход проверок.
READONLY = {
    'file_url', 'file_name', 'file_generated_at',
    'is_ready', 'ready_at', 'ready_by_name', 'created_at', 'updated_at',
}
EDITABLE = {_camel(f): f for f in FIELDS if f not in READONLY}


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
    """Роль берём из базы, а не из запроса: значение в теле подменяется, а здесь
    от роли зависит, кто подтверждает документ для отгрузки."""
    if not actor_id:
        return None
    cur.execute('SELECT role FROM users WHERE id = %s', (int(actor_id),))
    row = cur.fetchone()
    return row[0] if row else None


def _row_to_dict(row):
    doc = {'id': row[0], 'supplyId': row[1]}
    for i, col in enumerate(FIELDS, start=2):
        doc[_camel(col)] = _iso(row[i])
    return doc


def _get_doc(cur, supply_id):
    cols = ', '.join(FIELDS)
    cur.execute(
        f'SELECT id, supply_id, {cols} FROM waybill_documents WHERE supply_id = %s',
        (int(supply_id),),
    )
    row = cur.fetchone()
    return _row_to_dict(row) if row else None


def _settings(cur):
    cur.execute(
        "SELECT key, value FROM system_settings WHERE key IN "
        "('company_name', 'company_inn', 'company_address', 'company_phone', "
        " 'etrn_shipper_name', 'etrn_shipper_inn', 'etrn_shipper_address', "
        " 'etrn_pickup_address')"
    )
    return {r[0]: r[1] for r in cur.fetchall()}


def _our_details(s):
    """Строка реквизитов в том виде, в каком её ждёт форма: одной строкой через
    запятую — наименование, ИНН, адрес, телефон."""
    parts = [
        s.get('etrn_shipper_name') or s.get('company_name') or '',
        f"ИНН {s.get('etrn_shipper_inn') or s.get('company_inn') or ''}".strip(),
        s.get('etrn_shipper_address') or s.get('company_address') or '',
    ]
    phone = s.get('company_phone')
    if phone:
        parts.append(f'тел.: {phone}')
    return ', '.join(p for p in parts if p and p != 'ИНН')


# Куда едет груз: склады маркетплейсов подписываем их юрлицом, иначе на приёмке
# документ считают заполненным неверно.
CONSIGNEES = {
    'OZON': 'ООО "Интернет Решения", ИНН/КПП 7704217370/504445002, '
            '123112, г. Москва, Пресненская набережная, д. 10',
    'WB': 'ООО "Вайлдберриз", ИНН 7721546864, '
          '142181, Московская обл., г. Подольск, д. Коледино, ул. Троицкая, д. 20',
    'Yandex': 'ООО "Яндекс.Маркет", ИНН 7736207543, '
              '119021, г. Москва, ул. Льва Толстого, д. 16',
}


def _defaults(cur, supply_id):
    """Черновик, заполненный тем, что система уже знает о поставке.

    Менеджер не должен переписывать руками данные, которые лежат в соседних
    таблицах: свои реквизиты, склад назначения, число коробов, дату отгрузки.
    """
    s = _settings(cur)
    cur.execute(
        'SELECT marketplace, cluster, supply_date, packaging_count, packaging_type, '
        '       supply_number, ozon_application_number, gazelka_id, '
        '       (SELECT COUNT(*) FROM marketplace_supply_boxes b WHERE b.supply_id = ms.id), '
        '       (SELECT COUNT(*) FROM marketplace_supply_items i WHERE i.supply_id = ms.id) '
        'FROM marketplace_supplies ms WHERE ms.id = %s',
        (int(supply_id),),
    )
    row = cur.fetchone()
    if not row:
        return None
    (marketplace, cluster, supply_date, packaging_count, packaging_type,
     supply_number, ozon_app, gazelka_id, boxes, items) = row

    places = boxes or packaging_count or 0
    unit = 'палет' if packaging_type == 'pallets' else 'коробов'
    ours = _our_details(s)

    return {
        'number': supply_number or ozon_app or '',
        'doc_date': date.today(),
        'order_number': gazelka_id or '',
        'order_date': date.today(),
        'copy_number': 1,
        'shipper_details': ours,
        'consignee_details': CONSIGNEES.get(marketplace, ''),
        'delivery_address': cluster or '',
        'cargo_name': 'Текстильные изделия',
        'cargo_places': f'{places} {unit}' if places else '',
        'cargo_weight': '',
        'cargo_danger': '-',
        'accompanying_docs': '-',
        'special_route': '-',
        'special_readdress': '-',
        'special_requirements': '-',
        'special_temperature': '-',
        # 8. Приём груза — грузим мы, на своём адресе.
        'loader_details': ours,
        'loading_point_owner': ours,
        'loading_address': s.get('etrn_pickup_address') or s.get('company_address') or '',
        'planned_loading_at': (
            datetime.combine(supply_date, datetime.min.time()) if supply_date else None
        ),
        'loading_places': f'{places}' if places else '',
        'packaging': 'Груз упакован в картонные коробки',
        'carrier_remarks': '-',
        # 10. Выдача груза — тот же склад маркетплейса.
        'unloading_address': cluster or '',
        'unload_places': f'{places}' if places else '',
        'cargo_name_items': items,
    }


# ---------------------------------------------------------------- XLSX

THIN = Side(style='thin', color='000000')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(horizontal='left', vertical='center', wrap_text=True)
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)


def _fmt_date(v):
    if not v:
        return ''
    if isinstance(v, str):
        v = v[:10]
        try:
            v = datetime.strptime(v, '%Y-%m-%d').date()
        except ValueError:
            return v
    return v.strftime('%d.%m.%Y')


def _fmt_dt(v):
    if not v:
        return ''
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.replace('Z', '')[:19])
        except ValueError:
            return v
    if isinstance(v, datetime):
        return v.strftime('%d.%m.%Y %H:%M')
    return _fmt_date(v)


def _build_xlsx(doc, path):
    """Собирает транспортную накладную по форме Приложения № 4.

    Формируем файл сами, а не правим присланный образец: в образце данные
    размазаны по объединённым ячейкам на 95 колонок, и любое изменение формы
    ломало бы привязку. Здесь же структура читается сверху вниз — раздел,
    значение, пояснение под ним мелким шрифтом, как в бумажной форме.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = 'Транспортная накладная'

    # Две колонки: слева значения, справа — парные поля формы (даты, места).
    ws.column_dimensions['A'].width = 58
    ws.column_dimensions['B'].width = 58
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    row = 1

    def head(text, size=9, bold=False, align=CENTER):
        nonlocal row
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
        c = ws.cell(row=row, column=1, value=text)
        c.font = Font(name='Arial', size=size, bold=bold)
        c.alignment = align
        row += 1

    def section(title):
        nonlocal row
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
        c = ws.cell(row=row, column=1, value=title)
        c.font = Font(name='Arial', size=9, bold=True)
        c.alignment = Alignment(horizontal='left', vertical='center')
        row += 1

    def field(value, caption, value2=None, caption2=None):
        """Значение крупно, пояснение формы под ним мелко — как в бумаге."""
        nonlocal row
        left = ws.cell(row=row, column=1, value=value or '-')
        left.font = Font(name='Arial', size=10)
        left.alignment = WRAP
        left.border = BOX
        if caption2 is not None or value2 is not None:
            right = ws.cell(row=row, column=2, value=value2 or '-')
            right.font = Font(name='Arial', size=10)
            right.alignment = WRAP
            right.border = BOX
        else:
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
        ws.row_dimensions[row].height = 28
        row += 1

        cl = ws.cell(row=row, column=1, value=caption)
        cl.font = Font(name='Arial', size=7, italic=True, color='555555')
        cl.alignment = WRAP
        if caption2 is not None:
            cr = ws.cell(row=row, column=2, value=caption2)
            cr.font = Font(name='Arial', size=7, italic=True, color='555555')
            cr.alignment = WRAP
        else:
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
        ws.row_dimensions[row].height = 22
        row += 1

    head('Приложение № 4', size=8, align=Alignment(horizontal='right'))
    head('к Правилам перевозок грузов автомобильным транспортом',
         size=8, align=Alignment(horizontal='right'))
    head('(в ред. Постановления Правительства РФ от 30.11.2021 № 2116)',
         size=8, align=Alignment(horizontal='right'))
    row += 1

    head('ТРАНСПОРТНАЯ НАКЛАДНАЯ', size=14, bold=True)
    field(
        f"№ {doc.get('number') or '—'}   от {_fmt_date(doc.get('docDate'))}",
        'Дата и номер транспортной накладной',
        f"Заказ (заявка) № {doc.get('orderNumber') or '—'}   "
        f"от {_fmt_date(doc.get('orderDate'))}",
        'Дата и номер заказа (заявки)',
    )
    field(f"Экземпляр № {doc.get('copyNumber') or 1}", 'Номер экземпляра')

    section('1. Грузоотправитель' + (
        ' (является экспедитором)' if doc.get('shipperIsForwarder') else ''))
    field(doc.get('shipperDetails'),
          '(реквизиты, позволяющие идентифицировать Грузоотправителя)')

    if doc.get('customerDetails'):
        section('1а. Заказчик услуг по организации перевозки груза')
        field(doc.get('customerDetails'),
              '(реквизиты, позволяющие идентифицировать Заказчика услуг)',
              doc.get('customerContract'),
              '(реквизиты договора на выполнение услуг по организации перевозки)')

    section('2. Грузополучатель')
    field(doc.get('consigneeDetails'),
          '(реквизиты, позволяющие идентифицировать Грузополучателя)')
    field(doc.get('deliveryAddress'), '(адрес места доставки груза)')

    section('3. Груз')
    field(doc.get('cargoName'),
          '(отгрузочное наименование груза, его состояние и другая информация о грузе)',
          doc.get('cargoPlaces'),
          '(количество грузовых мест, маркировка, вид тары и способ упаковки)')
    field(doc.get('cargoWeight'),
          '(масса груза брутто в килограммах, масса груза нетто, размеры, объём)',
          doc.get('cargoValue'),
          '(объявленная стоимость (ценность) груза (при необходимости)')
    field(doc.get('cargoDanger'),
          '(в случае перевозки опасного груза — информация по каждому опасному веществу)')

    section('4. Сопроводительные документы на груз (при наличии)')
    field(doc.get('accompanyingDocs'),
          '(перечень прилагаемых к транспортной накладной документов)')

    section('5. Указания грузоотправителя по особым условиям перевозки')
    field(doc.get('specialRoute'),
          '(маршрут перевозки, дата и время/сроки доставки груза)',
          doc.get('specialReaddress'),
          '(контактная информация о лицах, по указанию которых может осуществляться переадресовка)')
    field(doc.get('specialRequirements'),
          '(указания для выполнения санитарных, карантинных, таможенных требований)',
          doc.get('specialTemperature'),
          '(температурный режим перевозки, сведения о запорно-пломбировочных устройствах)')

    section('6. Перевозчик')
    field(doc.get('carrierDetails'),
          '(реквизиты, позволяющие идентифицировать Перевозчика)',
          doc.get('driverDetails'),
          '(реквизиты, позволяющие идентифицировать водителя(-ей)')

    section('7. Транспортное средство')
    field(doc.get('vehicleDetails'),
          '(тип, марка, грузоподъёмность (в тоннах), вместимость (в куб. метрах)',
          doc.get('vehicleNumber'),
          '(регистрационный номер транспортного средства)')
    field(
        f"Тип владения: {doc.get('vehicleOwnership') or '—'}",
        '1 — собственность; 2 — совместная собственность супругов; 3 — аренда; '
        '4 — лизинг; 5 — безвозмездное пользование',
    )
    field(doc.get('vehicleOwnershipDoc'),
          '(реквизиты документа, подтверждающего основание владения — для типов 3, 4, 5)',
          doc.get('vehiclePermit'),
          '(номер, дата и срок действия специального разрешения (при наличии)')

    section('8. Приём груза')
    field(doc.get('loaderDetails'),
          '(реквизиты лица, осуществляющего погрузку груза в транспортное средство)')
    field(doc.get('loadingPointOwner'),
          '(наименование (ИНН) владельца объекта инфраструктуры пункта погрузки)')
    field(doc.get('loadingAddress'), '(адрес места погрузки)',
          _fmt_dt(doc.get('plannedLoadingAt')),
          '(заявленные дата и время подачи транспортного средства под погрузку)')
    field(_fmt_dt(doc.get('actualArrivalAt')),
          '(фактические дата и время прибытия под погрузку)',
          _fmt_dt(doc.get('actualDepartureAt')),
          '(фактические дата и время убытия)')
    field(doc.get('loadingWeight'),
          '(масса груза брутто в килограммах и метод её определения)')
    field(doc.get('loadingPlaces'), '(количество грузовых мест)',
          doc.get('packaging'), '(тара, упаковка (при наличии)')
    field(doc.get('carrierRemarks'),
          '(оговорки и замечания перевозчика (при наличии) о состоянии и креплении груза)')
    field(doc.get('loaderSignature'),
          '(подпись, расшифровка подписи лица, осуществившего погрузку груза)',
          doc.get('driverSignature'),
          '(подпись, расшифровка подписи водителя, принявшего груз для перевозки)')

    section('9. Переадресовка (при наличии)')
    field('-', '(дата, вид переадресовки)', '-',
          '(адрес нового пункта выгрузки, новые дата и время подачи)')

    section('10. Выдача груза')
    field(doc.get('unloadingAddress'), '(адрес места выгрузки)',
          _fmt_dt(doc.get('plannedUnloadingAt')),
          '(заявленные дата и время подачи транспортного средства под выгрузку)')
    field(doc.get('cargoCondition'),
          '(фактическое состояние груза, тары, упаковки, маркировки)',
          doc.get('unloadPlaces'), '(количество грузовых мест)')
    field(doc.get('unloadWeight'),
          '(масса груза брутто в килограммах, масса груза нетто)')
    field('', '(должность, подпись, расшифровка подписи грузополучателя)',
          '', '(подпись, расшифровка подписи водителя, сдавшего груз)')

    section('11. Отметки грузоотправителей, грузополучателей, перевозчиков')
    field('-', '(краткое описание обстоятельств, послуживших основанием для отметки)')

    section('12. Стоимость перевозки груза (установленная плата) в рублях')
    field(doc.get('transportCost'), '(стоимость перевозки без налога — всего)',
          doc.get('transportCostVat'), '(сумма налога, предъявляемая покупателю)')
    field(doc.get('transportCostTotal'), '(стоимость перевозки с налогом — всего)')

    if doc.get('comment'):
        section('Комментарий')
        field(doc.get('comment'), '')

    wb.save(path)


def _upload(path, filename):
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'waybills/{filename}'
    with open(path, 'rb') as f:
        s3.put_object(
            Bucket='files',
            Key=key,
            Body=f.read(),
            ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def handler(event: dict, context) -> dict:
    """Транспортная накладная по поставке — для отгрузки сторонним перевозчиком.

    Форма Приложения № 4 к Правилам перевозок грузов автомобильным транспортом
    (в ред. ПП РФ от 30.11.2021 № 2116). Порядок работы: менеджер заполняет
    карточку и подтверждает готовность, система собирает файл XLSX, кладовщик
    скачивает его, отдаёт водителю и отгружает поставку.

    ЭТрН здесь не участвует: перевозчик (Газелька) оформляет электронную
    накладную в своём контуре, а этот документ едет с машиной на бумаге.

    GET  /?supplyId=12               - накладная поставки (null, если не заводили)
    POST /  { action: 'create', supplyId }
        - черновик с нашими реквизитами, складом назначения и числом коробов
    POST /  { action: 'update', supplyId, ...поля }
        - сохранить поля накладной
    POST /  { action: 'generate', supplyId }
        - собрать файл XLSX и положить в хранилище
    POST /  { action: 'set_ready', supplyId, ready, actorId }
        - подтвердить готовность: кладовщик увидит кнопку скачивания

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ с карточкой накладной
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            supply_id = params.get('supplyId')
            if not supply_id:
                return _resp(400, {'error': 'Укажите supplyId'})
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        if method != 'POST':
            return _resp(405, {'error': 'Method not allowed'})

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        if action not in ('create', 'update', 'generate', 'set_ready'):
            return _resp(400, {'error': 'Неизвестное действие'})

        supply_id = body_data.get('supplyId')
        if not supply_id:
            return _resp(400, {'error': 'Укажите supplyId'})

        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')
        role = _role(cur, actor_id)

        # Заполнение и подтверждение — только менеджер. Кладовщик документ читает
        # и скачивает: у погрузки нет времени разбираться, кто что поправил.
        if action != 'generate' and role not in MANAGER_ROLES:
            return _resp(403, {'error': 'Накладную заполняет менеджер'})

        if action == 'create':
            if _get_doc(cur, supply_id):
                return _resp(400, {'error': 'Накладная по этой поставке уже заведена'})
            d = _defaults(cur, supply_id)
            if d is None:
                return _resp(404, {'error': 'Поставка не найдена'})
            d.pop('cargo_name_items', None)
            cols = list(d.keys())
            placeholders = ', '.join(['%s'] * (len(cols) + 2))
            cur.execute(
                f"INSERT INTO waybill_documents (supply_id, {', '.join(cols)}, created_by) "
                f'VALUES ({placeholders})',
                [int(supply_id)] + [d[c] for c in cols]
                + [int(actor_id) if actor_id else None],
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        doc = _get_doc(cur, supply_id)
        if not doc:
            return _resp(404, {'error': 'Накладная не заведена'})

        if action == 'update':
            sets, values = [], []
            for json_key, col in EDITABLE.items():
                if json_key in body_data:
                    v = body_data[json_key]
                    sets.append(f'{col} = %s')
                    values.append(v if v != '' else None)
            if not sets:
                return _resp(400, {'error': 'Нечего сохранять'})
            # Любая правка сбрасывает готовность: иначе кладовщик скачал бы файл,
            # собранный до изменений, и повёз бы водителю устаревшую накладную.
            values.append(int(supply_id))
            cur.execute(
                f"UPDATE waybill_documents SET {', '.join(sets)}, "
                'is_ready = false, ready_at = NULL, ready_by = NULL, '
                'ready_by_name = NULL, updated_at = now() WHERE supply_id = %s',
                values,
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        if action == 'generate':
            fname = f"TN-{doc.get('number') or supply_id}-{int(datetime.now().timestamp())}.xlsx"
            path = f'/tmp/{fname}'
            _build_xlsx(doc, path)
            url = _upload(path, fname)
            os.remove(path)
            cur.execute(
                'UPDATE waybill_documents SET file_url = %s, file_name = %s, '
                'file_generated_at = now(), updated_at = now() WHERE supply_id = %s',
                (url, fname, int(supply_id)),
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        if action == 'set_ready':
            ready = bool(body_data.get('ready', True))
            # Готовой считаем только накладную с собранным файлом: подтверждать
            # документ, которого нельзя скачать, значит обещать кладовщику пустоту.
            if ready and not doc.get('fileUrl'):
                return _resp(400, {
                    'error': 'Сначала сформируйте файл накладной — '
                             'кладовщику нужно что скачивать',
                })
            cur.execute(
                'UPDATE waybill_documents SET is_ready = %s, '
                'ready_at = CASE WHEN %s THEN now() ELSE NULL END, '
                'ready_by = %s, ready_by_name = %s, updated_at = now() '
                'WHERE supply_id = %s',
                (
                    ready, ready,
                    int(actor_id) if actor_id and ready else None,
                    actor_name if ready else None,
                    int(supply_id),
                ),
            )
            conn.commit()
            return _resp(200, {'document': _get_doc(cur, supply_id)})

        return _resp(400, {'error': 'Неизвестное действие'})
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
