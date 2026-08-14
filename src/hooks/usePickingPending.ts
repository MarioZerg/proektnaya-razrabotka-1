import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPickingPending } from '@/lib/goodsWarehouseApi';
import { usePolling } from '@/hooks/usePolling';
import { playWarehouseAlert, primeWarehouseAlerts } from '@/lib/warehouseAlerts';

/** Следит, сколько вещей на складе уже подобрано под заказы и ждёт стикера отправления.
 *
 * Подбор срабатывает в любой момент рабочего дня — например, когда швея дошила вещь и
 * кладовщик положил её на полку. Счётчик обновляется раз в минуту: вещь шьют минутами,
 * а число висит в меню у сотрудника весь день.
 *
 * По росту счётчиков кладовщик слышит голосовое уведомление: он ходит между стеллажами
 * и на экран не смотрит. Раньше здесь играл «пик» сканера — короткий сигнал без слов,
 * который раздавался на любой странице системы и был непонятен. Теперь голос прямо
 * говорит, что произошло, и звучит только у кладовщика.
 *
 * Сигнал даём ТОЛЬКО когда работы стало больше. Уменьшение счётчика — это сам кладовщик
 * разобрал вещь, объявлять об этом нечего.
 */
/** Общий ответ на всех: счётчик показан и в меню, и на странице склада одновременно.
 * Раньше каждый из них слал свой запрос, и кладовщик оплачивал одно и то же дважды.
 * Здесь ответ живёт 15 секунд — второй желающий получает готовые цифры. */
type Pending = { pendingLabel: number; awaitingShelf: number; cancelledFromWorkshop: number };

let cache: { at: number; data: Pending } | null = null;
let inFlight: Promise<Pending> | null = null;

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

  // Числа с прошлого круга. Первый ответ после открытия страницы не озвучиваем: это
  // не новая работа, а то, что уже лежало на складе, — иначе система здоровалась бы
  // голосом при каждом входе в систему.
  const prev = useRef<{ picking: number; cancelled: number } | null>(null);

  // Браузер не даёт звук, пока человек ничего не нажал на странице. Кладовщик всё равно
  // кликает по системе в начале смены — на первом же его действии подгружаем файлы,
  // чтобы уведомление прозвучало сразу, а не проглотилось.
  useEffect(() => {
    if (!enabled) return;
    const onFirstTouch = () => primeWarehouseAlerts();
    window.addEventListener('pointerdown', onFirstTouch, { once: true });
    window.addEventListener('keydown', onFirstTouch, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstTouch);
      window.removeEventListener('keydown', onFirstTouch);
    };
  }, [enabled]);

  const load = useCallback(async () => {
    try {
      const data = await loadShared();
      setPending(data.pendingLabel);
      setAwaitingShelf(data.awaitingShelf);

      const before = prev.current;
      prev.current = {
        picking: data.pendingLabel,
        cancelled: data.cancelledFromWorkshop,
      };
      if (!before) return;

      // Сколько именно заказов прибавилось — неважно: голос звучит один раз.
      // Наложение двух сообщений и повторы внутри минуты гасятся в playWarehouseAlert.
      if (data.cancelledFromWorkshop > before.cancelled) {
        playWarehouseAlert('cancelledToShelf');
      }
      if (data.pendingLabel > before.picking) {
        playWarehouseAlert('newPicking');
      }
    } catch {
      // Молча: счётчик — вспомогательная подсказка, ошибки сети не должны мешать работе.
    }
  }, []);

  // Счётчик висит в меню на всех страницах CRM, поэтому цена ошибки высока: в свёрнутой
  // вкладке опрос полностью останавливается и возобновляется, когда на экран снова смотрят.
  // Раз в три минуты: это цифра-подсказка в меню, а не рабочий экран. Минутный
  // опрос на всех страницах CRM у всех сотрудников давал сотни лишних обращений
  // к серверу за смену, а подобранный товар не пропадает за две минуты.
  usePolling(load, 180000, enabled);

  return { pending, awaitingShelf };
};