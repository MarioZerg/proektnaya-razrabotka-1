import printHtmlInIframe from '@/lib/printInIframe';
import { formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';
import { moneyAmount, moneyRub } from '@/components/crm/shipments/fromSupplierShared';
import type { ShipmentDetail, ShipmentItem } from '@/lib/shipmentsApi';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const linePrice = (item: ShipmentItem): number | null => {
  if (item.price != null) return Number(item.price);
  if (item.rollPurchasePrice != null) return Number(item.rollPurchasePrice);
  return null;
};

const lineSum = (item: ShipmentItem): number | null => {
  const price = linePrice(item);
  const qty = Number(item.quantity) || 0;
  if (price == null) return null;
  return price * qty;
};

/**
 * Лист возврата поставщику: кладовщик печатает и относит бухгалтеру в 1С.
 * Логистику печатаем только если возврат везли сами за свой счёт.
 */
export const printReturnToSupplierSheet = (detail: ShipmentDetail) => {
  const items = detail.items.filter((item) => !item.removedAt && item.rollId);
  const supplier = detail.itemSuppliers || detail.supplierName || 'Поставщик не указан';
  const ourLogistics = (detail.logisticsCost || 0) > 0;
  const rows = items
    .map((item) => {
      const price = linePrice(item);
      const sum = lineSum(item);
      const currency = item.currency || item.supplierCurrency || 'RUB';
      return `<tr>
          <td>${escapeHtml(item.rollBarcode || item.barcode || '—')}</td>
          <td>${escapeHtml(item.materialName || 'Материал')}</td>
          <td class="num">${escapeHtml(formatQuantity(item.quantity || 0))} ${escapeHtml(item.unit || '')}</td>
          <td class="num">${price == null ? '—' : escapeHtml(moneyAmount(price, currency))}</td>
          <td class="num">${sum == null ? '—' : escapeHtml(moneyAmount(sum, currency))}</td>
        </tr>`;
    })
    .join('');

  const totalsByCurrency = new Map<string, number>();
  for (const item of items) {
    const sum = lineSum(item);
    if (sum == null) continue;
    const currency = (item.currency || item.supplierCurrency || 'RUB').toUpperCase();
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) || 0) + sum);
  }
  const totalsText = [...totalsByCurrency.entries()]
    .map(([currency, sum]) => moneyAmount(sum, currency))
    .join(' + ') || '—';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Возврат поставщику #${detail.id}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, sans-serif; color: #111; font-size: 13px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { color: #444; margin: 0 0 16px; }
    .note { margin: 16px 0; padding: 10px 12px; border: 1px solid #222; background: #f7f7f7; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #222; padding: 6px 8px; text-align: left; }
    th { background: #f3f3f3; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tfoot td { font-weight: 700; }
    .signs { display: flex; justify-content: space-between; margin-top: 36px; }
    .sign { width: 30%; }
    .line { border-bottom: 1px solid #111; height: 28px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Возврат поставщику № ${detail.id}</h1>
  <p class="meta">
    ${escapeHtml(supplier)}
    ${detail.originShipmentId ? `<br />По приёмке № ${detail.originShipmentId}` : ''}<br />
    Дата: ${escapeHtml(formatDate(detail.completedAt || detail.createdAt))}
    ${detail.createdByName ? ` · Собрал: ${escapeHtml(detail.createdByName)}` : ''}
    ${detail.completedAt ? ' · Подтверждено администратором' : ''}
  </p>
  ${detail.comment ? `<p class="meta">Комментарий: ${escapeHtml(detail.comment)}</p>` : ''}
  <table>
    <thead>
      <tr>
        <th>Штрихкод</th>
        <th>Материал</th>
        <th class="num">Кол-во</th>
        <th class="num">Цена</th>
        <th class="num">Сумма</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="5">Позиций нет</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">Итого по ценам приёмки</td>
        <td class="num">${escapeHtml(totalsText)}</td>
      </tr>
      ${
        ourLogistics
          ? `<tr>
        <td colspan="4">Логистика (нашими силами, за наш счёт)</td>
        <td class="num">${escapeHtml(moneyRub(detail.logisticsCost || 0))}</td>
      </tr>`
          : ''
      }
    </tfoot>
  </table>
  <p class="note">
    Документ для занесения в программу 1С:Бухгалтерия.
    Кладовщик относит лист бухгалтеру.
  </p>
  <div class="signs">
    <div class="sign">Кладовщик<div class="line"></div></div>
    <div class="sign">Администратор<div class="line"></div></div>
    <div class="sign">Бухгалтер<div class="line"></div></div>
  </div>
</body>
</html>`;

  printHtmlInIframe(html);
};

export default printReturnToSupplierSheet;
