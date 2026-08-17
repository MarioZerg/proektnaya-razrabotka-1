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
  return d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
};

/**
 * Печать стикеров рулонов на наклейке 75×120 мм, ГОРИЗОНТАЛЬНОЙ:
 * 120 мм по ширине, 75 мм по высоте.
 *
 * ПОЧЕМУ БОЛЬШОЙ ФОРМАТ. Раньше рулоны клеились на ту же наклейку 58×40 мм, что и
 * товар. Рулон — крупный тяжёлый предмет: он стоит в стеллаже, и кладовщик ищет
 * нужный по торцам, не вытаскивая соседние. Маленькую наклейку на рулоне ткани
 * издалека не разобрать, а сканировать её приходилось вплотную.
 *
 * ПОЧЕМУ ГОРИЗОНТАЛЬНО. Штрихкод читается сканером вдоль штрихов, поэтому длинную
 * сторону наклейки отдаём именно ему: на 120 мм код растягивается во всю ширину и
 * берётся с расстояния. Текст идёт теми же строками по горизонтали — его читают,
 * не наклоняя голову и не поворачивая рулон.
 *
 * На такой наклейке помещается то, что на маленькой не влезало:
 * — материал и метраж крупным шрифтом, читаются с нескольких метров;
 * — штрихкод во всю ширину, сканер берёт его под углом и с расстояния;
 * — номер кода цифрами отдельной строкой: если наклейка потёрлась, код вбивают руками;
 * — поставщик и дата приёмки отдельными строками, а не сжатые в одну.
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
      // Широкие штрихи: код растягивается на все 112 мм ширины, и сканер берёт его
      // с расстояния и под углом, не вплотную к рулону.
      width: 4,
      // Полоса пониже вертикального варианта: длинную сторону теперь занимает ширина,
      // а по высоте нужно оставить место тексту.
      height: 90,
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
    /* Горизонтальная наклейка: длинная сторона (120 мм) идёт по ширине — под штрихкод. */
    @page { size: 120mm 75mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
    .sticker {
      width: 120mm;
      height: 75mm;
      padding: 3mm 4mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.5mm;
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
      /* Длинное название переносим: по ширине 120 мм оно почти всегда влезает
         в одну строку, а если нет — уходит на вторую, обрезать незачем. */
      overflow-wrap: anywhere;
    }
    .sticker img {
      /* Штрихкод во всю длинную сторону: чем он шире, тем дальше берёт сканер.
         По высоте ограничиваем — на 75 мм нужно оставить место под текст. */
      width: 112mm;
      height: auto;
      max-height: 30mm;
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