import printHtmlInIframe from '@/lib/printInIframe';
import loadPdfjs from '@/lib/pdfjs';

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

  const pdfjs = await loadPdfjs();

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
 * Короб поставки в том виде, в каком он нужен для подписи наклейки.
 *
 * Намеренно не завязываемся на полный тип короба: печати нужны только два
 * номера — наш и площадки.
 */
export interface BoxCaptionSource {
  boxNumber: number;
  ozonCargoId?: number | null;
}

const escapeHtml = (v: string): string =>
  v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/**
 * Строка подписи: наш номер короба слева, ID грузоместа OZON справа.
 *
 * Оба номера обязательны именно вместе. Наш номер — то, чем короб называют в
 * цехе и в системе; ID грузоместа — то, что видит приёмка маркетплейса. Пока
 * на наклейке был только второй, кладовщик не мог понять, какой это короб, и
 * сверял их вручную по списку.
 */
const boxCaption = (box: BoxCaptionSource, all?: BoxCaptionSource[]): string => {
  const total = all?.length || 0;
  const left = total > 1
    ? `Короб ${box.boxNumber} из ${total}`
    : `Короб ${box.boxNumber}`;
  const right = box.ozonCargoId
    ? `<div class="cargo"><span>Грузоместо OZON</span>${escapeHtml(String(box.ozonCargoId))}</div>`
    : '';
  return `<div class="cap"><div class="box">${escapeHtml(left)}</div>${right}</div>`;
};

/** Подпись, когда короб известен только по номеру грузоместа. */
const captionFor = (cargoId: number | null, all?: BoxCaptionSource[]): string => {
  const box = cargoId ? all?.find((b) => b.ozonCargoId === cargoId) : undefined;
  if (box) return boxCaption(box, all);
  // Короб не опознан: печатать пустую шапку нельзя — кладовщик решит, что
  // наклейка бракованная. Показываем хотя бы номер грузоместа площадки.
  if (!cargoId) return '';
  return `<div class="cap"><div class="box">Грузоместо ${escapeHtml(String(cargoId))}</div></div>`;
};

/**
 * Печать стикера короба FBO на стандартной наклейке 120×75 мм.
 *
 * OZON отдаёт готовый стикер короба PDF-ссылкой.
 *
 * ПОЧЕМУ НЕ ЧЕРЕЗ <iframe src="…pdf">. Раньше PDF вставлялся вложенным iframe
 * внутрь печатной страницы — и на печать уходил ПУСТОЙ БЕЛЫЙ ЛИСТ. Браузер
 * печатает содержимое вложенного PDF-просмотрщика только если тот успел
 * загрузиться и отрисоваться, а команда печати уходит раньше; в Chrome
 * вложенные PDF в печать не попадают вовсе.
 *
 * Поэтому страницы PDF рисуем сами в картинки (300 dpi) и печатаем их как
 * обычные изображения — тем же способом, что и ярлыки отправлений.
 *
 * В файле от OZON может быть НЕСКОЛЬКО страниц: площадка отдаёт один PDF на
 * все грузоместа заявки, по странице на каждое.
 *
 * cargoId — номер грузоместа ЭТОГО короба. Если он задан, из файла печатается
 * ТОЛЬКО его страница.
 *
 * Зачем: у коробов, закрытых до того, как мы научились резать ответ OZON, в
 * стикере лежит полный файл заявки. Печать выдавала пачку наклеек на все
 * короба разом — кладовщик клеил чужие грузоместа на свой короб, и на приёмке
 * это расходилось с документами. Свою страницу узнаём по напечатанному на ней
 * ID грузоместа.
 */
export const printBoxLabelFromUrl = async (
  url: string,
  title = 'Стикер короба',
  cargoId?: number | null,
  boxes?: BoxCaptionSource[],
): Promise<void> => {
  if (!url) return;

  const res = await fetch(url);
  const blob = await res.blob();
  const base64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // Картинку печатаем как есть — разбирать через pdf.js нечего.
  const isPdf = atob(base64.slice(0, 8)).startsWith('%PDF');
  if (!isPdf) {
    const type = blob.type || 'image/png';
    printHtmlInIframe(boxLabelHtml(title, [{
      src: `data:${type};base64,${base64}`,
      caption: captionFor(cargoId ?? null, boxes),
    }]));
    return;
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const pdfjs = await loadPdfjs();

  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const scale = 300 / 72;
  const pages: LabelPage[] = [];

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);

    // ЧИТАЕМ ЦИФРЫ СО СТРАНИЦЫ — ПО НИМ УЗНАЁМ ГРУЗОМЕСТО.
    //
    // ID напечатан на наклейке дважды: с пробелом-разделителем и целиком под
    // штрихкодом. Оставляем только цифры — так разделители не мешают.
    //
    // Нужно это для двух вещей сразу: отобрать страницу своего короба и
    // подписать её крупным номером (какой короб и какое грузоместо).
    let digits = '';
    if (cargoId || boxes?.length) {
      const text = await page.getTextContent();
      digits = text.items
        .map((i) => ('str' in i ? i.str : ''))
        .join('')
        .replace(/\D/g, '');
    }
    if (cargoId && !digits.includes(String(cargoId))) continue;

    // Ищем, какому коробу принадлежит страница: сверяем напечатанный ID
    // грузоместа со списком коробов поставки. При печати пачкой порядок
    // страниц задаёт сервер, но полагаться на него нельзя — подпись должна
    // соответствовать тому, что реально напечатано на наклейке.
    const matched = boxes?.find((b) => b.ozonCargoId && digits.includes(String(b.ozonCargoId)));
    const caption = matched
      ? boxCaption(matched, boxes)
      : captionFor(cargoId ?? null, boxes);

    // Наклейка горизонтальная (120×75) — тот же стандартный рулон, что и под
    // упаковочные листы. Если страница пришла вертикальной (OZON отдаёт стикер
    // книжной ориентации) — поворачиваем, иначе стикер займёт узкую полосу
    // посреди наклейки и коды не прочитаются.
    const base = page.getViewport({ scale });
    const viewport = base.height > base.width
      ? page.getViewport({ scale, rotation: (page.rotate + 90) % 360 })
      : base;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    // Белая подложка: фон в PDF прозрачный, без неё на печати выходит чёрное.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ src: canvas.toDataURL('image/png'), caption });
  }

  // Своё грузоместо в файле не нашлось (формат наклейки у OZON изменился) —
  // печатаем файл целиком. Лишняя наклейка лучше, чем пустая печать и короб,
  // уехавший без маркировки вовсе.
  if (pages.length === 0 && cargoId && pdf.numPages > 0) {
    return printBoxLabelFromUrl(url, title, null, boxes);
  }

  if (pages.length === 0) return;
  printHtmlInIframe(boxLabelHtml(title, pages));
};

/** Одна наклейка: картинка от площадки плюс наша крупная подпись сверху. */
interface LabelPage {
  src: string;
  caption: string;
}

/**
 * Печатная страница наклейки короба 120×75.
 *
 * СВЕРХУ — НАША ПОДПИСЬ КРУПНО, НИЖЕ — НАКЛЕЙКА ПЛОЩАДКИ.
 *
 * На стикере OZON номер грузоместа напечатан мелко и в общей массе цифр:
 * кладовщик не мог опознать короб, не поднося наклейку к глазам. А главное —
 * наш номер короба (1, 2, 3…) и номер грузоместа на площадке НЕ СОВПАДАЮТ:
 * в системе значится «короб 3», на стикере — восьмизначный ID, и сверить их
 * было не с чем.
 *
 * Поэтому печатаем оба номера одной строкой: слева наш («Короб 3 из 7»),
 * справа — ID грузоместа OZON. Кладовщик читает свой номер, приёмка сканирует
 * свой, и расхождения больше нет.
 *
 * Картинку площадки НЕ ТРОГАЕМ и не масштабируем по своему усмотрению — она
 * занимает всё оставшееся место как есть, коды на ней печатаются в полный
 * размер и читаются сканером.
 */
const boxLabelHtml = (title: string, pages: LabelPage[]) => `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: 120mm 75mm landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
    .sheet {
      width: 120mm;
      height: 75mm;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      page-break-after: always;
    }
    .sheet:last-child { page-break-after: auto; }
    /* Подпись во всю ширину: крупные цифры читаются с вытянутой руки, поэтому
       кладовщику не приходится нагибаться к коробу, чтобы опознать его. */
    .cap {
      flex: 0 0 auto;
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 3mm; padding: 1mm 3mm 0.5mm;
      border-bottom: 0.4mm solid #000;
    }
    .cap .box { font-size: 20pt; font-weight: 800; line-height: 1; white-space: nowrap; }
    /* Номер грузоместа — то, что сверяют с маркетплейсом, поэтому он такой же
       крупный, как наш номер короба, и набран моноширинно: в длинной цепочке
       цифр так не сбиваются при сверке со списком на площадке. */
    .cap .cargo {
      font-size: 16pt; font-weight: 700; line-height: 1;
      text-align: right; white-space: nowrap;
      font-family: 'Courier New', monospace; letter-spacing: 0.2pt;
    }
    .cap .cargo span {
      display: block; font-size: 7pt; font-weight: 400; color: #333;
      font-family: Arial, Helvetica, sans-serif; letter-spacing: 0;
    }
    .pic { flex: 1; min-height: 0; }
    .pic img { width: 100%; height: 100%; display: block; object-fit: contain; }
  </style>
</head>
<body>${pages.map((p) => `<div class="sheet">${p.caption}<div class="pic"><img src="${p.src}" alt="${title}" /></div></div>`).join('')}</body>
</html>`;