import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { fetchMySalary, type MyAccrual } from '@/lib/salaryApi';
import { groupAccrualsByDay } from '@/components/crm/finance/workedDay';
import { moscowYmd } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

interface MyWorkCalendarProps {
  userId: number;
  selectedFrom: string;
  selectedTo: string;
  /** Клик по дню — фильтр начислений на этот день. */
  onSelectDay: (ymd: string) => void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

const pad = (n: number) => String(n).padStart(2, '0');

const toYmd = (year: number, monthIndex: number, day: number) =>
  `${year}-${pad(monthIndex + 1)}-${pad(day)}`;

const monthBounds = (year: number, monthIndex: number) => {
  const from = toYmd(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0).getDate();
  const to = toYmd(year, monthIndex, last);
  return { from, to };
};

/** Сетка месяца с понедельника; пустые ячейки — null. */
const buildMonthCells = (year: number, monthIndex: number): (string | null)[] => {
  const first = new Date(year, monthIndex, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toYmd(year, monthIndex, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

/** Компактная сумма для клетки: 12 450 → «12.5к», мелкие — без копеек. */
const shortMoney = (n: number) => {
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)}к`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1).replace('.0', '')}к`;
  return `${sign}${Math.round(abs)}`;
};

/**
 * Мини-календарь смен сотрудника во «Моя зарплата».
 *
 * Дни с начислениями — галочка и сумма за день. Клик ставит фильтр на этот день,
 * чтобы ниже открылся разбор. Данные грузит сам за выбранный месяц — иначе при
 * фильтре «сегодня» остальные клетки календаря опустели бы.
 */
const MyWorkCalendar = ({
  userId,
  selectedFrom,
  selectedTo,
  onSelectDay,
}: MyWorkCalendarProps) => {
  const today = moscowYmd(0);
  const [y, m] = today.split('-').map(Number);
  const [year, setYear] = useState(y);
  const [monthIndex, setMonthIndex] = useState(m - 1);
  const [accruals, setAccruals] = useState<MyAccrual[]>([]);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    const { from, to } = monthBounds(year, monthIndex);
    setLoading(true);
    fetchMySalary(userId, { dateFrom: from, dateTo: to })
      .then((data) => {
        if (id !== reqId.current) return;
        setAccruals(data.accruals);
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setAccruals([]);
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [userId, year, monthIndex]);

  const byDate = useMemo(() => {
    const map = new Map<string, { earned: number; net: number }>();
    for (const day of groupAccrualsByDay(accruals)) {
      map.set(day.date, { earned: day.earned, net: day.net });
    }
    return map;
  }, [accruals]);

  const cells = useMemo(() => buildMonthCells(year, monthIndex), [year, monthIndex]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, monthIndex + delta, 1);
    setYear(d.getFullYear());
    setMonthIndex(d.getMonth());
  };

  const selectedSingle =
    selectedFrom && selectedTo && selectedFrom === selectedTo ? selectedFrom : null;

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => shiftMonth(-1)}
          aria-label="Предыдущий месяц"
        >
          <Icon name="ChevronLeft" size={16} />
        </Button>
        <p className="min-w-0 truncate text-center text-sm font-semibold">
          {MONTHS[monthIndex]} {year}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => shiftMonth(1)}
          aria-label="Следующий месяц"
        >
          <Icon name="ChevronRight" size={16} />
        </Button>
      </div>

      <div className="p-2">
        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="py-0.5 text-center text-[10px] font-medium text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>

        <div
          className={cn(
            'grid grid-cols-7 gap-0.5 transition-opacity',
            loading && 'opacity-60',
          )}
        >
          {cells.map((ymd, i) => {
            if (!ymd) {
              return <div key={`e-${i}`} className="min-h-[3.25rem]" />;
            }
            const dayNum = Number(ymd.slice(8, 10));
            const info = byDate.get(ymd);
            const worked = !!info && info.earned > 0;
            const isToday = ymd === today;
            const isSelected = ymd === selectedSingle;

            return (
              <button
                key={ymd}
                type="button"
                onClick={() => onSelectDay(ymd)}
                title={
                  info
                    ? `${ymd}: ${Math.round(info.net).toLocaleString('ru-RU')} ₽`
                    : ymd
                }
                className={cn(
                  'flex min-h-[3.25rem] flex-col items-center rounded-md px-0.5 py-1 text-center transition-colors',
                  'hover:bg-muted/70',
                  isSelected && 'bg-primary/10 ring-1 ring-primary',
                  isToday && !isSelected && 'ring-1 ring-border',
                  worked && !isSelected && 'bg-emerald-50',
                )}
              >
                <span
                  className={cn(
                    'text-[11px] font-medium leading-none',
                    worked ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {dayNum}
                </span>
                {worked ? (
                  <>
                    <Icon
                      name="Check"
                      size={12}
                      className="mt-0.5 text-emerald-600"
                    />
                    <span className="mt-0.5 max-w-full truncate text-[9px] font-semibold tabular-nums leading-none text-emerald-800">
                      {shortMoney(info!.earned)}
                    </span>
                  </>
                ) : info && info.net !== 0 ? (
                  <span className="mt-1 max-w-full truncate text-[9px] font-semibold tabular-nums leading-none text-destructive">
                    {shortMoney(info.net)}
                  </span>
                ) : (
                  <span className="mt-1 h-3" />
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          Галочка — день с заработком. Нажмите день, чтобы открыть начисления.
        </p>
      </div>
    </div>
  );
};

export default MyWorkCalendar;
