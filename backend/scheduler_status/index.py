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
        'purpose': 'Забирает с OZON новые заказы и ставит их на конвейер',
        'group': 'orders',
        'everyMin': 15,
        'lateAfter': 60,
    },
    {
        'key': 'wb_sync_orders',
        'title': 'WildBerries — новые заказы',
        'purpose': 'Забирает с WB новые заказы и ставит их на конвейер',
        'group': 'orders',
        'everyMin': 15,
        'lateAfter': 60,
    },
    {
        'key': 'ym_sync',
        'title': 'Яндекс Маркет — новые заказы',
        'purpose': 'Забирает с Яндекса новые заказы и ставит их на конвейер',
        'group': 'orders',
        'everyMin': 15,
        'lateAfter': 60,
    },
    # --- ОТМЕНЫ. Молчит — цех шьёт то, от чего покупатель уже отказался.
    {
        'key': 'ozon_refresh_statuses',
        'title': 'OZON — отмены и статусы',
        'purpose': 'Ловит отказы покупателей и снимает уехавшие заказы с очереди',
        'group': 'cancels',
        'everyMin': 60,
        'lateAfter': 180,
    },
    {
        'key': 'wb_check_statuses',
        'title': 'WildBerries — отмены и статусы',
        'purpose': 'Ловит отказы покупателей и закрывает уже отгруженные заказы',
        'group': 'cancels',
        'everyMin': 60,
        'lateAfter': 180,
    },
    {
        'key': 'ym_check_statuses',
        'title': 'Яндекс Маркет — отмены и статусы',
        'purpose': 'Ловит отказы покупателей до того, как вещь дойдёт до стикеровки',
        'group': 'cancels',
        'everyMin': 60,
        'lateAfter': 180,
    },
    # --- СКЛАД И ЦЕХ. Служебная работа, без которой копятся ручные разборы.
    {
        'key': 'sync',
        'title': 'Возвраты с маркетплейсов',
        'purpose': 'Тянет заявки на возврат, чтобы кладовщик забрал вещи с пункта выдачи',
        'group': 'service',
        'everyMin': 60,
        'lateAfter': 240,
    },
    {
        'key': 'ozon_split_pending',
        'title': 'OZON — разделение заказов',
        'purpose': 'Разбивает заказ из нескольких штор на отдельные задания для цеха',
        'group': 'service',
        'everyMin': 60,
        'lateAfter': 240,
    },
    {
        'key': 'shifts_auto_close',
        'title': 'Автозакрытие смен',
        'purpose': 'Закрывает смены, которые сотрудники забыли закрыть, и ставит штрафы',
        'group': 'service',
        'everyMin': 1440,
        'lateAfter': 2880,
        # Задание ночное: если сегодня все закрыли смены сами, записи может не быть.
        'optional': True,
    },
]

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

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

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
            })

        return _resp(200, {
            'items': items,
            'groups': GROUPS,
            # В тревогу считаем только реальные поломки. Задания со статусом unknown
            # (ночные, могут законно молчать) в счётчик не идут — иначе на странице
            # вечно висела бы «проблема», к которой все привыкнут и перестанут читать.
            'problems': sum(1 for i in items if i['state'] in ('late', 'never')),
        })
    finally:
        conn.close()