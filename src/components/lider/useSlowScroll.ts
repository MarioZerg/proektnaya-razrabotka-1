import { useEffect, useRef, type RefObject } from 'react';

/**
 * Маятник по вертикали. Позицию копим дробью: WebView2 на телевизоре округляет
 * scrollTop до целых, и шаг 0.3px за кадр теряется — лента то едет, то стоит.
 * rAF иногда замирает в киоске, поэтому дублируем ход таймером.
 *
 * onReachedBottom — один раз, когда доехали вниз. Гонку к замку открываем
 * только после этого, иначе список не успевает прокрутиться.
 */
export const useSlowScroll = (
  ref: RefObject<HTMLElement>,
  enabled: boolean,
  pxPerSec = 32,
  onReachedBottom?: () => void,
) => {
  const cbRef = useRef(onReachedBottom);
  cbRef.current = onReachedBottom;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let dir = 1;
    let y = el.scrollTop;
    let last = performance.now();
    let pauseUntil = 0;
    let raf = 0;
    let announced = false;

    const tick = (t: number) => {
      const dt = Math.min(100, Math.max(0, t - last));
      last = t;
      const max = el.scrollHeight - el.clientHeight;
      if (el.clientHeight < 16 || max <= 8) {
        y = 0;
        if (el.scrollTop !== 0) el.scrollTop = 0;
        return;
      }
      if (t < pauseUntil) return;
      y += (dir * pxPerSec * dt) / 1000;
      if (y >= max - 0.5) {
        y = max;
        dir = -1;
        pauseUntil = t + 1800;
        if (!announced) {
          announced = true;
          cbRef.current?.();
        }
      } else if (y <= 0.5) {
        y = 0;
        dir = 1;
        announced = false;
        pauseUntil = t + 1600;
      }
      el.scrollTop = y;
    };

    const loop = (t: number) => {
      tick(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const watchdog = window.setInterval(() => {
      const t = performance.now();
      if (t - last > 80) tick(t);
    }, 50);

    const onVis = () => {
      last = performance.now();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ref, enabled, pxPerSec]);
};
