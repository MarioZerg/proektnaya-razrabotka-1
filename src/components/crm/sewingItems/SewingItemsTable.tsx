import type { Dispatch, SetStateAction } from 'react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Order } from '@/lib/ordersApi';
import { marketplaceLogo, formatDate, timeAgo } from '@/components/crm/sewingItems/sewingItemsShared';
import SewingItemsCards from '@/components/crm/sewingItems/SewingItemsCards';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import { printFboSticker } from '@/lib/printFboSticker';

/** Стикер FBO можно печатать для готового FBO-товара — прямо у номера заказа.
 * Доступно только кладовщику и админу (передаётся флагом canPrint). */
const canPrintFboSticker = (o: Order, canPrint: boolean) =>
  canPrint && o.orderType === 'FBO' && o.sewingStatus === 'Готовые';

/** Компактный список страниц с многоточиями: первая, последняя, текущая и соседние.
 * Например при 42 страницах и текущей 6-й: [1, '…', 5, 6, 7, '…', 42]. */
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

interface SewingItemsTableProps {
  loading: boolean;
  pagedOrders: Order[];
  onOpenDetail: (order: Order) => void;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  totalCount?: number;
  /** Печать стикера FBO доступна только кладовщику и админу. */
  canPrintSticker?: boolean;
}

const SewingItemsTable = ({
  loading,
  pagedOrders,
  onOpenDetail,
  page,
  setPage,
  totalPages,
  totalCount = 0,
  canPrintSticker = false,
}: SewingItemsTableProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  return (
    <>
      <div className="md:hidden">
        <SewingItemsCards
          loading={loading}
          pagedOrders={pagedOrders}
          onOpenDetail={onOpenDetail}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          totalCount={totalCount}
          canPrintSticker={canPrintSticker}
        />
      </div>

      <div className="hidden rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              <TableHead className="text-primary-foreground">Номер заказа</TableHead>
              <TableHead className="text-primary-foreground">Кластер</TableHead>
              <TableHead className="text-primary-foreground">Название</TableHead>
              <TableHead className="text-primary-foreground">Ширина</TableHead>
              <TableHead className="text-primary-foreground">Высота</TableHead>
              <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
              <TableHead className="text-primary-foreground">Тип</TableHead>
              <TableHead className="text-primary-foreground">Этапы</TableHead>
              <TableHead className="text-primary-foreground">Вешалка</TableHead>
              <TableHead className="text-primary-foreground">Создан</TableHead>
              <TableHead className="text-primary-foreground">Выполнен</TableHead>
              <TableHead className="text-primary-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedOrders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{o.id}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{o.sewingStatus}</Badge>
                </TableCell>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {o.orderNumber}
                    {canPrintFboSticker(o, canPrintSticker) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              printFboSticker(o);
                            }}
                            className="text-muted-foreground hover:text-blue-600"
                            aria-label="Печать стикера FBO"
                          >
                            <Icon name="Printer" size={15} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Печать стикера FBO</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </TableCell>
                <TableCell>{o.cluster || '—'}</TableCell>
                <TableCell>{o.material || '—'}</TableCell>
                <TableCell>{o.width ?? '—'}</TableCell>
                <TableCell>{o.height ?? '—'}</TableCell>
                <TableCell>
                  <span className={marketplaceLogo[o.marketplace]?.className}>
                    {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                  </span>
                </TableCell>
                <TableCell>{o.orderType}</TableCell>
                <TableCell>
                  <OrderStagesDiagram order={o} />
                </TableCell>
                <TableCell>{o.hangerNumber > 0 ? `№ ${o.hangerNumber}` : '—'}</TableCell>
                <TableCell>
                  <div className="whitespace-nowrap">{formatDate(o.createdAt)}</div>
                  <Badge variant="destructive" className="mt-1 font-normal">
                    {timeAgo(o.createdAt)}
                  </Badge>
                </TableCell>
                <TableCell>{o.completedAt ? formatDate(o.completedAt) : ''}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    className="bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => onOpenDetail(o)}
                  >
                    <Icon name="Eye" size={14} className="mr-1.5" />
                    Просмотр
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="hidden md:block">
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
        </div>
      )}
    </>
  );
};

export default SewingItemsTable;