/**
 * Печать стикера смены на этикетке 58×40 мм — крепится в цехе, чтобы визуально
 * различать смены. Надпись "СМЕНА № N" по центру, крупным шрифтом.
 */
export const printShiftSticker = (shiftNumber: number) => {
  const printWindow = window.open('', '_blank', 'width=400,height=300');
  if (!printWindow) return;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Стикер смены № ${shiftNumber}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    body {
      margin: 0;
      width: 58mm;
      height: 40mm;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
    }
    .sticker {
      text-align: center;
      width: 100%;
    }
    .label {
      font-size: 10pt;
      letter-spacing: 1px;
      margin-bottom: 2mm;
    }
    .number {
      font-size: 22pt;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="sticker">
    <div class="label">СМЕНА №</div>
    <div class="number">${shiftNumber}</div>
  </div>
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
};
