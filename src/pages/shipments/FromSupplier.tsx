import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchShipments,
  fetchShipmentDetail,
  createShipmentFromSupplier,
  updatePendingSupply,
  approveSupply,
  rejectSupply,
  deleteShipment,
  type Shipment,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import { fetchSuppliers, type Supplier } from '@/lib/suppliersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { printBarcodes } from '@/lib/printBarcodes';
import { emptyRow, type ItemRow } from '@/components/crm/shipments/fromSupplierShared';
import { formatQuantity } from '@/lib/formatQuantity';
import CreateSupplyDialog from '@/components/crm/shipments/CreateSupplyDialog';
import SuppliesFilters from '@/components/crm/shipments/SuppliesFilters';
import SuppliesTable from '@/components/crm/shipments/SuppliesTable';
import ReviewSupplyDialog from '@/components/crm/shipments/ReviewSupplyDialog';

const FromSupplier = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ ...emptyRow }]);

  const [expandedRolls, setExpandedRolls] = useState<Record<number, ShipmentDetail | null>>({});
  const [loadingRolls, setLoadingRolls] = useState<number | null>(null);

  // Карточка подтверждения неподтверждённой поставки (только для админа)
  const [reviewShipment, setReviewShipment] = useState<ShipmentDetail | null>(null);
  const [reviewRows, setReviewRows] = useState<ItemRow[]>([]);
  const [reviewSupplierId, setReviewSupplierId] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [lastCreatedRolls, setLastCreatedRolls] = useState<{ shipmentId: number; rolls: string[] } | null>(null);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetchShipments({
        type: 'from_supplier',
        status: statusFilter !== 'all' ? statusFilter : undefined,
        supplierId: supplierFilter !== 'all' ? Number(supplierFilter) : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
      fetchSuppliers(),
      fetchMaterialsData(),
    ])
      .then(([shipmentsData, suppliersData, materialsData]) => {
        setShipments(shipmentsData);
        setSuppliers(suppliersData);
        setMaterials(materialsData.materials);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, supplierFilter, dateFrom, dateTo]);

  const openCreate = () => {
    setSupplierId('');
    setComment('');
    setRows([{ ...emptyRow }]);
    setDialogOpen(true);
  };

  // Отрицательное и нулевое количество отбрасываем ещё до отправки: такой рулон
  // создал бы минусовой остаток на складе.
  const rowsToItems = (list: ItemRow[]) =>
    list
      .filter(
        (r) =>
          r.materialId && Number(r.quantity) > 0 && Number(r.numberRolls) >= 1
      )
      .map((r) => ({
        materialId: Number(r.materialId),
        quantity: Number(r.quantity),
        numberRolls: Number(r.numberRolls),
      }));

  const handleSave = async () => {
    const items = rowsToItems(rows);
    if (items.length === 0) {
      toast({ title: 'Добавьте хотя бы одну позицию', variant: 'destructive' });
      return;
    }
    if (!supplierId) {
      toast({ title: 'Выберите поставщика', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createShipmentFromSupplier({
        supplierId: Number(supplierId),
        comment: comment.trim() || undefined,
        createdBy: user?.id,
        items,
      });
      toast({
        title: 'Приёмка оформлена',
        description: 'Отправлена администратору на подтверждение — материал появится на складе после проверки',
      });
      setDialogOpen(false);
      setRows([{ ...emptyRow }]);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleRolls = async (shipmentId: number) => {
    if (shipmentId in expandedRolls) {
      setExpandedRolls((prev) => {
        const next = { ...prev };
        delete next[shipmentId];
        return next;
      });
      return;
    }
    setLoadingRolls(shipmentId);
    try {
      const detail = await fetchShipmentDetail(shipmentId);
      setExpandedRolls((prev) => ({ ...prev, [shipmentId]: detail }));
    } finally {
      setLoadingRolls(null);
    }
  };

  const printShipmentBarcodes = async (shipmentId: number) => {
    let detail = expandedRolls[shipmentId];
    if (!detail) {
      detail = await fetchShipmentDetail(shipmentId);
    }
    // На наклейку рулона кроме штрихкода кладём поставщика и дату приёмки: на складе по ним
    // видно, чей это материал и сколько он лежит (старые рулоны пускают в работу первыми).
    const items = detail.items
      .filter((i) => i.barcode)
      .map((i) => ({
        code: i.barcode as string,
        label: `${i.materialName} — ${formatQuantity(i.quantity)} ${i.unit || ''}`,
        supplier: detail.supplierName,
        receivedAt: detail.completedAt || detail.createdAt,
      }));
    printBarcodes(items, `Приёмка #${shipmentId}`);
  };

  const openReview = async (shipmentId: number) => {
    const detail = await fetchShipmentDetail(shipmentId);
    setReviewShipment(detail);
    setReviewSupplierId(detail.supplierId ? String(detail.supplierId) : '');
    setReviewRows(
      detail.items.map((i) => ({
        materialId: String(i.materialId),
        quantity: String(i.quantity ?? ''),
        numberRolls: String(i.numberRolls ?? ''),
      }))
    );
    setLastCreatedRolls(null);
  };

  const handleSaveReview = async () => {
    if (!reviewShipment) return;
    const items = rowsToItems(reviewRows);
    if (items.length === 0) {
      toast({ title: 'Добавьте хотя бы одну позицию', variant: 'destructive' });
      return;
    }
    setReviewSaving(true);
    try {
      await updatePendingSupply(reviewShipment.id, {
        supplierId: reviewSupplierId ? Number(reviewSupplierId) : undefined,
        items,
      });
      toast({ title: 'Позиции обновлены' });
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
      const res = await approveSupply(reviewShipment.id);
      toast({ title: 'Поставка подтверждена', description: `Создано рулонов: ${res.createdRolls.length}` });
      setLastCreatedRolls({ shipmentId: reviewShipment.id, rolls: res.createdRolls });
      setReviewShipment(null);
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

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteShipment(deleteId);
      toast({ title: 'Поставка удалена' });
      setDeleteId(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const activeFiltersCount = useMemo(
    () => [statusFilter !== 'all', supplierFilter !== 'all', !!dateFrom, !!dateTo].filter(Boolean).length,
    [statusFilter, supplierFilter, dateFrom, dateTo]
  );

  const resetFilters = () => {
    setStatusFilter('all');
    setSupplierFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <CreateSupplyDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onOpenCreate={openCreate}
          suppliers={suppliers}
          materials={materials}
          supplierId={supplierId}
          setSupplierId={setSupplierId}
          comment={comment}
          setComment={setComment}
          rows={rows}
          setRows={setRows}
          saving={saving}
          onSave={handleSave}
        />

        {lastCreatedRolls && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p className="mb-1.5 text-sm font-medium text-emerald-800">
              Поставка #{lastCreatedRolls.shipmentId} подтверждена — создано рулонов: {lastCreatedRolls.rolls.length}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {lastCreatedRolls.rolls.map((bc) => (
                <Badge key={bc} variant="outline" className="font-mono-tech">
                  {bc}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <SuppliesFilters
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          supplierFilter={supplierFilter}
          setSupplierFilter={setSupplierFilter}
          suppliers={suppliers}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          activeFiltersCount={activeFiltersCount}
          onReset={resetFilters}
        />

        <SuppliesTable
          loading={loading}
          shipments={shipments}
          isAdmin={isAdmin}
          expandedRolls={expandedRolls}
          loadingRolls={loadingRolls}
          onToggleRolls={toggleRolls}
          onOpenReview={openReview}
          onPrintShipmentBarcodes={printShipmentBarcodes}
          deleteId={deleteId}
          deleting={deleting}
          onSetDeleteId={setDeleteId}
          onDelete={handleDelete}
        />
      </div>

      <ReviewSupplyDialog
        reviewShipment={reviewShipment}
        onOpenChange={(open) => !open && setReviewShipment(null)}
        suppliers={suppliers}
        materials={materials}
        reviewSupplierId={reviewSupplierId}
        setReviewSupplierId={setReviewSupplierId}
        reviewRows={reviewRows}
        setReviewRows={setReviewRows}
        reviewSaving={reviewSaving}
        onSaveReview={handleSaveReview}
        onApprove={handleApprove}
        rejectId={rejectId}
        setRejectId={setRejectId}
        onReject={handleReject}
      />
    </CrmLayout>
  );
};

export default FromSupplier;