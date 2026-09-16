import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchShipmentDetail,
  updateRollQuantity,
  updateShipmentLogistics,
  type ShipmentDetail,
  type ShipmentItem,
} from '@/lib/shipmentsApi';
import { printBarcodes } from '@/lib/printBarcodes';
import { formatQuantity } from '@/lib/formatQuantity';
import SupplyShowHeader, {
  SupplyShowSearch,
} from '@/components/crm/shipments/SupplyShowHeader';
import SupplyShowSummary from '@/components/crm/shipments/SupplyShowSummary';
import SupplyShowCards from '@/components/crm/shipments/SupplyShowCards';
import SupplyShowTable from '@/components/crm/shipments/SupplyShowTable';

/**
 * Карточка приёмки от поставщика.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА. В списке приёмок рулоны раскрывались мелкой гармошкой:
 * на 284 позиции это нечитаемо, а кладовщику нужно спокойно найти нужный рулон и
 * перепечатать на него стикер — наклейки на складе рвутся и затираются.
 *
 * ПРАВА. Кладовщик здесь только смотрит и печатает: принятую приёмку он не меняет —
 * материал уже на складе, и цифры за ним закреплены. Администратор дополнительно
 * может поправить метраж целого рулона (бирки поставщика врут) и дозаполнить
 * логистику, если счёт за перевозку пришёл позже машины.
 */
const SupplyShow = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canView = isAdmin || isStorekeeperRole(user?.role);

  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Правка метража: держим только одну открытую строку — так меньше шансов
  // случайно переписать соседний рулон.
  const [editItemId, setEditItemId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingQty, setSavingQty] = useState(false);

  const [logisticsValue, setLogisticsValue] = useState('');
  const [savingLogistics, setSavingLogistics] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetchShipmentDetail(Number(id))
      .then(setDetail)
      .catch((e) =>
        toast({
          title: 'Не удалось открыть приёмку',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /** Наклейка рулона: материал с метражом, поставщик и дата приёмки. */
  const printItem = (item: ShipmentItem) => {
    const code = item.barcode || item.reservedBarcodes?.[0];
    if (!code) {
      toast({ title: 'У этой позиции ещё нет штрихкода', variant: 'destructive' });
      return;
    }
    printBarcodes(
      [
        {
          code,
          label: `${item.materialName} — ${formatQuantity(item.quantity)} ${item.unit || ''}`,
          supplier: item.supplierName || detail?.supplierName,
          receivedAt: detail?.completedAt || detail?.createdAt,
        },
      ],
      `Стикер рулона ${code}`,
    );
  };

  /** Печать всех найденных стикеров разом — когда переклеивают целую партию. */
  const printAllFound = () => {
    const items = filtered
      .map((i) => ({ item: i, code: i.barcode || i.reservedBarcodes?.[0] }))
      .filter((x) => x.code);
    if (items.length === 0) {
      toast({ title: 'Печатать нечего', variant: 'destructive' });
      return;
    }
    printBarcodes(
      items.map(({ item, code }) => ({
        code: code as string,
        label: `${item.materialName} — ${formatQuantity(item.quantity)} ${item.unit || ''}`,
        supplier: item.supplierName || detail?.supplierName,
        receivedAt: detail?.completedAt || detail?.createdAt,
      })),
      `Приёмка #${id}`,
    );
  };

  const saveQuantity = async (item: ShipmentItem) => {
    const value = Number((editValue || '').replace(',', '.'));
    if (!value || value <= 0) {
      toast({ title: 'Укажите метраж больше нуля', variant: 'destructive' });
      return;
    }
    setSavingQty(true);
    try {
      await updateRollQuantity(item.id, value);
      toast({
        title: 'Метраж изменён',
        description: 'Себестоимость метра пересчитана по всей приёмке',
      });
      setEditItemId(null);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось изменить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingQty(false);
    }
  };

  const saveLogistics = async () => {
    const value = Number((logisticsValue || '').replace(',', '.'));
    if (!value || value <= 0) {
      toast({ title: 'Укажите стоимость больше нуля', variant: 'destructive' });
      return;
    }
    setSavingLogistics(true);
    try {
      await updateShipmentLogistics(Number(id), value);
      toast({
        title: 'Логистика указана',
        description: 'Себестоимость метра пересчитана по всей приёмке',
      });
      setLogisticsValue('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingLogistics(false);
    }
  };

  // Поиск по штрихкоду и материалу: на 284 позициях глазами рулон не найти, а
  // кладовщик приходит с конкретным рулоном в руках.
  const filtered = useMemo(() => {
    const items = detail?.items || [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.barcode || '').toLowerCase().includes(q) ||
        (i.reservedBarcodes || []).some((c) => c.toLowerCase().includes(q)) ||
        (i.materialName || '').toLowerCase().includes(q),
    );
  }, [detail, search]);

  const totals = useMemo(() => {
    const items = detail?.items || [];
    const inStorage = items.filter((i) => i.rollStatus === 'in_storage').length;
    const quantity = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    return { count: items.length, inStorage, quantity };
  }, [detail]);

  if (!canView) {
    return (
      <CrmLayout>
        <p className="text-muted-foreground">Раздел доступен кладовщикам и администратору</p>
      </CrmLayout>
    );
  }

  const isPending = detail?.status === 'Новый';

  return (
    <CrmLayout>
      <div className="min-w-0 space-y-4 overflow-x-hidden">
        <SupplyShowHeader
          id={id}
          detail={detail}
          loading={loading}
          filteredCount={filtered.length}
          onBack={() => navigate(-1)}
          onPrintAllFound={printAllFound}
        />

        {loading && <p className="text-muted-foreground">Загрузка...</p>}

        {detail && (
          <>
            <SupplyShowSummary
              detail={detail}
              totals={totals}
              isPending={isPending}
              isAdmin={isAdmin}
              logisticsValue={logisticsValue}
              setLogisticsValue={setLogisticsValue}
              savingLogistics={savingLogistics}
              onSaveLogistics={saveLogistics}
            />

            <SupplyShowSearch search={search} setSearch={setSearch} />

            <SupplyShowCards
              filtered={filtered}
              detail={detail}
              isAdmin={isAdmin}
              editItemId={editItemId}
              setEditItemId={setEditItemId}
              editValue={editValue}
              setEditValue={setEditValue}
              savingQty={savingQty}
              onSaveQuantity={saveQuantity}
              onPrintItem={printItem}
            />

            <SupplyShowTable
              filtered={filtered}
              detail={detail}
              isAdmin={isAdmin}
              editItemId={editItemId}
              setEditItemId={setEditItemId}
              editValue={editValue}
              setEditValue={setEditValue}
              savingQty={savingQty}
              onSaveQuantity={saveQuantity}
              onPrintItem={printItem}
            />

            <p className="text-xs text-muted-foreground">
              Принятую приёмку изменить нельзя — материал уже на складе.
              {isAdmin
                ? ' Администратор может поправить метраж рулона, пока тот целым лежит на складе.'
                : ' Если метраж на бирке не совпал с фактом, скажите администратору.'}
            </p>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default SupplyShow;
