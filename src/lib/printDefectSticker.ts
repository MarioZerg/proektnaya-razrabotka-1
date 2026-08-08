import printHtmlInIframe from '@/lib/printInIframe';
import JsBarcode from 'jsbarcode';

export interface DefectStickerData {
  /** Штрихкод брака DF-000001 — по нему кладовщик принимает брак на склад. */
  barcode: string;
  materialName: string;
  quantity: number;
  unit?: string | null;
  reasonLabel: string;
  /** ID сотрудника, который нашёл брак. На стикере печатаем именно ID, а не фамилию:
   * наклейка маленькая, длинные ФИО в неё не влезают, а по ID сотрудник всегда находится
   * в системе. */
  userId: number;
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Стикер брака 58×40 мм.
 *
 * Клеится на бракованный кусок, который откладывают в контейнер. Кладовщик потом сканирует
 * этот штрихкод и принимает брак на склад — так видно, что реально доехало, а что потерялось
 * по дороге. Причина и ID сотрудника печатаются прямо на стикере: если брак спорный, у него
 * есть автор, и разбираться можно не по памяти.
 */
export const printDefectSticker = (data: DefectStickerData) => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, data.barcode, {
    format: 'CODE128',
    width: 2,
    height: 38,
    displayValue: true,
    fontSize: 12,
    margin: 2,
  });

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Стикер брака ${esc(data.barcode)}</title>
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
      gap: 0.3mm;
      overflow: hidden;
    }
    .head {
      font-size: 8pt;
      font-weight: bold;
      letter-spacing: 0.5px;
      border: 1px solid #000;
      padding: 0 2mm;
    }
    .title { font-size: 8pt; font-weight: bold; text-align: center; line-height: 1.1; }
    .bc img { width: 50mm; height: auto; display: block; }
    .meta { font-size: 6.5pt; text-align: center; line-height: 1.15; width: 100%; }
  </style>
</head>
<body>
  <div class="head">БРАК</div>
  <div class="title">
    ${esc(data.materialName)} — ${esc(data.quantity)} ${esc(data.unit || 'м')}
  </div>
  <div class="bc"><img src="${canvas.toDataURL('image/png')}" alt="${esc(data.barcode)}" /></div>
  <div class="meta">${esc(data.reasonLabel)} · ID ${esc(data.userId)}</div>
</body>
</html>`;

  printHtmlInIframe(html);
};
