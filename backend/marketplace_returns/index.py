import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2

# Возвраты тянем ТОЛЬКО НА ЧТЕНИЕ: списки заявок на возврат у OZON и WB. Ничего на стороне
# маркетплейса не подтверждаем и не отклоняем — решение принимает кладовщик, когда вещь
# физически доехала до склада.
OZON_API_BASE = 'https://api-seller.ozon.ru'
# Заявки покупателей на возврат WB отдаёт отдельный хост returns-api (не marketplace-api).
WB_RETURNS_API_BASE = 'https://returns-api.wildberries.ru'
YM_API_BASE = 'https://api.partner.market.yandex.ru'

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


def log_action(cur, actor_id, actor_name, action, description, details=None):
    cur.execute(
        "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, description, details) "
        "VALUES (%s, %s, 'returns', %s, 'marketplace_return', %s, %s)",
        (
            int(actor_id) if actor_id not in (None, '') else None,
            actor_name or None,
            action,
            description,
            json.dumps(details) if details else None,
        ),
    )


def get_credentials(cur, code, shop_id=None):
    """Учётные данные кабинета конкретного магазина.

    Заявка на возврат приезжает из кабинета продавца, и забирать её надо по
    коду того же кабинета. Без явного магазина брался первый попавшийся ключ —
    возвраты второго кабинета в систему не приезжали вовсе.
    """
    if shop_id:
        cur.execute(
            "SELECT is_enabled, credentials FROM marketplace_integrations "
            "WHERE marketplace_code = %s AND shop_id = %s LIMIT 1",
            (code, int(shop_id)),
        )
    else:
        cur.execute(
            "SELECT is_enabled, credentials FROM marketplace_integrations WHERE marketplace_code = %s ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1",
            (code,),
        )
    row = cur.fetchone()
    if not row:
        return {}, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds, bool(row[0])


def http_json(url, method, headers, payload=None):
    """HTTP-запрос с JSON. Возвращает (status_code, parsed_json_or_text)."""
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
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


def error_text(data):
    if isinstance(data, dict):
        return data.get('message') or data.get('error') or data.get('detail') or json.dumps(data, ensure_ascii=False)
    return str(data)


def list_return_shops(cur):
    """Магазины с подключёнными кабинетами — загрузка обходит их по очереди."""
    cur.execute(
        "SELECT DISTINCT shop_id FROM marketplace_integrations "
        "WHERE is_enabled = true AND credentials::text <> '{}' AND shop_id IS NOT NULL "
        "ORDER BY shop_id"
    )
    return [r[0] for r in cur.fetchall()]


def find_item(cur, sku, offer_id):
    """Находит товар в справочнике по SKU маркетплейса или артикулу продавца."""
    if sku:
        cur.execute(
            "SELECT id, name FROM marketplace_items "
            "WHERE ozon_sku = %s OR wb_sku = %s OR ym_sku = %s LIMIT 1",
            (str(sku), str(sku), str(sku)),
        )
        row = cur.fetchone()
        if row:
            return row
    if offer_id:
        # Артикул продавца лежит в разных колонках: свой sku и артикул Яндекса.
        cur.execute(
            "SELECT id, name FROM marketplace_items WHERE sku = %s OR ym_sku = %s LIMIT 1",
            (str(offer_id), str(offer_id)),
        )
        row = cur.fetchone()
        if row:
            return row
    return None, None


def find_order(cur, marketplace, posting_number):
    """Заказ, по которому оформлен возврат.

    У OZON это номер отправления. У WB в заявке лежит srid, а номер заказа у нас —
    id сборочного задания, srid хранится отдельно в wb_rid. У Яндекса на пакете
    голый номер заказа, у нас он внутри YM-12345-1.
    """
    if not posting_number:
        return None
    if marketplace == 'OZON':
        cur.execute(
            "SELECT id FROM orders WHERE ozon_posting_number = %s ORDER BY id LIMIT 1",
            (str(posting_number),),
        )
    elif marketplace == 'WB':
        # У заявки WB в номере лежит srid (rid задания), а номер заказа у нас —
        # id сборочного задания. Ищем по всем трём, иначе возврат остаётся без заказа
        # и сканер с ПВЗ его не подцепляет.
        cur.execute(
            "SELECT id FROM orders WHERE marketplace = 'WB' AND ("
            "order_number = %s OR wb_rid = %s OR CAST(wb_order_id AS TEXT) = %s) "
            "ORDER BY id LIMIT 1",
            (str(posting_number), str(posting_number), str(posting_number)),
        )
    elif marketplace == 'Yandex':
        # Яндекс отдаёт голый номер заказа, у нас он внутри YM-12345-1.
        digits = str(posting_number)
        if digits.upper().startswith('YM-'):
            digits = digits[3:]
        digits = digits.split('-')[0]
        cur.execute(
            "SELECT id FROM orders WHERE marketplace = 'Yandex' AND ("
            "order_number = %s OR CAST(ym_order_id AS TEXT) = %s OR group_key = %s) "
            "ORDER BY (order_number = %s) DESC, id LIMIT 1",
            (str(posting_number), digits, f'YM-{digits}', str(posting_number)),
        )
    else:
        # Ищем строго среди заказов своей площадки: номера у разных маркетплейсов
        # могут совпасть, и возврат прицепился бы к чужому заказу.
        cur.execute(
            "SELECT id FROM orders WHERE order_number = %s AND marketplace = %s "
            "ORDER BY id LIMIT 1",
            (str(posting_number), marketplace),
        )
    row = cur.fetchone()
    return row[0] if row else None


def save_return(cur, marketplace, r, shop_id=None):
    """Сохраняет одну заявку на возврат. Повторная загрузка обновляет статус, но не плодит
    дубли (уникальный индекс marketplace + external_id). Возвращает 'created'/'updated'."""
    # Сразу пробуем обновить: возвраты повторно загружаются гораздо чаще, чем появляются
    # новые, и лишний SELECT перед каждым UPDATE удваивал работу базы на всей выборке.
    # Свой статус обработки не трогаем — обновляем только данные со стороны маркетплейса.
    # Штрихкод с наклейки дописываем и старым записям: возвраты, загруженные до того,
    # как мы научились его читать, иначе остались бы несканируемыми.
    cur.execute(
        "UPDATE marketplace_returns SET mp_status = %s, return_reason = %s, "
        "product_name = COALESCE(%s, product_name), "
        "return_barcode = COALESCE(return_barcode, %s) "
        "WHERE marketplace = %s AND external_id = %s RETURNING id",
        (r.get('mpStatus'), r.get('reason'), r.get('productName'),
         r.get('returnBarcode'), marketplace, r['externalId']),
    )
    if cur.fetchone():
        return 'updated'

    item_id, item_name = find_item(cur, r.get('sku'), r.get('offerId'))
    order_id = find_order(cur, marketplace, r.get('postingNumber'))
    cur.execute(
        "INSERT INTO marketplace_returns (marketplace, external_id, posting_number, order_id, "
        "offer_id, sku, product_name, marketplace_item_id, quantity, mp_status, return_reason, "
        "mp_created_at, return_barcode, shop_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            marketplace,
            r['externalId'],
            r.get('postingNumber'),
            order_id,
            r.get('offerId'),
            str(r.get('sku')) if r.get('sku') else None,
            r.get('productName') or item_name,
            item_id,
            int(r.get('quantity') or 1),
            r.get('mpStatus'),
            r.get('reason'),
            r.get('createdAt'),
            r.get('returnBarcode'),
            # Кабинет, из которого приехала заявка: забирать её надо его кодом.
            shop_id,
        ),
    )
    return 'created'


def sync_ozon(cur, days, r_statuses=None, shop_id=None):
    """Заявки на возврат OZON (FBS и FBO). Читаем список возвратов за период."""
    creds, enabled = get_credentials(cur, 'ozon', shop_id)
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция OZON выключена'}
    client_id = (creds.get('clientId') or '').strip()
    api_key = (creds.get('apiKey') or '').strip()
    if not client_id or not api_key:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнены Client Id и Api Key OZON'}

    headers = {'Client-Id': client_id, 'Api-Key': api_key}
    created = updated = 0
    sync_error = None

    # Берём возвраты по СТАТУСУ, а не по дате логистики: у вещей, которые ещё лежат в
    # пункте выдачи, дата возврата не проставлена, и фильтр по ней отдавал пустой список —
    # склад видел «24 ждут» из кабинета OZON, а принять сканером было нечего.
    #   ArrivedAtReturnPlace — доехал до пункта выдачи, ждёт нас;
    #   MovingToOzon         — едет к нам;
    #   ReturnedToOzon       — уже забрали / у площадки.
    # Последние два тоже нужны: кладовщик привозит коробку и пикает наклейку уже ПОСЛЕ
    # того, как OZON сменил статус, — без них свежезабранный возврат не опознавался.
    # Другие названия статусов площадка отвергает с ошибкой, поэтому список строго такой.
    # Статусы можно ограничить снаружи: страница возвратов грузит только «ждёт в ПВЗ»
    # (быстро, укладывается в лимит времени), а полную загрузку со всеми статусами
    # запускают кнопкой, когда нужно найти уже забранную коробку.
    wanted = r_statuses or ('ArrivedAtReturnPlace',)
    # Функции отведено немного времени на ответ, а забранных возвратов у площадки сотни.
    # Держим бюджет: как только время подходит к концу, останавливаемся и отдаём то, что
    # успели сохранить. Следующий запуск продолжит с того же места — данные копятся, а
    # кладовщик не получает пустой ответ по таймауту.
    deadline = time.monotonic() + 3.0
    for visual_status in wanted:
        # Продолжаем с того места, где остановились в прошлый раз: иначе каждый запуск
        # перечитывал первую страницу, и дальние возвраты в систему никогда не попадали.
        cur.execute(
            "SELECT last_id FROM marketplace_returns_cursor "
            "WHERE marketplace = 'OZON' AND visual_status = %s",
            (visual_status,),
        )
        cur_row = cur.fetchone()
        last_id = int(cur_row[0]) if cur_row else 0

        for _ in range(6):  # страховка от бесконечной постраничной выборки
            if time.monotonic() > deadline:
                break
            status, data = http_json(
                OZON_API_BASE + '/v1/returns/list',
                'POST',
                headers,
                {
                    'filter': {'visual_status_name': visual_status},
                    'limit': 100,
                    'last_id': last_id,
                },
            )
            if status != 200:
                # Один статус не принят площадкой — не роняем всю загрузку: остальные
                # возвраты важнее, кладовщику нужно принять то, что уже приехало.
                sync_error = error_text(data)
                break

            returns = (data or {}).get('returns') or []
            if not returns:
                break
            for it in returns:
                product = it.get('product') or {}
                exchange = it.get('exchange_order') or {}
                rec = {
                    'externalId': str(it.get('id') or exchange.get('id') or ''),
                    'postingNumber': it.get('posting_number'),
                    'offerId': product.get('offer_id'),
                    'sku': product.get('sku'),
                    'productName': product.get('name'),
                    'quantity': product.get('quantity') or 1,
                    'mpStatus': (it.get('visual') or {}).get('status', {}).get('display_name')
                    or it.get('status'),
                    'reason': it.get('return_reason_name') or it.get('reason'),
                    'createdAt': it.get('logistic', {}).get('return_date')
                    or it.get('created_at'),
                    # Возвратный штрихкод с наклейки на коробке (вида «ii9093249974»).
                    # Именно его кладовщик пикает сканером при приёмке — без него
                    # система не могла опознать приехавшую вещь.
                    'returnBarcode': (it.get('logistic') or {}).get('barcode'),
                }
                if not rec['externalId']:
                    continue
                # Бюджет проверяем на КАЖДОЙ записи, а не только между страницами:
                # сохранение одного возврата — это несколько обращений к базе, и сотня
                # записей подряд успевала съесть всё отведённое функции время.
                if time.monotonic() > deadline:
                    break
                if save_return(cur, 'OZON', rec, shop_id) == 'created':
                    created += 1
                else:
                    updated += 1
                # Двигаем закладку по каждой сохранённой записи: если время кончится
                # посередине страницы, следующий запуск продолжит ровно отсюда.
                last_id = it.get('id') or last_id

            # Страницы кончились — начинаем круг заново, чтобы подхватывать новые возвраты
            # и обновлять статусы уже загруженных.
            if not (data or {}).get('has_next'):
                last_id = 0
                break

        cur.execute(
            "INSERT INTO marketplace_returns_cursor (marketplace, visual_status, last_id, updated_at) "
            "VALUES ('OZON', %s, %s, now()) "
            "ON CONFLICT (marketplace, visual_status) "
            "DO UPDATE SET last_id = EXCLUDED.last_id, updated_at = now()",
            (visual_status, int(last_id or 0)),
        )
    # Ошибку показываем, только если совсем ничего не загрузилось.
    return {
        'created': created,
        'updated': updated,
        'error': None if (created or updated) else sync_error,
    }


def sync_wb(cur, days, shop_id=None):
    """Заявки покупателей на возврат Wildberries."""
    creds, enabled = get_credentials(cur, 'wildberries', shop_id)
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция Wildberries выключена'}
    api_key = (creds.get('apiKey') or '').strip()
    if not api_key:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнен Api Key Wildberries'}

    # WB отдаёт заявки постранично и НЕ принимает фильтр по дате — берём свежие
    # (is_archive=false: ещё не закрытые) и отсеиваем старые уже у себя.
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    created = updated = 0
    claims = []
    for offset in range(0, 1000, 200):
        status, data = http_json(
            f'{WB_RETURNS_API_BASE}/api/v1/claims?is_archive=false&limit=200&offset={offset}',
            'GET',
            {'Authorization': api_key},
        )
        if status != 200:
            return {'created': created, 'updated': updated, 'error': error_text(data)}
        page = (data or {}).get('claims') or []
        claims.extend(page)
        if len(page) < 200:
            break

    for it in claims:
        # WB отдаёт статус числом: 0 — заявка на рассмотрении, 1 — одобрена продавцом,
        # 2 — отклонена, 3 — автоматически одобрена площадкой.
        wb_status_labels = {
            0: 'На рассмотрении',
            1: 'Одобрен продавцом',
            2: 'Отклонён',
            3: 'Одобрен автоматически',
        }
        raw_status = it.get('status')
        status_text = it.get('status_name') or wb_status_labels.get(
            raw_status if isinstance(raw_status, int) else -1, ''
        )
        rec = {
            'externalId': str(it.get('id') or ''),
            'postingNumber': str(it.get('srid') or ''),
            'offerId': str(it.get('nm_id')) if it.get('nm_id') else None,
            'sku': it.get('nm_id'),
            'productName': it.get('imt_name'),
            'quantity': 1,
            'mpStatus': status_text or None,
            'reason': it.get('user_comment') or it.get('claim_type'),
            'createdAt': it.get('dt'),
            # На пакете с ПВЗ живёт srid заявки — его и пикает кладовщик.
            'returnBarcode': str(it.get('srid') or '') or None,
        }
        if not rec['externalId']:
            continue
        # Старые заявки за пределами запрошенного периода пропускаем.
        if rec['createdAt']:
            try:
                dt = datetime.fromisoformat(str(rec['createdAt']).replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt < since_dt:
                    continue
            except ValueError:
                pass
        if save_return(cur, 'WB', rec, shop_id) == 'created':
            created += 1
        else:
            updated += 1
    return {'created': created, 'updated': updated, 'error': None}


def ym_status_label(status):
    """Состояние возврата Яндекса по-русски — кладовщику нужен понятный текст."""
    labels = {
        'STARTED': 'Оформлен покупателем',
        'CREATED': 'Оформлен покупателем',
        'RECEIVED': 'Принят пунктом выдачи',
        'IN_TRANSIT': 'Едет к продавцу',
        'READY_FOR_PICKUP': 'Готов к выдаче',
        'PICKED': 'Забран продавцом',
        'RECEIVED_BY_SHOP': 'Получен продавцом',
        'CANCELLED': 'Отменён',
        'LOST': 'Утерян',
        'UTILIZED': 'Утилизирован',
        'PREPARED_FOR_UTILIZATION': 'Готовится к утилизации',
    }
    return labels.get(status, status)


def sync_yandex(cur, days, shop_id=None):
    """Возвраты Яндекс Маркета.

    Яндекс отдаёт возвраты по кампании и требует период — просим за последние дни.
    Отдельного «статуса заявки» как у WB здесь нет: возврат уже согласован площадкой,
    поэтому показываем его состояние доставки.
    """
    creds, enabled = get_credentials(cur, 'yandex_market', shop_id)
    if not enabled:
        return {'created': 0, 'updated': 0, 'error': 'Интеграция Яндекс Маркета выключена'}
    api_key = (creds.get('apiKey') or '').strip()
    campaign_id = (creds.get('campaignId') or '').strip()
    if not api_key or not campaign_id:
        return {'created': 0, 'updated': 0, 'error': 'Не заполнены Api Key и Campaign Id Яндекс Маркета'}

    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%d-%m-%Y')
    created = updated = 0
    page_token = None

    for _ in range(10):
        path = (
            f'/campaigns/{campaign_id}/returns'
            f'?fromDate={since}&limit=50'
        )
        if page_token:
            path += f'&page_token={page_token}'
        status, data = http_json(
            YM_API_BASE + path, 'GET', {'Api-Key': api_key},
        )
        if status != 200:
            return {'created': created, 'updated': updated, 'error': error_text(data)}

        result = (data or {}).get('result') or {}
        rows = result.get('returns') or []
        if not rows:
            break

        for it in rows:
            # В одном возврате может быть несколько позиций — заводим каждую отдельно,
            # чтобы кладовщик сканировал вещи поштучно, как и у других площадок.
            items = it.get('items') or [{}]
            for idx, item in enumerate(items):
                ret_id = str(it.get('id') or '')
                if not ret_id:
                    continue
                decision = (item.get('decision') or {}) if isinstance(item, dict) else {}
                rec = {
                    # У Яндекса номер один на весь возврат — добавляем номер позиции,
                    # иначе вторая вещь затрёт первую.
                    'externalId': ret_id if len(items) == 1 else f'{ret_id}-{idx + 1}',
                    'postingNumber': str(it.get('orderId') or ''),
                    # У Яндекса артикул продавца называется shopSku, а не offerId.
                    'offerId': str(item.get('shopSku') or item.get('offerId') or '') or None,
                    'sku': item.get('marketSku'),
                    # Названия товара в возврате нет — подставится из справочника
                    # по артикулу в save_return.
                    'productName': item.get('offerName'),
                    'quantity': item.get('count') or 1,
                    'mpStatus': ym_status_label(it.get('shipmentStatus')),
                    'reason': decision.get('reasonType')
                    or item.get('reasonType')
                    or it.get('returnType'),
                    'createdAt': it.get('creationDate') or it.get('createdAt'),
                    # На клиентском стикере Яндекса — номер заказа, не наш YM-… .
                    'returnBarcode': str(it.get('orderId') or '') or None,
                }
                if save_return(cur, 'Yandex', rec, shop_id) == 'created':
                    created += 1
                else:
                    updated += 1

        page_token = ((data or {}).get('paging') or {}).get('nextPageToken')
        if not page_token:
            break

    return {'created': created, 'updated': updated, 'error': None}


def find_goods_closing_order(cur, order_id):
    """Вещь, которой закрыли заказ покупателя.

    Подбор с полки не переписывает карточку на заказ покупателя: у вещи остаётся
    заказ, под который её сшили, а на покупательский она только ссылается
    (fulfilled_from_stock_id у заказа и reserved_order_id у вещи).

    Возврат, который ищет карточку только по заказу покупателя, эту вещь не
    видит и заводит вторую. Здесь ищем именно ту, что уехала покупателю.
    """
    if not order_id:
        return None
    cur.execute(
        "SELECT gw.id, gw.storage_barcode "
        "FROM orders o "
        "JOIN goods_warehouse gw "
        "  ON gw.id = o.fulfilled_from_stock_id "
        "  OR gw.reserved_order_id = o.id "
        "WHERE o.id = %s "
        "ORDER BY (gw.id = o.fulfilled_from_stock_id) DESC, gw.id "
        "LIMIT 1",
        (int(order_id),),
    )
    return cur.fetchone()


def next_storage_barcode(cur):
    """Следующий стикер хранения GW-XXXXXX — номер выдаёт САМА БАЗА.

    Раньше считали «максимум плюс один». Два одновременных запроса получали
    один и тот же номер, второй падал на уникальности и обрывал всю операцию.
    Счётчик базы выдаёт номер атомарно — столкнуться невозможно.
    """
    cur.execute("SELECT nextval('goods_warehouse_storage_seq')")
    return f"GW-{int(cur.fetchone()[0]):06d}"


def log_return_history(cur, gw_id, r_id, order_id, actor_id=None, actor_name=None):
    """Записывает ВОЗВРАТ вещи в её историю.

    Кладовщик при разборе должен видеть, сколько раз вещь уже возвращали: вещь,
    приехавшая обратно в третий раз, почти наверняка с изъяном — её нужно
    осмотреть, а не класть на полку и отправлять следующему покупателю.

    Повторное сканирование той же коробки историю не задваивает: на пару
    «вещь + возврат маркетплейса» стоит уникальный индекс.
    """
    cur.execute(
        "SELECT COALESCE(MAX(return_number), 0) + 1 FROM goods_return_history "
        "WHERE goods_warehouse_id = %s",
        (int(gw_id),),
    )
    next_number = int(cur.fetchone()[0] or 1)

    cur.execute(
        "SELECT r.posting_number, r.marketplace, r.return_reason, o.order_number "
        "FROM marketplace_returns r LEFT JOIN orders o ON o.id = %s "
        "WHERE r.id = %s",
        (int(order_id) if order_id else None, int(r_id)),
    )
    row = cur.fetchone()
    posting, mp, reason, order_number = row if row else (None, None, None, None)

    cur.execute(
        "INSERT INTO goods_return_history (goods_warehouse_id, return_number, "
        "  order_id, order_number, posting_number, marketplace, return_reason, "
        "  marketplace_return_id, received_by, received_by_name) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT DO NOTHING",
        (int(gw_id), next_number, int(order_id) if order_id else None,
         order_number, posting, mp, reason, int(r_id),
         int(actor_id) if actor_id else None, actor_name),
    )
    return next_number


def _wb_sticker_number(code):
    """Цифровой код стикера WB со скана. Иначе None.

    На термоярлыке WB напечатано ДВА вида одного кода: буквенный *DZ5QqmEj
    (его отдаёт API, он лежит в orders.wb_sticker_barcode) и цифровой
    58490661473 — крупные цифры под штрихкодом. Сканер отдаёт именно цифры,
    и до этой правки их не знал никто: скан отвечал «возврат не найден».

    Цифры — первые 5 байт base64-кода как одно 40-битное число, поэтому у
    номера стикера всегда 11 цифр. Номер сборочного задания WB и номер заказа
    Яндекса короче (10 цифр и меньше), так что спутать их нельзя.
    """
    raw = (code or '').strip().lstrip('*')
    if not re.fullmatch(r'\d{11}', raw):
        return None
    num = int(raw)
    # 5 байт: число должно уместиться в 40 бит, иначе это не стикер WB.
    return num if num < (1 << 40) else None


def _scan_aliases(code):
    """Все написания одного кода с пакета WB или Яндекса.

    Сканер приносит стикер как есть: со звёздочкой и без, голые цифры заказа
    Яндекса, те же цифры с позицией грузоместа и наш внутренний вид YM-….
    Заявка в базе хранит только одно из этих написаний.
    """
    raw = (code or '').strip()
    bare = raw.lstrip('*')
    aliases = {raw, bare}
    body = bare[3:] if bare.upper().startswith('YM-') else bare
    if re.fullmatch(r'\d{6,}(-\d{1,3})?', body):
        head = body.split('-')[0]
        aliases.update({body, head, f'YM-{body}', f'YM-{head}'})
    return [a for a in aliases if a]


def _pick_wb_yandex_order(cur, code, marketplace=None):
    """Заказ WB или Яндекса по коду с пакета.

    Берём вещь, которая ещё не принята как возврат. У связки Яндекса на всех
    пакетах один номер заказа: первый скан забирает первую вещь, второй —
    следующую. Если на стикере есть позиция (61866041025-1), берём именно её.
    """
    raw = (code or '').strip()
    bare = raw.lstrip('*')
    aliases = _scan_aliases(raw)
    body = bare[3:] if bare.upper().startswith('YM-') else bare

    conds = [
        "o.order_number = ANY(%s)",
        "o.wb_sticker_barcode = ANY(%s)",
        "o.wb_rid = ANY(%s)",
        "CAST(o.wb_order_id AS TEXT) = ANY(%s)",
        "CAST(o.ym_order_id AS TEXT) = ANY(%s)",
        "o.group_key = ANY(%s)",
        # Заявка уже привязана к заказу, а пикнули её srid, номер возврата
        # или штрихкод — заказ всё равно находим.
        "EXISTS (SELECT 1 FROM marketplace_returns mr "
        "WHERE mr.order_id = o.id AND mr.marketplace = o.marketplace AND ("
        "mr.return_barcode = ANY(%s) OR mr.posting_number = ANY(%s) "
        "OR mr.external_id = ANY(%s)))",
    ]
    params = [aliases, aliases, aliases, aliases, aliases, aliases, aliases, aliases, aliases]

    # Цифры с ярлыка WB: сканер отдаёт номер стикера, а в базе лежит его
    # буквенный вид. Сравниваем с посчитанным из barcode числом.
    sticker_num = _wb_sticker_number(raw)
    if sticker_num is not None:
        conds.append("o.wb_sticker_number = %s")
        params.append(sticker_num)

    # «12345-1» у Яндекса в базе лежит как external_id «12345-1», а голый id
    # возврата — как «12345» при нескольких вещах. Короткий код не разворачиваем:
    # LIKE '1-%' прицепил бы чужие заявки.
    head = body.split('-')[0]
    if re.fullmatch(r'\d{6,}', head):
        conds.append(
            "EXISTS (SELECT 1 FROM marketplace_returns mr "
            "WHERE mr.order_id = o.id AND mr.marketplace = o.marketplace "
            "AND mr.external_id LIKE %s)"
        )
        params.append(head + '-%')

    prefer = None
    if re.fullmatch(r'(?i)YM-\d{6,}-\d{1,3}', raw):
        prefer = raw
    elif re.fullmatch(r'\d{6,}-\d{1,3}', body):
        prefer = f'YM-{body}'

    order_by = (
        "(o.order_number = %s) DESC, " if prefer else ""
    ) + (
        "(gw.id IS NOT NULL AND COALESCE(gw.status, '') <> 'mp_return') DESC, "
        "(gw.id = o.fulfilled_from_stock_id) DESC, "
        "(gw.reserved_order_id = o.id) DESC, o.id"
    )
    if prefer:
        params.append(prefer)

    # Из заявки площадка уже известна: номер WB не должен цепляться к заказу
    # Яндекса с теми же цифрами. С голого скана площадку ещё не знаем.
    if marketplace in ('WB', 'Yandex'):
        mp_sql = "o.marketplace = %s"
        params.insert(0, marketplace)
    else:
        mp_sql = "o.marketplace IN ('WB', 'Yandex')"

    cur.execute(
        "SELECT o.id, o.order_number, o.marketplace, o.material, o.width, o.height, "
        "       gw.id, gw.status, gw.storage_barcode "
        "FROM orders o "
        # Карточка, сшитая под этот заказ, и карточка с полки, которой заказ
        # закрыли. Иначе возврат вещи со склада заводит вторую запись.
        "LEFT JOIN goods_warehouse gw "
        "  ON gw.order_id = o.id "
        "  OR gw.id = o.fulfilled_from_stock_id "
        "  OR gw.reserved_order_id = o.id "
        "WHERE " + mp_sql + " AND ("
        + " OR ".join(conds)
        + ") ORDER BY "
        + order_by
        + " LIMIT 1",
        tuple(params),
    )
    return cur.fetchone()


def _attach_return_to_goods(cur, order_id, gw_id, marketplace, code, actor_id, actor_name):
    """Цепляет одну заявку WB/Яндекса к уже заведённой вещи.

    Один скан — одна заявка. У связки Яндекса у всех вещей один номер заказа,
    и помечать забранной сразу всю связку нельзя: кладовщик пикнул один пакет.
    Заявку, которая уже висит на другой вещи, не трогаем.
    """
    if not order_id or not gw_id:
        return None
    aliases = _scan_aliases(code)
    cur.execute(
        "UPDATE marketplace_returns SET "
        "order_id = COALESCE(order_id, %s), "
        "status = CASE WHEN status IN ('new', 'approved') THEN 'picked_up' ELSE status END, "
        "picked_up_at = COALESCE(picked_up_at, now()), "
        "picked_up_by = COALESCE(picked_up_by, %s), "
        "goods_warehouse_id = %s, "
        "return_barcode = COALESCE(return_barcode, NULLIF(%s, '')), "
        "received_at = COALESCE(received_at, now()) "
        "WHERE id = ("
        "  SELECT id FROM marketplace_returns "
        "  WHERE marketplace = %s AND goods_warehouse_id IS NULL "
        "    AND (order_id IS NULL OR order_id = %s) "
        "    AND (order_id = %s OR return_barcode = ANY(%s) "
        "         OR posting_number = ANY(%s) OR external_id = ANY(%s) "
        # Стикер WB и номер Яндекса на пакете не равны номеру заявки.
        # Заявка лежит по srid или голому номеру заказа — сверяем их с заказом.
        "         OR posting_number IN ("
        "           SELECT v FROM ("
        "             SELECT wb_rid AS v FROM orders WHERE id = %s "
        "             UNION ALL SELECT CAST(ym_order_id AS TEXT) FROM orders WHERE id = %s "
        "             UNION ALL SELECT CAST(wb_order_id AS TEXT) FROM orders WHERE id = %s "
        "             UNION ALL SELECT order_number FROM orders WHERE id = %s"
        "           ) keys WHERE v IS NOT NULL AND v <> ''"
        "         )) "
        "    AND NOT EXISTS ("
        "      SELECT 1 FROM marketplace_returns taken "
        "      WHERE taken.goods_warehouse_id = %s"
        "    ) "
        "  ORDER BY (order_id = %s) DESC, id LIMIT 1"
        ") RETURNING id",
        (
            int(order_id),
            int(actor_id) if actor_id else None,
            int(gw_id),
            (code or '').strip(),
            marketplace,
            int(order_id),
            int(order_id),
            aliases,
            aliases,
            aliases,
            int(order_id),
            int(order_id),
            int(order_id),
            int(order_id),
            int(gw_id),
            int(order_id),
        ),
    )
    linked = cur.fetchone()
    if not linked:
        return None
    log_return_history(
        cur, gw_id, linked[0], order_id,
        int(actor_id) if actor_id else None, actor_name,
    )
    return linked[0]


def _stock_wb_yandex_order(cur, conn, row, code, actor_id, actor_name):
    """Ставит найденный заказ WB/Яндекса на склад как возврат и цепляет заявку."""
    order_id, order_number, marketplace, material, width, height, gw_id, gw_status, storage_barcode = row

    # Повторный скан той же вещи ничего не меняет: кладовщик просто пикнул пакет
    # дважды. Заявку всё равно цепляем — раньше скан заводил вещь и забывал про неё.
    if gw_id and gw_status == 'mp_return':
        _attach_return_to_goods(
            cur, order_id, gw_id, marketplace, code, actor_id, actor_name,
        )
        conn.commit()
        return {
            'found': 0,
            'barcode': code,
            'alreadyPicked': True,
            'accepted': {
                'material': material,
                'width': width,
                'height': height,
                'storageBarcode': storage_barcode,
                'productName': None,
            },
        }

    if gw_id:
        # Вещь уже заводили на склад раньше (уезжала к покупателю и вернулась) —
        # возвращаем ту же запись в возвраты, не плодя вторую.
        cur.execute(
            "UPDATE goods_warehouse SET status = 'mp_return', shelf_id = NULL, "
            "shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
            "reserved_order_id = NULL, shipping_labeled_at = NULL, "
            "shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, "
            "receive_reason = 'return', received_at = now() WHERE id = %s",
            (gw_id,),
        )
    else:
        storage_barcode = next_storage_barcode(cur)
        cur.execute(
            "INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
            "VALUES (%s, 'mp_return', %s, 'return') RETURNING id",
            (order_id, storage_barcode),
        )
        gw_id = cur.fetchone()[0]

    _attach_return_to_goods(
        cur, order_id, gw_id, marketplace, code, actor_id, actor_name,
    )
    log_action(
        cur, actor_id, actor_name, 'receive_return',
        f'Принял возврат {marketplace} по коду {code} — заказ {order_number} ({storage_barcode})',
    )
    conn.commit()

    return {
        'found': 1,
        'barcode': code,
        'alreadyPicked': False,
        'accepted': {
            'material': material,
            'width': width,
            'height': height,
            'storageBarcode': storage_barcode,
            'productName': None,
        },
    }


def _find_return_by_scan(cur, code):
    """Заявка WB/Яндекса, которую кладовщик пикнул, даже если заказ ещё не сопоставился.

    Синхронизация кладёт srid WB и номер заказа Яндекса в заявку. Раньше заказ
    по этим полям не находился, order_id оставался пустым, и сканер заявку не видел.
    """
    aliases = _scan_aliases(code)
    bare = (code or '').strip().lstrip('*')
    body = bare[3:] if bare.upper().startswith('YM-') else bare
    head = body.split('-')[0]
    like_ext = head + '-%' if re.fullmatch(r'\d{6,}', head) else None
    cur.execute(
        "SELECT id, order_id, marketplace, posting_number, external_id, status, "
        "       goods_warehouse_id, product_name "
        "FROM marketplace_returns "
        "WHERE marketplace IN ('WB', 'Yandex') AND ("
        "  return_barcode = ANY(%s) OR posting_number = ANY(%s) OR external_id = ANY(%s) "
        "  OR (%s IS NOT NULL AND external_id LIKE %s)"
        ") "
        # Сначала ещё не принятая вещь: повторный пик того же номера заказа
        # Яндекса забирает следующую позицию связки, а не первую заново.
        "ORDER BY (status IN ('new', 'approved')) DESC, "
        "(goods_warehouse_id IS NULL) DESC, id "
        "LIMIT 1",
        (aliases, aliases, aliases, like_ext, like_ext or ''),
    )
    return cur.fetchone()


def _accept_return_by_order(cur, conn, code, actor_id, actor_name):
    """Приём возврата WB / Яндекса по коду с пакета.

    У OZON возврат ищется в их API по штрихкоду наклейки. У WB и Яндекса такого
    поиска нет. На пакете печатают одно из:

      WB     — стикер отправления (*DWto4dQG или без звёздочки), номер
               сборочного задания, srid заявки;
      Яндекс — голый номер заказа (61866041025), он же с позицией
               (61866041025-1) или наш YM-61866041025-1.

    Нашли заказ — заводим вещь на склад. Нашли только заявку (её ещё не
    привязали к заказу) — привязываем и заводим. Ничего не нашли — None,
    и выше отработает путь OZON или точечный запрос к Яндексу.
    """
    row = _pick_wb_yandex_order(cur, code)
    if row:
        return _stock_wb_yandex_order(cur, conn, row, code, actor_id, actor_name)

    found = _find_return_by_scan(cur, code)
    if not found:
        return None

    r_id, order_id, marketplace, posting, external_id, status, gw_id, product_name = found
    if not order_id and posting:
        order_id = find_order(cur, marketplace, posting)

    if posting or external_id:
        # Ту же вещь, что и при прямом скане заказа: не заводим вторую карточку.
        # Для связки Яндекса берём следующую ещё не принятую позицию, а не ту,
        # которую find_order вернул первой.
        row = _pick_wb_yandex_order(cur, posting or external_id, marketplace)
        if row:
            return _stock_wb_yandex_order(cur, conn, row, code, actor_id, actor_name)
    if order_id:
        cur.execute(
            "SELECT o.id, o.order_number, o.marketplace, o.material, o.width, o.height, "
            "       gw.id, gw.status, gw.storage_barcode "
            "FROM orders o "
            "LEFT JOIN goods_warehouse gw "
            "  ON gw.order_id = o.id "
            "  OR gw.id = o.fulfilled_from_stock_id "
            "  OR gw.reserved_order_id = o.id "
            "WHERE o.id = %s "
            "ORDER BY (gw.id IS NOT NULL AND COALESCE(gw.status, '') <> 'mp_return') DESC, "
            "         (gw.id = o.fulfilled_from_stock_id) DESC, o.id "
            "LIMIT 1",
            (int(order_id),),
        )
        row = cur.fetchone()
        if row:
            return _stock_wb_yandex_order(cur, conn, row, code, actor_id, actor_name)

    # Заказа в системе нет — заявка всё равно наша. Помечаем её привезённой
    # и заводим карточку возврата, как при разборе списка.
    if status not in ('new', 'approved') and gw_id:
        cur.execute(
            "SELECT storage_barcode FROM goods_warehouse WHERE id = %s",
            (gw_id,),
        )
        barcode_row = cur.fetchone()
        return {
            'found': 0,
            'barcode': code,
            'alreadyPicked': True,
            'accepted': {
                'material': None,
                'width': None,
                'height': None,
                'storageBarcode': barcode_row[0] if barcode_row else None,
                'productName': product_name,
            },
        }

    cur.execute(
        "UPDATE marketplace_returns SET status = 'picked_up', "
        "picked_up_at = COALESCE(picked_up_at, now()), picked_up_by = %s, "
        "return_barcode = COALESCE(return_barcode, NULLIF(%s, '')) "
        "WHERE id = %s AND status IN ('new', 'approved')",
        (int(actor_id) if actor_id else None, (code or '').strip(), r_id),
    )
    stock_picked_up_returns(cur, [r_id])
    cur.execute(
        "SELECT gw.storage_barcode, o.material, o.width, o.height, r.product_name "
        "FROM marketplace_returns r "
        "LEFT JOIN goods_warehouse gw ON gw.id = r.goods_warehouse_id "
        "LEFT JOIN orders o ON o.id = COALESCE(gw.order_id, r.order_id) "
        "WHERE r.id = %s",
        (r_id,),
    )
    stocked = cur.fetchone()
    storage_barcode, material, width, height, product_name = stocked if stocked else (None, None, None, None, product_name)
    if not storage_barcode:
        conn.rollback()
        return None
    log_action(
        cur, actor_id, actor_name, 'receive_return',
        f'Принял возврат {marketplace} по коду {code} ({storage_barcode})',
    )
    conn.commit()
    return {
        'found': 1,
        'barcode': code,
        'alreadyPicked': False,
        'accepted': {
            'material': material,
            'width': width,
            'height': height,
            'storageBarcode': storage_barcode,
            'productName': product_name,
        },
    }


def _looks_like_wb_or_yandex_label(code):
    """Код, который точно не наклейка OZON: стикер WB или номер Яндекса с префиксом.

    Наклейка возврата OZON начинается с ii и дальше идут цифры — её не
    относим к WB, иначе пакет OZON уйдёт мимо их API.
    """
    raw = (code or '').strip()
    if re.fullmatch(r'(?i)ii\d+', raw):
        return False
    if raw.startswith('*'):
        return True
    # Цифровой код стикера WB. Без этой проверки 11 цифр с ярлыка WB уходили
    # искать возврат в OZON — кладовщик получал «OZON не знает возврат».
    if _wb_sticker_number(raw) is not None:
        return True
    if raw.upper().startswith('YM-'):
        return True
    return bool(re.search(r'[A-Za-z]', raw)) and '-' not in raw


def _yandex_order_id_from_scan(code):
    """Голый номер заказа Яндекса, если скан похож на их стикер. Иначе None.

    Номер отправления OZON (39761729-0146-3) тоже начинается с цифр, но в нём
    три части. Такой код к Яндексу не относим.
    """
    raw = (code or '').strip()
    if re.match(r'^\d{6,}-\d{3,}-\d+', raw):
        return None
    bare = raw[3:] if raw.upper().startswith('YM-') else raw.lstrip('*')
    body = bare.split('-')[0]
    if re.fullmatch(r'\d{8,13}', body):
        return body
    return None


def _pull_yandex_returns_for_scan(cur, code):
    """Достаёт возврат Яндекса по номеру заказа, если в нашей базе его ещё нет.

    Список возвратов обновляется по расписанию. Пакет может приехать раньше.
    Спрашиваем площадку точечно и сохраняем заявку — дальше её примет тот же
    сканер, что и уже загруженные.
    """
    order_id = _yandex_order_id_from_scan(code)
    if not order_id:
        return False
    since = (datetime.now(timezone.utc) - timedelta(days=90)).strftime('%d-%m-%Y')
    saved = False
    for sid in list_return_shops(cur) or [None]:
        creds, enabled = get_credentials(cur, 'yandex_market', sid)
        if not enabled:
            continue
        api_key = (creds.get('apiKey') or '').strip()
        campaign_id = (creds.get('campaignId') or '').strip()
        if not api_key or not campaign_id:
            continue
        path = (
            f'/campaigns/{campaign_id}/returns'
            f'?fromDate={since}&limit=50&orderIds={order_id}'
        )
        status, data = http_json(YM_API_BASE + path, 'GET', {'Api-Key': api_key})
        if status != 200:
            continue
        rows = ((data or {}).get('result') or {}).get('returns') or []
        for it in rows:
            if str(it.get('orderId') or '') != order_id:
                continue
            items = it.get('items') or [{}]
            for idx, item in enumerate(items):
                ret_id = str(it.get('id') or '')
                if not ret_id:
                    continue
                decision = (item.get('decision') or {}) if isinstance(item, dict) else {}
                rec = {
                    'externalId': ret_id if len(items) == 1 else f'{ret_id}-{idx + 1}',
                    'postingNumber': str(it.get('orderId') or ''),
                    'offerId': str(item.get('shopSku') or item.get('offerId') or '') or None,
                    'sku': item.get('marketSku'),
                    'productName': item.get('offerName'),
                    'quantity': item.get('count') or 1,
                    'mpStatus': ym_status_label(it.get('shipmentStatus')),
                    'reason': decision.get('reasonType')
                    or item.get('reasonType')
                    or it.get('returnType'),
                    'createdAt': it.get('creationDate') or it.get('createdAt'),
                    'returnBarcode': str(it.get('orderId') or '') or None,
                }
                save_return(cur, 'Yandex', rec, sid)
                saved = True
        if saved:
            break
    return saved


def _fill_wb_sticker_numbers(cur):
    """Догружает с WB стикеры отправлений, у которых их ещё нет.

    Стикер появляется у заказа, только когда мы сами его печатали. Заказы,
    уехавшие без печати у нас (собранные вручную, отгруженные с полки), кода
    не имеют вовсе — и скан цифр с их ярлыка не найдёт ничего, сколько ни
    сравнивай. Спрашиваем стикеры пачкой у WB и дописываем.

    Берём только живые FBS-заказы: у отменённых спрашивать нечего. Возвращает
    число заполненных стикеров.
    """
    creds, enabled = get_credentials(cur, 'wildberries', None)
    api_key = (creds.get('apiKey') or '').strip()
    if not enabled or not api_key:
        return 0
    cur.execute(
        "SELECT wb_order_id FROM orders "
        "WHERE marketplace = 'WB' AND order_type = 'FBS' AND wb_order_id IS NOT NULL "
        "  AND (wb_sticker_barcode IS NULL OR wb_sticker_barcode = '') "
        "  AND COALESCE(sewing_status, '') <> 'Отменён' "
        "ORDER BY id DESC LIMIT 100"
    )
    ids = [int(r[0]) for r in cur.fetchall() if r[0]]
    if not ids:
        return 0
    status, data = http_json(
        'https://marketplace-api.wildberries.ru'
        '/api/v3/orders/stickers?type=png&width=58&height=40',
        'POST', {'Authorization': api_key}, {'orders': ids},
    )
    if status != 200 or not isinstance(data, dict):
        return 0
    filled = 0
    for st in (data.get('stickers') or []):
        barcode = (st.get('barcode') or '').strip()
        if not barcode:
            part_a = str(st.get('partA') or '').strip()
            part_b = str(st.get('partB') or '').strip()
            barcode = f'{part_a}{part_b}' if (part_a or part_b) else ''
        order_id = st.get('orderId')
        if not barcode or not order_id:
            continue
        cur.execute(
            "UPDATE orders SET wb_sticker_barcode = %s "
            "WHERE wb_order_id = %s AND (wb_sticker_barcode IS NULL OR wb_sticker_barcode = '')",
            (barcode[:60], int(order_id)),
        )
        filled += cur.rowcount or 0
    return filled


def _unknown_return_message(code):
    # Цифры с ярлыка WB мы теперь понимаем, но сам ярлык может быть не нашим:
    # такой стикер печатается только на наши FBS-отправления. Говорим об этом
    # прямо, иначе кладовщик перебирает коды и думает, что сканер сломан.
    if _wb_sticker_number(code) is not None:
        return (
            f'Стикер WB {code} не найден среди наших отправлений. Проверьте, что '
            f'сканируете ярлык Wildberries с нашего пакета, либо отсканируйте '
            f'наклейку возврата или номер отправления.'
        )
    return (
        f'Возврат {code} не найден. Для OZON — наклейка возврата или номер отправления, '
        f'для Wildberries — стикер со звёздочкой, номер задания, srid или цифры '
        f'под штрихкодом ярлыка, для Яндекс Маркета — номер заказа с клиентского стикера.'
    )


def stock_picked_up_returns(cur, ids=None, limit=None):
    """Заводит забранные с ПВЗ возвраты на склад в «подвешенном» состоянии.

    Кладовщик получил коробки на пункте выдачи — вещи физически у нас. До этой
    правки они нигде не появлялись: заявка меняла статус, а на складе было пусто.
    Забрали 25 штук, а в фильтре «Возврат с маркетплейса» — ноль, и кладовщик
    искал товар, которого по системе не существует.

    Заводим со статусом 'mp_return': вещь на складе, но её судьба не решена.
    Кладовщик потом сам определит — в цех на перепаковку или на полку хранения.
    Полку здесь НЕ назначаем: вещь ещё никуда не положили.

    Для FBO маркетплейс не сообщает, какую именно штуку из партии выкупили,
    поэтому под вещь заводится технический заказ-возврат: он не идёт на конвейер,
    а служит карточкой вещи (ткань, размер, номер) — иначе на складе появилась бы
    безымянная строка, которую невозможно опознать.

    Возвращает, сколько вещей завели.
    """
    # Явный список id — это прямое указание человека: он отсканировал наклейку или
    # отметил привезённые коробки. Такие вещи заводим без дополнительных проверок.
    # Проверка ниже нужна только для фонового добора «всего, что числится забранным».
    where_ids = ''
    confirmed_only = True
    if ids:
        where_ids = ' AND r.id IN (' + ','.join(str(int(i)) for i in ids) + ')'
        confirmed_only = False

    cur.execute(
        "SELECT r.id, r.order_id, r.marketplace, r.external_id, r.product_name, "
        "       mi.material, mi.width, mi.height, mi.name "
        "FROM marketplace_returns r "
        "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
        "WHERE r.status = 'picked_up' AND r.goods_warehouse_id IS NULL "
        # ВЕЩЬ ПОЯВЛЯЕТСЯ НА СКЛАДЕ, ТОЛЬКО КОГДА ЕЁ РЕАЛЬНО ЗАБРАЛИ С ПВЗ.
        #
        # Подтверждение — выдача по коду ПВЗ (giveout_id) или отметка человека:
        # кладовщик пикнул наклейку либо отметил привезённые коробки (picked_up_by).
        #
        # Больное место — отмена прямо на пункте выдачи: кладовщик привёз товар на
        # отгрузку, оператор ПВЗ его отсканировал, покупатель отменил заказ — и вещь
        # тут же числилась возвратом у нас на складе. Кладовщик искал её по полкам,
        # а она лежала в пункте выдачи. Теперь она дождётся выдачи по коду.
        #
        # Эта же проверка стоит в модуле кодов ПВЗ: заведение на склад идёт двумя
        # путями (по коду выдачи и фоновой загрузкой), и правило должно быть одно.
        + ("  AND (r.giveout_id IS NOT NULL OR r.picked_up_by IS NOT NULL) "
           if confirmed_only else "")
        + where_ids
        + (f' ORDER BY r.id LIMIT {int(limit)}' if limit else '')
    )
    rows = cur.fetchall()
    created = 0

    for r_id, order_id, marketplace, external_id, product_name, material, width, height, item_name in rows:
        # Ни один шаг ниже не должен ронять приёмку целиком: спотыкались на
        # одной вещи — на складе не появлялось НИ ОДНОЙ коробки, включая
        # нормальные, и кладовщик шёл принимать руками. Поэтому спорные случаи
        # проверяем заранее и молча пропускаем (см. ниже), а не ловим ошибку.
        if not order_id:
            product = (
                f'{material} {width}x{height}'
                if material and width and height
                else (product_name or item_name or 'Возврат')
            )
            order_number = f'RET-{marketplace}-{external_id}'
            cur.execute(
                "INSERT INTO orders (order_number, marketplace, order_type, status, "
                "sewing_status, product, quantity, source, material, width, height) "
                "VALUES (%s, %s, 'FBO', 'Выполнен', 'Готовые', %s, 1, 'return', %s, %s, %s) "
                "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                (order_number, marketplace, product, material, width, height),
            )
            created_order = cur.fetchone()
            if created_order:
                order_id = created_order[0]
            else:
                cur.execute("SELECT id FROM orders WHERE order_number = %s", (order_number,))
                found = cur.fetchone()
                order_id = found[0] if found else None
            if order_id:
                cur.execute(
                    "UPDATE marketplace_returns SET order_id = %s WHERE id = %s",
                    (order_id, r_id),
                )

        if not order_id:
            continue

        # Вещь этого заказа уже заводили на склад (например, она уезжала и вернулась) —
        # переиспользуем запись, чтобы не плодить дубли одной и той же вещи.
        #
        # НО: запись занимают только под СВОЙ возврат. В одном отправлении бывает две
        # одинаковые вещи (например, две «Молния 200x270»), и обе цепляются к одному
        # заказу. Раньше вторая вещь занимала карточку первой: штрихкод хранения
        # перезаписывался, на складе оставалась одна строка вместо двух, а сканер на
        # второй пакет отвечал «уже принята». Вещь физически есть, а в системе её нет.
        #
        # Поэтому карточку, за которой уже закреплён ДРУГОЙ возврат, не трогаем —
        # заводим новую со своим стикером.
        # Сначала вещь, которой закрыли заказ покупателя. Её карточка висит
        # на другом заказе, и поиск только по order_id её не находит.
        gw_row = find_goods_closing_order(cur, order_id)
        if not gw_row:
            cur.execute(
                "SELECT gw.id, gw.storage_barcode FROM goods_warehouse gw "
                "WHERE gw.order_id = %s AND NOT EXISTS ("
                "  SELECT 1 FROM marketplace_returns mr "
                "  WHERE mr.goods_warehouse_id = gw.id AND mr.id <> %s"
                ") LIMIT 1",
                (order_id, r_id),
            )
            gw_row = cur.fetchone()

        # СВОБОДНОЙ КАРТОЧКИ НЕТ — ЗАВОДИМ ВЕЩИ ОТДЕЛЬНУЮ.
        #
        # На складе действует правило: одна карточка на заказ. А в одном заказе
        # бывает две-три вернувшихся вещи (покупатель заказал три тюля и вернул
        # все три). Карточку занимает первая, для остальных места нет — и попытка
        # завести их падала с ошибкой. Из-за этого ВСЯ приёмка обрывалась: не
        # попадали во вкладку даже те возвраты, у которых с карточкой всё в порядке.
        # Так у нас зависли 42 забранные вещи.
        #
        # Поэтому для второй и следующих вещей заводим собственный заказ-возврат:
        # он не идёт на конвейер, а служит карточкой вещи (ткань, размер, номер).
        # Каждая вещь получает свой стикер хранения и видна на складе отдельно —
        # кладовщик разбирает ровно столько штук, сколько привёз.
        if not gw_row:
            own_number = f'RET-{marketplace}-{external_id}'
            cur.execute(
                "INSERT INTO orders (order_number, marketplace, order_type, status, "
                "sewing_status, product, quantity, source, material, width, height) "
                "VALUES (%s, %s, 'FBO', 'Выполнен', 'Готовые', %s, 1, 'return', %s, %s, %s) "
                "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                (own_number, marketplace,
                 (f'{material} {width}x{height}' if material and width and height
                  else (product_name or item_name or 'Возврат')),
                 material, width, height),
            )
            own = cur.fetchone()
            if not own:
                cur.execute("SELECT id FROM orders WHERE order_number = %s", (own_number,))
                own = cur.fetchone()
            if own and own[0] != order_id:
                order_id = own[0]
                cur.execute(
                    "UPDATE marketplace_returns SET order_id = %s WHERE id = %s",
                    (order_id, r_id),
                )
                # У собственного заказа-возврата карточка тоже может уже быть —
                # если эту вещь принимали раньше. Тогда переиспользуем её.
                cur.execute(
                    "SELECT gw.id, gw.storage_barcode FROM goods_warehouse gw "
                    "WHERE gw.order_id = %s AND NOT EXISTS ("
                    "  SELECT 1 FROM marketplace_returns mr "
                    "  WHERE mr.goods_warehouse_id = gw.id AND mr.id <> %s"
                    ") LIMIT 1",
                    (order_id, r_id),
                )
                gw_row = cur.fetchone()

        # ПРОВЕРЯЕМ ЗАРАНЕЕ, А НЕ ЛОВИМ ОШИБКУ.
        #
        # На складе действует правило: одна карточка на заказ. Если свободной
        # карточки нет, а место под заказ уже занято — вставка упадёт и оборвёт
        # ВСЮ приёмку: на склад не попадёт ни одна коробка, включая нормальные.
        # Кладовщик видел пустую вкладку «Разобрать возвраты» и шёл принимать
        # вещи руками. Поэтому такую вещь просто пропускаем: она дождётся, пока
        # освободится карточка, а остальные коробки встанут на склад сейчас.
        if not gw_row:
            cur.execute(
                "SELECT 1 FROM goods_warehouse WHERE order_id = %s LIMIT 1",
                (order_id,),
            )
            if cur.fetchone():
                continue

        if gw_row:
            gw_id = gw_row[0]
            cur.execute(
                "UPDATE goods_warehouse SET status = 'mp_return', shelf_id = NULL, "
                "shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
                "reserved_order_id = NULL, shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, "
                "receive_reason = 'return', received_at = now() WHERE id = %s",
                (gw_id,),
            )
        else:
            cur.execute(
                "INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason) "
                "VALUES (%s, 'mp_return', %s, 'return') RETURNING id",
                (order_id, next_storage_barcode(cur)),
            )
            gw_id = cur.fetchone()[0]

        cur.execute(
            "UPDATE marketplace_returns SET goods_warehouse_id = %s, received_at = now() "
            "WHERE id = %s",
            (gw_id, r_id),
        )
        # Возврат ложится в историю вещи: по ней кладовщик увидит, сколько раз
        # эта вещь уже ездила к покупателям и возвращалась.
        log_return_history(cur, gw_id, r_id, order_id)
        created += 1

    return created


def handler(event: dict, context) -> dict:
    """Возвраты с маркетплейсов: загрузка заявок по API и приём вещей на склад.

    Кладовщик больше не вбивает номера заказов руками — система сама тянет с OZON и WB
    список того, что покупатели вернули. Когда коробка физически доехала, кладовщик
    отмечает возврат принятым, и вещь встаёт на склад в очередь «Ждёт полку».

    GET  /                            - список возвратов (фильтры: status, marketplace)
    GET  /?report=1&days=90           - отчёт: возвраты по швеям (сколько отшила, сколько
                                        вернулось, процент) и топ причин возврата
    POST /  { action: 'sync' }                 - загрузить свежие заявки с OZON и WB
    POST /  { action: 'approve', id }          - админ одобряет заявку (вещь поедет к нам)
    POST /  { action: 'reject', id }           - админ отклоняет заявку
    POST /  { action: 'scan', code }           - кладовщик сканирует стикер возврата.
                                                 Код вида TR{id} — внутренний стикер из
                                                 пакета: показывает, кто шил эту штуку
    POST /  { action: 'process', id, outcome } - судьба вещи: utilized (утилизация),
                                                 repack (на перепаковку), stored (на полку)

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком возвратов или результатом действия
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        params = event.get('queryStringParameters') or {}

        # Запуск по расписанию. Планировщик умеет дёргать только простую ссылку без тела
        # запроса, поэтому загрузку возвратов разрешаем и через адрес:
        # ?action=sync&cronSecret=... Ключ обязателен — иначе загрузку запустит любой,
        # кто знает адрес.
        if params.get('action') == 'sync':
            cron_secret = os.environ.get('CRON_SECRET', '')
            if not cron_secret or params.get('cronSecret') != cron_secret:
                return _resp(403, {'error': 'Неверный ключ планировщика'})
            conn = psycopg2.connect(dsn)
            try:
                cur = conn.cursor()
                days = int(params.get('days') or 30)
                # ДОБИРАЕМ ЗАВИСШИЕ ВОЗВРАТЫ.
                #
                # Забранная с ПВЗ вещь попадает в «Разобрать возвраты» только после
                # того, как её заведут на склад. Заведение идёт порциями по 25, и
                # остаток ждал ПОВТОРНОГО нажатия кнопки. Кладовщик об этом не знал:
                # привёз коробки, отметил их — а во вкладке пусто. Так у нас скопилось
                # 42 возврата, которые числятся забранными, но нигде не показывались.
                #
                # Теперь каждый час загрузка сама подбирает всё, что осталось
                # незаведённым. Нажимать ничего не нужно.
                stock_picked_up_returns(cur, limit=25)
                conn.commit()

                # ОБХОДИМ ВСЕ КАБИНЕТЫ.
                #
                # У МЕГАТЮЛЬ и ДЮНЫ разные кабинеты на площадках, и заявки на
                # возврат приезжают из каждого своими. Раньше брался первый
                # попавшийся ключ, и возвраты второго кабинета в систему не
                # попадали вовсе — кладовщик про них не знал.
                shops_to_sync = list_return_shops(cur) or [None]
                ozon = {'created': 0, 'updated': 0, 'error': None}
                wb = {'created': 0, 'updated': 0, 'error': None}
                yandex = {'created': 0, 'updated': 0, 'error': None}
                for sid in shops_to_sync:
                    for res, part in (
                        (ozon, sync_ozon(cur, days, shop_id=sid)),
                        (wb, sync_wb(cur, days, shop_id=sid)),
                        (yandex, sync_yandex(cur, days, shop_id=sid)),
                    ):
                        res['created'] += part.get('created') or 0
                        res['updated'] += part.get('updated') or 0
                        # Ошибку показываем первую: кабинетов несколько, но
                        # человеку важен сам факт, что загрузка где-то не прошла.
                        if part.get('error') and not res.get('error'):
                            res['error'] = part['error']
                total_created = ozon['created'] + wb['created'] + yandex['created']
                # Пишем в журнал КАЖДЫЙ запуск, даже когда новых заявок нет: иначе
                # исправное задание в спокойный час выглядит на странице «Планировщик»
                # как отвалившееся.
                log_action(
                    cur, None, 'Планировщик', 'sync',
                    f'Загрузка возвратов: новых {total_created}',
                    {'ozon': ozon, 'wb': wb, 'yandex': yandex},
                )
                conn.commit()
                return _resp(200, {
                    'ozon': ozon,
                    'wildberries': wb,
                    'yandexMarket': yandex,
                    'created': total_created,
                })
            finally:
                conn.close()

        status_filter = (params.get('status') or '').strip()
        mp_filter = (params.get('marketplace') or '').strip()

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if params.get('report'):
                # Отчёт по возвратам в разрезе сотрудников: у кого чаще возвращают товар и
                # чем это заканчивается. Считаем только те возвраты, где известен исполнитель
                # (заказ найден в системе) — по остальным винить некого.
                days = int(params.get('days') or 90)
                cur.execute(
                    "SELECT COALESCE(su.full_name, 'Не определена') AS sewer, "
                    "COUNT(*) AS total, "
                    "COUNT(*) FILTER (WHERE r.outcome = 'utilized') AS utilized, "
                    "COUNT(*) FILTER (WHERE r.outcome = 'repack') AS repack, "
                    "COUNT(*) FILTER (WHERE r.outcome = 'stored') AS stored, "
                    "COALESCE(cu.full_name, '—') AS cutter "
                    "FROM marketplace_returns r "
                    "JOIN orders o ON o.id = r.order_id "
                    "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                    f"WHERE r.created_at >= now() - interval '{int(days)} days' "
                    "GROUP BY su.full_name, cu.full_name ORDER BY total DESC LIMIT 100"
                )
                by_sewer = [
                    {
                        'sewerName': r[0],
                        'total': r[1],
                        'utilized': r[2],
                        'repack': r[3],
                        'stored': r[4],
                        'cutterName': r[5],
                    }
                    for r in cur.fetchall()
                ]

                # Сколько всего вещей эти швеи отшили за тот же период — без этого числа
                # сравнивать нельзя: у кого больше объём, у того и возвратов больше.
                cur.execute(
                    "SELECT COALESCE(su.full_name, 'Не определена'), COUNT(*) "
                    "FROM orders o "
                    "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                    "WHERE o.sewing_status IN ('Стикеровка', 'Готовые') "
                    f"AND o.created_at >= now() - interval '{int(days)} days' "
                    "GROUP BY su.full_name"
                )
                made = {r[0]: r[1] for r in cur.fetchall()}
                for row in by_sewer:
                    row['madeTotal'] = made.get(row['sewerName'], 0)
                    row['returnRate'] = (
                        round(row['total'] * 100.0 / row['madeTotal'], 1)
                        if row['madeTotal']
                        else None
                    )

                # Топ причин возврата — что чаще всего не устраивает покупателей.
                cur.execute(
                    "SELECT COALESCE(NULLIF(TRIM(r.damage_note), ''), "
                    "        NULLIF(TRIM(r.return_reason), ''), 'Без причины') AS reason, "
                    "COUNT(*) FROM marketplace_returns r "
                    f"WHERE r.created_at >= now() - interval '{int(days)} days' "
                    "GROUP BY reason ORDER BY COUNT(*) DESC LIMIT 20"
                )
                reasons = [{'reason': r[0], 'count': r[1]} for r in cur.fetchall()]

                return _resp(200, {'bySewer': by_sewer, 'reasons': reasons, 'days': days})

            conditions = []
            if status_filter and status_filter != 'all':
                conditions.append(f"r.status = '{status_filter.replace(chr(39), chr(39) * 2)}'")
            if mp_filter and mp_filter != 'all':
                conditions.append(f"r.marketplace = '{mp_filter.replace(chr(39), chr(39) * 2)}'")
            where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ''

            cur.execute(
                "SELECT r.id, r.marketplace, r.external_id, r.posting_number, r.offer_id, "
                "r.product_name, r.quantity, r.mp_status, r.return_reason, r.status, "
                "r.mp_created_at, r.received_at, u.full_name, gw.storage_barcode, "
                "mi.material, mi.width, mi.height, o.order_number, r.outcome, r.damage_note, "
                "r.return_barcode, r.outcome_at, ou.full_name "
                "FROM marketplace_returns r "
                "LEFT JOIN users u ON u.id = r.received_by "
                "LEFT JOIN users ou ON ou.id = r.outcome_by "
                "LEFT JOIN goods_warehouse gw ON gw.id = r.goods_warehouse_id "
                "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                "LEFT JOIN orders o ON o.id = r.order_id "
                f"{where_sql} ORDER BY r.mp_created_at DESC NULLS LAST, r.id DESC LIMIT 500"
            )
            returns = [
                {
                    'id': r[0],
                    'marketplace': r[1],
                    'externalId': r[2],
                    'postingNumber': r[3],
                    'offerId': r[4],
                    'productName': r[5],
                    'quantity': r[6],
                    'mpStatus': r[7],
                    'returnReason': r[8],
                    'status': r[9],
                    'mpCreatedAt': r[10].isoformat() + 'Z' if r[10] else None,
                    'receivedAt': r[11].isoformat() + 'Z' if r[11] else None,
                    'receivedByName': r[12],
                    'storageBarcode': r[13],
                    'material': r[14],
                    'width': r[15],
                    'height': r[16],
                    'orderNumber': r[17],
                    'outcome': r[18],
                    'damageNote': r[19],
                    'returnBarcode': r[20],
                    'outcomeAt': r[21].isoformat() + 'Z' if r[21] else None,
                    'outcomeByName': r[22],
                }
                for r in cur.fetchall()
            ]

            cur.execute(
                "SELECT status, COUNT(*) FROM marketplace_returns GROUP BY status"
            )
            counts = {row[0]: row[1] for row in cur.fetchall()}

            # Разбивка обработанных возвратов по судьбе вещи — админ видит, сколько
            # товара утилизировано, сколько ушло на перепаковку, сколько легло на полку.
            cur.execute(
                "SELECT outcome, COUNT(*) FROM marketplace_returns "
                "WHERE outcome IS NOT NULL GROUP BY outcome"
            )
            outcomes = {row[0]: row[1] for row in cur.fetchall()}
            return _resp(200, {'returns': returns, 'counts': counts, 'outcomes': outcomes})
        finally:
            conn.close()

    if method == 'POST':
        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')
        actor_name = body_data.get('actorName')

        conn = psycopg2.connect(dsn)
        try:
            cur = conn.cursor()

            if action == 'fetch_by_barcode':
                # Точечный поиск возврата по наклейке на коробке.
                #
                # Возвратов у площадки тысячи, и выкачивать их все, чтобы найти одну
                # коробку, бессмысленно: OZON умеет искать по штрихкоду сам. Кладовщик
                # пикает наклейку — мы спрашиваем возврат у площадки и заводим его у себя.
                # Так работает приёмка любой коробки, даже если её ещё не было в списке.
                code = (body_data.get('barcode') or '').strip()
                if not code:
                    return _resp(400, {'error': 'Отсканируйте штрихкод возврата'})

                # ВОЗВРАТ WB ИЛИ ЯНДЕКСА — ПРИНИМАЕМ ПО СВОЕЙ БАЗЕ, БЕЗ API OZON.
                #
                # Раньше приёмка умела только OZON: код с пакета уходил в их API, и на
                # возврат WB или Яндекса кладовщик получал «OZON не знает возврат».
                # Такие вещи заводили руками или они вовсе оставались вне учёта.
                #
                # Что печатают на возвратах:
                #   WB     — стикер *DWto4dQG (со звёздочкой или без), номер
                #            сборочного задания и srid заявки;
                #   Яндекс — номер заказа: 61866041025, 61866041025-1 или YM-61866041025-1.
                # Ни того, ни другого в API возвратов OZON нет, поэтому сначала ищем
                # заказ у себя: нашли — принимаем сразу, не тревожа чужую площадку.
                accepted_other = _accept_return_by_order(cur, conn, code, actor_id, actor_name)
                if accepted_other is not None:
                    return _resp(200, accepted_other)

                # Цифры с ярлыка WB не нашлись: скорее всего, у этого заказа стикер
                # у нас не сохранён — его печатали не мы. Догружаем стикеры с WB и
                # пробуем ещё раз, вместо того чтобы отправлять кладовщика заводить
                # вещь руками.
                if _wb_sticker_number(code) is not None:
                    if _fill_wb_sticker_numbers(cur):
                        conn.commit()
                        accepted_other = _accept_return_by_order(
                            cur, conn, code, actor_id, actor_name,
                        )
                        if accepted_other is not None:
                            return _resp(200, accepted_other)

                # Заявки Яндекса обновляются по расписанию. Пакет может приехать
                # раньше: спрашиваем площадку по номеру заказа и принимаем сразу.
                # Стикер WB и наклейка OZON сюда не попадают — у них другой вид кода.
                if code.upper().startswith('YM-') or _yandex_order_id_from_scan(code):
                    if _pull_yandex_returns_for_scan(cur, code):
                        conn.commit()
                        accepted_other = _accept_return_by_order(
                            cur, conn, code, actor_id, actor_name,
                        )
                        if accepted_other is not None:
                            return _resp(200, accepted_other)

                # Стикер WB и номер YM- в кабинете OZON не живут. Не спрашиваем
                # чужую площадку и не пишем кладовщику «OZON не знает возврат».
                if _looks_like_wb_or_yandex_label(code):
                    return _resp(404, {'error': _unknown_return_message(code)})

                # КОД С КОРОБКИ СПРАШИВАЕМ У ВСЕХ КАБИНЕТОВ.
                #
                # Кладовщик привозит коробки обеих компаний вперемешку и не знает,
                # чей пакет у него в руках, — на наклейке этого нет. Поэтому идём
                # по кабинетам: первый, который узнал код, и есть владелец вещи.
                #
                # Заодно запоминаем его магазин: возврат должен лечь на склад под
                # тем кабинетом, из которого приехал.
                scan_shops = list_return_shops(cur) or [None]
                rows = []
                creds, scan_err = {}, None
                shop_id = None
                # Кабинеты с ключами запоминаем списком: по номеру отправления ниже
                # придётся спросить их ВСЕ заново. Раньше там брались creds от
                # поиска по штрихкоду, а он по клиентскому стикеру ничего не
                # находит — и в запрос уходили пустые ключи.
                scan_creds = []
                for sid in scan_shops:
                    c_try, en_try = get_credentials(cur, 'ozon', sid)
                    if not en_try:
                        continue
                    scan_creds.append((sid, c_try))
                    st, data = http_json(
                        OZON_API_BASE + '/v1/returns/list', 'POST',
                        {'Client-Id': (c_try.get('clientId') or '').strip(),
                         'Api-Key': (c_try.get('apiKey') or '').strip()},
                        {'filter': {'barcode': code}, 'limit': 10, 'last_id': 0},
                    )
                    if st != 200:
                        scan_err = scan_err or error_text(data)
                        continue
                    found_rows = (data or {}).get('returns') or []
                    if found_rows:
                        rows, creds, shop_id = found_rows, c_try, sid
                        break
                if not scan_creds:
                    return _resp(404, {'error': _unknown_return_message(code)})
                # Что считать попаданием.
                #
                # Раньше требовали, чтобы логистический штрихкод возврата в точности
                # совпал с отсканированным. На практике на коробке печатают ДРУГОЙ код
                # (например, 801842665330000), а внутри у возврата свой — ii18460940928.
                # OZON по коду с коробки ищет правильно и отдаёт нужный возврат, но наша
                # проверка его отбрасывала: кладовщик пикал наклейку и получал «OZON не
                # знает возврат», хотя площадка его только что нашла.
                #
                # Теперь: есть точное совпадение — берём его. Нет, но площадка вернула
                # ровно один возврат — берём его тоже: искали по конкретному коду, и
                # ответ однозначен. Несколько результатов без точного совпадения не
                # принимаем — угадывать, какую из коробок принёс кладовщик, нельзя.
                exact = [
                    r for r in rows
                    if ((r.get('logistic') or {}).get('barcode') or '') == code
                ]
                if not exact and len(rows) == 1:
                    exact = rows

                # ОДИН СКАН — ОДНА ВЕЩЬ.
                #
                # Логистический штрихкод возврата у OZON НЕ УНИКАЛЕН на вещь: это код
                # грузоместа (мешка) с пункта выдачи, и под ним лежит несколько разных
                # отправлений. Площадка честно отдаёт по такому коду всю пачку.
                #
                # Раньше мы принимали её целиком: кладовщик пикал ОДИН пакет, а на склад
                # вставало пять вещей с пятью разными номерами отправлений — все с одним
                # штрихкодом ii16526378745 и одной секундой приёмки. Человек видел «5 шт»
                # там, где держал в руках одну, и объяснить это не мог.
                #
                # Берём первый возврат, который у нас ещё НЕ принят. Второй скан того же
                # мешка примет вторую вещь, третий — третью: сколько пакетов кладовщик
                # реально распаковал, столько вещей и появится на складе.
                #
                # Ровно это правило уже работает ниже, в ветке поиска по номеру
                # отправления, — здесь оно просто отсутствовало.
                if len(exact) > 1:
                    ext_all = [str(r.get('id')) for r in exact if r.get('id')]
                    picked_set = set()
                    if ext_all:
                        ids_q = ','.join(
                            "'" + i.replace("'", "''") + "'" for i in ext_all
                        )
                        cur.execute(
                            "SELECT external_id FROM marketplace_returns "
                            f"WHERE marketplace = 'OZON' AND external_id IN ({ids_q}) "
                            "AND status NOT IN ('new', 'approved')"
                        )
                        picked_set = {str(r[0]) for r in cur.fetchall()}
                    free = [r for r in exact if str(r.get('id')) not in picked_set]
                    # Все вещи этого грузоместа уже приняты — честно скажем об этом
                    # ниже (alreadyPicked), вместо того чтобы «принимать» их заново.
                    exact = [free[0]] if free else [exact[0]]

                # Отдали с КЛИЕНТСКИМ стикером, без возвратного.
                #
                # Бывает, что возврат уже оформлен, а отдельной наклейки возврата на
                # пакете нет — на нём остался стикер покупателя с номером отправления
                # (вида 39761729-0146-3). Поиск по штрихкоду такой код не находит:
                # это не логистический штрихкод возврата. Кладовщик держит вещь в
                # руках, возврат в системе есть, а принять её нечем.
                #
                # Поэтому вторая попытка: ищем возврат по номеру отправления.
                if not exact and re.match(r'^\d{6,}-\d{3,}-\d+$', code):
                    # Обходим ВСЕ кабинеты: поиск по штрихкоду по клиентскому
                    # стикеру ничего не нашёл, поэтому чей это магазин — ещё
                    # неизвестно. Раньше запрос уходил с creds от неудачного
                    # поиска (пустыми) и возвращал 401 — кладовщик видел
                    # «возврат не найден» на вещи, которая у OZON есть.
                    by_posting = []
                    for sid2, c2 in scan_creds:
                        st2, data2 = http_json(
                            OZON_API_BASE + '/v1/returns/list', 'POST',
                            {'Client-Id': (c2.get('clientId') or '').strip(),
                             'Api-Key': (c2.get('apiKey') or '').strip()},
                            {'filter': {'posting_number': code}, 'limit': 50, 'last_id': 0},
                        )
                        if st2 != 200:
                            scan_err = scan_err or error_text(data2)
                            continue
                        hits = [
                            r for r in ((data2 or {}).get('returns') or [])
                            if (r.get('posting_number') or '') == code
                        ]
                        if hits:
                            by_posting, creds, shop_id = hits, c2, sid2
                            break
                    # В отправлении бывает НЕСКОЛЬКО вещей, и на каждой свой пакет,
                    # но клиентский стикер у них один и тот же.
                    #
                    # Раньше мы принимали по такому скану сразу все вещи отправления.
                    # Кладовщик сканировал первый пакет — система молча зачисляла и
                    # второй, которого он ещё даже не достал. Сканировал второй —
                    # получал «уже принята», хотя эту вещь никуда не клали. Особенно
                    # обидно с одинаковыми размерами: две штуки «Шифон 400x270» с
                    # разными стикерами выглядят одинаково, а на складе они разные.
                    #
                    # Теперь один скан = одна вещь: берём первый возврат отправления,
                    # который у нас ещё не принят. Второй скан того же стикера примет
                    # вторую вещь, третий — третью.
                    if by_posting:
                        ext_all = [str(r.get('id')) for r in by_posting if r.get('id')]
                        picked_set = set()
                        if ext_all:
                            ids_q = ','.join(
                                "'" + i.replace("'", "''") + "'" for i in ext_all
                            )
                            cur.execute(
                                "SELECT external_id FROM marketplace_returns "
                                f"WHERE marketplace = 'OZON' AND external_id IN ({ids_q}) "
                                "AND status NOT IN ('new', 'approved')"
                            )
                            picked_set = {str(r[0]) for r in cur.fetchall()}

                        free = [
                            r for r in by_posting
                            if str(r.get('id')) not in picked_set
                        ]
                        # Все вещи этого отправления уже приняты — честно скажем об
                        # этом, вместо того чтобы «принимать» их заново.
                        exact = [free[0]] if free else [by_posting[0]]

                if not exact:
                    if body_data.get('debug'):
                        return _resp(404, {
                            'error': f'OZON не знает возврат {code}',
                            'debugCount': len(rows),
                            'debugSample': [
                                {
                                    'id': r.get('id'),
                                    'posting': r.get('posting_number'),
                                    'barcode': (r.get('logistic') or {}).get('barcode'),
                                }
                                for r in rows[:5]
                            ],
                        })
                    # Кабинет ответил ошибкой (неверные ключи, лимит, 401) — это не
                    # «возврата нет», и молчать об этом нельзя: иначе кладовщик
                    # ищет вещь, которая у площадки есть, а мы просто не дозвонились.
                    if scan_err:
                        return _resp(502, {'error': f'OZON: {scan_err}'})
                    return _resp(404, {'error': _unknown_return_message(code)})

                saved = 0
                for it in exact:
                    product = it.get('product') or {}
                    rec = {
                        'externalId': str(it.get('id') or ''),
                        'postingNumber': it.get('posting_number'),
                        'offerId': product.get('offer_id'),
                        'sku': product.get('sku'),
                        'productName': product.get('name'),
                        'quantity': product.get('quantity') or 1,
                        'mpStatus': (it.get('visual') or {}).get('status', {}).get('display_name'),
                        'reason': it.get('return_reason_name'),
                        'createdAt': (it.get('logistic') or {}).get('return_date'),
                        'returnBarcode': (it.get('logistic') or {}).get('barcode'),
                    }
                    if rec['externalId']:
                        # Магазин того кабинета, который узнал код: возврат должен
                        # лечь на склад под своим кабинетом, а не «без магазина».
                        save_return(cur, 'OZON', rec, shop_id)
                        saved += 1
                conn.commit()

                # Отсканировал — значит привёз. Сразу принимаем вещь и заводим её на склад,
                # чтобы кладовщик не искал её потом галочками в списке: он держит коробку
                # в руках, подтверждать это второй раз бессмысленно.
                accepted = None
                already = False
                if body_data.get('accept'):
                    ext_ids = [str(it.get('id')) for it in exact if it.get('id')]
                    if ext_ids:
                        ids_sql = ','.join("'" + i.replace("'", "''") + "'" for i in ext_ids)
                        # Эту вещь уже принимали? Тогда повторный скан ничего не меняет —
                        # кладовщик просто пикнул ту же наклейку дважды. Сообщаем об этом
                        # и НЕ трогаем данные: иначе счётчик принятого врал бы.
                        cur.execute(
                            "SELECT id FROM marketplace_returns "
                            f"WHERE marketplace = 'OZON' AND external_id IN ({ids_sql}) "
                            "AND status NOT IN ('new', 'approved') LIMIT 1"
                        )
                        already = cur.fetchone() is not None

                        cur.execute(
                            "UPDATE marketplace_returns SET status = 'picked_up', "
                            "picked_up_at = COALESCE(picked_up_at, now()), picked_up_by = %s "
                            f"WHERE marketplace = 'OZON' AND external_id IN ({ids_sql}) "
                            "AND status IN ('new', 'approved') RETURNING id",
                            (int(actor_id) if actor_id else None,),
                        )
                        marked = [r[0] for r in cur.fetchall()]
                        conn.commit()
                        # ВАЖНО: заводим на склад ТОЛЬКО отсканированную вещь. Раньше при
                        # повторном скане список принятых оказывался пустым, и функция
                        # принималась заводить все ждущие возвраты подряд — на складе
                        # появлялись вещи, которых кладовщик не привозил.
                        if marked:
                            stock_picked_up_returns(cur, marked)
                            conn.commit()
                        # Что показать кладовщику: ткань, размер и стикер хранения —
                        # по ним он сразу видит, ту ли вещь принял.
                        cur.execute(
                            "SELECT o.material, o.width, o.height, gw.storage_barcode, r.product_name "
                            "FROM marketplace_returns r "
                            "LEFT JOIN goods_warehouse gw ON gw.id = r.goods_warehouse_id "
                            "LEFT JOIN orders o ON o.id = gw.order_id "
                            f"WHERE r.marketplace = 'OZON' AND r.external_id IN ({ids_sql}) LIMIT 1"
                        )
                        info = cur.fetchone()
                        if info:
                            accepted = {
                                'material': info[0],
                                'width': info[1],
                                'height': info[2],
                                'storageBarcode': info[3],
                                'productName': info[4],
                            }

                return _resp(200, {
                    'found': saved,
                    'barcode': code,
                    'accepted': accepted,
                    # Вещь уже была принята раньше — фронт покажет это отдельно и не
                    # прибавит её к счётчику принятого.
                    'alreadyPicked': already,
                })

            if action == 'sync_status':
                # Догрузка возвратов с конкретным статусом. Нужна сканеру приёмки: коробку
                # уже забрали, OZON перевёл возврат в «едет к нам», и в списке «ждёт в ПВЗ»
                # его больше нет. Отдельным запросом, чтобы обычная загрузка оставалась
                # быстрой и укладывалась во время работы функции.
                st_name = (body_data.get('visualStatus') or 'MovingToOzon').strip()
                res = sync_ozon(cur, 30, (st_name,))
                conn.commit()
                return _resp(200, res)

            if action == 'sync':
                days = int(body_data.get('days') or 30)

                # Фоновая загрузка (страница открылась сама) не должна дёргать
                # маркетплейсы на каждом заходе: если возвраты обновляли меньше
                # 10 минут назад, отвечаем сразу и не тратим лимиты площадок.
                if body_data.get('auto'):
                    cur.execute(
                        "SELECT max(synced_at) FROM marketplace_returns_sync WHERE id = 1"
                    )
                    row = cur.fetchone()
                    if row and row[0] and (datetime.now(timezone.utc) - row[0]).total_seconds() < 600:
                        return _resp(200, {
                            'ozon': {'created': 0, 'updated': 0, 'error': None},
                            'wildberries': {'created': 0, 'updated': 0, 'error': None},
                            'yandexMarket': {'created': 0, 'updated': 0, 'error': None},
                            'created': 0,
                            'skipped': True,
                        })

                # ДОБИРАЕМ ЗАВИСШИЕ ВОЗВРАТЫ (см. пояснение в ветке планировщика).
                #
                # Вещь попадает в «Разобрать возвраты» только после заведения на
                # склад, а оно шло порциями по 25 и ждало повторного нажатия кнопки.
                # Кладовщик об этом не знал: привёз коробки, отметил — а вкладка
                # пустая. Теперь остаток подбирается сам, при каждой загрузке.
                stock_picked_up_returns(cur, limit=25)
                conn.commit()

                # ОБХОДИМ ВСЕ КАБИНЕТЫ.
                #
                # У МЕГАТЮЛЬ и ДЮНЫ разные кабинеты на площадках, и заявки на
                # возврат приезжают из каждого своими. Раньше брался первый
                # попавшийся ключ, и возвраты второго кабинета в систему не
                # попадали вовсе — кладовщик про них не знал.
                shops_to_sync = list_return_shops(cur) or [None]
                ozon = {'created': 0, 'updated': 0, 'error': None}
                wb = {'created': 0, 'updated': 0, 'error': None}
                yandex = {'created': 0, 'updated': 0, 'error': None}
                for sid in shops_to_sync:
                    for res, part in (
                        (ozon, sync_ozon(cur, days, shop_id=sid)),
                        (wb, sync_wb(cur, days, shop_id=sid)),
                        (yandex, sync_yandex(cur, days, shop_id=sid)),
                    ):
                        res['created'] += part.get('created') or 0
                        res['updated'] += part.get('updated') or 0
                        # Ошибку показываем первую: кабинетов несколько, но
                        # человеку важен сам факт, что загрузка где-то не прошла.
                        if part.get('error') and not res.get('error'):
                            res['error'] = part['error']
                total_created = ozon['created'] + wb['created'] + yandex['created']
                if total_created:
                    log_action(
                        cur, actor_id, actor_name, 'sync',
                        f'Загрузка возвратов: новых {total_created}',
                        {'ozon': ozon, 'wb': wb, 'yandex': yandex},
                    )
                # Отметка времени: по ней фоновая загрузка понимает, что данные свежие.
                cur.execute(
                    "INSERT INTO marketplace_returns_sync (id, synced_at) VALUES (1, now()) "
                    "ON CONFLICT (id) DO UPDATE SET synced_at = now()"
                )
                conn.commit()
                return _resp(200, {
                    'ozon': ozon,
                    'wildberries': wb,
                    'yandexMarket': yandex,
                    'created': total_created,
                })

            if action == 'approve':
                # Решение по заявке принимает ТОЛЬКО админ: одобрил — вещь поедет к нам,
                # и она появится у кладовщика в списке ожидаемых.
                if (body_data.get('actorRole') or '') != 'admin':
                    return _resp(403, {'error': 'Решение по заявке принимает администратор'})
                return_id = body_data.get('id')
                if not return_id:
                    return _resp(400, {'error': 'Укажите id возврата'})
                cur.execute(
                    "UPDATE marketplace_returns SET status = 'approved', approved_at = now(), "
                    "approved_by = %s WHERE id = %s AND status = 'new' RETURNING external_id",
                    (int(actor_id) if actor_id else None, int(return_id)),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(409, {'error': 'Заявка уже обработана'})
                log_action(cur, actor_id, actor_name, 'approve', f'Заявка на возврат {row[0]} одобрена')
                conn.commit()
                return _resp(200, {'success': True})

            if action == 'reject':
                if (body_data.get('actorRole') or '') != 'admin':
                    return _resp(403, {'error': 'Решение по заявке принимает администратор'})
                return_id = body_data.get('id')
                if not return_id:
                    return _resp(400, {'error': 'Укажите id возврата'})
                cur.execute(
                    "UPDATE marketplace_returns SET status = 'rejected' WHERE id = %s",
                    (int(return_id),),
                )
                log_action(cur, actor_id, actor_name, 'reject', f'Заявка на возврат #{return_id} отклонена')
                conn.commit()
                return _resp(200, {'success': True})

            if action == 'scan':
                # Кладовщик сканирует стикер возврата с коробки. Ищем заявку по штрихкоду
                # возврата, номеру отправления или внешнему номеру — что напечатано, то и
                # сработает. Показываем только одобренные админом.
                code = (body_data.get('code') or '').strip()
                if not code:
                    return _resp(400, {'error': 'Отсканируйте стикер возврата'})

                # Внутренний стикер прослеживаемости TR{id заказа}: его кладёт в пакет
                # упаковщик. По нему сразу видно, КТО шил именно эту штуку — на FBO
                # маркетплейс такой информации не даёт вовсе.
                if code.upper().startswith('TR') and code[2:].isdigit():
                    cur.execute(
                        "SELECT o.id, o.order_number, o.marketplace, o.order_type, o.material, "
                        "o.width, o.height, su.full_name, cu.full_name, pu.full_name, o.cut_at "
                        "FROM orders o "
                        "LEFT JOIN users su ON su.id = COALESCE(o.sewer_user_id, o.assigned_user_id) "
                        "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                        "LEFT JOIN users pu ON pu.id = o.packer_user_id "
                        "WHERE o.id = %s",
                        (int(code[2:]),),
                    )
                    o = cur.fetchone()
                    if not o:
                        return _resp(404, {'error': f'Заказ по коду {code} не найден'})

                    # Возврат по этому заказу мог быть уже загружен с маркетплейса — тогда
                    # продолжаем работу с ним. Если нет, заводим заявку сами: вещь физически
                    # перед кладовщиком, значит возврат состоялся.
                    cur.execute(
                        "SELECT id, status FROM marketplace_returns WHERE order_id = %s "
                        "AND status <> 'processed' ORDER BY id DESC LIMIT 1",
                        (o[0],),
                    )
                    existing = cur.fetchone()
                    if existing:
                        ret_id = existing[0]
                        # Не откатываем статус назад: если возврат уже отмечен
                        # забранным с ПВЗ, он таким и остаётся.
                        cur.execute(
                            "UPDATE marketplace_returns SET "
                            "status = CASE WHEN status = 'new' THEN 'approved' ELSE status END, "
                            "return_barcode = COALESCE(return_barcode, %s) WHERE id = %s",
                            (code, ret_id),
                        )
                    else:
                        cur.execute(
                            "INSERT INTO marketplace_returns (marketplace, external_id, "
                            "posting_number, order_id, product_name, quantity, status, "
                            "return_barcode, approved_at, mp_created_at) "
                            "VALUES (%s, %s, %s, %s, %s, 1, 'approved', %s, now(), now()) "
                            "RETURNING id",
                            (
                                o[2] or 'OZON',
                                f'TRACE-{o[0]}',
                                o[1],
                                o[0],
                                f'{o[4]} {o[5]}x{o[6]}' if o[4] and o[5] else o[1],
                                code,
                            ),
                        )
                        ret_id = cur.fetchone()[0]
                    conn.commit()
                    return _resp(200, {'return': {
                        'id': ret_id,
                        'marketplace': o[2],
                        'externalId': f'TRACE-{o[0]}',
                        'postingNumber': o[1],
                        'productName': f'{o[4]} {o[5]}x{o[6]}' if o[4] and o[5] else o[1],
                        'returnReason': None,
                        'status': 'approved',
                        'material': o[4],
                        'width': o[5],
                        'height': o[6],
                        # Кто именно делал эту вещь — главная польза внутреннего стикера.
                        'sewerName': o[7],
                        'cutterName': o[8],
                        'packerName': o[9],
                        'orderNumber': o[1],
                    }})

                # Берём заявку, с которой ЕЩЁ МОЖНО работать.
                #
                # Один и тот же штрихкод часто висит на нескольких заявках: в
                # отправлении бывает несколько вещей, и площадка выдаёт им общий
                # код. Раньше здесь стоял LIMIT 1 без порядка, и база отдавала
                # любую — обычно самую старую, уже обработанную. Кладовщик пикал
                # стикер, получал «этот возврат уже обработан», и вещь не
                # принималась, хотя рядом по тому же коду ждали три рабочие заявки.
                #
                # Поэтому сначала ставим необработанные (new/approved/picked_up),
                # и лишь если рабочих не осталось — отдаём последнюю, чтобы
                # человек увидел понятную причину отказа.
                #
                # Цифры с ярлыка WB (58490661473) в самой заявке не лежат: там srid
                # и номер задания. Поэтому дополнительно идём через заказ — у него
                # номер стикера посчитан из буквенного кода в wb_sticker_number.
                sticker_num = _wb_sticker_number(code)
                cur.execute(
                    "SELECT r.id, r.marketplace, r.external_id, r.posting_number, r.product_name, "
                    "r.return_reason, r.status, r.outcome, mi.material, mi.width, mi.height "
                    "FROM marketplace_returns r "
                    "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                    "WHERE r.return_barcode = %s OR r.posting_number = %s OR r.external_id = %s "
                    "   OR (%s IS NOT NULL AND r.order_id IN ("
                    "        SELECT id FROM orders WHERE wb_sticker_number = %s)) "
                    "ORDER BY CASE WHEN r.status IN ('new', 'approved', 'picked_up') THEN 0 ELSE 1 END, "
                    "         CASE WHEN r.goods_warehouse_id IS NULL THEN 0 ELSE 1 END, r.id "
                    "LIMIT 1",
                    (code, code, code, sticker_num, sticker_num),
                )
                row = cur.fetchone()
                if not row and sticker_num is not None and _fill_wb_sticker_numbers(cur):
                    # Стикер этого отправления мы не печатали — цифры сравнивать было
                    # не с чем. Догрузили коды с WB и ищем ещё раз.
                    conn.commit()
                    cur.execute(
                        "SELECT r.id, r.marketplace, r.external_id, r.posting_number, "
                        "r.product_name, r.return_reason, r.status, r.outcome, "
                        "mi.material, mi.width, mi.height "
                        "FROM marketplace_returns r "
                        "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                        "WHERE r.order_id IN (SELECT id FROM orders WHERE wb_sticker_number = %s) "
                        "ORDER BY CASE WHEN r.status IN ('new', 'approved', 'picked_up') "
                        "              THEN 0 ELSE 1 END, "
                        "         CASE WHEN r.goods_warehouse_id IS NULL THEN 0 ELSE 1 END, r.id "
                        "LIMIT 1",
                        (sticker_num,),
                    )
                    row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': _unknown_return_message(code)})
                # Заявку в статусе 'new' раньше отвергали: «не одобрена администратором».
                # На практике одобрение никто не проставляет — вещи забирают с ПВЗ по коду
                # выдачи, и все заявки остаются новыми. Кладовщик стоял с коробкой в руках
                # и упирался в отказ, а на складе возвраты не появлялись вовсе.
                #
                # Отсканированный стикер — это и есть подтверждение: вещь физически здесь.
                # Помечаем её забранной и работаем дальше.
                if row[6] == 'new':
                    cur.execute(
                        # picked_up_by обязателен: по нему видно, что вещь забрал
                        # ЖИВОЙ человек, а не просто числится забранной по данным
                        # площадки. Заведение на склад опирается на эту отметку —
                        # без неё отсканированная кладовщиком коробка не попала бы
                        # в «Разобрать возвраты».
                        "UPDATE marketplace_returns SET status = 'picked_up', "
                        "picked_up_at = COALESCE(picked_up_at, now()), "
                        "picked_up_by = COALESCE(picked_up_by, %s) WHERE id = %s",
                        (int(actor_id) if actor_id else None, row[0],),
                    )
                    row = list(row)
                    row[6] = 'picked_up'
                if row[6] == 'rejected':
                    return _resp(409, {'error': 'Эта заявка отклонена'})
                if row[6] == 'processed':
                    return _resp(409, {'error': 'Этот возврат уже обработан'})
                # Статус picked_up (забран с ПВЗ, но не разобран) — рабочий:
                # именно такие вещи кладовщик и осматривает на складе.
                # Запоминаем штрихкод, которым реально сканируют — в следующий раз найдётся сразу.
                cur.execute(
                    "UPDATE marketplace_returns SET return_barcode = COALESCE(return_barcode, %s) "
                    "WHERE id = %s",
                    (code, row[0]),
                )
                conn.commit()
                return _resp(200, {'return': {
                    'id': row[0],
                    'marketplace': row[1],
                    'externalId': row[2],
                    'postingNumber': row[3],
                    'productName': row[4],
                    'returnReason': row[5],
                    'status': row[6],
                    'material': row[8],
                    'width': row[9],
                    'height': row[10],
                }})

            if action == 'undo_pickup':
                # Откат ошибочной приёмки: вещи вернутся в пункт выдачи, складские
                # записи по ним удаляются. Нужно, когда забрали лишнее — например,
                # приняли всё, что числилось в ПВЗ, а привезли только часть.
                ids = body_data.get('ids') or []
                if ids:
                    ids_csv = ','.join(str(int(i)) for i in ids)
                    where = f"r.id IN ({ids_csv})"
                else:
                    where = "(r.picked_up_at + interval '3 hours')::date = (now() + interval '3 hours')::date"

                # Какие складские записи создала приёмка: возврат с маркетплейса,
                # ещё не разобранный и не положенный на полку. Разобранные вещи и всё
                # остальное на складе не трогаем — там уже работал человек.
                cur.execute(
                    "SELECT gw.id, gw.order_id FROM goods_warehouse gw "
                    "JOIN marketplace_returns r ON r.goods_warehouse_id = gw.id "
                    f"WHERE r.status = 'picked_up' AND {where} "
                    "AND gw.status = 'mp_return' AND gw.shelf_id IS NULL"
                )
                gw_rows = cur.fetchall()
                gw_ids = [r[0] for r in gw_rows]
                freed_orders = [r[1] for r in gw_rows if r[1]]

                # ПОРЯДОК ВАЖЕН: сначала снимаем ссылки на складские записи, только потом
                # их удаляем. Иначе база не даёт удалить строку, на которую кто-то ссылается.
                cur.execute(
                    "UPDATE marketplace_returns r SET status = 'new', picked_up_at = NULL, "
                    "picked_up_by = NULL, goods_warehouse_id = NULL, received_at = NULL "
                    f"WHERE r.status = 'picked_up' AND {where} RETURNING r.id"
                )
                reverted = len(cur.fetchall())

                if gw_ids:
                    gw_csv = ','.join(str(int(i)) for i in gw_ids)
                    # Вещь, попавшая в поставку, — уже не «свежая приёмка»: её не трогаем.
                    cur.execute(
                        f"DELETE FROM goods_warehouse WHERE id IN ({gw_csv}) "
                        "AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                        "                WHERE msi.goods_warehouse_id = goods_warehouse.id)"
                    )

                # Технические заказы-карточки (source='return') НЕ удаляем. На них могут
                # ссылаться другие записи — например, начисления, — и удаление обрывается
                # на полпути, оставляя данные в раскоряку. Пустая карточка безвредна:
                # на конвейер она не идёт, а при повторной приёмке того же возврата
                # переиспользуется по номеру.
                _ = freed_orders
                log_action(
                    cur, actor_id, actor_name, 'undo_pickup',
                    f'Отменил приёмку возвратов с ПВЗ: {reverted}',
                )
                conn.commit()
                return _resp(200, {'success': True, 'reverted': reverted})

            if action == 'pickup':
                # Кладовщик привёз коробки с пункта выдачи и отмечает, что забрал их.
                #
                # Нужно, потому что автоматическая отметка через OZON работает, только пока
                # выдача открыта: сотрудник ПВЗ отсканировал коробки — мы это увидели. Если
                # выдачу уже закрыли (а обычно так и есть — вещи привезли, а в систему зашли
                # позже), забрать их в систему нечем, и склад остаётся пустым.
                #
                # Принимаем ТОЛЬКО отмеченные заявки (ids). Приём «всего, что числится
                # в пункте выдачи», убран намеренно: в ПВЗ возвраты капают весь день,
                # и к моменту, когда кладовщик вернулся и зашёл в систему, там уже лежат
                # вещи, которых он не забирал. Одно нажатие — и на складе повисали
                # 52 позиции вместо реальных 25, то есть недостача на ровном месте.
                #
                # Отмечает человек: он один знает, сколько коробок реально привёз.
                # Вещи заводятся на склад в «подвешенном» состоянии — решение (в цех
                # или на полку) принимается потом, на разборе.
                ids = body_data.get('ids') or []
                if not ids:
                    return _resp(400, {'error': 'Отметьте возвраты, которые реально привезли'})
                ids_csv = ','.join(str(int(i)) for i in ids)
                cur.execute(
                    "UPDATE marketplace_returns SET status = 'picked_up', "
                    "picked_up_at = now(), picked_up_by = %s "
                    f"WHERE id IN ({ids_csv}) AND status IN ('new', 'approved') RETURNING id",
                    (int(actor_id) if actor_id else None,),
                )
                marked = [r[0] for r in cur.fetchall()]
                conn.commit()
                # Заводим на склад порциями: на полусотне вещей функция не укладывалась
                # в отведённое время и обрывалась, оставляя часть коробок неразобранными.
                # Каждая порция сохраняется сразу, поэтому повторное нажатие продолжит
                # с того места, где остановились, — ничего не потеряется и не задвоится.
                stocked = stock_picked_up_returns(cur, limit=25)
                conn.commit()
                # Сколько коробок ещё не заведено — показываем кладовщику, чтобы он знал,
                # что нужно нажать ещё раз, а не гадал, всё ли принято.
                cur.execute(
                    "SELECT count(*) FROM marketplace_returns "
                    "WHERE status = 'picked_up' AND goods_warehouse_id IS NULL"
                )
                remaining = cur.fetchone()[0]
                if marked:
                    log_action(
                        cur, actor_id, actor_name, 'pickup',
                        f'Забрал возвраты с пункта выдачи: {len(marked)}',
                    )
                conn.commit()
                return _resp(200, {
                    'success': True,
                    'picked': len(marked),
                    'stocked': stocked,
                    'remaining': remaining,
                })

            if action == 'process':
                # Кладовщик осмотрел вещь и решил её судьбу:
                #   utilized — повреждена, утилизируем (попадёт в отчёт админу);
                #   repack   — годная, но помята упаковка: едет к упаковщику на перепаковку;
                #   stored   — сразу на полку хранения со стикером.
                return_id = body_data.get('id')
                outcome = (body_data.get('outcome') or '').strip()
                if not return_id or outcome not in ('utilized', 'repack', 'stored'):
                    return _resp(400, {'error': 'Укажите возврат и решение по нему'})

                cur.execute(
                    "SELECT status, order_id, product_name, marketplace, external_id "
                    "FROM marketplace_returns WHERE id = %s",
                    (int(return_id),),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Возврат не найден'})
                if row[0] == 'processed':
                    return _resp(409, {'error': 'Этот возврат уже обработан'})
                # Разбирать можно и одобренный, и уже забранный с пункта выдачи.
                if row[0] not in ('approved', 'picked_up'):
                    return _resp(409, {'error': 'Возврат не одобрен администратором'})

                order_id = row[1]
                gw_id = None
                storage_barcode = None

                # Возврат приехал по заказу, которого нет в системе (типичный случай FBO:
                # маркетплейс не сообщает, какую именно штуку из партии выкупили). Чтобы вещь
                # всё равно встала на склад и её можно было переупаковать, заводим
                # технический заказ-возврат: он не идёт на конвейер, а служит карточкой вещи.
                if outcome != 'utilized' and not order_id:
                    cur.execute(
                        "SELECT mi.material, mi.width, mi.height, mi.name, r.marketplace, "
                        "r.external_id, r.product_name FROM marketplace_returns r "
                        "LEFT JOIN marketplace_items mi ON mi.id = r.marketplace_item_id "
                        "WHERE r.id = %s",
                        (int(return_id),),
                    )
                    info = cur.fetchone()
                    material, width, height = info[0], info[1], info[2]
                    product = (
                        f'{material} {width}x{height}'
                        if material and width and height
                        else (info[6] or info[3] or 'Возврат')
                    )
                    cur.execute(
                        "INSERT INTO orders (order_number, marketplace, order_type, status, "
                        "sewing_status, product, quantity, source, material, width, height) "
                        "VALUES (%s, %s, 'FBO', 'Выполнен', 'Готовые', %s, 1, 'return', %s, %s, %s) "
                        "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                        (
                            f'RET-{info[4]}-{info[5]}',
                            info[4],
                            product,
                            material,
                            width,
                            height,
                        ),
                    )
                    created_order = cur.fetchone()
                    if created_order:
                        order_id = created_order[0]
                    else:
                        cur.execute(
                            "SELECT id FROM orders WHERE order_number = %s",
                            (f'RET-{info[4]}-{info[5]}',),
                        )
                        order_id = cur.fetchone()[0]
                    cur.execute(
                        "UPDATE marketplace_returns SET order_id = %s WHERE id = %s",
                        (order_id, int(return_id)),
                    )

                # Полку можно указать сразу при осмотре: если вещь целая (клиент отказался
                # при вручении, коробку даже не вскрывали), гонять её через отдельный шаг
                # «разложить по полкам» незачем — кладовщик уже держит её в руках.
                shelf_id = body_data.get('shelfId')
                place_now = outcome == 'stored' and shelf_id not in (None, '')
                if place_now:
                    cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
                    shelf_row = cur.fetchone()
                    if not shelf_row:
                        return _resp(404, {'error': 'Полка не найдена'})

                if outcome != 'utilized':
                    # Вещь остаётся в обороте — заводим её на складе. Повреждённая
                    # (utilized) на склад не попадает вовсе: она физически уничтожена.
                    # Полку указали сразу — вещь сразу считается проверенной и лежащей
                    # на месте, отдельная укладка не нужна.
                    if place_now:
                        gw_status = 'in_stock'
                    else:
                        # Вещь приехала назад с маркетплейса и физически лежит у кладовщика,
                        # но полку ей ещё не назначили. Отдельный статус нужен, чтобы такие
                        # вещи не терялись среди обычного «На разборе» из цеха: у возврата
                        # другой маршрут и другая ответственность.
                        gw_status = 'repacking' if outcome == 'repack' else 'mp_return'
                    if order_id:
                        # Берём карточку этого заказа, но только если она не занята
                        # ДРУГИМ возвратом: две одинаковые вещи одного отправления
                        # должны лежать на складе двумя строками со своими стикерами.
                        gw_row = find_goods_closing_order(cur, order_id)
                        if not gw_row:
                            cur.execute(
                                "SELECT gw.id, gw.storage_barcode FROM goods_warehouse gw "
                                "WHERE gw.order_id = %s AND NOT EXISTS ("
                                "  SELECT 1 FROM marketplace_returns mr "
                                "  WHERE mr.goods_warehouse_id = gw.id AND mr.id <> %s"
                                ") LIMIT 1",
                                (int(order_id), int(return_id)),
                            )
                            gw_row = cur.fetchone()
                        if gw_row:
                            gw_id, storage_barcode = gw_row
                            cur.execute(
                                "UPDATE goods_warehouse SET status = %s, shelf_id = %s, "
                                "shipped_at = NULL, lost_reason = NULL, lost_at = NULL, "
                                "reserved_order_id = NULL, shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, "
                                "receive_reason = 'return', received_at = now(), "
                                "repack_return_id = %s WHERE id = %s",
                                (
                                    gw_status,
                                    int(shelf_id) if place_now else None,
                                    int(return_id) if outcome == 'repack' else None,
                                    gw_id,
                                ),
                            )
                        else:
                            storage_barcode = next_storage_barcode(cur)
                            cur.execute(
                                "INSERT INTO goods_warehouse (order_id, status, storage_barcode, "
                                "receive_reason, repack_return_id, shelf_id) "
                                "VALUES (%s, %s, %s, 'return', %s, %s) "
                                "RETURNING id",
                                (
                                    int(order_id),
                                    gw_status,
                                    storage_barcode,
                                    int(return_id) if outcome == 'repack' else None,
                                    int(shelf_id) if place_now else None,
                                ),
                            )
                            gw_id = cur.fetchone()[0]

                # Возврат ложится в историю вещи. Исход (на полку / перепаковка /
                # утилизация) дописываем ниже — он уже известен на этом шаге.
                if gw_id:
                    log_return_history(cur, gw_id, int(return_id), order_id,
                                       actor_id, body_data.get('actorName'))
                    cur.execute(
                        "UPDATE goods_return_history SET outcome = %s "
                        "WHERE goods_warehouse_id = %s AND marketplace_return_id = %s",
                        (outcome, int(gw_id), int(return_id)),
                    )

                cur.execute(
                    "UPDATE marketplace_returns SET status = 'processed', outcome = %s, "
                    "outcome_at = now(), outcome_by = %s, damage_note = %s, received_at = now(), "
                    "received_by = %s, goods_warehouse_id = %s WHERE id = %s",
                    (
                        outcome,
                        int(actor_id) if actor_id else None,
                        (body_data.get('damageNote') or '').strip() or None,
                        int(actor_id) if actor_id else None,
                        gw_id,
                        int(return_id),
                    ),
                )
                shelf_name = shelf_row[0] if place_now else None
                outcome_labels = {
                    'utilized': 'утилизирован',
                    'repack': 'отправлен на перепаковку',
                    'stored': f'положен на полку {shelf_name}' if place_now else 'принят на склад',
                }
                log_action(
                    cur, actor_id, actor_name, 'process',
                    f'Возврат {row[3]} {row[4]} ({row[2] or "товар"}) — {outcome_labels[outcome]}',
                    {
                        'outcome': outcome,
                        'damageNote': body_data.get('damageNote'),
                        'shelf': shelf_name,
                    },
                )

                # Подбор заказов под эту вещь запустится сам при следующем обращении
                # к складу — своей копии этой логики здесь держать не будем.

                conn.commit()
                return _resp(200, {
                    'success': True,
                    'outcome': outcome,
                    'storageBarcode': storage_barcode,
                    'shelfName': shelf_name,
                    'placedOnShelf': place_now,
                    'needsManualOrder': order_id is None and outcome != 'utilized',
                })

            return _resp(400, {'error': 'Неизвестное действие'})
        finally:
            conn.close()

    return _resp(405, {'error': 'Method not allowed'})