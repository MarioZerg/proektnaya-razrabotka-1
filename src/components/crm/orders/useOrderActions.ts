import { useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  searchOrders,
  createManualOrder,
  updateOrder,
  deleteOrder,
  restoreOrder,
  type Order,
} from '@/lib/ordersApi';
import {
  emptyManualRow,
  type EditFormState,
  type ManualOrderRow,
} from '@/components/crm/orders/ordersShared';

interface UseOrderActionsParams {
  load: () => void;
  search: string;
  setSearchResults: Dispatch<SetStateAction<Order[] | null>>;
}

/** Изменение, снятие, возврат и ручное создание заказов на странице «Заказы конвейера». */
export const useOrderActions = ({ load, search, setSearchResults }: UseOrderActionsParams) => {
  const { toast } = useToast();

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  // Аварийная догрузка заказа OZON по номеру — когда его нет на конвейере.
  const [pullOpen, setPullOpen] = useState(false);
  const [manualRows, setManualRows] = useState<ManualOrderRow[]>([emptyManualRow()]);
  const [manualSaving, setManualSaving] = useState(false);

  // Заказ, который админ собрался снять с конвейера — ждёт подтверждения.
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Заказ, который возвращают на конвейер после ошибочного снятия.
  const [restoreTarget, setRestoreTarget] = useState<Order | null>(null);
  const [restoring, setRestoring] = useState(false);

  // ВОЗВРАТ ОШИБОЧНО СНЯТОГО ЗАКАЗА НА КОНВЕЙЕР.
  //
  // Возвращаем только СВОЮ отмену: отменённое маркетплейсом сервер вернуть не
  // даст — отправления на площадке уже нет, и вещь будет некуда отгрузить.
  const handleRestore = async () => {
    const order = restoreTarget;
    if (!order) return;
    setRestoring(true);
    try {
      const res = await restoreOrder(order.id);
      const extra = res.restoredIds?.length > 1
        ? ` Вместе со связкой Яндекса вернулось вещей: ${res.restoredIds.length}.`
        : '';
      toast({
        title: `Заказ ${order.orderNumber} вернулся в работу`,
        description: `Он снова в начале конвейера — ищите его в фильтре «Новые заказы».${extra}`,
      });
      setRestoreTarget(null);
      // Обновляем и список, и результат поиска: заказ чаще всего нашли поиском,
      // и в нём должен смениться статус, а не остаться старый.
      load();
      if (search.trim().length >= 2) {
        // FRONTEND-ONLY: сбой обновления поиска не обнуляет найденный заказ.
        searchOrders(search.trim()).then(setSearchResults).catch(() => undefined);
      }
    } catch (err) {
      toast({
        title: 'Заказ не вернулся в работу',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setRestoring(false);
    }
  };

  const openEdit = (order: Order) => {
    setEditingOrder(order);
    setForm({
      orderNumber: order.orderNumber,
      marketplace: order.marketplace,
      orderType: order.orderType,
      status: order.status,
      product: order.product || '',
    });
  };

  const closeEdit = () => {
    setEditingOrder(null);
    setForm(null);
  };

  const handleSave = async () => {
    if (!editingOrder || !form) return;
    setSaving(true);
    try {
      await updateOrder(editingOrder.id, {
        orderNumber: form.orderNumber.trim(),
        marketplace: form.marketplace,
        orderType: form.orderType,
        status: form.status,
        product: form.product,
      });
      closeEdit();
      load();
    } catch (err) {
      toast({
        title: 'Не удалось сохранить заказ',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // СНЯТИЕ ЗАКАЗА — ДЕЙСТВИЕ НЕОБРАТИМОЕ, ПОЭТОМУ ЧЕРЕЗ ПОДТВЕРЖДЕНИЕ.
  //
  // Заказ уходит не только с нашего конвейера: сервер отменяет его по API
  // маркетплейса, и вернуть его оттуда нельзя. Раньше кнопка срабатывала сразу от
  // одного нажатия, а стояла в строке рядом с «Изменить» — промахнуться было легко.
  const handleDelete = async () => {
    const order = deleteTarget;
    if (!order) return;
    setDeleting(true);
    try {
      const res = await deleteOrder(order.id);
      const extra = res.cancelledIds?.length > 1
        ? ` Вместе со связкой Яндекса снято вещей: ${res.cancelledIds.length}.`
        : '';
      toast({
        title: `Заказ ${order.orderNumber} снят с конвейера`,
        description: res.note
          ? `${res.note}.${extra}`
          : `Отменён на маркетплейсе и скрыт из списка — найти его можно в фильтре «Отменённые».${extra}`,
      });
      setDeleteTarget(null);
      load();
    } catch (err) {
      // Отказ показываем словами: сервер объясняет, почему снять нельзя (заказ уже
      // раскроен, взят в цехе) или что именно ответил маркетплейс. Молча не
      // изменившийся список читается как «нажал, и не сработало».
      toast({
        title: 'Заказ не снят',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const openManual = () => {
    setManualRows([emptyManualRow()]);
    setManualOpen(true);
  };

  // Каждая строка формы — отдельный уникальный заказ (1 заказ = 1 заявка), поэтому заказы
  // создаются последовательно отдельными запросами (не пачкой), чтобы дубль номера или
  // другая ошибка в одной строке не мешала создать остальные и была понятна пользователю.
  const handleManualCreate = async () => {
    setManualSaving(true);
    let createdCount = 0;
    const failed: string[] = [];
    try {
      for (const [idx, row] of manualRows.entries()) {
        if (!row.marketplaceItemId) continue;
        try {
          // Номер заказа присваивается автоматически на сервере (сквозной счётчик 00000-01).
          // За один вызов сервер создаёт столько заявок, сколько изделий заказали.
          const res = await createManualOrder({
            orderType: row.orderType,
            marketplaceItemId: row.marketplaceItemId,
            quantity: row.quantity,
          });
          createdCount += Number(res?.created) || row.quantity || 1;
        } catch (err) {
          failed.push(`Заказ #${idx + 1}: ${err instanceof Error ? err.message : 'ошибка'}`);
        }
      }
      load();
      if (createdCount > 0) {
        toast({ title: `Создано заказов: ${createdCount}` });
      }
      if (failed.length > 0) {
        toast({
          title: `Не удалось создать: ${failed.length}`,
          description: failed.join('; '),
          variant: 'destructive',
        });
      }
      if (failed.length === 0) {
        setManualOpen(false);
      }
    } finally {
      setManualSaving(false);
    }
  };

  return {
    editingOrder,
    form,
    setForm,
    saving,
    manualOpen,
    setManualOpen,
    pullOpen,
    setPullOpen,
    manualRows,
    setManualRows,
    manualSaving,
    deleteTarget,
    setDeleteTarget,
    deleting,
    restoreTarget,
    setRestoreTarget,
    restoring,
    handleRestore,
    openEdit,
    closeEdit,
    handleSave,
    handleDelete,
    openManual,
    handleManualCreate,
  };
};

export default useOrderActions;
