import DashboardWidgetsGrid from '@/components/crm/dashboard/DashboardWidgetsGrid';
import WorkingTodayCard from '@/components/crm/dashboard/WorkingTodayCard';
import ShiftManagementCard from '@/components/crm/dashboard/ShiftManagementCard';
import ShiftCalendarCard from '@/components/crm/dashboard/ShiftCalendarCard';
import FboShipmentsCard from '@/components/crm/dashboard/FboShipmentsCard';
import StalledShipmentsCard from '@/components/crm/dashboard/StalledShipmentsCard';
import LiveFloorCard from '@/components/crm/dashboard/liveFloor/LiveFloorCard';
import LiveFloorBoundary from '@/components/crm/dashboard/liveFloor/LiveFloorBoundary';
import ShortagePenaltyCard from '@/components/crm/dashboard/ShortagePenaltyCard';
import { type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';
import {
  type EmployeeShiftStatus,
  type ShiftCalendarDay,
} from '@/lib/shiftSessionsApi';
import { type ShiftListItem } from '@/lib/shiftsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

interface CrmDashboardSectionsProps {
  isAdmin: boolean;
  canSeeLiveFloor?: boolean;
  canSeeWorkingToday: boolean;
  canSeeFboBoard: boolean;
  canSeeShiftCalendar: boolean;
  widgets: DashboardWidgetData[];
  dataLoading: boolean;
  summaryError?: string | null;
  onRetrySummary?: () => void;
  employeeShifts: EmployeeShiftStatus[];
  allShifts: ShiftListItem[];
  shiftsLoading: boolean;
  shiftsError?: string | null;
  onRetryShifts?: () => void;
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
  isAdmin,
  canSeeLiveFloor = false,
  canSeeWorkingToday,
  canSeeFboBoard,
  canSeeShiftCalendar,
  widgets,
  dataLoading,
  summaryError = null,
  onRetrySummary,
  employeeShifts,
  allShifts,
  shiftsLoading,
  shiftsError = null,
  onRetryShifts,
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

    {summaryError && onRetrySummary && (
      <WarehouseFetchError
        title="Не удалось загрузить плитки главной"
        description={summaryError}
        onRetry={onRetrySummary}
      />
    )}

    {widgets.length > 0 && <DashboardWidgetsGrid widgets={widgets} loading={dataLoading} />}

    {/* Отгрузки FBO — сразу под плитками (последняя из них — рулоны с малым
        остатком). Нужны складу, менеджеру и администратору. */}
    {canSeeFboBoard && <FboShipmentsCard />}

    {/* Живой цех: админ и кладовщики — видят, как вещи движутся по цеху. */}
    {(isAdmin || canSeeLiveFloor) && (
      <LiveFloorBoundary>
        <LiveFloorCard />
      </LiveFloorBoundary>
    )}

    {canSeeWorkingToday && <WorkingTodayCard />}

    {/* Недостача в закрытых рулонах: администратор решает, удерживать ли деньги
        с сотрудников или списать на поставщика. Карточка сама скрывается, когда
        нерассмотренных рулонов нет. */}
    {isAdmin && <ShortagePenaltyCard />}

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {isAdmin ? (
        <>
          <ShiftManagementCard
            employees={employeeShifts}
            shifts={allShifts}
            loading={shiftsLoading}
            error={shiftsError}
            onRetry={onRetryShifts}
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