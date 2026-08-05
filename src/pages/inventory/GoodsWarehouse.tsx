import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchGoodsWarehouse,
  receiveReturn,
  returnGoodsToWorkshop,
  markGoodsLost,
  moveGoodsShelfByBarcode,
  type GoodsWarehouseItem,
} from '@/lib/goodsWarehouseApi';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import ReceiveReturnDialog from '@/components/crm/goodsWarehouse/ReceiveReturnDialog';
import MoveShelfDialog from '@/components/crm/goodsWarehouse/MoveShelfDialog';
import PlaceOnShelfDialog from '@/components/crm/goodsWarehouse/PlaceOnShelfDialog';
import ShipLabelDialog from '@/components/crm/goodsWarehouse/ShipLabelDialog';
import ReprintReportDialog from '@/components/crm/goodsWarehouse/ReprintReportDialog';
import AdminReceiveDialog from '@/components/crm/goodsWarehouse/AdminReceiveDialog';
import { printShelfPickList } from '@/lib/printShelfPickList';
import GoodsWarehouseFilters from '@/components/crm/goodsWarehouse/GoodsWarehouseFilters';
import GoodsWarehouseTable from '@/components/crm/goodsWarehouse/GoodsWarehouseTable';

const GoodsWarehouse = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [items, setItems] = useState<GoodsWarehouseItem[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('in_stock');
  const [materialFilter, setMaterialFilter] = useState('');
  const [widthFilter, setWidthFilter] = useState('');
  const [heightFilter, setHeightFilter] = useState('');
  const [shelfFilter, setShelfFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');


  // Принять новые возвраты
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnOrderNumber, setReturnOrderNumber] = useState('');


  // Разложить отменённые товары по полкам (сканером) и стикеровка заказов с полок
  const [placeOpen, setPlaceOpen] = useState(false);
  const [shipLabelOpen, setShipLabelOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [adminReceiveOpen, setAdminReceiveOpen] = useState(false);

  // Смена полки
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveBarcode, setMoveBarcode] = useState('');
  const [moveShelfId, setMoveShelfId] = useState('');

  const load = () => {
    setLoading(true);
    // Товар попадает на склад только по сканированию стикера хранения — вручную выбрать
    // заказ и «положить» его на полку нельзя, поэтому список заказов здесь больше не нужен.
    Promise.all([fetchGoodsWarehouse(), fetchShelves()])
      .then(([itemsData, shelvesData]) => {
        setItems(itemsData);
        setShelves(shelvesData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Вещи, отменённые клиентом: упаковщик наклеил стикер хранения, кладовщик ещё не положил
  // их на полку — именно их он забирает из цеха.
  const pendingShelf = useMemo(
    () => items.filter((i) => i.status === 'awaiting_shelf'),
    [items],
  );

  // Вещи с полок, подобранные под новые заказы FBS и ждущие стикера отправления.
  const matchedFromStock = useMemo(
    () => items.filter((i) => i.reservedOrderId && !i.shippingLabeledAt && i.status === 'in_stock'),
    [items],
  );

  const materialsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.material).filter((m): m is string => !!m))).sort(),
    [items]
  );

  const filtered = items.filter((i) => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (materialFilter && i.material !== materialFilter) return false;
    if (widthFilter && i.width !== Number(widthFilter)) return false;
    if (heightFilter && i.height !== Number(heightFilter)) return false;
    // 'none' — вещи без полки: приняты, но ещё не разложены.
    if (shelfFilter === 'none' ? i.shelfId != null : shelfFilter && String(i.shelfId) !== shelfFilter)
      return false;
    if (reasonFilter && i.receiveReason !== reasonFilter) return false;
    return true;
  });

  // Считаем остатки по полкам только среди товаров, которые реально лежат на складе:
  // отгруженные и утерянные вещи собирать не нужно.
  const shelfCounts = useMemo(() => {
    const acc: Record<number, number> = {};
    items.forEach((i) => {
      if (i.status !== 'in_stock' && i.status !== 'picking') return;
      if (i.shelfId == null) return;
      acc[i.shelfId] = (acc[i.shelfId] || 0) + 1;
    });
    return acc;
  }, [items]);

  const noShelfCount = useMemo(
    () =>
      items.filter(
        (i) => i.shelfId == null && (i.status === 'in_stock' || i.status === 'awaiting_shelf'),
      ).length,
    [items],
  );

  const activeFiltersCount = [
    statusFilter !== 'in_stock',
    !!materialFilter,
    !!widthFilter,
    !!heightFilter,
    !!shelfFilter,
    !!reasonFilter,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setStatusFilter('all');
    setMaterialFilter('');
    setWidthFilter('');
    setHeightFilter('');
    setShelfFilter('');
    setReasonFilter('');
  };

  const handlePrintPickList = () => {
    const shelfName =
      shelfFilter === 'none'
        ? 'Без полки'
        : shelves.find((s) => String(s.id) === shelfFilter)?.name || 'Все полки';
    printShelfPickList(filtered, shelfName);
  };

  const openReturn = () => {
    setReturnOrderNumber('');
    setReturnOpen(true);
  };

  const handleReceiveReturn = async () => {
    const orderNumber = returnOrderNumber.trim();
    if (!orderNumber) return;
    // Поле очищаем сразу, до ответа сервера — чтобы не было повторных отправок того же
    // номера при случайных повторных нажатиях, пока идёт запрос.
    setReturnOrderNumber('');
    setReturnSaving(true);
    try {
      await receiveReturn(orderNumber);
      toast({
        title: 'Возврат принят',
        description: 'Отсканируйте стикер хранения в «Разложить по полкам», чтобы положить на полку',
      });
      setReturnOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReturnSaving(false);
    }
  };


  const openMove = () => {
    setMoveBarcode('');
    setMoveShelfId('');
    setMoveOpen(true);
  };

  const handleMoveShelf = async () => {
    const barcode = moveBarcode.trim();
    if (!barcode || !moveShelfId) return;
    // Поле очищаем сразу, до ответа сервера — чтобы не было повторных отправок того же
    // штрихкода при случайных повторных нажатиях, пока идёт запрос.
    setMoveBarcode('');
    setMoveSaving(true);
    try {
      await moveGoodsShelfByBarcode(barcode, Number(moveShelfId));
      toast({ title: 'Полка обновлена' });
      setMoveOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setMoveSaving(false);
    }
  };

  const handleReturn = async (id: number) => {
    try {
      await returnGoodsToWorkshop(id);
      toast({ title: 'Товар возвращён в цех' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleMarkLost = async (id: number, reason: string) => {
    try {
      await markGoodsLost(id, reason);
      toast({ title: 'Товар отмечен утерянным' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Склад товара</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Готовые изделия по полкам — источник для поставок на маркетплейс
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ReceiveReturnDialog
              open={returnOpen}
              onOpenChange={setReturnOpen}
              onOpenCreate={openReturn}
              orderNumber={returnOrderNumber}
              setOrderNumber={setReturnOrderNumber}
              saving={returnSaving}
              onSave={handleReceiveReturn}
            />
            <Button variant="outline" onClick={() => navigate('/crm/inventory/goods-picking')}>
              <Icon name="ScanLine" size={16} className="mr-2" />
              Товар к подбору
            </Button>
            <Button
              variant={pendingShelf.length > 0 ? 'default' : 'outline'}
              onClick={() => setPlaceOpen(true)}
            >
              <Icon name="PackageCheck" size={16} className="mr-2" />
              Разложить по полкам
              {pendingShelf.length > 0 && (
                <span className="ml-2 rounded-full bg-background/25 px-2 text-xs">
                  {pendingShelf.length}
                </span>
              )}
            </Button>
            <Button
              variant={matchedFromStock.length > 0 ? 'default' : 'outline'}
              onClick={() => setShipLabelOpen(true)}
            >
              <Icon name="Tags" size={16} className="mr-2" />
              Стикеровка с полок
              {matchedFromStock.length > 0 && (
                <span className="ml-2 rounded-full bg-background/25 px-2 text-xs">
                  {matchedFromStock.length}
                </span>
              )}
            </Button>
            <PlaceOnShelfDialog
              open={placeOpen}
              onOpenChange={setPlaceOpen}
              shelves={shelves}
              pendingCount={pendingShelf.length}
              onDone={load}
            />
            <ShipLabelDialog
              open={shipLabelOpen}
              onOpenChange={setShipLabelOpen}
              matched={matchedFromStock}
              onDone={load}
            />
            {isAdmin && (
              <>
                <Button onClick={() => setAdminReceiveOpen(true)}>
                  <Icon name="PackagePlus" size={16} className="mr-2" />
                  Принять вручную
                </Button>
                <AdminReceiveDialog
                  open={adminReceiveOpen}
                  onOpenChange={setAdminReceiveOpen}
                  shelves={shelves}
                  onDone={load}
                />
                <Button variant="outline" onClick={() => setReprintOpen(true)}>
                  <Icon name="FileWarning" size={16} className="mr-2" />
                  Пропущенные стикеры
                </Button>
                <ReprintReportDialog open={reprintOpen} onOpenChange={setReprintOpen} />
              </>
            )}
            <MoveShelfDialog
              open={moveOpen}
              onOpenChange={setMoveOpen}
              onOpenCreate={openMove}
              shelves={shelves}
              barcode={moveBarcode}
              setBarcode={setMoveBarcode}
              shelfId={moveShelfId}
              setShelfId={setMoveShelfId}
              saving={moveSaving}
              onSave={handleMoveShelf}
            />
          </div>
        </div>

        <GoodsWarehouseFilters
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          materialFilter={materialFilter}
          setMaterialFilter={setMaterialFilter}
          materials={materialsList}
          widthFilter={widthFilter}
          setWidthFilter={setWidthFilter}
          heightFilter={heightFilter}
          setHeightFilter={setHeightFilter}
          reasonFilter={reasonFilter}
          setReasonFilter={setReasonFilter}
          shelfCounts={shelfCounts}
          noShelfCount={noShelfCount}
          shelfFilter={shelfFilter}
          setShelfFilter={setShelfFilter}
          shelves={shelves}
          activeFiltersCount={activeFiltersCount}
          onReset={resetFilters}
        />

        {/* Сколько вещей отобрано текущим фильтром — кладовщик видит объём работы до того,
            как пойдёт к стеллажу, и может распечатать список, чтобы собирать с бумагой. */}
        {!loading && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {shelfFilter
                ? `На выбранной полке: ${filtered.length} шт`
                : `Показано товаров: ${filtered.length}`}
            </p>
            {filtered.length > 0 && (
              <Button variant="outline" size="sm" onClick={handlePrintPickList}>
                <Icon name="Printer" size={14} className="mr-2" />
                Печать списка
              </Button>
            )}
          </div>
        )}

        <GoodsWarehouseTable
          loading={loading}
          items={filtered}
          onReturnToWorkshop={handleReturn}
          onMarkLost={handleMarkLost}
        />
      </div>
    </CrmLayout>
  );
};

export default GoodsWarehouse;