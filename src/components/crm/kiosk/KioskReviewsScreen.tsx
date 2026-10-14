import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { fetchReviews, type Review } from '@/lib/reviewsApi';
import { formatDate } from '@/lib/dateUtils';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import ReviewPeopleTimeline from '@/components/crm/reviews/ReviewPeopleTimeline';
import {
  wbOrderStatusClass,
  wbOrderStatusLabel,
} from '@/components/crm/reviews/reviewStatus';

/** Экран отзывов на терминале: оценка, статус (у клиента / вернули) и кто шил. */
const KioskReviewsScreen = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchReviews()
      .then((list) => {
        setListError(null);
        setReviews(list.slice(0, 50));
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить отзывы');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && reviews.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Icon name="Loader2" size={24} className="animate-spin" />
        Загрузка…
      </div>
    );
  }

  if (listError && reviews.length === 0) {
    return (
      <WarehouseFetchError
        title="Не удалось загрузить отзывы"
        description={listError}
        onRetry={load}
      />
    );
  }

  if (reviews.length === 0) {
    return <p className="py-10 text-center text-lg text-muted-foreground">Отзывов пока нет</p>;
  }

  return (
    <div className="space-y-3">
      {reviews.map((r) => {
        const color =
          r.rating == null
            ? 'text-muted-foreground'
            : r.rating >= 4
              ? 'text-emerald-600'
              : r.rating >= 3
                ? 'text-amber-600'
                : 'text-red-600';
        const statusLabel = wbOrderStatusLabel(r.wbOrderStatus);
        return (
          <div key={r.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`flex items-center gap-1 text-lg font-bold ${color}`}>
                <Icon name="Star" size={18} className="fill-current" />
                {r.rating ?? '—'}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{r.marketplace}</Badge>
                {statusLabel && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${wbOrderStatusClass(
                      r.wbOrderStatus,
                    )}`}
                  >
                    {statusLabel}
                  </span>
                )}
              </div>
              <span className="text-sm text-muted-foreground">
                {r.reviewDate ? formatDate(r.reviewDate) : ''}
              </span>
            </div>
            <p className="mt-2">{r.text || 'Без комментария'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.productName || r.productSku || ''}
              {r.orderNumber ? ` · ${r.orderNumber}` : ' · заказ не сопоставлен'}
            </p>
            <ReviewPeopleTimeline
              cutterName={r.cutterName}
              sewerName={r.sewerName}
              packerName={r.packerName}
              compact
            />
          </div>
        );
      })}
    </div>
  );
};

export default KioskReviewsScreen;
