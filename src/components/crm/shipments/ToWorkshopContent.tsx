import ToWorkshopFilters from '@/components/crm/shipments/ToWorkshopFilters';
import ToWorkshopTable from '@/components/crm/shipments/ToWorkshopTable';
import ReceiveConfirmDialog from '@/components/crm/shipments/ReceiveConfirmDialog';
import ToWorkshopHeader from '@/components/crm/shipments/ToWorkshopHeader';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import type { ToWorkshopState } from './useToWorkshopState';
import type useToWorkshopActions from './useToWorkshopActions';

interface ToWorkshopContentProps {
  state: ToWorkshopState;
  actions: ReturnType<typeof useToWorkshopActions>;
}

/**
 * Основной экран списка заявок в цех: шапка с вкладками, фильтры, таблица
 * и диалог приёма/отказа. Разметка перенесена 1:1 из ToWorkshop.tsx.
 */
const ToWorkshopContent = ({ state, actions }: ToWorkshopContentProps) => {
  return (
    <>
      <div className="min-w-0 space-y-6 overflow-x-hidden">
        <ToWorkshopHeader
          isProduction={state.isProduction}
          isAdmin={state.isAdmin}
          createOpen={state.createOpen}
          setCreateOpen={state.setCreateOpen}
          openCreate={state.openCreate}
          dialogMaterials={state.dialogMaterials}
          reqMaterialId={state.reqMaterialId}
          setReqMaterialId={state.setReqMaterialId}
          reqComment={state.reqComment}
          setReqComment={state.setReqComment}
          creating={state.creating}
          onCreate={actions.handleCreate}
          workshops={state.workshops}
          reqWorkshopId={state.reqWorkshopId}
          setReqWorkshopId={state.setReqWorkshopId}
          reqShiftNumber={state.reqShiftNumber}
          setReqShiftNumber={state.setReqShiftNumber}
          activeTab={state.activeTab}
          setActiveTab={state.setActiveTab}
          newCount={state.newCount}
          completedCount={state.completedCount}
        />

        <ToWorkshopFilters
          materialFilter={state.materialFilter}
          setMaterialFilter={state.setMaterialFilter}
          materials={state.filterMaterials}
          isProduction={state.isProduction}
          workshopFilter={state.workshopFilter}
          setWorkshopFilter={state.setWorkshopFilter}
          workshops={state.workshops}
          shiftFilter={state.shiftFilter}
          setShiftFilter={state.setShiftFilter}
          shiftOptions={state.shiftOptions}
          shiftOptionLabel={state.shiftOptionLabel}
          activeFiltersCount={state.activeFiltersCount}
          onReset={state.resetFilters}
        />

        {state.listError && (
          <WarehouseFetchError
            title="Не удалось загрузить заявки"
            description={state.listError}
            onRetry={state.load}
          />
        )}

        <ToWorkshopTable
          loading={state.loading}
          error={state.listError}
          shipments={state.visibleShipments}
          workshops={state.workshops}
          zone={state.zone}
          userWorkshopId={state.effectiveWorkshopId}
          userShiftNumber={state.effectiveShiftNumber}
          expandedRolls={state.expandedRolls}
          loadingRolls={state.loadingRolls}
          onToggleRolls={actions.toggleRolls}
          deleteId={state.deleteId}
          deleting={state.deleting}
          onOpenShipment={actions.openShipment}
          onOpenReceiveDialog={actions.openReceiveDialog}
          onSetDeleteId={state.setDeleteId}
          onDelete={actions.handleDelete}
        />
      </div>

      <ReceiveConfirmDialog
        shipment={state.receiveShipment}
        onOpenChange={(open) => !open && state.setReceiveShipment(null)}
        saving={state.receiving}
        onAccept={actions.handleAcceptReceive}
        onReject={actions.handleRejectReceive}
      />
    </>
  );
};

export default ToWorkshopContent;
