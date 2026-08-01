import JsBarcode from 'jsbarcode';

export interface BarcodePrintItem {
  code: string;
  label?: string;
}

export const printBarcodes = (items: BarcodePrintItem[], title = 'Штрихкоды') => {
  if (items.length === 0) return;

  const images = items.map((item) => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, item.code, {
      format: 'CODE128',
      width: 2,
      height: 60,
      displayValue: true,
      fontSize: 14,
      margin: 8,
    });
    return { dataUrl: canvas.toDataURL('image/png'), label: item.label };
  });

  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) return;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: sans-serif; margin: 0; padding: 16px; }
    .barcode-item { display: inline-block; text-align: center; margin: 8px; padding: 8px; border: 1px solid #ddd; page-break-inside: avoid; }
    .barcode-item img { display: block; }
    .barcode-item .label { font-size: 12px; margin-bottom: 4px; }
    @media print {
      .barcode-item { border: none; }
    }
  </style>
</head>
<body>
  ${images
    .map(
      (img) => `
    <div class="barcode-item">
      ${img.label ? `<div class="label">${img.label}</div>` : ''}
      <img src="${img.dataUrl}" />
    </div>`
    )
    .join('')}
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
};
