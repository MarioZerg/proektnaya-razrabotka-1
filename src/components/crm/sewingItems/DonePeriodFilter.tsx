import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';

interface DonePeriodFilterProps {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  /** Сколько заказов попало в период — сотрудник сверяет это число со своей записью. */
  count: number;
  /** Погонные метры за период: по ним считается сдельная оплата. */
  meters: number;
  onChange: () => void;
}

/** Локальная дата в формате YYYY-MM-DD — то, что понимает поле выбора даты. */
const isoDay = (d: Date) => {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
};

/**
 * Период выполненной работы на вкладке «Готовые».
 *
 * Швея и закройщик сверяют по нему свою выработку: «сколько я сделала за эту неделю».
 * Раньше вкладка показывала всё подряд с начала работы, и посчитать смену было нельзя —
 * приходилось листать сотни заказов и держать счёт в голове.
 *
 * Период считается по СВОЕЙ дате: у закройщика — когда он раскроил, у швеи — когда
 * отшила. Дата заказа покупателя для этого не годится: заказ мог пролежать в очереди.
 */
const DonePeriodFilter = ({
  from,
  to,
  setFrom,
  setTo,
  count,
  meters,
  onChange,
}: DonePeriodFilterProps) => {
  const apply = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    onChange();
  };

  // Быстрые кнопки: в цехе считают сменами и неделями, а не календарём.
  const today = () => {
    const d = isoDay(new Date());
    apply(d, d);
  };

  const lastDays = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    apply(isoDay(start), isoDay(end));
  };

  const thisMonth = () => {
    const now = new Date();
    apply(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), isoDay(now));
  };

  const active = Boolean(from || to);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">С какого дня</p>
          <Input
            type="date"
            value={from}
            onChange={(e) => apply(e.target.value, to)}
            className="h-9 w-40"
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">По какой день</p>
          <Input
            type="date"
            value={to}
            onChange={(e) => apply(from, e.target.value)}
            className="h-9 w-40"
          />
        </div>

        <Button variant="outline" size="sm" onClick={today}>
          Сегодня
        </Button>
        <Button variant="outline" size="sm" onClick={() => lastDays(7)}>
          7 дней
        </Button>
        <Button variant="outline" size="sm" onClick={thisMonth}>
          Этот месяц
        </Button>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => apply('', '')}>
            <Icon name="X" size={14} className="mr-1.5" />
            Весь период
          </Button>
        )}
      </div>

      {/* Итог по выбранному периоду — то, ради чего фильтр и нужен. */}
      <p className="text-sm text-muted-foreground">
        {active ? 'За выбранный период:' : 'За всё время:'}{' '}
        <span className="text-lg font-bold text-foreground">{count}</span> шт
        {meters > 0 && (
          <>
            {' · '}
            <span className="text-lg font-bold text-foreground">
              {meters.toFixed(1)}
            </span>{' '}
            п.м.
          </>
        )}
      </p>
    </div>
  );
};

export default DonePeriodFilter;