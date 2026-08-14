import { useCallback, useState } from 'react';
import { fetchRepackItems } from '@/lib/kioskApi';
import { usePolling } from '@/hooks/usePolling';

/**
 * Сколько вещей ждёт осмотра у упаковщицы.
 *
 * Кладовщик передаёт возвраты в цех в течение дня, и без счётчика в меню упаковщица
 * узнавала о новой работе, только если сама заходила на страницу. Обновляем раз в
 * минуту и только пока на экран смотрят — свёрнутая вкладка ничего не тратит.
 */
export const useRepackPending = (enabled: boolean) => {
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      const items = await fetchRepackItems();
      setPending(items.length);
    } catch {
      // Молча: счётчик — подсказка, ошибки сети не должны мешать работе.
    }
  }, []);

  // Раз в три минуты — как и счётчик подбора: это подсказка в меню.
  usePolling(load, 180000, enabled);

  return pending;
};

export default useRepackPending;
