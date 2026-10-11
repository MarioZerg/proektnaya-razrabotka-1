import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/AuthContext';
import { fetchMySalary } from '@/lib/salaryApi';
import { fetchVacationBoard } from '@/lib/usersApi';
import { fetchMyVariki } from '@/lib/varikiApi';
import { dayWord, vacationMenuText } from '@/lib/vacationStatus';
import { formatMoney } from '@/components/crm/dashboard/dashboardShared';

const PRODUCTION_ROLES = ['sewer', 'cutter', 'packer', 'packer_returns'];

/** Компактный виджет зарплаты в правом углу шапки.
 * У бухгалтера не показывается.
 * Варики не стоят второй плашкой: на узкой шапке они наезжали на соседний виджет.
 * Они открываются меню под балансом и ведут в Тайм-кофе. */
const HeaderSalaryWidget = () => {
  const { user } = useAuth();
  const [salary, setSalary] = useState<number | null>(null);
  const [salaryError, setSalaryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [variki, setVariki] = useState<number | null>(null);
  const [varikiError, setVarikiError] = useState(false);
  const [vacationText, setVacationText] = useState<string | null>(null);
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
        setSalaryError(false);
        setSalary(data.balance);
        setLocked(!!data.salaryLocked);
        setDaysLeft(data.daysLeft || 0);
      })
      .catch(() => setSalaryError(true))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    if (!showVariki || !user?.id) return;
    fetchMyVariki(user.id)
      .then((data) => {
        setVarikiError(false);
        setVariki(data.variki);
      })
      .catch(() => setVarikiError(true));
  }, [showVariki, user?.id]);

  // Отпуск читаем в момент открытия меню, без таймера: дни считаются от даты
  // выхода в профиле, а идущий отпуск показывается датами с и по.
  const loadVacation = () => {
    if (!user?.id) return;
    fetchVacationBoard()
      .then((board) => {
        const me = board.people.find((person) => person.id === user.id);
        setVacationText(me ? vacationMenuText(me, board.today) : null);
      })
      .catch(() => setVacationText(null));
  };

  return (
    // min-w-0 + гибкая ширина: при большом балансе виджеты ужимаются, а не
    // растягивают шапку — иначе на телефоне появлялась прокрутка всей страницы.
    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
      {locked && !loading ? (
        // Замочек до конца испытательных двух недель. Открывается сам — сотруднику
        // ничего делать не нужно, поэтому показываем, сколько дней осталось.
        <div
          className="flex min-w-0 items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/40 px-2 py-1.5 sm:gap-2 sm:px-3"
          title={`Баланс откроется через ${daysLeft} ${dayWord(daysLeft)}`}
        >
          <Icon name="Lock" size={16} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="sm:hidden">Зарплата</span>
              <span className="hidden sm:inline">Зарплата к выплате</span>
            </div>
            <div className="truncate text-xs font-semibold text-muted-foreground">
              Откроется через {daysLeft} {dayWord(daysLeft)}
            </div>
          </div>
        </div>
      ) : showVariki ? (
        <DropdownMenu onOpenChange={(open) => { if (open) loadVacation(); }}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-border bg-card px-2 py-1.5 text-left transition hover:bg-muted/50 sm:gap-2 sm:px-3"
              title="Зарплата и варики"
            >
              <Icon name="Wallet" size={16} className="shrink-0 text-emerald-600" />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span className="sm:hidden">Зарплата</span>
                  <span className="hidden sm:inline">Зарплата к выплате</span>
                </div>
                {loading ? (
                  <Icon name="Loader2" size={14} className="animate-spin text-muted-foreground" />
                ) : (
                  <div className="truncate text-xs font-bold sm:text-sm">
                    {salaryError && salary == null ? '—' : `${formatMoney(salary || 0)}\u00a0₽`}
                  </div>
                )}
              </div>
              <Icon name="ChevronDown" size={14} className="shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem asChild>
              <Link to="/crm/variki/shop" className="flex cursor-pointer items-center gap-2">
                <Icon name="Coins" size={16} className="shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                    Варики
                  </span>
                  <span className="block font-bold">
                    {varikiError && variki == null ? '—' : `${variki ?? 0}\u00a0шт`}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">Тайм-кофе</span>
              </Link>
            </DropdownMenuItem>
            {vacationText && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="font-normal">
                  <span className="flex items-start gap-2">
                    <Icon name="Calendar" size={16} className="mt-0.5 shrink-0 text-teal-600" />
                    <span className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                        Отпуск
                      </span>
                      <span className="block text-sm font-semibold">{vacationText}</span>
                    </span>
                  </span>
                </DropdownMenuLabel>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div
          className="relative flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-border bg-card px-2 py-1.5 sm:gap-2 sm:px-3"
          title="Зарплата к выплате"
        >
          <Icon name="Wallet" size={16} className="shrink-0 text-emerald-600" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="sm:hidden">Зарплата</span>
              <span className="hidden sm:inline">Зарплата к выплате</span>
            </div>
            {loading ? (
              <Icon name="Loader2" size={14} className="animate-spin text-muted-foreground" />
            ) : (
              <div className="truncate text-xs font-bold sm:text-sm">
                {salaryError && salary == null ? '—' : `${formatMoney(salary || 0)}\u00a0₽`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HeaderSalaryWidget;