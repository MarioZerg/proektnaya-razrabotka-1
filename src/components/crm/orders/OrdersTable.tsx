import { useEffect, useState } from 'react';
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';

const PAGE_SIZE = 50;

/** Компактный список страниц с многоточиями: первая, последняя, текущая и соседние. */
const buildPageList = (current: number, total: number): Array<number | 'ellipsis'> => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
};
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
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));

  // При изменении набора заказов (фильтры, обновление) возвращаемся на первую страницу,
  // а также не даём странице выйти за пределы диапазона.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);
  useEffect(() => {
    setPage(1);
  }, [orders.length]);

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

  const pagedOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
    <div className="overflow-x-auto rounded-md border border-border">
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
          {pagedOrders.map((o) => {
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

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent className="flex-wrap justify-center">
            <PaginationItem>
              <PaginationLink
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={`cursor-pointer ${page === 1 ? 'pointer-events-none opacity-40' : ''}`}
              >
                <Icon name="ChevronLeft" size={16} />
              </PaginationLink>
            </PaginationItem>
            {buildPageList(page, totalPages).map((p, i) =>
              p === 'ellipsis' ? (
                <PaginationItem key={`e${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === page}
                    onClick={() => setPage(p)}
                    className="cursor-pointer"
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationLink
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className={`cursor-pointer ${page === totalPages ? 'pointer-events-none opacity-40' : ''}`}
              >
                <Icon name="ChevronRight" size={16} />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
};

export default OrdersTable;