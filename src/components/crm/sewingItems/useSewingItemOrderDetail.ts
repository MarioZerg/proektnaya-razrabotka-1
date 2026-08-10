import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOrderDetail,
  updateOrder,
  cutOrder,
  cutOrderGroup,
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
  /** Текущий пользователь — нужен для проверки прав на смену статуса (только админ). */
  actorId?: number;
}

/** Диалог детальной карточки заказа: открытие/загрузка деталей и все действия над
 * выбранным заказом (назначение сотрудника/цеха, смена статуса, раскрой, отправка на
 * стикеровку, отмена), а также рулоны, доступные для раскроя/стикеровки этого заказа. */
export const useSewingItemOrderDetail = ({
  load,
  isCutter,
  rolls,
  effectiveWorkshopId,
  actorId,
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
      await updateOrder(selectedOrder.id, { sewingStatus: status as SewingStatus, actorId });
      toast({ title: 'Статус обновлён' });
      setSelectedOrder({ ...selectedOrder, sewingStatus: status });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  /** Раскроить всю связку Яндекса разом: закройщик отправляет в цех весь заказ покупателя
   * одной кнопкой, чтобы его потом целиком взяла одна швея. */
  const handleCutGroup = async (rollId?: number, hangerNumber?: number) => {
    if (!selectedOrder) return;
    setCutting(true);
    try {
      const res = await cutOrderGroup(selectedOrder.id, rollId, hangerNumber, actorId);
      toast({
        title: `Связка раскроена: ${res.cutCount} вещей`,
        description: 'Повесьте их вместе — заказ целиком возьмёт одна швея',
      });
      setSelectedOrder({ ...selectedOrder, sewingStatus: 'Раскроено' });
      load();
      loadDetail(selectedOrder.id);
    } catch (e) {
      toast({
        title: 'Не удалось раскроить связку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCutting(false);
    }
  };

  const handleCut = async (rollId?: number, hangerNumber?: number) => {
    if (!selectedOrder) return;
    setCutting(true);
    try {
      await cutOrder(selectedOrder.id, rollId, hangerNumber, actorId);
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
      await sendToStickering(selectedOrder.id, rollId, actorId);
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
      // Швея вкладку «Раскроено» не видит: заказ уходит обратно в общую очередь,
      // откуда его выдаст кнопка «Получить новый заказ» — ей и говорим про очередь.
      toast({
        title: 'Заказ отменён',
        description: isCutter
          ? 'Заказ возвращён во вкладку «Новый»'
          : 'Заказ возвращён в общую очередь на пошив',
      });
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

  // Перезагрузка текущего заказа после привязки товара к стикеру FBO: обновляем и деталь
  // (marketplaceItemId), и сам selectedOrder (productBarcode для печати), и общий список.
  const reloadSelected = async () => {
    if (!selectedOrder) return;
    const detail = await fetchOrderDetail(selectedOrder.id);
    setOrderDetail(detail);
    setSelectedOrder(detail);
    load();
  };

  // Список рулонов уже отобран сервером по цеху, смене и роли сотрудника (включая
  // гостевой режим). Повторно резать его по смене НЕЛЬЗЯ: гость работает в чужом цехе,
  // где нужный материал часто заведён другой сменой — такие рулоны сервер присылает
  // с пометкой «материал чужой смены», а этот фильтр их выбрасывал. В итоге швея-гость
  // не могла указать тесьму и отправить заказ на стикеровку.
  const rollsInMyWorkshop = rolls.filter(
    (r) => !effectiveWorkshopId || r.workshopId === effectiveWorkshopId
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
    handleCutGroup,
    handleSendToStickering,
    handleCancelOrder,
    reloadSelected,
    myFabricRolls,
    myTrimRolls,
  };
};