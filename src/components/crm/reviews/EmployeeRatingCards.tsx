import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { EmployeeRating, RatingResult } from '@/lib/reviewsApi';

interface EmployeeRatingCardsProps {
  rating: RatingResult;
}

const stages: Array<{ key: keyof RatingResult; title: string; icon: string }> = [
  { key: 'cutter', title: 'Закройщики', icon: 'Scissors' },
  { key: 'sewer', title: 'Швеи', icon: 'Shirt' },
  { key: 'packer', title: 'Упаковщики', icon: 'Package' },
];

const ratingColor = (avg: number | null): string => {
  if (avg == null) return 'text-muted-foreground';
  if (avg >= 4.5) return 'text-green-600';
  if (avg >= 4) return 'text-amber-600';
  return 'text-red-600';
};

const RatingRow = ({ emp }: { emp: EmployeeRating }) => (
  <div className="flex items-center justify-between gap-2 border-b border-border py-1.5 last:border-0">
    <span className="truncate text-sm">{emp.fullName}</span>
    <span className="flex shrink-0 items-center gap-2">
      <span className={`flex items-center gap-0.5 text-sm font-semibold ${ratingColor(emp.avgRating)}`}>
        <Icon name="Star" size={13} className="fill-current" />
        {emp.avgRating != null ? emp.avgRating.toFixed(2) : '—'}
      </span>
      <span className="text-xs text-muted-foreground">({emp.reviewsCount})</span>
    </span>
  </div>
);

const EmployeeRatingCards = ({ rating }: EmployeeRatingCardsProps) => {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {stages.map((s) => {
        const list = rating[s.key];
        return (
          <Card key={s.key} className="border-border shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Icon name={s.icon} size={16} className="text-muted-foreground" />
                {s.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных по отзывам</p>
              ) : (
                list.map((emp) => <RatingRow key={emp.userId} emp={emp} />)
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default EmployeeRatingCards;
