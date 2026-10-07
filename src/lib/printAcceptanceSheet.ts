import printHtmlInIframe from '@/lib/printInIframe';
import { formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';
import type { ShipmentDetail } from '@/lib/shipmentsApi';

interface SheetLine {
  materialName: string;
  unit: string;
  quantity: number;
  rolls: number;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const groupLines = (detail: ShipmentDetail): SheetLine[] => {
  const byKey = new Map<string, SheetLine>();
  for (const item of detail.items) {
    if (item.removedAt) continue;
    const name = item.materialName || 'Материал';
    const unit = item.unit || '';
    const key = `${item.materialId}|${name}|${unit}`;
    const prev = byKey.get(key);
    const qty = Number(item.quantity) || 0;
    const rolls = item.numberRolls || (item.barcode || item.reservedBarcodes?.length ? 1 : 0);
    if (prev) {
      prev.quantity += qty;
      prev.rolls += rolls;
    } else {
      byKey.set(key, { materialName: name, unit, quantity: qty, rolls });
    }
  }
  return [...byKey.values()];
};

/** Лист приёмки для офиса: кладовщик печатает и относит бухгалтеру. */
export const printAcceptanceSheet = (detail: ShipmentDetail) => {
  const lines = groupLines(detail);
  const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalRolls = lines.reduce((sum, line) => sum + line.rolls, 0);
  const supplier = detail.itemSuppliers || detail.supplierName || 'Поставщик не указан';
  const rows = lines
    .map(
      (line) =>
        `<tr>
          <td>${escapeHtml(line.materialName)}</td>
          <td>${escapeHtml(line.unit)}</td>
          <td class="num">${escapeHtml(formatQuantity(line.quantity))}</td>
          <td class="num">${line.rolls}</td>
        </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Лист приёмки #${detail.id}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, sans-serif; color: #111; font-size: 13px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { color: #444; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #222; padding: 6px 8px; text-align: left; }
    th { background: #f3f3f3; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tfoot td { font-weight: 700; }
    .signs { display: flex; justify-content: space-between; margin-top: 36px; }
    .sign { width: 46%; }
    .line { border-bottom: 1px solid #111; height: 28px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Лист приёмки № ${detail.id}</h1>
  <p class="meta">
    ${escapeHtml(supplier)}<br />
    Дата: ${escapeHtml(formatDate(detail.completedAt || detail.createdAt))}
    ${detail.createdByName ? ` · Принял: ${escapeHtml(detail.createdByName)}` : ''}
  </p>
  <table>
    <thead>
      <tr>
        <th>Материал</th>
        <th>Ед.</th>
        <th class="num">Принято</th>
        <th class="num">Рулонов / шт</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="4">Позиций нет</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Итого</td>
        <td class="num">${escapeHtml(formatQuantity(totalQty))}</td>
        <td class="num">${totalRolls}</td>
      </tr>
    </tfoot>
  </table>
  <div class="signs">
    <div class="sign">Кладовщик<div class="line"></div></div>
    <div class="sign">Бухгалтер<div class="line"></div></div>
  </div>
</body>
</html>`;

  printHtmlInIframe(html);
};

export default printAcceptanceSheet;
