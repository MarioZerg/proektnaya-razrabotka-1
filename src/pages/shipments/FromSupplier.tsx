import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
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
import DefectRollsPanel from '@/components/crm/shipments/DefectRollsPanel';
import SuppliesFilters from '@/components/crm/shipments/SuppliesFilters';
import SuppliesTable from '@/components/crm/shipments/SuppliesTable';
import ReviewSupplyDialog from '@/components/crm/shipments/ReviewSupplyDialog';

const FromSupplier = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Кладовщик правит состав приёмки, пока её не принял администратор: свою опечатку
  // он замечает сразу при разгрузке, а раньше ждал админа — машина уже уехала.
  const canEditPending = isStorekeeperRole(user?.role);

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
  // Курс и логистика при подтверждении — из них складывается себестоимость метра.
  const [exchangeRate, setExchangeRate] = useState('');
  const [logisticsCost, setLogisticsCost] = useState('');
  const [reviewRows, setReviewRows] = useState<ItemRow[]>([]);
  const [reviewSupplierId, setReviewSupplierId] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [lastCreatedRolls, setLastCreatedRolls] = useState<{ shipmentId: number; rolls: string[] } | null>(null);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    // Справочники запрашиваем каждый сам по себе: если связь моргнула и один не дошёл,
    // список поставок всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchSuppliers().then(setSuppliers).catch(() => {});
    fetchMaterialsData()
      .then((materialsData) => setMaterials(materialsData.materials))
      .catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchShipments({
      type: 'from_supplier',
      status: statusFilter !== 'all' ? statusFilter : undefined,
      supplierId: supplierFilter !== 'all' ? Number(supplierFilter) : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
      .then(setShipments)
      .catch(() => {})
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
  //
  // ВАЖНО про количество. В форме сотрудник указывает метраж ОДНОГО рулона (как написано
  // на самом рулоне) и сколько таких рулонов пришло: «100 пог.м.» и «10 рулонов» = 1000 м.
  // В систему уходит общий метраж — по нему считается склад и логистика на единицу.
  const rowsToItems = (list: ItemRow[]) =>
    list
      .filter(
        (r) =>
          r.materialId && Number(r.quantity) > 0 && Number(r.numberRolls) >= 1
      )
      .map((r) => ({
        id: r.id,
        materialId: Number(r.materialId),
        quantity: Number(r.quantity) * Number(r.numberRolls),
        numberRolls: Number(r.numberRolls),
        // Цена за единицу в валюте поставщика. Пусто — подставится прайс поставщика.
        price: r.price && r.price.trim() !== '' ? Number(r.price.replace(',', '.')) : null,
        currency: r.currency || null,
        // Поставщик строки. Пусто — берётся основной поставщик приёмки.
        supplierId: r.supplierId ? Number(r.supplierId) : null,
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
    // Поставщика берём у самой позиции — в одной машине их может быть несколько.
    const items: Array<{ code: string; label: string; supplier: string | null; receivedAt: string }> = [];
    for (const i of detail.items) {
      const supplier = i.supplierName || detail.supplierName;
      const receivedAt = detail.completedAt || detail.createdAt;
      if (i.barcode) {
        // Поставка уже подтверждена — печатаем коды созданных рулонов.
        items.push({
          code: i.barcode,
          label: `${i.materialName} — ${formatQuantity(i.quantity)} ${i.unit || ''}`,
          supplier,
          receivedAt,
        });
        continue;
      }
      // Поставка ещё не подтверждена: печатаем забронированные коды, чтобы кладовщик
      // наклеил стикеры прямо при разгрузке. После подтверждения рулоны получат их же.
      const perRoll = i.quantity && i.numberRolls ? Number(i.quantity) / Number(i.numberRolls) : i.quantity;
      for (const code of i.reservedBarcodes || []) {
        items.push({
          code,
          label: `${i.materialName} — ${formatQuantity(perRoll)} ${i.unit || ''}`,
          supplier,
          receivedAt,
        });
      }
    }
    if (items.length === 0) {
      toast({ title: 'Штрихкодов пока нет', variant: 'destructive' });
      return;
    }
    printBarcodes(items, `Приёмка #${shipmentId}`);
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
      const res = await approveSupply(reviewShipment.id, {
        exchangeRate: exchangeRate.trim() ? Number(exchangeRate.replace(',', '.')) : null,
        logisticsCost: logisticsCost.trim() ? Number(logisticsCost.replace(',', '.')) : 0,
      });
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
        {/* Бракованные рулоны из цеха: забираем сканером и решаем с поставщиком —
            возврат или скидка. Панель прячется сама, когда забирать нечего. */}
        <DefectRollsPanel />

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
          canEditPending={canEditPending}
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
        exchangeRate={exchangeRate}
        setExchangeRate={setExchangeRate}
        logisticsCost={logisticsCost}
        setLogisticsCost={setLogisticsCost}
        canApprove={isAdmin}
      />
    </CrmLayout>
  );
};

export default FromSupplier;