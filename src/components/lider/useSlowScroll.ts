import { useEffect, useRef, type RefObject } from 'react';

/**
 * Медленная лента живого цеха.
 *
 * В WebView2 киоска scrollTop часто не двигается (transform у предка, flex
 * без высоты, округление до целых). Поэтому едем через translate3d — это
 * обычная отрисовка, не скролл браузера.
 *
 * Высоту окна берём у кадра телевизора (data-tv-floor / data-tv-body), а не
 * у сетки: высокие карточки закройщиков раздувают родителя, max становится 0
 * и лента «стоит», после чего экран уходит на гонку.
 */
const panViewportPx = (view: HTMLElement): number => {
  const floor = view.closest('[data-tv-floor]') as HTMLElement | null;
  const body = view.closest('[data-tv-body]') as HTMLElement | null;
  const host = floor || body;
  if (host && host.clientHeight > 16) {
    let used = 0;
    const kids = host.children;
    for (let i = 0; i < kids.length; i += 1) {
      const child = kids[i] as HTMLElement;
      if (child === view || child.contains(view)) break;
      used += child.offsetHeight;
    }
    const cs = getComputedStyle(host);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const avail = Math.floor(host.clientHeight - used - padY);
    if (avail > 16) return avail;
  }
  const parent = view.parentElement;
  if (parent && parent.clientHeight > 16) return parent.clientHeight;
  return 0;
};

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
    let travelled = 0;

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
      const cap = panViewportPx(view);
      if (cap > 16) {
        const next = cap + 'px';
        if (view.style.height !== next) {
          view.style.height = next;
          view.style.maxHeight = next;
        }
        view.style.overflow = 'hidden';
      }
      if (!last) last = t;
      const dt = Math.min(100, Math.max(0, t - last));
      last = t;
      const contentH = Math.max(content.offsetHeight, content.scrollHeight);
      const max = contentH - view.clientHeight;
      if (view.clientHeight < 16 || max <= 8) return;
      if (t < pauseUntil) return;
      const step = (dir * pxPerSec * dt) / 1000;
      y += step;
      travelled += Math.abs(step);
      if (y >= max - 0.5) {
        y = max;
        if (dir === 1) {
          dir = -1;
          pauseUntil = t + 1800;
          if (!announced && travelled > 24) {
            announced = true;
            cbRef.current?.();
          }
        }
      } else if (y <= 0.5 && dir === -1) {
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
