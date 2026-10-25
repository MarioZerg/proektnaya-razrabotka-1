import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  createSupply,
  moveSupplyStatus,
  type Supply,
  type SupplyType,
  type OzonDeliveryMethod,
} from '@/lib/marketplaceSuppliesApi';
import { type PendingFbs } from '@/components/crm/marketplaceSupplies/ConfirmFbsSupplyDialog';
import { importOzonFboComposition } from '@/lib/ozonFboApi';

const useSupplyCreation = (allSupplies: Supply[], shopId: number | null) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  // Поставка FBS, которую кладовщик собирается создать: ждём подтверждения, что
  // он понимает — до её отгрузки смену закрыть не получится.
  // Для WB FBS здесь же выбирают тип поставки: обычная или B2B (юрлица).
  const [pendingFbs, setPendingFbs] = useState<PendingFbs | null>(null);
  /** OZON FBS уже отсканирована и ждёт 12 часов: её можно закрыть и создать новую. */
  const [closeToCreate, setCloseToCreate] = useState<Supply | null>(null);
  const [ozonFboDialogOpen, setOzonFboDialogOpen] = useState(false);

  const handleCreate = async (marketplace: string, type: SupplyType) => {
    if (marketplace === 'OZON' && type === 'FBS') {
      const open = allSupplies.filter(
        (s) => s.marketplace === 'OZON' && s.type === 'FBS' && s.status !== 'Выполнена' && s.status !== 'Отменена',
      );
      const busy = open.find((s) => s.status !== 'Отгружено');
      if (busy) {
        toast({
          title: 'Поставка ещё не закрыта',
          description: `${busy.supplyNumber || 'Эта поставка'} ещё в работе. Новую создать нельзя.`,
          variant: 'destructive',
        });
        return;
      }
      const ready = open.find((s) => s.status === 'Отгружено');
      if (ready) {
        setCloseToCreate(ready);
        return;
      }
    }
    if (marketplace === 'OZON' && type === 'FBO') {
      setOzonFboDialogOpen(true);
      return;
    }
    // FBS-поставка попадает в задания смены кладовщика и держит её до отгрузки.
    // Предупреждаем заранее: человек должен понимать, что берёт работу на сегодня,
    // а не оставляет её на завтра. Менеджера и админа это не касается — смену
    // держат только задания кладовщика.
    const shiftWarning = type === 'FBS' && isStorekeeperRole(user?.role);
    // WB FBS: заказы юрлиц (B2B) WB не смешивает с обычными — тип выбирают сразу.
    if (shiftWarning || (marketplace === 'WB' && type === 'FBS')) {
      setPendingFbs({ marketplace, type, shiftWarning });
      return;
    }
    await createSupplyNow(marketplace, type, false);
  };

  const closeReadyAndCreate = async () => {
    if (!closeToCreate) return;
    const prev = closeToCreate;
    setCreating(true);
    try {
      await moveSupplyStatus(prev.id, 'Выполнена');
    } catch (e) {
      toast({
        title: 'Не удалось закрыть поставку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      setCreating(false);
      return;
    }
    setCloseToCreate(null);
    await createSupplyNow('OZON', 'FBS', false);
  };

  const createSupplyNow = async (marketplace: string, type: SupplyType, isB2b: boolean) => {
    // Поставка всегда заводится в тот магазин, чья вкладка открыта.
    if (!shopId) return;
    setCreating(true);
    try {
      const res = await createSupply({ marketplace, type, shopId, createdBy: user?.id, isB2b });
      toast({
        title: isB2b ? 'Поставка B2B создана' : 'Поставка создана',
        description: `#${res.id} — заполните товары на карточке`,
      });
      navigate(`/crm/shipments/to-marketplace/${res.id}`);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  // Импорт выбранной заявки OZON FBO: создаёт нашу поставку и заказы на конвейер из
  // товарного состава заявки, затем открывает поставку. Если заявка уже загружена — просто
  // открывает существующую поставку (backend переиспользует её).
  const handleImportOzonApplication = async (orderId: number) => {
    setCreating(true);
    try {
      const res = await importOzonFboComposition(orderId, { id: user?.id, name: user?.name });
      const parts = [`создано заказов: ${res.created}`];
      if (res.skippedNoItem) parts.push(`без товара: ${res.skippedNoItem}`);
      toast({
        title: `Заявка ${res.orderNumber || ''} загружена`,
        description: `Товаров в заявке: ${res.totalItems}. ${parts.join(', ')}.`,
      });
      setOzonFboDialogOpen(false);
      navigate(`/crm/shipments/to-marketplace/${res.supplyId}`);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleCreateOzonDraft = async (deliveryMethod: OzonDeliveryMethod) => {
    if (!shopId) return;
    setCreating(true);
    try {
      const res = await createSupply({
        marketplace: 'OZON',
        type: 'FBO',
        shopId,
        createdBy: user?.id,
        ozonDeliveryMethod: deliveryMethod,
      });
      toast({ title: 'Черновик заявки создан', description: `#${res.id} — заполните данные заявки` });
      setOzonFboDialogOpen(false);
      navigate(`/crm/shipments/to-marketplace/${res.id}`);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  return {
    creating,
    pendingFbs,
    setPendingFbs,
    closeToCreate,
    setCloseToCreate,
    ozonFboDialogOpen,
    setOzonFboDialogOpen,
    handleCreate,
    closeReadyAndCreate,
    createSupplyNow,
    handleImportOzonApplication,
    handleCreateOzonDraft,
  };
};

export default useSupplyCreation;
