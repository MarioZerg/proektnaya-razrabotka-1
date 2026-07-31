import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import FinanceSummaryCard from '@/components/crm/finance/FinanceSummaryCard';
import FinanceToolbar from '@/components/crm/finance/FinanceToolbar';
import OperationsTable from '@/components/crm/finance/OperationsTable';
import SalaryPayoutsTable from '@/components/crm/finance/SalaryPayoutsTable';

const Finance = () => {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userFilter, setUserFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [operationsPage, setOperationsPage] = useState(1);
  const [payoutsPage, setPayoutsPage] = useState(1);

  useEffect(() => {
    fetchEmployees().then(setEmployees);
  }, []);

  if (user?.role !== 'admin') {
    return (
      <CrmLayout>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">Финансы</h1>
          <p className="text-sm text-muted-foreground">
            Раздел финансов для вашей роли пока в разработке.
          </p>
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
            />
            <OperationsTable page={operationsPage} setPage={setOperationsPage} />
          </div>

          <div className="lg:col-span-1">
            <FinanceSummaryCard />
          </div>
        </div>

        <SalaryPayoutsTable page={payoutsPage} setPage={setPayoutsPage} />
      </div>
    </CrmLayout>
  );
};

export default Finance;
