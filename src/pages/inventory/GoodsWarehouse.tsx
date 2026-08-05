import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchGoodsWarehouse,
  receiveGoods,
  receiveReturn,
  groupReceiveGoods,
  returnGoodsToWorkshop,
  markGoodsLost,
  moveGoodsShelfByBarcode,
  type GoodsWarehouseItem,
} from '@/lib/goodsWarehouseApi';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import ReceiveReturnDialog from '@/components/crm/goodsWarehouse/ReceiveReturnDialog';
import GroupReceiveDialog from '@/components/crm/goodsWarehouse/GroupReceiveDialog';
import MoveShelfDialog from '@/components/crm/goodsWarehouse/MoveShelfDialog';
import GoodsWarehouseFilters from '@/components/crm/goodsWarehouse/GoodsWarehouseFilters';
import GoodsWarehouseTable from '@/components/crm/goodsWarehouse/GoodsWarehouseTable';

const GoodsWarehouse = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState<GoodsWarehouseItem[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [readyOrders, setReadyOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('in_stock');
  const [materialFilter, setMaterialFilter] = useState('');
  const [widthFilter, setWidthFilter] = useState('');
  const [heightFilter, setHeightFilter] = useState('');
  const [shelfFilter, setShelfFilter] = useState('');

  // Принять товар (одиночный)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedShelfId, setSelectedShelfId] = useState('');

  // Принять новые возвраты
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnOrderNumber, setReturnOrderNumber] = useState('');
  const [returnShelfId, setReturnShelfId] = useState('');

  // Добавить товары группой
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupSelectedIds, setGroupSelectedIds] = useState<number[]>([]);
  const [groupShelfId, setGroupShelfId] = useState('');

  // Смена полки
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveBarcode, setMoveBarcode] = useState('');
  const [moveShelfId, setMoveShelfId] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([fetchGoodsWarehouse(), fetchShelves(), fetchOrders()])
      .then(([itemsData, shelvesData, ordersData]) => {
        setItems(itemsData);
        setShelves(shelvesData);
        const acceptedOrderIds = new Set(itemsData.map((i) => i.orderId));
        // На склад хранения принимаем только готовые заказы, отменённые клиентом (по статусу
        // из API OZON/WB). Заказы, идущие по конвейеру, отгружаются на маркетплейс напрямую —
        // всё остальное кладовщик принимает вручную через «Принять возврат».
        setReadyOrders(
          ordersData.filter(
            (o) =>
              o.sewingStatus === 'Готовые' &&
              !acceptedOrderIds.has(o.id) &&
              (o.status === 'Отменён' || (o.ozonStatus || '').toLowerCase().includes('cancel')),
          ),
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const materialsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.material).filter((m): m is string => !!m))).sort(),
    [items]
  );

  const filtered = items.filter((i) => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (materialFilter && i.material !== materialFilter) return false;
    if (widthFilter && i.width !== Number(widthFilter)) return false;
    if (heightFilter && i.height !== Number(heightFilter)) return false;
    if (shelfFilter && String(i.shelfId) !== shelfFilter) return false;
    return true;
  });

  const activeFiltersCount = [
    statusFilter !== 'in_stock',
    !!materialFilter,
    !!widthFilter,
    !!heightFilter,
    !!shelfFilter,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setStatusFilter('all');
    setMaterialFilter('');
    setWidthFilter('');
    setHeightFilter('');
    setShelfFilter('');
  };

  const openReceive = () => {
    setSelectedOrderId('');
    setSelectedShelfId('');
    setDialogOpen(true);
  };

  const handleReceive = async () => {
    if (!selectedOrderId) return;
    setSaving(true);
    try {
      await receiveGoods(Number(selectedOrderId), selectedShelfId ? Number(selectedShelfId) : undefined);
      toast({ title: 'Товар принят на склад' });
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openReturn = () => {
    setReturnOrderNumber('');
    setReturnShelfId('');
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
      await receiveReturn(orderNumber, returnShelfId ? Number(returnShelfId) : undefined);
      toast({ title: 'Возврат принят на хранение' });
      setReturnOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReturnSaving(false);
    }
  };

  const openGroup = () => {
    setGroupSelectedIds([]);
    setGroupShelfId('');
    setGroupOpen(true);
  };

  const toggleGroupOrder = (id: number) => {
    setGroupSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleGroupReceive = async () => {
    if (groupSelectedIds.length === 0) return;
    setGroupSaving(true);
    try {
      const res = await groupReceiveGoods(groupSelectedIds, groupShelfId ? Number(groupShelfId) : undefined);
      toast({ title: `Принято товаров: ${res.createdCount}` });
      setGroupOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setGroupSaving(false);
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
              shelves={shelves}
              orderNumber={returnOrderNumber}
              setOrderNumber={setReturnOrderNumber}
              shelfId={returnShelfId}
              setShelfId={setReturnShelfId}
              saving={returnSaving}
              onSave={handleReceiveReturn}
            />
            <GroupReceiveDialog
              open={groupOpen}
              onOpenChange={setGroupOpen}
              onOpenCreate={openGroup}
              shelves={shelves}
              readyOrders={readyOrders}
              selectedOrderIds={groupSelectedIds}
              onToggleOrder={toggleGroupOrder}
              shelfId={groupShelfId}
              setShelfId={setGroupShelfId}
              saving={groupSaving}
              onSave={handleGroupReceive}
            />
            <Button variant="outline" onClick={() => navigate('/crm/inventory/goods-picking')}>
              <Icon name="ScanLine" size={16} className="mr-2" />
              Товар к подбору
            </Button>
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
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openReceive}>
                  <Icon name="Plus" size={16} className="mr-2" />
                  Принять товар
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Принять готовый товар</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Отменённый клиентом заказ</Label>
                    <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите заказ" />
                      </SelectTrigger>
                      <SelectContent>
                        {readyOrders.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground">
                            Нет отменённых заказов — остальные товары принимайте через «Принять
                            возврат»
                          </div>
                        ) : (
                          readyOrders.map((o) => (
                            <SelectItem key={o.id} value={String(o.id)}>
                              {o.orderNumber} · {o.material} {o.width}×{o.height}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Полка (необязательно)</Label>
                    <Select value={selectedShelfId || 'none'} onValueChange={(v) => setSelectedShelfId(v === 'none' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Без полки" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без полки</SelectItem>
                        {shelves.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full" onClick={handleReceive} disabled={saving || !selectedOrderId}>
                    {saving ? 'Сохранение...' : 'Принять на склад'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
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
          shelfFilter={shelfFilter}
          setShelfFilter={setShelfFilter}
          shelves={shelves}
          activeFiltersCount={activeFiltersCount}
          onReset={resetFilters}
        />

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