import printHtmlInIframe from '@/lib/printInIframe';
import JsBarcode from 'jsbarcode';

export interface BarcodePrintItem {
  code: string;
  label?: string;
  /** Поставщик рулона — по нему на складе разбираются, чей это материал и куда вернуть брак. */
  supplier?: string | null;
  /** Дата приёмки — видно, сколько рулон лежит; старые пускают в работу первыми. */
  receivedAt?: string | null;
}

const esc = (v: string) =>
  v.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/** Дата в привычном виде 05.08.2026 — на складе читают её, а не ISO-строку. */
const formatDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU');
};

/**
 * Печать штрихкодов рулонов на наклейке 58×40 мм — единый формат со стикерами товара,
 * под один рулон этикеток в принтере.
 *
 * Места мало, поэтому расстановка плотная: сверху материал и метраж, в середине
 * штрихкод во всю ширину, снизу поставщик и дата одной строкой. Штрихкод намеренно
 * занимает большую часть наклейки: его считывают сканером, а всё остальное —
 * подсказки для кладовщика.
 *
 * Каждый штрихкод — отдельная наклейка; несколько кодов печатаются подряд через
 * разрыв страницы.
 */
export const printBarcodes = (items: BarcodePrintItem[], title = 'Штрихкоды') => {
  if (items.length === 0) return;

  const stickers = items.map((item) => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, item.code, {
      format: 'CODE128',
      // Узкие штрихи и невысокая полоса: на 58 мм длинный код иначе не помещается
      // и обрезается по краям — сканер такой не прочитает.
      width: 2,
      height: 45,
      displayValue: true,
      fontSize: 16,
      textMargin: 1,
      margin: 2,
    });
    const label = (item.label || '').trim();
    const supplier = (item.supplier || '').trim();
    const received = formatDate(item.receivedAt);
    // Поставщик и дата в одну строку: на 40 мм высоты двух строк уже не остаётся.
    const metaParts = [supplier, received].filter(Boolean);
    const footer = metaParts.length
      ? `<div class="meta">${esc(metaParts.join(' · '))}</div>`
      : '';
    return `
    <div class="sticker">
      ${label ? `<div class="label">${esc(label)}</div>` : ''}
      <img src="${canvas.toDataURL('image/png')}" alt="${esc(item.code)}" />
      ${footer}
    </div>`;
  });

  const html = `<!DOCTYPE html>
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
      padding: 1.5mm 2mm;
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
      font-size: 8pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      width: 100%;
      /* Длинное название материала обрезаем одной строкой: перенос съел бы
         место под штрихкод, а без него наклейка бесполезна. */
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sticker img {
      width: 54mm;
      height: auto;
      max-height: 26mm;
      display: block;
    }
    .meta {
      font-size: 6.5pt;
      text-align: center;
      line-height: 1.1;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
  ${stickers.join('')}
</body>
</html>`;

  printHtmlInIframe(html);
};
