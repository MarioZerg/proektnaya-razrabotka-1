import type jsPDFType from 'jspdf';
import type { SupplyAwaitingItem } from '@/lib/marketplaceSuppliesApi';

/*
 * Библиотеки для PDF (jspdf, html2canvas) весят вместе больше 400 КБ и нужны ТОЛЬКО
 * в момент печати. Подгружаем их по нажатию кнопки, чтобы страница поставки
 * открывалась быстро.
 */

/**
 * Лист недостачи по поставке FBS — что НЕ попало в короб и с кого спрашивать.
 *
 * Кладовщик закрывает поставку, а часть вещей в короб так и не отсканирована. На складе
 * их нет: то ли не сшили, то ли упаковали и потеряли, то ли положили не на ту полку.
 * Разбираться приходится задним числом, опрашивая всю смену.
 *
 * Этот лист печатается перед отправкой: по каждой недостающей вещи сразу видно заказ,
 * размер, полку и ТРИ фамилии — кто кроил, кто шил, кто упаковывал, и в какой день
 * упаковали. С таким листом обход занимает минуты: идёшь к конкретным людям, а не
 * поднимаешь всю историю заказа в системе.
 *
 * Формат А4, 22 строки на лист — на большее не помещается читаемый кегль, а мельчить
 * нельзя: лист читают на ходу в цехе, а не за столом.
 */

const A4_WIDTH_PX = 794; // A4 при 96dpi
const A4_HEIGHT_PX = 1123;
const ROWS_PER_PAGE = 22;

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
};

const formatToday = () => formatDate(new Date().toISOString());

/** Фамилия и инициалы: «Некрасова Марина Николаевна» → «Некрасова М. Н.».
 * Полные ФИО в колонку не влезают, а фамилии одной мало — в цехе бывают однофамильцы. */
const shortName = (full?: string | null) => {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  const [last, ...rest] = parts;
  const initials = rest.map((p) => `${p[0].toUpperCase()}.`).join(' ');
  return initials ? `${last} ${initials}` : last;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const chunk = <T,>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const page = (inner: string) =>
  `<div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;` +
  `padding:24px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;">${inner}</div>`;

const buildPageHtml = (
  rows: SupplyAwaitingItem[],
  supplyTitle: string,
  totalCount: number,
  pageNumber: number,
  pagesTotal: number,
  startIndex: number
) => {
  const header = `
    <div style="border-bottom:3px solid #000;padding-bottom:8px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          <div style="font-size:20px;font-weight:800;">НЕ ОТСКАНИРОВАНО В ПОСТАВКУ</div>
          <div style="font-size:13px;margin-top:3px;">${escapeHtml(supplyTitle)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:26px;font-weight:800;">${totalCount} шт.</div>
          <div style="font-size:12px;">${formatToday()} · лист ${pageNumber} из ${pagesTotal}</div>
        </div>
      </div>
    </div>`;

  const th = (text: string, width: string, align = 'left') =>
    `<th style="width:${width};text-align:${align};font-size:11px;padding:4px 5px;` +
    `border-bottom:2px solid #000;">${text}</th>`;

  const td = (text: string, align = 'left', bold = false) =>
    `<td style="text-align:${align};font-size:11px;padding:5px;border-bottom:1px solid #bbb;` +
    `${bold ? 'font-weight:700;' : ''}">${text}</td>`;

  const body = rows
    .map((r, i) => {
      const size =
        r.width && r.height ? `${r.width}×${r.height}` : escapeHtml(r.product || '—');
      return `<tr>
        ${td(String(startIndex + i + 1), 'center')}
        ${td(escapeHtml(r.orderNumber || '—'), 'left', true)}
        ${td(escapeHtml(r.material || '—'))}
        ${td(size, 'center', true)}
        ${td(escapeHtml(r.shelfName || '—'))}
        ${td(escapeHtml(shortName(r.cutterName)))}
        ${td(escapeHtml(shortName(r.sewerName)))}
        ${td(escapeHtml(shortName(r.packerName)))}
        ${td(formatDate(r.packedAt), 'center')}
      </tr>`;
    })
    .join('');

  const table = `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        ${th('#', '4%', 'center')}
        ${th('Заказ', '18%')}
        ${th('Материал', '12%')}
        ${th('Размер', '10%', 'center')}
        ${th('Полка', '10%')}
        ${th('Кроил', '14%')}
        ${th('Шил', '14%')}
        ${th('Упаковал', '14%')}
        ${th('Упакован', '10%', 'center')}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  // Место для подписи: лист идёт в работу как документ разбора недостачи, и по нему
  // потом смотрят, кто именно проводил поиск и чем всё закончилось.
  const footer =
    pageNumber === pagesTotal
      ? `<div style="margin-top:18px;font-size:11px;">
           <div>Проверил (ФИО, подпись): _______________________________________</div>
           <div style="margin-top:10px;">Результат поиска: ______________________________________</div>
         </div>`
      : '';

  return page(header + table + footer);
};

const renderPageToPdf = async (pdf: jsPDFType, html: string, isFirstPage: boolean) => {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(container.firstElementChild as HTMLElement, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    if (!isFirstPage) pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
  } finally {
    document.body.removeChild(container);
  }
};

/**
 * Печатает PDF со списком вещей, не отсканированных в короб этой поставки.
 *
 * @param items      Позиции из «ждут сканирования».
 * @param supplyTitle Подпись поставки: «Поставка №1213 · OZON FBS».
 */
export const printSupplyMissingSheet = async (
  items: SupplyAwaitingItem[],
  supplyTitle: string
) => {
  if (items.length === 0) return;

  const pages = chunk(items, ROWS_PER_PAGE);
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  for (let i = 0; i < pages.length; i++) {
    await renderPageToPdf(
      pdf,
      buildPageHtml(pages[i], supplyTitle, items.length, i + 1, pages.length, i * ROWS_PER_PAGE),
      i === 0
    );
  }

  pdf.save(`nedostacha-${formatToday().replace(/\./g, '-')}.pdf`);
};
