import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { fetchStackPreview } from '@/lib/ordersApi';
import SewingItemsFilters from '@/components/crm/sewingItems/SewingItemsFilters';
import DonePeriodFilter from '@/components/crm/sewingItems/DonePeriodFilter';
import SewingItemDetailDialog from '@/components/crm/sewingItems/SewingItemDetailDialog';
import { useSewingItemsData } from '@/components/crm/sewingItems/useSewingItemsData';
import { useSewingItemsFilters } from '@/components/crm/sewingItems/useSewingItemsFilters';
import { useSewingItemOrderDetail } from '@/components/crm/sewingItems/useSewingItemOrderDetail';
import { useSewingItemsQueueActions } from '@/components/crm/sewingItems/useSewingItemsQueueActions';
import { isStorekeeperRole } from '@/lib/roles';
import SewingItemsHeaderControls from '@/components/crm/sewingItems/SewingItemsHeaderControls';
import SewingItemsQueuePanel from '@/components/crm/sewingItems/SewingItemsQueuePanel';
import SewingItemsTabsSection from '@/components/crm/sewingItems/SewingItemsTabsSection';
import SewingItemsResults from '@/components/crm/sewingItems/SewingItemsResults';
import InterceptedCutCard from '@/components/crm/sewingItems/InterceptedCutCard';

const SewingItems = () => {
  const {
    user,
    orders,
    employees,
    materials,
    workshops,
    rolls,
    loading,
    listError,
    load,
    printQrCuttingEnabled,
    cancelOrderPenalty,
    isCutter,
    isSewer,
    isPacker,
    isProductionRole,
    visibleTabs,
    effectiveWorkshopId,
    effectiveShiftNumber,
  } = useSewingItemsData();

  // Предел заказов на руках у закройщика — настройка цеха (сейчас 20).
  // Берём с сервера: в разных цехах он может отличаться, а зашитое в код число
  // однажды разойдётся с настройкой, и кнопка начнёт врать.
  const [cutterLimit, setCutterLimit] = useState(20);
  useEffect(() => {
    if (!isCutter || !effectiveWorkshopId) return;
    fetchStackPreview(effectiveWorkshopId)
      .then((p) => setCutterLimit(p.cutterLimit))
      .catch(() => undefined);
  }, [isCutter, effectiveWorkshopId]);

  const {
    activeTab,
    setActiveTab,
    page,
    setPage,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    doneFrom,
    setDoneFrom,
    doneTo,
    setDoneTo,
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
    piecesForTab,
    myUnfinishedCount,
    myUnfinishedOrders,
    myInWorkCount,
    myGroups,
  } = useSewingItemsFilters({
    orders,
    materials,
    visibleTabs,
    isCutter,
    isSewer,
    isPacker,
    userId: user?.id,
    effectiveWorkshopId,
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
    deleting,
    openDetail,
    handleAssignUser,
    handleAssignWorkshop,
    handleStatusChange,
    handleCut,
    handleCutGroup,
    handleSendToStickering,
    handleCancelOrder,
    handleDeleteOrder,
    reloadSelected,
    myFabricRolls,
    myTrimRolls,
  } = useSewingItemOrderDetail({
    load,
    isCutter,
    rolls,
    effectiveWorkshopId,
    effectiveShiftNumber,
    actorId: user?.id,
  });

  const {
    takingStack,
    takingOrder,
    takeOrderCooldown,
    sewWaits,
    overlockWaits,
    overlockInWork,
    maxOverlockOrders,
    overlockBusyBy,
    takeLocked,
    inWork,
    maxOrders,
    refreshSewWaits,
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
    unfinishedOrders: myUnfinishedOrders,
    ordersLoading: loading,
    isSewer,
    printEnabled: printQrCuttingEnabled,
  });

  return (
    <CrmLayout>
      <div className="space-y-4 sm:space-y-6">
        <h1 className="text-xl font-bold">Товары для пошива</h1>

        <SewingItemsHeaderControls
          isProductionRole={isProductionRole}
          workshops={workshops}
          workshopFilter={workshopFilter}
          setWorkshopFilter={setWorkshopFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          setPage={setPage}
          countForTab={countForTab}
          piecesForTab={piecesForTab}
        />

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
          showEmployeeFilter={!isSewer && !isCutter}
          showWorkshopFilter={false}
        />

        {/* Сверка выработки: сколько сотрудник реально сделал за смену или неделю.
            Нужна только на «Готовых» и только тем, кто работает руками, — у админа
            для этого есть отчёты по зарплате. */}
        {activeTab === 'Готовые' && (isSewer || isCutter) && (
          <DonePeriodFilter
            from={doneFrom}
            to={doneTo}
            setFrom={setDoneFrom}
            setTo={setDoneTo}
            count={filteredOrders.length}
            meters={totalMeters}
            onChange={() => setPage(1)}
          />
        )}

        {/* Перехваченный крой: на вешалке бирка от отменённого заказа. Карточка
            стоит над кнопками очереди — швея видит её раньше, чем возьмёт
            следующую вещь, и печатает лист, не отходя от рабочего места. */}
        <InterceptedCutCard
          sewerId={user?.id}
          sewerName={user?.name}
          workshopId={effectiveWorkshopId}
          visible={isSewer}
        />

        <SewingItemsQueuePanel
          isCutter={isCutter}
          isSewer={isSewer}
          effectiveWorkshopId={effectiveWorkshopId}
          lastTakenStack={lastTakenStack}
          takingStack={takingStack}
          myUnfinishedCount={myUnfinishedCount}
          cutterLimit={cutterLimit}
          printQrCuttingEnabled={printQrCuttingEnabled}
          handleTakeStack={handleTakeStack}
          handlePrintTask={handlePrintTask}
          takingOrder={takingOrder}
          takeOrderCooldown={takeOrderCooldown}
          takeLocked={takeLocked}
          inWork={inWork}
          maxOrders={maxOrders}
          handleTakeOrder={handleTakeOrder}
          myInWorkCount={myInWorkCount}
          myGroups={myGroups}
        />

        <SewingItemsTabsSection
          visibleTabs={visibleTabs}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          setPage={setPage}
          countForTab={countForTab}
          isSewer={isSewer}
          loading={loading}
        />

        <SewingItemsResults
          loading={loading}
          listError={listError}
          load={load}
          totalMeters={totalMeters}
          totalPieces={totalPieces}
          pagedOrders={pagedOrders}
          onOpenDetail={openDetail}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          totalCount={filteredOrders.length}
          canPrintSticker={isStorekeeperRole(user?.role) || user?.role === 'admin'}
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
          onCutGroup={handleCutGroup}
          readOnly={isReadOnlyTab}
          isCutterView={isCutter}
          isSewerView={isSewer}
          isAdminView={user?.role === 'admin'}
          availableRolls={isSewer ? myTrimRolls : myFabricRolls}
          onSendToStickering={async (rollId) => {
            await handleSendToStickering(rollId);
            // Место в работе освободилось — перечитываем таймеры остальных вещей.
            if (user?.id) refreshSewWaits(user.id);
          }}
          sewWaitSec={selectedOrder ? sewWaits[selectedOrder.id] || 0 : 0}
          overlockWaitSec={selectedOrder ? overlockWaits[selectedOrder.id] || 0 : 0}
          overlockBusyBy={overlockBusyBy}
          overlockInWork={overlockInWork}
          maxOverlockOrders={maxOverlockOrders}
          onCancelOrder={handleCancelOrder}
          cancelOrderPenalty={cancelOrderPenalty}
          isPackerView={isPacker}
          cancelling={cancelling}
          onOrderUpdated={reloadSelected}
          onDeleteOrder={handleDeleteOrder}
          deleting={deleting}
        />
      </div>
    </CrmLayout>
  );
};

export default SewingItems;