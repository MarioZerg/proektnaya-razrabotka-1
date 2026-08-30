import printHtmlInIframe from '@/lib/printInIframe';

/**
 * Печать маркетплейсного ярлыка отправления FBS на термонаклейке 58×40 мм.
 *
 * Ярлык приходит готовым от маркетплейса (PDF у OZON и Яндекса, PNG у WB) — свой аналог
 * рисовать нельзя: на складе принимают только их ярлык с их кодами и разметкой. Наша задача
 * — напечатать полученный файл ровно на наклейке 58×40, без полей и масштабирования.
 */

const openPrintWindow = (title: string, bodyHtml: string) => {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 58mm; height: 40mm; overflow: hidden; }
    img, embed, iframe {
      width: 58mm;
      height: 40mm;
      display: block;
      object-fit: contain;
      border: 0;
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;

  printHtmlInIframe(html);
};

/** Ярлык-картинка (WB отдаёт PNG в base64). */
export const printLabelPng = (pngBase64: string, title = 'Стикер отправления') => {
  if (!pngBase64) return;
  const src = pngBase64.startsWith('data:')
    ? pngBase64
    : `data:image/png;base64,${pngBase64}`;
  openPrintWindow(title, `<img src="${src}" alt="${title}" />`);
};

/**
 * Ярлык-PDF (OZON и Яндекс отдают PDF в base64).
 *
 * PDF не отдаём встроенному просмотрщику браузера: он рисует вокруг страницы свою
 * серо-чёрную рамку, вписывает лист с полями и пересчитывает всё в экранном
 * разрешении — из-за этого название города на ярлыке OZON расплывалось в пиксели,
 * а сам ярлык не занимал всю наклейку.
 *
 * Вместо этого страницу рисуем сами в картинку с большим запасом по разрешению
 * (300 dpi) и растягиваем ровно на 58×40 мм. Никакой рамки, текст чёткий,
 * ярлык на всю площадь наклейки.
 */
export const printLabelPdf = async (pdfBase64: string, title = 'Ярлык отправления') => {
  if (!pdfBase64) return;
  const base64 = pdfBase64.startsWith('data:')
    ? pdfBase64.slice(pdfBase64.indexOf(',') + 1)
    : pdfBase64;

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const pdfjs = await import('pdfjs-dist');
  // Воркер берём из той же сборки — иначе pdf.js полезет за файлом в интернет,
  // а терминал в цехе может работать без внешнего доступа.
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);

  // 300 dpi: пункты PDF (1/72 дюйма) переводим в пиксели печати.
  const scale = 300 / 72;

  // Яндекс отдаёт ярлык ВЕРТИКАЛЬНЫМ (40×58 мм), а наклейка у нас горизонтальная
  // (58×40). Такой ярлык вписывался по высоте и занимал лишь 27 мм из 58 — почти
  // половина наклейки оставалась пустой, а QR-код и номер заказа ужимались вдвое
  // и переставали читаться сканером.
  //
  // Поворачиваем страницу на 90°: тогда ярлык ложится на наклейку целиком, без
  // полей, и все коды печатаются в полный размер.
  const base = page.getViewport({ scale });
  const needRotate = base.height > base.width;
  const viewport = needRotate
    ? page.getViewport({ scale, rotation: (page.rotate + 90) % 360 })
    : base;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Белая подложка: в PDF фон прозрачный, и без неё на печати вылезает чёрный фон.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  openPrintWindow(title, `<img src="${canvas.toDataURL('image/png')}" alt="${title}" />`);
};

/**
 * Печать стикера отправления по ССЫЛКЕ на наклейке 58×40 мм.
 *
 * Стикеры WB (QR поставки, ярлыки коробов) лежат у нас файлами в хранилище, и раньше
 * их просто открывали ссылкой в новой вкладке. Дальше кладовщик жал печать уже в
 * просмотрщике браузера — а тот ничего не знает про наклейку: брал A4, книжную
 * ориентацию и поля. Стикер выходил маленьким пятном в углу листа, и его переклеивали
 * вручную.
 *
 * Здесь размер листа задан явно. Формат файла определяем сами: PDF пересобираем в
 * картинку (см. printLabelPdf), картинку печатаем как есть.
 */
export const printLabelFromUrl = async (url: string, title = 'Стикер отправления') => {
  if (!url) return;

  const res = await fetch(url);
  const blob = await res.blob();

  const base64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // По расширению ориентироваться нельзя: WB отдаёт файлы без него, а тип в ссылке
  // не всегда честный. Смотрим сигнатуру самого файла — %PDF в первых байтах.
  const isPdf = atob(base64.slice(0, 8)).startsWith('%PDF');
  if (isPdf) {
    await printLabelPdf(base64, title);
    return;
  }

  const type = blob.type || 'image/png';
  openPrintWindow(title, `<img src="data:${type};base64,${base64}" alt="${title}" />`);
};

/**
 * Печать стикера короба FBO на наклейке 75×120 мм.
 *
 * OZON отдаёт готовый стикер короба PDF-ссылкой. Раньше её просто открывали в новой
 * вкладке — браузер печатал такой PDF на A4, и наклейка выходила не того размера. Здесь
 * задаём размер страницы явно: короб маркируется той же наклейкой 75×120, что и у WB.
 */
export const printBoxLabelFromUrl = (url: string, title = 'Стикер короба') => {
  if (!url) return;
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: 75mm 120mm; margin: 0; }
    html, body { margin: 0; padding: 0; height: 100%; }
    iframe { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body><iframe src="${url}"></iframe></body>
</html>`;

  printHtmlInIframe(html);
};