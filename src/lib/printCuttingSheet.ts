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

/** Группирует заказы по материалу, сохраняя порядок первого появления материала. */
const groupByMaterial = (orders: TakenOrder[]): TakenOrder[] => {
  const groups = new Map<string, TakenOrder[]>();
  for (const o of orders) {
    const key = o.material || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  return Array.from(groups.values()).flat();
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
};

const sizeLabel = (o: TakenOrder) => `${o.material || '—'} ${o.width ?? '—'} × ${o.height ?? '—'}`;

const buildChecklistPageHtml = (pageOrders: TakenOrder[], cutterName: string, date: string) => {
  const cells = pageOrders
    .map(
      (o) => `
      <div style="border:1px solid #000;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;height:64px;box-sizing:border-box;">
        <div>
          <div style="font-size:16px;font-weight:700;">${sizeLabel(o)}</div>
          <div style="font-size:10px;color:#333;margin-top:2px;">${o.marketplace} ${o.orderNumber}</div>
        </div>
        <div style="width:18px;height:18px;border:1px solid #000;flex-shrink:0;"></div>
      </div>`
    )
    .join('');

  return `
    <div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:20px;font-family:sans-serif;background:#fff;">
      <div style="border:1px solid #000;padding:6px 12px;font-size:11px;font-weight:700;display:flex;justify-content:space-between;margin-bottom:12px;">
        <span>${cutterName}</span>
        <span>${date}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">${cells}</div>
    </div>`;
};

const buildQrPageHtml = (pageOrders: TakenOrder[], qrDataUrls: Record<number, string>) => {
  const cells = pageOrders
    .map(
      (o) => `
      <div style="border:1px solid #000;display:flex;align-items:center;gap:10px;padding:8px 12px;height:64px;box-sizing:border-box;">
        <img src="${qrDataUrls[o.id]}" style="width:48px;height:48px;flex-shrink:0;" />
        <div>
          <div style="font-size:15px;font-weight:700;">${sizeLabel(o)}</div>
          <div style="font-size:10px;color:#333;margin-top:2px;display:flex;gap:6px;align-items:center;">
            <span>${o.marketplace} ${o.orderNumber} [${o.orderType}]</span>
            <span style="font-weight:700;">ID: ${o.id}</span>
          </div>
        </div>
      </div>`
    )
    .join('');

  return `
    <div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:20px;font-family:sans-serif;background:#fff;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">${cells}</div>
    </div>`;
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

export const printCuttingSheet = async (orders: TakenOrder[], cutterName: string) => {
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
    await renderPageToPdf(pdf, buildQrPageHtml(pageOrders, qrDataUrls), isFirstPage);
    isFirstPage = false;
  }

  pdf.save(`Лист закройщика ${date.replace(/\//g, '-')}.pdf`);
};
