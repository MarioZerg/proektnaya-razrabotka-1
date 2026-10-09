import { useEffect, useRef, type RefObject } from 'react';

/**
 * Медленная лента живого цеха.
 *
 * В WebView2 киоска scrollTop часто не двигается (transform у предка, flex
 * без высоты, округление до целых). Поэтому едем через translate3d — это
 * обычная отрисовка, не скролл браузера.
 */
export const useSlowScroll = (
  viewportRef: RefObject<HTMLElement>,
  contentRef: RefObject<HTMLElement>,
  enabled: boolean,
  pxPerSec = 32,
  onReachedBottom?: () => void,
) => {
  const cbRef = useRef(onReachedBottom);
  cbRef.current = onReachedBottom;

  useEffect(() => {
    const mark = (ok: boolean) => {
      (window as Window & { __tvPanOk?: boolean }).__tvPanOk = ok;
    };
    if (!enabled) {
      mark(false);
      const content = contentRef.current;
      if (content) content.style.transform = '';
      return;
    }

    let dir = 1;
    let y = 0;
    let last = 0;
    let pauseUntil = 0;
    let raf = 0;
    let watchdog = 0;
    let announced = false;
    let stopped = false;

    const apply = (content: HTMLElement, pos: number) => {
      content.style.willChange = 'transform';
      content.style.transform = 'translate3d(0,' + -pos + 'px,0)';
      mark(true);
    };

    const tick = (t: number) => {
      if (stopped) return;
      const view = viewportRef.current;
      const content = contentRef.current;
      if (!view || !content) return;
      const parent = view.parentElement;
      if (parent && parent.clientHeight > 16) {
        const h = parent.clientHeight;
        if (view.style.height !== h + 'px') {
          view.style.height = h + 'px';
          view.style.maxHeight = h + 'px';
        }
      }
      if (!last) last = t;
      const dt = Math.min(100, Math.max(0, t - last));
      last = t;
      const max = content.offsetHeight - view.clientHeight;
      if (view.clientHeight < 16 || max <= 8) return;
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
      apply(content, Math.round(y));
    };

    const loop = (t: number) => {
      tick(t);
      if (!stopped) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    watchdog = window.setInterval(() => {
      const t = performance.now();
      if (!last || t - last > 80) tick(t);
    }, 50);

    return () => {
      stopped = true;
      mark(false);
      cancelAnimationFrame(raf);
      window.clearInterval(watchdog);
    };
  }, [viewportRef, contentRef, enabled, pxPerSec]);
};
