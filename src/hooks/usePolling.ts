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
 *     и опрос запускается снова, НО не чаще чем раз в четверть интервала: кладовщик
 *     за смену десятки раз прыгает между вкладкой системы и кабинетом маркетплейса,
 *     и каждое такое возвращение уходило в сервер отдельным запросом, хотя данные
 *     обновились секунду назад;
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
    // Когда данные забирали в прошлый раз. Нужно, чтобы возвращение на вкладку
    // не превращалось в запрос, если он и так только что был.
    let lastRunAt = 0;

    const run = async (force = true) => {
      // Пока предыдущий запрос не вернулся, новый не отправляем.
      if (busy || stopped || document.visibilityState !== 'visible') return;
      // Переключение вкладок (force = false) обновляет данные, только если с
      // прошлого раза прошла заметная часть интервала. По таймеру (force = true)
      // запрос идёт всегда — там пауза уже выдержана.
      if (!force && Date.now() - lastRunAt < intervalMs / 4) return;
      busy = true;
      lastRunAt = Date.now();
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
        run(false);
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
