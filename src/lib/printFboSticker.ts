import JsBarcode from 'jsbarcode';
import type { Order } from '@/lib/ordersApi';

const esc = (s: string | null | undefined): string =>
  String(s ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Рисует штрихкод Code128 в SVG-строку. */
const svgBarcode = (value: string): string => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(el, value, {
    format: 'CODE128',
    width: 2,
    height: 60,
    displayValue: false,
    margin: 0,
  });
  return new XMLSerializer().serializeToString(el);
};

/**
 * Короткий номер для стикера. Импортные FBO-заказы OZON имеют номер вида
 * "{номер поставки}-{артикул}-{позиция}" (напр. "2000061239378-vyal4_290-1") — он слишком
 * длинный для стикера, поэтому показываем артикул+позицию (всё после первого дефиса:
 * "vyal4_290-1"). Короткие/ручные номера оставляем как есть.
 */
const shortOrderNumber = (orderNumber: string): string => {
  const firstDash = orderNumber.indexOf('-');
  if (firstDash === -1) return orderNumber;
  const rest = orderNumber.slice(firstDash + 1);
  // Сокращаем только длинные составные номера поставки (>= 2 дефисов).
  return orderNumber.split('-').length >= 3 ? rest : orderNumber;
};

/**
 * Печать стикера FBO сшитого товара (58×40 мм) — по формату OZON FBO:
 *   штрихкод товара (Code128) сверху во всю ширину, под ним текст штрихкода, слева название
 *   товара + ширина/высота, справа номер заказа и кластер (регион), внизу — № закройщика и швеи.
 * Штрихкод товара берётся из заказа (productBarcode, фиксируется при импорте OZON FBO).
 */
export const printFboSticker = (order: Order): void => {
  const isOzon = order.marketplace === 'OZON';
  // На стикере FBO OZON кодируется OZON SKU товара (по нему товар добавляется в поставку FBO),
  // а не его штрихкод. Для остальных маркетплейсов — штрихкод товара.
  const code = (isOzon ? order.productOzonSku : order.productBarcode) || '';
  const barcodeSvg = code ? svgBarcode(code) : '';
  const productName = order.material || order.product || '—';
  const stickerNumber = shortOrderNumber(order.orderNumber);
  // На стикере OZON под полосками печатается приставка "OZN" (OZN + ozon_sku).
  const barcodeText = isOzon ? `OZN${code}` : code;

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Стикер FBO — ${esc(order.orderNumber)}</title>
    <style>
      @page { size: 58mm 40mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; }
      .label {
        width: 58mm; height: 40mm; padding: 1.5mm 2mm;
        display: flex; flex-direction: column;
        page-break-after: always; overflow: hidden;
      }
      .bc { width: 100%; text-align: center; }
      .bc svg { width: 100%; height: 11mm; }
      .bcval { font-size: 11pt; font-weight: 400; letter-spacing: 0.3px; margin-top: 0.5mm; line-height: 1; }
      .body { display: flex; justify-content: space-between; gap: 2mm; margin-top: 1mm; flex: 1; }
      .left { font-size: 8pt; line-height: 1.25; }
      .left .name { font-weight: 400; }
      .right { text-align: right; font-size: 8pt; line-height: 1.3; }
      .right .order { font-weight: 400; }
      .right .cluster { font-weight: 700; margin-top: 1mm; }
      .foot { text-align: right; font-size: 7.5pt; font-weight: 700; margin-top: auto; }
      .nobc { font-size: 8pt; color: #b00; text-align: center; padding: 4mm 0; }
    </style></head><body>
    <div class="label">
      ${
        code
          ? `<div class="bc">${barcodeSvg}</div>
             <div class="bcval">${esc(barcodeText)}</div>`
          : `<div class="nobc">Код товара не загружен — привяжите товар</div>`
      }
      <div class="body">
        <div class="left">
          <div class="name">${esc(productName)}</div>
          <div>ширина ${order.width ?? '—'}</div>
          <div>высота ${order.height ?? '—'}</div>
        </div>
        <div class="right">
          <div class="order">${esc(stickerNumber)}</div>
          <div class="cluster">${esc(order.cluster)}</div>
        </div>
      </div>
      <div class="foot">
        закройщик № ${order.cutterUserId ?? '—'} | швея № ${order.sewerUserId ?? '—'}
      </div>
    </div>
    </body></html>`;

  // Печать через скрытый iframe внутри текущей страницы — без новых вкладок/окон.
  // Диалог печати браузера открывается поверх страницы, после печати iframe удаляется.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.onafterprint = cleanup;
    win.focus();
    win.print();
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
};