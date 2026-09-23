import printHtmlInIframe from '@/lib/printInIframe';
import JsBarcode from 'jsbarcode';

export interface RepairStickerData {
  /** Номер куска вида RS-000042 — он же стоит в карточке заказа у закройщицы. */
  barcode: string;
  /** Материал куска: по нему отрез опознают на стеллаже. */
  material?: string | null;
  width?: number | null;
  height?: number | null;
  /** За что вещь ушла в перешив — главное, что читает закройщица. */
  reason?: string | null;
  /** Номер заказа, из которого пришла вещь. */
  orderNumber?: string | null;
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Стикер куска на перешив 58×40 мм.
 *
 * ЗАЧЕМ ОН НУЖЕН. Раньше вещь уходила в перешив без наклейки: в цехе на
 * стеллаже лежала стопка одинаковых с виду отрезов, а в системе — строки
 * «Вуаль 300×255». Найти нужный кусок можно было только развернув половину
 * стопки, и что именно с ним не так — тоже выяснялось разворачиванием.
 *
 * На наклейке крупно два самых важных поля:
 *   · НОМЕР — тот же, что закройщица видит в карточке заказа. Она берёт отрез
 *     с первого раза, не трогая соседние;
 *   · ПРИЧИНА — где искать брак. «Дырка на ткани» значит смотреть полотно,
 *     «кривой шов» — ткань целая и кроить можно смело.
 *
 * Шапка фиолетовая (в печати — серая заливка), как и весь перешив в системе:
 * стикер не спутаешь ни со складским GW, ни с чёрным «БРАК».
 */
export const printRepairSticker = (data: RepairStickerData) => {
  const canvas = document.createElement('canvas');
  // Номер под штрихкодом не рисуем: мелкая подпись не читается через стол.
  // Ниже он идёт крупной HTML-строкой.
  JsBarcode(canvas, data.barcode, {
    format: 'CODE128',
    width: 2,
    height: 40,
    displayValue: false,
    margin: 0,
  });
  const barcodeImg = canvas.toDataURL('image/png');

  const size =
    data.width && data.height ? `${data.width} × ${data.height}` : '';
  const title = [data.material || '', size].filter(Boolean).join(' ');
  const reason = (data.reason || '').trim();
  const order = (data.orderNumber || '').trim();

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Перешив ${esc(data.barcode)}</title>
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
      /* Содержимое растянуто на всю наклейку, а не сбито в верхнюю треть:
         пустая нижняя половина — это выброшенные миллиметры, на которых
         номер и причина могли быть крупнее и читаться через стол. */
      justify-content: space-between;
      overflow: hidden;
    }
    .flag {
      width: 100%;
      background: #000;
      color: #fff;
      font-size: 9pt;
      font-weight: bold;
      text-align: center;
      letter-spacing: 1px;
      padding: 0.6mm 0;
    }
    .title {
      font-size: 8.5pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      max-height: 5mm;
      overflow: hidden;
    }
    .bc img { width: 50mm; height: auto; display: block; }
    .code {
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 1px;
      line-height: 1;
    }
    /* Причина — вторая по важности строка после номера, поэтому в рамке:
       глаз находит её, не вчитываясь в остальное. */
    .reason {
      width: 100%;
      border: 0.4mm solid #000;
      font-size: 8pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      padding: 0.6mm 0.5mm;
      word-break: break-word;
      max-height: 8mm;
      overflow: hidden;
    }
    .order {
      font-size: 6pt;
      color: #333;
      text-align: center;
      width: 100%;
      word-break: break-all;
      max-height: 3.5mm;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="flag">НА ПЕРЕШИВ</div>
  ${title ? `<div class="title">${esc(title)}</div>` : ''}
  <div class="bc"><img src="${barcodeImg}" alt="${esc(data.barcode)}" /></div>
  <div class="code">${esc(data.barcode)}</div>
  ${reason ? `<div class="reason">${esc(reason)}</div>` : ''}
  ${order ? `<div class="order">${esc(order)}</div>` : ''}
</body>
</html>`;

  printHtmlInIframe(html);
};

export default printRepairSticker;