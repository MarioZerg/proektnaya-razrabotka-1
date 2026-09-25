import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchShipments,
  fetchShipmentDetail,
  deleteShipment,
  type Shipment,
} from '@/lib/shipmentsApi';
import { fetchSuppliers, type Supplier } from '@/lib/suppliersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { printBarcodes } from '@/lib/printBarcodes';
import { formatQuantity } from '@/lib/formatQuantity';

/**
 * Список приёмок от поставщика: загрузка, фильтры, удаление и печать стикеров.
 *
 * Вынесено из страницы 1:1 — те же запросы, те же условия и тот же порядок
 * вызовов. Логика намеренно не менялась.
 */
export const useFromSupplierList = () => {
  const { toast } = useToast();

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [deleteId, setDeleteId] = useState<number | null>(null);
  /** Приёмка, которой дописывают стоимость перевозки. */
  const [logisticsShipmentId, setLogisticsShipmentId] = useState<number | null>(null);
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
    handleDelete,
    activeFiltersCount,
    resetFilters,
  };
};

export default useFromSupplierList;
