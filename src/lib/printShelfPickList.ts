import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Печать листа отбора по полке: кладовщик берёт бумагу, идёт к стеллажу и отмечает галочками
 * снятые вещи. В списке есть штрихкод хранения — по нему потом сканируется товар в поставку.
 */
export const printShelfPickList = (items: GoodsWarehouseItem[], shelfName: string) => {
  if (items.length === 0) return;

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) return;

  const printedAt = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const rows = items
    .map((i, idx) => {
      const size = i.width && i.height ? `${i.width}×${i.height}` : '';
      const product = escapeHtml(i.product || i.material || '—');
      return `
      <tr>
        <td class="num">${idx + 1}</td>
        <td class="check"></td>
        <td class="code">${escapeHtml(i.storageBarcode || '')}</td>
        <td>${product}</td>
        <td class="size">${size}</td>
        <td class="code">${escapeHtml(i.orderNumber || '')}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Отбор с полки ${escapeHtml(shelfName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #111; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
    .total { font-size: 14px; font-weight: bold; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 6px 8px; font-size: 13px; text-align: left; }
    th { background: #f0f0f0; font-size: 12px; text-transform: uppercase; }
    .num { width: 36px; text-align: center; color: #666; }
    .check { width: 40px; }
    .code { font-family: "Courier New", monospace; white-space: nowrap; }
    .size { white-space: nowrap; }
    tr { page-break-inside: avoid; }
    .sign { margin-top: 24px; font-size: 13px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Лист отбора — ${escapeHtml(shelfName)}</h1>
  <div class="meta">Напечатано: ${printedAt}</div>
  <div class="total">Всего к отбору: ${items.length} шт</div>
  <table>
    <thead>
      <tr>
        <th class="num">№</th>
        <th class="check">✓</th>
        <th>Стикер хранения</th>
        <th>Товар</th>
        <th>Размер</th>
        <th>Заказ</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign">Отобрал: _________________________ &nbsp;&nbsp; Дата: ______________</div>
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
};
