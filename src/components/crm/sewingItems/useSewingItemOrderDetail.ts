import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOrderDetail,
  updateOrder,
  cutOrder,
  sendToStickering,
  cancelOrder,
  type Order,
  type OrderDetail,
  type SewingStatus,
} from '@/lib/ordersApi';
import type { Roll } from '@/lib/rollsApi';

interface UseSewingItemOrderDetailArgs {
  load: () => void;
  isCutter: boolean;
  rolls: Roll[];
  effectiveWorkshopId: number | null;
  effectiveShiftNumber: number | null;
}

/** Диалог детальной карточки заказа: открытие/загрузка деталей и все действия над
 * выбранным заказом (назначение сотрудника/цеха, смена статуса, раскрой, отправка на
 * стикеровку, отмена), а также рулоны, доступные для раскроя/стикеровки этого заказа. */
export const useSewingItemOrderDetail = ({
  load,
  isCutter,
  rolls,
  effectiveWorkshopId,
  effectiveShiftNumber,
}: UseSewingItemOrderDetailArgs) => {
  const { toast } = useToast();

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cutting, setCutting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadDetail = async (orderId: number) => {
    setDetailLoading(true);
    try {
      const detail = await fetchOrderDetail(orderId);
      setOrderDetail(detail);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = (order: Order) => {
    setSelectedOrder(order);
    setOrderDetail(null);
    setDialogOpen(true);
    loadDetail(order.id);
  };

  const handleAssignUser = async (userId: string) => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      await updateOrder(selectedOrder.id, { assignedUserId: userId === 'none' ? null : Number(userId) });
      toast({ title: 'Сотрудник назначен' });
      const updated = { ...selectedOrder, assignedUserId: userId === 'none' ? null : Number(userId) };
      setSelectedOrder(updated);
      load();
      loadDetail(selectedOrder.id);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAssignWorkshop = async (workshopId: string) => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      await updateOrder(selectedOrder.id, { workshopId: workshopId === 'none' ? null : Number(workshopId) });
      toast({ title: 'Цех назначен' });
      const updated = { ...selectedOrder, workshopId: workshopId === 'none' ? null : Number(workshopId) };
      setSelectedOrder(updated);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      await updateOrder(selectedOrder.id, { sewingStatus: status as SewingStatus });
      toast({ title: 'Статус обновлён' });
      setSelectedOrder({ ...selectedOrder, sewingStatus: status });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleCut = async (rollId?: number) => {
    if (!selectedOrder) return;
    setCutting(true);
    try {
      await cutOrder(selectedOrder.id, rollId);
      toast({ title: 'Раскрой выполнен', description: 'Тюль списан, тесьму укажет швея перед стикеровкой' });
      setSelectedOrder({ ...selectedOrder, sewingStatus: 'Раскроено' });
      load();
      loadDetail(selectedOrder.id);
    } catch (e) {
      toast({
        title: 'Не удалось выполнить раскрой',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCutting(false);
    }
  };

  const handleSendToStickering = async (rollId?: number) => {
    if (!selectedOrder) return;
    // Рулон тесьмы обязателен только если товару она нужна (requiredTrimMaterialId задан).
    // Товары без тесьмы отправляются на стикеровку без выбора рулона — backend это допускает.
    const trimNeeded = orderDetail?.requiredTrimMaterialId != null;
    if (trimNeeded && !rollId) return;
    setCutting(true);
    try {
      await sendToStickering(selectedOrder.id, rollId);
      toast({
        title: 'Заказ отправлен на стикеровку',
        description: trimNeeded ? 'Тесьма списана с рулона' : undefined,
      });
      setSelectedOrder({ ...selectedOrder, sewingStatus: 'Стикеровка' });
      load();
      loadDetail(selectedOrder.id);
      setDialogOpen(false);
    } catch (e) {
      toast({
        title: 'Не удалось отправить на стикеровку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCutting(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!selectedOrder) return;
    setCancelling(true);
    try {
      await cancelOrder(selectedOrder.id);
      const targetTab = isCutter ? 'Новый' : 'Раскроено';
      toast({ title: 'Заказ отменён', description: `Заказ возвращён во вкладку «${targetTab}»` });
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отменить заказ',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCancelling(false);
    }
  };

  const rollsInMyWorkshop = rolls.filter(
    (r) => r.workshopId === effectiveWorkshopId && (!effectiveShiftNumber || r.shiftNumber === effectiveShiftNumber)
  );

  // Показываем только рулоны материала, который реально нужен для этого товара
  // (например, для товара "Сетка 200x265" — только рулоны материала "Сетка", не любой тюль)
  const myFabricRolls = orderDetail?.requiredFabricMaterialId
    ? rollsInMyWorkshop.filter((r) => r.materialId === orderDetail.requiredFabricMaterialId)
    : [];

  const myTrimRolls = orderDetail?.requiredTrimMaterialId
    ? rollsInMyWorkshop.filter((r) => r.materialId === orderDetail.requiredTrimMaterialId)
    : [];

  return {
    selectedOrder,
    orderDetail,
    detailLoading,
    dialogOpen,
    setDialogOpen,
    saving,
    cutting,
    cancelling,
    openDetail,
    handleAssignUser,
    handleAssignWorkshop,
    handleStatusChange,
    handleCut,
    handleSendToStickering,
    handleCancelOrder,
    myFabricRolls,
    myTrimRolls,
  };
};