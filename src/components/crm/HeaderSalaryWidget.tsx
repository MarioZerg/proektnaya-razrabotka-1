import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { fetchMySalary } from '@/lib/salaryApi';
import { fetchMyVariki } from '@/lib/varikiApi';
import { formatMoney } from '@/components/crm/dashboard/dashboardShared';

const PRODUCTION_ROLES = ['sewer', 'cutter', 'packer'];

/** «1 день», «3 дня», «7 дней» — чтобы подпись читалась по-русски. */
const dayWord = (n: number) => {
  const last = n % 10;
  const twoLast = n % 100;
  if (twoLast >= 11 && twoLast <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
};

/** Компактный виджет зарплаты к выплате для правого угла шапки CRM. Показывается на всех
 * ролях. Производственным ролям дополнительно показываются «Варики» — внутренняя игровая
 * валюта (при накоплении порога — приглашение сыграть в лототрон). */
const HeaderSalaryWidget = () => {
  const { user } = useAuth();
  const [salary, setSalary] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [variki, setVariki] = useState<number | null>(null);
  const [canPlay, setCanPlay] = useState(false);
  // Новичкам баланс закрыт первые две недели после регистрации — считает сервер.
  const [locked, setLocked] = useState(false);
  const [daysLeft, setDaysLeft] = useState(0);

  const showVariki = !!user && PRODUCTION_ROLES.includes(user.role);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchMySalary(user.id)
      .then((data) => {
        setSalary(data.balance);
        setLocked(!!data.salaryLocked);
        setDaysLeft(data.daysLeft || 0);
      })
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
      {locked && !loading ? (
        // Замочек до конца испытательных двух недель. Открывается сам — сотруднику
        // ничего делать не нужно, поэтому показываем, сколько дней осталось.
        <div
          className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-1.5"
          title={`Баланс откроется через ${daysLeft} ${dayWord(daysLeft)}`}
        >
          <Icon name="Lock" size={16} className="text-muted-foreground" />
          <div className="leading-tight">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Зарплата к выплате
            </div>
            <div className="text-xs font-semibold text-muted-foreground">
              Откроется через {daysLeft} {dayWord(daysLeft)}
            </div>
          </div>
        </div>
      ) : (
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
      )}

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