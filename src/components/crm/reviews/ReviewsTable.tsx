import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const PAGE = 50;

const marketplaceBadge: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'bg-blue-600 text-white hover:bg-blue-700' },
  WB: { label: 'WB', className: 'bg-fuchsia-600 text-white hover:bg-fuchsia-700' },
};

const Stars = ({ rating }: { rating: number | null }) => {
  if (rating == null) return <span className="text-muted-foreground">—</span>;
  const color = rating >= 4 ? 'text-green-600' : rating >= 3 ? 'text-amber-600' : 'text-red-600';
  return (
    <span className={`flex items-center gap-0.5 text-sm font-semibold ${color}`}>
      <Icon name="Star" size={14} className="fill-current" />
      {rating}
    </span>
  );
};

const DateItem = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <span className="whitespace-nowrap">
    <span className="text-muted-foreground">{label}: </span>
    {value ? formatDate(value) : '—'}
  </span>
);

const ReviewCard = ({ r }: { r: Review }) => {
  const mp = marketplaceBadge[r.marketplace] || { label: r.marketplace, className: '' };
  const statusLabel = wbOrderStatusLabel(r.wbOrderStatus);

  return (
    <li className="min-w-0 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={mp.className}>{mp.label}</Badge>
        <Stars rating={r.rating} />
        {statusLabel && (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${wbOrderStatusClass(
              r.wbOrderStatus,
            )}`}
          >
            {statusLabel}
          </span>
        )}
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
          {r.reviewDate ? formatDate(r.reviewDate) : '—'}
        </span>
      </div>

      <div className="mt-2 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="break-words text-sm">
            {r.text || <span className="text-muted-foreground">Без текста</span>}
          </p>
          <div className="mt-2 min-w-0 text-sm">
            <div className="break-words font-medium">{r.productName || r.productSku || '—'}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {r.orderNumber ? (
                <span className="text-muted-foreground">
                  {r.orderType} · {r.orderNumber}
                </span>
              ) : (
                <span className="text-muted-foreground">Заказ не сопоставлен</span>
              )}
              {r.orderNumber && (
                <>
                  <DateItem label="Создан" value={r.orderCreatedAt} />
                  <DateItem label="Завершён" value={r.orderCompletedAt} />
                </>
              )}
            </div>
          </div>
        </div>
        {r.orderNumber && (
          <div className="min-w-0 lg:[&_ol]:mt-0">
            <ReviewPeopleTimeline
              cutterName={r.cutterName}
              sewerName={r.sewerName}
              packerName={r.packerName}
            />
          </div>
        )}
      </div>
    </li>
  );
};

const ReviewsTable = ({ reviews, error = null }: ReviewsTableProps) => {
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setLimit(PAGE);
  }, [reviews]);

  if (reviews.length === 0) {
    if (error) return null;
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Отзывов пока нет. Нажмите «Обновить отзывы», чтобы загрузить их с OZON и Wildberries.
      </p>
    );
  }

  const shown = reviews.slice(0, limit);
  const rest = reviews.length - shown.length;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {shown.map((r) => (
          <ReviewCard key={r.id} r={r} />
        ))}
      </ul>
      {rest > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setLimit((l) => l + PAGE)}
        >
          Показать ещё {Math.min(PAGE, rest)} (осталось {rest})
        </Button>
      )}
    </div>
  );
};

export default ReviewsTable;
