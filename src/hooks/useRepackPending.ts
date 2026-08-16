import { useCallback, useState } from 'react';
import { fetchRepackCount } from '@/lib/kioskApi';
import { usePolling } from '@/hooks/usePolling';

/**
 * Сколько вещей ждёт осмотра у упаковщицы.
 *
 * Кладовщик передаёт возвраты в цех в течение дня, и без счётчика в меню упаковщица
 * узнавала о новой работе, только если сама заходила на страницу. Обновляем раз в
 * минуту и только пока на экран смотрят — свёрнутая вкладка ничего не тратит.
 */
export const useRepackPending = (enabled: boolean, workshopId?: number | null) => {
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      // Просим только ЧИСЛО, а не список вещей: экран перепаковки работает через
      // сканер и сам список нигде не показывает — возить его ради счётчика незачем.
      const r = await fetchRepackCount(workshopId ?? null);
      setPending(r.mineCount + r.freeCount);
    } catch {
      // Молча: счётчик — подсказка, ошибки сети не должны мешать работе.
    }
  }, [workshopId]);

  // Раз в три минуты — как и счётчик подбора: это подсказка в меню.
  usePolling(load, 180000, enabled);

  return pending;
};

export default useRepackPending;
