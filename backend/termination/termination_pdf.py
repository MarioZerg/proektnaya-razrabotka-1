"""Акт о расторжении договора возмездного оказания услуг.

Документ подписывает сотрудник, когда решил прекратить работу. Он опирается на
раздел 5 самого договора и НЕ добавляет условий, которых там нет: Акт — это
фиксация отказа от исполнения, а не новое соглашение.

Что важно юридически и почему сделано именно так:

  · дата прекращения — ровно через 14 дней с подачи (п. 5.2 договора). Раньше
    система заявление не принимает, поэтому в Акте нет и речи о нарушении
    срока: п. 5.5 с расчётом частями не применяется;
  · перечислены обязанности Исполнителя на период уведомления (п. 5.3): сдать
    работу и вернуть материалы — иначе Акт освобождал бы от того, от чего
    договор не освобождает;
  · прямо сказано, что закрытие доступа не прекращает денежных обязательств
    Заказчика (п. 5.7). Без этой оговорки документ выглядел бы как отказ
    сотрудника от заработанного, а это ничтожное условие;
  · подпись — код из MAX, с теми же реквизитами (время, телефон, адрес), что и
    у договора: документ о расторжении не должен быть слабее подписываемого.
"""
import base64
import io
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageTemplate, Paragraph, Spacer,
    Table, TableStyle,
)

import templates as T
from fonts_data import BOLD_B64, REGULAR_B64

MONTHS = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

_fonts_ready = False


def _ensure_fonts():
    global _fonts_ready
    if _fonts_ready:
        return
    pdfmetrics.registerFont(TTFont('OS', io.BytesIO(base64.b64decode(REGULAR_B64))))
    pdfmetrics.registerFont(TTFont('OS-B', io.BytesIO(base64.b64decode(BOLD_B64))))
    _fonts_ready = True


def ru_date(value) -> str:
    if not value:
        return '____________'
    return f'{value.day} {MONTHS[value.month - 1]} {value.year} г.'


def dash(value) -> str:
    return str(value).strip() if value and str(value).strip() else '—'


def build_termination_pdf(path: str, emp: dict, company: dict, role: str,
                          termination_date, contract_number=None,
                          contract_date=None, reason=None) -> None:
    """Собирает Акт о расторжении в файл path.

    Args:
        path: куда сохранить PDF
        emp: данные сотрудника — те же, что в договоре
        company: реквизиты ИП
        role: должность, от неё зависит название услуг
        termination_date: дата прекращения (подача + 14 дней)
        contract_number: номер расторгаемого договора
        contract_date: когда договор был подписан
        reason: причина со слов сотрудника, необязательна
    """
    _ensure_fonts()

    body = ParagraphStyle('body', fontName='OS', fontSize=9, leading=13,
                          alignment=TA_JUSTIFY, spaceAfter=4)
    h1 = ParagraphStyle('h1', fontName='OS-B', fontSize=12.5, leading=16,
                        alignment=TA_CENTER, spaceAfter=2)
    sub = ParagraphStyle('sub', fontName='OS', fontSize=9, leading=12,
                         alignment=TA_CENTER, textColor=colors.HexColor('#555555'),
                         spaceAfter=10)
    h2 = ParagraphStyle('h2', fontName='OS-B', fontSize=10, leading=14,
                        spaceBefore=9, spaceAfter=4)
    small = ParagraphStyle('small', fontName='OS', fontSize=7.5, leading=10,
                           textColor=colors.HexColor('#666666'))

    story = []
    A = story.append
    today = date.today()
    number = contract_number or '____'
    services = T.ROLE_TITLES.get(role, '')

    A(Paragraph('АКТ О РАСТОРЖЕНИИ ДОГОВОРА<br/>ВОЗМЕЗДНОГО ОКАЗАНИЯ УСЛУГ '
                f'{services.upper()}', h1))
    A(Paragraph(f'к договору №&nbsp;{number}'
                + (f' от {ru_date(contract_date)}' if contract_date else ''), sub))
    A(Paragraph(f'г.&nbsp;{dash(company.get("city"))}&nbsp;&nbsp;&nbsp;&nbsp;'
                f'{ru_date(today)}', sub))

    passport = f'{dash(emp.get("passportSeries"))} {dash(emp.get("passportNumber"))}'
    A(Paragraph(
        f'Индивидуальный предприниматель <b>{dash(company.get("name"))}</b>, '
        f'ОГРНИП <b>{dash(company.get("ogrnip"))}</b>, ИНН <b>{dash(company.get("inn"))}</b>, '
        f'именуемый в дальнейшем «Заказчик», с одной стороны, и гражданин(ка) РФ '
        f'<b>{dash(emp.get("fullName"))}</b>, паспорт <b>{passport}</b>, '
        f'именуемый(ая) в дальнейшем «Исполнитель», с другой стороны, составили '
        f'настоящий Акт о нижеследующем.', body))

    A(Paragraph('1. ОСНОВАНИЕ И ДАТА ПРЕКРАЩЕНИЯ', h2))
    A(Paragraph(
        f'1.1. Исполнитель заявляет об отказе от исполнения договора возмездного '
        f'оказания услуг №&nbsp;{number}'
        + (f' от {ru_date(contract_date)}' if contract_date else '')
        + ' (далее — Договор) на основании пункта 5.2 Договора и статьи 782 '
          'Гражданского кодекса Российской Федерации.', body))
    A(Paragraph(
        f'1.2. Заявление подано Исполнителем {ru_date(today)} через Систему. '
        f'В соответствии с пунктом 5.2 Договора уведомление через Систему '
        f'приравнивается к письменному.', body))
    A(Paragraph(
        f'1.3. Договор прекращает действие <b>{ru_date(termination_date)}</b> — по '
        f'истечении 14 (четырнадцати) календарных дней со дня уведомления. Срок '
        f'предупреждения, установленный пунктом 5.2 Договора, Исполнителем '
        f'соблюдён.', body))
    if reason:
        A(Paragraph(f'1.4. Причина, указанная Исполнителем: {dash(reason)}.', body))

    A(Paragraph('2. ОБЯЗАННОСТИ СТОРОН ДО ДАТЫ ПРЕКРАЩЕНИЯ', h2))
    A(Paragraph(
        '2.1. В соответствии с пунктом 5.3 Договора Исполнитель обязуется до даты '
        'прекращения завершить принятые в работу задания и возвратить Заказчику '
        'материалы, оборудование и иные принадлежащие Заказчику ценности.', body))
    A(Paragraph(
        '2.2. Услуги, оказанные Исполнителем в период до даты прекращения, '
        'оплачиваются на общих основаниях в сроки, установленные пунктом 4.2 '
        'Договора.', body))
    A(Paragraph(
        '2.3. Стороны подтверждают, что настоящий Акт не изменяет условий Договора '
        'о качестве услуг, гарантийном сроке и порядке возмещения ущерба. '
        'Обязательства, возникшие до даты прекращения, сохраняют силу.', body))

    A(KeepTogether([
        Paragraph('3. РАСЧЁТЫ И ДОСТУП В СИСТЕМУ', h2),
        Paragraph(
            '3.1. Прекращение Договора не является отказом Заказчика от денежных '
            'обязательств. Вознаграждение за фактически оказанные Исполнителем '
            'услуги выплачивается в полном объёме в сроки, предусмотренные '
            'пунктом 4.2 Договора, на реквизиты, указанные Исполнителем.', body),
        Paragraph(
            '3.2. Из суммы вознаграждения могут быть удержаны суммы, основания для '
            'которых возникли до даты прекращения, в случаях и в порядке, '
            'предусмотренных пунктом 4.5 Договора. Иных удержаний в связи с самим '
            'фактом расторжения Договора не производится.', body),
        Paragraph(
            '3.3. Доступ Исполнителя в Систему прекращается в дату, указанную в '
            'пункте 1.3 настоящего Акта. В соответствии с пунктом 5.7 Договора '
            'прекращение доступа является технической мерой защиты сведений о '
            'заказах и товарно-материальных ценностях и не влияет на право '
            'Исполнителя получить причитающееся вознаграждение.', body),
        Paragraph(
            '3.4. Учётная запись Исполнителя в Системе сохраняется. Сведения о '
            'выполненных работах и произведённых начислениях остаются доступными '
            'Заказчику для завершения расчётов.', body),
    ]))

    A(Paragraph('4. ЗАЯВЛЕНИЯ СТОРОН', h2))
    A(Paragraph(
        '4.1. Исполнитель подтверждает, что ознакомлен с разделом 5 Договора, '
        'понимает порядок прекращения и условия окончательного расчёта и согласен '
        'с ними.', body))
    A(Paragraph(
        '4.2. Исполнитель подтверждает, что расторжение Договора является его '
        'добровольным волеизъявлением и совершено без принуждения.', body))
    A(Paragraph(
        '4.3. Стороны подтверждают отсутствие взаимных претензий, за исключением '
        'обязательств, прямо названных в настоящем Акте: обязанности Исполнителя '
        'по пункту 2.1 и обязанности Заказчика по расчётам согласно пункту 3.1.',
        body))
    A(Paragraph(
        '4.4. Настоящий Акт составлен в электронной форме и подписан Исполнителем '
        'одноразовым кодом, направленным в мессенджер MAX. В соответствии с '
        'пунктом 2.7 Договора, статьёй 160 Гражданского кодекса Российской '
        'Федерации и статьёй 6 Федерального закона от 06.04.2011 №&nbsp;63-ФЗ '
        'такая подпись признаётся простой электронной подписью и равнозначна '
        'собственноручной.', body))

    A(Spacer(1, 8))
    A(Paragraph('5. РЕКВИЗИТЫ И ПОДПИСИ СТОРОН', h2))

    cell = ParagraphStyle('cell', fontName='OS', fontSize=8.5, leading=12)
    left = [
        Paragraph('<b>ЗАКАЗЧИК</b>', cell),
        Paragraph(f'ИП {dash(company.get("name"))}', cell),
        Paragraph(f'ОГРНИП {dash(company.get("ogrnip"))}', cell),
        Paragraph(f'ИНН {dash(company.get("inn"))}', cell),
        Paragraph(f'{dash(company.get("address"))}', cell),
        Paragraph(f'Тел. {dash(company.get("phone"))}', cell),
    ]
    right = [
        Paragraph('<b>ИСПОЛНИТЕЛЬ</b>', cell),
        Paragraph(f'{dash(emp.get("fullName"))}', cell),
        Paragraph(f'Паспорт {passport}', cell),
        Paragraph(f'{dash(emp.get("registrationAddress"))}', cell),
        Paragraph(f'СНИЛС {dash(emp.get("snils"))}', cell),
        Paragraph(f'Тел. {dash(emp.get("sbpPhone"))}', cell),
    ]
    rows = [[left[i] if i < len(left) else '', right[i] if i < len(right) else '']
            for i in range(max(len(left), len(right)))]
    t = Table(rows, colWidths=[85 * mm, 85 * mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
    ]))
    A(t)

    A(Spacer(1, 10))
    A(Paragraph(
        'Отметка о подписании проставляется Системой автоматически в момент ввода '
        'Исполнителем одноразового кода и содержит дату, время, номер телефона и '
        'IP-адрес.', small))

    doc = BaseDocTemplate(path, pagesize=A4,
                          leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=20 * mm, bottomMargin=20 * mm,
                          title='Акт о расторжении договора')
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='n')
    doc.addPageTemplates([PageTemplate(id='all', frames=[frame])])
    doc.build(story)
