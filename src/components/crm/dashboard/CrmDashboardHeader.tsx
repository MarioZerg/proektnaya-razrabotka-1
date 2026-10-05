import AdminNotifications from '@/components/crm/dashboard/AdminNotifications';
import VarikiPurchasesCard from '@/components/crm/variki/VarikiPurchasesCard';
import MyShiftCard from '@/components/crm/dashboard/MyShiftCard';
import AwardCard from '@/components/crm/dashboard/AwardCard';
import { type EmployeeShiftStatus } from '@/lib/shiftSessionsApi';

interface CrmDashboardHeaderProps {
  userName?: string;
  userId?: number;
  userRole?: string;
  isSewer: boolean;
  isStorekeeper: boolean;
  myShiftStatus: EmployeeShiftStatus | null;
  shiftsLoading: boolean;
  shiftsError?: string | null;
  onRetryShifts?: () => void;
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
  isStorekeeper,
  myShiftStatus,
  shiftsLoading,
  shiftsError,
  onRetryShifts,
}: CrmDashboardHeaderProps) => (
  <>
    <div>
      {/* Кладовщику это не «Главная» вообще, а ЕГО рабочее место: он
          открывает смену и весь день работает на складе. Обращение по имени
          и своя смена сразу под заголовком превращают общий дашборд в
          личное пространство. */}
      <h1 className="truncate text-xl font-bold">
        {isStorekeeper ? `Склад · ${userName || ''}`.trim() : 'Главная'}
      </h1>
      <p className="mt-1 max-w-[40ch] text-sm leading-snug text-muted-foreground">
        {isStorekeeper
          ? 'Смена, приёмка и отгрузки на сегодня'
          : 'Производство и склад на сегодня'}
      </p>
    </div>

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
    {userRole === 'admin' && <AdminNotifications />}
    {/* Покупки за варики: сотрудник заплатил и ждёт купон — заявка не должна
        потеряться, поэтому висит на панели, пока админ не прикрепит PDF. */}
    {userRole === 'admin' && <VarikiPurchasesCard />}
  </>
);

export default CrmDashboardHeader;
