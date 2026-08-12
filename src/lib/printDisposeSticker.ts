import printHtmlInIframe from '@/lib/printInIframe';
import JsBarcode from 'jsbarcode';

export interface DisposeStickerData {
  /** Штрихкод хранения вида GW-000004 — по нему вещь находят в карточке склада. */
  storageBarcode: string;
  /** Материал и размер: чем вещь опознают глазами. */
  title?: string | null;
  orderNumber?: string | null;
  /** За что забракована — упаковщица пишет это на терминале. */
  reason?: string | null;
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Стикер брака 58×40 мм — клеится на вещь, отправленную на утилизацию.
 *
 * Раньше забракованная вещь уезжала из цеха без наклейки: на складе она лежала
 * безымянной среди утиля, и никто не мог сказать, что это за товар и за что его
 * списали. Администратор принимал решение вслепую, а вещь легко было спутать с
 * годной и вернуть на полку.
 *
 * Поэтому наклейка нарочно НЕ похожа на стикер хранения: чёрная шапка «БРАК» видна
 * через весь стол, и причина списания напечатана прямо на ней.
 */
export const printDisposeSticker = (data: DisposeStickerData) => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, data.storageBarcode, {
    format: 'CODE128',
    width: 2,
    height: 34,
    displayValue: true,
    fontSize: 12,
    margin: 2,
  });
  const barcode = canvas.toDataURL('image/png');

  const reason = (data.reason || '').trim();
  const order = (data.orderNumber || '').trim();

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Брак ${esc(data.storageBarcode)}</title>
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
      gap: 0.4mm;
      overflow: hidden;
    }
    .flag {
      width: 100%;
      background: #000;
      color: #fff;
      font-size: 9pt;
      font-weight: bold;
      text-align: center;
      letter-spacing: 1px;
      padding: 0.6mm 0;
    }
    .title {
      font-size: 7.5pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      max-height: 5mm;
      overflow: hidden;
    }
    .bc img { width: 50mm; height: auto; display: block; }
    .reason {
      font-size: 6pt;
      text-align: center;
      line-height: 1.15;
      width: 100%;
      word-break: break-word;
      max-height: 7mm;
      overflow: hidden;
    }
    .order {
      font-size: 5.5pt;
      color: #333;
      text-align: center;
      width: 100%;
      word-break: break-all;
      max-height: 4mm;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="flag">БРАК — НЕ НА ПОЛКУ</div>
  ${data.title ? `<div class="title">${esc(data.title)}</div>` : ''}
  <div class="bc"><img src="${barcode}" alt="${esc(data.storageBarcode)}" /></div>
  ${reason ? `<div class="reason">${esc(reason)}</div>` : ''}
  ${order ? `<div class="order">${esc(order)}</div>` : ''}
</body>
</html>`;

  printHtmlInIframe(html);
};

export default printDisposeSticker;
