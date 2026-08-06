import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import {
  fetchSalarySummary,
  fetchSalaryPayouts,
  fetchMySalary,
  fetchCashBox,
  createManualAccrual,
  createPenalty,
  updateAccrual,
  deleteAccrual,
  payoutSalary,
  deletePayout,
  cashDeposit,
  updateSalaryRate,
  type SalaryOperation,
  type SalaryPayout,
  type MyAccrual,
  type MyPayout,
  type CashBoxTransaction,
} from '@/lib/salaryApi';
import FinanceSummaryCard from '@/components/crm/finance/FinanceSummaryCard';
import FinanceToolbar from '@/components/crm/finance/FinanceToolbar';
import OperationsTable from '@/components/crm/finance/OperationsTable';
import SalaryPayoutsTable from '@/components/crm/finance/SalaryPayoutsTable';
import SalaryRatesCard from '@/components/crm/finance/SalaryRatesCard';
import MyAccrualsTable from '@/components/crm/finance/MyAccrualsTable';
import MyPayoutsCard from '@/components/crm/finance/MyPayoutsCard';
import CashBoxCard from '@/components/crm/finance/CashBoxCard';
import { formatMoney } from '@/components/crm/finance/financeShared';

const Finance = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userFilter, setUserFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [operationsPage, setOperationsPage] = useState(1);

  const [operations, setOperations] = useState<SalaryOperation[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalToAccrue, setTotalToAccrue] = useState(0);
  const [totalDebts, setTotalDebts] = useState(0);
  const [period1Total, setPeriod1Total] = useState(0);
  const [period2Total, setPeriod2Total] = useState(0);
  const [operationsLoading, setOperationsLoading] = useState(true);

  const [payouts, setPayouts] = useState<SalaryPayout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  const [cashBalance, setCashBalance] = useState(0);
  const [cashTransactions, setCashTransactions] = useState<CashBoxTransaction[]>([]);
  const [cashLoading, setCashLoading] = useState(true);

  const [savingAccrual, setSavingAccrual] = useState(false);

  const [myAccruals, setMyAccruals] = useState<MyAccrual[]>([]);
  const [myBalance, setMyBalance] = useState(0);
  const [myPayouts, setMyPayouts] = useState<MyPayout[]>([]);
  const [myLoading, setMyLoading] = useState(true);
  // Новичкам зарплата открывается через 2 недели после регистрации — считает сервер.
  const [myLocked, setMyLocked] = useState(false);
  const [myDaysLeft, setMyDaysLeft] = useState(0);

  useEffect(() => {
    fetchEmployees().then(setEmployees);
  }, []);

  useEffect(() => {
    if (user?.role === 'admin' || !user?.id) return;
    setMyLoading(true);
    fetchMySalary(user.id)
      .then((data) => {
        setMyAccruals(data.accruals);
        setMyBalance(data.balance);
        setMyPayouts(data.payouts);
        setMyLocked(!!data.salaryLocked);
        setMyDaysLeft(data.daysLeft || 0);
      })
      .finally(() => setMyLoading(false));
  }, [user?.role, user?.id]);

  const loadOperations = () => {
    setOperationsLoading(true);
    fetchSalarySummary({
      userId: userFilter !== 'all' ? Number(userFilter) : undefined,
      type: typeFilter !== 'all' ? typeFilter : undefined,
      page: operationsPage,
    })
      .then((data) => {
        setOperations(data.operations);
        setTotalPages(data.totalPages);
        setTotalToAccrue(data.totalToAccrue);
        setTotalDebts(data.totalDebts);
        setPeriod1Total(data.period1Total);
        setPeriod2Total(data.period2Total);
      })
      .finally(() => setOperationsLoading(false));
  };

  const loadPayouts = () => {
    setPayoutsLoading(true);
    fetchSalaryPayouts()
      .then(setPayouts)
      .finally(() => setPayoutsLoading(false));
  };

  const loadCashBox = () => {
    setCashLoading(true);
    fetchCashBox()
      .then((data) => {
        setCashBalance(data.balance);
        setCashTransactions(data.transactions);
      })
      .finally(() => setCashLoading(false));
  };

  useEffect(() => {
    if (user?.role !== 'admin') return;
    loadOperations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter, typeFilter, operationsPage, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    loadPayouts();
    loadCashBox();
  }, [user?.role]);

  const handleManualAccrual = async (userId: number, amount: number, description: string) => {
    setSavingAccrual(true);
    try {
      await createManualAccrual({ userId, amount, description, actorId: user?.id, actorName: user?.name });
      toast({ title: 'Начисление создано' });
      loadOperations();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingAccrual(false);
    }
  };

  const handlePenalty = async (userId: number, amount: number, description: string) => {
    setSavingAccrual(true);
    try {
      await createPenalty({ userId, amount, description, actorId: user?.id, actorName: user?.name });
      toast({ title: 'Штраф выписан' });
      loadOperations();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingAccrual(false);
    }
  };

  const handleEditAccrual = async (id: number, amount: number, description: string) => {
    setSavingAccrual(true);
    try {
      await updateAccrual({ id, amount, description, actorId: user?.id, actorName: user?.name });
      toast({ title: 'Начисление обновлено' });
      loadOperations();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingAccrual(false);
    }
  };

  const handlePayout = async (userId: number) => {
    setSavingAccrual(true);
    try {
      const res = await payoutSalary(userId, user?.id, user?.name);
      toast({ title: 'Зарплата выплачена', description: `Сумма: ${res.amount.toFixed(2)} ₽` });
      loadOperations();
      loadPayouts();
      loadCashBox();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingAccrual(false);
    }
  };

  const handleDeleteAccrual = async (id: number) => {
    try {
      await deleteAccrual(id, user?.id, user?.name);
      toast({ title: 'Начисление удалено' });
      loadOperations();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleDeletePayout = async (id: number) => {
    try {
      await deletePayout(id, user?.id, user?.name);
      toast({ title: 'Выплата удалена' });
      loadOperations();
      loadPayouts();
      loadCashBox();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleCashDeposit = async (amount: number, description: string) => {
    setSavingAccrual(true);
    try {
      await cashDeposit({ amount, description, actorId: user?.id, actorName: user?.name });
      toast({ title: 'Касса пополнена' });
      loadCashBox();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingAccrual(false);
    }
  };

  const handleUpdateRate = async (id: number, rate: number) => {
    try {
      await updateSalaryRate(id, rate, user?.id, user?.name);
      toast({ title: 'Тариф обновлён' });
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  if (user?.role !== 'admin') {
    return (
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
              <MyAccrualsTable accruals={myAccruals} loading={myLoading} />
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
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Финансы компании</h1>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="space-y-4 lg:col-span-3">
            <FinanceToolbar
              employees={employees}
              userFilter={userFilter}
              setUserFilter={setUserFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              savingAccrual={savingAccrual}
              onManualAccrual={handleManualAccrual}
              onPenalty={handlePenalty}
              onPayout={handlePayout}
            />
            <OperationsTable
              operations={operations}
              loading={operationsLoading}
              page={operationsPage}
              setPage={setOperationsPage}
              totalPages={totalPages}
              savingAccrual={savingAccrual}
              onDelete={handleDeleteAccrual}
              onEdit={handleEditAccrual}
            />
          </div>

          <div className="space-y-6 lg:col-span-1">
            <FinanceSummaryCard
              totalToAccrue={totalToAccrue}
              totalDebts={totalDebts}
              period1Total={period1Total}
              period2Total={period2Total}
              loading={operationsLoading}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <CashBoxCard
            balance={cashBalance}
            transactions={cashTransactions}
            loading={cashLoading}
            saving={savingAccrual}
            onDeposit={handleCashDeposit}
          />
          <SalaryRatesCard onUpdate={handleUpdateRate} />
        </div>

        <SalaryPayoutsTable payouts={payouts} loading={payoutsLoading} onDelete={handleDeletePayout} />
      </div>
    </CrmLayout>
  );
};

export default Finance;
