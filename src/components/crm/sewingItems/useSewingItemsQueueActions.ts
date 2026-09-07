import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  takeStack,
  takeOrder,
  fetchTakeCooldown,
  type SewingStatus,
  type TakenOrder,
} from '@/lib/ordersApi';
import { printCuttingSheet } from '@/lib/printCuttingSheet';

const STACK_STORAGE_KEY = 'megatul_last_taken_stack';

/** Защита от «дребезга» кнопки, когда таймаута цеха нет вовсе (первые заказы смены
 * берутся без задержки): два клика подряд не должны улететь в сервер дважды. */
const MIN_CLICK_GUARD_MS = 3000;

/** Последний взятый стек сохраняется в localStorage (отдельно на каждого закройщика по
 * userId), чтобы кнопка "Распечатать задание" не терялась при обновлении страницы или
 * уходе на другую вкладку — она обязана жить, пока стек не раскроен полностью. */
const loadStoredStack = (userId: number | undefined): TakenOrder[] => {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(`${STACK_STORAGE_KEY}_${userId}`);
    return raw ? (JSON.parse(raw) as TakenOrder[]) : [];
  } catch {
    return [];
  }
};

const saveStoredStack = (userId: number | undefined, stack: TakenOrder[]) => {
  if (!userId) return;
  localStorage.setItem(`${STACK_STORAGE_KEY}_${userId}`, JSON.stringify(stack));
};

interface UseSewingItemsQueueActionsArgs {
  userId: number | undefined;
  userName: string | undefined;
  effectiveWorkshopId: number | null;
  effectiveShiftNumber: number | null;
  load: () => void;
  setActiveTab: (status: SewingStatus) => void;
  /** Сколько заказов текущего стека ещё не раскроено (статус "На раскрое" у этого
   * закройщика) — когда доходит до 0, кнопка печати должна исчезнуть. */
  myUnfinishedCount: number;
  /** Сами нераскроенные заказы закройщика — по ним печатается лист задания.
   * Это данные с сервера, поэтому лист можно распечатать даже если память браузера
   * очистили или закройщица зашла с другого планшета. */
  unfinishedOrders: TakenOrder[];
  /** Пока список заказов ещё грузится с сервера, myUnfinishedCount временно равен 0 —
   * нельзя по этому значению стирать восстановленный из localStorage стек раньше времени. */
  ordersLoading: boolean;
  /** Швея ли смотрит страницу — только ей нужен отсчёт до следующего заказа. */
  isSewer?: boolean;
}

/** Действия закройщика (взять стек заказов + распечатать задание) и швеи (получить новый
 * заказ), включая кулдаун повторного взятия и хранение последнего взятого стека для печати.
 * Кнопка печати остаётся видимой, пока весь стек не раскроен полностью — не пропадает
 * при переходе между вкладками/обновлении страницы, и гаснет только когда стек завершён. */
export const useSewingItemsQueueActions = ({
  userId,
  userName,
  effectiveWorkshopId,
  effectiveShiftNumber,
  load,
  setActiveTab,
  myUnfinishedCount,
  unfinishedOrders,
  ordersLoading,
  isSewer = false,
}: UseSewingItemsQueueActionsArgs) => {
  const { toast } = useToast();

  const [takingStack, setTakingStack] = useState(false);
  const [takingOrder, setTakingOrder] = useState(false);
  const [takeOrderCooldown, setTakeOrderCooldown] = useState(false);
  const [lastTakenStack, setLastTakenStack] = useState<TakenOrder[]>(() => loadStoredStack(userId));

  // Момент, когда швея сможет взять следующий заказ (мс epoch). Приходит с сервера —
  // считается по накопительному таймауту из настроек ЕЁ цеха, а не зашитой в код цифрой.
  const [nextTakeAt, setNextTakeAt] = useState<number | null>(null);
  // Остаток в секундах: отдельным состоянием, чтобы кнопка перерисовывалась каждую
  // секунду и швея видела живой отсчёт, а не застывшее число.
  const [takeWaitSec, setTakeWaitSec] = useState(0);

  /** Спросить у сервера актуальный остаток ожидания. Дёргаем редко: при открытии
   * страницы, после взятия заказа и когда отсчёт добежал до нуля. Между этими точками
   * фронт тикает сам по nextTakeAt — сервер незачем опрашивать каждую секунду. */
  const refreshCooldown = async (uid: number) => {
    try {
      const cd = await fetchTakeCooldown(uid);
      if (cd.waitSeconds > 0) {
        setNextTakeAt(Date.now() + cd.waitSeconds * 1000);
        setTakeWaitSec(cd.waitSeconds);
      } else {
        setNextTakeAt(null);
        setTakeWaitSec(0);
      }
    } catch {
      // Сеть моргнула — не запираем кнопку: настоящую проверку всё равно делает сервер
      // при взятии, и швея не должна стоять из-за неудавшегося вспомогательного запроса.
      setNextTakeAt(null);
      setTakeWaitSec(0);
    }
  };

  // Первый запрос остатка при заходе на страницу: швея сразу видит, сколько ждать,
  // даже если обновила вкладку или пришла с другого планшета — время живёт на сервере.
  useEffect(() => {
    if (!isSewer || !userId) return;
    refreshCooldown(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSewer, userId]);

  // Секундный тик обратного отсчёта. Считаем от абсолютного времени разблокировки, а
  // не вычитанием по единице: вкладку сворачивают, планшет усыпляют, — таймеры в фоне
  // тормозят, и счётчик «по единичке» отстал бы от реальности на минуты.
  useEffect(() => {
    if (nextTakeAt === null) return;
    const tick = () => {
      const left = Math.ceil((nextTakeAt - Date.now()) / 1000);
      if (left <= 0) {
        setTakeWaitSec(0);
        setNextTakeAt(null);
        // Сверяемся с сервером: пока шёл отсчёт, могли смениться настройки цеха или
        // смена — последнее слово всегда за сервером.
        if (userId) refreshCooldown(userId);
      } else {
        setTakeWaitSec(left);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTakeAt, userId]);

  // Подхватываем сохранённый стек, когда стал известен сотрудник.
  //
  // При открытии страницы userId ещё не определён (профиль подгружается), и первое
  // чтение памяти браузера уходит в пустоту — ключ хранения зависит от userId. Раньше
  // повторной попытки не было: закройщица брала стек, обновляла страницу — и кнопка
  // «Распечатать задание» пропадала навсегда, хотя стек был не раскроен. Приходилось
  // резать по памяти или просить взять новый стек.
  useEffect(() => {
    if (!userId || lastTakenStack.length > 0) return;
    const stored = loadStoredStack(userId);
    if (stored.length > 0) setLastTakenStack(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Стек считается завершённым, когда у закройщика не осталось ни одного заказа "На
  // раскрое" — именно тогда убираем сохранённый стек и кнопка печати пропадает. Ждём
  // окончания загрузки заказов, чтобы не стереть стек по временному нулю до подгрузки данных.
  useEffect(() => {
    if (!ordersLoading && lastTakenStack.length > 0 && myUnfinishedCount === 0) {
      setLastTakenStack([]);
      saveStoredStack(userId, []);
    }
  }, [ordersLoading, myUnfinishedCount, lastTakenStack.length, userId]);

  /**
   * @param single взять ОДИН заказ вместо стека — для добора в конце смены или под
   * остаток ткани. Связки Яндекса при этом пропускаются: заказ из нескольких вещей
   * раскраивается только целиком, поэтому придёт следующий одиночный заказ.
   */
  const handleTakeStack = async (single = false) => {
    if (!effectiveWorkshopId) {
      toast({ title: 'У вас не указан цех — откройте смену на главной странице', variant: 'destructive' });
      return;
    }
    setTakingStack(true);
    try {
      const res = await takeStack(userId!, effectiveWorkshopId, effectiveShiftNumber, single);
      toast({ title: `Взято в работу заказов: ${res.count}` });
      setActiveTab('На раскрое');
      load();
      setLastTakenStack(res.orders);
      saveStoredStack(userId, res.orders);
    } catch (e) {
      toast({
        title: single ? 'Не удалось взять заказ' : 'Не удалось взять стек',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setTakingStack(false);
    }
  };

  const handlePrintTask = () => {
    // Печатаем то, что реально не раскроено СЕЙЧАС (данные с сервера), а если сервер
    // ещё не ответил — сохранённый стек. Память браузера тут только подсказка: её
    // чистят, планшет меняют, вкладку открывают заново, — а лист закройщице нужен.
    const toPrint = unfinishedOrders.length > 0 ? unfinishedOrders : lastTakenStack;
    if (toPrint.length === 0) return;
    // ID закройщика (внутренний id пользователя) печатается на листе — по нему швея находит
    // крои закройщика на вешалках в цехе.
    printCuttingSheet(toPrint, userName || '', userId ?? null);
  };

  const handleTakeOrder = async () => {
    if (!userId) return;
    setTakingOrder(true);
    setTakeOrderCooldown(true);
    try {
      const res = await takeOrder(userId);
      // Связка Яндекса прилетает швее целиком одним нажатием — сообщаем, сколько вещей
      // пришло, чтобы она сразу понимала объём работы.
      if (res?.takenCount && res.takenCount > 1) {
        toast({
          title: `Получен заказ из ${res.takenCount} вещей`,
          description: 'Это один заказ покупателя — шьётся целиком вами, ярлык на него общий',
        });
      } else {
        toast({ title: 'Заказ получен' });
      }
      setActiveTab('В работе');
      load();
    } catch (e) {
      toast({ title: 'Не удалось получить заказ', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setTakingOrder(false);
      setTimeout(() => setTakeOrderCooldown(false), MIN_CLICK_GUARD_MS);
      // После взятия заказа бюджет времени вырос — сразу забираем новый остаток, чтобы
      // счётчик на кнопке пошёл от реальной цифры, а не от старой.
      refreshCooldown(userId);
    }
  };

  return {
    takingStack,
    takingOrder,
    /** Кнопка заперта: либо идёт запрос, либо ещё не прошёл таймаут цеха. */
    takeOrderCooldown: takeOrderCooldown || takeWaitSec > 0,
    /** Сколько секунд осталось до следующего заказа — для подписи на кнопке. */
    takeWaitSec,
    lastTakenStack,
    handleTakeStack,
    handlePrintTask,
    handleTakeOrder,
  };
};