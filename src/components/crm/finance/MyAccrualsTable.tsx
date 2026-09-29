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

const MyAccrualsTable = ({ accruals, loading, error = null, filtered }: MyAccrualsTableProps) => {
  const emptyText = filtered ? 'За выбранный период начислений нет' : 'Начислений пока нет';
  const days = groupAccrualsByDay(accruals);
  const { visible, page, setPage, totalPages, total } = useTablePage(days, DAYS_PER_PAGE);

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
        <WorkedDaySheet key={day.date} day={day} />
      ))}
      <TablePager page={page} totalPages={totalPages} total={total} setPage={setPage} />
    </div>
  );
};

export default MyAccrualsTable;
