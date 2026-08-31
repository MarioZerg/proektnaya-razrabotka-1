import json
import os
import urllib.error
import urllib.request

import psycopg2

OZON_API = 'https://api-seller.ozon.ru'
WB_PRICES_API = 'https://discounts-prices-api.wildberries.ru'
YM_API = 'https://api.partner.market.yandex.ru'

# Насколько цене вообще позволено измениться за один раз.
#
# Предохранитель от беды: ошибка в расчёте или опечатка в шаге не должна
# обвалить витрину. Всё, что просит изменить цену больше чем на четверть,
# отклоняем и показываем владельцу — пусть решает вручную в кабинете.
MAX_CHANGE_PERCENT = 25.0

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Content-Type': 'application/json',
}


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def _http(url, method='GET', headers=None, payload=None, timeout=25):
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = r.read().decode('utf-8')
            return r.status, (json.loads(d) if d else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')[:400]
    except Exception as e:
        return 0, str(e)


def _credentials(cur, code):
    cur.execute(
        "SELECT is_enabled, credentials FROM marketplace_integrations "
        "WHERE marketplace_code = %s ORDER BY is_enabled DESC, (credentials::text <> '{}') DESC, shop_id LIMIT 1",
        (code,),
    )
    row = cur.fetchone()
    if not row:
        return {}, False
    creds = row[1] if isinstance(row[1], dict) else json.loads(row[1] or '{}')
    return creds, bool(row[0])


def _is_admin(cur, actor_id):
    """Цены меняет только владелец: это деньги и витрина."""
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


def _prepare(cur, marketplace, items, seller_price=False):
    """Сверяет присланные цены с базой и отсеивает опасные.

    Экран мог показывать данные, посчитанные несколько минут назад, а цена за
    это время изменилась. Поэтому текущую цену берём из базы, а не верим
    присланной, и заодно проверяем размер шага.

    seller_price=True — прислана НАША цена («Ваша цена» в кабинете), её и
    отправляем как есть. Так работает робот: он двигает именно эту цену.
    По умолчанию False — прислана цена покупателя (со скидкой площадки), её
    нужно перевести в нашу. Перепутать эти два случая дорого: 24 августа
    цену продавца приняли за покупательскую, пересчитали второй раз, и
    вместо 0.5% магазин подорожал на 5-18%.
    """
    ids = [int(i['itemId']) for i in items if i.get('itemId')]
    if not ids:
        return [], []

    id_list = ','.join(str(i) for i in ids)
    cur.execute(
        "SELECT mi.id, mi.sku, mi.ozon_sku, mi.wb_nm_id, mi.name, "
        "  mp.price, mp.price_before_discount, "
        "  mp.price_with_marketplace_discount "
        "FROM marketplace_items mi "
        "LEFT JOIN marketplace_prices mp ON mp.marketplace_item_id = mi.id "
        f"  AND mp.marketplace_code = '{marketplace}' "
        f"WHERE mi.id IN ({id_list})"
    )
    known = {
        r[0]: {'sku': r[1], 'ozonSku': r[2], 'wbNmId': r[3], 'name': r[4],
               # price — НАША цена, её и отправляем на площадку.
               'price': float(r[5]) if r[5] is not None else None,
               'oldPrice': float(r[6]) if r[6] is not None else None,
               # shownPrice — что видит покупатель после скидки площадки.
               # От неё считаются советы, поэтому нужна для пересчёта шага.
               'shownPrice': float(r[7]) if r[7] is not None else None}
        for r in cur.fetchall()
    }

    ready, skipped = [], []
    for i in items:
        item_id = int(i.get('itemId') or 0)
        new_price = round(float(i.get('newPrice') or 0), 2)
        info = known.get(item_id)

        if not info:
            skipped.append({'itemId': item_id, 'reason': 'Товар не найден'})
            continue
        if new_price <= 0:
            skipped.append({'itemId': item_id, 'name': info['name'],
                            'reason': 'Цена должна быть больше нуля'})
            continue
        current = info['price']
        if not current:
            skipped.append({'itemId': item_id, 'name': info['name'],
                            'reason': 'Нет текущей цены — сверить не с чем'})
            continue

        # ВАЖНО: советы считаются от цены, которую платит покупатель (с учётом
        # СПП — скидки площадки за её счёт), а площадка принимает НАШУ цену до
        # этой скидки. Отправить сюда цену с СПП нельзя: команда «поднять на 2%»
        # на деле снизила бы витрину на размер СПП. Поэтому переводим шаг в свою
        # цену: берём процент изменения и применяем его к цене продавца.
        shown = info['shownPrice'] or current
        if not seller_price and shown > 0 and abs(shown - current) > 0.01:
            ratio = new_price / shown
            new_price = round(current * ratio, 2)

        change = abs(new_price - current) / current * 100
        if change > MAX_CHANGE_PERCENT:
            skipped.append({
                'itemId': item_id, 'name': info['name'],
                'reason': f'Цена меняется на {change:.0f}% — слишком резко, '
                          f'поменяйте вручную в кабинете',
            })
            continue

        # ЗАЧЁРКНУТУЮ ЦЕНУ ДВИГАЕМ ТЕМ ЖЕ ПРОЦЕНТОМ.
        #
        # В карточке две цены: «Ваша цена» и «Цена до скидки» — та, что
        # показана зачёркнутой. Если поднимать только первую, выгода для
        # покупателя молча тает, а через несколько шагов зачёркнутая цена
        # окажется ниже основной, и площадка отклонит товар.
        new_old_price = None
        if info.get('oldPrice'):
            new_old_price = round(info['oldPrice'] * (new_price / current), 2)

        ready.append({**info, 'itemId': item_id, 'newPrice': new_price,
                      'oldMyPrice': current, 'shown': shown,
                      'newOldPrice': new_old_price})
    return ready, skipped


def _push_ozon(creds, ready):
    """Отправляет цены на OZON.

    old_price — зачёркнутая цена «до скидки». Площадка требует, чтобы она была
    заметно выше новой, иначе отклоняет товар. Поэтому если своей старой цены
    нет или она ниже новой, ставим её сами с наценкой.
    """
    headers = {'Client-Id': (creds.get('clientId') or '').strip(),
               'Api-Key': (creds.get('apiKey') or '').strip()}
    prices = []
    for r in ready:
        if not r.get('sku'):
            continue
        # Берём поднятую зачёркнутую цену, а не прежнюю: она растёт вместе
        # с основной, поэтому скидка для покупателя остаётся той же.
        old = r.get('newOldPrice') or r.get('oldPrice') or 0
        if old <= r['newPrice'] * 1.05:
            old = round(r['newPrice'] * 1.2, 2)
        prices.append({
            'offer_id': str(r['sku']),
            'price': str(int(round(r['newPrice']))),
            'old_price': str(int(round(old))),
            # Не трогаем участие в акциях: этим управляют отдельно.
            'auto_action_enabled': 'UNKNOWN',
        })
    if not prices:
        return [], [{'reason': 'Нет товаров с артикулом OZON'}]

    st, data = _http(f'{OZON_API}/v1/product/import/prices', 'POST', headers,
                     {'prices': prices}, timeout=30)
    if st != 200 or not isinstance(data, dict):
        return [], [{'reason': f'OZON отклонил запрос (код {st}): {str(data)[:200]}'}]

    ok, failed = [], []
    by_offer = {str(r['sku']): r for r in ready if r.get('sku')}
    for res in (data.get('result') or []):
        offer = str(res.get('offer_id') or '')
        r = by_offer.get(offer)
        if res.get('updated'):
            if r:
                ok.append(r)
        else:
            errs = '; '.join(
                e.get('message') or e.get('code') or '?' for e in (res.get('errors') or [])
            )
            failed.append({'itemId': r['itemId'] if r else None,
                           'name': r['name'] if r else offer,
                           'reason': errs or 'Площадка не приняла цену'})
    return ok, failed


def _push_wb(creds, ready):
    """Отправляет цены на Wildberries.

    WB принимает цены по своему номеру товара (nmID) и работает через очередь:
    ответ 200 означает «задание принято», а не «цена уже на витрине».
    """
    headers = {'Authorization': (creds.get('apiKey') or '').strip()}
    data_rows = []
    skipped = []
    for r in ready:
        if not r.get('wbNmId'):
            skipped.append({'itemId': r['itemId'], 'name': r['name'],
                            'reason': 'Нет номера товара WB — обновите рекламу '
                                      'на экране тарифов, там он подтянется'})
            continue
        data_rows.append({'nmID': int(r['wbNmId']),
                          'price': int(round(r['newPrice']))})
    if not data_rows:
        return [], skipped or [{'reason': 'Нет товаров с номером WB'}]

    st, data = _http(f'{WB_PRICES_API}/api/v2/upload/task', 'POST', headers,
                     {'data': data_rows}, timeout=30)
    if st not in (200, 208) or not isinstance(data, dict):
        return [], skipped + [
            {'reason': f'WB отклонил запрос (код {st}): {str(data)[:200]}'}]

    ok = [r for r in ready if r.get('wbNmId')]
    return ok, skipped


def _push_ym(cur, creds, ready):
    """Отправляет цены на Яндекс Маркет — по кабинету продавца."""
    headers = {'Api-Key': (creds.get('apiKey') or '').strip()}
    cur.execute("SELECT value FROM system_settings WHERE key = 'ym_business_id'")
    row = cur.fetchone()
    business_id = (row[0] if row else '') or ''
    if not business_id:
        return [], [{'reason': 'Не задан кабинет Яндекса (business_id)'}]

    offers = []
    for r in ready:
        if not r.get('sku'):
            continue
        offers.append({
            'offerId': str(r['sku']),
            'price': {'value': int(round(r['newPrice'])), 'currencyId': 'RUR'},
        })
    if not offers:
        return [], [{'reason': 'Нет товаров с артикулом'}]

    st, data = _http(
        f'{YM_API}/businesses/{business_id}/offer-prices/updates', 'POST',
        headers, {'offers': offers}, timeout=30)
    if st != 200:
        return [], [{'reason': f'Яндекс отклонил запрос (код {st}): {str(data)[:200]}'}]
    return ready, []


def handler(event: dict, context) -> dict:
    """Отправляет новые цены НА площадку — по кнопке владельца.

    Раньше система только советовала: цены приходилось менять руками в кабинете
    каждой площадки, а потом ещё и обновлять у себя. Теперь она делает это
    сама, но никогда не по своей инициативе — только когда владелец отметил
    позиции и нажал кнопку.

    Три предохранителя, потому что запись идёт прямо на витрину:
      · цену сверяем с базой, а не верим той, что показывал экран;
      · шаг больше 25% не пропускаем совсем;
      · каждую отправку пишем в журнал — видно, кто и что поменял.

    POST /  { action: 'push', marketplace, items: [{itemId, newPrice}], actorId }
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    if method != 'POST':
        return _resp(405, {'error': 'Только POST'})

    body_data = json.loads(event.get('body') or '{}')
    if body_data.get('action') != 'push':
        return _resp(400, {'error': 'Неизвестное действие'})

    marketplace = body_data.get('marketplace')
    if marketplace not in ('ozon', 'wildberries', 'yandex_market'):
        return _resp(400, {'error': 'Неизвестный маркетплейс'})

    items = body_data.get('items') or []
    if not items:
        return _resp(400, {'error': 'Не выбрано ни одной позиции'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = False
    try:
        cur = conn.cursor()
        actor_id = body_data.get('actorId')
        if not _is_admin(cur, actor_id):
            return _resp(403, {'error': 'Менять цены может только владелец'})

        creds, enabled = _credentials(cur, marketplace)
        if not enabled:
            return _resp(400, {'error': 'Интеграция с площадкой не подключена'})

        # Робот присылает нашу цену продавца и просит не пересчитывать её.
        ready, skipped = _prepare(cur, marketplace, items,
                                  seller_price=bool(body_data.get('sellerPrice')))
        if not ready:
            return _resp(200, {'ok': True, 'pushed': 0, 'skipped': skipped,
                               'failed': []})

        if marketplace == 'ozon':
            pushed, failed = _push_ozon(creds, ready)
        elif marketplace == 'wildberries':
            pushed, failed = _push_wb(creds, ready)
        else:
            pushed, failed = _push_ym(cur, creds, ready)

        # Сохраняем новую цену у себя: иначе экран продолжит показывать старую
        # и предложит поднять её ещё раз.
        cur.execute("SELECT full_name FROM users WHERE id = %s", (int(actor_id),))
        who = cur.fetchone()
        who_name = who[0] if who else 'Владелец'

        # ЗАПИСЫВАЕМ ВСЮ ПАЧКУ ДВУМЯ ЗАПРОСАМИ, А НЕ ПО ОДНОМУ НА КАРТОЧКУ.
        #
        # Раньше на каждый товар уходило два обращения к базе: на шестидесяти
        # карточках — сто двадцать запросов, и всё это внутри пяти секунд,
        # отведённых функции, уже ПОСЛЕ похода на площадку. Функция не
        # укладывалась и обрывалась: цены на витрине менялись, а у нас не
        # сохранялись — счётчик замирал, и продвижение вставало после второго
        # круга. Один запрос на всю пачку снимает эту нагрузку целиком.
        if pushed:
            values = ','.join(
                cur.mogrify('(%s,%s,%s)',
                            (int(r['itemId']), r['newPrice'],
                             r.get('newOldPrice'))).decode()
                for r in pushed
            )
            cur.execute(
                f"UPDATE marketplace_prices mp SET price = v.new_price, "
                f"  price_before_discount = coalesce(v.new_old, "
                f"                                   mp.price_before_discount), "
                f"  source = 'api', updated_at = now() "
                f"FROM (VALUES {values}) AS v(item_id, new_price, new_old) "
                f"WHERE mp.marketplace_item_id = v.item_id "
                f"  AND mp.marketplace_code = %s",
                (marketplace,),
            )

            # Записываем как уже применённое: пауза до следующего шага по
            # этому товару начинает идти с этого момента.
            rec_values = ','.join(
                cur.mogrify(
                    "(%s,%s,'push',%s,%s,%s,'applied',now(),%s)",
                    (marketplace, int(r['itemId']), r['oldMyPrice'],
                     r['newPrice'], 'Цена отправлена на площадку из системы',
                     int(actor_id))).decode()
                for r in pushed
            )
            cur.execute(
                "INSERT INTO price_recommendations (marketplace_code, "
                "  marketplace_item_id, action, current_price, suggested_price, "
                f"  reason, status, decided_at, decided_by) VALUES {rec_values}"
            )

        if pushed:
            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, "
                "entity_type, description) VALUES ('integration', %s, %s, "
                "'price_push', 'price', %s)",
                (int(actor_id), who_name,
                 f'Отправлено цен на {marketplace}: {len(pushed)}'),
            )
        conn.commit()

        return _resp(200, {
            'ok': True,
            'pushed': len(pushed),
            'skipped': skipped,
            'failed': failed,
            'items': [{'itemId': r['itemId'], 'name': r['name'],
                       'oldPrice': r['oldMyPrice'], 'newPrice': r['newPrice']}
                      for r in pushed],
        })
    finally:
        conn.close()