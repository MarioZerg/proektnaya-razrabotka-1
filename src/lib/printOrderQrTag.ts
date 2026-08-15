import printHtmlInIframe from '@/lib/printInIframe';

export interface OrderQrTagData {
  /** Номер заказа — он же зашит в QR: терминал стикеровки читает именно его. */
  orderNumber: string;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  marketplace?: string | null;
  orderType?: string | null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Бирка с QR-кодом заказа — замена потерянному листку закройщика.
 *
 * На терминале стикеровки упаковщица сканирует QR с листка закройщика. Если листок
 * потеряли, порвали или он затёрся, вещь застревает: заказ есть, товар есть, а
 * застикеровать нечем — ручной поиск включён не во всех цехах.
 *
 * Кладовщик собирает поставку и видит, что вещи не хватает. Теперь он печатает такую
 * бирку прямо из карточки поставки, несёт её в цех — и упаковщица стикерует вещь
 * обычным путём, сканируя QR.
 *
 * QR содержит РОВНО номер заказа, без ссылок и префиксов: терминал ждёт именно его,
 * как на листке закройщика.
 *
 * Формат 58×40 мм — тот же рулон наклеек, что стоит во всех принтерах цеха.
 */
export const printOrderQrTag = async (data: OrderQrTagData) => {
  // Библиотека QR весит заметно и нужна только в момент печати — грузим по требованию.
  const { default: QRCode } = await import('qrcode');
  const qr = await QRCode.toDataURL(data.orderNumber, { width: 240, margin: 0 });

  const size =
    data.width && data.height ? `${data.width}×${data.height}` : '';
  const title = [data.material, size].filter(Boolean).join(' ');
  const source = [data.marketplace, data.orderType].filter(Boolean).join(' ');

  // Длинный номер заказа (у Яндекса он с суффиксами) не влезает крупным кеглем —
  // уменьшаем шрифт, но не переносим: разорванный номер невозможно продиктовать.
  const numFont =
    data.orderNumber.length > 22 ? '9pt' : data.orderNumber.length > 17 ? '11pt' : '13pt';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>QR заказа ${esc(data.orderNumber)}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 58mm;
      height: 40mm;
      padding: 1mm 1.5mm;
      font-family: Arial, Helvetica, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4mm;
      overflow: hidden;
    }
    /* Материал и размер сверху: по ним в цехе находят саму вещь. */
    .title {
      font-size: 11pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.05;
      max-height: 7mm;
      overflow: hidden;
    }
    /* QR — главное на бирке, ради него всё и печатается. */
    .qr img { width: 19mm; height: 19mm; display: block; }
    .num {
      font-size: ${numFont};
      font-weight: bold;
      text-align: center;
      line-height: 1.05;
      font-family: 'Courier New', monospace;
      white-space: nowrap;
    }
    .src { font-size: 7pt; font-weight: bold; text-align: center; line-height: 1.1; }
    /* Подпись, чтобы бирку не спутали со стикером отправления и не наклеили на пакет. */
    .hint {
      font-size: 6pt;
      text-align: center;
      line-height: 1.1;
      border-top: 0.2mm solid #000;
      padding-top: 0.4mm;
      width: 100%;
    }
  </style>
</head>
<body>
  ${title ? `<div class="title">${esc(title)}</div>` : ''}
  <div class="qr"><img src="${qr}" alt="" /></div>
  <div class="num">${esc(data.orderNumber)}</div>
  ${source ? `<div class="src">${esc(source)}</div>` : ''}
  <div class="hint">Замена листка закройщика — отсканируйте на терминале</div>
</body>
</html>`;

  printHtmlInIframe(html);
};

export default printOrderQrTag;
