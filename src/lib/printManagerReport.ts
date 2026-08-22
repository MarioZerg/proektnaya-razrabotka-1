import type { ManagerAccrual } from '@/lib/managerFinanceApi';

/*
 * Недельный отчёт менеджера маркетплейсов в PDF.
 *
 * Файл собирается ПРЯМО В БРАУЗЕРЕ и сразу уходит в «Загрузки». Ни на какой
 * сервер он не попадает и ссылкой не открывается: отчёт содержит суммы к
 * выплате конкретному человеку, и класть его в общедоступное хранилище нельзя.
 *
 * Библиотеки для PDF весят вместе больше 400 КБ и нужны только в момент
 * нажатия на кнопку, поэтому подгружаются лениво — как в листе закройщика.
 */

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «2026-08-24» → «24 августа 2026». */
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** «2026-08-24» → «24.08.2026» — для компактных мест. */
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

const STATUS_LABEL: Record<string, string> = {
  hold: 'на проверке',
  confirmed: 'подтверждено',
  cancelled: 'аннулировано',
};

/**
 * Вёрстка листа А4.
 *
 * Делаем именно HTML, а не рисуем текст координатами: у jsPDF нет кириллицы
 * в стандартных шрифтах, и русские буквы превращаются в мусор. Браузер же
 * рисует страницу как есть, а html2canvas снимает её картинкой.
 */
const buildHtml = (a: ManagerAccrual, employeeName: string) => {
  const net = money(a.net);

  return `
<div style="width:794px;height:1123px;padding:56px 64px;box-sizing:border-box;
            font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;">
  <div style="border-bottom:2px solid #111;padding-bottom:16px;">
    <div style="font-size:24px;font-weight:700;">Отчёт по вознаграждению</div>
    <div style="font-size:15px;color:#555;margin-top:6px;">
      Неделя ${shortDate(a.periodStart)} — ${shortDate(a.periodEnd)}
    </div>
  </div>

  <table style="width:100%;margin-top:28px;font-size:15px;border-collapse:collapse;">
    <tr>
      <td style="padding:7px 0;color:#555;width:45%;">Сотрудник</td>
      <td style="padding:7px 0;font-weight:600;">${employeeName}</td>
    </tr>
    <tr>
      <td style="padding:7px 0;color:#555;">Отчётный период</td>
      <td style="padding:7px 0;">
        ${longDate(a.periodStart)} — ${longDate(a.periodEnd)}
      </td>
    </tr>
    <tr>
      <td style="padding:7px 0;color:#555;">Площадка</td>
      <td style="padding:7px 0;">OZON</td>
    </tr>
  </table>

  <div style="margin-top:32px;font-size:17px;font-weight:700;">Расчёт вознаграждения</div>
  <table style="width:100%;margin-top:12px;font-size:15px;border-collapse:collapse;">
    <tr style="background:#f4f4f4;">
      <td style="padding:11px 12px;">
        Перечислено на расчётный счёт за период<br />
        <span style="font-size:12px;color:#666;">
          (за вычетом отмен и возвратов — их удержала площадка)
        </span>
      </td>
      <td style="padding:11px 12px;text-align:right;font-weight:600;">
        ${money(a.baseAmount)} ₽
      </td>
    </tr>
    <tr>
      <td style="padding:11px 12px;">Продано товаров</td>
      <td style="padding:11px 12px;text-align:right;">${a.units} шт</td>
    </tr>
    <tr style="background:#f4f4f4;">
      <td style="padding:11px 12px;">Ставка вознаграждения</td>
      <td style="padding:11px 12px;text-align:right;">${a.percent} %</td>
    </tr>
    ${a.perUnit != null ? `
    <tr>
      <td style="padding:11px 12px;">Приходится на одну единицу товара</td>
      <td style="padding:11px 12px;text-align:right;">${money(a.perUnit)} ₽</td>
    </tr>` : ''}
    <tr>

    <tr style="background:#111;color:#fff;">
      <td style="padding:14px 12px;font-size:17px;font-weight:700;">Итого к выплате</td>
      <td style="padding:14px 12px;text-align:right;font-size:20px;font-weight:700;">
        ${net} ₽
      </td>
    </tr>
  </table>

  <div style="margin-top:28px;font-size:15px;">
    <span style="color:#555;">Статус:</span>
    <b>${STATUS_LABEL[a.status] || a.status}</b>
    ${a.status === 'hold'
      ? `<span style="color:#555;"> · проверка до ${shortDate(a.holdUntil)}</span>`
      : ''}
  </div>

  ${a.cancelReason ? `
  <div style="margin-top:10px;padding:12px;background:#fdf0f0;border:1px solid #e8c4c4;
              font-size:14px;color:#8a1f1f;">
    Причина аннулирования: ${a.cancelReason}
  </div>` : ''}

  <div style="margin-top:36px;padding:16px;background:#f8f8f8;font-size:13px;
              color:#444;line-height:1.6;">
    Вознаграждение начисляется с суммы, фактически перечисленной площадкой
    на расчётный счёт за отчётную неделю. Комиссия площадки, логистика и услуги
    в базу расчёта не входят.<br />
    Отмены и возвраты покупателей площадка удерживает сама: они уменьшают
    сумму к перечислению того отчёта, в который попали. Вознаграждение
    считается уже с этой, итоговой суммы — дополнительных удержаний нет.<br />
    Выплата производится 10 и 25 числа через кассу.
  </div>

  <div style="position:absolute;bottom:56px;font-size:12px;color:#888;">
    Документ сформирован ${shortDate(new Date().toISOString().slice(0, 10))}
  </div>
</div>`;
};

/**
 * Собирает и СКАЧИВАЕТ отчёт за неделю.
 *
 * Возвращает управление после того, как файл ушёл в загрузки. Никаких ссылок
 * и промежуточных хранилищ: документ с суммами к выплате не должен лежать
 * там, где его можно открыть по адресу.
 */
export const printManagerReport = async (
  accrual: ManagerAccrual,
  employeeName: string,
) => {
  const { default: jsPDF } = await import('jspdf');
  const { default: html2canvas } = await import('html2canvas');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.innerHTML = buildHtml(accrual, employeeName);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(
      container.firstElementChild as HTMLElement,
      { scale: 2, backgroundColor: '#ffffff' },
    );
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
    // save() отдаёт файл напрямую в загрузки браузера.
    pdf.save(
      `Отчёт ${shortDate(accrual.periodStart)}-${shortDate(accrual.periodEnd)}.pdf`,
    );
  } finally {
    document.body.removeChild(container);
  }
};
