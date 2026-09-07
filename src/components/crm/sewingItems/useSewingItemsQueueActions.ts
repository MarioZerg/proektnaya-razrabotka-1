import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  takeStack,
  takeOrder,
  fetchSewingWaits,
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

  /**
   * ТАЙМЕР НА КАЖДУЮ ВЕЩЬ В РАБОТЕ: id заказа → сколько секунд ещё шить.
   *
   * Время задаётся настройками цеха по ширине изделия и отсчитывается от взятия
   * заказа. Пока оно идёт, кнопка «Отправить на стикеровку» у этой вещи заблокирована:
   * сдать её раньше нельзя, а значит и место в работе не освободится.
   *
   * Момент разблокировки держим отдельно (мс epoch), чтобы тикать от абсолютного
   * времени: вкладку сворачивают, планшет усыпляют — фоновые таймеры тормозят, и
   * отсчёт «по единичке» отстал бы от реальности на минуты.
   */
  const [sewWaits, setSewWaits] = useState<Record<number, number>>({});
  const [sewUntil, setSewUntil] = useState<Record<number, number>>({});
  /**
   * Заказов на руках и предел цеха — по ним на кнопке «Получить заказ» висит замочек.
   *
   * Считается ТОЛЬКО «В работе»: сдала вещь на стикеровку — место освободилось сразу,
   * замок снимается. Ждать, пока упаковщица её закроет, швея не должна.
   */
  const [inWork, setInWork] = useState(0);
  const [maxOrders, setMaxOrders] = useState(0);

  /** Забрать с сервера актуальные остатки. Дёргаем редко: при открытии страницы,
   * после взятия заказа и когда очередной отсчёт добежал до нуля. Между этими точками
   * фронт тикает сам — опрашивать сервер каждую секунду незачем. */
  const refreshSewWaits = async (uid: number) => {
    try {
      const res = await fetchSewingWaits(uid);
      const until: Record<number, number> = {};
      const left: Record<number, number> = {};
      Object.entries(res.waits).forEach(([id, w]) => {
        until[Number(id)] = Date.now() + w.waitSeconds * 1000;
        left[Number(id)] = w.waitSeconds;
      });
      setSewUntil(until);
      setSewWaits(left);
      setInWork(res.inWork);
      setMaxOrders(res.maxOrders);
    } catch {
      // Сеть моргнула — не запираем кнопки: настоящую проверку всё равно делает
      // сервер при отправке, и швея не должна стоять из-за вспомогательного запроса.
      setSewUntil({});
      setSewWaits({});
      setInWork(0);
      setMaxOrders(0);
    }
  };

  // Первый запрос при заходе: швея сразу видит, сколько осталось по каждой вещи, даже
  // если обновила вкладку или пришла с другого планшета — время живёт на сервере.
  useEffect(() => {
    if (!isSewer || !userId) return;
    refreshSewWaits(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSewer, userId]);

  // Секундный тик по всем вещам сразу.
  useEffect(() => {
    if (Object.keys(sewUntil).length === 0) return;
    const tick = () => {
      const now = Date.now();
      const left: Record<number, number> = {};
      let finished = false;
      Object.entries(sewUntil).forEach(([id, until]) => {
        const sec = Math.ceil((until - now) / 1000);
        if (sec > 0) left[Number(id)] = sec;
        else finished = true;
      });
      setSewWaits(left);
      // Хотя бы у одной вещи время вышло — сверяемся с сервером: последнее слово
      // всегда за ним, настройки цеха могли смениться прямо во время отсчёта.
      if (finished && userId) refreshSewWaits(userId);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sewUntil, userId]);

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
      // У новой вещи свой таймер пошива — забираем остатки заново, чтобы отсчёт на её
      // кнопке пошёл сразу, а не после перезахода на страницу.
      refreshSewWaits(userId);
    }
  };

  return {
    takingStack,
    takingOrder,
    /** Кнопка заперта только на время запроса — от «дребезга» двойного клика. */
    takeOrderCooldown,
    /** Сколько ещё шить каждую вещь: id заказа → секунды. Пустой ключ = можно сдавать. */
    sewWaits,
    /** Лимит на руках исчерпан — на кнопке «Получить заказ» замочек. */
    takeLocked: maxOrders > 0 && inWork >= maxOrders,
    inWork,
    maxOrders,
    /** Перечитать таймеры — вызывается после отправки вещи на стикеровку. */
    refreshSewWaits,
    lastTakenStack,
    handleTakeStack,
    handlePrintTask,
    handleTakeOrder,
  };
};