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

interface ReviewsTableProps {
  reviews: Review[];
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

const person = (name: string | null) =>
  name ? <span>{name}</span> : <span className="text-muted-foreground">—</span>;

const ReviewsTable = ({ reviews }: ReviewsTableProps) => {
  if (reviews.length === 0) {
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
            <TableHead className="min-w-[220px]">Отзыв</TableHead>
            <TableHead>Товар / Заказ</TableHead>
            <TableHead>Закройщик</TableHead>
            <TableHead>Швея</TableHead>
            <TableHead>Упаковщик</TableHead>
            <TableHead>Дата отзыва</TableHead>
            <TableHead>Создан</TableHead>
            <TableHead>Завершён</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reviews.map((r) => {
            const mp = marketplaceBadge[r.marketplace] || { label: r.marketplace, className: '' };
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge className={mp.className}>{mp.label}</Badge>
                </TableCell>
                <TableCell>
                  <Stars rating={r.rating} />
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
                </TableCell>
                <TableCell className="text-sm">{person(r.cutterName)}</TableCell>
                <TableCell className="text-sm">{person(r.sewerName)}</TableCell>
                <TableCell className="text-sm">{person(r.packerName)}</TableCell>
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
