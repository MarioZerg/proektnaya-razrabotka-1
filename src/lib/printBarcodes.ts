import JsBarcode from 'jsbarcode';

export interface BarcodePrintItem {
  code: string;
  label?: string;
}

const esc = (v: string) =>
  v.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Печать штрихкодов рулонов на наклейке 75×120 мм.
 *
 * Рулон — крупная единица хранения, его штрихкод ищут глазами через весь склад, поэтому
 * наклейка большая: маленькую 58×40 на рулоне попросту не разглядеть. Это осознанное
 * отличие от стикеров товара (58×40) — там наклейка клеится на пакет и должна быть мелкой.
 *
 * Каждый штрихкод — отдельная наклейка; несколько кодов печатаются подряд через разрыв
 * страницы.
 */
export const printBarcodes = (items: BarcodePrintItem[], title = 'Штрихкоды') => {
  if (items.length === 0) return;

  const stickers = items.map((item) => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, item.code, {
      format: 'CODE128',
      width: 3,
      height: 110,
      displayValue: true,
      fontSize: 20,
      margin: 4,
    });
    const label = (item.label || '').trim();
    return `
    <div class="sticker">
      ${label ? `<div class="label">${esc(label)}</div>` : ''}
      <img src="${canvas.toDataURL('image/png')}" alt="${esc(item.code)}" />
    </div>`;
  });

  const printWindow = window.open('', '_blank', 'width=520,height=700');
  if (!printWindow) return;

  printWindow.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: 75mm 120mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
    .sticker {
      width: 75mm;
      height: 120mm;
      padding: 4mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4mm;
      overflow: hidden;
      page-break-after: always;
    }
    .sticker:last-child { page-break-after: auto; }
    .label {
      font-size: 13pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.2;
      width: 100%;
      max-height: 30mm;
      overflow: hidden;
      word-break: break-word;
    }
    .sticker img { width: 67mm; height: auto; display: block; }
  </style>
</head>
<body>
  ${stickers.join('')}
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`);
  printWindow.document.close();
};
