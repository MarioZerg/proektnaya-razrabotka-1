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
import { formatDate } from '@/lib/dateUtils';
import type { Review } from '@/lib/reviewsApi';
import ReviewPeopleTimeline from '@/components/crm/reviews/ReviewPeopleTimeline';
import {
  wbOrderStatusClass,
  wbOrderStatusLabel,
} from '@/components/crm/reviews/reviewStatus';

interface ReviewsTableProps {
  reviews: Review[];
  /** FRONTEND-ONLY: сбой GET — не писать «отзывов пока нет». */
  error?: string | null;
}

const marketplaceBadge: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'bg-blue-600 text-white hover:bg-blue-700' },
  WB: { label: 'WB', className: 'bg-fuchsia-600 text-white hover:bg-fuchsia-700' },
};

const Stars = ({ rating }: { rating: number | null }) => {
  if (rating == null) return <span className="text-muted-foreground">—</span>;
  const color = rating >= 4 ? 'text-green-600' : rating >= 3 ? 'text-amber-600' : 'text-red-600';
  return (
    <span className={`flex items-center gap-0.5 font-semibold ${color}`}>
      <Icon name="Star" size={13} className="fill-current" />
      {rating}
    </span>
  );
};

const ReviewsTable = ({ reviews, error = null }: ReviewsTableProps) => {
  if (reviews.length === 0) {
    if (error) return null;
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Отзывов пока нет. Нажмите «Обновить отзывы», чтобы загрузить их с OZON и Wildberries.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Площадка</TableHead>
            <TableHead>Оценка</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead className="min-w-[220px]">Отзыв</TableHead>
            <TableHead>Товар / Заказ</TableHead>
            <TableHead className="min-w-[220px]">Кто делал</TableHead>
            <TableHead>Дата отзыва</TableHead>
            <TableHead>Создан</TableHead>
            <TableHead>Завершён</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reviews.map((r) => {
            const mp = marketplaceBadge[r.marketplace] || { label: r.marketplace, className: '' };
            const statusLabel = wbOrderStatusLabel(r.wbOrderStatus);
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge className={mp.className}>{mp.label}</Badge>
                </TableCell>
                <TableCell>
                  <Stars rating={r.rating} />
                </TableCell>
                <TableCell>
                  {statusLabel ? (
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${wbOrderStatusClass(
                        r.wbOrderStatus,
                      )}`}
                    >
                      {statusLabel}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[320px]">
                  <span className="line-clamp-3 text-sm">{r.text || '—'}</span>
                </TableCell>
                <TableCell className="text-sm">
                  <div>{r.productName || r.productSku || '—'}</div>
                  {r.orderNumber ? (
                    <div className="text-xs text-muted-foreground">
                      {r.orderType} · {r.orderNumber}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Заказ не сопоставлен</div>
                  )}
                  {(r.wbSrid || r.wbRid) && (
                    <div
                      className="mt-0.5 font-mono-tech text-[11px] text-fuchsia-800"
                      title="Буквенный код заказа WB (srid/rid)"
                    >
                      {r.wbSrid || r.wbRid}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <ReviewPeopleTimeline
                    cutterName={r.cutterName}
                    sewerName={r.sewerName}
                    packerName={r.packerName}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {r.reviewDate ? formatDate(r.reviewDate) : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {r.orderCreatedAt ? formatDate(r.orderCreatedAt) : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {r.orderCompletedAt ? formatDate(r.orderCompletedAt) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default ReviewsTable;
