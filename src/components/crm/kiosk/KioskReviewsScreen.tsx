import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { fetchReviews, type Review } from '@/lib/reviewsApi';
import { formatDate } from '@/lib/dateUtils';

/** Экран отзывов на терминале: последние отзывы с маркетплейсов, чтобы цех видел оценки
 * покупателей и кто участвовал в производстве заказа. */
const KioskReviewsScreen = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReviews()
      .then((list) => setReviews(list.slice(0, 50)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Icon name="Loader2" size={24} className="animate-spin" />
        Загрузка…
      </div>
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
        return (
          <div key={r.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`flex items-center gap-1 text-lg font-bold ${color}`}>
                <Icon name="Star" size={18} className="fill-current" />
                {r.rating ?? '—'}
              </span>
              <Badge variant="secondary">{r.marketplace}</Badge>
              <span className="text-sm text-muted-foreground">
                {r.reviewDate ? formatDate(r.reviewDate) : ''}
              </span>
            </div>
            <p className="mt-2">{r.text || 'Без комментария'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.productName || r.productSku || ''}
            </p>
            {(r.cutterName || r.sewerName || r.packerName) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Кроил: {r.cutterName || '—'} · Шил: {r.sewerName || '—'} · Упаковал:{' '}
                {r.packerName || '—'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default KioskReviewsScreen;
