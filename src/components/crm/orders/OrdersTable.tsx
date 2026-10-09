import { useEffect, useState } from 'react';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import OrdersCards from '@/components/crm/orders/OrdersCards';

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
  /** FRONTEND-ONLY: сбой GET/поиска — не писать «заказов пока нет». */
  error?: string | null;
  orders: Order[];
  onEdit: (order: Order) => void;
  onDelete: (id: number) => void;
  /** Вернуть ошибочно снятый заказ обратно на конвейер. */
  onRestore: (order: Order) => void;
  /** Кладовщик и менеджер смотрят заказы только как справку — без правки и удаления. */
  canManage: boolean;
}

const OrdersTable = ({
  loading,
  error = null,
  orders,
  onEdit,
  onDelete,
  onRestore,
  canManage,
}: OrdersTableProps) => {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);
  useEffect(() => {
    setPage(1);
  }, [orders.length]);

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (orders.length === 0) {
    if (error) return null;
    return <p className="text-sm text-muted-foreground">Заказов пока нет.</p>;
  }

  const pagedOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Всего заказов: {orders.length}</p>
      <OrdersCards
        orders={pagedOrders}
        onEdit={onEdit}
        onDelete={onDelete}
        onRestore={onRestore}
        canManage={canManage}
        ozonStatusLabel={ozonStatusLabel}
      />

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
