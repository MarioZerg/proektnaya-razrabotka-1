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
# key         — код действия в журнале (audit_log.action);
# everyMin    — как часто задание должно запускаться, минут;
# lateAfter   — через сколько минут молчания считаем задание сломавшимся.
JOBS = [
    {
        'key': 'ozon_sync_orders',
        'title': 'OZON — загрузка новых заказов',
        'purpose': 'Забирает с OZON новые заказы и ставит их на конвейер',
        'marketplace': 'OZON',
        'func': 'ozon_fbs',
        'action': 'sync_orders',
        'everyMin': 15,
        'lateAfter': 60,
    },
    {
        'key': 'ozon_refresh_statuses',
        'title': 'OZON — отмены и статусы',
        'purpose': 'Ловит отказы покупателей и снимает уехавшие заказы с очереди',
        'marketplace': 'OZON',
        'func': 'ozon_fbs',
        'action': 'refresh_all_statuses',
        'everyMin': 60,
        'lateAfter': 180,
    },
    {
        'key': 'ym_check_statuses',
        'title': 'Яндекс Маркет — отмены и статусы',
        'purpose': 'Ловит отказы покупателей до того, как вещь дойдёт до стикеровки',
        'marketplace': 'Яндекс Маркет',
        'func': 'yandex_market',
        'action': 'check_statuses',
        'everyMin': 60,
        'lateAfter': 180,
    },
    {
        'key': 'wb_check_statuses',
        'title': 'WildBerries — отмены и статусы',
        'purpose': 'Ловит отказы покупателей и закрывает уже отгруженные заказы',
        'marketplace': 'WildBerries',
        'func': 'wb_fbs',
        'action': 'check_statuses',
        'everyMin': 60,
        'lateAfter': 180,
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

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        keys = "', '".join(j['key'] for j in JOBS)
        # Последний запуск и общее число запусков за сутки — одним проходом по журналу.
        cur.execute(
            "SELECT action, MAX(created_at), "
            "       COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') "
            f"FROM audit_log WHERE category = 'integration' AND action IN ('{keys}') "
            "GROUP BY action"
        )
        agg = {r[0]: {'last': r[1], 'perDay': int(r[2])} for r in cur.fetchall()}

        # Текст последнего запуска: что именно задание нашло в прошлый раз.
        cur.execute(
            "SELECT DISTINCT ON (action) action, description, created_at "
            f"FROM audit_log WHERE category = 'integration' AND action IN ('{keys}') "
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
            if minutes_ago is None:
                state = 'never'
            elif minutes_ago > job['lateAfter']:
                state = 'late'
            else:
                state = 'ok'

            items.append({
                'key': job['key'],
                'title': job['title'],
                'purpose': job['purpose'],
                'marketplace': job['marketplace'],
                'everyMin': job['everyMin'],
                'lastRunAt': last.isoformat() if last else None,
                'minutesAgo': minutes_ago,
                'runsPerDay': a.get('perDay', 0),
                'lastResult': last_desc.get(job['key']),
                'state': state,
            })

        return _resp(200, {
            'items': items,
            'problems': sum(1 for i in items if i['state'] != 'ok'),
        })
    finally:
        conn.close()
