/**
 * Отслеживание новых версий системы.
 *
 * Раньше новая версия применялась молча и сразу. Это опасно: сотрудник может в этот
 * момент заполнять форму приёмки или собирать отгрузку — страница перезагрузится
 * посреди работы, и введённое пропадёт. Поэтому теперь новая версия ждёт, а человеку
 * показывается предложение обновиться, когда ему удобно.
 *
 * Проверяем обновления при открытии системы, при возврате на вкладку и раз в полчаса:
 * планшет в цехе может не закрываться сутками.
 */

/** Как часто проверять наличие новой версии (планшет работает весь день). */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

type UpdateListener = (available: boolean) => void;

let waitingWorker: ServiceWorker | null = null;
let listener: UpdateListener | null = null;
let reloading = false;

const notify = (available: boolean) => {
  if (listener) listener(available);
};

/** Новая версия скачана и ждёт применения. */
const trackWaiting = (worker: ServiceWorker | null) => {
  if (!worker) return;
  waitingWorker = worker;
  notify(true);
};

/**
 * Начинает следить за обновлениями.
 *
 * @param onAvailable вызывается, когда новая версия скачана и готова к установке
 */
export const watchForUpdates = (onAvailable: UpdateListener) => {
  listener = onAvailable;

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready
    .then((reg) => {
      // Версия могла скачаться ещё до того, как мы начали слушать.
      if (reg.waiting && navigator.serviceWorker.controller) trackWaiting(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // controller === null означает первую установку, а не обновление:
          // в этом случае предлагать «обновиться» незачем.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            trackWaiting(installing);
          }
        });
      });

      const check = () => reg.update().catch(() => {});

      // Возврат на вкладку — самый частый момент, когда человек готов обновиться.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.setInterval(check, CHECK_INTERVAL_MS);
    })
    .catch(() => {
      // Служебный файл недоступен — система работает как обычный сайт.
    });

  // Новая версия вступила в силу — перезагружаем страницу один раз.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
};

/** Применяет скачанную версию: сотрудник нажал «Обновить». */
export const applyUpdate = () => {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  // Обновление ждёт, но ссылку на него потеряли — просто перезагружаемся.
  window.location.reload();
};
