import JsBarcode from 'jsbarcode';

export interface BarcodePrintItem {
  code: string;
  label?: string;
}

const esc = (v: string) =>
  v.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Печать штрихкодов на термонаклейке 58×40 мм — том же размере, что и все остальные
 * наклейки в производстве (стикеры хранения, товара, прослеживаемости).
 *
 * Раньше лист печатался без заданного размера страницы: на офисном A4 коды шли вразнобой,
 * а на термопринтере наклейка обрезалась. Теперь каждый штрихкод — отдельная наклейка,
 * несколько кодов печатаются подряд, разделяясь разрывом страницы.
 */
export const printBarcodes = (items: BarcodePrintItem[], title = 'Штрихкоды') => {
  if (items.length === 0) return;

  const stickers = items.map((item) => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, item.code, {
      format: 'CODE128',
      width: 2,
      height: 45,
      displayValue: true,
      fontSize: 13,
      margin: 2,
    });
    const label = (item.label || '').trim();
    // Длинная подпись (материал + количество) мельчает, чтобы влезть в ширину наклейки.
    const labelFont = label.length > 40 ? '6pt' : label.length > 24 ? '7pt' : '8.5pt';
    return `
    <div class="sticker">
      ${label ? `<div class="label" style="font-size:${labelFont}">${esc(label)}</div>` : ''}
      <img src="${canvas.toDataURL('image/png')}" alt="${esc(item.code)}" />
    </div>`;
  });

  const printWindow = window.open('', '_blank', 'width=420,height=340');
  if (!printWindow) return;

  printWindow.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
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
      page-break-after: always;
    }
    .sticker:last-child { page-break-after: auto; }
    .label {
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      max-height: 8mm;
      overflow: hidden;
      width: 100%;
      word-break: break-word;
    }
    .sticker img { width: 53mm; height: auto; display: block; }
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