import { useLayoutEffect, useRef, useState } from 'react';
import type { Order } from '@/lib/ordersApi';

const fingerprint = (o: Order) =>
  `${o.sewingStatus}|${o.assignedUserId ?? ''}|${o.isCancelled ? 1 : 0}|${o.hangerNumber}|${o.cutterUserId ?? ''}|${o.sewerUserId ?? ''}`;

/**
 * Живое движение строк конвейера.
 *
 * Когда список тихо обновился (приехал новый заказ, сменился статус),
 * уже стоящие строки сдвигаются на свои новые места (FLIP), новенькие
 * заезжают слева, а у сменивших этап вспыхивает бейдж. Смену вкладки
 * и страницы не анимируем: там сразу другой набор, и «все приехали»
 * только мельтешило бы.
 */
export const useConveyorRowMotion = (orders: Order[]) => {
  const nodes = useRef(new Map<number, HTMLElement>());
  const prevRects = useRef(new Map<number, DOMRect>());
  const prevPrint = useRef(new Map<number, string>());
  const prevIds = useRef<number[]>([]);
  const [arrived, setArrived] = useState<Set<number>>(() => new Set());
  const [moved, setMoved] = useState<Set<number>>(() => new Set());
  const signature = orders.map((o) => `${o.id}:${fingerprint(o)}`).join(',');

  useLayoutEffect(() => {
    const ids = orders.map((o) => o.id);
    const prevIdSet = new Set(prevIds.current);
    const nextArrived = new Set<number>();
    const nextMoved = new Set<number>();
    const newcomers = ids.filter((id) => !prevIdSet.has(id)).length;
    const jump =
      prevIds.current.length === 0 || newcomers > Math.max(2, ids.length / 2);

    if (!jump) {
      for (const o of orders) {
        if (!prevIdSet.has(o.id)) nextArrived.add(o.id);
        const before = prevPrint.current.get(o.id);
        if (before && before !== fingerprint(o)) nextMoved.add(o.id);
      }

      for (const o of orders) {
        if (nextArrived.has(o.id)) continue;
        const el = nodes.current.get(o.id);
        const prev = prevRects.current.get(o.id);
        if (!el || !prev) continue;
        const next = el.getBoundingClientRect();
        const dy = prev.top - next.top;
        if (Math.abs(dy) < 2) continue;
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
    }

    const rects = new Map<number, DOMRect>();
    const prints = new Map<number, string>();
    for (const o of orders) {
      const el = nodes.current.get(o.id);
      if (el) rects.set(o.id, el.getBoundingClientRect());
      prints.set(o.id, fingerprint(o));
    }
    prevRects.current = rects;
    prevPrint.current = prints;
    prevIds.current = ids;

    setArrived(nextArrived);
    setMoved(nextMoved);
    if (nextArrived.size === 0 && nextMoved.size === 0) return undefined;
    const t = window.setTimeout(() => {
      setArrived(new Set());
      setMoved(new Set());
    }, 1100);
    return () => window.clearTimeout(t);
    // signature ловит и состав списка, и смену статуса у той же строки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const bindRow = (id: number) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };

  return { arrived, moved, bindRow };
};
