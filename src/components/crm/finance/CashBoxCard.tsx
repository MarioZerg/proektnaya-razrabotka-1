import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { CashBoxTransaction } from '@/lib/salaryApi';
import { formatDate, formatDateTime, formatMoney } from '@/components/crm/finance/financeShared';
import TablePager from '@/components/crm/finance/TablePager';
import { useTablePage } from '@/components/crm/finance/useTablePage';
import CashDepositDialog from '@/components/crm/finance/CashDepositDialog';

interface CashBoxCardProps {
  balance: number;
  transactions: CashBoxTransaction[];
  loading: boolean;
  saving: boolean;
  onDeposit: (amount: number, description: string) => Promise<void>;
}

type CashDay = {
  date: string;
  items: CashBoxTransaction[];
  /** Сумма выплат зарплаты за день (отрицательная в кассе). */
  payoutsTotal: number;
  payoutsCount: number;
  depositsTotal: number;
  depositsCount: number;
};

/** Календарный день по Москве — как и везде в финансах. */
const moscowDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

const isPayout = (t: CashBoxTransaction) => t.payoutId != null || t.amount < 0;

const groupCashByDay = (transactions: CashBoxTransaction[]): CashDay[] => {
  const byDate = new Map<string, CashDay>();

  for (const t of transactions) {
    const date = moscowDay(t.createdAt);
    let day = byDate.get(date);
    if (!day) {
      day = {
        date,
        items: [],
        payoutsTotal: 0,
        payoutsCount: 0,
        depositsTotal: 0,
        depositsCount: 0,
      };
      byDate.set(date, day);
    }
    day.items.push(t);
    if (isPayout(t)) {
      day.payoutsTotal += t.amount;
      day.payoutsCount += 1;
    } else {
      day.depositsTotal += t.amount;
      day.depositsCount += 1;
    }
  }

  for (const day of byDate.values()) {
    day.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
};

const pluralOps = (n: number) => (n === 1 ? 'операция' : n < 5 ? 'операции' : 'операций');
const pluralPayouts = (n: number) => (n === 1 ? 'выплата' : n < 5 ? 'выплаты' : 'выплат');

/**
 * Касса: выплаты зарплаты свёрнуты по дню выдачи.
 *
 * Админ за день платит пачкой — десять человек подряд. Раньше в ленте
 * лежали десять одинаковых строк, и суммарный «сколько ушло сегодня»
 * приходилось складывать глазами. День = одна строка с итогом выплат;
 * раскрытие показывает, кому и сколько.
 */
const CashBoxCard = ({ balance, transactions, loading, saving, onDeposit }: CashBoxCardProps) => {
  const days = useMemo(() => groupCashByDay(transactions), [transactions]);
  const { visible, page, setPage, totalPages, total } = useTablePage(days, 10);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());

  const dayKey = visible.map((d) => d.date).join(',');
  const single = visible.length === 1 ? visible[0].date : null;
  useEffect(() => {
    setOpenDays(single ? new Set([single]) : new Set());
  }, [dayKey, single]);

  const toggle = (date: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Касса компании</CardTitle>
        <CashDepositDialog saving={saving} onSubmit={onDeposit} />
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm text-muted-foreground">Текущий остаток кассы</p>
              <p className={`text-xl font-bold ${balance < 0 ? 'text-destructive' : ''}`}>
                {formatMoney(balance)} ₽
              </p>
            </div>

            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Операций по кассе пока нет</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="divide-y divide-border">
                  {visible.map((day) => {
                    const open = openDays.has(day.date);
                    return (
                      <div key={day.date} className="bg-card">
                        <button
                          type="button"
                          onClick={() => toggle(day.date)}
                          className="flex w-full min-w-0 items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/50"
                        >
                          <Icon
                            name="ChevronRight"
                            size={16}
                            className={`shrink-0 text-muted-foreground transition-transform ${
                              open ? 'rotate-90' : ''
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{formatDate(day.date)}</p>
                            <p className="text-xs text-muted-foreground">
                              {day.payoutsCount > 0 && (
                                <>
                                  {day.payoutsCount} {pluralPayouts(day.payoutsCount)}
                                </>
                              )}
                              {day.payoutsCount > 0 && day.depositsCount > 0 && ' · '}
                              {day.depositsCount > 0 && (
                                <>
                                  {day.depositsCount}{' '}
                                  {day.depositsCount === 1
                                    ? 'пополнение'
                                    : day.depositsCount < 5
                                      ? 'пополнения'
                                      : 'пополнений'}
                                </>
                              )}
                              {day.payoutsCount === 0 && day.depositsCount === 0 && (
                                <>
                                  {day.items.length} {pluralOps(day.items.length)}
                                </>
                              )}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            {day.payoutsCount > 0 && (
                              <p className="tabular-nums text-sm font-bold text-destructive">
                                {formatMoney(day.payoutsTotal)} ₽
                              </p>
                            )}
                            {day.depositsCount > 0 && (
                              <p
                                className={`tabular-nums text-sm font-semibold text-emerald-600 ${
                                  day.payoutsCount > 0 ? 'text-xs' : ''
                                }`}
                              >
                                {day.payoutsCount > 0 ? '+' : ''}
                                {formatMoney(day.depositsTotal)} ₽
                              </p>
                            )}
                          </div>
                        </button>

                        {open && (
                          <div className="border-t border-border bg-background">
                            {day.items.map((t) => (
                              <div
                                key={t.id}
                                className="min-w-0 border-t border-border px-3 py-2.5 first:border-t-0"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="min-w-0 break-words text-sm leading-snug">
                                    {t.description}
                                  </p>
                                  <span
                                    className={`shrink-0 tabular-nums text-sm font-semibold ${
                                      t.amount < 0 ? 'text-destructive' : 'text-emerald-600'
                                    }`}
                                  >
                                    {formatMoney(t.amount)} ₽
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatDateTime(t.createdAt)}
                                  {t.createdByName ? ` · ${t.createdByName}` : ''}
                                  {t.payoutId != null ? ' · выплата зарплаты' : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <TablePager page={page} totalPages={totalPages} total={total} setPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default CashBoxCard;
