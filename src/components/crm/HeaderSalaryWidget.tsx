import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { fetchMySalary } from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/dashboard/dashboardShared';

/** Компактный виджет зарплаты к выплате для правого угла шапки CRM. Показывается на всех
 * ролях: сам подгружает баланс текущего пользователя. */
const HeaderSalaryWidget = () => {
  const { user } = useAuth();
  const [salary, setSalary] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchMySalary(user.id)
      .then((data) => setSalary(data.balance))
      .catch(() => setSalary(null))
      .finally(() => setLoading(false));
  }, [user?.id]);

  return (
    <div className="relative flex items-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-3 py-1.5">
      {/* Изредка переливающийся блик по виджету */}
      <div className="pointer-events-none absolute inset-0 -skew-x-12 animate-shimmer bg-gradient-to-r from-transparent via-emerald-400/25 to-transparent" />
      <Icon name="Wallet" size={16} className="text-emerald-600" />
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Зарплата к выплате
        </div>
        {loading ? (
          <Icon name="Loader2" size={14} className="animate-spin text-muted-foreground" />
        ) : (
          <div className="text-sm font-bold">{formatMoney(salary || 0)} ₽</div>
        )}
      </div>
    </div>
  );
};

export default HeaderSalaryWidget;