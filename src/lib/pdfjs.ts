/**
 * ЕДИНАЯ ТОЧКА ЗАГРУЗКИ pdf.js ДЛЯ ВСЕЙ ПЕЧАТИ.
 *
 * ПОЧЕМУ LEGACY-СБОРКА, А НЕ ОБЫЧНАЯ.
 *
 * Обычная сборка pdf.js рассчитана на свежие браузеры и вызывает
 * `Promise.withResolvers` — метод, появившийся только весной 2024 года. На
 * планшетах и терминалах в цехе стоят браузеры постарше, и печать там падала
 * с «Promise.withResolvers is not a function»: кладовщик жал «Печать всех
 * стикеров коробов» и получал красную плашку вместо наклеек.
 *
 * В legacy-сборке те же самые возможности, но недостающие методы языка
 * подложены полифилами внутри самого файла. Она чуть тяжелее — и это
 * единственная цена; грузится она всё равно только в момент печати.
 *
 * ВАЖНО: главный файл и файл воркера должны браться ИЗ ОДНОЙ сборки. Если
 * взять обычный воркер к legacy-ядру, ошибка просто переедет внутрь воркера,
 * где её не видно, — печать молча выдаст пустой лист.
 *
 * Воркер берём из своей же сборки (`?url`), а не из интернета: терминал в
 * цехе может работать без внешнего доступа.
 */

type PdfjsModule = typeof import('pdfjs-dist');

let loading: Promise<PdfjsModule> | null = null;

/** Возвращает готовый к работе pdf.js с уже настроенным воркером. */
const loadPdfjs = (): Promise<PdfjsModule> => {
  if (!loading) {
    loading = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const workerSrc = (
        await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs as unknown as PdfjsModule;
    })().catch((e) => {
      // Неудачную загрузку не запоминаем: связь могла моргнуть, и следующая
      // попытка печати должна начинаться с чистого листа.
      loading = null;
      throw e;
    });
  }
  return loading;
};

export default loadPdfjs;
