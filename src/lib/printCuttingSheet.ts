import QRCode from 'qrcode';

/**
 * Печать "листа закройщика" — номер заказа крупным шрифтом + QR-код с номером заказа,
 * который потом можно отсканировать при сборке/стикеровке. Формат A6, крепится к
 * раскроенному изделию.
 */
export const printCuttingSheet = async (orderId: number, orderNumber: string) => {
  const qrDataUrl = await QRCode.toDataURL(orderNumber, { width: 220, margin: 1 });

  const printWindow = window.open('', '_blank', 'width=500,height=650');
  if (!printWindow) return;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Лист закройщика — заказ #${orderId}</title>
  <style>
    @page { size: A6; margin: 5mm; }
    body {
      margin: 0;
      font-family: sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
    }
    .title { font-size: 12pt; color: #555; margin-bottom: 2mm; }
    .order-number { font-size: 20pt; font-weight: 700; margin-bottom: 4mm; word-break: break-all; }
    img { width: 45mm; height: 45mm; }
  </style>
</head>
<body>
  <div class="title">Заказ</div>
  <div class="order-number">№ ${orderNumber}</div>
  <img src="${qrDataUrl}" />
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
};
