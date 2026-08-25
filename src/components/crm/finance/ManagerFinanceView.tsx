import CrmLayout from '@/components/crm/CrmLayout';
import ManagerAccrualsPanel from '@/components/crm/finance/ManagerAccrualsPanel';

interface ManagerFinanceViewProps {
  userId: number;
}

/**
 * Финансы менеджера маркетплейсов.
 *
 * У него другая схема: не сдельная работа в цехе, а процент с денег, пришедших
 * на счёт по недельным отчётам площадки. Экран цеховых начислений ему
 * показывать бессмысленно — он там пустой.
 */
const ManagerFinanceView = ({ userId }: ManagerFinanceViewProps) => (
  <CrmLayout>
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Мои финансы</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Процент с продаж по недельным отчётам маркетплейсов
        </p>
      </div>
      <ManagerAccrualsPanel userId={userId} />
    </div>
  </CrmLayout>
);

export default ManagerFinanceView;
