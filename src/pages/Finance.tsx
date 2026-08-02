import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import {
  fetchSalarySummary,
  fetchSalaryRates,
  fetchSalaryPayouts,
  fetchMySalary,
  createManualAccrual,
  createPenalty,
  deleteAccrual,
  payoutSalary,
  updateSalaryRate,
  type SalaryOperation,
  type SalaryRate,
  type SalaryPayout,
  type MyAccrual,
  type MyPayout,
} from '@/lib/salaryApi';
import FinanceSummaryCard from '@/components/crm/finance/FinanceSummaryCard';
import FinanceToolbar from '@/components/crm/finance/FinanceToolbar';
import OperationsTable from '@/components/crm/finance/OperationsTable';
import SalaryPayoutsTable from '@/components/crm/finance/SalaryPayoutsTable';
import SalaryRatesCard from '@/components/crm/finance/SalaryRatesCard';
import MyAccrualsTable from '@/components/crm/finance/MyAccrualsTable';
import MyPayoutsCard from '@/components/crm/finance/MyPayoutsCard';
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
  const [totalUnpaid, setTotalUnpaid] = useState(0);
  const [period1Total, setPeriod1Total] = useState(0);
  const [period2Total, setPeriod2Total] = useState(0);
  const [operationsLoading, setOperationsLoading] = useState(true);

  const [rates, setRates] = useState<SalaryRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);

  const [payouts, setPayouts] = useState<SalaryPayout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  const [savingAccrual, setSavingAccrual] = useState(false);

  const [myAccruals, setMyAccruals] = useState<MyAccrual[]>([]);
  const [myBalance, setMyBalance] = useState(0);
  const [myPayouts, setMyPayouts] = useState<MyPayout[]>([]);
  const [myLoading, setMyLoading] = useState(true);

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
        setTotalUnpaid(data.totalUnpaid);
        setPeriod1Total(data.period1Total);
        setPeriod2Total(data.period2Total);
      })
      .finally(() => setOperationsLoading(false));
  };

  const loadRates = () => {
    setRatesLoading(true);
    fetchSalaryRates()
      .then(setRates)
      .finally(() => setRatesLoading(false));
  };

  const loadPayouts = () => {
    setPayoutsLoading(true);
    fetchSalaryPayouts()
      .then(setPayouts)
      .finally(() => setPayoutsLoading(false));
  };

  useEffect(() => {
    if (user?.role !== 'admin') return;
    loadOperations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter, typeFilter, operationsPage, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    loadRates();
    loadPayouts();
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

  const handlePayout = async (userId: number) => {
    setSavingAccrual(true);
    try {
      const res = await payoutSalary(userId, user?.id, user?.name);
      toast({ title: 'Зарплата выплачена', description: `Сумма: ${res.amount.toFixed(2)} ₽` });
      loadOperations();
      loadPayouts();
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

  const handleUpdateRate = async (id: number, rate: number) => {
    try {
      await updateSalaryRate(id, rate, user?.id, user?.name);
      toast({ title: 'Тариф обновлён' });
      loadRates();
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
              onDelete={handleDeleteAccrual}
            />
          </div>

          <div className="space-y-6 lg:col-span-1">
            <FinanceSummaryCard
              totalUnpaid={totalUnpaid}
              period1Total={period1Total}
              period2Total={period2Total}
              loading={operationsLoading}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SalaryRatesCard rates={rates} loading={ratesLoading} onUpdate={handleUpdateRate} />
          <SalaryPayoutsTable payouts={payouts} loading={payoutsLoading} />
        </div>
      </div>
    </CrmLayout>
  );
};

export default Finance;
