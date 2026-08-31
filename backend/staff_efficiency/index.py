import json
import os
from datetime import datetime, timedelta
from decimal import Decimal

import psycopg2

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
}


def _json(value):
    """Даты и Decimal из БД в JSON сами не сериализуются."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return str(value)


def _resp(code, body):
    return {
        'statusCode': code,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'isBase64Encoded': False,
        'body': json.dumps(body, ensure_ascii=False, default=_json),
    }


# Возврат возврату рознь. «Покупатель передумал» и «нашёл дешевле» — это про
# площадку и цену, швея на такое не влияет никак. А брак, повреждение и не тот
# товар — уже вопрос к производству. Смешивать их в одну цифру нельзя: иначе
# лучшая швея с самым большим объёмом всегда будет выглядеть худшей по возвратам.
#
# Проценты удвоены (%%) намеренно: строка идёт в запрос с параметрами, а там
# одиночный % psycopg2 принимает за подстановку значения и падает.
PRODUCTION_FAULT = (
    "(r.return_reason ILIKE '%%брак%%' OR r.return_reason ILIKE '%%качеств%%' "
    " OR r.return_reason ILIKE '%%поврежд%%' OR r.return_reason ILIKE '%%не работает%%' "
    " OR r.return_reason ILIKE '%%комплектац%%' OR r.return_reason ILIKE '%%не те товары%%' "
    " OR r.return_reason ILIKE '%%не тот товар%%')"
)

# Заказ, взятый в конце смены и сданный утром, даёт «время пошива» в 12 часов —
# это не работа, а ночь между сменами. Такие хвосты выбрасываем из расчёта темпа,
# иначе одна забытая вещь портит среднее по человеку за весь месяц.
MAX_TASK_MINUTES = 240


def _rows(cur):
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def sewers(cur, date_from, date_to):
    """Швеи: сколько сшито, метраж и сколько времени уходит на одну вещь.

    Время считаем от «взяла в работу» (taken_at) до «сдала на стикеровку»
    (sewn_at) — ровно то, что просили: взяли и скинули. Берём медиану, а не
    среднее: одна вещь, забытая на столе до утра, среднее задирает вдвое,
    медиана же показывает типичный темп.
    """
    cur.execute(
        """
        SELECT u.id AS "userId",
               u.full_name AS "userName",
               NULLIF(COALESCE(u.avatar_url, u.max_avatar_url), '') AS "avatarUrl",
               count(*) AS items,
               COALESCE(round(sum(o.width) / 100.0, 1), 0) AS meters,
               round(percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM (o.sewn_at - o.taken_at)) / 60
               )::numeric, 1) AS "medianMinutes",
               count(DISTINCT o.sewn_at::date) AS "workDays"
        FROM orders o
        JOIN users u ON u.id = o.sewer_user_id
        WHERE o.sewn_at >= %s AND o.sewn_at < %s
          AND o.taken_at IS NOT NULL
          AND o.sewn_at > o.taken_at
          AND EXTRACT(EPOCH FROM (o.sewn_at - o.taken_at)) / 60 <= %s
          AND COALESCE(o.status, '') <> 'Отменён'
        GROUP BY u.id, u.full_name, "avatarUrl"
        ORDER BY items DESC
        """,
        (date_from, date_to, MAX_TASK_MINUTES),
    )
    return _rows(cur)


def cutters(cur, date_from, date_to):
    """Закройщики: сколько раскроено и с каким темпом.

    Закройщик берёт стопку и отмечает её одним заходом: 86% отметок идут подряд
    с разрывом меньше минуты. Поэтому «время между двумя соседними заказами» —
    не темп, а скорость сканирования, и меряет она не ту работу.

    Считаем так, как работа идёт на самом деле: отметки, идущие подряд, собираем
    в одну пачку (пауза больше 20 минут — началась новая). Реальное время на
    пачку — это интервал от сдачи предыдущей до сдачи текущей: пока закройщик
    режет стопку, система молчит, а в конце получает все отметки разом. Делим
    этот интервал на число вещей в пачке — выходят честные минуты на вещь.
    """
    cur.execute(
        """
        WITH marked AS (
            SELECT o.cutter_user_id AS uid,
                   o.cut_at,
                   o.width,
                   CASE WHEN EXTRACT(EPOCH FROM (
                            o.cut_at - lag(o.cut_at) OVER (
                                PARTITION BY o.cutter_user_id ORDER BY o.cut_at
                            )
                        )) / 60 > 20 THEN 1 ELSE 0 END AS is_new
            FROM orders o
            WHERE o.cut_at >= %s AND o.cut_at < %s
              AND o.cutter_user_id IS NOT NULL
              AND COALESCE(o.status, '') <> 'Отменён'
        ),
        sessions AS (
            SELECT uid, cut_at, width,
                   sum(is_new) OVER (PARTITION BY uid ORDER BY cut_at
                                     ROWS UNBOUNDED PRECEDING) AS session_id
            FROM marked
        ),
        per_session AS (
            SELECT uid, session_id,
                   count(*) AS cnt,
                   max(cut_at) AS finished_at
            FROM sessions
            GROUP BY uid, session_id
        ),
        paced AS (
            -- Время на пачку = сколько прошло с момента сдачи предыдущей.
            -- Ночь между сменами и обеденные простои (>4 часов) отбрасываем.
            SELECT uid, cnt,
                   EXTRACT(EPOCH FROM (
                       finished_at - lag(finished_at) OVER (
                           PARTITION BY uid, finished_at::date ORDER BY finished_at
                       )
                   )) / 60 AS minutes
            FROM per_session
        )
        SELECT u.id AS "userId",
               u.full_name AS "userName",
               NULLIF(COALESCE(u.avatar_url, u.max_avatar_url), '') AS "avatarUrl",
               (SELECT count(*) FROM sessions s WHERE s.uid = u.id) AS items,
               COALESCE((SELECT round(sum(s.width) / 100.0, 1)
                         FROM sessions s WHERE s.uid = u.id), 0) AS meters,
               round(percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY p.minutes / p.cnt
               )::numeric, 1) AS "medianMinutes",
               (SELECT count(DISTINCT s.cut_at::date)
                FROM sessions s WHERE s.uid = u.id) AS "workDays"
        FROM paced p
        JOIN users u ON u.id = p.uid
        WHERE p.minutes IS NOT NULL AND p.minutes BETWEEN 0 AND 240
        GROUP BY u.id, u.full_name, "avatarUrl"
        ORDER BY items DESC
        """,
        (date_from, date_to),
    )
    return _rows(cur)


def packers(cur, date_from, date_to):
    """Упаковщики: сколько вещей упаковано.

    Время на единицу здесь не считаем: упаковщик работает партиями, и отметка
    ставится на всю пачку сразу — «минуты на вещь» получились бы выдуманными.
    По просьбе: упаковщица во временном зачёте не участвует.
    """
    cur.execute(
        """
        SELECT u.id AS "userId",
               u.full_name AS "userName",
               NULLIF(COALESCE(u.avatar_url, u.max_avatar_url), '') AS "avatarUrl",
               count(*) AS items,
               COALESCE(round(sum(o.width) / 100.0, 1), 0) AS meters,
               NULL::numeric AS "medianMinutes",
               count(DISTINCT o.packed_at::date) AS "workDays"
        FROM orders o
        JOIN users u ON u.id = o.packer_user_id
        WHERE o.packed_at >= %s AND o.packed_at < %s
          AND COALESCE(o.status, '') <> 'Отменён'
        GROUP BY u.id, u.full_name, "avatarUrl"
        ORDER BY items DESC
        """,
        (date_from, date_to),
    )
    return _rows(cur)


def returns_by_person(cur, date_from, date_to, column):
    """Возвраты, привязанные к конкретному сотруднику через заказ.

    Считаем отдельно «вина производства» и «решение покупателя»: спрашивать с
    швеи за то, что покупатель передумал, — несправедливо и demotivирует.
    """
    cur.execute(
        f"""
        SELECT o.{column} AS "userId",
               count(*) AS "returnsTotal",
               count(*) FILTER (WHERE {PRODUCTION_FAULT}) AS "returnsFault"
        FROM marketplace_returns r
        JOIN orders o ON o.id = r.order_id
        WHERE r.mp_created_at >= %s AND r.mp_created_at < %s
          AND o.{column} IS NOT NULL
        GROUP BY o.{column}
        """,
        (date_from, date_to),
    )
    return {r['userId']: r for r in _rows(cur)}


def reasons(cur, date_from, date_to):
    """Причины возвратов за период — общей картиной по компании.

    Показываем, чтобы было видно главное: подавляющая часть возвратов приходит
    не из цеха, а от покупателя, который передумал.
    """
    cur.execute(
        f"""
        SELECT COALESCE(NULLIF(r.return_reason, ''), 'Причина не указана') AS reason,
               count(*) AS count,
               bool_or({PRODUCTION_FAULT}) AS "isFault"
        FROM marketplace_returns r
        WHERE r.mp_created_at >= %s AND r.mp_created_at < %s
        GROUP BY reason
        ORDER BY count DESC
        LIMIT 12
        """,
        (date_from, date_to),
    )
    rows = _rows(cur)
    # Длинный отзыв покупателя иногда попадает в поле причины целиком — в списке
    # он растянул бы карточку на пол-экрана.
    for r in rows:
        if len(r['reason']) > 90:
            r['reason'] = r['reason'][:87].rstrip() + '…'
    return rows


def handler(event: dict, context) -> dict:
    """Эффективность сотрудников: выработка, темп и возвраты по каждому.

    Данные считаются на лету по журналу заказов, поэтому цифры всегда свежие —
    отдельного ночного пересчёта не требуется.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': {**CORS, 'Access-Control-Max-Age': '86400'}, 'body': ''}

    params = event.get('queryStringParameters') or {}
    days = max(1, min(int(params.get('days') or 30), 365))

    date_to = datetime.now() + timedelta(days=1)
    date_from = datetime.now() - timedelta(days=days)

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()

        groups = {
            'sewers': (sewers(cur, date_from, date_to), 'sewer_user_id'),
            'cutters': (cutters(cur, date_from, date_to), 'cutter_user_id'),
            'packers': (packers(cur, date_from, date_to), 'packer_user_id'),
        }

        result = {}
        for name, (rows, column) in groups.items():
            ret = returns_by_person(cur, date_from, date_to, column)
            for row in rows:
                info = ret.get(row['userId'], {})
                row['returnsTotal'] = info.get('returnsTotal', 0)
                row['returnsFault'] = info.get('returnsFault', 0)
                # Доля брака от собственной выработки: у кого объём больше, у того
                # и возвратов больше — сравнивать людей можно только в процентах.
                row['faultRate'] = (
                    round(row['returnsFault'] * 100.0 / row['items'], 2) if row['items'] else 0
                )
                # Сколько вещей в день: ровняет тех, кто работал полмесяца, с теми,
                # кто отработал весь период.
                row['perDay'] = (
                    round(row['items'] / row['workDays'], 1) if row.get('workDays') else 0
                )
            result[name] = rows

        result['reasons'] = reasons(cur, date_from, date_to)
        result['days'] = days
        result['updatedAt'] = datetime.now().isoformat()
        return _resp(200, result)
    finally:
        conn.close()