import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchShipments,
  fetchShipmentDetail,
  deleteShipment,
  type Shipment,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import { fetchSuppliers, type Supplier } from '@/lib/suppliersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { printBarcodes } from '@/lib/printBarcodes';
import { printAcceptanceSheet as printAcceptanceSheetHtml } from '@/lib/printAcceptanceSheet';
import { formatQuantity } from '@/lib/formatQuantity';

/**
 * Сводит позиции приёмки к строкам «поставщик — материал — метраж».
 * Одинаковые пары складываются: десять рулонов одной ткани — одна строка.
 */
const compositionOf = (detail: ShipmentDetail): NonNullable<Shipment['composition']> => {
  const grouped = new Map<string, NonNullable<Shipment['composition']>[number]>();
  for (const item of detail.items) {
    if (item.removedAt) continue;
    const supplier = item.supplierName || detail.supplierName || '—';
    const material = item.materialName || '—';
    const key = `${supplier}\0${material}`;
    const prev = grouped.get(key);
    const qty = Number(item.quantity) || 0;
    if (prev) prev.quantity += qty;
    else grouped.set(key, { supplier, material, quantity: qty, unit: item.unit || '' });
  }
  return [...grouped.values()].sort(
    (a, b) => a.supplier.localeCompare(b.supplier, 'ru') || a.material.localeCompare(b.material, 'ru'),
  );
};

/** В списке имена через запятую — по ним видно, что приёмка смешанная, ещё до карточки. */
const looksMixed = (s: Shipment) =>
  (s.itemSuppliers || '').includes(',') && (s.materialNames || '').includes(',');

/**
 * Список приёмок от поставщика: загрузка, фильтры, удаление и печать стикеров.
 */
export const useFromSupplierList = () => {
  const { toast } = useToast();

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [deleteId, setDeleteId] = useState<number | null>(null);
  /** Приёмка, которой дописывают стоимость перевозки. */
  const [logisticsShipmentId, setLogisticsShipmentId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadSeq = useRef(0);

  const load = () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    // Справочники запрашиваем каждый сам по себе: если связь моргнула и один не дошёл,
    // список поставок всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchSuppliers().then(setSuppliers).catch(() => {
      // FRONTEND-ONLY: фильтр по поставщику не критичен для списка приёмок.
    });
    fetchMaterialsData()
      .then((materialsData) => setMaterials(materialsData.materials))
      .catch(() => {
        // FRONTEND-ONLY: справочник материалов для формы, не для списка.
      });
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchShipments({
      type: 'from_supplier',
      status: statusFilter !== 'all' ? statusFilter : undefined,
      supplierId: supplierFilter !== 'all' ? Number(supplierFilter) : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
      .then((list) => {
        if (seq !== loadSeq.current) return;
        setListError(null);
        setShipments(list);
        // Состав «поставщик — материал — количество» в списке не приходит.
        // Для смешанных приёмок берём его из карточки, которую сервер уже отдаёт.
        const mixed = list.filter(looksMixed);
        if (!mixed.length) return;
        Promise.all(mixed.map((s) => fetchShipmentDetail(s.id).catch(() => null))).then((details) => {
          if (seq !== loadSeq.current) return;
          const byId = new Map(
            details.filter((d): d is ShipmentDetail => !!d).map((d) => [d.id, compositionOf(d)]),
          );
          setShipments((prev) =>
            prev.map((s) => (byId.has(s.id) ? { ...s, composition: byId.get(s.id) } : s)),
          );
        });
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить приёмки');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, supplierFilter, dateFrom, dateTo]);

  const printShipmentBarcodes = async (shipmentId: number) => {
    const detail = await fetchShipmentDetail(shipmentId);
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

  const printAcceptanceSheet = async (shipmentId: number) => {
    try {
      const detail = await fetchShipmentDetail(shipmentId);
      printAcceptanceSheetHtml(detail);
    } catch (e) {
      toast({
        title: 'Не удалось напечатать лист',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
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

  return {
    shipments,
    suppliers,
    materials,
    loading,
    listError,
    statusFilter,
    setStatusFilter,
    supplierFilter,
    setSupplierFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    deleteId,
    setDeleteId,
    deleting,
    logisticsShipmentId,
    setLogisticsShipmentId,
    load,
    printShipmentBarcodes,
    printAcceptanceSheet,
    handleDelete,
    activeFiltersCount,
    resetFilters,
  };
};

export default useFromSupplierList;
