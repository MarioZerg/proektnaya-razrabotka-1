import AdminNotifications from '@/components/crm/dashboard/AdminNotifications';
import VacationOnLeaveCard from '@/components/crm/dashboard/VacationOnLeaveCard';
import VarikiPurchasesCard from '@/components/crm/variki/VarikiPurchasesCard';
import MyShiftCard from '@/components/crm/dashboard/MyShiftCard';
import AwardCard from '@/components/crm/dashboard/AwardCard';
import PackerStickerQueueCard from '@/components/crm/dashboard/PackerStickerQueueCard';
import Icon from '@/components/ui/icon';
import { type EmployeeShiftStatus } from '@/lib/shiftSessionsApi';

const STAGE_ANCHOR = {
  production: 'dashboard-stage-production',
  warehouse: 'dashboard-stage-warehouse',
} as const;

/** Прокрутка к блоку дашборда с учётом липкой шапки: заголовок не должен
 *  прятаться под меню и балансом. */
const scrollToStage = (id: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  const sticky = document.querySelector('main .sticky');
  const offset = sticky instanceof HTMLElement ? sticky.offsetHeight + 12 : 72;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
};

interface CrmDashboardHeaderProps {
  userName?: string;
  userId?: number;
  userRole?: string;
  isSewer: boolean;
  isPacker: boolean;
  isStorekeeper: boolean;
  myShiftStatus: EmployeeShiftStatus | null;
  shiftsLoading: boolean;
  shiftsError?: string | null;
  onRetryShifts?: () => void;
  isAdmin?: boolean;
}

/**
 * Верх главной: заголовок, своя смена и уведомления администратора.
 *
 * Выработка швей и премия за метраж с главной сняты: программа закончилась
 * 30.09.2026, блоки больше не показываем ни швее, ни руководству.
 */
const CrmDashboardHeader = ({
  userName,
  userId,
  userRole,
  isSewer: _isSewer,
  isPacker,
  isStorekeeper,
  myShiftStatus,
  shiftsLoading,
  shiftsError,
  onRetryShifts,
  isAdmin = false,
}: CrmDashboardHeaderProps) => (
  <>
    <header className="dash-head w-full min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-[#f7f4ee] shadow-sm">
      {/* Кладовщику это не «Главная» вообще, а ЕГО рабочее место: он
          открывает смену и весь день работает на складе. Обращение по имени
          и своя смена сразу под заголовком превращают общий дашборд в
          личное пространство. */}
      <div className="px-4 py-3 sm:px-5">
        <h1 className="truncate text-xl font-bold tracking-tight">
          {isStorekeeper ? `Склад · ${userName || ''}`.trim() : 'Главная'}
        </h1>
      </div>
      {isStorekeeper ? (
        <p className="border-t border-border/70 bg-white/70 px-4 py-2.5 text-sm leading-snug text-muted-foreground sm:px-5">
          Смена, приёмка и отгрузки на сегодня
        </p>
      ) : (
        <div className="dash-head-row border-t border-border/70 bg-white/70">
          <button
            type="button"
            onClick={() => scrollToStage(STAGE_ANCHOR.production)}
            className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold leading-tight transition-colors hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Icon name="Factory" size={16} className="shrink-0 text-violet-600" />
            <span className="min-w-0">Производство</span>
          </button>
          <span aria-hidden className="dash-head-rule" />
          <button
            type="button"
            onClick={() => scrollToStage(STAGE_ANCHOR.warehouse)}
            className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold leading-tight transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Icon name="Warehouse" size={16} className="shrink-0 text-amber-700" />
            <span className="min-w-0">Склад на сегодня</span>
          </button>
        </div>
      )}
    </header>

    {/* Назначенная премия — самым первым блоком: это личная новость сотрудника,
        и она не должна теряться среди рабочих сводок. Карточка рисуется только
        тому, кому премия назначена, и исчезает сама в день начисления. */}
    <AwardCard userId={userId} />

    {/* Своя смена — первое, что видит кладовщик: идёт ли она и сколько
        принесёт при закрытии. */}
    {isStorekeeper && (
      <MyShiftCard
        me={myShiftStatus}
        loading={shiftsLoading}
        error={shiftsError}
        onRetry={onRetryShifts}
      />
    )}

    {/* Решения склада, которые стоят денег, — сразу перед виджетами: админ видит их
        первыми, ещё до сводки по цеху. */}
    {isAdmin && <AdminNotifications />}
    {isAdmin && <VacationOnLeaveCard />}
    {/* Упаковщице на телефоне сразу видно, чью пачку разбирать первой:
        швея, которая скинула на стикеровку раньше всех. */}
    {isPacker && <PackerStickerQueueCard />}
    {/* Покупки за варики: сотрудник заплатил и ждёт купон — заявка не должна
        потеряться, поэтому висит на панели, пока админ не прикрепит PDF. */}
    {userRole === 'admin' && <VarikiPurchasesCard />}
  </>
);

export default CrmDashboardHeader;
