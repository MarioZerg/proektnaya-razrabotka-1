import { useEffect, type RefObject } from 'react';

/**
 * Медленный маятник по вертикали: если блок выше экрана, плавно едет вниз,
 * коротко стоит у края и едет обратно. Когда всё помещается — стоит на месте.
 */
export const useSlowScroll = (
  ref: RefObject<HTMLElement>,
  contentKey: string,
  pxPerSec = 22,
) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let dir = 1;
    let last = performance.now();
    let pauseUntil = 0;
    let raf = 0;

    const loop = (t: number) => {
      const dt = Math.min(48, t - last);
      last = t;
      if (el.scrollHeight <= el.clientHeight + 8) {
        if (el.scrollTop !== 0) el.scrollTop = 0;
        raf = requestAnimationFrame(loop);
        return;
      }
      if (t < pauseUntil) {
        raf = requestAnimationFrame(loop);
        return;
      }
      el.scrollTop += (dir * pxPerSec * dt) / 1000;
      if (dir > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        dir = -1;
        pauseUntil = t + 2800;
      } else if (dir < 0 && el.scrollTop <= 0) {
        dir = 1;
        pauseUntil = t + 2800;
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ref, contentKey, pxPerSec]);
};
