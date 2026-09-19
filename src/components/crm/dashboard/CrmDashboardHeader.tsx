import AdminNotifications from '@/components/crm/dashboard/AdminNotifications';
import EtrnToSignCard from '@/components/crm/dashboard/EtrnToSignCard';
import VarikiPurchasesCard from '@/components/crm/variki/VarikiPurchasesCard';
import MyShiftCard from '@/components/crm/dashboard/MyShiftCard';
import AwardCard from '@/components/crm/dashboard/AwardCard';
import SewerBonusCard from '@/components/crm/dashboard/SewerBonusCard';
import SewerDailyCard from '@/components/crm/dashboard/SewerDailyCard';
import { type EmployeeShiftStatus } from '@/lib/shiftSessionsApi';

interface CrmDashboardHeaderProps {
  userName?: string;
  userId?: number;
  userRole?: string;
  isSewer: boolean;
  isStorekeeper: boolean;
  myShiftStatus: EmployeeShiftStatus | null;
  shiftsLoading: boolean;
}

/**
 * Верх главной: заголовок, своя смена, уведомления администратора и выработка швей.
 *
 * Вынесено из страницы 1:1 — тот же порядок блоков и те же условия показа. Порядок
 * здесь смысловой, а не случайный: сначала личное (смена), потом то, что требует
 * решения администратора, и только затем отчёты.
 */
const CrmDashboardHeader = ({
  userName,
  userId,
  userRole,
  isSewer,
  isStorekeeper,
  myShiftStatus,
  shiftsLoading,
}: CrmDashboardHeaderProps) => (
  <>
    <div>
      {/* Кладовщику это не «Главная» вообще, а ЕГО рабочее место: он
          открывает смену и весь день работает на складе. Обращение по имени
          и своя смена сразу под заголовком превращают общий дашборд в
          личное пространство. */}
      <h1 className="text-xl font-bold">
        {isStorekeeper ? `Склад · ${userName || ''}`.trim() : 'Главная'}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isStorekeeper
          ? 'Ваша смена, приёмка и отгрузки на сегодня'
          : 'Обзор производства и складских процессов на сегодня'}
      </p>
    </div>

    {/* Назначенная премия — самым первым блоком: это личная новость сотрудника,
        и она не должна теряться среди рабочих сводок. Карточка рисуется только
        тому, кому премия назначена, и исчезает сама в день начисления. */}
    <AwardCard userId={userId} />

    {/* Своя смена — первое, что видит кладовщик: идёт ли она и сколько
        принесёт при закрытии. */}
    {isStorekeeper && (
      <MyShiftCard me={myShiftStatus} loading={shiftsLoading} />
    )}

    {/* Решения склада, которые стоят денег, — сразу перед виджетами: админ видит их
        первыми, ещё до сводки по цеху. */}
    {userRole === 'admin' && <AdminNotifications />}
    {/* Накладные на подпись: без подписи машина не выедет, а сам документ лежит
        в карточке поставки, куда руководитель не заходит. Держим на виду. */}
    {userRole === 'admin' && <EtrnToSignCard />}
    {/* Покупки за варики: сотрудник заплатил и ждёт купон — заявка не должна
        потеряться, поэтому висит на панели, пока админ не прикрепит PDF. */}
    {userRole === 'admin' && <VarikiPurchasesCard />}

    {/* Бонусная программа: швея видит СВОЙ прогресс к премии, руководство — всех.
        Остальным ролям карточка не нужна: программа только для швей. */}
    {/* Швее — открыто и всегда: свой прогресс к премии она смотрит каждую смену,
        прятать его под клик нельзя. Админу это отчёт по всем сразу, он длинный
        и нужен раз в период — сворачиваем. */}
    {isSewer && (
      <>
        {/* Акция дня — выше месячной премии: её цель нужно взять до конца смены,
            поэтому она важнее для решений «здесь и сейчас». */}
        <SewerDailyCard onlyUserId={userId} />
        <SewerBonusCard onlyUserId={userId} />
      </>
    )}
    {/* Выработка по всем швеям админу здесь БОЛЬШЕ НЕ ПОКАЗЫВАЕТСЯ: она уехала
        во вкладку «Выработка» блока «Люди и результат» ниже, к эффективности и
        лототрону. Там акция дня и премия месяца стоят в одной таблице, а не
        двумя списками одних и тех же фамилий подряд. */}
  </>
);

export default CrmDashboardHeader;