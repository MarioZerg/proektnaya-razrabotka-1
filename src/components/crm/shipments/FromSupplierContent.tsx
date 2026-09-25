import { type Dispatch, type SetStateAction } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Shipment, ShipmentDetail } from '@/lib/shipmentsApi';
import type { Supplier } from '@/lib/suppliersApi';
import type { Material } from '@/lib/materialsApi';
import type { ItemRow } from '@/components/crm/shipments/fromSupplierShared';
import CreateSupplyDialog from '@/components/crm/shipments/CreateSupplyDialog';
import DefectRollsPanel from '@/components/crm/shipments/DefectRollsPanel';
import SuppliesFilters from '@/components/crm/shipments/SuppliesFilters';
import SuppliesTable from '@/components/crm/shipments/SuppliesTable';
import ReviewSupplyDialog from '@/components/crm/shipments/ReviewSupplyDialog';
import LogisticsDialog from '@/components/crm/shipments/LogisticsDialog';

interface FromSupplierContentProps {
  isAdmin: boolean;
  canEditPending: boolean;
  list: {
    shipments: Shipment[];
    suppliers: Supplier[];
    materials: Material[];
    loading: boolean;
    statusFilter: string;
    setStatusFilter: Dispatch<SetStateAction<string>>;
    supplierFilter: string;
    setSupplierFilter: Dispatch<SetStateAction<string>>;
    dateFrom: string;
    setDateFrom: Dispatch<SetStateAction<string>>;
    dateTo: string;
    setDateTo: Dispatch<SetStateAction<string>>;
    deleteId: number | null;
    setDeleteId: Dispatch<SetStateAction<number | null>>;
    deleting: boolean;
    logisticsShipmentId: number | null;
    setLogisticsShipmentId: Dispatch<SetStateAction<number | null>>;
    load: () => void;
    printShipmentBarcodes: (shipmentId: number) => void;
    handleDelete: () => void;
    activeFiltersCount: number;
    resetFilters: () => void;
  };
  forms: {
    dialogOpen: boolean;
    setDialogOpen: Dispatch<SetStateAction<boolean>>;
    saving: boolean;
    supplierId: string;
    setSupplierId: Dispatch<SetStateAction<string>>;
    comment: string;
    setComment: Dispatch<SetStateAction<string>>;
    rows: ItemRow[];
    setRows: Dispatch<SetStateAction<ItemRow[]>>;
    openCreate: () => void;
    handleSave: () => void;
    reviewShipment: ShipmentDetail | null;
    setReviewShipment: Dispatch<SetStateAction<ShipmentDetail | null>>;
    exchangeRate: string;
    setExchangeRate: Dispatch<SetStateAction<string>>;
    logisticsCost: string;
    setLogisticsCost: Dispatch<SetStateAction<string>>;
    reviewRows: ItemRow[];
    setReviewRows: Dispatch<SetStateAction<ItemRow[]>>;
    reviewSupplierId: string;
    setReviewSupplierId: Dispatch<SetStateAction<string>>;
    reviewSaving: boolean;
    rejectId: number | null;
    setRejectId: Dispatch<SetStateAction<number | null>>;
    lastCreatedRolls: { shipmentId: number; rolls: string[] } | null;
    openReview: (shipmentId: number) => void;
    handleSaveReview: () => void;
    handleApprove: () => void;
    handleResetAttempt: () => void;
    handleReject: () => void;
  };
}

/**
 * Разметка страницы приёмки от поставщика.
 *
 * Перенесено из страницы 1:1 — порядок блоков и условия те же.
 */
const FromSupplierContent = ({
  isAdmin,
  canEditPending,
  list,
  forms,
}: FromSupplierContentProps) => (
  <>
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      {/* Бракованные рулоны из цеха: забираем сканером и решаем с поставщиком —
          возврат или скидка. Панель прячется сама, когда забирать нечего. */}
      <DefectRollsPanel />

      <CreateSupplyDialog
        open={forms.dialogOpen}
        onOpenChange={forms.setDialogOpen}
        onOpenCreate={forms.openCreate}
        suppliers={list.suppliers}
        materials={list.materials}
        supplierId={forms.supplierId}
        setSupplierId={forms.setSupplierId}
        comment={forms.comment}
        setComment={forms.setComment}
        rows={forms.rows}
        setRows={forms.setRows}
        saving={forms.saving}
        onSave={forms.handleSave}
      />

      {forms.lastCreatedRolls && (
        <div className="min-w-0 overflow-hidden rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="mb-1.5 text-sm font-medium text-emerald-800">
            Поставка #{forms.lastCreatedRolls.shipmentId} подтверждена — создано рулонов: {forms.lastCreatedRolls.rolls.length}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {forms.lastCreatedRolls.rolls.map((bc) => (
              <Badge key={bc} variant="outline" className="font-mono-tech">
                {bc}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <SuppliesFilters
        statusFilter={list.statusFilter}
        setStatusFilter={list.setStatusFilter}
        supplierFilter={list.supplierFilter}
        setSupplierFilter={list.setSupplierFilter}
        suppliers={list.suppliers}
        dateFrom={list.dateFrom}
        setDateFrom={list.setDateFrom}
        dateTo={list.dateTo}
        setDateTo={list.setDateTo}
        activeFiltersCount={list.activeFiltersCount}
        onReset={list.resetFilters}
      />

      <SuppliesTable
        loading={list.loading}
        shipments={list.shipments}
        isAdmin={isAdmin}
        canEditPending={canEditPending}
        onOpenReview={forms.openReview}
        onOpenLogistics={list.setLogisticsShipmentId}
        onPrintShipmentBarcodes={list.printShipmentBarcodes}
        deleteId={list.deleteId}
        deleting={list.deleting}
        onSetDeleteId={list.setDeleteId}
        onDelete={list.handleDelete}
      />
    </div>

    <LogisticsDialog
      shipment={list.shipments.find((s) => s.id === list.logisticsShipmentId) || null}
      onClose={() => list.setLogisticsShipmentId(null)}
      onSaved={list.load}
    />

    <ReviewSupplyDialog
      reviewShipment={forms.reviewShipment}
      onOpenChange={(open) => !open && forms.setReviewShipment(null)}
      suppliers={list.suppliers}
      materials={list.materials}
      reviewSupplierId={forms.reviewSupplierId}
      setReviewSupplierId={forms.setReviewSupplierId}
      reviewRows={forms.reviewRows}
      setReviewRows={forms.setReviewRows}
      reviewSaving={forms.reviewSaving}
      onSaveReview={forms.handleSaveReview}
      onApprove={forms.handleApprove}
      rejectId={forms.rejectId}
      setRejectId={forms.setRejectId}
      onReject={forms.handleReject}
      strayRolls={forms.reviewShipment?.strayRolls ?? 0}
      onResetAttempt={forms.handleResetAttempt}
      exchangeRate={forms.exchangeRate}
      setExchangeRate={forms.setExchangeRate}
      logisticsCost={forms.logisticsCost}
      setLogisticsCost={forms.setLogisticsCost}
      canApprove={isAdmin}
    />
  </>
);

export default FromSupplierContent;
