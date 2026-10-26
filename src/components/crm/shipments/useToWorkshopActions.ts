import { useToast } from '@/hooks/use-toast';
import {
  fetchShipmentDetail,
  requestToWorkshop,
  collectScan,
  removeScannedRoll,
  shipToWorkshop,
  receiveAtWorkshop,
  rejectWorkshopReceive,
  deleteShipment,
} from '@/lib/shipmentsApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import type { ToWorkshopState } from './useToWorkshopState';
import { fixScanLayout } from '@/lib/keyboardLayout';

/**
 * Обработчики страницы "Отгрузка в цех": создание заявки, сканирование рулонов,
 * отправка, приём/отказ в цехе, удаление. Логика перенесена 1:1 из ToWorkshop.tsx.
 */
export const useToWorkshopActions = (state: ToWorkshopState) => {
  const { toast } = useToast();
  const {
    user,
    isAdmin,
    requestWorkshopId,
    requestShiftNumber,
    reqMaterialIds,
    reqComment,
    isPackagingOnlyRequest,
    setCreating,
    setCreateOpen,
    load,
    activeShipment,
    setActiveShipment,
    scanCode,
    setScanCode,
    setScanning,
    scanInputRef,
    expandedRolls,
    setExpandedRolls,
    setLoadingRolls,
    receiveShipment,
    setReceiveShipment,
    setReceiving,
    deleteId,
    setDeleteId,
    setDeleting,
  } = state;

  const handleCreate = async () => {
    if (!requestWorkshopId) {
      toast({
        title: isAdmin
          ? 'Выберите цех, за который оформляете заявку'
          : 'За вами не закреплён цех — откройте смену на главной странице',
        variant: 'destructive',
      });
      return;
    }
    // Ткань и тесьма — под смену. Пакеты и этикетки — общий пул цеха, смена не нужна.
    if (!isPackagingOnlyRequest && !requestShiftNumber) {
      toast({
        title: isAdmin
          ? 'Выберите смену, на которую нужен материал'
          : 'За вами не закреплена смена — откройте смену на главной странице',
        variant: 'destructive',
      });
      return;
    }
    const materialIds = reqMaterialIds.map(Number).filter((id) => id > 0);
    if (materialIds.length === 0) {
      toast({ title: 'Выберите хотя бы один материал', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      await requestToWorkshop({
        workshopId: requestWorkshopId,
        ...(isPackagingOnlyRequest
          ? {}
          : { shiftNumber: requestShiftNumber ?? undefined }),
        comment: reqComment.trim() || undefined,
        materialId: materialIds[0],
        materialIds,
        requestedBy: user?.id,
      });
      toast({
        title: isPackagingOnlyRequest
          ? 'Заявка отправлена — упаковка на все смены цеха'
          : 'Заявка отправлена кладовщику',
      });
      setCreateOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const openShipment = async (id: number) => {
    const detail = await fetchShipmentDetail(id);
    setActiveShipment(detail);
  };

  const handleScan = async () => {
    const code = fixScanLayout(scanCode.trim());
    if (!code || !activeShipment) return;
    // Поле очищаем сразу, до ответа сервера — чтобы кладовщик не мог повторно нажать
    // "Добавить" с тем же значением, пока идёт запрос, и чтобы строка ввода не оставалась
    // с "зависшим" кодом при ошибке (иначе автосканирование попытается отправить его снова).
    setScanCode('');
    setScanning(true);
    try {
      await collectScan(activeShipment.id, code);
      playScanSound();
      toast({ title: `Рулон ${code} добавлен` });
      const detail = await fetchShipmentDetail(activeShipment.id);
      setActiveShipment(detail);
    } catch (e) {
      playScanErrorSound();
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      // setTimeout — иначе .focus() сработает раньше, чем React снимет disabled с поля
      // после ререндера, и браузер молча проигнорирует вызов на задизейбленном инпуте.
      setTimeout(() => scanInputRef.current?.focus(), 0);
    }
  };

  const handleRemoveRoll = async (itemId: number) => {
    if (!activeShipment) return;
    try {
      await removeScannedRoll(itemId);
      toast({ title: 'Рулон убран из заявки' });
      const detail = await fetchShipmentDetail(activeShipment.id);
      setActiveShipment(detail);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleShip = async () => {
    if (!activeShipment) return;
    try {
      await shipToWorkshop(activeShipment.id);
      toast({ title: 'Заявка отправлена в цех' });
      setActiveShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const toggleRolls = async (shipmentId: number) => {
    if (shipmentId in expandedRolls) {
      setExpandedRolls((prev) => {
        const next = { ...prev };
        delete next[shipmentId];
        return next;
      });
      return;
    }
    setLoadingRolls(shipmentId);
    try {
      const detail = await fetchShipmentDetail(shipmentId);
      setExpandedRolls((prev) => ({ ...prev, [shipmentId]: detail }));
    } finally {
      setLoadingRolls(null);
    }
  };

  const openReceiveDialog = async (id: number) => {
    const detail = await fetchShipmentDetail(id);
    setReceiveShipment(detail);
  };

  const handleAcceptReceive = async (materialId?: number) => {
    if (!receiveShipment) return;
    setReceiving(true);
    try {
      const res = await receiveAtWorkshop(receiveShipment.id, materialId);
      if (res.completed === false) {
        toast({ title: 'Ткань принята', description: `Осталось принять рулонов: ${res.rollsLeft}` });
        setReceiveShipment(await fetchShipmentDetail(receiveShipment.id));
      } else {
        toast({ title: 'Заявка принята в цехе полностью' });
        setReceiveShipment(null);
      }
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReceiving(false);
    }
  };

  const handleRejectReceive = async (reason: string) => {
    if (!receiveShipment) return;
    setReceiving(true);
    try {
      await rejectWorkshopReceive(receiveShipment.id, reason);
      toast({ title: 'Отказ зафиксирован', description: 'Заявка останется у кладовщика до исправлений' });
      setReceiveShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReceiving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteShipment(deleteId);
      toast({ title: 'Заявка удалена' });
      setDeleteId(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  return {
    handleCreate,
    openShipment,
    handleScan,
    handleRemoveRoll,
    handleShip,
    toggleRolls,
    openReceiveDialog,
    handleAcceptReceive,
    handleRejectReceive,
    handleDelete,
  };
};

export default useToWorkshopActions;
