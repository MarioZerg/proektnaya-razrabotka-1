import DashboardWidgetsGrid from '@/components/crm/dashboard/DashboardWidgetsGrid';
import WorkingTodayCard from '@/components/crm/dashboard/WorkingTodayCard';
import ShiftManagementCard from '@/components/crm/dashboard/ShiftManagementCard';
import ShiftCalendarCard from '@/components/crm/dashboard/ShiftCalendarCard';
import LototronCard from '@/components/crm/dashboard/LototronCard';
import CollapsibleSection from '@/components/crm/dashboard/CollapsibleSection';
import ShortagePenaltyCard from '@/components/crm/dashboard/ShortagePenaltyCard';
import StaffEfficiencyCard from '@/components/crm/dashboard/StaffEfficiencyCard';
import FboShipmentsCard from '@/components/crm/dashboard/FboShipmentsCard';
import StalledShipmentsCard from '@/components/crm/dashboard/StalledShipmentsCard';
import { type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';
import {
  type EmployeeShiftStatus,
  type ShiftCalendarDay,
} from '@/lib/shiftSessionsApi';
import { type ShiftListItem } from '@/lib/shiftsApi';

interface CrmDashboardSectionsProps {
  userId?: number;
  isAdmin: boolean;
  canSeeWorkingToday: boolean;
  canSeeFboBoard: boolean;
  canSeeShiftCalendar: boolean;
  widgets: DashboardWidgetData[];
  dataLoading: boolean;
  employeeShifts: EmployeeShiftStatus[];
  allShifts: ShiftListItem[];
  shiftsLoading: boolean;
  togglingId: number | null;
  onToggleShift: (employee: EmployeeShiftStatus) => Promise<void>;
  onSwitchShift: (employeeId: number, shiftId: number) => Promise<void>;
  onToggleFree: (employeeId: number, shiftFree: boolean) => Promise<void>;
  selectedDate: Date | undefined;
  onSelectDate: (date: Date | undefined) => void;
  calendarDays: ShiftCalendarDay[];
}

/**
 * Основная часть главной: плитки, отчёты администратора, отгрузки и смены.
 *
 * Вынесено из страницы 1:1 — тот же порядок блоков и те же условия показа.
 */
const CrmDashboardSections = ({
  userId,
  isAdmin,
  canSeeWorkingToday,
  canSeeFboBoard,
  canSeeShiftCalendar,
  widgets,
  dataLoading,
  employeeShifts,
  allShifts,
  shiftsLoading,
  togglingId,
  onToggleShift,
  onSwitchShift,
  onToggleFree,
  selectedDate,
  onSelectDate,
  calendarDays,
}: CrmDashboardSectionsProps) => (
  <>
    {/* Зависшие отправления — выше всего остального: маркетплейс уже ждёт эти
        заказы, а по ним никто не работает. Видят те, кто может это разобрать:
        администратор и склад. Пусто — блок не рисуется. */}
    {canSeeFboBoard && <StalledShipmentsCard />}

    {widgets.length > 0 && <DashboardWidgetsGrid widgets={widgets} loading={dataLoading} />}

    {canSeeWorkingToday && <WorkingTodayCard />}

    {/* Эффективность цеха: кто сколько сделал, с каким темпом и с каким браком.
        Только администратору — это оценка людей, а не рабочий инструмент смены. */}
    {isAdmin && (
      <CollapsibleSection
        storageKey="efficiency"
        title="Эффективность сотрудников"
        hint="Выработка, темп и возвраты по швеям, закройщикам и упаковщикам"
        icon="TrendingUp"
      >
        <StaffEfficiencyCard />
      </CollapsibleSection>
    )}

    {/* Лототрон стоит сразу за эффективностью: оба блока про людей и их
        результат, админ смотрит их в одном заходе. */}
    {isAdmin && (
      <CollapsibleSection
        storageKey="lototron"
        title="Лототрон"
        hint="Розыгрыш и списание вариков"
        icon="Coins"
      >
        <LototronCard actorId={userId} />
      </CollapsibleSection>
    )}

    {/* Недостача в закрытых рулонах: администратор решает, удерживать ли деньги
        с сотрудников или списать на поставщика. Карточка сама скрывается, когда
        нерассмотренных рулонов нет. */}
    {isAdmin && <ShortagePenaltyCard />}

    {/* Отгрузки FBO: путь поставки от сборки до сдачи на воротах маркетплейса.
        Нужен тем, кто отвечает за отгрузку — складу, менеджеру и администратору. */}
    {canSeeFboBoard && <FboShipmentsCard />}

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {isAdmin ? (
        <>
          <ShiftManagementCard
            employees={employeeShifts}
            shifts={allShifts}
            loading={shiftsLoading}
            togglingId={togglingId}
            onToggle={onToggleShift}
            onSwitchShift={onSwitchShift}
            onToggleFree={onToggleFree}
          />
          <ShiftCalendarCard
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
            days={calendarDays}
          />
        </>
      ) : canSeeShiftCalendar ? (
        // Кладовщик и менеджер: график смен по календарю. Открытие и закрытие смены
        // выполняется только на терминале в цехе (киоск).
        <div className="lg:col-span-5">
          <ShiftCalendarCard
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
            days={calendarDays}
          />
        </div>
      ) : null}
    </div>
  </>
);

export default CrmDashboardSections;