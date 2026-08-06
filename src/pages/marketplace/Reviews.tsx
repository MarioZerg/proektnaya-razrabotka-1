import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchReviews,
  fetchReviewsRating,
  syncReviews,
  type Review,
  type RatingResult,
} from '@/lib/reviewsApi';
import EmployeeRatingCards from '@/components/crm/reviews/EmployeeRatingCards';
import ReviewsTable from '@/components/crm/reviews/ReviewsTable';

const emptyRating: RatingResult = { cutter: [], sewer: [], packer: [] };

const Reviews = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState<RatingResult>(emptyRating);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [marketplace, setMarketplace] = useState<'all' | 'OZON' | 'WB'>('all');
  const [ratingFilter, setRatingFilter] = useState<'all' | 'high' | 'low'>('all');

  const load = () => {
    setLoading(true);
    Promise.all([fetchReviews(), fetchReviewsRating()])
      .then(([rv, rt]) => {
        setReviews(rv);
        setRating(rt);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncReviews();
      const warn = res.warnings.length ? ` Предупреждения: ${res.warnings.join('; ')}` : '';
      toast({ title: 'Отзывы обновлены', description: `Новых отзывов: ${res.created}.${warn}` });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось обновить отзывы',
        description: err instanceof Error ? err.message : 'Проверьте ключи OZON/WB в интеграциях',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(
    () =>
      reviews.filter((r) => {
        if (marketplace !== 'all' && r.marketplace !== marketplace) return false;
        if (ratingFilter === 'high' && (r.rating == null || r.rating < 4)) return false;
        if (ratingFilter === 'low' && (r.rating == null || r.rating > 3)) return false;
        return true;
      }),
    [reviews, marketplace, ratingFilter]
  );

  const avgAll = useMemo(() => {
    const rated = reviews.filter((r) => r.rating != null);
    if (!rated.length) return null;
    return rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length;
  }, [reviews]);

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">Отзывы</h1>
            {!loading && (
              <>
                <Badge variant="secondary" className="text-sm font-normal">
                  Всего: {reviews.length}
                </Badge>
                {avgAll != null && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-sm font-normal">
                    <Icon name="Star" size={13} className="fill-current text-amber-500" />
                    {avgAll.toFixed(2)} средняя
                  </Badge>
                )}
              </>
            )}
          </div>
          {isAdmin && (
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              <Icon
                name={syncing ? 'Loader2' : 'RefreshCw'}
                size={16}
                className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
              />
              {syncing ? 'Обновление…' : 'Обновить отзывы'}
            </Button>
          )}
        </div>

        <EmployeeRatingCards rating={rating} />

        <div className="flex flex-wrap items-center gap-3">
          <Select value={marketplace} onValueChange={(v) => setMarketplace(v as typeof marketplace)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все площадки</SelectItem>
              <SelectItem value="OZON">OZON</SelectItem>
              <SelectItem value="WB">Wildberries</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ratingFilter} onValueChange={(v) => setRatingFilter(v as typeof ratingFilter)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Любая оценка</SelectItem>
              <SelectItem value="high">Хорошие (4–5)</SelectItem>
              <SelectItem value="low">Плохие (1–3)</SelectItem>
            </SelectContent>
          </Select>
          <p className="ml-auto text-sm text-muted-foreground">Показано: {filtered.length}</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <ReviewsTable reviews={filtered} />
        )}
      </div>
    </CrmLayout>
  );
};

export default Reviews;