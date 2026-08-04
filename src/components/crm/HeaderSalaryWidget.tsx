import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { fetchMySalary } from '@/lib/salaryApi';
import { fetchMyVariki } from '@/lib/varikiApi';
import { formatMoney } from '@/components/crm/dashboard/dashboardShared';

const PRODUCTION_ROLES = ['sewer', 'cutter', 'packer'];

/** Компактный виджет зарплаты к выплате для правого угла шапки CRM. Показывается на всех
 * ролях. Производственным ролям дополнительно показываются «Варики» — внутренняя игровая
 * валюта (при накоплении порога — приглашение сыграть в лототрон). */
const HeaderSalaryWidget = () => {
  const { user } = useAuth();
  const [salary, setSalary] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [variki, setVariki] = useState<number | null>(null);
  const [canPlay, setCanPlay] = useState(false);

  const showVariki = !!user && PRODUCTION_ROLES.includes(user.role);

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

  useEffect(() => {
    if (!showVariki || !user?.id) return;
    fetchMyVariki(user.id)
      .then((data) => {
        setVariki(data.variki);
        setCanPlay(data.canPlay);
      })
      .catch(() => setVariki(null));
  }, [showVariki, user?.id]);

  return (
    <div className="flex items-center gap-2">
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

      {showVariki && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
            canPlay ? 'border-amber-400 bg-amber-50' : 'border-border bg-card'
          }`}
          title={canPlay ? 'Пора играть в лототрон!' : 'Игровая валюта «Варики»'}
        >
          <Icon name="Coins" size={16} className="text-amber-500" />
          <div className="leading-tight">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Варики</div>
            {canPlay ? (
              <div className="flex items-center gap-1 text-xs font-bold text-amber-600">
                <Icon name="PartyPopper" size={12} />
                Пора в лототрон!
              </div>
            ) : (
              <div className="text-sm font-bold">{variki ?? 0} шт</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HeaderSalaryWidget;