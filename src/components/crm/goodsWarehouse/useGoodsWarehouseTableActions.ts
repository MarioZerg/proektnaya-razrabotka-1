import { useState } from 'react';
import { getAccessZone } from '@/lib/roles';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { printStorageStickers } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import { printOrderMarketplaceLabel } from '@/lib/printOrderMarketplaceLabel';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { canPrintStorageSticker } from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface UseGoodsWarehouseTableActionsArgs {
  items: GoodsWarehouseItem[];
  onMarkLost: (id: number, reason: string) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}

/**
 * Состояние и действия таблицы склада: выбор вещей для печати, печать ленты стикеров,
 * перепечатка ярлыка маркетплейса, отметка утери и удаление со склада.
 *
 * Вынесено из таблицы, чтобы разметку можно было читать сверху вниз. Логика перенесена
 * один в один — здесь нет ни одного нового условия.
 */
export const useGoodsWarehouseTableActions = ({
  items,
  onMarkLost,
  onDelete,
}: UseGoodsWarehouseTableActionsArgs) => {
  const [lostId, setLostId] = useState<number | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Какой вещи сейчас тянем ярлык у маркетплейса: он приходит по сети, не мгновенно. */
  const [labelBusyId, setLabelBusyId] = useState<number | null>(null);
  /**
   * Отмеченные галочками вещи — их стикеры печатаются одной лентой.
   *
   * Зачем: раньше наклейки печатались строго по одной. Если после печати вспоминали,
   * что нужна ещё пара вещей, их добавляли поштучно — и найти потом ошибку в пачке
   * было нечем: приходилось выдёргивать стикеры со склада по одному. Теперь кладовщик
   * сначала спокойно отмечает всё, что нужно, глазами проверяет список — и печатает
   * одним заданием.
   */
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { toast } = useToast();

  /** Перепечатка ярлыка маркетплейса по вещи, собранной с полки. */
  const { user } = useAuth();
  /**
   * Печатать наклейки из общего списка склада может только старший кладовщик.
   *
   * Обычный кладовщик печатает стикеры там, где реально работает руками: собирает
   * вещь с полки — и сканер сразу выдаёт наклейку. Печать из таблицы — это печать
   * «вслепую», не держа вещь в руках: наклейка уходит не на ту вещь, а старый ярлык
   * остаётся на пакете. Номер стикера ему по-прежнему виден — найти вещь на полке
   * и назвать её он может.
   */
  const canPrintStickers = user?.role === 'senior_storekeeper' || user?.role === 'admin';

  /**
   * Стикер вещи НА ХРАНЕНИИ печатает любой кладовщик.
   *
   * Опасение выше — про печать «вслепую» — на такую вещь не распространяется:
   * она никуда не едет, ярлыка маркетплейса на ней нет, и перепутать нечего.
   * Наклейка на полке затирается и отклеивается, а без неё вещь нельзя
   * отсканировать в подбор — кладовщик упирается в тупик и ждёт старшего.
   *
   * Печать здесь ничего не меняет в системе: тот же номер, что и был.
   */
  // 'shipped' здесь по той же причине: вещь числится уехавшей, а физически лежит
  // у кладовщика — её вынули из короба, вернули с приёмки или заказ отменили после
  // закрытия поставки. Ярлык маркетплейса на ней уже недействителен, перепутать
  // нечего, а без наклейки вещь не положить на полку и не отсканировать в подбор.
  const canPrintShelfSticker = (item: GoodsWarehouseItem) =>
    canPrintStickers || item.status === 'in_stock' || item.status === 'shipped';

  /**
   * Ярлык отправления печатает ЛЮБОЙ кладовщик, а не только старший.
   *
   * Это не печать «вслепую», как со стикером хранения: ярлык намертво привязан к
   * отправлению, и перепечатка выдаёт ровно тот же код. Реальный случай на складе —
   * порвался пакет: кладовщик перекладывает вещь в новый и ему нужен тот же ярлык
   * сюда и сейчас. Раньше за этим приходилось идти к старшему, и вещь ждала.
   */
  const canPrintMpLabels = getAccessZone(user?.role) === 'warehouse' || user?.role === 'admin';

  const handlePrintMpLabel = async (i: GoodsWarehouseItem) => {
    // Вещь, подобранную с полки, печатаем по её новому заказу; вещь, сшитую сразу
    // под заказ, — по собственному. Иначе ярлык уйдёт не на то отправление.
    const orderId = i.reservedOrderId || i.orderId;
    if (!orderId) return;
    setLabelBusyId(i.id);
    try {
      await printOrderMarketplaceLabel({
        id: orderId,
        orderNumber: i.reservedOrderNumber || i.orderNumber || '',
        marketplace: i.marketplace,
        orderType: i.orderType,
      });
    } catch (e) {
      toast({
        title: 'Ярлык не пришёл',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLabelBusyId(null);
    }
  };

  /** Вещи, которым вообще положен стикер хранения, — только их можно отметить. */
  const printableItems = items.filter(canPrintStorageSticker);
  const selectedItems = printableItems.filter((i) => selectedIds.includes(i.id));
  const allSelected = printableItems.length > 0 && selectedItems.length === printableItems.length;

  const toggleOne = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () =>
    setSelectedIds(allSelected ? [] : printableItems.map((i) => i.id));

  /**
   * Печать ленты выбранных стикеров одним заданием.
   *
   * Индивидуальный пошив печатаем его собственным стикером — на полке такие вещи
   * опознают по ткани и размеру, а не по артикулу. Остальные идут общей лентой:
   * рулонный принтер режет наклейки сам, диалог печати открывается один раз.
   */
  const handlePrintSelected = () => {
    if (selectedItems.length === 0) return;

    const individual = selectedItems.filter((i) => i.receiveReason === 'individual');
    const regular = selectedItems.filter((i) => i.receiveReason !== 'individual');

    if (regular.length > 0) {
      printStorageStickers(
        regular.map((i) => ({
          storageBarcode: i.storageBarcode,
          title: i.product,
          orderNumber: i.orderNumber,
        }))
      );
    }
    individual.forEach((i) =>
      printIndividualSticker({
        orderNumber: i.orderNumber || '',
        material: i.material,
        width: i.width,
        height: i.height,
        storageBarcode: i.storageBarcode,
        product: i.product,
      })
    );

    toast({
      title: `Отправлено на печать: ${selectedItems.length} шт.`,
      description: 'Проверьте ленту перед тем, как наклеивать.',
    });
    setSelectedIds([]);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(deleteId);
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const openLostDialog = (id: number) => {
    setLostId(id);
    setLostReason('');
  };

  const handleConfirmLost = async () => {
    if (!lostId) return;
    setSaving(true);
    try {
      await onMarkLost(lostId, lostReason.trim());
      setLostId(null);
    } finally {
      setSaving(false);
    }
  };

  return {
    lostId,
    setLostId,
    lostReason,
    setLostReason,
    saving,
    deleteId,
    setDeleteId,
    deleting,
    labelBusyId,
    selectedIds,
    setSelectedIds,
    canPrintStickers,
    canPrintShelfSticker,
    canPrintMpLabels,
    handlePrintMpLabel,
    selectedItems,
    allSelected,
    toggleOne,
    toggleAll,
    handlePrintSelected,
    handleConfirmDelete,
    openLostDialog,
    handleConfirmLost,
  };
};

export default useGoodsWarehouseTableActions;