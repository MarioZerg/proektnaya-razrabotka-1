import { useEffect, useState } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchGoodsWarehouse,
  receiveGoods,
  moveGoodsShelf,
  returnGoodsToWorkshop,
  type GoodsWarehouseItem,
} from '@/lib/goodsWarehouseApi';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { fetchOrders, type Order } from '@/lib/ordersApi';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const GoodsWarehouse = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<GoodsWarehouseItem[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [readyOrders, setReadyOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('in_stock');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedShelfId, setSelectedShelfId] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([fetchGoodsWarehouse(), fetchShelves(), fetchOrders()])
      .then(([itemsData, shelvesData, ordersData]) => {
        setItems(itemsData);
        setShelves(shelvesData);
        const acceptedOrderIds = new Set(itemsData.map((i) => i.orderId));
        setReadyOrders(ordersData.filter((o) => o.sewingStatus === 'Готовые' && !acceptedOrderIds.has(o.id)));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = items.filter((i) => statusFilter === 'all' || i.status === statusFilter);

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

  const handleMoveShelf = async (id: number, shelfId: string) => {
    try {
      await moveGoodsShelf(id, shelfId === 'none' ? null : Number(shelfId));
      toast({ title: 'Полка обновлена' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
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

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Склад товара</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Готовые изделия по полкам — источник для поставок на маркетплейс
            </p>
          </div>
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
                  <Label>Заказ (статус «Готовые»)</Label>
                  <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите заказ" />
                    </SelectTrigger>
                    <SelectContent>
                      {readyOrders.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground">Нет готовых заказов</div>
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

        <div className="w-56">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in_stock">На складе</SelectItem>
              <SelectItem value="shipped">Отгружен</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Товаров не найдено</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Товар</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">№ полки</TableHead>
                  <TableHead className="text-primary-foreground">Дата отгрузки</TableHead>
                  <TableHead className="text-primary-foreground">Дата возврата</TableHead>
                  <TableHead className="text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.id}</TableCell>
                    <TableCell>
                      <div className="font-medium">{i.orderNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.material} {i.width}×{i.height}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={i.status === 'in_stock' ? 'default' : 'secondary'}>
                        {i.status === 'in_stock' ? 'На складе' : 'Отгружен'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {i.status === 'in_stock' ? (
                        <Select value={i.shelfId ? String(i.shelfId) : 'none'} onValueChange={(v) => handleMoveShelf(i.id, v)}>
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
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
                      ) : (
                        i.shelfName || '—'
                      )}
                    </TableCell>
                    <TableCell>{i.shippedAt ? formatDate(i.shippedAt) : '—'}</TableCell>
                    <TableCell>{formatDate(i.receivedAt)}</TableCell>
                    <TableCell>
                      {i.status === 'in_stock' && (
                        <Button size="sm" variant="outline" onClick={() => handleReturn(i.id)}>
                          <Icon name="Undo2" size={14} className="mr-1.5" />
                          В цех
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default GoodsWarehouse;
