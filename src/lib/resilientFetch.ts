/**
 * Устойчивость к обрывам связи.
 *
 * В цехе интернет проседает постоянно: планшет на секунду теряет вышку, роутер
 * моргает. Одного такого мига хватало, чтобы запрос за данными упал, а раздел
 * остался пустым — сотрудник видел «нет данных» и шёл перезагружать страницу.
 *
 * Здесь мы один раз оборачиваем обычные запросы приложения и:
 *  1) даём каждому запросу предел ожидания — иначе браузер висит минутами;
 *  2) при обрыве СВЯЗИ (не ошибке сервера) молча повторяем попытку.
 *
 * Повторяем ТОЛЬКО чтение (GET). Отправку данных — приёмку, списание, закрытие
 * заказа — не повторяем никогда: неизвестно, дошла ли она до сервера, и повтор
 * мог бы провести операцию дважды. Деньги и остатки задваивать нельзя.
 */

/** Сколько ждём ответ, прежде чем считать запрос зависшим. */
const TIMEOUT_MS = 20000;

/** Сколько раз повторяем чтение при обрыве связи. */
const RETRIES = 2;

/** Пауза перед повтором — даём связи восстановиться. */
const RETRY_DELAY_MS = 700;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Наши серверные запросы: только их имеет смысл повторять. */
const isAppRequest = (url: string): boolean =>
  url.includes('functions.poehali.dev') || url.startsWith('/api');

export const setupResilientFetch = () => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Чужие запросы и отправку данных пропускаем как есть, без вмешательства.
    if (!isAppRequest(url) || method !== 'GET') return originalFetch(input, init);

    // Если запрос уже умеет отменяться сам (страница закрыта, фильтр сменился),
    // не мешаем: свой предел ожидания не навязываем.
    const hasOwnSignal = Boolean(init?.signal);

    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const controller = hasOwnSignal ? null : new AbortController();
      const timer = controller
        ? window.setTimeout(() => controller.abort(), TIMEOUT_MS)
        : null;

      try {
        const response = await originalFetch(input, {
          ...init,
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (timer) window.clearTimeout(timer);
        return response;
      } catch (error) {
        if (timer) window.clearTimeout(timer);
        lastError = error;

        // Запрос отменило само приложение — повторять нечего.
        if (hasOwnSignal && (error as Error)?.name === 'AbortError') throw error;

        // Попытки кончились — отдаём ошибку наверх, как раньше.
        if (attempt === RETRIES) break;

        await wait(RETRY_DELAY_MS * (attempt + 1));
      }
    }

    throw lastError;
  };
};
