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

import { getAuthToken } from '@/lib/authToken';
import { isErrorReportUrl, reportError } from '@/lib/errorReporter';

/** Сколько ждём ответ, прежде чем считать запрос зависшим. */
const TIMEOUT_MS = 20000;

/** Сколько раз повторяем чтение при обрыве связи или перегрузке сервера. */
const RETRIES = 3;

/** Пауза перед повтором — даём связи восстановиться. */
const RETRY_DELAY_MS = 700;

/**
 * Ответы «сервер перегружен»: база отвечает «rate limit exceeded», функция — 502.
 * Это не ошибка данных, а пик нагрузки, когда страница одновременно просит
 * десяток разделов. Чтение в таком случае безопасно повторить через паузу.
 */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Сколько запросов к нашим функциям идёт одновременно.
 * Дашборд и зарплата при открытии запрашивали 10–15 разделов разом —
 * база не выдерживала пик и часть блоков показывала «ничего не найдено».
 * Очередь растягивает пик на доли секунды, зато все блоки получают данные.
 */
const MAX_PARALLEL = 4;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let active = 0;
const queue: Array<() => void> = [];

const acquire = (): Promise<void> => {
  if (active < MAX_PARALLEL) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      active += 1;
      resolve();
    });
  });
};

const release = () => {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) next();
};

/** Пауза с разбросом: повторы разных блоков не должны прийти в базу одной пачкой. */
const backoff = (attempt: number) =>
  RETRY_DELAY_MS * (attempt + 1) + Math.floor(Math.random() * 500);

/** Наши серверные запросы: только их имеет смысл повторять. */
const isAppRequest = (url: string): boolean =>
  url.includes('functions.poehali.dev') || url.startsWith('/api');

/**
 * Подставляет ключ сессии в заголовки нашего запроса.
 *
 * Делаем это здесь, в одном месте, а не в каждом файле API: стоит забыть ключ в
 * одном запросе — и там появится дыра, через которую действие пройдёт без
 * проверки прав. Заголовок X-Auth-Token выбран потому, что обычный Authorization
 * облачный провайдер до функции не доносит.
 */
const withAuthHeader = (init?: RequestInit): RequestInit | undefined => {
  const token = getAuthToken();
  if (!token) return init;
  const headers = new Headers(init?.headers || {});
  headers.set('X-Auth-Token', token);
  return { ...init, headers };
};

export const setupResilientFetch = () => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Чужие запросы не трогаем вовсе: ключ сессии уходит только на наш сервер.
    if (!isAppRequest(url)) return originalFetch(input, init);

    // Ключ сессии добавляем ко ВСЕМ нашим запросам, включая отправку данных.
    const authInit = withAuthHeader(init);

    // Отправку данных дальше не трогаем: повторять её нельзя.
    if (method !== 'GET') return originalFetch(input, authInit);

    init = authInit;

    // Если запрос уже умеет отменяться сам (страница закрыта, фильтр сменился),
    // не мешаем: свой предел ожидания не навязываем.
    const hasOwnSignal = Boolean(init?.signal);

    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const controller = hasOwnSignal ? null : new AbortController();
      let timer: number | null = null;

      await acquire();
      try {
        // Таймер — только на сам запрос, а не на ожидание в очереди.
        timer = controller ? window.setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
        const response = await originalFetch(input, {
          ...init,
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (timer) window.clearTimeout(timer);

        // Перегрузка — тихо повторяем, пока есть попытки: пользователь не должен
        // видеть пустой блок из-за минутного пика.
        if (RETRY_STATUSES.has(response.status) && attempt < RETRIES) {
          release();
          await wait(backoff(attempt));
          continue;
        }

        // Сервер ответил отказом — пишем в журнал сбоев. Раньше такие ответы
        // были видны только в консоли планшета: раздел оставался пустым, а
        // причина исчезала вместе с закрытой вкладкой.
        // Кроме самой отправки отчётов: иначе её сбой вызвал бы новый отчёт,
        // тот — ещё один, и приложение ушло бы в петлю запросов.
        if (response.status >= 500 && !isErrorReportUrl(url)) {
          reportError({
            source: 'backend',
            message: `Функция ответила ошибкой ${response.status}: ${url}`,
          });
        }
        release();
        return response;
      } catch (error) {
        if (timer) window.clearTimeout(timer);
        release();
        lastError = error;

        // Запрос отменило само приложение — повторять нечего.
        if (hasOwnSignal && (error as Error)?.name === 'AbortError') throw error;

        // Попытки кончились — отдаём ошибку наверх, как раньше.
        if (attempt === RETRIES) break;

        await wait(backoff(attempt));
      }
    }

    throw lastError;
  };
};