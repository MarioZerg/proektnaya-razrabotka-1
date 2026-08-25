import FinanceToolbar from '@/components/crm/finance/FinanceToolbar';
import OperationsTable from '@/components/crm/finance/OperationsTable';
import { formatMoney } from '@/components/crm/finance/financeShared';
import type { Employee } from '@/lib/usersApi';
import type { SalaryOperation, PendingPayout } from '@/lib/salaryApi';

interface AdminOperationsPanelProps {
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
  onPayout: (userId: number, periodFrom?: string, periodTo?: string) => Promise<void>;
  operations: SalaryOperation[];
  operationsLoading: boolean;
  operationsPage: number;
  setOperationsPage: (v: number) => void;
  totalPages: number;
  filteredTotal: number;
  onDeleteAccrual: (id: number) => Promise<void>;
  onEditAccrual: (id: number, amount: number, description: string) => Promise<void>;
}

/**
 * Левая колонка кассы: фильтры, кнопки операций и таблица начислений.
 *
 * Итог по выбранному фильтру считается по ВСЕЙ выборке, а не по видимой
 * странице: главный смысл фильтра по датам — увидеть, сколько сотрудник
 * заработал за период.
 */
const AdminOperationsPanel = ({
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
}: AdminOperationsPanelProps) => (
  <div className="space-y-4 lg:col-span-3">
    <FinanceToolbar
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
    />
    {/* Итог по выбранному фильтру: главный смысл фильтра по датам — увидеть,
        сколько сотрудник заработал за период. Считается по всем записям
        выборки, а не по видимой странице. */}
    {(userFilter !== 'all' || typeFilter !== 'all' || dateFrom || dateTo) &&
      !operationsLoading && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            Начислено по выбранному фильтру
            {userFilter !== 'all' &&
              `: ${employees.find((e) => String(e.id) === userFilter)?.fullName || ''}`}
          </span>
          <span className="text-lg font-bold">{formatMoney(filteredTotal)}</span>
        </div>
      )}

    <OperationsTable
      operations={operations}
      loading={operationsLoading}
      page={operationsPage}
      setPage={setOperationsPage}
      totalPages={totalPages}
      savingAccrual={savingAccrual}
      onDelete={onDeleteAccrual}
      onEdit={onEditAccrual}
    />
  </div>
);

export default AdminOperationsPanel;
