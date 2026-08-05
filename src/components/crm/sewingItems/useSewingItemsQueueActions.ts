import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { takeStack, takeOrder, type SewingStatus, type TakenOrder } from '@/lib/ordersApi';
import { printCuttingSheet } from '@/lib/printCuttingSheet';

const TAKE_ORDER_COOLDOWN_MS = 5000;
const STACK_STORAGE_KEY = 'megatul_last_taken_stack';

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
  /** Пока список заказов ещё грузится с сервера, myUnfinishedCount временно равен 0 —
   * нельзя по этому значению стирать восстановленный из localStorage стек раньше времени. */
  ordersLoading: boolean;
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
  ordersLoading,
}: UseSewingItemsQueueActionsArgs) => {
  const { toast } = useToast();

  const [takingStack, setTakingStack] = useState(false);
  const [takingOrder, setTakingOrder] = useState(false);
  const [takeOrderCooldown, setTakeOrderCooldown] = useState(false);
  const [lastTakenStack, setLastTakenStack] = useState<TakenOrder[]>(() => loadStoredStack(userId));

  // Стек считается завершённым, когда у закройщика не осталось ни одного заказа "На
  // раскрое" — именно тогда убираем сохранённый стек и кнопка печати пропадает. Ждём
  // окончания загрузки заказов, чтобы не стереть стек по временному нулю до подгрузки данных.
  useEffect(() => {
    if (!ordersLoading && lastTakenStack.length > 0 && myUnfinishedCount === 0) {
      setLastTakenStack([]);
      saveStoredStack(userId, []);
    }
  }, [ordersLoading, myUnfinishedCount, lastTakenStack.length, userId]);

  const handleTakeStack = async () => {
    if (!effectiveWorkshopId) {
      toast({ title: 'У вас не указан цех — откройте смену на главной странице', variant: 'destructive' });
      return;
    }
    setTakingStack(true);
    try {
      const res = await takeStack(userId!, effectiveWorkshopId, effectiveShiftNumber);
      toast({ title: `Взято в работу заказов: ${res.count}` });
      setActiveTab('На раскрое');
      load();
      setLastTakenStack(res.orders);
      saveStoredStack(userId, res.orders);
    } catch (e) {
      toast({ title: 'Не удалось взять стек', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setTakingStack(false);
    }
  };

  const handlePrintTask = () => {
    if (lastTakenStack.length === 0) return;
    // ID закройщика (внутренний id пользователя) печатается на листе — по нему швея находит
    // крои закройщика на вешалках в цехе.
    printCuttingSheet(lastTakenStack, userName || '', userId ?? null);
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
      setTimeout(() => setTakeOrderCooldown(false), TAKE_ORDER_COOLDOWN_MS);
    }
  };

  return {
    takingStack,
    takingOrder,
    takeOrderCooldown,
    lastTakenStack,
    handleTakeStack,
    handlePrintTask,
    handleTakeOrder,
  };
};