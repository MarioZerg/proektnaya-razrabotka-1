import printHtmlInIframe from '@/lib/printInIframe';
import JsBarcode from 'jsbarcode';

export interface StorageStickerData {
  /** Штрихкод хранения вида GW-000004 — по нему вещь кладут на полку. */
  storageBarcode: string;
  /** Материал и размер: то, что реально помогает опознать вещь на полке. */
  title?: string | null;
  /** Номер заказа или отправления маркетплейса — у WB он очень длинный. */
  orderNumber?: string | null;
  /**
   * Пометка о связке Яндекса: «Связка 2 из 3».
   *
   * У заказа Яндекса из нескольких вещей один ярлык на всех. Если такой заказ
   * отменили, вещи едут на склад по отдельности, и на полке их не собрать обратно:
   * стикеры выглядят одинаково. Поэтому прямо на наклейке пишем, что вещь из связки
   * и сколько в ней всего — кладовщик кладёт их рядом и видит, всё ли дошло.
   */
  groupLabel?: string | null;
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

  const html = `<!DOCTYPE html>
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
    /* Пометка о связке — крупно и жирно: кладовщик должен увидеть её с полки. */
    .group {
      font-size: 7pt;
      font-weight: bold;
      text-align: center;
      border: 0.3mm solid #000;
      border-radius: 1mm;
      padding: 0 1mm;
      line-height: 1.3;
    }
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
  ${data.groupLabel ? `<div class="group">${esc(data.groupLabel)}</div>` : ''}
  <div class="bc"><img src="${barcode}" alt="${esc(data.storageBarcode)}" /></div>
  ${order ? `<div class="order">${esc(order)}</div>` : ''}
</body>
</html>`;

  printHtmlInIframe(html);
};

/**
 * Лента стикеров хранения — печать пачкой на одном задании.
 *
 * Когда админ принимает партию из десятка вещей, печатать каждую наклейку отдельным
 * заданием мучительно: десять кликов, десять диалогов принтера. Здесь все наклейки
 * идут одной лентой, каждая на своём листе 58×40 — рулонный принтер режет их сам.
 */
export const printStorageStickers = (list: StorageStickerData[]) => {
  if (!list.length) return;

  const pages = list
    .map((data) => {
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
      const orderFont =
        order.length > 34 ? '4.5pt' : order.length > 22 ? '5.5pt' : '6.5pt';

      return `<div class="sticker">
  ${data.title ? `<div class="title">${esc(data.title)}</div>` : ''}
  <div class="bc"><img src="${barcode}" alt="${esc(data.storageBarcode)}" /></div>
  ${order ? `<div class="order" style="font-size:${orderFont}">${esc(order)}</div>` : ''}
</div>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Стикеры хранения (${list.length})</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
    .sticker {
      width: 58mm;
      height: 40mm;
      padding: 1mm 1.5mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5mm;
      overflow: hidden;
      /* Каждая наклейка — отдельный лист: рулонный принтер отрежет её по границе. */
      page-break-after: always;
      break-after: page;
    }
    .sticker:last-child { page-break-after: auto; break-after: auto; }
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
${pages}
</body>
</html>`;

  printHtmlInIframe(html);
};
