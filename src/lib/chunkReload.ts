/**
 * Спасение от «вечного кружка» после обновления системы.
 *
 * Приложение разбито на части, которые подгружаются по мере надобности, и при каждом
 * обновлении у этих файлов меняются имена. Если у сотрудника открыта старая вкладка,
 * она просит файл со старым именем — на сервере его уже нет. Запрос падает, экран
 * загрузки застывает навсегда, и человек видит бесконечный кружок.
 *
 * Здесь мы такую ошибку ловим и один раз перезагружаем страницу — она подтянет свежую
 * версию. Флаг в sessionStorage защищает от петли: если и после перезагрузки не вышло,
 * значит дело не в обновлении, и лучше показать честную ошибку, чем моргать страницей.
 */

const RELOAD_FLAG = 'megatul-chunk-reloaded';

/** Ошибка именно про недогруженный кусок приложения, а не про сбой в коде. */
const isChunkError = (message: string): boolean => {
  const text = message.toLowerCase();
  return (
    text.includes('failed to fetch dynamically imported module') ||
    text.includes('error loading dynamically imported module') ||
    text.includes('importing a module script failed') ||
    text.includes('loading chunk') ||
    text.includes('loading css chunk') ||
    // Браузер может не назвать причину, а просто сообщить, что файл сборки не
    // скачался. Такие файлы лежат в /assets/ и меняют имена при каждом обновлении —
    // значит, у сотрудника открыта устаревшая версия страницы.
    (text.includes('failed to fetch') && text.includes('/assets/')) ||
    (text.includes('unexpected token') && text.includes('<'))
  );
};

/** Один раз перезагружает страницу, чтобы забрать свежую версию приложения. */
const reloadOnce = (): boolean => {
  if (sessionStorage.getItem(RELOAD_FLAG)) return false;
  sessionStorage.setItem(RELOAD_FLAG, '1');

  // Служебный файл мог отдать старую оболочку из памяти — чистим, иначе
  // перезагрузка вернёт ту же самую устаревшую версию.
  const done = () => window.location.reload();
  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .finally(done);
  } else {
    done();
  }
  return true;
};

/** Ставит перехватчики. Вызывается один раз при старте приложения. */
export const setupChunkReload = () => {
  // Успешная загрузка — снимаем флаг, чтобы следующее обновление снова сработало.
  window.addEventListener('load', () => {
    window.setTimeout(() => sessionStorage.removeItem(RELOAD_FLAG), 5000);
  });

  window.addEventListener('error', (event) => {
    if (event.message && isChunkError(event.message)) reloadOnce();
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      typeof reason === 'string' ? reason : reason?.message || '';
    if (message && isChunkError(message)) {
      event.preventDefault();
      reloadOnce();
    }
  });

  // Vite сообщает о неудачной подгрузке части приложения отдельным событием. Без него
  // ошибка всплывала в интерфейс английским текстом («Failed to fetch dynamically
  // imported module») — сотрудник в цехе не понимал, что делать.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnce();
  });
};

export const isChunkLoadError = isChunkError;
