import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import type { SewingStatus } from '@/lib/ordersApi';
import SewingItemsFilters from '@/components/crm/sewingItems/SewingItemsFilters';
import SewingItemsTable from '@/components/crm/sewingItems/SewingItemsTable';
import SewingItemDetailDialog from '@/components/crm/sewingItems/SewingItemDetailDialog';
import { useSewingItemsData } from '@/components/crm/sewingItems/useSewingItemsData';
import { useSewingItemsFilters } from '@/components/crm/sewingItems/useSewingItemsFilters';
import { useSewingItemOrderDetail } from '@/components/crm/sewingItems/useSewingItemOrderDetail';
import { useSewingItemsQueueActions } from '@/components/crm/sewingItems/useSewingItemsQueueActions';

const SewingItems = () => {
  const {
    user,
    orders,
    employees,
    materials,
    workshops,
    rolls,
    loading,
    load,
    printQrCuttingEnabled,
    isCutter,
    isSewer,
    isPacker,
    isProductionRole,
    visibleTabs,
    effectiveWorkshopId,
    effectiveShiftNumber,
  } = useSewingItemsData();

  const {
    activeTab,
    setActiveTab,
    page,
    setPage,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    employeeFilter,
    setEmployeeFilter,
    materialFilter,
    setMaterialFilter,
    widthFilter,
    setWidthFilter,
    heightFilter,
    setHeightFilter,
    workshopFilter,
    setWorkshopFilter,
    marketplaceFilter,
    setMarketplaceFilter,
    isReadOnlyTab,
    filteredOrders,
    totalPages,
    pagedOrders,
    totalMeters,
    totalPieces,
    countForTab,
    myUnfinishedCount,
    myInWorkCount,
  } = useSewingItemsFilters({
    orders,
    materials,
    visibleTabs,
    isCutter,
    isSewer,
    isPacker,
    userId: user?.id,
  });

  const {
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
    reloadSelected,
    myFabricRolls,
    myTrimRolls,
  } = useSewingItemOrderDetail({
    load,
    isCutter,
    rolls,
    effectiveWorkshopId,
    effectiveShiftNumber,
  });

  const {
    takingStack,
    takingOrder,
    takeOrderCooldown,
    lastTakenStack,
    handleTakeStack,
    handlePrintTask,
    handleTakeOrder,
  } = useSewingItemsQueueActions({
    userId: user?.id,
    userName: user?.name,
    effectiveWorkshopId,
    effectiveShiftNumber,
    load,
    setActiveTab,
    myUnfinishedCount,
    ordersLoading: loading,
  });

  return (
    <CrmLayout>
      <div className="space-y-4 sm:space-y-6">
        <h1 className="text-xl font-bold">Товары для пошива</h1>

        {!isProductionRole && (
          <div className="relative">
            <Icon
              name="Search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Поиск по номеру заказа или ШК"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
        )}

        <SewingItemsFilters
          employees={employees}
          materials={materials}
          workshops={workshops}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          employeeFilter={employeeFilter}
          setEmployeeFilter={setEmployeeFilter}
          materialFilter={materialFilter}
          setMaterialFilter={setMaterialFilter}
          widthFilter={widthFilter}
          setWidthFilter={setWidthFilter}
          heightFilter={heightFilter}
          setHeightFilter={setHeightFilter}
          workshopFilter={workshopFilter}
          setWorkshopFilter={setWorkshopFilter}
          marketplaceFilter={marketplaceFilter}
          setMarketplaceFilter={setMarketplaceFilter}
          showEmployeeFilter={!isCutter && !isSewer}
          showWorkshopFilter={!isCutter && !isSewer}
        />

        {(isCutter || isSewer) && (
          <div className="flex flex-col gap-2">
            {isCutter && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleTakeStack} disabled={takingStack || myUnfinishedCount > 0} className="w-full sm:w-auto">
                  {takingStack ? (
                    <>
                      <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                      Берём заказы...
                    </>
                  ) : (
                    <>
                      <Icon name="Layers" size={16} className="mr-2" />
                      Взять стек заказов
                    </>
                  )}
                </Button>
                {printQrCuttingEnabled && lastTakenStack.length > 0 && (
                  <Button variant="outline" onClick={handlePrintTask} className="w-full sm:w-auto">
                    <Icon name="Printer" size={16} className="mr-2" />
                    Распечатать задание
                  </Button>
                )}
              </div>
            )}
            {isSewer && (
              <Button onClick={handleTakeOrder} disabled={takingOrder || takeOrderCooldown} className="w-full sm:w-auto">
                {takingOrder ? (
                  <>
                    <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                    Получаем заказ...
                  </>
                ) : (
                  <>
                    <Icon name="PackagePlus" size={16} className="mr-2" />
                    Получить новый заказ
                  </>
                )}
              </Button>
            )}

            {isCutter && myUnfinishedCount > 0 && (
              <p className="text-sm text-muted-foreground">
                У вас {myUnfinishedCount} нераскроенных заказов — раскроите их, прежде чем брать новый стек.
              </p>
            )}

            {isSewer && myInWorkCount > 0 && (
              <p className="text-sm text-muted-foreground">
                У вас {myInWorkCount} заказов в работе — укажите рулон тесьмы и отправьте их на стикеровку.
              </p>
            )}
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as SewingStatus);
            setPage(1);
          }}
        >
          <TabsList className="flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto sm:flex-wrap">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 gap-1.5">
                {tab.label}
                <Badge variant="secondary" className="ml-1">
                  {countForTab(tab.value)}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {!loading && (
          <p className="text-sm text-muted-foreground">
            Итого на странице: {totalMeters.toFixed(2)} п.м. ({totalPieces} шт.)
          </p>
        )}

        <SewingItemsTable
          loading={loading}
          pagedOrders={pagedOrders}
          onOpenDetail={openDetail}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          totalCount={filteredOrders.length}
          canPrintSticker={user?.role === 'storekeeper' || user?.role === 'admin'}
        />

        <SewingItemDetailDialog
          dialogOpen={dialogOpen}
          setDialogOpen={setDialogOpen}
          selectedOrder={selectedOrder}
          orderDetail={orderDetail}
          detailLoading={detailLoading}
          saving={saving}
          cutting={cutting}
          employees={employees}
          workshops={workshops}
          onStatusChange={handleStatusChange}
          onAssignUser={handleAssignUser}
          onAssignWorkshop={handleAssignWorkshop}
          onCut={handleCut}
          readOnly={isReadOnlyTab}
          isCutterView={isCutter}
          isSewerView={isSewer}
          availableRolls={isSewer ? myTrimRolls : myFabricRolls}
          onSendToStickering={handleSendToStickering}
          onCancelOrder={handleCancelOrder}
          cancelling={cancelling}
          onOrderUpdated={reloadSelected}
        />
      </div>
    </CrmLayout>
  );
};

export default SewingItems;