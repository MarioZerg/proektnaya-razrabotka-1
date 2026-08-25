import { useEffect, useMemo, useRef, useState } from 'react';
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
  createDeduction,
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
  type PendingPayout,
} from '@/lib/salaryApi';
import ManagerFinanceView from '@/components/crm/finance/ManagerFinanceView';
import MySalaryView from '@/components/crm/finance/MySalaryView';
import AdminFinanceView from '@/components/crm/finance/AdminFinanceView';

const Finance = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userFilter, setUserFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  // Период начислений: пусто — показываем все, как раньше.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [operationsPage, setOperationsPage] = useState(1);

  const [operations, setOperations] = useState<SalaryOperation[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [totalToAccrue, setTotalToAccrue] = useState(0);
  const [totalDebts, setTotalDebts] = useState(0);
  // Сумма всех удержаний: показываем её отдельно от «долгов», иначе штраф внутри
  // плюсового баланса нигде не виден.
  const [totalPenalties, setTotalPenalties] = useState(0);
  const [penaltiesCount, setPenaltiesCount] = useState(0);
  const [penaltiesUsers, setPenaltiesUsers] = useState(0);
  // Часть списаний — обычные удержания без вины: спецодежда, товар, аванс.
  const [totalDeductions, setTotalDeductions] = useState(0);
  // Кому реально есть что выплатить. Список сам обновляется после каждой
  // выплаты: рассчитанный сотрудник из него пропадает.
  const [pendingPayouts, setPendingPayouts] = useState<PendingPayout[]>([]);
  const [deductionsCount, setDeductionsCount] = useState(0);
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
  // Период в личных финансах. Фильтруем на клиенте: сервер и так отдаёт сотруднику
  // последние 200 его начислений — лишний запрос на каждое нажатие «Сегодня» не нужен.
  const [myDateFrom, setMyDateFrom] = useState('');
  const [myDateTo, setMyDateTo] = useState('');

  const myFiltered = useMemo(() => {
    if (!myDateFrom && !myDateTo) return myAccruals;
    return myAccruals.filter((a) => {
      // Считаем по дате, ЗА которую начислено: работу нередко проводят задним
      // числом, и по дате создания записи день выглядел бы пустым.
      const d = (a.accruedFor || '').slice(0, 10);
      if (!d) return false;
      if (myDateFrom && d < myDateFrom) return false;
      if (myDateTo && d > myDateTo) return false;
      return true;
    });
  }, [myAccruals, myDateFrom, myDateTo]);

  // Заработок и удержания за период показываем порознь: сотруднику важно видеть,
  // что штраф — это отдельная строка, а не «мне меньше начислили за работу».
  const myEarned = useMemo(
    () => myFiltered.reduce((s, a) => (a.amount > 0 ? s + a.amount : s), 0),
    [myFiltered],
  );
  const myPenalties = useMemo(
    () => myFiltered.reduce((s, a) => (a.amount < 0 ? s + a.amount : s), 0),
    [myFiltered],
  );

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

  // Сменили фильтр — возвращаемся на первую страницу: иначе можно оказаться на
  // десятой странице выборки, где записей уже нет, и увидеть пустую таблицу.
  useEffect(() => {
    setOperationsPage(1);
  }, [userFilter, typeFilter, dateFrom, dateTo]);

  // Номер последнего отправленного запроса. Переключая сотрудника или тип, админ
  // запускает несколько запросов подряд, и отвечают они не по порядку: ответ по
  // ПРЕДЫДУЩЕМУ сотруднику мог прийти последним и затереть правильные цифры — на
  // экране висела сумма чужого начисления, которого у этого человека нет.
  // Принимаем только ответ на самый свежий запрос, остальные игнорируем.
  const operationsReqId = useRef(0);

  const loadOperations = () => {
    const reqId = ++operationsReqId.current;
    setOperationsLoading(true);
    fetchSalarySummary({
      userId: userFilter !== 'all' ? Number(userFilter) : undefined,
      type: typeFilter !== 'all' ? typeFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page: operationsPage,
    })
      .then((data) => {
        if (reqId !== operationsReqId.current) return;
        setOperations(data.operations);
        setTotalPages(data.totalPages);
        setFilteredTotal(data.filteredTotal);
        setTotalToAccrue(data.totalToAccrue);
        setTotalDebts(data.totalDebts);
        setTotalPenalties(data.totalPenalties);
        setPenaltiesCount(data.penaltiesCount);
        setPenaltiesUsers(data.penaltiesUsers);
        setTotalDeductions(data.totalDeductions);
        setDeductionsCount(data.deductionsCount);
        setPendingPayouts(data.pendingPayouts);
        setPeriod1Total(data.period1Total);
        setPeriod2Total(data.period2Total);
      })
      .finally(() => {
        if (reqId !== operationsReqId.current) return;
        setOperationsLoading(false);
      });
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
  }, [userFilter, typeFilter, dateFrom, dateTo, operationsPage, user?.role]);

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

  // Удержание — обычное списание с сотрудника, без вины: спецодежда, выкуп
  // товара, аванс. Отдельно от штрафа, чтобы человек не видел у себя
  // «наказание» там, где он просто рассчитался за покупку.
  const handleDeduction = async (userId: number, amount: number, description: string) => {
    setSavingAccrual(true);
    try {
      await createDeduction({ userId, amount, description, actorId: user?.id, actorName: user?.name });
      toast({ title: 'Удержание проведено' });
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

  const handlePayout = async (
    userId: number,
    periodFrom?: string,
    periodTo?: string,
  ) => {
    setSavingAccrual(true);
    try {
      const res = await payoutSalary(
        userId, user?.id, user?.name, periodFrom, periodTo,
      );
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

  // У менеджера маркетплейсов другая схема: не сдельная работа в цехе, а
  // процент с денег, пришедших на счёт по недельным отчётам площадки.
  // Показывать ему экран цеховых начислений бессмысленно — он там пустой.
  if (user?.role === 'manager' && user?.id) {
    return <ManagerFinanceView userId={user.id} />;
  }

  if (user?.role !== 'admin') {
    return (
      <MySalaryView
        myLocked={myLocked}
        myLoading={myLoading}
        myDaysLeft={myDaysLeft}
        myDateFrom={myDateFrom}
        myDateTo={myDateTo}
        setMyDateFrom={setMyDateFrom}
        setMyDateTo={setMyDateTo}
        myEarned={myEarned}
        myPenalties={myPenalties}
        myFiltered={myFiltered}
        myBalance={myBalance}
        myPayouts={myPayouts}
      />
    );
  }

  return (
    <AdminFinanceView
      employees={employees}
      userFilter={userFilter}
      setUserFilter={setUserFilter}
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
      dateFrom={dateFrom}
      setDateFrom={setDateFrom}
      dateTo={dateTo}
      setDateTo={setDateTo}
      savingAccrual={savingAccrual}
      onManualAccrual={handleManualAccrual}
      onPenalty={handlePenalty}
      onDeduction={handleDeduction}
      pendingPayouts={pendingPayouts}
      onPayout={handlePayout}
      operations={operations}
      operationsLoading={operationsLoading}
      operationsPage={operationsPage}
      setOperationsPage={setOperationsPage}
      totalPages={totalPages}
      filteredTotal={filteredTotal}
      onDeleteAccrual={handleDeleteAccrual}
      onEditAccrual={handleEditAccrual}
      totalToAccrue={totalToAccrue}
      totalDebts={totalDebts}
      totalPenalties={totalPenalties}
      penaltiesCount={penaltiesCount}
      penaltiesUsers={penaltiesUsers}
      totalDeductions={totalDeductions}
      deductionsCount={deductionsCount}
      period1Total={period1Total}
      period2Total={period2Total}
      cashBalance={cashBalance}
      cashTransactions={cashTransactions}
      cashLoading={cashLoading}
      onCashDeposit={handleCashDeposit}
      onUpdateRate={handleUpdateRate}
      payouts={payouts}
      payoutsLoading={payoutsLoading}
      onDeletePayout={handleDeletePayout}
    />
  );
};

export default Finance;
