import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import { fetchMarketplaceItems, type MarketplaceItem, type Shop } from '@/lib/marketplaceItemsApi';
import { useAuth } from '@/context/AuthContext';
import useGlobalScanner from '@/hooks/useGlobalScanner';
import OrdersToolbar, {
  type StatusFilter,
  type MarketplaceFilter,
  type TypeFilter,
} from '@/components/crm/orders/OrdersToolbar';
import OrdersTable from '@/components/crm/orders/OrdersTable';
import OrdersSummary from '@/components/crm/orders/OrdersSummary';
import OrdersDuplicatesAlert from '@/components/crm/orders/OrdersDuplicatesAlert';
import OrdersConfirmDialogs from '@/components/crm/orders/OrdersConfirmDialogs';
import OrdersPageDialogs from '@/components/crm/orders/OrdersPageDialogs';
import OrdersSearchStatus, { OrdersSearchError } from '@/components/crm/orders/OrdersSearchStatus';
import { useOrdersSync } from '@/components/crm/orders/useOrdersSync';
import { useOrdersSearch } from '@/components/crm/orders/useOrdersSearch';
import { useOrderActions } from '@/components/crm/orders/useOrderActions';
import { filterMarketplaceOrders } from '@/components/crm/orders/filterMarketplaceOrders';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const MarketplaceOrders = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  // Заказами с маркетплейса управляет только администратор: он их подгружает по API,
  // заводит вручную, правит и удаляет. Кладовщик и менеджер открывают эту вкладку как
  // справку — посмотреть, что за заказ и в каком он статусе. Менеджер удаляет заказы
  // в другом месте — в поставках FBO, где это часть его работы.
  const canManageOrders = user?.role === 'admin';
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>([]);
  // Магазины нужны в подборе товара: карточки МЕГАТЮЛЬ и ДЮНЫ лежат вперемешку,
  // и без метки один и тот же размер не отличить.
  const [shops, setShops] = useState<Shop[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const [marketplaceFilter, setMarketplaceFilter] = useState<MarketplaceFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // Материал, который закончился: по нему админ снимает заказы с конвейера.
  const [materialFilter, setMaterialFilter] = useState<string>('all');
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);

  const {
    search,
    setSearch,
    searchResults,
    setSearchResults,
    searching,
    searchError,
    setSearchRetry,
    resultsFor,
  } = useOrdersSearch();

  const load = () => {
    setLoading(true);
    fetchOrders()
      .then((list) => {
        setListError(null);
        setOrders(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить заказы');
      })
      .finally(() => setLoading(false));
  };

  const {
    syncing,
    syncingOzon,
    syncingYandex,
    refreshingOzon,
    handleSyncWb,
    handleSyncOzon,
    handleSyncYandex,
    handleRefreshOzonStatuses,
  } = useOrdersSync(user, load);

  const actions = useOrderActions({ load, search, setSearchResults });
  const { editingOrder, openEdit } = actions;

  useEffect(() => {
    load();
    fetchMarketplaceItems().then(({ items, shops: shopList }) => {
      setMarketplaceItems(items);
      setShops(shopList);
    }).catch(() => {
      // FRONTEND-ONLY: справочник для ручного заказа. Сбой не прячет конвейер.
    });
  }, []);

  // СКАН ЭТИКЕТКИ — СРАЗУ К ЗАКАЗУ.
  //
  // На складе пикают этикетку посылки: трек Ozon Доставки у заказов сайта
  // (Y731764E7E48-433E), номер отправления Ozon, заказ WB или Яндекса. Код
  // встаёт в поиск, и если заказ ровно один — открываем его карточку, чтобы
  // не искать глазами в списке. Ручной набор в поле поиска сканер не трогает.
  const scannedRef = useRef<string | null>(null);
  const [scanTick, setScanTick] = useState(0);
  useGlobalScanner(
    (code) => {
      scannedRef.current = code;
      setSearch(code);
      setScanTick((n) => n + 1);
    },
    !editingOrder,
    { minLength: 6 },
  );
  useEffect(() => {
    const code = scannedRef.current;
    if (!code || searching || !searchResults || resultsFor !== code) return;
    scannedRef.current = null;
    if (searchResults.length === 1 && canManageOrders) {
      openEdit(searchResults[0]);
    } else if (searchResults.length === 0) {
      toast({ title: 'Заказ не найден', description: `По коду ${code} заказов нет`, variant: 'destructive' });
    }
    // openEdit и toast стабильны по смыслу — реагируем только на ответ поиска.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchResults, searching, resultsFor, scanTick]);

  const { duplicates, searchActive, visibleOrders, materials, statusCounts } = filterMarketplaceOrders({
    orders,
    statusFilter,
    marketplaceFilter,
    typeFilter,
    materialFilter,
    search,
    searchResults,
  });

  return (
    <CrmLayout>
      <div className="space-y-4 sm:space-y-6">
        <h1 className="text-xl font-bold">Заказы конвейера</h1>

        {!loading && duplicates.length > 0 && (
          <OrdersDuplicatesAlert duplicates={duplicates} />
        )}

        {!loading && <OrdersSummary orders={orders} />}

        {listError && !searchActive && (
          <WarehouseFetchError
            title="Не удалось загрузить заказы"
            description={listError}
            onRetry={load}
          />
        )}

        <OrdersSearchError
          searchError={searchError}
          onRetry={() => setSearchRetry((n) => n + 1)}
        />

        <OrdersToolbar
          canManage={canManageOrders}
          onOpenManual={actions.openManual}
          onSyncWb={handleSyncWb}
          syncing={syncing}
          onSyncOzon={handleSyncOzon}
          syncingOzon={syncingOzon}
          onSyncYandex={handleSyncYandex}
          syncingYandex={syncingYandex}
          onRefreshOzonStatuses={handleRefreshOzonStatuses}
          refreshingOzon={refreshingOzon}
          onPullByNumber={() => actions.setPullOpen(true)}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          statusCounts={statusCounts}
          marketplaceFilter={marketplaceFilter}
          onMarketplaceChange={setMarketplaceFilter}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          materials={materials}
          materialFilter={materialFilter}
          onMaterialChange={setMaterialFilter}
          onBulkCancel={() => setBulkCancelOpen(true)}
          search={search}
          onSearchChange={setSearch}
          searching={searching}
        />

        <OrdersSearchStatus
          searchActive={searchActive}
          searchError={searchError}
          searching={searching}
          foundCount={visibleOrders.length}
        />

        <OrdersTable
          loading={searchActive ? searching && !searchResults : loading}
          error={searchActive ? searchError : listError}
          orders={visibleOrders}
          onEdit={openEdit}
          onDelete={(id) =>
            actions.setDeleteTarget(visibleOrders.find((o) => o.id === id) || null)
          }
          onRestore={actions.setRestoreTarget}
          canManage={canManageOrders}
        />
      </div>

      <OrdersConfirmDialogs
        deleteTarget={actions.deleteTarget}
        setDeleteTarget={actions.setDeleteTarget}
        deleting={actions.deleting}
        onDelete={actions.handleDelete}
        restoreTarget={actions.restoreTarget}
        setRestoreTarget={actions.setRestoreTarget}
        restoring={actions.restoring}
        onRestore={actions.handleRestore}
      />

      <OrdersPageDialogs
        editingOrder={editingOrder}
        form={actions.form}
        setForm={actions.setForm}
        saving={actions.saving}
        onCloseEdit={actions.closeEdit}
        onSave={actions.handleSave}
        manualOpen={actions.manualOpen}
        setManualOpen={actions.setManualOpen}
        manualRows={actions.manualRows}
        setManualRows={actions.setManualRows}
        marketplaceItems={marketplaceItems}
        shops={shops}
        manualSaving={actions.manualSaving}
        onManualCreate={actions.handleManualCreate}
        pullOpen={actions.pullOpen}
        setPullOpen={actions.setPullOpen}
        bulkCancelOpen={bulkCancelOpen}
        onBulkCancelClose={() => setBulkCancelOpen(false)}
        materialFilter={materialFilter}
        marketplaceFilter={marketplaceFilter}
        load={load}
      />
    </CrmLayout>
  );
};

export default MarketplaceOrders;
