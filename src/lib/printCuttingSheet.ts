import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import QRCode from 'qrcode';
import type { TakenOrder } from '@/lib/ordersApi';

/**
 * Печать "листа закройщика" по взятому стеку заказов — генерирует один PDF-файл из
 * ДВУХ документов подряд:
 *   1) чек-лист для закройщика (материал+размер крупно, маркетплейс+номер заказа мелко,
 *      пустой квадратик справа для галочки) — закройщик отмечает раскроенные позиции
 *   2) лист с QR-кодами под нарезку — те же позиции, но с QR-кодом (зашит номер заказа
 *      как есть) вместо квадратика; лист режется на отдельные бирки и крепится к ткани
 * Заказы группируются по материалу (одинаковый материал идёт подряд без разрыва), чтобы
 * закройщик раскраивал одним куском ткани не переключаясь между рулонами.
 */

const A4_WIDTH_PX = 794; // A4 при 96dpi
const A4_HEIGHT_PX = 1123;
const COLS = 2;
const ROWS_PER_PAGE = 10;
const ITEMS_PER_PAGE = COLS * ROWS_PER_PAGE;

const formatToday = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

/** Группирует заказы по материалу, сохраняя порядок первого появления материала. Внутри
 * материала вещи одной связки Яндекса идут подряд и по порядку — их вешают на одну вешалку,
 * поэтому в листе они не должны перемешиваться с другими заказами. */
const groupByMaterial = (orders: TakenOrder[]): TakenOrder[] => {
  const groups = new Map<string, TakenOrder[]>();
  for (const o of orders) {
    const key = o.material || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const ga = a.groupKey || '';
      const gb = b.groupKey || '';
      if (ga !== gb) return ga.localeCompare(gb);
      return (a.groupPosition || 0) - (b.groupPosition || 0);
    });
  }
  return Array.from(groups.values()).flat();
};

/** Подпись связки в позиции листа: «СВЯЗКА 3/32 — одна вешалка». */
const groupNote = (o: TakenOrder) =>
  o.groupSize && o.groupSize > 1
    ? `<div style="margin-top:3px;font-size:11px;font-weight:700;">
         СВЯЗКА ${o.groupPosition}/${o.groupSize} — НА ОДНУ ВЕШАЛКУ
       </div>`
    : '';

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
};

const sizeLabel = (o: TakenOrder) => `${o.material || '—'} ${o.width ?? '—'} × ${o.height ?? '—'}`;

// Ячейка одной позиции: слева крупно материал+размер и мелко маркетплейс+номер (+ID закройщика
// на QR-листе), справа узкая колонка (пустая — под галочку/крепление бирки), как в образце.
/** Ячейка одной позиции. Вещи связки выделяем жирной рамкой и серой заливкой: на листе
 * из 20 позиций закройщик должен видеть их с одного взгляда, а не вычитывать подписи. */
const cell = (inner: string, isGroup = false) =>
  `<div style="display:grid;grid-template-columns:1fr 44px;border:${
    isGroup ? '3px solid #000' : '1px solid #000'
  };box-sizing:border-box;${isGroup ? 'background:#e8e8e8;' : ''}">
     ${inner}
     <div style="border-left:1px solid #000;"></div>
   </div>`;

/** Сетка позиций, сгруппированная по материалу: между группами материала — визуальный отступ. */
const groupedGrid = (pageOrders: TakenOrder[], renderInner: (o: TakenOrder) => string) => {
  const blocks: string[] = [];
  let current: string | null = null;
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) {
      blocks.push(`<div style="display:grid;grid-template-columns:1fr 1fr;">${rows.join('')}</div>`);
      rows = [];
    }
  };
  for (const o of pageOrders) {
    const key = o.material || '—';
    if (current !== null && key !== current) flush();
    current = key;
    rows.push(cell(renderInner(o), !!(o.groupSize && o.groupSize > 1)));
  }
  flush();
  return `<div style="display:flex;flex-direction:column;gap:10px;">${blocks.join('')}</div>`;
};

const page = (inner: string) =>
  `<div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:24px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;">${inner}</div>`;

const buildChecklistPageHtml = (pageOrders: TakenOrder[], cutterName: string, date: string) => {
  // Сводка связок на странице: заказ покупателя из нескольких вещей вешается на ОДНУ вешалку
  // целиком, иначе швея не сможет взять и отшить его одним куском.
  const groupCounts = new Map<string, number>();
  for (const o of pageOrders) {
    if (o.groupKey && o.groupSize && o.groupSize > 1) {
      groupCounts.set(o.groupKey, (groupCounts.get(o.groupKey) || 0) + 1);
    }
  }
  const groupsBanner = groupCounts.size
    ? `<div style="border:3px solid #000;background:#e8e8e8;padding:8px 12px;margin-bottom:10px;font-size:13px;font-weight:700;">
         <div style="font-size:15px;margin-bottom:3px;">НА ЛИСТЕ ЕСТЬ СВЯЗКИ — ВЕШАТЬ ВМЕСТЕ НА ОДНУ ВЕШАЛКУ</div>
         <div style="font-size:12px;">
           ${Array.from(groupCounts.entries())
             .map(([key, cnt]) => `${key} — ${cnt} шт.`)
             .join(' &nbsp;·&nbsp; ')}
         </div>
         <div style="font-size:11px;font-weight:400;margin-top:3px;">
           Позиции связок выделены жирной рамкой и серым фоном
         </div>
       </div>`
    : '';
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:stretch;margin-bottom:14px;">
      <div style="border:1px solid #000;padding:6px 14px;font-size:13px;font-weight:700;">${cutterName}</div>
      <div style="border:1px solid #000;padding:6px 14px;font-size:13px;font-weight:700;">${date}</div>
    </div>` + groupsBanner;
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="padding:8px 12px;text-align:center;">
        <div style="font-size:18px;font-weight:700;line-height:1.15;">${sizeLabel(o)}</div>
        <div style="font-size:11px;color:#222;margin-top:3px;">${o.marketplace} ${o.orderNumber}</div>
        ${groupNote(o)}
      </div>`
  );
  return page(header + grid);
};

const buildQrPageHtml = (
  pageOrders: TakenOrder[],
  qrDataUrls: Record<number, string>,
  cutterId: number | null
) => {
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;">
        <img src="${qrDataUrls[o.id]}" style="width:52px;height:52px;flex-shrink:0;" />
        <div style="min-width:0;text-align:center;flex:1;">
          <div style="font-size:17px;font-weight:700;line-height:1.15;">${sizeLabel(o)}</div>
          <div style="font-size:11px;color:#222;margin-top:3px;">
            ${o.marketplace} ${o.orderNumber} [${o.orderType}]${cutterId != null ? ` ID: ${cutterId}` : ''}
          </div>
          ${groupNote(o)}
        </div>
      </div>`
  );
  return page(grid);
};

const renderPageToPdf = async (pdf: jsPDF, html: string, isFirstPage: boolean) => {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container.firstElementChild as HTMLElement, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    if (!isFirstPage) pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
  } finally {
    document.body.removeChild(container);
  }
};

export const printCuttingSheet = async (
  orders: TakenOrder[],
  cutterName: string,
  cutterId: number | null = null
) => {
  if (orders.length === 0) return;

  const grouped = groupByMaterial(orders);
  const checklistPages = chunk(grouped, ITEMS_PER_PAGE);
  const date = formatToday();

  const qrEntries = await Promise.all(
    grouped.map(async (o) => [o.id, await QRCode.toDataURL(o.orderNumber, { width: 120, margin: 1 })] as const)
  );
  const qrDataUrls = Object.fromEntries(qrEntries) as Record<number, string>;
  const qrPages = chunk(grouped, ITEMS_PER_PAGE);

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  let isFirstPage = true;
  for (const pageOrders of checklistPages) {
    await renderPageToPdf(pdf, buildChecklistPageHtml(pageOrders, cutterName, date), isFirstPage);
    isFirstPage = false;
  }
  for (const pageOrders of qrPages) {
    await renderPageToPdf(pdf, buildQrPageHtml(pageOrders, qrDataUrls, cutterId), isFirstPage);
    isFirstPage = false;
  }

  pdf.save(`Лист закройщика ${date.replace(/\//g, '-')}.pdf`);
};