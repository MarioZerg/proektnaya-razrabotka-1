"""Недельный отчёт менеджера маркетплейсов в PDF.

Отчёт закрывает одну неделю: сколько денег площадка перевела за товары этой
недели, сколько с них начислено менеджеру и что произошло с начислением за
время холда.

Зачем PDF. Раньше менеджер сводила отчёты сама и присылала сумму текстом —
проверить её было нечем. Документ фиксирует расчёт: видно базу, ставку,
количество вещей и все возвраты, снявшие часть начисления.
"""
import base64
import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from fonts_data import BOLD_B64, REGULAR_B64

_fonts_ready = False

MONTHS = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]


def _ensure_fonts():
    """Регистрирует шрифт с кириллицей.

    Шрифт вшит в код: встроенные шрифты PDF кириллицу не умеют, а отдельные
    файлы .ttf в развёртывание облачной функции не попадают.
    """
    global _fonts_ready
    if _fonts_ready:
        return
    pdfmetrics.registerFont(TTFont('OS', io.BytesIO(base64.b64decode(REGULAR_B64))))
    pdfmetrics.registerFont(TTFont('OS-B', io.BytesIO(base64.b64decode(BOLD_B64))))
    _fonts_ready = True


def ru_date(value) -> str:
    if not value:
        return ''
    return f'{value.day} {MONTHS[value.month - 1]} {value.year}'


def money(v) -> str:
    """Сумма с разделителями разрядов: 1 490 035,00 ₽."""
    return f'{float(v or 0):,.2f}'.replace(',', ' ').replace('.', ',') + ' ₽'


def build_weekly_report(data: dict) -> bytes:
    """Собирает PDF по одному недельному начислению.

    data: строка из manager_accruals плюс имя сотрудника и разбивка возвратов.
    """
    _ensure_fonts()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title='Отчёт по вознаграждению',
    )

    h1 = ParagraphStyle('h1', fontName='OS-B', fontSize=15, leading=19)
    normal = ParagraphStyle('n', fontName='OS', fontSize=10, leading=14)
    small = ParagraphStyle('s', fontName='OS', fontSize=8.5, leading=12,
                           textColor=colors.HexColor('#666666'))
    right_big = ParagraphStyle('rb', fontName='OS-B', fontSize=17, leading=21,
                               alignment=2)

    flow = []
    flow.append(Paragraph('Отчёт по вознаграждению менеджера', h1))
    flow.append(Spacer(1, 3 * mm))
    flow.append(Paragraph(
        f"{data['userName']} · период "
        f"{ru_date(data['periodStart'])} — {ru_date(data['periodEnd'])}",
        normal,
    ))
    flow.append(Spacer(1, 6 * mm))

    # Расчёт: от базы к сумме. Каждая строка объясняет следующую, чтобы итог
    # не приходилось принимать на веру.
    rows = [
        ['Перечислено за товары периода', money(data['baseAmount'])],
        ['Ставка вознаграждения', f"{data['percent']:.2f} %".replace('.', ',')],
        ['Начислено', money(data['amount'])],
    ]
    if data['units']:
        rows.insert(1, ['Продано вещей', f"{data['units']} шт"])
    if data.get('perUnit'):
        rows.append(['В том числе на одну вещь', money(data['perUnit'])])

    if data['returnedUnits']:
        rows.append([
            f"Возвраты покупателей ({data['returnedUnits']} шт)",
            '− ' + money(data['returnedAmount']),
        ])

    t = Table(rows, colWidths=[110 * mm, 64 * mm])
    t.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'OS'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, colors.HexColor('#DDDDDD')),
    ]))
    flow.append(t)
    flow.append(Spacer(1, 5 * mm))

    # Итог отдельным блоком: это то, ради чего документ и открывают.
    total = Table(
        [['К выплате', Paragraph(money(data['net']), right_big)]],
        colWidths=[110 * mm, 64 * mm],
    )
    total.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, 0), 'OS-B'),
        ('FONTSIZE', (0, 0), (0, 0), 12),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F4F4F2')),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    flow.append(total)
    flow.append(Spacer(1, 6 * mm))

    status_text = {
        'hold': f"На проверке до {ru_date(data['holdUntil'])}. "
                f"Если покупатель вернёт товар до этой даты, "
                f"начисление уменьшится на долю возвращённых вещей.",
        'confirmed': f"Подтверждено {ru_date(data['holdUntil'])}. "
                     f"Сумма закреплена: поздние возвраты её не уменьшают.",
        'cancelled': 'Начисление аннулировано.',
    }.get(data['status'], '')
    flow.append(Paragraph(status_text, normal))

    if data.get('cancelReason'):
        flow.append(Spacer(1, 2 * mm))
        flow.append(Paragraph(f"Причина: {data['cancelReason']}", normal))

    flow.append(Spacer(1, 8 * mm))
    flow.append(Paragraph(
        'Базой служит сумма, которую площадка перечисляет за товары периода на '
        'расчётный счёт. Комиссия площадки, логистика и услуги в базу не входят: '
        'эти деньги продавец не получает. Выплата производится 10 и 25 числа '
        'через кассу.',
        small,
    ))

    doc.build(flow)
    return buf.getvalue()
