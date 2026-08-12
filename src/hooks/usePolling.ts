import { useEffect, useRef } from 'react';
import { withNightSlowdown } from '@/lib/workingHours';

/**
 * Периодический запрос к серверу, который НЕ работает впустую.
 *
 * Раньше каждый экран заводил свой setInterval, и опрос продолжался, даже когда вкладку
 * свернули или планшет положили на стол экраном вниз. Смена длится 12 часов — за это время
 * забытая вкладка успевала сделать тысячи бесполезных обращений к серверу, и мы платили
 * за них как за работу.
 *
 * Здесь опрос живёт по правилам:
 *   - вкладка не видна — таймер выключен полностью;
 *   - вкладка вернулась — сразу свежие данные (человек смотрит на экран прямо сейчас)
 *     и опрос запускается снова;
 *   - пока запрос ещё выполняется, второй не уходит: на медленной сети запросы больше
 *     не накладываются друг на друга;
 *   - ночью (с 24:00 до 5:00) опрос замедляется в десять раз: производство не работает,
 *     и забытая на планшете вкладка не должна всю ночь дёргать сервер впустую.
 *
 * @param callback что запрашиваем
 * @param intervalMs как часто, в миллисекундах
 * @param enabled    выключатель: false — опроса нет вовсе
 */
export const usePolling = (
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
) => {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      // Пока предыдущий запрос не вернулся, новый не отправляем.
      if (busy || stopped || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        await savedCallback.current();
      } finally {
        busy = false;
      }
    };

    // Интервал пересчитываем перед КАЖДЫМ кругом, а не один раз при запуске: смена
    // длится всю ночь, и вкладка, открытая вечером, должна сама замедлиться после
    // полуночи и снова ускориться в 5 утра — без перезагрузки страницы.
    const tick = async () => {
      timer = null;
      await run();
      if (stopped) return;
      start();
    };

    const start = () => {
      if (timer !== null) return;
      timer = setTimeout(tick, withNightSlowdown(intervalMs));
    };

    const stop = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      run();
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
};

export default usePolling;
