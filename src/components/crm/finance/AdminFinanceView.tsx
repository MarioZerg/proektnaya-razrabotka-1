import CrmLayout from '@/components/crm/CrmLayout';
import FinanceSummaryCard from '@/components/crm/finance/FinanceSummaryCard';
import SalaryPayoutsTable from '@/components/crm/finance/SalaryPayoutsTable';
import ShaftPremiumsCard from '@/components/crm/finance/ShaftPremiumsCard';
import SalaryRatesCard from '@/components/crm/finance/SalaryRatesCard';
import CashBoxCard from '@/components/crm/finance/CashBoxCard';
import MissedAccrualsAlert from '@/components/crm/finance/MissedAccrualsAlert';
import AdminOperationsPanel from '@/components/crm/finance/AdminOperationsPanel';
import BlockSkeleton from '@/components/crm/finance/BlockSkeleton';
import { useIdleMount } from '@/components/crm/finance/useIdleMount';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import type { Employee } from '@/lib/usersApi';
import type {
  SalaryOperation,
  SalaryPayout,
  CashBoxTransaction,
  PendingPayout,
} from '@/lib/salaryApi';

interface AdminFinanceViewProps {
  employees: Employee[];
  userFilter: string;
  setUserFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  savingAccrual: boolean;
  onManualAccrual: (userId: number, amount: number, description: string) => Promise<void>;
  onPenalty: (userId: number, amount: number, description: string) => Promise<void>;
  onDeduction: (userId: number, amount: number, description: string) => Promise<void>;
  pendingPayouts: PendingPayout[];
  onPayout: (userId: number, periodFrom?: string, periodTo?: string, debtIds?: number[]) => Promise<void>;
  operations: SalaryOperation[];
  operationsLoading: boolean;
  operationsPage: number;
  setOperationsPage: (v: number) => void;
  totalPages: number;
  filteredTotal: number;
  onDeleteAccrual: (id: number) => Promise<void>;
  onEditAccrual: (id: number, amount: number, description: string) => Promise<void>;
  /** Перечитать начисления: после отмены штрафа появляется строка возврата. */
  onReload: () => void;
  totalToAccrue: number;
  totalDebts: number;
  totalPenalties: number;
  penaltiesCount: number;
  penaltiesUsers: number;
  totalDeductions: number;
  deductionsCount: number;
  period1Total: number;
  period2Total: number;
  cashBalance: number;
  cashTransactions: CashBoxTransaction[];
  cashLoading: boolean;
  /** Скелетон сводки — только до первого ответа, перезагрузки не прячут цифры. */
  summaryLoading?: boolean;
  onCashDeposit: (amount: number, description: string) => Promise<void>;
  onUpdateRate: (id: number, rate: number) => Promise<void>;
  payouts: SalaryPayout[];
  payoutsLoading: boolean;
  payoutsError?: string | null;
  onRetryPayouts?: () => void;
  onDeletePayout: (id: number) => Promise<void>;
  operationsError?: string | null;
  cashError?: string | null;
  onRetryCash?: () => void;
}

/** Касса компании: начисления, сводка, касса, тарифы и история выплат. */
const AdminFinanceView = ({
  employees,
  userFilter,
  setUserFilter,
  typeFilter,
  setTypeFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  savingAccrual,
  onManualAccrual,
  onPenalty,
  onDeduction,
  pendingPayouts,
  onPayout,
  operations,
  operationsLoading,
  operationsPage,
  setOperationsPage,
  totalPages,
  filteredTotal,
  onDeleteAccrual,
  onEditAccrual,
  onReload,
  totalToAccrue,
  totalDebts,
  totalPenalties,
  penaltiesCount,
  penaltiesUsers,
  totalDeductions,
  deductionsCount,
  period1Total,
  period2Total,
  cashBalance,
  cashTransactions,
  cashLoading,
  summaryLoading,
  onCashDeposit,
  onUpdateRate,
  payouts,
  payoutsLoading,
  payoutsError = null,
  onRetryPayouts,
  onDeletePayout,
  operationsError = null,
  cashError = null,
  onRetryCash,
}: AdminFinanceViewProps) => {
  // Тарифы — тяжёлый блок ниже первого экрана со своими запросами (цеха → ставки).
  // Монтируем после первого paint, чтобы не душить начисления/сводку; до этого —
  // оболочка карточки той же формы.
  const ratesReady = useIdleMount(300);

  return (
  <CrmLayout>
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Финансы компании</h1>

      {operationsError && (
        <WarehouseFetchError
          title="Не удалось загрузить начисления"
          description={operationsError}
          onRetry={onReload}
        />
      )}
      {cashError && onRetryCash && (
        <WarehouseFetchError
          title="Не удалось загрузить кассу"
          description={cashError}
          onRetry={onRetryCash}
        />
      )}
      {payoutsError && onRetryPayouts && (
        <WarehouseFetchError
          title="Не удалось загрузить выплаты"
          description={payoutsError}
          onRetry={onRetryPayouts}
        />
      )}

      {/* Люди работали, а денег им не начислили. Молчаливая потеря: ошибки нет,
          человек просто остаётся без зарплаты. Показываем сразу под шапкой. */}
      <MissedAccrualsAlert />

      <div className="flex min-w-0 flex-col-reverse gap-6 lg:grid lg:grid-cols-4 lg:items-start">
        <AdminOperationsPanel
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
          onManualAccrual={onManualAccrual}
          onPenalty={onPenalty}
          onDeduction={onDeduction}
          pendingPayouts={pendingPayouts}
          onPayout={onPayout}
          operations={operations}
          operationsLoading={operationsLoading}
          operationsPage={operationsPage}
          setOperationsPage={setOperationsPage}
          totalPages={totalPages}
          filteredTotal={filteredTotal}
          onDeleteAccrual={onDeleteAccrual}
          onEditAccrual={onEditAccrual}
          onReload={onReload}
          error={operationsError}
        />

        <div className="min-w-0 space-y-6 lg:col-span-1">
          <FinanceSummaryCard
            totalToAccrue={totalToAccrue}
            totalDebts={totalDebts}
            totalPenalties={totalPenalties}
            penaltiesCount={penaltiesCount}
            penaltiesUsers={penaltiesUsers}
            totalDeductions={totalDeductions}
            deductionsCount={deductionsCount}
            // Клик по «Показать все штрафы» ставит фильтр таблицы слева:
            // админ сразу видит, кому и за что начислено удержание.
            onShowPenalties={() => {
              setTypeFilter('penalty');
              setUserFilter('all');
              setOperationsPage(1);
            }}
            period1Total={period1Total}
            period2Total={period2Total}
            loading={summaryLoading ?? operationsLoading}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CashBoxCard
          balance={cashBalance}
          transactions={cashTransactions}
          loading={cashLoading}
          saving={savingAccrual}
          onDeposit={onCashDeposit}
        />
        {ratesReady ? (
          <SalaryRatesCard onUpdate={onUpdateRate} />
        ) : (
          <Card className="border-border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Тарифы по ролям</CardTitle>
            </CardHeader>
            <CardContent>
              <BlockSkeleton rows={4} />
            </CardContent>
          </Card>
        )}
      </div>

      <ShaftPremiumsCard onPaid={onRetryCash} />

      <SalaryPayoutsTable
        payouts={payouts}
        loading={payoutsLoading}
        error={payoutsError}
        onDelete={onDeletePayout}
      />
    </div>
  </CrmLayout>
  );
};

export default AdminFinanceView;
