import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Content-Type': 'application/json',
}

UNIT_ECONOMICS_URL = 'https://functions.poehali.dev/4ebd72ad-8ca4-456c-840c-d2db30ce04cd'

MARKETPLACES = ('ozon', 'wildberries', 'yandex_market')
MP_TITLES = {'ozon': 'OZON', 'wildberries': 'Wildberries',
             'yandex_market': 'Яндекс Маркет'}

OZON_API = 'https://api-seller.ozon.ru'
WB_PROMO_API = 'https://dp-calendar-api.wildberries.ru'


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def _http(url, method='GET', headers=None, payload=None, timeout=15):
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read().decode('utf-8')
            return r.status, (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')[:300]
    except Exception as e:
        return 0, str(e)


def _is_admin(cur, actor_id):
    if not actor_id:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
    row = cur.fetchone()
    return bool(row and row[0] == 'admin')


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


def _strategy(cur):
    """Правила ценообразования: целевой коридор маржи и безопасный шаг."""
    cur.execute(
        "SELECT target_margin_min, target_margin_max, step_percent, step_days, "
        "min_spp_percent, max_ad_percent, max_actions_per_item, "
        "max_items_in_actions_percent FROM pricing_strategy ORDER BY id LIMIT 1"
    )
    r = cur.fetchone()
    if not r:
        return {'marginMin': 10.0, 'marginMax': 15.0, 'stepPercent': 2.0,
                'stepDays': 7, 'minSpp': 0.0, 'maxAdPercent': 12.0,
                'maxActionsPerItem': 1, 'maxItemsInActionsPercent': 60.0}
    return {'marginMin': float(r[0] or 10), 'marginMax': float(r[1] or 15),
            'stepPercent': float(r[2] or 2), 'stepDays': int(r[3] or 7),
            'minSpp': float(r[4] or 0),
            # Потолок доли рекламы: выше него продвижение съедает прибыль.
            'maxAdPercent': float(r[5] or 12),
            'maxActionsPerItem': int(r[6] or 1),
            'maxItemsInActionsPercent': float(r[7] or 60)}


def _economics(marketplace, scheme='FBS'):
    """Расчёт юнит-экономики по площадке — оттуда берём маржу по каждому размеру."""
    st, data = _http(
        f'{UNIT_ECONOMICS_URL}?marketplace={marketplace}&scheme={scheme}',
        'GET', timeout=25,
    )
    if st != 200 or not isinstance(data, dict):
        return None
    return data


def _capture_history(cur, marketplace):
    """Снимок цены и СПП по каждому товару — один на сутки.

    Без истории нельзя понять, почему упал СПП: из-за нашего подъёма цены или
    площадка сама передумала. Пишем раз в сутки — этого хватает, чтобы видеть
    тренд, и таблица не растёт бесконтрольно.

    Берём прямо из таблицы цен, ОДНИМ запросом. Раньше снимок считался через
    полную юнит-экономику, и функция не укладывалась в свои пять секунд: ради
    двух чисел пересчитывались все размеры со всеми тарифами. Маржу сюда не
    пишем — она есть в юнит-экономике, а для решения о цене важны цена и СПП.
    """
    cur.execute(
        "INSERT INTO price_history (marketplace_item_id, marketplace_code, "
        "  price, buyer_price, spp_percent) "
        "SELECT marketplace_item_id, marketplace_code, price, "
        "  price_with_marketplace_discount, "
        "  CASE WHEN price > 0 AND price_with_marketplace_discount IS NOT NULL "
        "       THEN round((1 - price_with_marketplace_discount / price) * 100, 2) "
        "  END "
        "FROM marketplace_prices WHERE marketplace_code = %s AND price > 0 "
        "ON CONFLICT (marketplace_item_id, marketplace_code, captured_on) "
        "DO UPDATE SET price = EXCLUDED.price, "
        "  buyer_price = EXCLUDED.buyer_price, "
        "  spp_percent = EXCLUDED.spp_percent, captured_at = now()",
        (marketplace,),
    )
    return cur.rowcount


def _last_change(cur, marketplace):
    """Когда по каждому товару последний раз применяли рекомендацию.

    Нужно, чтобы не двигать цену чаще, чем раз в неделю: площадке нужно время
    пересчитать СПП и позицию в выдаче, а нам — увидеть результат шага.
    """
    cur.execute(
        "SELECT marketplace_item_id, MAX(decided_at) FROM price_recommendations "
        "WHERE marketplace_code = %s AND status = 'applied' "
        "GROUP BY marketplace_item_id",
        (marketplace,),
    )
    return {r[0]: r[1] for r in cur.fetchall()}


def _spp_trend(cur, marketplace):
    """Как менялся СПП по товару: {itemId: (сейчас, неделю назад)}.

    Если после подъёма цены СПП просел — площадка перестала давать скидку, и
    шаг надо откатывать. Это главный сигнал, что мы перешли границу.
    """
    cur.execute(
        "SELECT DISTINCT ON (marketplace_item_id) marketplace_item_id, spp_percent "
        "FROM price_history WHERE marketplace_code = %s AND spp_percent IS NOT NULL "
        "ORDER BY marketplace_item_id, captured_at DESC",
        (marketplace,),
    )
    now = {r[0]: float(r[1]) for r in cur.fetchall()}

    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).date()
    cur.execute(
        "SELECT DISTINCT ON (marketplace_item_id) marketplace_item_id, spp_percent "
        "FROM price_history WHERE marketplace_code = %s AND spp_percent IS NOT NULL "
        "  AND captured_on <= %s ORDER BY marketplace_item_id, captured_at DESC",
        (marketplace, week_ago),
    )
    before = {r[0]: float(r[1]) for r in cur.fetchall()}
    return now, before


def _build_recommendations(cur, marketplace, data, strategy):
    """Что делать с ценой каждого размера, чтобы маржа пришла в коридор.

    Логика простая и объяснимая — владелец должен понимать каждое предложение:

      · маржа ниже коридора  → поднимаем цену на один шаг (по умолчанию 2%);
      · маржа выше коридора  → опускаем: цена завышена, продажи падают зря;
      · маржа в коридоре     → не трогаем, всё хорошо.

    Три предохранителя, без которых советы навредят:

      1. ЧАСТОТА. Один товар двигаем не чаще раза в неделю: площадке нужно
         время пересчитать СПП, а нам — увидеть, чем кончился прошлый шаг.
      2. СПП. Если после прошлого шага скидка площадки просела больше чем на
         пять пунктов — предлагаем откатиться, а не давить дальше.
      3. РАЗМЕР ШАГА. Никаких «поднять на 30% и сразу в коридор»: резкий скачок
         выбрасывает товар из СПП и из выдачи. Только мелкими шагами.
    """
    now_spp, before_spp = _spp_trend(cur, marketplace)
    last = _last_change(cur, marketplace)
    step = strategy['stepPercent'] / 100.0
    cooldown = timedelta(days=strategy['stepDays'])
    now = datetime.now(timezone.utc)

    out = []
    for row in data.get('rows', []):
        for h in (row.get('heights') or []):
            unit = h.get('unit')
            item_id = h.get('itemId')
            if not unit or not item_id:
                continue

            margin = unit.get('margin') or 0
            price = unit.get('price') or 0
            if price <= 0:
                continue

            # Доля рекламы в цене этого размера. Без неё непонятно, почему
            # товар в минусе: дорого шьём или бустинг съел всю прибыль. Первое
            # лечится ценой, второе — отключением рекламы, и это разные решения.
            ad_pct = unit.get('promoPercent') or 0
            # Сколько осталось бы без рекламы: видно, тянет товар сам себя или нет.
            margin_wo_ad = round(margin + ad_pct, 1)

            # Цена в советах — та, что платит покупатель (после скидки площадки
            # за её счёт). Своя цена продавца выше, и именно её принимает
            # площадка. Показываем обе, чтобы не путать при отправке.
            card_price = h.get('cardPrice') or price

            title = f"{row.get('material')} · {row.get('width')}×{h.get('height')}"

            # 1. Недавно двигали — ждём, пока площадка пересчитает СПП.
            was = last.get(item_id)
            if was and (now - was.replace(tzinfo=timezone.utc)) < cooldown:
                days_left = cooldown - (now - was.replace(tzinfo=timezone.utc))
                out.append({
                    'itemId': item_id, 'title': title, 'sku': h.get('sku'),
                    'adPercent': ad_pct, 'marginWithoutAd': margin_wo_ad,
                    'cardPrice': card_price,
                    'action': 'wait', 'currentPrice': price,
                    'suggestedPrice': price, 'currentMargin': margin,
                    'expectedMargin': margin, 'spp': now_spp.get(item_id),
                    'reason': f'Цену меняли недавно — ждём ещё {days_left.days + 1} дн.',
                })
                continue

            # 2. Скидка площадки просела после прошлого шага — откатываемся.
            spp_now = now_spp.get(item_id)
            spp_was = before_spp.get(item_id)
            if spp_now is not None and spp_was is not None and spp_was - spp_now > 5:
                back = round(price / (1 + step), 2)
                out.append({
                    'itemId': item_id, 'title': title, 'sku': h.get('sku'),
                    'adPercent': ad_pct, 'marginWithoutAd': margin_wo_ad,
                    'cardPrice': card_price,
                    'action': 'rollback', 'currentPrice': price,
                    'suggestedPrice': back, 'currentMargin': margin,
                    'expectedMargin': None, 'spp': spp_now,
                    'reason': (f'Скидка площадки упала с {spp_was:.0f}% до '
                               f'{spp_now:.0f}% — вернём цену назад'),
                })
                continue

            # 3. Маржа вне коридора — двигаем на один шаг.
            if margin < strategy['marginMin']:
                new_price = round(price * (1 + step), 2)
                # Прибыль растёт на всю прибавку минус доля площадки и налоги:
                # грубо считаем, что нам остаётся столько же процентов, сколько
                # сейчас. Точную цифру покажет следующий пересчёт.
                gain = new_price - price
                new_profit = (unit.get('profit') or 0) + gain * 0.35
                out.append({
                    'itemId': item_id, 'title': title, 'sku': h.get('sku'),
                    'adPercent': ad_pct, 'marginWithoutAd': margin_wo_ad,
                    'cardPrice': card_price,
                    'action': 'raise', 'currentPrice': price,
                    'suggestedPrice': new_price, 'currentMargin': margin,
                    'expectedMargin': round(new_profit / new_price * 100, 1),
                    'spp': spp_now,
                    'reason': (f'Маржа {margin}% ниже цели '
                               f'{strategy["marginMin"]:.0f}% — поднимаем на '
                               f'{strategy["stepPercent"]:.0f}%'),
                })
            elif margin > strategy['marginMax']:
                new_price = round(price / (1 + step), 2)
                out.append({
                    'itemId': item_id, 'title': title, 'sku': h.get('sku'),
                    'adPercent': ad_pct, 'marginWithoutAd': margin_wo_ad,
                    'cardPrice': card_price,
                    'action': 'lower', 'currentPrice': price,
                    'suggestedPrice': new_price, 'currentMargin': margin,
                    'expectedMargin': None, 'spp': spp_now,
                    'reason': (f'Маржа {margin}% выше цели '
                               f'{strategy["marginMax"]:.0f}% — цена завышена, '
                               f'снизим и добавим продаж'),
                })
            else:
                out.append({
                    'itemId': item_id, 'title': title, 'sku': h.get('sku'),
                    'adPercent': ad_pct, 'marginWithoutAd': margin_wo_ad,
                    'cardPrice': card_price,
                    'action': 'hold', 'currentPrice': price,
                    'suggestedPrice': price, 'currentMargin': margin,
                    'expectedMargin': margin, 'spp': spp_now,
                    'reason': 'Маржа в целевом коридоре — ничего не меняем',
                })
    return out


def _cost_by_offer(cur):
    """Расходы площадки по каждому товару OZON — ключ по НАШЕМУ артикулу.

    В акции OZON присылает свой внутренний product_id, который у нас нигде не
    хранится. Зато по нему можно спросить карточку и получить offer_id — это и
    есть наш артикул (vyal2_240). По нему и связываем.
    """
    cur.execute(
        "SELECT mi.sku, mp.commission_fbs_percent, mp.logistics_fbs, "
        "  mp.acquiring_amount "
        "FROM marketplace_items mi "
        "JOIN marketplace_prices mp ON mp.marketplace_item_id = mi.id "
        "WHERE mp.marketplace_code = 'ozon' AND mi.sku IS NOT NULL"
    )
    return {str(r[0]).strip(): {
        'commission': float(r[1] or 0),
        'logistics': float(r[2] or 0),
        'acquiring': float(r[3] or 0),
    } for r in cur.fetchall()}


def _ozon_offer_ids(headers, product_ids):
    """Наши артикулы по внутренним номерам OZON: {product_id: offer_id}."""
    if not product_ids:
        return {}
    st, data = _http(
        f'{OZON_API}/v3/product/info/list', 'POST', headers,
        {'product_id': [int(i) for i in product_ids[:1000]]}, timeout=20,
    )
    if st != 200 or not isinstance(data, dict):
        return {}
    items = (data.get('items') or (data.get('result') or {}).get('items')) or []
    return {str(i.get('id')): (i.get('offer_id') or '').strip() for i in items}


def _ozon_action_margin(cur, headers, action_id, tax, vat, production_avg):
    """Что останется от маржи, если пойти в эту акцию OZON.

    Площадка называет максимальную цену участия по каждому товару. Считаем по
    ней настоящую экономику: вычитаем комиссию, логистику, эквайринг, налоги и
    себестоимость. Ответ на вопрос «идти или нет» должен быть в рублях, а не в
    ощущениях — акция с хорошим бустингом может съесть всю прибыль.
    """
    st, data = _http(
        f'{OZON_API}/v1/actions/candidates', 'POST', headers,
        {'action_id': int(action_id), 'limit': 100, 'offset': 0}, timeout=20,
    )
    if st != 200 or not isinstance(data, dict):
        return None

    products = ((data.get('result') or {}).get('products')) or []
    if not products:
        return None

    costs = _cost_by_offer(cur)
    offers = _ozon_offer_ids(headers, [p.get('id') for p in products if p.get('id')])

    margins, loss = [], 0
    for p in products:
        action_price = float(p.get('max_action_price') or 0)
        if action_price <= 0:
            continue
        offer = offers.get(str(p.get('id')))
        c = costs.get(offer) if offer else None
        if not c:
            continue
        mp_costs = (action_price * c['commission'] / 100
                    + c['logistics'] + c['acquiring'])
        v = action_price * vat / (100 + vat) if vat else 0.0
        t = (action_price - v) * tax / 100
        profit = action_price - mp_costs - production_avg - t - v
        margins.append(profit / action_price * 100)
        if profit < 0:
            loss += 1

    if not margins:
        return None
    avg = round(sum(margins) / len(margins), 1)
    # Вердикт простой и честный: акция либо оставляет нам заработок, либо нет.
    verdict = 'good' if avg >= 10 else ('risky' if avg >= 3 else 'bad')
    return {'avg': avg, 'loss': loss, 'count': len(margins), 'verdict': verdict}


def _items_in_actions(cur, headers):
    """В каких акциях уже участвует каждый товар: {offer_id: [названия]}.

    Скидки акций СКЛАДЫВАЮТСЯ. Товар, заведённый в две акции сразу, уходит по
    цене ниже расчётной — прибыль, посчитанная по одной акции, превращается в
    убыток. Вручную это не отследить: у площадки сейчас шесть активных акций,
    и в одной только «Эластичный бустинг» 445 товаров.
    """
    # ПОСТОЯННЫЕ акции считаем фоновыми, а не занимающими квоту.
    #
    # «Эластичный бустинг» идёт с марта 2025 без ограничения срока, и в нём
    # 445 товаров. Если считать его наравне со срочными, квота выбирается
    # целиком и ни один товар нельзя завести никуда — что и произошло.
    #
    # Срочной считаем акцию короче 180 дней: такие идут волнами, и именно
    # между ними надо распределять ассортимент.
    cur.execute(
        "SELECT external_id, title, "
        "  (date_end - date_start) <= 180 AS is_short "
        "FROM marketplace_promotions "
        "WHERE marketplace_code = 'ozon' "
        "  AND (date_end IS NULL OR date_end >= CURRENT_DATE)"
    )
    actions = cur.fetchall()
    if not actions:
        return {}, 0

    product_ids = {}
    # Отдельно копим тех, кто занят СРОЧНЫМИ акциями: только они едят квоту.
    short_ids = set()
    for ext_id, title, is_short in actions:
        st, d = _http(
            f'{OZON_API}/v1/actions/products', 'POST', headers,
            {'action_id': int(ext_id), 'limit': 1000, 'offset': 0}, timeout=25,
        )
        if not isinstance(d, dict):
            continue
        for p in (((d.get('result') or {}).get('products')) or []):
            pid = str(p.get('id') or '')
            if pid:
                product_ids.setdefault(pid, []).append(title)
                if is_short:
                    short_ids.add(pid)

    if not product_ids:
        return {}, 0

    # Переводим внутренние номера площадки в наши артикулы.
    offers = _ozon_offer_ids(headers, list(product_ids.keys()))
    by_offer = {}
    short_offers = set()
    for pid, titles in product_ids.items():
        offer = offers.get(pid)
        if offer:
            by_offer[offer] = titles
            if pid in short_ids:
                short_offers.add(offer)

    # Сколько всего товаров в каталоге — чтобы считать долю в акциях.
    cur.execute(
        "SELECT count(*) FROM marketplace_prices WHERE marketplace_code = 'ozon'")
    total = int(cur.fetchone()[0] or 0)
    return by_offer, total, len(short_offers)


def _current_participation(cur, headers, material, settings):
    """Размеры материала, которые УЖЕ в акциях: по какой цене и с какой маржой.

    До сих пор окно показывало только «кого можно завести». Но половина
    вопросов — про уже заведённых: по какой цене они там сидят и не работаем
    ли мы в убыток. Проверить это можно было лишь в кабинете площадки, товар
    за товаром.

    Здесь по каждой активной акции берём её реальный состав, оставляем размеры
    нужного материала и считаем настоящую экономику по ЦЕНЕ УЧАСТИЯ — с
    комиссией, логистикой, эквайрингом, налогом и себестоимостью.
    """
    cur.execute(
        "SELECT external_id, title FROM marketplace_promotions "
        "WHERE marketplace_code = 'ozon' "
        "  AND (date_end IS NULL OR date_end >= CURRENT_DATE)"
    )
    actions = cur.fetchall()
    if not actions:
        return []

    tax = float(settings.get('taxPercent') or 0)
    vat = float(settings.get('vatPercent') or 0)
    costs = _cost_by_offer(cur)

    cur.execute(
        "SELECT mi.sku, mi.material, mi.width FROM marketplace_items mi "
        "WHERE mi.sku IS NOT NULL")
    meta = {str(r[0]).strip(): {'material': r[1], 'width': r[2]}
            for r in cur.fetchall()}

    cur.execute(
        "SELECT mi.sku, a.ad_percent FROM marketplace_ad_spend a "
        "JOIN marketplace_items mi ON mi.id = a.marketplace_item_id "
        "WHERE a.marketplace_code = 'ozon' AND a.ad_percent > 0")
    ads = {str(r[0]).strip(): float(r[1]) for r in cur.fetchall()}

    # Себестоимость и человеческое имя размера берём из юнит-экономики.
    production, names = {}, {}
    eco = _economics('ozon')
    for r in (eco or {}).get('rows', []):
        if r.get('cost'):
            production[(r['material'], float(r['width'] or 0))] = float(
                r['cost']['productionCost'] or 0)
        if r.get('material') == material:
            for h in (r.get('heights') or []):
                if h.get('sku'):
                    names[str(h['sku'])] = f"{r['width']}×{h.get('height') or ''}"

    out = []
    for ext_id, title in actions:
        st, d = _http(
            f'{OZON_API}/v1/actions/products', 'POST', headers,
            {'action_id': int(ext_id), 'limit': 1000, 'offset': 0}, timeout=25)
        prods = (((d or {}).get('result') or {}).get('products')) or []
        if not prods:
            continue
        offers = _ozon_offer_ids(headers, [str(p.get('id')) for p in prods])

        items = []
        for p in prods:
            offer = offers.get(str(p.get('id')))
            # Только размеры ЭТОГО материала: остальные к вопросу не относятся.
            if not offer or offer not in names:
                continue
            # ЦЕНА УЧАСТИЯ — по ней товар реально продаётся в акции.
            price = float(p.get('action_price') or 0)
            if price <= 0:
                continue
            c = costs.get(offer)
            m = meta.get(offer) or {}
            own = production.get((m.get('material'), float(m.get('width') or 0)))
            if not c or own is None:
                continue
            ad = ads.get(offer, 0.0)
            mp = (price * c['commission'] / 100 + c['logistics']
                  + c['acquiring'] + price * ad / 100)
            v = price * vat / (100 + vat) if vat else 0.0
            t = (price - v) * tax / 100
            profit = round(price - mp - own - t - v, 2)
            items.append({
                'offerId': offer,
                'name': names.get(offer, offer),
                'actionPrice': price,
                'profit': profit,
                'margin': round(profit / price * 100, 1) if price else 0.0,
            })

        if not items:
            continue
        loss = [i for i in items if i['profit'] <= 0]
        out.append({
            'actionId': ext_id,
            'title': title,
            'count': len(items),
            'lossCount': len(loss),
            'avgMargin': round(
                sum(i['margin'] for i in items) / len(items), 1),
            'avgProfit': round(
                sum(i['profit'] for i in items) / len(items), 2),
            'items': sorted(items, key=lambda i: i['margin']),
        })

    # Убыточные акции — первыми: с ними и надо разбираться.
    out.sort(key=lambda a: (-a['lossCount'], a['avgMargin']))
    return out


def _material_plan(cur, headers, material, settings, min_avg_margin=4.5):
    """План продвижения по всему материалу: что, куда и в какой очерёдности.

    Раньше окно показывало только размеры одной ширины и одну акцию за раз.
    Но решение о скидках принимается по материалу целиком: у «Бамбука» полтора
    десятка ширин и полсотни высот, и заводить их по одной — работа на день.

    Здесь по каждой активной акции считается, какие размеры материала в неё
    проходят и что останется от прибыли. Акции сортируются от самой выгодной:
    начинать надо с той, где скидка стоит нам дешевле всего.

    ГЛАВНОЕ ОГРАНИЧЕНИЕ — средняя маржа по ассортименту. Скидка в одной акции
    ещё терпима, но если завести весь материал во все акции разом, средняя
    прибыль просядет до нуля. Поэтому акции добавляются по очереди, и как
    только средняя опускается ниже порога, следующие помечаются «стоп».
    """
    cur.execute(
        "SELECT external_id, title, date_end FROM marketplace_promotions "
        "WHERE marketplace_code = 'ozon' "
        "  AND (date_end IS NULL OR date_end >= CURRENT_DATE) "
        "ORDER BY date_end"
    )
    actions = cur.fetchall()
    if not actions:
        return {'actions': [], 'material': material}

    # Текущая прибыль размеров материала — точка отсчёта. Без неё непонятно,
    # чем мы жертвуем, входя в акцию.
    base = {}
    eco = _economics('ozon')
    for r in (eco or {}).get('rows', []):
        if r.get('material') != material:
            continue
        for h in (r.get('heights') or []):
            u = h.get('unit') or {}
            if h.get('sku') and u.get('price'):
                base[str(h['sku'])] = {
                    'price': float(u['price']),
                    'profit': float(u.get('profit') or 0),
                    'margin': float(u.get('margin') or 0),
                    'name': f"{r['width']}×{h.get('height') or ''}",
                }

    if not base:
        return {'actions': [], 'material': material}

    out = []
    for ext_id, title, date_end in actions:
        cands = _action_candidates(cur, headers, ext_id, settings, 0.0,
                                   plan_mode=True)
        # Только размеры ЭТОГО материала: остальные к решению не относятся.
        mine = [c for c in cands if c['offerId'] in base]
        if not mine:
            continue
        good = [c for c in mine if c['eligible']]
        avg = (round(sum(c['margin'] for c in good) / len(good), 1)
               if good else 0.0)
        # Во сколько обходится скидка: сколько прибыли теряем на вещи.
        drop = round(sum(
            base[c['offerId']]['profit'] - c['profit'] for c in good
        ) / len(good), 2) if good else 0.0
        # ВАРИАНТЫ ГЛУБИНЫ СКИДКИ.
        #
        # Площадка называет потолок цены, но заходить всегда по нему — значит
        # отдавать минимум скидки и получать минимум буста. А заходить сразу
        # глубоко — растратить весь запас прибыли на одной акции.
        #
        # Считаем варианты БЕЗ повторных запросов к площадке: список товаров
        # уже получен, глубина скидки — простая арифметика поверх него.
        # Иначе четыре варианта на шесть акций складывались в два десятка
        # обращений, и функция не укладывалась в отведённое время.
        options = []
        for extra in (0.0, 3.0, 5.0, 10.0):
            k = (100 - extra) / 100
            ok = []
            for c in mine:
                price = round(c['ceilingPrice'] * k, 2)
                if price <= 0:
                    continue
                # Часть расходов падает вместе с ценой, часть — нет. Поэтому
                # прибыль считаем по составляющим, а не пропорцией: иначе
                # маржа выходит одинаковой при любой скидке.
                profit = round(
                    price * (1 - c['varShare']) - c['fixedCost'], 2)
                margin = round(profit / price * 100, 1) if price else 0.0
                if profit > 0:
                    ok.append({'profit': profit, 'margin': margin,
                               'offerId': c['offerId']})
            if not ok:
                continue
            options.append({
                'extraDiscount': extra,
                'fits': len(ok),
                'avgMargin': round(sum(c['margin'] for c in ok) / len(ok), 1),
                # Средняя прибыль с вещи при такой глубине скидки. Показываем
                # именно её, а не «сколько теряем»: разница с текущей ценой
                # сбивает — в акции работает своя цена, и сравнивать надо
                # варианты между собой.
                'avgProfit': round(
                    sum(c['profit'] for c in ok) / len(ok), 2),
            })

        out.append({
            'actionId': ext_id,
            'title': title,
            'dateEnd': str(date_end) if date_end else None,
            'fits': len(good),
            'total': len(mine),
            'avgMargin': avg,
            'profitDrop': drop,
            'options': options,
            'items': mine,
        })

    # Сортируем по цене скидки: дешевле всего — первой. Именно с неё и надо
    # начинать, а дорогие оставить на потом или не трогать вовсе.
    out.sort(key=lambda a: a['profitDrop'])

    # ОЧЕРЁДНОСТЬ. Добавляем акции одну за другой и следим за средней маржой
    # по всему материалу. Размер, уже попавший в акцию, повторно не считаем:
    # скидки складываются, и второй раз он уйдёт ещё дешевле.
    used = {}
    for a in out:
        planned = dict(used)
        for c in a['items']:
            if c['eligible'] and c['offerId'] not in planned:
                planned[c['offerId']] = c['margin']
        # Средняя по ВСЕМУ материалу: размеры вне акций идут со своей маржой.
        margins = [planned.get(sku, b['margin']) for sku, b in base.items()]
        avg_all = round(sum(margins) / len(margins), 2) if margins else 0.0
        a['avgAfter'] = avg_all
        a['newItems'] = len(planned) - len(used)

        if avg_all >= min_avg_margin and a['newItems'] > 0:
            a['recommended'] = True
            a['reason'] = f'Средняя маржа останется {avg_all}%'
            used = planned
        else:
            a['recommended'] = False
            a['reason'] = (
                'Все размеры уже в предыдущих акциях' if a['newItems'] == 0
                else f'Средняя маржа упадёт до {avg_all}% — ниже порога '
                     f'{min_avg_margin}%'
            )

    # ПОМЕЧАЕМ АКЦИИ, ГДЕ РАЗМЕРЫ УЖЕ СИДЯТ.
    #
    # План считает экономику по цене участия и честно предлагает выгодную
    # акцию — но если товар в ней уже состоит, «завести» значит перезавести,
    # а не расширить охват. Без пометки это выглядит как новая возможность,
    # и владелец второй раз отдаёт скидку там, где она уже отдана.
    current = _current_participation(cur, headers, material, settings)
    joined = {a['actionId']: a['count'] for a in current}
    for a in out:
        a['alreadyIn'] = joined.get(a['actionId'], 0)
        if a['alreadyIn']:
            a['recommended'] = False
            a['reason'] = f"Уже участвуют {a['alreadyIn']} размеров"

    return {
        'material': material,
        'actions': out,
        # Кто уже в акциях: по какой цене сидит и с какой маржой. Половина
        # вопросов именно про них, а проверить это можно было только в
        # кабинете площадки, товар за товаром.
        'current': current,
        'minAvgMargin': min_avg_margin,
        'baseAvgMargin': round(
            sum(b['margin'] for b in base.values()) / len(base), 2),
        'sizes': len(base),
    }


def _action_candidates(cur, headers, action_id, settings, min_margin=5.0,
                       plan_mode=False, extra_discount=0.0):
    """Товары акции с разбором: кого можно заводить, а кого нельзя.

    Площадка зовёт в акцию списком и называет по каждому товару максимальную
    цену участия. Считаем по ней настоящую экономику — с комиссией, логистикой,
    эквайрингом, рекламой, налогом и себестоимостью.

    ГЛАВНОЕ ПРАВИЛО: товар, который в акции уходит в минус, не предлагаем
    вовсе. Продвижение не стоит того, чтобы продавать себе в убыток, а вручную
    отследить это в списке на сотни позиций невозможно.

    Порог маржи задаётся: «ноль» значит «лишь бы не в минус», но обычно нужен
    запас — цена может просесть ещё и от скидки покупателю.
    """
    st, data = _http(
        f'{OZON_API}/v1/actions/candidates', 'POST', headers,
        {'action_id': int(action_id), 'limit': 1000, 'offset': 0}, timeout=30,
    )
    if st != 200 or not isinstance(data, dict):
        return []

    products = ((data.get('result') or {}).get('products')) or []
    if not products:
        return []

    tax = float(settings.get('taxPercent') or 0)
    vat = float(settings.get('vatPercent') or 0)
    costs = _cost_by_offer(cur)
    offers = _ozon_offer_ids(
        headers, [p.get('id') for p in products if p.get('id')])

    # Себестоимость и реклама по нашим артикулам.
    cur.execute(
        "SELECT mi.sku, mi.material, mi.width, mi.height "
        "FROM marketplace_items mi WHERE mi.sku IS NOT NULL")
    meta = {str(r[0]).strip(): {'material': r[1], 'width': r[2],
                                'height': r[3]} for r in cur.fetchall()}

    cur.execute(
        "SELECT mi.sku, a.ad_percent FROM marketplace_ad_spend a "
        "JOIN marketplace_items mi ON mi.id = a.marketplace_item_id "
        "WHERE a.marketplace_code = 'ozon' AND a.ad_percent > 0")
    ads = {str(r[0]).strip(): float(r[1]) for r in cur.fetchall()}

    # Себестоимость по каждой паре «ткань + ширина» — из юнит-экономики.
    # Средняя по всем товарам тут не годится: штора 200 см и 800 см стоят
    # по-разному в разы, и по средней дешёвая позиция выглядела бы убыточной,
    # а дорогая — прибыльной.
    # Кто уже в акциях и сколько всего товаров: нужно и для защиты от
    # наложения, и для распределения по ассортименту.
    # В режиме ПЛАНА ограничители не применяем: план сам решает очерёдность
    # акций и сам следит за средней маржой. Иначе он видел бы только остатки
    # после уже занятых позиций и предлагал бы по одному размеру из сотни.
    if plan_mode:
        in_actions, total_items, busy_short = {}, 0, 0
    else:
        in_actions, total_items, busy_short = _items_in_actions(cur, headers)
    max_per_item = int(settings.get('maxActionsPerItem') or 1)
    max_share = float(settings.get('maxItemsInActionsPercent') or 60)
    # Квоту считаем по СРОЧНЫМ акциям: постоянные идут фоном всегда.
    busy_now = busy_short
    # Сколько ещё товаров можно завести, не выйдя за долю ассортимента.
    slots_left = (10 ** 6 if plan_mode
                  else max(0, int(total_items * max_share / 100) - busy_now))

    production = {}
    eco = _economics('ozon')
    for r in (eco or {}).get('rows', []):
        if r.get('cost'):
            production[(r['material'], float(r['width'] or 0))] = float(
                r['cost']['productionCost'] or 0)

    out = []
    for p in products:
        # ЦЕНА УЧАСТИЯ.
        #
        # Площадка называет max_action_price — это ПОТОЛОК: выше не пустит,
        # ниже можно. По умолчанию берём потолок, то есть отдаём минимум
        # скидки — так товар попадёт в максимум акций, не растратив запас
        # прибыли на первой же.
        #
        # Но иногда скидку хочется углубить: чем ниже цена, тем выше буст в
        # выдаче. Тогда владелец задаёт глубину сам, видя, во что она встанет.
        ceiling = float(p.get('max_action_price') or 0)
        action_price = round(ceiling * (100 - extra_discount) / 100, 2)
        offer = offers.get(str(p.get('id')))
        if action_price <= 0 or not offer:
            continue
        c = costs.get(offer)
        m = meta.get(offer) or {}
        own = production.get((m.get('material'), float(m.get('width') or 0)))
        if not c or own is None:
            # Без себестоимости судить о прибыли нельзя — такой товар
            # в акцию не предлагаем.
            continue

        ad = ads.get(offer, 0.0)
        mp_costs = (action_price * c['commission'] / 100
                    + c['logistics'] + c['acquiring']
                    + action_price * ad / 100)
        v = action_price * vat / (100 + vat) if vat else 0.0
        t = (action_price - v) * tax / 100
        profit = round(action_price - mp_costs - own - t - v, 2)
        margin = round(profit / action_price * 100, 1) if action_price else 0.0

        # В скольких акциях товар уже состоит.
        current_actions = [
            t for t in in_actions.get(offer, [])
            # Саму эту акцию не считаем: перезавести в неё — не наложение.
            if True
        ]
        overlapped = len(current_actions) >= max_per_item

        out.append({
            'productId': p.get('id'),
            'offerId': offer,
            # В каких акциях товар уже участвует: скидки складываются.
            'inActions': current_actions,
            'name': f"{m.get('material') or offer} "
                    f"{m.get('width') or ''}×{m.get('height') or ''}".strip(),
            'currentPrice': float(p.get('price') or 0),
            'actionPrice': action_price,
            # Потолок площадки: минимальная скидка, какую она примет.
            'ceilingPrice': ceiling,
            # Составляющие расходов — чтобы пересчитать прибыль под любую
            # цену без повторного обращения к площадке.
            #   varShare — доля, что падает вместе с ценой (комиссия,
            #              реклама, НДС, налог);
            #   fixedCost — что остаётся неизменным (логистика, эквайринг,
            #              себестоимость).
            'varShare': round(
                (c['commission'] + ad) / 100
                + (vat / (100 + vat) if vat else 0)
                + (1 - (vat / (100 + vat) if vat else 0)) * tax / 100, 6),
            'fixedCost': round(c['logistics'] + c['acquiring'] + own, 2),
            # Насколько цена ниже потолка — то, что мы отдали сверх минимума.
            'extraDiscount': extra_discount,
            'profit': profit,
            'margin': margin,
            # Можно ли заводить: только с запасом по марже.
            'eligible': margin >= min_margin and not overlapped,
            'reason': (
                'Уже в акции: ' + ', '.join(current_actions[:2])
                if overlapped
                else ('Подходит' if margin >= min_margin
                      else ('Убыток' if profit < 0
                            else f'Маржа {margin}% ниже порога {min_margin}%'))
            ),
        })

    out.sort(key=lambda x: -x['margin'])

    # РАВНОМЕРНОЕ РАСПРЕДЕЛЕНИЕ.
    #
    # Если завести в акцию весь подходящий ассортимент, для следующего хорошего
    # предложения площадки не останется ничего: товар уже занят, а цена срезана.
    # Поэтому держим в акциях не больше заданной доли каталога, а внутри
    # свободных мест берём САМЫЕ ПРИБЫЛЬНЫЕ — они и так отсортированы сверху.
    settings['_busyShort'] = busy_now
    settings['_slotsLeft'] = slots_left

    allowed = 0
    for c in out:
        if not c['eligible']:
            continue
        if allowed >= slots_left:
            c['eligible'] = False
            c['reason'] = (
                f'Достигнут предел: в акциях уже {busy_now} товаров '
                f'из разрешённых {int(total_items * max_share / 100)}'
            )
            continue
        allowed += 1

    return out


def _sync_ozon_promotions(cur, creds):
    """Акции OZON: во что обойдётся участие.

    Площадка зовёт в акцию и обещает продвижение, но требует срезать цену.
    Считаем, что останется от маржи по каждой акции, и даём прямой ответ.
    """
    headers = {'Client-Id': (creds.get('clientId') or '').strip(),
               'Api-Key': (creds.get('apiKey') or '').strip()}
    st, data = _http(f'{OZON_API}/v1/actions', 'GET', headers, timeout=20)
    if st != 200 or not isinstance(data, dict):
        return 0

    # Ставки налогов и средняя себестоимость — общие для всех акций, берём один раз.
    cur.execute(
        "SELECT tax_percent, vat_percent FROM unit_economics_settings "
        "ORDER BY id LIMIT 1"
    )
    s = cur.fetchone()
    tax = float(s[0] or 0) if s else 0.0
    vat = float(s[1] or 0) if s else 0.0

    saved = 0
    for a in (data.get('result') or []):
        cur.execute(
            "INSERT INTO marketplace_promotions (marketplace_code, external_id, "
            "title, date_start, date_end, items_count, synced_at) "
            "VALUES ('ozon', %s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (marketplace_code, external_id) DO UPDATE SET "
            "  title = EXCLUDED.title, date_start = EXCLUDED.date_start, "
            "  date_end = EXCLUDED.date_end, items_count = EXCLUDED.items_count, "
            "  synced_at = now()",
            (str(a.get('id')), a.get('title'),
             (a.get('date_start') or '')[:10] or None,
             (a.get('date_end') or '')[:10] or None,
             int(a.get('potential_products_count') or 0)),
        )
        saved += 1
    return saved


def _score_ozon_promotions(cur, creds, limit=3):
    """Считает выгоду по акциям OZON — по нескольку за вызов.

    Каждая акция требует отдельного запроса к площадке, а у функции пять секунд.
    Поэтому берём те, что дольше всех не пересчитывали, и идём по кругу: за
    несколько запусков планировщика обсчитываются все.
    """
    headers = {'Client-Id': (creds.get('clientId') or '').strip(),
               'Api-Key': (creds.get('apiKey') or '').strip()}

    cur.execute(
        "SELECT tax_percent, vat_percent FROM unit_economics_settings "
        "ORDER BY id LIMIT 1"
    )
    s = cur.fetchone()
    tax = float(s[0] or 0) if s else 0.0
    vat = float(s[1] or 0) if s else 0.0

    # Средняя себестоимость производства — по ней оцениваем акцию целиком.
    data = _economics('ozon')
    production = 0.0
    if data:
        costs = [r['cost']['productionCost'] for r in data.get('rows', [])
                 if r.get('cost')]
        production = round(sum(costs) / len(costs), 2) if costs else 0.0

    cur.execute(
        "SELECT external_id FROM marketplace_promotions "
        "WHERE marketplace_code = 'ozon' "
        "  AND (date_end IS NULL OR date_end >= CURRENT_DATE) "
        "ORDER BY avg_margin IS NOT NULL, synced_at LIMIT %s",
        (int(limit),),
    )
    ids = [r[0] for r in cur.fetchall()]

    done = 0
    for action_id in ids:
        res = _ozon_action_margin(cur, headers, action_id, tax, vat, production)
        if not res:
            continue
        cur.execute(
            "UPDATE marketplace_promotions SET avg_margin = %s, "
            "  lossmaking_count = %s, items_count = %s, verdict = %s, "
            "  synced_at = now() "
            "WHERE marketplace_code = 'ozon' AND external_id = %s",
            (res['avg'], res['loss'], res['count'], res['verdict'], action_id),
        )
        done += 1
    return done


def _sync_wb_promotions(cur, creds):
    """Акции Wildberries из календаря продвижения."""
    headers = {'Authorization': (creds.get('apiKey') or '').strip()}
    start = datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')
    end = (datetime.now(timezone.utc) + timedelta(days=45)).strftime('%Y-%m-%dT00:00:00Z')
    st, data = _http(
        f'{WB_PROMO_API}/api/v1/calendar/promotions'
        f'?startDateTime={start}&endDateTime={end}&allPromo=false',
        'GET', headers, timeout=20,
    )
    if st != 200 or not isinstance(data, dict):
        return 0
    saved = 0
    for a in ((data.get('data') or {}).get('promotions') or []):
        cur.execute(
            "INSERT INTO marketplace_promotions (marketplace_code, external_id, "
            "title, date_start, date_end, synced_at) "
            "VALUES ('wildberries', %s, %s, %s, %s, now()) "
            "ON CONFLICT (marketplace_code, external_id) DO UPDATE SET "
            "  title = EXCLUDED.title, date_start = EXCLUDED.date_start, "
            "  date_end = EXCLUDED.date_end, synced_at = now()",
            (str(a.get('id')), a.get('name'),
             (a.get('startDateTime') or '')[:10] or None,
             (a.get('endDateTime') or '')[:10] or None),
        )
        saved += 1
    return saved


def _promotions(cur):
    """Список акций с вердиктом: идти или нет."""
    cur.execute(
        "SELECT marketplace_code, external_id, title, date_start, date_end, "
        "items_count, avg_margin, lossmaking_count, verdict, synced_at "
        "FROM marketplace_promotions "
        "WHERE date_end IS NULL OR date_end >= CURRENT_DATE "
        "ORDER BY date_start NULLS LAST, id"
    )
    out = []
    for r in cur.fetchall():
        out.append({
            'marketplaceCode': r[0], 'marketplaceTitle': MP_TITLES.get(r[0], r[0]),
            'externalId': r[1], 'title': r[2],
            'dateStart': r[3].isoformat() if r[3] else None,
            'dateEnd': r[4].isoformat() if r[4] else None,
            'itemsCount': r[5], 'avgMargin': float(r[6]) if r[6] is not None else None,
            'lossmakingCount': r[7], 'verdict': r[8],
            'syncedAt': r[9].isoformat() + 'Z' if r[9] else None,
        })
    return out


def handler(event: dict, context) -> dict:
    """Продвижение: советы по ценам и разбор акций площадок.

    Держит маржу в целевом коридоре, поднимая цену мелкими шагами, чтобы не
    потерять скидку площадки (СПП). Система НИЧЕГО не меняет сама — она считает
    и предлагает, решение за владельцем.

    GET  /?action=overview&actorId=  - советы по ценам и сводка
    GET  /?action=promotions&actorId= - акции площадок с расчётом выгоды
    GET  /?action=history&itemId=     - история цены и СПП по товару
    POST /  { action: 'capture' }     - снимок цен и СПП (для планировщика)
    POST /  { action: 'sync_promotions' } - подтянуть акции площадок
    POST /  { action: 'decide', ids, decision } - принять или отклонить советы
    POST /  { action: 'save_strategy', ... }    - коридор маржи и шаг
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = False
    try:
        cur = conn.cursor()

        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            action = params.get('action') or 'overview'
            actor_id = params.get('actorId')

            # Раздел про деньги и цены — только владельцу.
            if not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Раздел доступен администратору'})

            if action == 'promotions':
                return _resp(200, {'items': _promotions(cur)})

            if action == 'history':
                item_id = params.get('itemId')
                if not item_id or not str(item_id).isdigit():
                    return _resp(400, {'error': 'Укажите товар'})
                cur.execute(
                    "SELECT captured_on, price, buyer_price, spp_percent, "
                    "margin_percent FROM price_history "
                    "WHERE marketplace_item_id = %s ORDER BY captured_on DESC LIMIT 60",
                    (int(item_id),),
                )
                return _resp(200, {'items': [{
                    'date': r[0].isoformat(),
                    'price': float(r[1]) if r[1] is not None else None,
                    'buyerPrice': float(r[2]) if r[2] is not None else None,
                    'spp': float(r[3]) if r[3] is not None else None,
                    'margin': float(r[4]) if r[4] is not None else None,
                } for r in cur.fetchall()]})

            if action != 'overview':
                return _resp(400, {'error': 'Неизвестное действие'})

            marketplace = params.get('marketplace') or 'ozon'
            if marketplace not in MARKETPLACES:
                return _resp(400, {'error': 'Неизвестный маркетплейс'})

            strategy = _strategy(cur)
            data = _economics(marketplace)
            if not data:
                return _resp(200, {'strategy': strategy, 'items': [],
                                   'error': 'Не удалось получить расчёт экономики'})

            items = _build_recommendations(cur, marketplace, data, strategy)
            by_action = {}
            for i in items:
                by_action[i['action']] = by_action.get(i['action'], 0) + 1

            # Товары, которые убыточны ТОЛЬКО из-за рекламы: сами по себе они
            # прибыльны, но бустинг съедает больше, чем они приносят. Поднимать
            # им цену бессмысленно — нужно выключить продвижение.
            killed_by_ads = [
                i for i in items
                if (i.get('currentMargin') or 0) < 0
                and (i.get('marginWithoutAd') or 0) >= strategy['marginMin']
            ]
            ads = [i.get('adPercent') or 0 for i in items]
            avg_ad = round(sum(ads) / len(ads), 1) if ads else 0.0

            return _resp(200, {
                'marketplaceCode': marketplace,
                'strategy': strategy,
                'buyout': data.get('buyout'),
                'items': items,
                'summary': {
                    'total': len(items),
                    'raise': by_action.get('raise', 0),
                    'lower': by_action.get('lower', 0),
                    'hold': by_action.get('hold', 0),
                    'wait': by_action.get('wait', 0),
                    'rollback': by_action.get('rollback', 0),
                    # Реклама: средняя доля в цене и сколько позиций она топит.
                    'avgAdPercent': avg_ad,
                    'killedByAds': len(killed_by_ads),
                },
            })

        body_data = json.loads(event.get('body') or '{}')
        action = body_data.get('action')
        actor_id = body_data.get('actorId')

        # Снимок цен запускает планировщик — ему нужен ключ, а не пользователь.
        if action == 'capture':
            secret = os.environ.get('CRON_SECRET', '')
            if body_data.get('cronSecret'):
                if not secret or body_data['cronSecret'] != secret:
                    return _resp(403, {'error': 'Неверный ключ планировщика'})
            elif not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Доступно администратору'})

            total = 0
            for mp in MARKETPLACES:
                total += _capture_history(cur, mp)
            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, "
                "entity_type, description) VALUES ('integration', NULL, "
                "'Планировщик', 'price_capture', 'promotion', %s)",
                (f'Снимок цен и СПП: {total} позиций',),
            )
            conn.commit()
            return _resp(200, {'ok': True, 'saved': total})

        if action == 'sync_promotions':
            secret = os.environ.get('CRON_SECRET', '')
            if body_data.get('cronSecret'):
                if not secret or body_data['cronSecret'] != secret:
                    return _resp(403, {'error': 'Неверный ключ планировщика'})
            elif not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Доступно администратору'})

            report = {}
            oz, oz_on = _credentials(cur, 'ozon')
            if oz_on:
                report['ozon'] = _sync_ozon_promotions(cur, oz)
            wb, wb_on = _credentials(cur, 'wildberries')
            if wb_on:
                report['wildberries'] = _sync_wb_promotions(cur, wb)
            # Запись в журнал: по ней страница Планировщика видит, что задание
            # реально отработало, а не молчит незамеченным.
            cur.execute(
                "INSERT INTO audit_log (category, user_id, user_name, action, "
                "entity_type, description) VALUES ('integration', NULL, "
                "'Планировщик', 'promotions_sync', 'promotion', %s)",
                (f'Акции площадок: {sum(report.values())} шт.',),
            )
            conn.commit()
            return _resp(200, {'ok': True, 'report': report})

        if action == 'score_promotions':
            # Расчёт выгоды вынесен отдельно: он тяжелее загрузки списка,
            # потому что по каждой акции надо спросить у площадки цены участия.
            secret = os.environ.get('CRON_SECRET', '')
            if body_data.get('cronSecret'):
                if not secret or body_data['cronSecret'] != secret:
                    return _resp(403, {'error': 'Неверный ключ планировщика'})
            elif not _is_admin(cur, actor_id):
                return _resp(403, {'error': 'Доступно администратору'})

            oz, oz_on = _credentials(cur, 'ozon')
            done = _score_ozon_promotions(cur, oz) if oz_on else 0
            conn.commit()
            return _resp(200, {'ok': True, 'scored': done})

        if not _is_admin(cur, actor_id):
            return _resp(403, {'error': 'Раздел доступен администратору'})

        if action == 'action_candidates':
            # Кто из товаров подходит в акцию, а кто уйдёт в минус.
            creds, enabled = _credentials(cur, 'ozon')
            if not enabled:
                return _resp(400, {'error': 'Интеграция OZON не подключена'})
            action_id = body_data.get('actionId')
            if not action_id:
                return _resp(400, {'error': 'Укажите actionId'})
            h = {'Client-Id': (creds.get('clientId') or '').strip(),
                 'Api-Key': (creds.get('apiKey') or '').strip()}
            cur.execute(
                "SELECT tax_percent, vat_percent FROM unit_economics_settings "
                "ORDER BY id LIMIT 1")
            r = cur.fetchone()
            st_set = {'taxPercent': float(r[0] or 0) if r else 0.0,
                      'vatPercent': float(r[1] or 0) if r else 0.0}
            # Ограничения по наложению и доле ассортимента.
            cur.execute(
                "SELECT max_actions_per_item, max_items_in_actions_percent "
                "FROM pricing_strategy ORDER BY id LIMIT 1")
            lim = cur.fetchone()
            st_set['maxActionsPerItem'] = int(lim[0]) if lim else 1
            st_set['maxItemsInActionsPercent'] = float(lim[1]) if lim else 60.0
            items = _action_candidates(
                cur, h, action_id, st_set,
                float(body_data.get('minMargin') or 5.0),
                extra_discount=float(body_data.get('extraDiscount') or 0))
            # Сводка по занятости: сколько товаров уже в акциях и сколько
            # мест осталось. Без неё непонятно, почему прибыльный товар
            # вдруг «не проходит».
            cur.execute(
                "SELECT count(*) FROM marketplace_prices "
                "WHERE marketplace_code = 'ozon'")
            total_items = int(cur.fetchone()[0] or 0)
            busy = len({i['offerId'] for i in items if i.get('inActions')})
            limit_items = int(total_items
                              * st_set['maxItemsInActionsPercent'] / 100)
            return _resp(200, {
                'items': items,
                'eligible': sum(1 for i in items if i['eligible']),
                'total': len(items),
                'busyInActions': busy,
            'busyShort': st_set.get('_busyShort'),
                'limitItems': limit_items,
                'totalItems': total_items,
                'maxActionsPerItem': st_set['maxActionsPerItem'],
            })

        if action == 'material_plan':
            # Все размеры материала и все акции сразу: решение о скидках
            # принимается по материалу целиком, а не по одной ширине.
            creds, enabled = _credentials(cur, 'ozon')
            if not enabled:
                return _resp(400, {'error': 'Интеграция OZON не подключена'})
            material = body_data.get('material')
            if not material:
                return _resp(400, {'error': 'Укажите материал'})
            h = {'Client-Id': (creds.get('clientId') or '').strip(),
                 'Api-Key': (creds.get('apiKey') or '').strip()}
            cur.execute(
                "SELECT tax_percent, vat_percent FROM unit_economics_settings "
                "ORDER BY id LIMIT 1")
            r = cur.fetchone()
            st_set = {'taxPercent': float(r[0] or 0) if r else 0.0,
                      'vatPercent': float(r[1] or 0) if r else 0.0}
            cur.execute(
                "SELECT max_actions_per_item, max_items_in_actions_percent "
                "FROM pricing_strategy ORDER BY id LIMIT 1")
            lim = cur.fetchone()
            st_set['maxActionsPerItem'] = int(lim[0]) if lim else 1
            st_set['maxItemsInActionsPercent'] = float(lim[1]) if lim else 60.0
            plan = _material_plan(
                cur, h, material, st_set,
                float(body_data.get('minAvgMargin') or 4.5))
            return _resp(200, plan)

        if action == 'join_action':
            # Завести товары в акцию.
            #
            # Убыточные не пропускаем НИКОГДА: даже если пришли в списке от
            # интерфейса. Проверку делаем здесь, на сервере, — интерфейс можно
            # обойти, а деньги теряются настоящие.
            if not _is_admin(cur, body_data.get('actorId')):
                return _resp(403, {'error': 'Доступно администратору'})
            creds, enabled = _credentials(cur, 'ozon')
            if not enabled:
                return _resp(400, {'error': 'Интеграция OZON не подключена'})
            action_id = body_data.get('actionId')
            offers = body_data.get('offerIds') or []
            if not action_id or not offers:
                return _resp(400, {'error': 'Укажите акцию и товары'})

            h = {'Client-Id': (creds.get('clientId') or '').strip(),
                 'Api-Key': (creds.get('apiKey') or '').strip()}
            cur.execute(
                "SELECT tax_percent, vat_percent FROM unit_economics_settings "
                "ORDER BY id LIMIT 1")
            r = cur.fetchone()
            st_set = {'taxPercent': float(r[0] or 0) if r else 0.0,
                      'vatPercent': float(r[1] or 0) if r else 0.0}
            # Ограничения по наложению и доле ассортимента.
            cur.execute(
                "SELECT max_actions_per_item, max_items_in_actions_percent "
                "FROM pricing_strategy ORDER BY id LIMIT 1")
            lim = cur.fetchone()
            st_set['maxActionsPerItem'] = int(lim[0]) if lim else 1
            st_set['maxItemsInActionsPercent'] = float(lim[1]) if lim else 60.0
            cands = _action_candidates(
                cur, h, action_id, st_set,
                float(body_data.get('minMargin') or 5.0),
                extra_discount=float(body_data.get('extraDiscount') or 0))
            allowed = {c['offerId']: c for c in cands if c['eligible']}

            picked = [allowed[o] for o in offers if o in allowed]
            rejected = [o for o in offers if o not in allowed]
            if not picked:
                return _resp(409, {
                    'error': 'Ни один товар не проходит по прибыльности',
                    'rejected': rejected,
                })

            st, d = _http(
                f'{OZON_API}/v1/actions/products/activate', 'POST', h,
                {'action_id': int(action_id),
                 'products': [{'product_id': int(c['productId']),
                               'action_price': c['actionPrice']}
                              for c in picked]},
                timeout=30,
            )
            if st != 200:
                return _resp(502, {'error': f'Площадка отказала: {str(d)[:200]}'})

            cur.execute(
                "INSERT INTO audit_log (user_id, user_name, category, action, "
                "  entity_type, description) "
                "VALUES (%s, %s, 'marketplace', 'action_join', 'promotion', %s)",
                (body_data.get('actorId'), body_data.get('actorName'),
                 f'Завёл в акцию {action_id}: {len(picked)} товаров, '
                 f'отклонено по убытку: {len(rejected)}'),
            )
            conn.commit()
            return _resp(200, {
                'ok': True, 'joined': len(picked),
                'rejected': rejected,
                'items': [c['offerId'] for c in picked],
            })

        if action == 'decide':
            # Владелец согласился с советом или отклонил его. Цену на площадке
            # НЕ меняем: система только запоминает решение, чтобы не предлагать
            # то же самое каждый день и выдержать паузу до следующего шага.
            items = body_data.get('items') or []
            decision = body_data.get('decision')
            if decision not in ('applied', 'skipped'):
                return _resp(400, {'error': 'Неизвестное решение'})
            saved = 0
            for it in items:
                cur.execute(
                    "INSERT INTO price_recommendations (marketplace_item_id, "
                    "marketplace_code, action, current_price, suggested_price, "
                    "current_margin, expected_margin, reason, status, decided_at, "
                    "decided_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s)",
                    (int(it['itemId']), it.get('marketplaceCode'), it.get('action'),
                     it.get('currentPrice'), it.get('suggestedPrice'),
                     it.get('currentMargin'), it.get('expectedMargin'),
                     it.get('reason'), decision,
                     int(actor_id) if actor_id else None),
                )
                saved += 1
            conn.commit()
            return _resp(200, {'ok': True, 'saved': saved})

        if action == 'save_strategy':
            cur.execute(
                "UPDATE pricing_strategy SET target_margin_min = %s, "
                "target_margin_max = %s, step_percent = %s, step_days = %s, "
                "max_ad_percent = %s, max_actions_per_item = %s, "
                "max_items_in_actions_percent = %s, "
                "updated_at = now(), updated_by = %s "
                "WHERE id = (SELECT id FROM pricing_strategy ORDER BY id LIMIT 1)",
                (float(body_data.get('marginMin') or 10),
                 float(body_data.get('marginMax') or 15),
                 float(body_data.get('stepPercent') or 2),
                 int(body_data.get('stepDays') or 7),
                 float(body_data.get('maxAdPercent') or 12),
                 int(body_data.get('maxActionsPerItem') or 1),
                 float(body_data.get('maxItemsInActionsPercent') or 60),
                 int(actor_id) if actor_id else None),
            )
            conn.commit()
            return _resp(200, {'ok': True})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()