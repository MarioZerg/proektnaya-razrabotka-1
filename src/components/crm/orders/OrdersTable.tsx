import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import {
  formatDate,
  marketplaceLogo,
  statusVariant,
  timeAgo,
} from '@/components/crm/orders/ordersShared';

// Человекочитаемые подписи статусов отправления OZON (только для отображения).
const OZON_STATUS_LABELS: Record<string, string> = {
  awaiting_registration: 'Ожидает регистрации',
  acceptance_in_progress: 'Идёт приёмка',
  awaiting_approve: 'Ожидает подтверждения',
  awaiting_packaging: 'Ожидает сборки',
  awaiting_deliver: 'Ожидает отгрузки',
  arbitration: 'Арбитраж',
  client_arbitration: 'Клиентский арбитраж',
  delivering: 'В доставке',
  driver_pickup: 'У водителя',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
  not_accepted: 'Не принят',
  sent_by_seller: 'Отправлен продавцом',
};

const ozonStatusLabel = (s?: string | null) => (s ? OZON_STATUS_LABELS[s] || s : null);

interface OrdersTableProps {
  loading: boolean;
  orders: Order[];
  onEdit: (order: Order) => void;
  onDelete: (id: number) => void;
}

const OrdersTable = ({ loading, orders, onEdit, onDelete }: OrdersTableProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">Заказов пока нет.</p>;
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-primary hover:bg-primary">
            <TableHead className="text-primary-foreground">#</TableHead>
            <TableHead className="text-primary-foreground">Статус</TableHead>
            <TableHead className="text-primary-foreground">Номер заказа</TableHead>
            <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
            <TableHead className="text-primary-foreground">Тип</TableHead>
            <TableHead className="text-primary-foreground">Статус OZON</TableHead>
            <TableHead className="text-primary-foreground">Кластер</TableHead>
            <TableHead className="text-primary-foreground">Товары</TableHead>
            <TableHead className="text-primary-foreground">Создан</TableHead>
            <TableHead className="text-primary-foreground">Выполнен</TableHead>
            <TableHead className="text-primary-foreground" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => {
            const isCancelled = o.status === 'Отменён';
            return (
            <TableRow key={o.id} className={isCancelled ? 'text-muted-foreground line-through opacity-70' : ''}>
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
              <TableCell>
                {ozonStatusLabel(o.ozonStatus) ? (
                  <Badge variant="outline" className="font-normal">
                    {ozonStatusLabel(o.ozonStatus)}
                  </Badge>
                ) : (
                  '—'
                )}
              </TableCell>
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
                  <Button size="icon" variant="secondary" onClick={() => onEdit(o)}>
                    <Icon name="Pencil" size={14} />
                  </Button>
                  {!isCancelled && (
                    <Button size="icon" variant="destructive" onClick={() => onDelete(o.id)}>
                      <Icon name="Trash2" size={14} />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default OrdersTable;