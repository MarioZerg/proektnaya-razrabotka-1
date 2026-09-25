import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchShipmentDetail,
  createShipmentFromSupplier,
  updatePendingSupply,
  approveSupply,
  rejectSupply,
  resetSupplyAttempt,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import type { Supplier } from '@/lib/suppliersApi';
import { emptyRow, type ItemRow } from '@/components/crm/shipments/fromSupplierShared';
import { rowsToItems, droppedRows } from '@/components/crm/shipments/fromSupplierRows';

interface UseFromSupplierFormsArgs {
  /** Админу подставляем прайс поставщика в карточку подтверждения, кладовщику — нет. */
  isAdmin: boolean;
  userId?: number;
  suppliers: Supplier[];
  /** Перечитать список приёмок после сохранения. */
  load: () => void;
}

/**
 * Формы приёмки от поставщика: создание новой и карточка подтверждения.
 *
 * Вынесено из страницы 1:1 — те же проверки, тексты уведомлений и порядок
 * действий. Логика намеренно не менялась.
 */
export const useFromSupplierForms = ({
  isAdmin,
  userId,
  suppliers,
  load,
}: UseFromSupplierFormsArgs) => {
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ ...emptyRow }]);

  // Карточка подтверждения неподтверждённой поставки (только для админа)
  const [reviewShipment, setReviewShipment] = useState<ShipmentDetail | null>(null);
  // Курс и логистика при подтверждении — из них складывается себестоимость метра.
  const [exchangeRate, setExchangeRate] = useState('');
  const [logisticsCost, setLogisticsCost] = useState('');
  const [reviewRows, setReviewRows] = useState<ItemRow[]>([]);
  const [reviewSupplierId, setReviewSupplierId] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [lastCreatedRolls, setLastCreatedRolls] = useState<{ shipmentId: number; rolls: string[] } | null>(null);

  const openCreate = () => {
    setSupplierId('');
    setComment('');
    setRows([{ ...emptyRow }]);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const items = rowsToItems(rows);
    const dropped = droppedRows(rows);
    if (items.length === 0) {
      toast({
        title: 'Добавьте хотя бы одну позицию',
        description: dropped.length > 0 ? dropped.slice(0, 3).join('; ') : undefined,
        variant: 'destructive',
      });
      return;
    }
    if (!supplierId) {
      toast({ title: 'Выберите поставщика', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await createShipmentFromSupplier({
        supplierId: Number(supplierId),
        comment: comment.trim() || undefined,
        createdBy: userId,
        items,
      });
      // Часть строк могла не пройти — приёмка при этом сохранена целиком.
      // Показываем ровно то, что нужно поправить, вместо общей ошибки.
      // Складываем со строками, отсеянными ещё до отправки: для кладовщика
      // это один и тот же вопрос — «почему принято меньше, чем я набил».
      const allSkipped = [...dropped, ...(res.skipped || [])];
      if (allSkipped.length > 0) {
        toast({
          title: `Приёмка оформлена: принято позиций ${res.saved ?? items.length}`,
          description:
            `Не удалось принять ${allSkipped.length}: ${allSkipped.slice(0, 3).join('; ')}` +
            (allSkipped.length > 3 ? ' и ещё…' : '') +
            '. Откройте приёмку и допишите их',
        });
      } else {
        toast({
          title: 'Приёмка оформлена',
          description: 'Отправлена администратору на подтверждение — материал появится на складе после проверки',
        });
      }
      setDialogOpen(false);
      setRows([{ ...emptyRow }]);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openReview = async (shipmentId: number) => {
    const detail = await fetchShipmentDetail(shipmentId);
    setReviewShipment(detail);
    setReviewSupplierId(detail.supplierId ? String(detail.supplierId) : '');
    setReviewRows(
      detail.items.map((i) => ({
        // id позиции обязателен: по нему за строкой закрепляются уже напечатанные
        // штрихкоды, иначе после правки наклеенные стикеры перестали бы совпадать.
        id: i.id,
        materialId: String(i.materialId),
        // В базе лежит ОБЩИЙ метраж позиции, а в форме показываем метраж одного рулона —
        // так же, как он написан на самом рулоне. Делим обратно на число рулонов.
        quantity:
          i.quantity != null && i.numberRolls
            ? String(Number(i.quantity) / Number(i.numberRolls))
            : String(i.quantity ?? ''),
        numberRolls: String(i.numberRolls ?? ''),
        // Цена: что уже указана, иначе подставляем прайс поставщика — но только админу.
        // Кладовщик цен не видит, и подставлять ему прайс нельзя: сохранив правку состава,
        // он молча зафиксировал бы сегодняшнюю цену как цену поставки.
        price: isAdmin
          ? i.price != null
            ? String(i.price)
            : i.supplierPrice != null
              ? String(i.supplierPrice)
              : ''
          : i.price != null
            ? String(i.price)
            : '',
        currency: i.currency || i.supplierCurrency || '',
        supplierId: i.supplierId ? String(i.supplierId) : '',
        reservedBarcodes: i.reservedBarcodes,
      }))
    );
    // Курс подставляем из карточки поставщика — администратор поправит при необходимости.
    const supplier = suppliers.find((s) => s.id === detail.supplierId);
    setExchangeRate(supplier?.exchangeRate != null ? String(supplier.exchangeRate) : '');
    setLogisticsCost('');
    setLastCreatedRolls(null);
  };

  const handleSaveReview = async () => {
    if (!reviewShipment) return;
    const items = rowsToItems(reviewRows);
    const dropped = droppedRows(reviewRows);
    if (items.length === 0) {
      toast({
        title: 'Добавьте хотя бы одну позицию',
        description: dropped.length > 0 ? dropped.slice(0, 3).join('; ') : undefined,
        variant: 'destructive',
      });
      return;
    }
    setReviewSaving(true);
    try {
      const res = await updatePendingSupply(reviewShipment.id, {
        supplierId: reviewSupplierId ? Number(reviewSupplierId) : undefined,
        items,
      });
      const allSkipped = [...dropped, ...(res.skipped || [])];
      if (allSkipped.length > 0) {
        toast({
          title: `Сохранено позиций: ${res.saved ?? items.length}`,
          description:
            `Не сохранились ${allSkipped.length}: ${allSkipped.slice(0, 3).join('; ')}` +
            (allSkipped.length > 3 ? ' и ещё…' : ''),
        });
      } else {
        toast({ title: 'Позиции обновлены' });
      }
      const detail = await fetchShipmentDetail(reviewShipment.id);
      setReviewShipment(detail);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReviewSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!reviewShipment) return;
    setReviewSaving(true);
    try {
      const res = await approveSupply(reviewShipment.id, {
        exchangeRate: exchangeRate.trim() ? Number(exchangeRate.replace(',', '.')) : null,
        logisticsCost: logisticsCost.trim() ? Number(logisticsCost.replace(',', '.')) : 0,
      });
      // Приход «всё или ничего»: дошли сюда — значит на склад встали ВСЕ рулоны
      // приёмки. Частичного результата здесь не бывает, сервер откатывает целиком.
      toast({
        title: 'Поставка подтверждена',
        description: `Создано рулонов: ${res.createdRolls.length} — все позиции приёмки на складе`,
      });
      setLastCreatedRolls({ shipmentId: reviewShipment.id, rolls: res.createdRolls });
      setReviewShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReviewSaving(false);
    }
  };

  /**
   * Убрать рулоны, оставшиеся от сорвавшихся подтверждений.
   *
   * Склад возвращается к состоянию «до приёмки»: задвоенные остатки исчезают,
   * позиции кладовщика остаются. После этого приёмку принимают заново — одним
   * чистым заходом.
   */
  const handleResetAttempt = async () => {
    if (!reviewShipment) return;
    setReviewSaving(true);
    try {
      const res = await resetSupplyAttempt(reviewShipment.id);
      toast({
        title: 'Задвоенные остатки убраны',
        description: `Удалено рулонов: ${res.deletedRolls}. Теперь примите приёмку заново`,
      });
      // Перечитываем карточку: предупреждение исчезнет, кнопка приёма разблокируется.
      const detail = await fetchShipmentDetail(reviewShipment.id);
      setReviewShipment(detail);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReviewSaving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    try {
      await rejectSupply(rejectId);
      toast({ title: 'Поставка отклонена' });
      setRejectId(null);
      setReviewShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  return {
    dialogOpen,
    setDialogOpen,
    saving,
    supplierId,
    setSupplierId,
    comment,
    setComment,
    rows,
    setRows,
    openCreate,
    handleSave,
    reviewShipment,
    setReviewShipment,
    exchangeRate,
    setExchangeRate,
    logisticsCost,
    setLogisticsCost,
    reviewRows,
    setReviewRows,
    reviewSupplierId,
    setReviewSupplierId,
    reviewSaving,
    rejectId,
    setRejectId,
    lastCreatedRolls,
    openReview,
    handleSaveReview,
    handleApprove,
    handleResetAttempt,
    handleReject,
  };
};

export default useFromSupplierForms;
