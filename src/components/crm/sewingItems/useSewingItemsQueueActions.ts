import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { takeStack, takeOrder, type SewingStatus, type TakenOrder } from '@/lib/ordersApi';
import { printCuttingSheet } from '@/lib/printCuttingSheet';

const TAKE_ORDER_COOLDOWN_MS = 5000;

interface UseSewingItemsQueueActionsArgs {
  userId: number | undefined;
  userName: string | undefined;
  effectiveWorkshopId: number | null;
  effectiveShiftNumber: number | null;
  load: () => void;
  setActiveTab: (status: SewingStatus) => void;
}

/** Действия закройщика (взять стек заказов + распечатать задание) и швеи (получить новый
 * заказ), включая кулдаун повторного взятия и хранение последнего взятого стека для печати. */
export const useSewingItemsQueueActions = ({
  userId,
  userName,
  effectiveWorkshopId,
  effectiveShiftNumber,
  load,
  setActiveTab,
}: UseSewingItemsQueueActionsArgs) => {
  const { toast } = useToast();

  const [takingStack, setTakingStack] = useState(false);
  const [takingOrder, setTakingOrder] = useState(false);
  const [takeOrderCooldown, setTakeOrderCooldown] = useState(false);
  const [lastTakenStack, setLastTakenStack] = useState<TakenOrder[]>([]);

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
    } catch (e) {
      toast({ title: 'Не удалось взять стек', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setTakingStack(false);
    }
  };

  const handlePrintTask = () => {
    if (lastTakenStack.length === 0) return;
    printCuttingSheet(lastTakenStack, userName || '');
  };

  const handleTakeOrder = async () => {
    if (!userId) return;
    setTakingOrder(true);
    setTakeOrderCooldown(true);
    try {
      await takeOrder(userId);
      toast({ title: 'Заказ получен' });
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
