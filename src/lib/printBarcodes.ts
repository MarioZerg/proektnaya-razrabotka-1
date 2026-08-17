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
 * Печать стикеров рулонов на наклейке 75×120 мм.
 *
 * ПОЧЕМУ БОЛЬШОЙ ФОРМАТ. Раньше рулоны клеились на ту же наклейку 58×40 мм, что и
 * товар. Рулон — крупный тяжёлый предмет: он стоит в стеллаже вертикально, и
 * кладовщик ищет нужный по торцам, не вытаскивая соседние. Маленькую наклейку на
 * рулоне ткани издалека не разобрать, а сканировать её приходилось вплотную.
 *
 * На 75×120 мм помещается то, что на маленькой не влезало:
 * — материал и метраж крупным шрифтом, читаются с нескольких метров;
 * — штрихкод во всю ширину и высокий, сканер берёт его под углом и с расстояния;
 * — номер кода цифрами отдельной строкой: если наклейка потёрлась, код вбивают руками;
 * — поставщик и дата приёмки отдельными строками, а не сжатые в одну.
 *
 * Наклейка вертикальная (75 мм в ширину, 120 мм в высоту) — так она ложится по длине
 * рулона и не заворачивается на скруглении.
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
      // Широкие штрихи и высокая полоса — на 75 мм места хватает с запасом.
      // Такой код сканер читает с расстояния и под углом, не вплотную к рулону.
      width: 3,
      height: 120,
      // Цифры кода рисуем сами отдельной строкой крупнее, чем умеет jsbarcode.
      displayValue: false,
      margin: 4,
    });
    const label = (item.label || '').trim();
    const supplier = (item.supplier || '').trim();
    const received = formatDate(item.receivedAt);
    return `
    <div class="sticker">
      ${label ? `<div class="label">${esc(label)}</div>` : ''}
      <img src="${canvas.toDataURL('image/png')}" alt="${esc(item.code)}" />
      <div class="code">${esc(item.code)}</div>
      ${supplier ? `<div class="meta">${esc(supplier)}</div>` : ''}
      ${received ? `<div class="meta date">Принят ${esc(received)}</div>` : ''}
    </div>`;
  });

  const html = `<!DOCTYPE html>
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
      padding: 4mm 3mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2mm;
      overflow: hidden;
      page-break-after: always;
    }
    .sticker:last-child { page-break-after: auto; }
    .label {
      /* Крупно: материал и метраж кладовщик читает с нескольких метров, не подходя
         к стеллажу. Это главное, что он ищет глазами. */
      font-size: 17pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.15;
      width: 100%;
      /* Длинное название переносим — на 120 мм высоты место есть, обрезать незачем. */
      overflow-wrap: anywhere;
    }
    .sticker img {
      width: 69mm;
      height: auto;
      max-height: 52mm;
      display: block;
    }
    .code {
      /* Номер цифрами: наклейка на рулоне быстро затирается о стеллаж, и когда
         штрихкод перестаёт читаться, код набирают вручную. */
      font-size: 15pt;
      font-weight: bold;
      letter-spacing: 0.5pt;
      text-align: center;
      width: 100%;
    }
    .meta {
      font-size: 12pt;
      text-align: center;
      line-height: 1.2;
      width: 100%;
      overflow-wrap: anywhere;
    }
    .date { font-size: 11pt; color: #333; }
  </style>
</head>
<body>
  ${stickers.join('')}
</body>
</html>`;

  printHtmlInIframe(html);
};
