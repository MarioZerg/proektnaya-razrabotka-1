/**
 * Сбор сбоев приложения.
 *
 * ЗАЧЕМ. Раньше ошибка в браузере сотрудника нигде не сохранялась — она жила
 * только в консоли его планшета. Сотрудник говорил «не работает», а разобраться
 * было нечем: чужой сбой почти невозможно воспроизвести на другом устройстве.
 *
 * Теперь каждый сбой уходит на сервер: что упало, на какой странице, у кого.
 * Разбор жалобы начинается с факта, а не с догадок.
 *
 * ЧТО МЫ НЕ ОТПРАВЛЯЕМ. Устаревшую версию страницы после обновления системы —
 * это не поломка, а норма, и такие записи только засоряли бы журнал. Обрывы
 * связи в цехе тоже пропускаем: связь моргает по десять раз в день, приложение
 * само повторяет запрос, и человек ничего не замечает.
 */

import { isChunkLoadError } from '@/lib/chunkReload';

const ERRORS_URL = 'https://functions.poehali.dev/387b8a08-1e19-4eec-8fcb-2e3821463956';

/**
 * Это адрес самого журнала сбоев?
 *
 * Нужно, чтобы сбой при отправке отчёта не порождал новый отчёт: иначе одна
 * упавшая функция закрутила бы приложение в бесконечную петлю запросов.
 */
export const isErrorReportUrl = (url: string): boolean => url.startsWith(ERRORS_URL);

interface ErrorReport {
  message: string;
  stack?: string;
  page?: string;
  level?: 'error' | 'warn';
  source?: string;
  appVersion?: string;
}

/** Копим ошибки и отправляем пачкой: при падении их часто сыпется серия. */
let queue: ErrorReport[] = [];
let flushTimer: number | null = null;

/** Что уже отправляли: одна и та же ошибка повторяется в цикле перерисовки. */
const seen = new Set<string>();

/** Шум, из которого нечего чинить. */
const isNoise = (message: string): boolean => {
  const text = (message || '').toLowerCase();
  if (!text.trim()) return true;
  // Устаревшая версия страницы — приложение обрабатывает это само.
  if (isChunkLoadError(message)) return true;
  return (
    // Связь моргнула: запрос повторится сам.
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('load failed') ||
    // Запрос отменили осознанно: сотрудник сменил фильтр или ушёл со страницы.
    text.includes('aborterror') ||
    text.includes('the operation was aborted') ||
    // Известная пустая ошибка браузеров при ресайзе, на работу не влияет.
    text.includes('resizeobserver loop')
  );
};

const flush = () => {
  flushTimer = null;
  if (!queue.length) return;
  const errors = queue;
  queue = [];
  // keepalive — чтобы отчёт дошёл, даже если страницу закрывают сразу после сбоя.
  fetch(ERRORS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ errors }),
    keepalive: true,
  }).catch(() => {
    // Не доставить отчёт о сбое — не повод показывать сотруднику второй сбой.
  });
};

/** Записать сбой в журнал. Можно вызывать откуда угодно. */
export const reportError = (report: ErrorReport) => {
  if (isNoise(report.message)) return;

  const key = `${report.message}|${report.page || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  // Через пять минут ту же ошибку примем снова: так видно, что она не ушла.
  window.setTimeout(() => seen.delete(key), 5 * 60 * 1000);

  queue.push({
    ...report,
    page: report.page || window.location.pathname,
    level: report.level || 'error',
    source: report.source || 'frontend',
  });
  if (queue.length >= 10) {
    flush();
    return;
  }
  // Небольшая пауза: за это время подтянутся остальные ошибки из той же серии.
  if (flushTimer === null) flushTimer = window.setTimeout(flush, 2000);
};

/** Ставит перехватчики. Вызывается один раз при старте приложения. */
export const setupErrorReporter = () => {
  window.addEventListener('error', (event) => {
    const error = event.error as Error | undefined;
    reportError({
      message: error?.message || event.message || 'Неизвестная ошибка',
      stack: error?.stack,
    });
  });

  // Упавшее обещание: самый частый случай — запрос за данными, который не
  // обработали. Без этого перехватчика такие сбои не видны нигде.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : undefined;
    reportError({
      message: error?.message || String(reason || 'Обещание отклонено без причины'),
      stack: error?.stack,
    });
  });

  // Страницу закрывают — досылаем то, что не успело уйти.
  window.addEventListener('pagehide', () => {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  });
};

export default setupErrorReporter;