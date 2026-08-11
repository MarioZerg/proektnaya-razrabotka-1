import { useCallback, useRef, useState } from 'react';
import { fetchPickingPending } from '@/lib/goodsWarehouseApi';
import { playScanSound } from '@/lib/scanSound';
import { usePolling } from '@/hooks/usePolling';

/** Следит, сколько вещей на складе уже подобрано под заказы и ждёт стикера отправления.
 *
 * Подбор теперь срабатывает в любой момент рабочего дня — например, когда швея дошила вещь
 * и кладовщик положил её на полку. Чтобы кладовщик не пропустил новую работу, счётчик
 * обновляется раз в минуту, а при появлении НОВЫХ вещей звучит сигнал. Чаще не нужно:
 * вещь шьют минутами, а счётчик висит в меню у каждого сотрудника весь день.
 *
 * Звук только на рост числа: если кладовщик разобрал часть — тишина.
 */
/** Общий ответ на всех: счётчик показан и в меню, и на странице склада одновременно.
 * Раньше каждый из них слал свой запрос, и кладовщик оплачивал одно и то же дважды.
 * Здесь ответ живёт 15 секунд — второй желающий получает готовые цифры. */
let cache: { at: number; data: { pendingLabel: number; awaitingShelf: number } } | null = null;
let inFlight: Promise<{ pendingLabel: number; awaitingShelf: number }> | null = null;

const loadShared = () => {
  if (cache && Date.now() - cache.at < 15000) return Promise.resolve(cache.data);
  if (inFlight) return inFlight;
  inFlight = fetchPickingPending()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
};

export const usePickingPending = (enabled: boolean, withSound = true) => {
  const [pending, setPending] = useState(0);
  const [awaitingShelf, setAwaitingShelf] = useState(0);
  const prevRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await loadShared();
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
  }, [withSound]);

  // Счётчик висит в меню на всех страницах CRM, поэтому цена ошибки высока: в свёрнутой
  // вкладке опрос полностью останавливается и возобновляется, когда на экран снова смотрят.
  usePolling(load, 60000, enabled);

  return { pending, awaitingShelf };
};