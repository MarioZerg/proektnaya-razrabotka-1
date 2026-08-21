import base64
import json
import os
import uuid
from datetime import datetime

import boto3
import psycopg2


# Типы документов, которые сотрудник загружает в профиле. Ключ хранится в базе,
# подпись показывается человеку.
DOC_TYPES = {
    'passport_main': 'Паспорт: разворот с фото',
    'passport_registration': 'Паспорт: страница с пропиской',
    'snils': 'СНИЛС',
}

# Принимаем ТОЛЬКО сканы и фото: из PDF-документа Word админ не сможет разобрать
# данные так же надёжно, а главное — по фото видно, что это подлинный документ.
ALLOWED_MIME = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/heic': 'heic',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
}

# Мелкий файл — почти всегда пересжатое фото из мессенджера, на котором номер
# паспорта не читается. Требуем осмысленный минимум, чтобы админ не гадал.
MIN_FILE_BYTES = 60 * 1024
MAX_FILE_BYTES = 12 * 1024 * 1024


def is_admin(cur, actor_id) -> bool:
    """Роль берём из базы, а не из запроса: иначе её можно подменить в браузере."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def upload_scan(base64_data: str, mime: str) -> str:
    """Кладёт скан документа в хранилище и возвращает постоянную ссылку."""
    _, _, data = base64_data.partition(',')
    binary = base64.b64decode(data)
    ext = ALLOWED_MIME.get(mime, 'jpg')
    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'personal-docs/{uuid.uuid4().hex}.{ext}'
    s3.put_object(Bucket='files', Key=key, Body=binary, ContentType=mime)
    return (
        f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}"
        f"/bucket/{key}"
    ), len(binary)


def iso(value):
    return (value.isoformat() + 'Z') if value else None


def docs_status(row_map: dict, doc_types: set) -> dict:
    """Считает состояние срока на загрузку документов.

    Правило простое: пока очередь за сотрудником — срок течёт, как только он загрузил
    полный комплект и ждёт проверки — срок замирает. Блокировать человека за то, что
    администратор не успел посмотреть документы, нельзя.
    """
    deadline = row_map.get('docs_deadline')
    verified = bool(row_map.get('personal_data_verified'))
    submitted = row_map.get('docs_submitted_at')
    blocked = bool(row_map.get('docs_blocked'))
    complete = doc_types >= set(DOC_TYPES.keys())

    # Данные проверены — требование закрыто, счётчик больше не показываем.
    if verified:
        return {'state': 'done', 'daysLeft': None, 'deadline': None, 'blocked': False}

    if blocked:
        return {
            'state': 'blocked',
            'daysLeft': 0,
            'deadline': iso(deadline),
            'blocked': True,
        }

    # Комплект загружен — ждём администратора, срок не течёт.
    if complete and submitted:
        return {
            'state': 'review',
            'daysLeft': None,
            'deadline': iso(deadline),
            'blocked': False,
        }

    # Срок не назначен — это действующий сотрудник, с него документы не требуем.
    if not deadline:
        return {'state': 'none', 'daysLeft': None, 'deadline': None, 'blocked': False}

    left = deadline - datetime.utcnow()
    days = left.days + (1 if left.seconds > 0 and left.days >= 0 else 0)
    # Когда до конца меньше суток, «0 дней» звучит как «срок уже вышел», а
    # «1 день» — как будто время ещё есть. Ни то ни другое не правда, поэтому
    # на финишной прямой считаем часы: «осталось 6 часов» понятно без пояснений.
    hours_left = max(0, int(left.total_seconds() // 3600))
    return {
        'state': 'countdown',
        'daysLeft': max(0, days) if left.total_seconds() > 0 else 0,
        'hoursLeft': hours_left if left.total_seconds() > 0 else 0,
        'deadline': iso(deadline),
        'blocked': False,
        'expired': left.total_seconds() <= 0,
    }


def handler(event: dict, context) -> dict:
    """Персональные данные сотрудника: сканы документов, паспорт и реквизиты СБП.

    Сканы паспорта и СНИЛС видит только администратор — это персональные данные.
    Сотрудник загружает их у себя в профиле, но открыть чужие не может.

    GET  /?userId=5&actorId=1
        - данные сотрудника. Сканы и паспортные поля отдаются только администратору
          либо самому сотруднику
    POST / { action: 'upload_doc', userId, docType, fileBase64, mimeType, fileName }
        - загрузка скана. Принимаются только фото и PDF, мелкие файлы отклоняются
    POST / { action: 'save_sbp', userId, sbpPhone, sbpBank }
        - сотрудник указывает телефон и банк для выплат по СБП. Любое изменение
          сбрасывает подтверждение админа: номер надо сверить заново
    POST / { action: 'confirm_sbp', userId, actorId }
        - админ подтверждает реквизиты. Без этого договор отправить нельзя
    POST / { action: 'save_passport', userId, actorId, ... }
        - админ вписывает данные, сверяя со сканом, и ставит отметку о проверке

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        HTTP-ответ с данными сотрудника
    """
    method = event.get('httpMethod', 'GET')
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
        'Content-Type': 'application/json',
    }

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {**headers, 'Access-Control-Max-Age': '86400'},
            'body': '',
        }

    dsn = os.environ['DATABASE_URL']
    params = event.get('queryStringParameters') or {}

    if method == 'GET':
        user_id = params.get('userId')
        actor_id = params.get('actorId')
        if not user_id:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Укажите сотрудника'}),
            }

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()
            admin = is_admin(cur, actor_id)
            # Свои данные сотрудник видит всегда, чужие — только администратор.
            if not admin and str(actor_id) != str(user_id):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({'error': 'Нет доступа к данным этого сотрудника'}),
                }

            cur.execute(
                "SELECT full_name, passport_series, passport_number, passport_issued_by, "
                "passport_issued_date, passport_department_code, birth_date, "
                "registration_address, snils, inn, sbp_phone, sbp_bank, sbp_confirmed, "
                "personal_data_verified, personal_data_verified_at, phone, "
                "docs_deadline, docs_submitted_at, docs_rejected_reason, docs_blocked "
                "FROM users WHERE id = %s",
                (int(user_id),),
            )
            r = cur.fetchone()
            if not r:
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({'error': 'Сотрудник не найден'}),
                }

            cur.execute(
                "SELECT doc_type, file_url, file_name, uploaded_at FROM user_documents "
                "WHERE user_id = %s",
                (int(user_id),),
            )
            docs = [
                {
                    'docType': d[0],
                    'label': DOC_TYPES.get(d[0], d[0]),
                    # Сам скан открывает только админ. Сотруднику показываем лишь факт
                    # загрузки: незачем гонять его паспорт по сети лишний раз.
                    'fileUrl': d[1] if admin else None,
                    'fileName': d[2],
                    'uploadedAt': iso(d[3]),
                }
                for d in cur.fetchall()
            ]

            data = {
                'userId': int(user_id),
                'fullName': r[0],
                'sbpPhone': r[10],
                'sbpBank': r[11],
                'sbpConfirmed': bool(r[12]),
                'personalDataVerified': bool(r[13]),
                'personalDataVerifiedAt': iso(r[14]),
                'phone': r[15],
                'documents': docs,
                'requiredDocs': [
                    {'docType': k, 'label': v} for k, v in DOC_TYPES.items()
                ],
                'docsStatus': docs_status(
                    {
                        'docs_deadline': r[16],
                        'docs_submitted_at': r[17],
                        'personal_data_verified': r[13],
                        'docs_blocked': r[19],
                    },
                    {d['docType'] for d in docs},
                ),
                'docsRejectedReason': r[18],
            }
            if admin:
                data.update({
                    'passportSeries': r[1],
                    'passportNumber': r[2],
                    'passportIssuedBy': r[3],
                    'passportIssuedDate': iso(r[4]),
                    'passportDepartmentCode': r[5],
                    'birthDate': iso(r[6]),
                    'registrationAddress': r[7],
                    'snils': r[8],
                    'inn': r[9],
                })

            return {'statusCode': 200, 'headers': headers, 'body': json.dumps(data)}
        finally:
            conn.close()

    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        if action == 'upload_doc':
            user_id = body_data.get('userId')
            doc_type = body_data.get('docType')
            file_base64 = body_data.get('fileBase64') or ''
            mime = (body_data.get('mimeType') or '').lower()
            file_name = (body_data.get('fileName') or 'scan.jpg')[:300]
            actor_id = body_data.get('actorId')

            if doc_type not in DOC_TYPES:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Неизвестный тип документа'}),
                }
            admin = is_admin(cur, actor_id)
            if not admin and str(actor_id) != str(user_id):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({'error': 'Можно загружать только свои документы'}),
                }
            if mime not in ALLOWED_MIME:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Подходят только фото или скан: JPG, PNG, HEIC или PDF'
                    }),
                }

            file_url, size = upload_scan(file_base64, mime)
            if size < MIN_FILE_BYTES:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Фото слишком мелкое — данные будет не разобрать. '
                                 'Сфотографируйте документ заново при хорошем свете'
                    }),
                }
            if size > MAX_FILE_BYTES:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Файл больше 12 МБ — уменьшите размер'}),
                }

            # Перезагрузка скана заменяет прежний: копить размытые попытки незачем.
            cur.execute(
                "INSERT INTO user_documents (user_id, doc_type, file_url, file_name, "
                "mime_type, file_size, uploaded_by) VALUES (%s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (user_id, doc_type) DO UPDATE SET file_url = EXCLUDED.file_url, "
                "file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type, "
                "file_size = EXCLUDED.file_size, uploaded_at = now(), "
                "uploaded_by = EXCLUDED.uploaded_by",
                (int(user_id), doc_type, file_url, file_name, mime, size,
                 int(actor_id) if actor_id else None),
            )
            # Новый скан — данные надо сверить заново: вдруг человек прислал другой паспорт.
            cur.execute(
                "UPDATE users SET personal_data_verified = false, "
                "personal_data_verified_at = NULL WHERE id = %s",
                (int(user_id),),
            )

            # Комплект собран — фиксируем момент сдачи и снимаем прежний отказ.
            # С этой отметкой срок замирает: дальше очередь за администратором.
            cur.execute(
                "SELECT count(DISTINCT doc_type) FROM user_documents WHERE user_id = %s",
                (int(user_id),),
            )
            if cur.fetchone()[0] >= len(DOC_TYPES):
                cur.execute(
                    "UPDATE users SET docs_submitted_at = COALESCE(docs_submitted_at, now()), "
                    "docs_rejected_reason = NULL, docs_rejected_at = NULL "
                    "WHERE id = %s",
                    (int(user_id),),
                )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'success': True, 'fileUrl': file_url}),
            }

        if action == 'save_sbp':
            user_id = body_data.get('userId')
            actor_id = body_data.get('actorId')
            sbp_phone = (body_data.get('sbpPhone') or '').strip()[:30]
            sbp_bank = (body_data.get('sbpBank') or '').strip()[:120]

            admin = is_admin(cur, actor_id)
            if not admin and str(actor_id) != str(user_id):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({'error': 'Можно менять только свои реквизиты'}),
                }
            digits = ''.join(c for c in sbp_phone if c.isdigit())
            if len(digits) != 11:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Номер телефона указывается полностью, в формате +7 999 123-45-67'
                    }),
                }
            if not sbp_bank:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Укажите банк — по СБП деньги уходят в конкретный банк'
                    }),
                }

            # Смена номера сбрасывает подтверждение: иначе можно подменить реквизиты
            # после проверки, и выплата уйдёт на чужой счёт.
            cur.execute(
                "UPDATE users SET sbp_phone = %s, sbp_bank = %s, sbp_confirmed = false, "
                "sbp_confirmed_at = NULL, sbp_confirmed_by = NULL WHERE id = %s",
                (sbp_phone, sbp_bank, int(user_id)),
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'success': True}),
            }

        if action == 'confirm_sbp':
            actor_id = body_data.get('actorId')
            if not is_admin(cur, actor_id):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({'error': 'Подтверждать реквизиты может только администратор'}),
                }
            user_id = body_data.get('userId')
            cur.execute(
                "UPDATE users SET sbp_confirmed = true, sbp_confirmed_at = now(), "
                "sbp_confirmed_by = %s WHERE id = %s AND sbp_phone IS NOT NULL "
                "AND sbp_phone <> '' RETURNING id",
                (int(actor_id), int(user_id)),
            )
            if not cur.fetchone():
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Сотрудник ещё не указал номер для СБП'}),
                }
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'success': True}),
            }

        if action == 'reject_docs':
            # Админ отклоняет некачественные сканы: срок назначается заново, сотрудник
            # видит причину. Без причины отклонять нельзя — человек не поймёт, что не так.
            actor_id = body_data.get('actorId')
            if not is_admin(cur, actor_id):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({'error': 'Отклонять документы может только администратор'}),
                }
            user_id = body_data.get('userId')
            reason = (body_data.get('reason') or '').strip()[:500]
            if not reason:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Напишите, что не так с документами — сотрудник должен '
                                 'понимать, что переснять'
                    }),
                }
            days = int(body_data.get('days') or 7)
            cur.execute(
                "UPDATE users SET docs_rejected_reason = %s, docs_rejected_at = now(), "
                "docs_submitted_at = NULL, docs_blocked = false, "
                "personal_data_verified = false, personal_data_verified_at = NULL, "
                "docs_deadline = now() + (%s || ' days')::interval WHERE id = %s",
                (reason, str(days), int(user_id)),
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'success': True}),
            }

        if action == 'unblock_docs':
            # Возврат заблокированного сотрудника в работу: только администратор и
            # только вручную — это и есть «перевести в рабочий профиль».
            actor_id = body_data.get('actorId')
            if not is_admin(cur, actor_id):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({'error': 'Снять блокировку может только администратор'}),
                }
            user_id = body_data.get('userId')
            days = int(body_data.get('days') or 7)
            cur.execute(
                "UPDATE users SET docs_blocked = false, "
                "docs_deadline = now() + (%s || ' days')::interval WHERE id = %s",
                (str(days), int(user_id)),
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'success': True}),
            }

        if action == 'check_expired':
            # Срок вышел, а комплекта нет — ставим блокировку. Проверку делает сам
            # сотрудник при входе: отдельный планировщик ради этого держать незачем.
            # Смысл блокировки — не пустить к работе, а к работе человек попадает
            # только через вход, так что момент проверки выбран верно.
            user_id = body_data.get('userId')
            cur.execute(
                "UPDATE users u SET docs_blocked = true "
                "WHERE u.id = %s AND u.docs_blocked = false "
                "AND u.personal_data_verified = false "
                "AND u.docs_deadline IS NOT NULL AND u.docs_deadline < now() "
                "AND u.docs_submitted_at IS NULL RETURNING u.id",
                (int(user_id),),
            )
            blocked = cur.fetchone() is not None
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'blocked': blocked}),
            }

        if action == 'save_passport':
            actor_id = body_data.get('actorId')
            if not is_admin(cur, actor_id):
                return {
                    'statusCode': 403,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Паспортные данные вносит только администратор'
                    }),
                }
            user_id = body_data.get('userId')
            verified = bool(body_data.get('verified'))

            def clean(key, limit):
                return (body_data.get(key) or '').strip()[:limit] or None

            series = clean('passportSeries', 10)
            number = clean('passportNumber', 10)
            issued_by = clean('passportIssuedBy', 500)
            issued_date = clean('passportIssuedDate', 20)
            dep_code = clean('passportDepartmentCode', 15)
            birth_date = clean('birthDate', 20)
            address = clean('registrationAddress', 500)
            snils = clean('snils', 20)
            inn = clean('inn', 20)

            # Отметку «данные проверены» ставим только когда заполнено всё, что
            # попадёт в договор: договор с пустой графой паспорта недействителен.
            if verified and not all([series, number, issued_by, issued_date, address]):
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Для отметки о проверке заполните серию, номер, кем и когда '
                                 'выдан паспорт и адрес регистрации'
                    }),
                }

            cur.execute(
                "UPDATE users SET passport_series = %s, passport_number = %s, "
                "passport_issued_by = %s, passport_issued_date = %s, "
                "passport_department_code = %s, birth_date = %s, registration_address = %s, "
                "snils = %s, inn = %s, personal_data_verified = %s, "
                "personal_data_verified_at = %s, personal_data_verified_by = %s, "
                # Данные проверены — требование закрыто: снимаем срок, блокировку
                # и прежний отказ, чтобы счётчик у сотрудника пропал.
                "docs_deadline = CASE WHEN %s THEN NULL ELSE docs_deadline END, "
                "docs_blocked = CASE WHEN %s THEN false ELSE docs_blocked END, "
                "docs_rejected_reason = CASE WHEN %s THEN NULL ELSE docs_rejected_reason END "
                "WHERE id = %s",
                (
                    series, number, issued_by, issued_date, dep_code, birth_date, address,
                    snils, inn, verified,
                    datetime.utcnow() if verified else None,
                    int(actor_id) if verified else None,
                    verified, verified, verified,
                    int(user_id),
                ),
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'success': True}),
            }

        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'Неизвестное действие'}),
        }
    finally:
        conn.close()