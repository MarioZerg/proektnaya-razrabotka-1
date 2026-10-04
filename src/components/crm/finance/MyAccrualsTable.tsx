import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { MyAccrual } from '@/lib/salaryApi';
import WorkedDaySheet from '@/components/crm/finance/WorkedDaySheet';
import { groupAccrualsByDay } from '@/components/crm/finance/workedDay';
import TablePager from '@/components/crm/finance/TablePager';
import { useTablePage } from '@/components/crm/finance/useTablePage';

interface MyAccrualsTableProps {
  accruals: MyAccrual[];
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «начислений пока нет». */
  error?: string | null;
  /** Выбран период — пустой список значит «за эти дни ничего», а не «начислений нет». */
  filtered?: boolean;
}

const DAYS_PER_PAGE = 7;

/**
 * Начисления сотрудника: дни свёрнуты в папки, внутри дня — папки по виду работы.
 * Так за неделю не получается портянка из десятков строк заказов.
 */
const MyAccrualsTable = ({ accruals, loading, error = null, filtered }: MyAccrualsTableProps) => {
  const emptyText = filtered ? 'За выбранный период начислений нет' : 'Начислений пока нет';
  const days = useMemo(() => groupAccrualsByDay(accruals), [accruals]);
  const { visible, page, setPage, totalPages, total } = useTablePage(days, DAYS_PER_PAGE);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());

  const dayKey = visible.map((d) => d.date).join(',');
  const single = visible.length === 1 ? visible[0].date : null;
  useEffect(() => {
    // Один день на экране (фильтр «сегодня») — сразу раскрыт.
    setOpenDays(single ? new Set([single]) : new Set());
  }, [dayKey, single]);

  const toggleDay = (date: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  if (loading && accruals.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (accruals.length === 0) {
    return error ? null : <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {visible.map((day) => (
        <WorkedDaySheet
          key={day.date}
          day={day}
          collapsible
          open={openDays.has(day.date)}
          onToggle={() => toggleDay(day.date)}
        />
      ))}
      <TablePager page={page} totalPages={totalPages} total={total} setPage={setPage} />
    </div>
  );
};

export default MyAccrualsTable;
