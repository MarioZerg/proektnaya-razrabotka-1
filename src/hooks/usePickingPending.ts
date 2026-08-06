import { useEffect, useRef, useState } from 'react';
import { fetchPickingPending } from '@/lib/goodsWarehouseApi';
import { playScanSound } from '@/lib/scanSound';

/** Следит, сколько вещей на складе уже подобрано под заказы и ждёт стикера отправления.
 *
 * Подбор теперь срабатывает в любой момент рабочего дня — например, когда швея дошила вещь
 * и кладовщик положил её на полку. Чтобы кладовщик не пропустил новую работу, счётчик
 * обновляется каждые 30 секунд, а при появлении НОВЫХ вещей звучит сигнал.
 *
 * Звук только на рост числа: если кладовщик разобрал часть — тишина.
 */
export const usePickingPending = (enabled: boolean, withSound = true) => {
  const [pending, setPending] = useState(0);
  const [awaitingShelf, setAwaitingShelf] = useState(0);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    const load = async () => {
      try {
        const data = await fetchPickingPending();
        if (stopped) return;
        setPending(data.pendingLabel);
        setAwaitingShelf(data.awaitingShelf);
        // Первый замер — просто запоминаем, сигналить не о чем.
        if (prevRef.current !== null && data.pendingLabel > prevRef.current && withSound) {
          playScanSound();
        }
        prevRef.current = data.pendingLabel;
      } catch {
        // Молча: счётчик — вспомогательная подсказка, ошибки сети не должны мешать работе.
      }
    };

    load();
    const timer = setInterval(load, 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, withSound]);

  return { pending, awaitingShelf };
};
