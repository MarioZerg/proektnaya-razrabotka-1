import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import MyAccrualsTable from '@/components/crm/finance/MyAccrualsTable';
import MyAccrualsFilter from '@/components/crm/finance/MyAccrualsFilter';
import MyPayoutsCard from '@/components/crm/finance/MyPayoutsCard';
import MyWorkCalendar from '@/components/crm/finance/MyWorkCalendar';
import { formatMoney } from '@/components/crm/finance/financeShared';
import type { MyAccrual, MyPayout } from '@/lib/salaryApi';
import { Skeleton } from '@/components/ui/skeleton';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

interface MySalaryViewProps {
  userId: number;
  myLocked: boolean;
  myLoading: boolean;
  myError?: string | null;
  onRetry?: () => void;
  myDaysLeft: number;
  myDateFrom: string;
  myDateTo: string;
  setMyDateFrom: (v: string) => void;
  setMyDateTo: (v: string) => void;
  myEarned: number;
  myPenalties: number;
  myFiltered: MyAccrual[];
  /** Сколько начислений в периоде всего — считает сервер, в таблицу попадают не все. */
  myCount: number;
  myBalance: number;
  myPayouts: MyPayout[];
}

/**
 * Личные финансы сотрудника: начисления за работу и история выплат.
 *
 * Заработок и удержания показываем порознь — сотруднику важно видеть, что штраф
 * это отдельная строка, а не «мне меньше начислили за работу».
 */
const MySalaryView = ({
  userId,
  myLocked,
  myLoading,
  myError = null,
  onRetry,
  myDaysLeft,
  myDateFrom,
  myDateTo,
  setMyDateFrom,
  setMyDateTo,
  myEarned,
  myPenalties,
  myFiltered,
  myCount,
  myBalance,
  myPayouts,
}: MySalaryViewProps) => (
  <CrmLayout>
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Моя зарплата</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Начисления за выполненную работу и история выплат
        </p>
      </div>

      {myError && onRetry && (
        <WarehouseFetchError
          title="Не удалось загрузить зарплату"
          description={myError}
          onRetry={onRetry}
        />
      )}

      {myLocked && !myLoading && !myError ? (
        // Первые две недели зарплата скрыта: новичок только осваивается, суммы
        // прыгают, а ранние сравнения с коллегами демотивируют. Откроется сама.
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-8 text-center">
          <Icon name="Lock" size={40} className="mx-auto text-muted-foreground" />
          <p className="mt-3 text-lg font-semibold">Зарплата пока закрыта</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Раздел откроется автоматически через {myDaysLeft}{' '}
            {myDaysLeft % 10 === 1 && myDaysLeft % 100 !== 11
              ? 'день'
              : [2, 3, 4].includes(myDaysLeft % 10) && ![12, 13, 14].includes(myDaysLeft % 100)
                ? 'дня'
                : 'дней'}{' '}
            — через две недели после начала работы
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Все начисления сохраняются, ничего не потеряется
          </p>
        </div>
      ) : (
        // До xl — одной колонкой: при открытом меню ERP на ~1024px правая
        // колонка 1/4 сжималась до ~170px, календарь и выплаты «уплывали».
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(16.5rem,19rem)]">
          <div className="order-2 min-w-0 space-y-4 xl:order-1">
            <MyAccrualsFilter
              dateFrom={myDateFrom}
              dateTo={myDateTo}
              setDateFrom={setMyDateFrom}
              setDateTo={setMyDateTo}
              earned={myEarned}
              penalties={myPenalties}
              count={myCount}
              shown={myFiltered.length}
            />
            <MyAccrualsTable
              accruals={myFiltered}
              loading={myLoading}
              error={myError}
              filtered={!!myDateFrom || !!myDateTo}
            />
          </div>
          <div className="order-1 min-w-0 space-y-3 xl:order-2 xl:space-y-6">
            <div className="rounded-md border border-border p-4">
              <p className="text-sm text-muted-foreground">К выплате</p>
              {myLoading && myBalance === 0 && !myError ? (
                <Skeleton className="mt-1 h-7 w-28" />
              ) : (
                <p className="text-xl font-bold tabular-nums break-all">
                  {formatMoney(myBalance)} ₽
                </p>
              )}
            </div>
            <MyWorkCalendar
              userId={userId}
              selectedFrom={myDateFrom}
              selectedTo={myDateTo}
              onSelectDay={(ymd) => {
                setMyDateFrom(ymd);
                setMyDateTo(ymd);
              }}
            />
            <MyPayoutsCard payouts={myPayouts} loading={myLoading} />
          </div>
        </div>
      )}
    </div>
  </CrmLayout>
);

export default MySalaryView;