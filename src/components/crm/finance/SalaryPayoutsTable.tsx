import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import BlockSkeleton from '@/components/crm/finance/BlockSkeleton';
import type { SalaryPayout } from '@/lib/salaryApi';
import { formatDate, formatDateTime, formatMoney } from '@/components/crm/finance/financeShared';
import ConfirmDeleteButton from '@/components/crm/finance/ConfirmDeleteButton';
import TablePager from '@/components/crm/finance/TablePager';
import { useTablePage } from '@/components/crm/finance/useTablePage';

interface SalaryPayoutsTableProps {
  payouts: SalaryPayout[];
  loading: boolean;
  error?: string | null;
  onDelete: (id: number) => void;
}

type EmployeePayouts = {
  userId: number;
  userName: string;
  items: SalaryPayout[];
  total: number;
};

const pluralPayouts = (n: number) => (n === 1 ? 'выплата' : n < 5 ? 'выплаты' : 'выплат');

/**
 * Сотрудник → список выплат.
 *
 * Админу нужна общая сумма по человеку (сколько всего выдали), а детали —
 * когда и какими порциями — по раскрытию, а не простынёй из всех выплат подряд.
 */
const groupByEmployee = (payouts: SalaryPayout[]): EmployeePayouts[] => {
  const byUser = new Map<number, EmployeePayouts>();

  for (const p of payouts) {
    let emp = byUser.get(p.userId);
    if (!emp) {
      emp = { userId: p.userId, userName: p.userName, items: [], total: 0 };
      byUser.set(p.userId, emp);
    }
    emp.items.push(p);
    emp.total += p.amount;
  }

  for (const emp of byUser.values()) {
    emp.items.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }

  return [...byUser.values()].sort(
    (a, b) => b.total - a.total || a.userName.localeCompare(b.userName, 'ru'),
  );
};

const SalaryPayoutsTable = ({
  payouts,
  loading,
  error = null,
  onDelete,
}: SalaryPayoutsTableProps) => {
  const employees = useMemo(() => groupByEmployee(payouts), [payouts]);
  const { visible, page, setPage, totalPages, total } = useTablePage(employees, 15);
  const [openPeople, setOpenPeople] = useState<Set<number>>(() => new Set());

  const peopleKey = visible.map((e) => e.userId).join(',');
  const single = visible.length === 1 ? visible[0].userId : null;
  useEffect(() => {
    setOpenPeople(single != null ? new Set([single]) : new Set());
  }, [peopleKey, single]);

  const toggle = (userId: number) => {
    setOpenPeople((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Выплата зарплат</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && payouts.length === 0 ? (
          <BlockSkeleton rows={3} />
        ) : payouts.length === 0 ? (
          error ? null : (
            <p className="text-sm text-muted-foreground">Выплат пока не было</p>
          )
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="divide-y divide-border">
              {visible.map((emp) => {
                const open = openPeople.has(emp.userId);
                return (
                  <div key={emp.userId} className="bg-card">
                    <button
                      type="button"
                      onClick={() => toggle(emp.userId)}
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
                        <p className="truncate text-sm font-semibold">{emp.userName}</p>
                        <p className="text-xs text-muted-foreground">
                          {emp.items.length} {pluralPayouts(emp.items.length)}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums text-sm font-bold text-emerald-700">
                        {formatMoney(emp.total)} ₽
                      </span>
                    </button>

                    {open && (
                      <div className="border-t border-border bg-background">
                        {emp.items.map((p) => (
                          <div
                            key={p.id}
                            className="min-w-0 border-t border-border px-3 py-2.5 first:border-t-0"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium tabular-nums">
                                  {formatMoney(p.amount)} ₽
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {formatDateTime(p.paidAt)}
                                  {p.periodFrom || p.periodTo
                                    ? ` · период ${p.periodFrom ? formatDate(p.periodFrom) : '…'} — ${p.periodTo ? formatDate(p.periodTo) : '…'}`
                                    : ''}
                                  {` · #${p.id}`}
                                </p>
                                {!!p.sbpPhone && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {p.sbpPhone}
                                    {p.sbpBank ? ` · ${p.sbpBank}` : ''}
                                  </p>
                                )}
                              </div>
                              <ConfirmDeleteButton
                                title="Удалить выплату?"
                                description={`Выплата #${p.id} сотруднику ${p.userName} на сумму ${formatMoney(p.amount)} ₽ будет удалена. Связанные начисления вернутся в статус "невыплачено", а сумма вернётся в кассу компании.`}
                                onConfirm={() => onDelete(p.id)}
                              />
                            </div>
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
      </CardContent>
    </Card>
  );
};

export default SalaryPayoutsTable;
