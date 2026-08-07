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
import { syncOzonOrders, refreshAllOzonStatuses } from '@/lib/ozonFbsApi';
import { syncYandexOrders } from '@/lib/yandexMarketApi';
import { useAuth } from '@/context/AuthContext';
import { emptyManualRow, type EditFormState, type ManualOrderRow } from '@/components/crm/orders/ordersShared';
import OrdersToolbar, {
  type StatusFilter,
  type MarketplaceFilter,
  type TypeFilter,
} from '@/components/crm/orders/OrdersToolbar';
import OrdersTable from '@/components/crm/orders/OrdersTable';
import OrdersSummary from '@/components/crm/orders/OrdersSummary';
import EditOrderDialog from '@/components/crm/orders/EditOrderDialog';
import CreateManualOrderDialog from '@/components/crm/orders/CreateManualOrderDialog';

const MarketplaceOrders = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  // Заказами с маркетплейса управляет только администратор: он их подгружает по API,
  // заводит вручную, правит и удаляет. Кладовщик и менеджер открывают эту вкладку как
  // справку — посмотреть, что за заказ и в каком он статусе. Менеджер удаляет заказы
  // в другом месте — в поставках FBO, где это часть его работы.
  const canManageOrders = user?.role === 'admin';
  const [orders, setOrders] = useState<Order[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncingOzon, setSyncingOzon] = useState(false);
  const [syncingYandex, setSyncingYandex] = useState(false);
  const [refreshingOzon, setRefreshingOzon] = useState(false);
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

  // Загрузка новых FBS-заказов с OZON (только новые, требующие сборки). Работает в режиме
  // чтения — статусы на OZON не меняются. Нераспознанные артикулы показываем предупреждением.
  const handleSyncOzon = async () => {
    setSyncingOzon(true);
    try {
      const r = await syncOzonOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.skippedNoItem) parts.push(`без товара ${r.skippedNoItem}`);
      toast({
        title: 'Заказы OZON загружены',
        description: `Новых отправлений с OZON: ${r.totalFromOzon}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.ozonSku || u.offerId).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с OZON',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncingOzon(false);
    }
  };

  // Загрузка новых FBS-заказов с Яндекс Маркета. Вещи одного заказа покупателя связываются
  // в группу: ярлык на них общий, поэтому по цеху они едут вместе — один закройщик, одна швея.
  const handleSyncYandex = async () => {
    setSyncingYandex(true);
    try {
      const r = await syncYandexOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.matchedFromStock) parts.push(`закрыто со склада ${r.matchedFromStock}`);
      toast({
        title: 'Заказы Яндекс Маркета загружены',
        description: `Заказов покупателей: ${r.orders.length}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.offerId || u.shopSku).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с Яндекс Маркета',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncingYandex(false);
    }
  };

  // Разом обновляет статусы всех OZON-заказов (сборка/отгрузка/доставка/доставлен) — читает
  // актуальные статусы с OZON, ничего не двигая на его стороне.
  const handleRefreshOzonStatuses = async () => {
    setRefreshingOzon(true);
    try {
      const r = await refreshAllOzonStatuses();
      toast({
        title: 'Статусы OZON обновлены',
        description: `Проверено заказов: ${r.checked}, изменилось статусов: ${r.updated}.`,
      });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось обновить статусы OZON',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRefreshingOzon(false);
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

        {!loading && <OrdersSummary orders={orders} />}

        <OrdersToolbar
          canManage={canManageOrders}
          onOpenManual={openManual}
          onSyncWb={handleSyncWb}
          syncing={syncing}
          onSyncOzon={handleSyncOzon}
          syncingOzon={syncingOzon}
          onSyncYandex={handleSyncYandex}
          syncingYandex={syncingYandex}
          onRefreshOzonStatuses={handleRefreshOzonStatuses}
          refreshingOzon={refreshingOzon}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          marketplaceFilter={marketplaceFilter}
          onMarketplaceChange={setMarketplaceFilter}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
        />

        <OrdersTable
          loading={loading}
          orders={filteredOrders}
          onEdit={openEdit}
          onDelete={handleDelete}
          canManage={canManageOrders}
        />
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