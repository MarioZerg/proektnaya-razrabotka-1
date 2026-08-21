import printHtmlInIframe from '@/lib/printInIframe';

/**
 * Ярлык Яндекс Маркета на термонаклейке 58×40 мм.
 *
 * Яндекс отдаёт ярлык ВЕРТИКАЛЬНЫМ — 40×58 мм. На нашу горизонтальную наклейку
 * он ложился двумя плохими способами:
 *   · вписать как есть — ярлык занимал 27 мм из 58, половина наклейки пустая,
 *     а QR ужимался с 12 до 8 мм и переставал читаться сканером;
 *   · повернуть целиком — наклейка заполнялась, но весь текст вставал боком,
 *     и кладовщику приходилось вертеть коробку, чтобы прочесть номер заказа.
 *
 * Поэтому ярлык пересобираем: берём с оригинала оба кода как картинки (их
 * рисовать самим нельзя — сканер на приёмке принимает только коды Яндекса) и
 * раскладываем на наклейке горизонтально вместе с текстом. Коды печатаются в
 * полный размер, текст читается без поворота.
 */

/** Данные для текстовой части — приходят вместе с ярлыком. */
export interface YandexLabelInfo {
  /** Номер заказа: крупно, по нему ищут отправление. */
  orderId: string;
  /** Номер грузоместа «60603398529-1» — его сканируют в поставку. */
  placeNumber: string;
  /** «1/3» — какое это место из скольких. */
  placeIndex: string;
  /** Получатель и перевозчик читаются из самого ярлыка: в наших данных их нет. */
  recipient?: string;
  carrier?: string;
  date?: string;
}

/**
 * Достаёт из ярлыка подписи, которых нет в нашей базе: имя получателя и
 * перевозчика. Яндекс печатает их только на самом ярлыке, а на наклейке они
 * нужны — по ним на складе раскладывают посылки по перевозчикам.
 */
const readTexts = async (
  page: { getTextContent: () => Promise<{ items: unknown[] }> },
): Promise<{ recipient: string; carrier: string; date: string }> => {
  const content = await page.getTextContent();
  const lines = content.items
    .map((i) => (i as { str?: string }).str || '')
    .map((v) => v.trim())
    .filter(Boolean);

  // Ярлык устроен подписями: строка-заголовок, под ней значение.
  const after = (label: string) => {
    const idx = lines.findIndex((l) => l.toLowerCase() === label);
    return idx >= 0 && lines[idx + 1] ? lines[idx + 1] : '';
  };

  const date = lines.find((l) => /^\d{2}\.\d{2}\.\d{4}$/.test(l)) || '';
  // «перевозчик» на ярлыке встречается дважды: берём последнее — там название
  // компании, а не пункта выдачи.
  const carrierIdx = lines.map((l, i) => (l.toLowerCase() === 'перевозчик' ? i : -1))
    .filter((i) => i >= 0)
    .pop();
  const carrier = carrierIdx !== undefined ? lines.slice(carrierIdx + 1, carrierIdx + 3).join(' ') : '';

  return { recipient: after('получатель'), carrier, date };
};

/** Вырезанный с оригинала код — как картинка в base64. */
interface Codes {
  main: string;
  place: string;
}

/**
 * Находит на отрисованном ярлыке два кода и вырезает их.
 *
 * Ищем по плотности тёмных точек: код — это плотный квадрат, какого больше
 * нигде на ярлыке нет. Привязываться к координатам нельзя — Яндекс меняет
 * вёрстку, и жёсткие числа однажды вырежут пустое место.
 */
const extractCodes = (
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Codes | null => {
  const { width: W, height: H } = canvas;
  const data = ctx.getImageData(0, 0, W, H).data;

  const isDark = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128;
  };

  /** Границы плотной области внутри окна: доля тёмного выше порога. */
  const findBox = (x0: number, y0: number, x1: number, y1: number) => {
    const rows: number[] = [];
    const cols: number[] = [];
    for (let y = y0; y < y1; y += 1) {
      let n = 0;
      for (let x = x0; x < x1; x += 1) if (isDark(x, y)) n += 1;
      rows.push(n / (x1 - x0));
    }
    for (let x = x0; x < x1; x += 1) {
      let n = 0;
      for (let y = y0; y < y1; y += 1) if (isDark(x, y)) n += 1;
      cols.push(n / (y1 - y0));
    }
    const ys = rows.map((v, i) => (v > 0.25 ? i : -1)).filter((i) => i >= 0);
    const xs = cols.map((v, i) => (v > 0.25 ? i : -1)).filter((i) => i >= 0);
    if (!ys.length || !xs.length) return null;
    return {
      x: x0 + xs[0],
      y: y0 + ys[0],
      w: xs[xs.length - 1] - xs[0] + 1,
      h: ys[ys.length - 1] - ys[0] + 1,
    };
  };

  const cut = (box: { x: number; y: number; w: number; h: number }) => {
    // Белые поля вокруг кода — «тихая зона». Без неё сканер упирается в край
    // картинки и код не читает, каким бы чётким он ни был.
    const pad = Math.round(Math.max(box.w, box.h) * 0.08);
    const side = Math.max(box.w, box.h) + pad * 2;
    const c = document.createElement('canvas');
    c.width = side;
    c.height = side;
    const cx = c.getContext('2d');
    if (!cx) return '';
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, side, side);
    // Код кладём по центру квадрата: так он не растянется в CSS по ширине.
    cx.drawImage(
      canvas,
      box.x, box.y, box.w, box.h,
      Math.round((side - box.w) / 2), Math.round((side - box.h) / 2),
      box.w, box.h,
    );
    return c.toDataURL('image/png');
  };

  // Главный код — вверху справа, код грузоместа — внизу слева.
  const top = findBox(Math.round(W * 0.45), 0, W, Math.round(H * 0.3));
  const bottom = findBox(0, Math.round(H * 0.7), Math.round(W * 0.42), H);
  if (!top || !bottom) return null;
  return { main: cut(top), place: cut(bottom) };
};

/**
 * Печатает ярлык Яндекса на наклейке 58×40.
 *
 * @param pdfBase64 ярлык от Яндекса как есть
 * @param info      что написать текстом рядом с кодами
 */
export const buildYandexLabelHtml = async (
  pdfBase64: string,
  info: YandexLabelInfo,
): Promise<string> => {
  if (!pdfBase64) return '';
  const base64 = pdfBase64.startsWith('data:')
    ? pdfBase64.slice(pdfBase64.indexOf(',') + 1)
    : pdfBase64;

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const pdfjs = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);

  // 300 dpi: коды вырезаем в печатном разрешении, иначе на наклейке они
  // получатся мыльными и сканер их не возьмёт.
  const viewport = page.getViewport({ scale: 300 / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const codes = extractCodes(canvas, ctx);
  // Подписи с ярлыка: имя получателя и перевозчика есть только там.
  const texts = await readTexts(page);

  // Коды не нашлись (Яндекс поменял вёрстку) — печатаем оригинал с поворотом.
  // Ярлык при этом останется рабочим: коды на месте, просто текст боком.
  // Коды не нашлись (Яндекс поменял вёрстку) — пусть печатается оригинал.
  if (!codes) return '';

  const esc = (v?: string) =>
    (v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Ярлык Яндекс Маркета</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; width: 58mm; height: 40mm;
      overflow: hidden; font-family: Arial, Helvetica, sans-serif; color: #000;
    }
    .sheet { display: flex; width: 58mm; height: 40mm; padding: 1mm; gap: 1.2mm;
             align-items: stretch; }
    .left { display: flex; flex-direction: column; justify-content: flex-start;
            gap: 1mm; flex: 0 0 auto; }
    .qr-main { width: 19mm; height: 19mm; display: block; }
    .qr-place { width: 16mm; height: 16mm; display: block; }
    .right { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .cap { font-size: 5.5pt; line-height: 1.1; color: #333; }
    .order { font-size: 10.5pt; font-weight: 700; line-height: 1.05;
             letter-spacing: -0.2pt; white-space: nowrap; }
    .place { font-size: 8.5pt; font-weight: 700; line-height: 1.1; white-space: nowrap; }
    .row { font-size: 6.5pt; line-height: 1.15; overflow: hidden;
           text-overflow: ellipsis; white-space: nowrap; }
    .idx { font-size: 8.5pt; font-weight: 700; border: 0.35mm solid #000;
           border-radius: 0.8mm; padding: 0 1mm; white-space: nowrap; flex: 0 0 auto; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1mm; }
    .date { font-size: 6pt; color: #333; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="left">
      <img class="qr-main" src="${codes.main}" alt="код заказа" />
      <img class="qr-place" src="${codes.place}" alt="код грузоместа" />
    </div>
    <div class="right">
      <div class="top">
        <div>
          <div class="cap">номер заказа</div>
          <div class="order">${esc(info.orderId)}</div>
        </div>
        <div class="idx">${esc(info.placeIndex)}</div>
      </div>

      <div style="margin-top:1mm">
        <div class="cap">грузоместо</div>
        <div class="place">${esc(info.placeNumber)}</div>
      </div>

      <div style="margin-top:1mm">
        <div class="cap">получатель</div>
        <div class="row"><b>${esc(info.recipient || texts.recipient)}</b></div>
      </div>

      <div style="margin-top:0.8mm">
        <div class="cap">перевозчик</div>
        <div class="row">${esc(info.carrier || texts.carrier)}</div>
      </div>

      <div style="margin-top:auto" class="date">${esc(info.date || texts.date)}</div>
    </div>
  </div>
</body>
</html>`;

  return html;
};

/** Печать наклейки. Если пересобрать не вышло — печатаем оригинал с поворотом. */
export const printYandexLabel58x40 = async (
  pdfBase64: string,
  info: YandexLabelInfo,
) => {
  const html = await buildYandexLabelHtml(pdfBase64, info);
  if (!html) {
    const { printLabelPdf } = await import('@/lib/printMarketplaceLabel');
    await printLabelPdf(pdfBase64, 'Ярлык Яндекс Маркета');
    return;
  }
  printHtmlInIframe(html);
};

export default printYandexLabel58x40;
