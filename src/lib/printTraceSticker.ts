import printHtmlInIframe from '@/lib/printInIframe';
import JsBarcode from 'jsbarcode';
import type { KioskOrder } from '@/lib/kioskApi';

/** Префикс внутреннего кода прослеживаемости. По нему кладовщик при возврате понимает,
 * что перед ним наш стикер, а не маркетплейсный. */
export const TRACE_PREFIX = 'TR';

/** Внутренний код вещи: TR + id заказа. Именно он печатается на стикере, который
 * упаковщик кладёт внутрь пакета. */
export const traceCode = (orderId: number) => `${TRACE_PREFIX}${orderId}`;

const svgBarcode = (code: string): string => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, code, {
    format: 'CODE128',
    width: 2,
    height: 45,
    displayValue: true,
    fontSize: 13,
    margin: 4,
  });
  return canvas.toDataURL('image/png');
};

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Печать внутреннего стикера прослеживаемости 58×40 мм.
 *
 * Зачем он нужен: на FBO уезжает партия одинаковых изделий, и маркетплейс при возврате не
 * сообщает, какую именно штуку выкупили и вернули. Штрихкод с номером НАШЕГО заказа едет
 * внутри пакета вместе с вещью — при возврате кладовщик сканирует его и сразу видит, кто
 * шил, кто кроил и когда. Покупателю стикер не мешает: он лежит внутри упаковки.
 */
export const printTraceSticker = (order: KioskOrder) => {
  const code = traceCode(order.id);
  const barcode = svgBarcode(code);
  const size =
    order.material && order.width
      ? `${order.material} ${order.width}×${order.height}`
      : order.product || '';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Стикер прослеживаемости ${esc(code)}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 58mm;
      height: 40mm;
      font-family: Arial, Helvetica, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1mm;
      padding: 1.5mm;
    }
    .bc img { width: 52mm; height: auto; display: block; }
    .size { font-size: 9pt; font-weight: bold; text-align: center; }
    .order { font-size: 7pt; color: #444; text-align: center; }
  </style>
</head>
<body>
  <div class="size">${esc(size)}</div>
  <div class="bc"><img src="${barcode}" alt="${esc(code)}" /></div>
  <div class="order">${esc(order.orderNumber)}</div>
</body>
</html>`;

  printHtmlInIframe(html);
};
