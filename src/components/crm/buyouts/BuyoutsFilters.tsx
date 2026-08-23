import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import {
  MP,
  money,
  type BuyoutsSlice,
  type BuyoutsTotals,
} from './buyoutsShared';

/**
 * Отбор выкупов: площадка, схема и период — плюс итог по выбранному.
 *
 * Смотреть нужно и общую картину, и отдельные срезы: FBO — это продажи со
 * склада площадки, FBS — то, что мы отправляем сами. Экономика у них разная,
 * и мешать их в одну цифру нельзя.
 */
interface Props {
  breakdown?: BuyoutsSlice[];
  totals?: BuyoutsTotals;
  mp: string;
  scheme: string;
  dateFrom: string;
  dateTo: string;
  onSlice: (marketplace: string, scheme: string) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onRange: (days: number) => void;
}

const BuyoutsFilters = ({
  breakdown,
  totals,
  mp,
  scheme,
  dateFrom,
  dateTo,
  onSlice,
  onFrom,
  onTo,
  onRange,
}: Props) => (
  <>
    {/* ПЛОЩАДКИ И СХЕМЫ.
        Смотреть нужно и общую картину, и отдельные срезы: FBO — это
        продажи со склада площадки, FBS — то, что мы отправляем сами.
        Экономика у них разная, и мешать их в одну цифру нельзя. */}
    {!!breakdown?.length && (
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant={!mp && !scheme ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => onSlice('', '')}
        >
          Все площадки
          <span className="ml-1 opacity-70">
            {breakdown.reduce((a, b) => a + b.count, 0)}
          </span>
        </Button>
        {breakdown.map((b) => {
          const active = mp === b.marketplace && scheme === b.scheme;
          return (
            <Button
              key={`${b.marketplace}-${b.scheme}`}
              variant={active ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                onSlice(
                  active ? '' : b.marketplace,
                  active ? '' : b.scheme,
                )
              }
            >
              {MP[b.marketplace]?.label || b.marketplace} {b.scheme}
              <span className="ml-1 opacity-70">{b.count}</span>
            </Button>
          );
        })}
      </div>
    )}

    {/* Период и итог по нему. Вопрос «сколько заработали за неделю»
        решается тут, без выгрузок и калькулятора. */}
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-3">
        <div className="space-y-1">
          <Label className="text-xs">Выкуплены с</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => onFrom(e.target.value)}
            className="h-9 w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">по</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => onTo(e.target.value)}
            className="h-9 w-[150px]"
          />
        </div>
        {/* Готовые отрезки: три месяца истории есть, и сравнивать их
            между собой удобнее в один клик. */}
        <div className="flex gap-1">
          {[
            { label: '7 дней', days: 7 },
            { label: 'Месяц', days: 30 },
            { label: '3 месяца', days: 90 },
          ].map((r) => (
            <Button
              key={r.days}
              variant="outline"
              size="sm"
              className="h-9 text-xs"
              onClick={() => onRange(r.days)}
            >
              {r.label}
            </Button>
          ))}
        </div>

        {(dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              onFrom('');
              onTo('');
            }}
          >
            <Icon name="X" size={14} className="mr-1" />
            Сбросить
          </Button>
        )}

        {/* Итог считается по всему отбору, а не по видимой странице. */}
        {totals && (
          <div className="ml-auto flex flex-wrap gap-4 text-right">
            <div>
              <p className="text-xs text-muted-foreground">Выручка</p>
              <p className="text-base font-bold">{money(totals.revenue)} ₽</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Заработали</p>
              <p
                className={`text-base font-bold ${
                  totals.profit > 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {totals.profit > 0 ? '+' : ''}
                {money(totals.profit)} ₽
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Маржа</p>
              <p className="text-base font-bold">{totals.margin}%</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  </>
);

export default BuyoutsFilters;
