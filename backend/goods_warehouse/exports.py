"""Склад готового товара — выгрузки складских остатков в Excel.

Три формата, и это не прихоть: универсальная книга для работы глазами, плюс
файлы СТРОГО по шаблонам OZON и WB — площадки отклоняют любое отличие в шапке.

Вынесено из index.py как есть, логика не менялась.
"""

def export_stock_ozon_xlsx(cur, ids=None):
    """Товарный состав для загрузки FBO-поставки НА OZON — строго по их шаблону.

    Файл повторяет products-import-template один в один: единственный лист «Sheet1»
    и шапка ровно из трёх колонок строчными буквами — «артикул», «имя (необязательно)»,
    «количество». Ни заголовков, ни итогов, ни лишних листов: OZON читает файл
    машинно и на любое отличие в шапке отвечает отказом загрузки. Поэтому свой
    свод (с полками, штрихкодами и подсветкой) остаётся в общем файле, а этот —
    только для площадки.

    АРТИКУЛ — ЭТО НАШ sku ПРОДАВЦА («vyal2_250»), А НЕ ЧИСЛОВОЙ ozon_sku.
    В шаблоне заявки OZON ждёт артикул, который мы САМИ задали в карточке товара в
    его кабинете. Числовой ozon_sku — это внутренний код площадки (SKU): он нужен
    для API отправлений, но в файле поставки не опознаётся, и загрузка отваливается.
    Вещи без нашего артикула в файл не попадают — заявить их нельзя; сколько таких,
    менеджер видит в общем своде по жёлтым строкам.
    """
    from openpyxl import Workbook
    import base64
    import io
    from datetime import datetime

    id_clause = ''
    if ids:
        id_clause = ' AND gw.id IN (' + ','.join(str(int(i)) for i in ids) + ')'

    # Свод по артикулу OZON: в заявку идёт «сколько штук такого товара».
    # Имя — для глаз менеджера, OZON его игнорирует (колонка необязательная).
    cur.execute(
        "SELECT mi.sku, COALESCE(mi.name, o.product), COUNT(*) "
        "FROM goods_warehouse gw "
        "JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
        "WHERE gw.status = 'in_stock' AND mi.sku IS NOT NULL "
        "  AND mi.sku <> ''" + id_clause + " "
        "GROUP BY 1, 2 ORDER BY 2"
    )
    rows = cur.fetchall()

    wb = Workbook()
    ws = wb.active
    ws.title = 'Sheet1'
    ws.append(['артикул', 'имя (необязательно)', 'количество'])
    # Ширина второй колонки — как в шаблоне: длинные названия иначе не читаются.
    ws.column_dimensions['B'].width = 30.71
    for sku, name, qty in rows:
        ws.append([sku, name or '', int(qty)])

    buf = io.BytesIO()
    wb.save(buf)
    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': (
                f'attachment; filename="ozon-fbo-'
                f'{datetime.now().strftime("%d-%m-%Y")}.xlsx"'
            ),
        },
        'isBase64Encoded': True,
        'body': base64.b64encode(buf.getvalue()).decode(),
    }


def export_stock_wb_xlsx(cur, ids=None):
    """Товарный состав для загрузки FBO-поставки НА WILDBERRIES — строго по их шаблону.

    Шаблон WB короче ozon-овского: единственный лист «Sheet1» и две колонки —
    «Баркод» и «Количество». Никакого названия товара: WB опознаёт позицию только
    по баркоду. Как и у OZON, файл читается машинно, поэтому ни заголовков, ни
    итогов, ни лишних колонок здесь быть не должно.

    БАРКОД — это wb_sku (13 цифр, «2038648306466»), а НЕ артикул продавца и не
    nm_id. Именно баркод печатается на стикере вещи и сканируется на приёмке WB.
    Вещи без баркода в файл не попадают: заявить их нельзя.
    """
    from openpyxl import Workbook
    import base64
    import io
    from datetime import datetime

    id_clause = ''
    if ids:
        id_clause = ' AND gw.id IN (' + ','.join(str(int(i)) for i in ids) + ')'

    cur.execute(
        "SELECT mi.wb_sku, COUNT(*) "
        "FROM goods_warehouse gw "
        "JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
        "WHERE gw.status = 'in_stock' AND mi.wb_sku IS NOT NULL "
        "  AND mi.wb_sku <> ''" + id_clause + " "
        "GROUP BY 1 ORDER BY 1"
    )
    rows = cur.fetchall()

    wb = Workbook()
    ws = wb.active
    ws.title = 'Sheet1'
    ws.append(['Баркод', 'Количество'])
    for wb_sku, qty in rows:
        # Баркод отдаём ТЕКСТОМ. Числом Excel показал бы его как 2,03865E+12 и
        # обрезал бы значащие цифры — на приёмке такой файл не читается.
        ws.append([str(wb_sku), int(qty)])

    buf = io.BytesIO()
    wb.save(buf)
    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': (
                f'attachment; filename="wb-fbo-'
                f'{datetime.now().strftime("%d-%m-%Y")}.xlsx"'
            ),
        },
        'isBase64Encoded': True,
        'body': base64.b64encode(buf.getvalue()).decode(),
    }


def export_stock_xlsx(cur, marketplace, ids=None):
    """Товарный состав склада «На хранении» в Excel — для загрузки FBO-поставки.

    ids — список id вещей, отмеченных менеджером галочками. Если он передан, в книгу
    попадают ТОЛЬКО они: менеджер отбирает нужные размеры на складе и увозит в поставку
    не весь остаток, а то, что решил забрать. Без ids выгружается весь свободный остаток
    (прежнее поведение).

    ОДИН ФАЙЛ НА ОБЕ ПЛОЩАДКИ. У OZON и WB шаблоны заявки разные, но обе читают
    одно и то же: артикул и количество. Поэтому книга собрана так, чтобы годиться
    и туда, и туда:
      * лист «Товарный состав» — свод по товару (артикул OZON, артикул WB,
        штрихкод, название, размер и КОЛИЧЕСТВО). Именно его менеджер копирует
        в шаблон площадки: колонки уже сведены, руками считать нечего;
      * лист «OZON» и лист «WB» — по две колонки «артикул + количество» в том
        порядке, в каком их ждёт площадка. Вставляется без правки.
      * лист «Позиции» — расшифровка: каждая вещь со стикером хранения и полкой.
        Нужен кладовщику, когда состав утверждён и товар надо собрать с полок.

    Считаем ТОЛЬКО статус in_stock: это свободный остаток на полках. Вещи в сборке,
    в резерве и уже уехавшие в поставку сюда не попадают — иначе менеджер заявит
    товар, которого физически нет, и приёмка на складе площадки не сойдётся.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    import base64
    import io
    from datetime import datetime

    mp = (marketplace or '').strip().upper()

    # Отбор менеджера. Пустой список отличаем от «не передавали»: ids=[] означало бы
    # «ничего не выбрано» — такой файл собирать бессмысленно, поэтому его отсекаем выше,
    # в обработчике запроса.
    #
    # Даже при отборе оставляем условие status='in_stock': пока менеджер набирал
    # галочки, вещь могла уйти в сборку или в чужую поставку. Заявить её нельзя —
    # физически она уже занята.
    id_clause = ''
    if ids:
        id_clause = ' AND gw.id IN (' + ','.join(str(int(i)) for i in ids) + ')'

    # Свод по КАРТОЧКЕ ТОВАРА, а не по вещам: в заявку площадки идёт артикул и
    # количество. Вещи без привязки к карточке собираем отдельной строкой — у них
    # нет артикула, и заявить их нельзя, пока товар не привязан.
    cur.execute(
        "SELECT mi.ozon_sku, mi.wb_sku, mi.barcode, "
        "       COALESCE(mi.name, o.product), "
        "       COALESCE(mi.material, o.material), "
        "       COALESCE(mi.width, o.width), COALESCE(mi.height, o.height), "
        "       COUNT(*) "
        "FROM goods_warehouse gw "
        "JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
        "WHERE gw.status = 'in_stock'" + id_clause + " "
        "GROUP BY 1, 2, 3, 4, 5, 6, 7 "
        "ORDER BY 4, 6, 7"
    )
    rows = cur.fetchall()

    wb = Workbook()
    head_font = Font(bold=True, color='FFFFFF')
    head_fill = PatternFill('solid', fgColor='2F5597')
    warn_fill = PatternFill('solid', fgColor='FFF2CC')

    def style_head(ws, widths):
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for cell in ws[1]:
            cell.font = head_font
            cell.fill = head_fill
            cell.alignment = Alignment(horizontal='center', vertical='center')
        ws.freeze_panes = 'A2'

    # ЛИСТ 1 — свод по товару.
    ws = wb.active
    ws.title = 'Товарный состав'
    ws.append([
        'Артикул OZON', 'Артикул WB', 'Штрихкод', 'Товар',
        'Материал', 'Ширина', 'Высота', 'Количество',
    ])
    total = 0
    no_sku_total = 0
    for r in rows:
        ozon_sku, wb_sku, barcode, name, material, width, height, qty = r
        qty = int(qty)
        total += qty
        ws.append([
            ozon_sku or '', wb_sku or '', barcode or '', name or '',
            material or '', width or '', height or '', qty,
        ])
        # Товар без артикулов заявить нельзя — подсвечиваем строку, чтобы менеджер
        # увидел это ДО загрузки на площадку, а не при отказе приёмки.
        if not ozon_sku and not wb_sku:
            no_sku_total += qty
            for cell in ws[ws.max_row]:
                cell.fill = warn_fill
    style_head(ws, [16, 16, 18, 46, 16, 10, 10, 13])

    ws.append([])
    ws.append(['', '', '', 'ИТОГО штук на хранении', '', '', '', total])
    ws[f'D{ws.max_row}'].font = Font(bold=True)
    ws[f'H{ws.max_row}'].font = Font(bold=True)
    if no_sku_total:
        ws.append([
            '', '', '',
            f'Из них без артикула (жёлтые строки) — заявить нельзя: {no_sku_total} шт. '
            f'Привяжите товар в справочнике «Товары на маркетплейсе»',
        ])
        ws[f'D{ws.max_row}'].font = Font(bold=True, color='BF8F00')

    # ЛИСТЫ 2 и 3 — готовые к вставке пары «артикул + количество».
    # Строки без артикула пропускаем: площадка их всё равно не примет, а лишняя
    # пустая строка ломает загрузку шаблона.
    for sheet_name, idx in (('OZON', 0), ('WB', 1)):
        if mp and mp != sheet_name:
            continue
        wsx = wb.create_sheet(sheet_name)
        wsx.append([f'Артикул {sheet_name}', 'Количество'])
        for r in rows:
            sku = r[idx]
            if not sku:
                continue
            wsx.append([sku, int(r[7])])
        style_head(wsx, [24, 14])

    # ЛИСТ 4 — расшифровка по вещам: с чем идти к полкам.
    cur.execute(
        "SELECT gw.storage_barcode, COALESCE(sh.name, '— без полки —'), "
        "       COALESCE(mi.name, o.product), "
        "       COALESCE(mi.material, o.material), "
        "       COALESCE(mi.width, o.width), COALESCE(mi.height, o.height), "
        "       mi.ozon_sku, mi.wb_sku, gw.received_at "
        "FROM goods_warehouse gw "
        "JOIN orders o ON o.id = gw.order_id "
        "LEFT JOIN marketplace_items mi ON mi.id = o.marketplace_item_id "
        "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
        "WHERE gw.status = 'in_stock'" + id_clause + " "
        "ORDER BY COALESCE(sh.name, 'яя'), COALESCE(mi.name, o.product)"
    )
    ws2 = wb.create_sheet('Позиции')
    ws2.append([
        'Стикер хранения', 'Полка', 'Товар', 'Материал',
        'Ширина', 'Высота', 'Артикул OZON', 'Артикул WB', 'На складе с',
    ])
    for r in cur.fetchall():
        ws2.append([
            r[0], r[1], r[2] or '', r[3] or '', r[4] or '', r[5] or '',
            r[6] or '', r[7] or '',
            r[8].strftime('%d.%m.%Y') if r[8] else '',
        ])
    style_head(ws2, [18, 20, 44, 16, 10, 10, 16, 16, 14])

    buf = io.BytesIO()
    wb.save(buf)
    suffix = f'-{mp.lower()}' if mp else ''
    # Отбор и полный остаток называем по-разному: у менеджера в загрузках лежит
    # несколько файлов за день, и по имени должно быть видно, что в нём.
    if ids:
        suffix += '-otbor'
    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': (
                f'attachment; filename="sklad-fbo{suffix}-'
                f'{datetime.now().strftime("%d-%m-%Y")}.xlsx"'
            ),
        },
        'isBase64Encoded': True,
        'body': base64.b64encode(buf.getvalue()).decode(),
    }

