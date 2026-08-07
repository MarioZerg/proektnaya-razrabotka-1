import JsBarcode from 'jsbarcode';

export interface IndividualStickerData {
  /** Номер заказа вида 00000-07 — по нему находят заказ в системе. */
  orderNumber: string;
  /** Ткань: вуаль, лён, мрамор и т.д. */
  material?: string | null;
  width?: number | null;
  height?: number | null;
  /**
   * Складской штрихкод (GW-000012). Индивидуальный заказ не едет на маркетплейс:
   * до выдачи клиенту вещь лежит на полке, и по этому коду её кладут и находят.
   */
  storageBarcode?: string | null;
  /** Запасная подпись, если ткань и размеры не заданы. */
  product?: string | null;
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Стикер индивидуального заказа 58×40 мм.
 *
 * Отличается от стикера маркетплейса тем, что на нём крупно вынесены ткань и размеры:
 * такие вещи шьются штучно под клиента, и на полке их опознают именно по этим данным,
 * а не по артикулу. Штрихкод берём складской — вещь до выдачи хранится на полке.
 *
 * Если складского кода почему-то нет, кодируем номер заказа: наклейка всё равно
 * должна сканироваться, иначе вещь придётся искать глазами.
 */
export const printIndividualSticker = (data: IndividualStickerData) => {
  const codeValue = (data.storageBarcode || data.orderNumber || '').trim();
  if (!codeValue) return;

  const canvas = document.createElement('canvas');
  JsBarcode(canvas, codeValue, {
    format: 'CODE128',
    width: 2,
    height: 40,
    displayValue: true,
    fontSize: 12,
    margin: 2,
  });
  const barcode = canvas.toDataURL('image/png');

  const hasSize = data.material && data.width && data.height;
  const title = hasSize ? String(data.material) : data.product || 'Индивидуальный заказ';
  const size = hasSize ? `${data.width} × ${data.height}` : '';

  // Длинные названия тканей («Вуаль без утяжелителя усиленная») в две строки не влезают
  // и обрезаются на половине буквы. Уменьшаем шрифт, чтобы название читалось целиком.
  const titleFont = title.length > 26 ? '7pt' : title.length > 18 ? '8.5pt' : '10pt';

  const win = window.open('', '_blank', 'width=420,height=340');
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Индивидуальный заказ ${esc(data.orderNumber)}</title>
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
      gap: 0.3mm;
      overflow: hidden;
    }
    /* Плашка сверху сразу отличает индивидуальный пошив от заказов маркетплейса. */
    .tag {
      font-size: 6pt;
      font-weight: bold;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      background: #000;
      color: #fff;
      padding: 0.3mm 2mm;
      border-radius: 1mm;
      margin-bottom: 0.6mm;
    }
    .material {
      font-size: ${titleFont};
      font-weight: bold;
      line-height: 1.1;
      text-align: center;
      max-width: 55mm;
      max-height: 8mm;
      overflow: hidden;
    }
    /* Размер — главное, что ищут глазами на полке, поэтому он самый крупный. */
    .size {
      font-size: 13pt;
      font-weight: bold;
      line-height: 1.05;
      margin-top: 0.2mm;
    }
    .bc { margin-top: 0.6mm; }
    .bc img { width: 52mm; height: auto; display: block; }
    .order {
      font-size: 7pt;
      color: #222;
      text-align: center;
      line-height: 1.1;
      word-break: break-all;
      max-height: 4mm;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="tag">Индивидуальный заказ</div>
  <div class="material">${esc(title)}</div>
  ${size ? `<div class="size">${esc(size)}</div>` : ''}
  <div class="bc"><img src="${barcode}" alt="${esc(codeValue)}" /></div>
  <div class="order">Заказ ${esc(data.orderNumber)}</div>
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
};
