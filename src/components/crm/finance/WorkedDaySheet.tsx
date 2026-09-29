import { formatDate, formatMoney, accrualTypeLabels } from '@/components/crm/finance/financeShared';
import { formatMeters, type WorkedDay } from '@/components/crm/finance/workedDay';

interface WorkedDaySheetProps {
  day: WorkedDay;
  /** На киоске плашка крупнее — с планшета читают на ходу. */
  large?: boolean;
}

const moneyClass = (amount: number, type?: string) =>
  type === 'penalty' ? 'text-destructive' : amount < 0 ? 'text-amber-700' : 'text-emerald-700';

const ExtraBlock = ({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: WorkedDay['bonuses'];
  tone: 'bonus' | 'deduction' | 'salary';
}) => {
  if (rows.length === 0) return null;
  const color =
    tone === 'deduction' ? 'text-destructive' : tone === 'bonus' ? 'text-emerald-700' : '';
  return (
    <div className="border-t border-border pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="mt-1 space-y-1">
        {rows.map((row) => (
          <div key={row.id} className="flex items-start justify-between gap-3 text-sm">
            <p className="min-w-0 leading-snug">
              <span className="font-medium">{accrualTypeLabels[row.type] || row.type}</span>
              {row.description ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {row.description}
                </span>
              ) : null}
            </p>
            <span className={`shrink-0 tabular-nums font-semibold ${color || moneyClass(row.amount, row.type)}`}>
              {formatMoney(row.amount)} ₽
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Одна плашка отработанного дня: заказы строками (номер, метраж, сумма),
 * затем оклад / надбавки / вычеты и итог. Смотреть удобнее, чем сто карточек
 * по одному заказу.
 */
const WorkedDaySheet = ({ day, large = false }: WorkedDaySheetProps) => (
  <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/50 px-3 py-2.5">
      <div className="min-w-0">
        <p className={`font-bold ${large ? 'text-lg' : 'text-sm'}`}>{formatDate(day.date)}</p>
        {day.shiftLabel ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{day.shiftLabel}</p>
        ) : null}
      </div>
      <p className={`shrink-0 tabular-nums font-bold ${moneyClass(day.net)} ${large ? 'text-xl' : 'text-base'}`}>
        {formatMoney(day.net)} ₽
      </p>
    </div>

    <div className={`space-y-3 ${large ? 'p-4' : 'p-3'}`}>
      {day.orders.length > 0 && (
        <div>
          <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Заказ</span>
            <span className="min-w-[4.5rem] text-right">Метраж</span>
            <span className="min-w-[5.75rem] text-right">Сумма</span>
          </div>
          <div className="divide-y divide-border">
            {day.orders.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-2 py-1.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {row.orderNumber ? `#${row.orderNumber}` : accrualTypeLabels[row.type] || row.type}
                  </p>
                  {row.orderNumber ? (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {accrualTypeLabels[row.type] || row.type}
                    </p>
                  ) : null}
                </div>
                <span className="min-w-[4.5rem] text-right tabular-nums text-muted-foreground">
                  {row.meters != null ? formatMeters(row.meters) : '—'}
                </span>
                <span className="min-w-[5.75rem] text-right tabular-nums font-medium">
                  {formatMoney(row.amount)} ₽
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ExtraBlock title="Оклад" rows={day.salaries} tone="salary" />
      <ExtraBlock title="Надбавки" rows={day.bonuses} tone="bonus" />
      <ExtraBlock title="Вычеты" rows={day.deductions} tone="deduction" />

      {day.orders.length === 0 &&
        day.salaries.length === 0 &&
        day.bonuses.length === 0 &&
        day.deductions.length === 0 && (
          <p className="text-sm text-muted-foreground">За этот день начислений нет</p>
        )}

      <div className="space-y-1 border-t border-border pt-2">
        {day.metersTotal > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Метраж за день</span>
            <span className="tabular-nums font-medium">{formatMeters(day.metersTotal)} пог.м.</span>
          </div>
        )}
        {day.deductionsTotal < 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Вычеты</span>
            <span className="tabular-nums font-medium text-destructive">
              {formatMoney(day.deductionsTotal)} ₽
            </span>
          </div>
        )}
        {day.bonuses.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Надбавки</span>
            <span className="tabular-nums font-medium text-emerald-700">
              {formatMoney(day.bonuses.reduce((s, r) => s + r.amount, 0))} ₽
            </span>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="font-semibold">Итого за день</span>
          <span className={`tabular-nums font-bold ${large ? 'text-xl' : 'text-lg'} ${moneyClass(day.net)}`}>
            {formatMoney(day.net)} ₽
          </span>
        </div>
      </div>
    </div>
  </div>
);

export default WorkedDaySheet;
