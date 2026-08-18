import json
import os
from datetime import datetime, timedelta, timezone

import psycopg2

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Content-Type': 'application/json',
}

# ФОНОВЫЕ ЗАДАНИЯ, КОТОРЫЕ ДОЛЖНЫ РАБОТАТЬ КРУГЛОСУТОЧНО.
#
# Каждое задание — это ссылка, которую внешний планировщик (cron-job.org) дёргает
# по расписанию. Система не запускает их сама: если планировщик отключат или ссылка
# перестанет отвечать, всё внешне выглядит нормально — заказы просто перестают
# приходить, а отмены копятся незамеченными. Именно это и произошло с отменами OZON.
#
# Поэтому страница показывает не «настроено/не настроено», а факт: когда задание
# реально отработало в последний раз. Признак — запись в журнале.
#
# Задания сгруппированы по смыслу работы, а не по маркетплейсам: админ смотрит на
# страницу вопросом «что сейчас не работает», и ему важно сразу видеть, ЧТО именно
# отвалилось — приём заказов, ловля отмен или служебная работа.
#
# key         — код действия в журнале (audit_log.action);
# group       — раздел на странице;
# everyMin    — как часто задание должно запускаться, минут;
# lateAfter   — через сколько минут молчания считаем задание сломавшимся;
# optional    — задание может законно молчать (запускается редко, раз в сутки),
#               поэтому «никогда не запускалось» для него не тревога.
JOBS = [
    # --- ПРИЁМ ЗАКАЗОВ. Молчит — новые заказы не попадают в цех вообще.
    {
        'key': 'ozon_sync_orders',
        'title': 'OZON — новые заказы',
        'func': 'ozon_fbs',
        'urlAction': 'sync_orders',
        'purpose': 'Забирает с OZON новые заказы и ставит их на конвейер',
        'group': 'orders',
        'everyMin': 15,
        'lateAfter': 60,
    },
    {
        'key': 'wb_sync_orders',
        'title': 'WildBerries — новые заказы',
        'func': 'wb_fbs',
        'urlAction': 'sync_orders',
        'purpose': 'Забирает с WB новые заказы и ставит их на конвейер',
        'group': 'orders',
        'everyMin': 15,
        'lateAfter': 60,
    },
    {
        'key': 'ym_sync',
        'title': 'Яндекс Маркет — новые заказы',
        'func': 'yandex_market',
        'urlAction': 'sync',
        'purpose': 'Забирает с Яндекса новые заказы и ставит их на конвейер',
        'group': 'orders',
        'everyMin': 15,
        'lateAfter': 60,
    },
    # --- ОТМЕНЫ. Молчит — цех шьёт то, от чего покупатель уже отказался.
    {
        'key': 'ozon_refresh_statuses',
        'title': 'OZON — отмены и статусы',
        'func': 'ozon_fbs',
        'urlAction': 'refresh_all_statuses',
        'purpose': 'Ловит отказы покупателей и снимает уехавшие заказы с очереди',
        'group': 'cancels',
        'everyMin': 60,
        'lateAfter': 180,
    },
    {
        'key': 'wb_check_statuses',
        'title': 'WildBerries — отмены и статусы',
        'func': 'wb_fbs',
        'urlAction': 'check_statuses',
        'purpose': 'Ловит отказы покупателей и закрывает уже отгруженные заказы',
        'group': 'cancels',
        'everyMin': 60,
        'lateAfter': 180,
    },
    {
        'key': 'ym_check_statuses',
        'title': 'Яндекс Маркет — отмены и статусы',
        'func': 'yandex_market',
        'urlAction': 'check_statuses',
        'purpose': 'Ловит отказы покупателей до того, как вещь дойдёт до стикеровки',
        'group': 'cancels',
        'everyMin': 60,
        'lateAfter': 180,
    },
    # --- СКЛАД И ЦЕХ. Служебная работа, без которой копятся ручные разборы.
    {
        'key': 'sync',
        'title': 'Возвраты с маркетплейсов',
        'func': 'marketplace_returns',
        'urlAction': 'sync',
        'purpose': 'Тянет заявки на возврат, чтобы кладовщик забрал вещи с пункта выдачи',
        'group': 'service',
        'everyMin': 60,
        'lateAfter': 240,
    },
    {
        'key': 'ozon_split_pending',
        'title': 'OZON — разделение заказов',
        'func': 'ozon_fbs',
        'urlAction': 'split_pending',
        'purpose': 'Разбивает заказ из нескольких штор на отдельные задания для цеха',
        'group': 'service',
        'everyMin': 60,
        'lateAfter': 240,
    },
    {
        'key': 'ue_sync_prices',
        'title': 'Цены, логистика и комиссии',
        'func': 'unit_economics',
        'urlAction': 'auto_sync_prices',
        # Задание пишет цены в базу, поэтому только POST — как у автозакрытия смен.
        'method': 'POST',
        'purpose': 'Тянет с площадок цены, комиссии и стоимость логистики для юнит-экономики',
        'group': 'service',
        'everyMin': 360,
        'lateAfter': 1440,
        # Каталог обходится частями: за запуск берётся несколько страниц, поэтому
        # отдельный заход может не дать новых записей — это не поломка.
        'optional': True,
    },
    {
        'key': 'shifts_auto_close',
        'title': 'Автозакрытие смен',
        'func': 'shift_sessions',
        'urlAction': 'auto_close',
        # Автозакрытие начисляет штрафы, поэтому работает только через POST —
        # простой ссылкой его не дёрнуть, в планировщике нужен метод POST и тело.
        'method': 'POST',
        'purpose': 'Закрывает смены, которые сотрудники забыли закрыть, и ставит штрафы',
        'group': 'service',
        'everyMin': 1440,
        'lateAfter': 2880,
        # Задание ночное: если сегодня все закрыли смены сами, записи может не быть.
        'optional': True,
    },
]

# Адреса функций, которые дёргает планировщик. Держим здесь, потому что функция
# собирает готовые ссылки для копирования в cron-job.org — админ не должен искать
# их по разным экранам и склеивать руками.
FUNC_IDS = {
    'ozon_fbs': 'c1ec58fb-3291-4827-a469-11a1e7019684',
    'wb_fbs': '142096e2-0171-412b-b6df-1631cb52574a',
    'yandex_market': '27689c0a-e080-4c26-b433-8e0979079d19',
    'marketplace_returns': '015dbb02-13c9-49de-8718-8fe37c329b30',
    'shift_sessions': '6143d29d-094c-4dc6-a520-eb0eeb10d8a0',
    'unit_economics': '4ebd72ad-8ca4-456c-840c-d2db30ce04cd',
}

# Разделы страницы: заголовок и пояснение, чем грозит молчание.
GROUPS = [
    {
        'key': 'orders',
        'title': 'Приём заказов',
        'hint': 'Если не работает — новые заказы не попадают в цех',
    },
    {
        'key': 'cancels',
        'title': 'Отмены покупателей',
        'hint': 'Если не работает — цех шьёт то, от чего уже отказались',
    },
    {
        'key': 'service',
        'title': 'Склад и цех',
        'hint': 'Служебные задания: возвраты, разделение заказов, смены',
    },
]


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS_HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def handler(event: dict, context) -> dict:
    """Состояние фоновых заданий: когда каждое отработало и что нашло.

    Показывает администратору, живы ли задания планировщика. Только чтение журнала —
    ничего не запускает и не меняет.
    """
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    if method != 'GET':
        return _resp(405, {'error': 'Method not allowed'})

    params = event.get('queryStringParameters') or {}
    actor_id = params.get('actorId')

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        # ГОТОВЫЕ ССЫЛКИ ОТДАЁМ ТОЛЬКО АДМИНИСТРАТОРУ.
        #
        # В ссылке зашит ключ планировщика: кто его знает, тот может запускать загрузки
        # и автозакрытие смен со штрафами со стороны. Роль берём из базы, а не из
        # запроса — в запросе её можно подменить, в базе нет.
        is_admin = False
        if actor_id:
            cur.execute("SELECT role FROM users WHERE id = %s", (int(actor_id),))
            row = cur.fetchone()
            is_admin = bool(row and row[0] == 'admin')

        cron_secret = os.environ.get('CRON_SECRET', '')
        base = os.environ.get('FUNCTIONS_BASE_URL', 'https://functions.poehali.dev')

        keys = "', '".join(j['key'] for j in JOBS)
        # Категорию НЕ фильтруем: загрузка возвратов пишется в журнал под 'returns',
        # остальные — под 'integration'. Раньше фильтр по одной категории прятал
        # возвраты, и исправное задание выглядело как никогда не запускавшееся.
        cur.execute(
            "SELECT action, MAX(created_at), "
            "       COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') "
            f"FROM audit_log WHERE action IN ('{keys}') "
            "GROUP BY action"
        )
        agg = {r[0]: {'last': r[1], 'perDay': int(r[2])} for r in cur.fetchall()}

        # Текст последнего запуска: что именно задание нашло в прошлый раз.
        cur.execute(
            "SELECT DISTINCT ON (action) action, description, created_at "
            f"FROM audit_log WHERE action IN ('{keys}') "
            "ORDER BY action, created_at DESC"
        )
        last_desc = {r[0]: r[1] for r in cur.fetchall()}

        now = datetime.now(timezone.utc)
        items = []
        for job in JOBS:
            a = agg.get(job['key']) or {}
            last = a.get('last')
            minutes_ago = None
            if last:
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                minutes_ago = int((now - last).total_seconds() // 60)

            # Состояние: никогда не запускалось / молчит слишком долго / работает.
            #
            # Ночным заданиям (optional) молчание не ставим в вину: автозакрытие смен
            # пишет запись, только когда действительно что-то закрыло. Если все закрыли
            # смены сами, записи нет — и это норма, а не поломка.
            if minutes_ago is None:
                state = 'unknown' if job.get('optional') else 'never'
            elif minutes_ago > job['lateAfter']:
                state = 'unknown' if job.get('optional') else 'late'
            else:
                state = 'ok'

            items.append({
                'key': job['key'],
                'title': job['title'],
                'purpose': job['purpose'],
                'group': job['group'],
                'everyMin': job['everyMin'],
                'lastRunAt': last.isoformat() if last else None,
                'minutesAgo': minutes_ago,
                'runsPerDay': a.get('perDay', 0),
                'lastResult': last_desc.get(job['key']),
                'state': state,
                # Готовая ссылка для планировщика — с ключом внутри, поэтому только
                # администратору. Остальным отдаём null: карточка покажет состояние,
                # но не выдаст ключ запуска.
                'url': (
                    # POST-задание запускается телом запроса, а не адресом: ключ в
                    # адрес не подставляем, иначе админ скопирует ссылку, вставит
                    # в планировщик как обычную — и она молча не сработает.
                    f"{base}/{FUNC_IDS[job['func']]}"
                    if job.get('method') == 'POST'
                    else f"{base}/{FUNC_IDS[job['func']]}"
                         f"?action={job['urlAction']}&cronSecret={cron_secret}"
                ) if (is_admin and cron_secret) else None,
                # Автозакрытие смен трогает деньги и работает только через POST:
                # в планировщике для него нужен метод POST и тело запроса.
                'method': job.get('method', 'GET'),
                'body': (
                    json.dumps({'action': job['urlAction'], 'cronSecret': cron_secret},
                               ensure_ascii=False)
                    if (is_admin and cron_secret and job.get('method') == 'POST') else None
                ),
            })

        return _resp(200, {
            'items': items,
            'groups': GROUPS,
            # Ссылки показываем только админу — фронт по этому флагу решает,
            # рисовать ли блок с адресами.
            'canSeeUrls': bool(is_admin and cron_secret),
            # В тревогу считаем только реальные поломки. Задания со статусом unknown
            # (ночные, могут законно молчать) в счётчик не идут — иначе на странице
            # вечно висела бы «проблема», к которой все привыкнут и перестанут читать.
            'problems': sum(1 for i in items if i['state'] in ('late', 'never')),
        })
    finally:
        conn.close()