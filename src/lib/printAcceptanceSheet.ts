import printHtmlInIframe from '@/lib/printInIframe';
import { formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';
import type { ShipmentDetail } from '@/lib/shipmentsApi';

interface SheetLine {
  materialName: string;
  unit: string;
  quantity: number;
  rolls: number;
  /** Цена за единицу из прайса поставщика (настройки поставщика). */
  price: number | null;
  currency: string;
}

const RUB = ['RUB', 'RUR', '₽', 'руб', ''];
const isRub = (c: string) => RUB.includes(c.trim().toUpperCase()) || RUB.includes(c.trim());

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Сумма строки в рублях. Цена в валюте переводится по курсу приёмки; если курса
 * нет — рублёвой суммы не будет, чтобы не выдать бухгалтеру выдуманную цифру.
 */
const rubAmount = (line: SheetLine, rate: number | null | undefined) => {
  if (line.price == null) return null;
  const sum = line.price * line.quantity;
  if (isRub(line.currency)) return sum;
  return rate ? sum * rate : null;
};

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
    // Цена берётся из прайса поставщика в настройках; если там пусто — та, что
    // указал администратор при проверке приёмки.
    const price = item.supplierPrice ?? item.price ?? null;
    const currency = (item.supplierPrice != null ? item.supplierCurrency : item.currency) || 'RUB';
    // Один материал у разных поставщиков может стоить по-разному — строки не сливаем.
    const key = `${item.materialId}|${name}|${unit}|${price}|${currency}`;
    const prev = byKey.get(key);
    const qty = Number(item.quantity) || 0;
    const rolls = item.numberRolls || (item.barcode || item.reservedBarcodes?.length ? 1 : 0);
    if (prev) {
      prev.quantity += qty;
      prev.rolls += rolls;
    } else {
      byKey.set(key, { materialName: name, unit, quantity: qty, rolls, price, currency });
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
  const rate = detail.exchangeRate;
  const amounts = lines.map((line) => rubAmount(line, rate));
  const totalRub = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const noPrice = amounts.filter((a) => a == null).length;
  const priceCell = (line: SheetLine) => {
    if (line.price == null) return '—';
    if (isRub(line.currency)) return `${money(line.price)} ₽`;
    const inRub = rate ? ` <span class="sub">≈ ${money(line.price * rate)} ₽</span>` : '';
    return `${money(line.price)} ${escapeHtml(line.currency)}${inRub}`;
  };
  const rows = lines
    .map(
      (line, i) =>
        `<tr>
          <td>${escapeHtml(line.materialName)}</td>
          <td>${escapeHtml(line.unit)}</td>
          <td class="num">${escapeHtml(formatQuantity(line.quantity))}</td>
          <td class="num">${line.rolls}</td>
          <td class="num">${priceCell(line)}</td>
          <td class="num">${amounts[i] != null ? `${money(amounts[i] as number)} ₽` : '—'}</td>
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
    .sub { color: #555; font-size: 11px; }
    .note { color: #555; font-size: 11px; margin-top: 8px; }
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
        <th class="num">Цена поставщика</th>
        <th class="num">Сумма, ₽</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6">Позиций нет</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Итого</td>
        <td class="num">${escapeHtml(formatQuantity(totalQty))}</td>
        <td class="num">${totalRolls}</td>
        <td></td>
        <td class="num">${money(totalRub)} ₽</td>
      </tr>
    </tfoot>
  </table>
  <p class="note">
    Цены — из прайса поставщика в настройках${rate ? `, валюта переведена по курсу ${money(rate)} ₽` : ''}.
    ${noPrice ? `Без цены: ${noPrice} поз. — в общую сумму не вошли, проверьте прайс поставщика${lines.some((l) => l.price != null && !isRub(l.currency)) && !rate ? ' или укажите курс валюты в приёмке' : ''}.` : ''}
  </p>
  <div class="signs">
    <div class="sign">Кладовщик<div class="line"></div></div>
    <div class="sign">Бухгалтер<div class="line"></div></div>
  </div>
</body>
</html>`;

  printHtmlInIframe(html);
};

export default printAcceptanceSheet;
