import JsBarcode from 'jsbarcode';

export interface StorageStickerData {
  /** Штрихкод хранения вида GW-000004 — по нему вещь кладут на полку. */
  storageBarcode: string;
  /** Материал и размер: то, что реально помогает опознать вещь на полке. */
  title?: string | null;
  /** Номер заказа или отправления маркетплейса — у WB он очень длинный. */
  orderNumber?: string | null;
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Стикер хранения 58×40 мм.
 *
 * Раньше печатался общим шаблоном без заданного размера листа, и длинный номер отправления
 * WB (вида eBd.ffc5f639...0.1) уезжал за края наклейки. Здесь лист жёстко 58×40, номер
 * переносится по символам и автоматически уменьшается, если он длинный.
 */
export const printStorageSticker = (data: StorageStickerData) => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, data.storageBarcode, {
    format: 'CODE128',
    width: 2,
    height: 42,
    displayValue: true,
    fontSize: 13,
    margin: 2,
  });
  const barcode = canvas.toDataURL('image/png');

  const order = (data.orderNumber || '').trim();
  // Чем длиннее номер, тем мельче шрифт — иначе он не влезает в 58 мм по ширине.
  const orderFont = order.length > 34 ? '4.5pt' : order.length > 22 ? '5.5pt' : '6.5pt';

  const win = window.open('', '_blank', 'width=420,height=340');
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Стикер хранения ${esc(data.storageBarcode)}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 58mm;
      height: 40mm;
      padding: 1mm 1.5mm;
      font-family: Arial, Helvetica, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5mm;
      overflow: hidden;
    }
    .title {
      font-size: 8.5pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      max-height: 7mm;
      overflow: hidden;
    }
    .bc img { width: 53mm; height: auto; display: block; }
    .order {
      font-size: ${orderFont};
      color: #333;
      text-align: center;
      line-height: 1.15;
      width: 100%;
      word-break: break-all;
      max-height: 6mm;
      overflow: hidden;
    }
  </style>
</head>
<body>
  ${data.title ? `<div class="title">${esc(data.title)}</div>` : ''}
  <div class="bc"><img src="${barcode}" alt="${esc(data.storageBarcode)}" /></div>
  ${order ? `<div class="order">${esc(order)}</div>` : ''}
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
};
