import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOrders,
  createManualOrder,
  updateOrder,
  deleteOrder,
  type Order,
} from '@/lib/ordersApi';
import { fetchMarketplaceItems, type MarketplaceItem } from '@/lib/marketplaceItemsApi';
import { syncWbOrders } from '@/lib/wbFbsApi';
import { useAuth } from '@/context/AuthContext';
import { emptyManualRow, type EditFormState, type ManualOrderRow } from '@/components/crm/orders/ordersShared';
import OrdersToolbar, {
  type StatusFilter,
  type MarketplaceFilter,
  type TypeFilter,
} from '@/components/crm/orders/OrdersToolbar';
import OrdersTable from '@/components/crm/orders/OrdersTable';
import EditOrderDialog from '@/components/crm/orders/EditOrderDialog';
import CreateManualOrderDialog from '@/components/crm/orders/CreateManualOrderDialog';

const MarketplaceOrders = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>([]);

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualRows, setManualRows] = useState<ManualOrderRow[]>([emptyManualRow()]);
  const [manualSaving, setManualSaving] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const [marketplaceFilter, setMarketplaceFilter] = useState<MarketplaceFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const load = () => {
    setLoading(true);
    fetchOrders()
      .then(setOrders)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetchMarketplaceItems().then(setMarketplaceItems);
  }, []);

  const openEdit = (order: Order) => {
    setEditingOrder(order);
    setForm({
      orderNumber: order.orderNumber,
      marketplace: order.marketplace,
      orderType: order.orderType,
      status: order.status,
      product: order.product,
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

  const handleDelete = async (id: number) => {
    await deleteOrder(id);
    load();
  };

  // Загрузка новых FBS-заказов с WildBerries через API. Создаёт их в системе со статусом
  // «Новые», чтобы конвейер производства их подхватил. Нераспознанные артикулы (нет товара
  // в справочнике) показываем отдельным предупреждением.
  const handleSyncWb = async () => {
    setSyncing(true);
    try {
      const r = await syncWbOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.skippedNoItem) parts.push(`без товара ${r.skippedNoItem}`);
      toast({
        title: r.sandbox ? 'WB (тестовый режим): загрузка завершена' : 'Заказы WB загружены',
        description: `Получено с WB: ${r.totalFromWb}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.article || u.nmId).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с WildBerries',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
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
    const created: string[] = [];
    const failed: string[] = [];
    try {
      for (const row of manualRows) {
        if (!row.orderNumber.trim() || !row.marketplaceItemId) continue;
        try {
          await createManualOrder({
            orderNumber: row.orderNumber.trim(),
            marketplace: row.marketplace,
            orderType: row.orderType,
            marketplaceItemId: row.marketplaceItemId,
          });
          created.push(row.orderNumber.trim());
        } catch (err) {
          failed.push(`${row.orderNumber.trim()}: ${err instanceof Error ? err.message : 'ошибка'}`);
        }
      }
      load();
      if (created.length > 0) {
        toast({ title: `Создано заказов: ${created.length}`, description: created.join(', ') });
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

  // Этап производства заказа определяется по sewingStatus (поле status почти всегда "Новый"
  // и реальный прогресс не отражает). Отменённые (status='Отменён') показываются только во
  // вкладке "Отменённые" и не попадают в остальные — их видно зачёркнутыми.
  const IN_PROGRESS_STAGES = ['На раскрое', 'Раскроено', 'В работе', 'Стикеровка'];
  const matchesStatus = (o: Order): boolean => {
    const cancelled = o.status === 'Отменён';
    if (statusFilter === 'cancelled') return cancelled;
    if (cancelled) return false;
    if (statusFilter === 'new') return o.sewingStatus === 'Новый';
    if (statusFilter === 'in_progress') return IN_PROGRESS_STAGES.includes(o.sewingStatus);
    if (statusFilter === 'done') return o.sewingStatus === 'Готовые';
    return true;
  };

  const filteredOrders = orders.filter(
    (o) =>
      matchesStatus(o) &&
      (marketplaceFilter === 'all' || o.marketplace === marketplaceFilter) &&
      (typeFilter === 'all' || o.orderType === typeFilter)
  );

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Заказы</h1>

        <OrdersToolbar
          onOpenManual={openManual}
          onSyncWb={handleSyncWb}
          syncing={syncing}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          marketplaceFilter={marketplaceFilter}
          onMarketplaceChange={setMarketplaceFilter}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
        />

        <OrdersTable loading={loading} orders={filteredOrders} onEdit={openEdit} onDelete={handleDelete} />
      </div>

      <EditOrderDialog
        editingOrder={editingOrder}
        form={form}
        setForm={setForm}
        saving={saving}
        onClose={closeEdit}
        onSave={handleSave}
      />

      <CreateManualOrderDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        rows={manualRows}
        setRows={setManualRows}
        marketplaceItems={marketplaceItems}
        manualSaving={manualSaving}
        onCreate={handleManualCreate}
      />
    </CrmLayout>
  );
};

export default MarketplaceOrders;