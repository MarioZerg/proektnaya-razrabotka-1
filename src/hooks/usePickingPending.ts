import { useCallback, useState } from 'react';
import { fetchPickingPending } from '@/lib/goodsWarehouseApi';
import { usePolling } from '@/hooks/usePolling';

/** Следит, сколько вещей на складе уже подобрано под заказы и ждёт стикера отправления.
 *
 * Подбор срабатывает в любой момент рабочего дня — например, когда швея дошила вещь и
 * кладовщик положил её на полку. Счётчик обновляется раз в минуту: вещь шьют минутами,
 * а число висит в меню у сотрудника весь день.
 *
 * Звука здесь СОЗНАТЕЛЬНО нет. Раньше рост счётчика проигрывал сигнал сканера, и он
 * раздавался фоном на любой странице системы — человек работал в другом разделе и слышал
 * «пик» из ниоткуда, не понимая, что это и на что реагировать. О новой работе теперь
 * сообщает только цифра в меню.
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

export const usePickingPending = (enabled: boolean) => {
  const [pending, setPending] = useState(0);
  const [awaitingShelf, setAwaitingShelf] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await loadShared();
      setPending(data.pendingLabel);
      setAwaitingShelf(data.awaitingShelf);
    } catch {
      // Молча: счётчик — вспомогательная подсказка, ошибки сети не должны мешать работе.
    }
  }, []);

  // Счётчик висит в меню на всех страницах CRM, поэтому цена ошибки высока: в свёрнутой
  // вкладке опрос полностью останавливается и возобновляется, когда на экран снова смотрят.
  usePolling(load, 60000, enabled);

  return { pending, awaitingShelf };
};