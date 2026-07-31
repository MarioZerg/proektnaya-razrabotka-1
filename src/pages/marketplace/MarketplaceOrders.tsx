import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOrders,
  createManualOrder,
  updateOrder,
  deleteOrder,
  type Order,
  type OrderStatus,
  type OrderType,
  type Marketplace,
} from '@/lib/ordersApi';

const productOptions = [
  'Вуаль 200x265',
  'Вуаль 300x255',
  'Вуаль 300x265',
  'Лён 200x265',
  'Шифон 300x255',
];

const marketplaceLogo: Record<Marketplace, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

const statusVariant = (status: OrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'Выполнен') return 'secondary';
  if (status === 'Отменён') return 'destructive';
  if (status === 'В работе') return 'default';
  return 'outline';
};

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

const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days} дн. ${remHours} час. назад`;
  return `${hours} час. назад`;
};

interface EditFormState {
  orderNumber: string;
  marketplace: Marketplace;
  orderType: OrderType;
  status: OrderStatus;
  product: string;
}

const emptyManualForm: EditFormState = {
  orderNumber: '',
  marketplace: 'OZON',
  orderType: 'FBO',
  status: 'Новый',
  product: productOptions[0],
};

const MarketplaceOrders = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<EditFormState>(emptyManualForm);
  const [manualSaving, setManualSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchOrders()
      .then(setOrders)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openEdit = (order: Order) => {
    setEditingOrder(order);
    setForm({
      orderNumber: order.orderNumber,
      marketplace: order.marketplace,
      orderType: order.orderType,
      status: order.status,
      product: order.product,
    });
  };

  const closeEdit = () => {
    setEditingOrder(null);
    setForm(null);
  };

  const handleSave = async () => {
    if (!editingOrder || !form) return;
    setSaving(true);
    try {
      await updateOrder(editingOrder.id, {
        orderNumber: form.orderNumber.trim(),
        marketplace: form.marketplace,
        orderType: form.orderType,
        status: form.status,
        product: form.product,
      });
      closeEdit();
      load();
    } catch (err) {
      toast({
        title: 'Не удалось сохранить заказ',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteOrder(id);
    load();
  };

  const openManual = () => {
    setManualForm(emptyManualForm);
    setManualOpen(true);
  };

  const handleManualCreate = async () => {
    if (!manualForm.orderNumber.trim()) return;
    setManualSaving(true);
    try {
      await createManualOrder({
        orderNumber: manualForm.orderNumber.trim(),
        marketplace: manualForm.marketplace,
        orderType: manualForm.orderType,
        product: manualForm.product,
      });
      setManualOpen(false);
      load();
      toast({ title: 'Заказ создан', description: `№ ${manualForm.orderNumber}` });
    } catch (err) {
      toast({
        title: 'Заказ не создан',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Заказы</h1>

        <div className="flex flex-wrap gap-3">
          <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={openManual}>
            <Icon name="Plus" size={16} className="mr-1.5" />
            Добавить заказ вручную
          </Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled>
            <Icon name="RefreshCw" size={16} className="mr-1.5" />
            Загрузить заказы с API
          </Button>
          <Button className="bg-amber-500 text-white hover:bg-amber-600" disabled>
            <Icon name="Ban" size={16} className="mr-1.5" />
            Проверить отменённые заказы
          </Button>
          <Button className="bg-teal-600 text-white hover:bg-teal-700" disabled>
            <Icon name="FileSpreadsheet" size={16} className="mr-1.5" />
            Добавить заказ через Excel
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select defaultValue="new">
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Новые заказы</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="done">Выполненные</SelectItem>
              <SelectItem value="cancelled">Отменённые</SelectItem>
            </SelectContent>
          </Select>
          <Select>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="---" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ozon">OZON</SelectItem>
              <SelectItem value="wb">Wildberries</SelectItem>
              <SelectItem value="yandex">Яндекс.Маркет</SelectItem>
            </SelectContent>
          </Select>
          <Select>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="---" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fbo">FBO</SelectItem>
              <SelectItem value="fbs">FBS</SelectItem>
              <SelectItem value="individual">Индивидуальный</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Заказов пока нет.</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Номер заказа</TableHead>
                  <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                  <TableHead className="text-primary-foreground">Тип</TableHead>
                  <TableHead className="text-primary-foreground">Кластер</TableHead>
                  <TableHead className="text-primary-foreground">Товары</TableHead>
                  <TableHead className="text-primary-foreground">Создан</TableHead>
                  <TableHead className="text-primary-foreground">Выполнен</TableHead>
                  <TableHead className="text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.id}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{o.orderNumber}</TableCell>
                    <TableCell>
                      <span className={marketplaceLogo[o.marketplace]?.className}>
                        {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                      </span>
                    </TableCell>
                    <TableCell>{o.orderType}</TableCell>
                    <TableCell>{o.cluster || '—'}</TableCell>
                    <TableCell>
                      {o.product} - {o.quantity} шт.
                    </TableCell>
                    <TableCell>
                      <div className="whitespace-nowrap">{formatDate(o.createdAt)}</div>
                      <Badge variant="destructive" className="mt-1 font-normal">
                        {timeAgo(o.createdAt)}
                      </Badge>
                    </TableCell>
                    <TableCell>{o.completedAt ? formatDate(o.completedAt) : ''}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="icon" variant="secondary" onClick={() => openEdit(o)}>
                          <Icon name="Pencil" size={14} />
                        </Button>
                        <Button size="icon" variant="destructive" onClick={() => handleDelete(o.id)}>
                          <Icon name="Trash2" size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={editingOrder !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Изменить заказ</DialogTitle>
          </DialogHeader>

          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Номер заявки</Label>
                <Input
                  value={form.orderNumber}
                  onChange={(e) => setForm((f) => f && { ...f, orderNumber: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Маркетплейс</Label>
                  <Select
                    value={form.marketplace}
                    onValueChange={(v) => setForm((f) => f && { ...f, marketplace: v as Marketplace })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OZON">OZON</SelectItem>
                      <SelectItem value="WB">Wildberries</SelectItem>
                      <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Тип</Label>
                  <Select
                    value={form.orderType}
                    onValueChange={(v) => setForm((f) => f && { ...f, orderType: v as OrderType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FBO">FBO</SelectItem>
                      <SelectItem value="FBS">FBS</SelectItem>
                      <SelectItem value="Индивидуальный">Индивидуальный</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Статус</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => f && { ...f, status: v as OrderStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Новый">Новый</SelectItem>
                    <SelectItem value="В работе">В работе</SelectItem>
                    <SelectItem value="Выполнен">Выполнен</SelectItem>
                    <SelectItem value="Отменён">Отменён</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Товар</Label>
                <Select
                  value={form.product}
                  onValueChange={(v) => setForm((f) => f && { ...f, product: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {productOptions.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Один заказ — всегда 1 шт. Для нескольких единиц создайте отдельные заказы.
                </p>
              </div>

              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить заказ вручную</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Номер заявки</Label>
              <Input
                placeholder="Например: 119956630-181"
                value={manualForm.orderNumber}
                onChange={(e) => setManualForm((f) => ({ ...f, orderNumber: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Если такой номер уже есть в системе — заказ не будет создан повторно.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Маркетплейс</Label>
                <Select
                  value={manualForm.marketplace}
                  onValueChange={(v) => setManualForm((f) => ({ ...f, marketplace: v as Marketplace }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OZON">OZON</SelectItem>
                    <SelectItem value="WB">Wildberries</SelectItem>
                    <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Тип</Label>
                <Select
                  value={manualForm.orderType}
                  onValueChange={(v) => setManualForm((f) => ({ ...f, orderType: v as OrderType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FBO">FBO</SelectItem>
                    <SelectItem value="FBS">FBS</SelectItem>
                    <SelectItem value="Индивидуальный">Индивидуальный</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Товар</Label>
              <Select
                value={manualForm.product}
                onValueChange={(v) => setManualForm((f) => ({ ...f, product: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {productOptions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Один заказ — всегда 1 шт. Для нескольких единиц создайте отдельные заказы с разными номерами.
              </p>
            </div>

            <Button
              onClick={handleManualCreate}
              disabled={manualSaving || !manualForm.orderNumber.trim()}
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
            >
              {manualSaving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Создать заказ'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmLayout>
  );
};

export default MarketplaceOrders;