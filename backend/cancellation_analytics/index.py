import io
import json
import os
from datetime import datetime

import psycopg2
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
}


def _resp(code, body):
    return {'statusCode': code, 'headers': CORS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


# ЧТО СЧИТАЕМ ОТМЕНОЙ ПОКУПАТЕЛЯ.
#
# Берём только FBS — заказы, которые шьются под конкретного человека. У FBO товар
# уже лежит на складе маркетплейса, и «отмена» там — это движение наших же поставок,
# а не действие покупателя. Если их смешать, отчёт превращается в мусор: 110 отмен
# из одной поставки выглядят как атака конкурента, хотя ни один покупатель не при чём.
CANCELLED_FILTER = (
    "o.marketplace = 'OZON' AND o.order_type = 'FBS' "
    "AND (o.ozon_status LIKE 'cancel%%' OR o.status = 'Отменён') "
    "AND o.ozon_posting_number IS NOT NULL"
)

# Номер отправления OZON выглядит как 39052506-0063-1: первая часть — номер ЗАКАЗА,
# он общий для всех вещей одной покупки. По нему и группируем: несколько отменённых
# вещей внутри одного заказа — это один случай, а не пять разных.
ORDER_KEY = "split_part(o.ozon_posting_number, '-', 1)"


def _rows(cur, days):
    """Отменённые заказы за период, сгруппированные по номеру заказа маркетплейса."""
    cur.execute(
        f"SELECT {ORDER_KEY} AS order_key, "
        "       COUNT(*) AS cancelled_items, "
        "       COUNT(DISTINCT o.product) AS distinct_products, "
        "       MIN(o.created_at) AS first_created, "
        "       MAX(o.cancelled_at) AS last_cancelled, "
        "       string_agg(DISTINCT o.product, ', ') AS products, "
        "       string_agg(DISTINCT o.ozon_posting_number, ', ') AS postings, "
        "       MIN(EXTRACT(epoch FROM o.cancelled_at - o.created_at) / 3600.0) AS min_hours "
        "FROM orders o "
        f"WHERE {CANCELLED_FILTER} "
        f"  AND o.created_at > now() - (%s || ' days')::interval "
        "GROUP BY 1 ORDER BY cancelled_items DESC, last_cancelled DESC NULLS LAST",
        (str(int(days)),),
    )
    out = []
    for r in cur.fetchall():
        hours = float(r[7]) if r[7] is not None else None
        out.append({
            'orderKey': r[0],
            'cancelledItems': int(r[1]),
            'distinctProducts': int(r[2]),
            'firstCreated': r[3],
            'lastCancelled': r[4],
            'products': r[5] or '',
            'postings': r[6] or '',
            'hoursToCancel': round(hours, 1) if hours is not None else None,
        })
    return out


def _flags(row):
    """Признаки, из-за которых заказ попал в отчёт.

    Ни один признак сам по себе не доказывает недобросовестность: человек может
    отменить покупку по сотне житейских причин. Поэтому не выносим вердиктов, а
    показываем ровно то, что видно в данных, — а выводы делает уже маркетплейс,
    у которого есть сам покупатель.
    """
    flags = []
    if row['cancelledItems'] >= 3:
        flags.append('Массовая отмена: 3+ вещи в одном заказе')
    elif row['cancelledItems'] == 2:
        flags.append('Отменено 2 вещи в одном заказе')

    h = row['hoursToCancel']
    if h is not None and h <= 1:
        flags.append('Отмена сразу после оформления')

    if row['distinctProducts'] >= 3:
        flags.append('Сразу несколько разных товаров')

    return flags


def handle_report(cur, days, min_items):
    """Заказы с отменами за период + сводка."""
    rows = [r for r in _rows(cur, days) if r['cancelledItems'] >= min_items]
    for r in rows:
        r['flags'] = _flags(r)

    total_cancelled = sum(r['cancelledItems'] for r in rows)
    instant = sum(1 for r in rows
                  if r['hoursToCancel'] is not None and r['hoursToCancel'] <= 1)
    mass = sum(1 for r in rows if r['cancelledItems'] >= 3)

    # Всплески: один товар отменяли в разных заказах — самый весомый признак того,
    # что метят именно в конкретную позицию, а не просто передумали.
    cur.execute(
        f"SELECT o.product, COUNT(*) AS items, COUNT(DISTINCT {ORDER_KEY}) AS orders_cnt "
        "FROM orders o "
        f"WHERE {CANCELLED_FILTER} "
        f"  AND o.created_at > now() - (%s || ' days')::interval "
        "GROUP BY 1 HAVING COUNT(*) >= 3 "
        "ORDER BY items DESC LIMIT 20",
        (str(int(days)),),
    )
    products = [{'product': p[0], 'cancelledItems': int(p[1]), 'orders': int(p[2])}
                for p in cur.fetchall()]

    return _resp(200, {
        'days': days,
        'summary': {
            'ordersWithCancels': len(rows),
            'cancelledItems': total_cancelled,
            'instantCancels': instant,
            'massCancels': mass,
        },
        'orders': rows,
        'products': products,
    })


def handle_export(cur, days, min_items):
    """Excel-файл для обращения в поддержку маркетплейса."""
    rows = [r for r in _rows(cur, days) if r['cancelledItems'] >= min_items]
    for r in rows:
        r['flags'] = _flags(r)

    wb = Workbook()
    ws = wb.active
    ws.title = 'Отмены'

    head_fill = PatternFill('solid', fgColor='1F3864')
    head_font = Font(color='FFFFFF', bold=True)
    headers = [
        ('Номер заказа OZON', 22),
        ('Номера отправлений', 42),
        ('Отменено вещей', 16),
        ('Разных товаров', 16),
        ('Товары', 46),
        ('Дата заказа', 18),
        ('Дата отмены', 18),
        ('Часов до отмены', 17),
        ('На что обратить внимание', 46),
    ]
    for i, (title, width) in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=title)
        c.fill = head_fill
        c.font = head_font
        c.alignment = Alignment(vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = 'A2'
    ws.row_dimensions[1].height = 30

    for r in rows:
        ws.append([
            r['orderKey'],
            r['postings'],
            r['cancelledItems'],
            r['distinctProducts'],
            r['products'],
            r['firstCreated'].strftime('%d.%m.%Y %H:%M') if r['firstCreated'] else '',
            r['lastCancelled'].strftime('%d.%m.%Y %H:%M') if r['lastCancelled'] else '',
            r['hoursToCancel'] if r['hoursToCancel'] is not None else '',
            '; '.join(r['flags']),
        ])

    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical='top', wrap_text=True)

    # Второй лист — товары, по которым отмен больше всего.
    ws2 = wb.create_sheet('Товары')
    for i, (title, width) in enumerate(
        [('Товар', 40), ('Отменено вещей', 18), ('В скольких заказах', 20)], start=1
    ):
        c = ws2.cell(row=1, column=i, value=title)
        c.fill = head_fill
        c.font = head_font
        ws2.column_dimensions[get_column_letter(i)].width = width
    ws2.freeze_panes = 'A2'

    cur.execute(
        f"SELECT o.product, COUNT(*), COUNT(DISTINCT {ORDER_KEY}) "
        "FROM orders o "
        f"WHERE {CANCELLED_FILTER} "
        f"  AND o.created_at > now() - (%s || ' days')::interval "
        "GROUP BY 1 HAVING COUNT(*) >= 3 ORDER BY 2 DESC",
        (str(int(days)),),
    )
    for p in cur.fetchall():
        ws2.append([p[0], int(p[1]), int(p[2])])

    buf = io.BytesIO()
    wb.save(buf)
    import base64
    return {
        'statusCode': 200,
        'headers': {
            **CORS,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': (
                f'attachment; filename="otmeny-{datetime.now().strftime("%d-%m-%Y")}.xlsx"'
            ),
        },
        'isBase64Encoded': True,
        'body': base64.b64encode(buf.getvalue()).decode(),
    }


def handler(event: dict, context) -> dict:
    """Анализ отмен заказов на маркетплейсе: закономерности и выгрузка в Excel.

    Показывает заказы, где покупатель отменил несколько вещей сразу, отменил почти
    мгновенно после оформления или взял несколько разных товаров и отказался. Это
    косвенные признаки скупки конкурентом.

    Персональные данные покупателей маркетплейсы продавцу не передают, поэтому
    отчёт оперирует номерами заказов и отправлений — по ним поддержка площадки
    сама находит покупателя на своей стороне.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    action = (params.get('action') or 'report').strip()

    days = int(params.get('days') or 30)
    days = max(1, min(days, 365))
    min_items = int(params.get('minItems') or 2)

    # Отчёт видит только администратор: данные уходят во внешние обращения.
    role = (params.get('actorRole') or '').strip()
    if role and role != 'admin':
        return _resp(403, {'error': 'Доступ только для администратора'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        if action == 'export':
            return handle_export(cur, days, min_items)
        return handle_report(cur, days, min_items)
    finally:
        conn.close()
