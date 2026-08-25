import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import MyAccrualsTable from '@/components/crm/finance/MyAccrualsTable';
import MyAccrualsFilter from '@/components/crm/finance/MyAccrualsFilter';
import MyPayoutsCard from '@/components/crm/finance/MyPayoutsCard';
import { formatMoney } from '@/components/crm/finance/financeShared';
import type { MyAccrual, MyPayout } from '@/lib/salaryApi';

interface MySalaryViewProps {
  myLocked: boolean;
  myLoading: boolean;
  myDaysLeft: number;
  myDateFrom: string;
  myDateTo: string;
  setMyDateFrom: (v: string) => void;
  setMyDateTo: (v: string) => void;
  myEarned: number;
  myPenalties: number;
  myFiltered: MyAccrual[];
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
  myLocked,
  myLoading,
  myDaysLeft,
  myDateFrom,
  myDateTo,
  setMyDateFrom,
  setMyDateTo,
  myEarned,
  myPenalties,
  myFiltered,
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

      {myLocked && !myLoading ? (
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-3">
          <MyAccrualsFilter
            dateFrom={myDateFrom}
            dateTo={myDateTo}
            setDateFrom={setMyDateFrom}
            setDateTo={setMyDateTo}
            earned={myEarned}
            penalties={myPenalties}
            count={myFiltered.length}
          />
          <MyAccrualsTable accruals={myFiltered} loading={myLoading} />
        </div>
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-md border border-border p-4">
            <p className="text-sm text-muted-foreground">К выплате</p>
            <p className="text-xl font-bold">{formatMoney(myBalance)} ₽</p>
          </div>
          <MyPayoutsCard payouts={myPayouts} loading={myLoading} />
        </div>
      </div>
      )}
    </div>
  </CrmLayout>
);

export default MySalaryView;
