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

/** Ярлык-PDF (OZON и Яндекс отдают PDF в base64). */
export const printLabelPdf = (pdfBase64: string, title = 'Ярлык отправления') => {
  if (!pdfBase64) return;
  const src = pdfBase64.startsWith('data:')
    ? pdfBase64
    : `data:application/pdf;base64,${pdfBase64}`;
  // Ярлык печатаем прямо с терминала: встроенный просмотрщик PDF отдаёт файл на принтер
  // как есть, сохраняя исходный размер страницы. Открывается обычный диалог печати —
  // упаковщица не уходит с экрана заказа.
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    html, body { margin: 0; padding: 0; height: 100%; }
    iframe { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body><iframe src="${src}"></iframe></body>
</html>`;

  printHtmlInIframe(html);
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
