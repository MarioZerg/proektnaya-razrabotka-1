import { useState } from 'react';
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

type OrderStatus = 'Новый' | 'В работе' | 'Выполнен' | 'Отменён';
type OrderType = 'FBO' | 'FBS' | 'Индивидуальный';
type Marketplace = 'OZON' | 'WB' | 'Yandex';

interface OrderRow {
  id: number;
  status: OrderStatus;
  orderNumber: string;
  marketplace: Marketplace;
  type: OrderType;
  cluster: string;
  products: string;
  quantity: number;
  createdAt: string;
  createdAgo: string;
  completedAt: string | null;
}

const initialOrders: OrderRow[] = [
  { id: 72455, status: 'Новый', orderNumber: '119956630-172', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 200x265', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72456, status: 'Новый', orderNumber: '119956630-173', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 200x265', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72457, status: 'Новый', orderNumber: '119956630-174', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 200x265', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72458, status: 'Новый', orderNumber: '119956630-175', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x255', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72459, status: 'Новый', orderNumber: '119956630-176', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x255', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72460, status: 'Новый', orderNumber: '119956630-177', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x255', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72461, status: 'Новый', orderNumber: '119956630-178', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x265', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72462, status: 'Новый', orderNumber: '119956630-179', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x265', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72463, status: 'Новый', orderNumber: '119956630-180', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x265', quantity: 1, createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
];

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

interface EditFormState {
  orderNumber: string;
  marketplace: Marketplace;
  type: OrderType;
  status: OrderStatus;
  product: string;
  quantity: string;
}

const MarketplaceOrders = () => {
  const [orders, setOrders] = useState<OrderRow[]>(initialOrders);
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const openEdit = (order: OrderRow) => {
    setEditingOrder(order);
    setForm({
      orderNumber: order.orderNumber,
      marketplace: order.marketplace,
      type: order.type,
      status: order.status,
      product: order.products,
      quantity: String(order.quantity),
    });
  };

  const closeEdit = () => {
    setEditingOrder(null);
    setForm(null);
  };

  const handleSave = () => {
    if (!editingOrder || !form) return;
    setSaving(true);
    setTimeout(() => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === editingOrder.id
            ? {
                ...o,
                orderNumber: form.orderNumber,
                marketplace: form.marketplace,
                type: form.type,
                status: form.status,
                products: form.product,
                quantity: Number(form.quantity) || 1,
              }
            : o
        )
      );
      setSaving(false);
      closeEdit();
    }, 400);
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Заказы</h1>

        <div className="flex flex-wrap gap-3">
          <Button className="bg-blue-600 text-white hover:bg-blue-700">
            <Icon name="Plus" size={16} className="mr-1.5" />
            Добавить заказ вручную
          </Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Icon name="RefreshCw" size={16} className="mr-1.5" />
            Загрузить заказы с API
          </Button>
          <Button className="bg-amber-500 text-white hover:bg-amber-600">
            <Icon name="Ban" size={16} className="mr-1.5" />
            Проверить отменённые заказы
          </Button>
          <Button className="bg-teal-600 text-white hover:bg-teal-700">
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
                    <span className={marketplaceLogo[o.marketplace].className}>
                      {marketplaceLogo[o.marketplace].label}
                    </span>
                  </TableCell>
                  <TableCell>{o.type}</TableCell>
                  <TableCell>{o.cluster}</TableCell>
                  <TableCell>
                    {o.products} - {o.quantity} шт.
                  </TableCell>
                  <TableCell>
                    <div className="whitespace-nowrap">{o.createdAt}</div>
                    <Badge variant="destructive" className="mt-1 font-normal">
                      {o.createdAgo}
                    </Badge>
                  </TableCell>
                  <TableCell>{o.completedAt || ''}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="icon" variant="secondary" onClick={() => openEdit(o)}>
                        <Icon name="Pencil" size={14} />
                      </Button>
                      <Button size="icon" variant="destructive">
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
                    value={form.type}
                    onValueChange={(v) => setForm((f) => f && { ...f, type: v as OrderType })}
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

              <div className="grid grid-cols-2 gap-3">
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
                </div>
                <div className="space-y-1.5">
                  <Label>Количество</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) => setForm((f) => f && { ...f, quantity: e.target.value })}
                  />
                </div>
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
    </CrmLayout>
  );
};

export default MarketplaceOrders;