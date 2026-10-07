import { Navigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import CrmDashboardHeader from '@/components/crm/dashboard/CrmDashboardHeader';
import CrmDashboardSections from '@/components/crm/dashboard/CrmDashboardSections';
import { useCrmDashboardData } from '@/components/crm/dashboard/useCrmDashboardData';

const CrmDashboard = () => {
  const {
    user,
    isAdmin,
    isSewer,
    isPacker,
    isStorekeeper,
    canSeeShiftCalendar,
    canSeeFboBoard,
    canSeeWorkingToday,
    dataLoading,
    summaryError,
    loadSummary,
    loadShifts,
    shiftsLoading,
    shiftsError,
    employeeShifts,
    togglingId,
    allShifts,
    selectedDate,
    setSelectedDate,
    calendarDays,
    myShiftStatus,
    widgets,
    handleToggleShift,
    handleSwitchShift,
    handleToggleFree,
  } = useCrmDashboardData();

  const content = (
    <div className="space-y-5 md:space-y-8">
      <CrmDashboardHeader
        userName={user?.name}
        userId={user?.id}
        userRole={user?.role}
        isSewer={isSewer}
        isPacker={isPacker}
        isStorekeeper={isStorekeeper}
        myShiftStatus={myShiftStatus}
        shiftsLoading={shiftsLoading}
        shiftsError={shiftsError}
        onRetryShifts={loadShifts}
      />

      <CrmDashboardSections
        userId={user?.id}
        isAdmin={isAdmin}
        canSeeLiveFloor={isStorekeeper}
        canSeeWorkingToday={canSeeWorkingToday}
        canSeeFboBoard={canSeeFboBoard}
        canSeeShiftCalendar={canSeeShiftCalendar}
        widgets={widgets}
        dataLoading={dataLoading}
        summaryError={summaryError}
        onRetrySummary={loadSummary}
        employeeShifts={employeeShifts}
        allShifts={allShifts}
        shiftsLoading={shiftsLoading}
        shiftsError={shiftsError}
        onRetryShifts={loadShifts}
        togglingId={togglingId}
        onToggleShift={handleToggleShift}
        onSwitchShift={handleSwitchShift}
        onToggleFree={handleToggleFree}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        calendarDays={calendarDays}
      />
    </div>
  );

  // У бухгалтера дашборда нет: главная собрана из плиток про смены, подбор и
  // поставки — для него это пустой экран. Ведём сразу на его единственную
  // страницу, чтобы вход не упирался в «ничего не найдено».
  if (user?.role === 'accountant') {
    return <Navigate to="/crm/shipments/accountant-supplies" replace />;
  }

  if (user && user.availableRoles.length === 0) {
    return (
      <CrmLayout>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">Главная</h1>
          <p className="text-sm text-muted-foreground">
            Добро пожаловать, {user.name}. Ваша должность ещё не утверждена администратором —
            как только это произойдёт, вам откроется доступ к разделам системы.
          </p>
        </div>
      </CrmLayout>
    );
  }

  return <CrmLayout>{content}</CrmLayout>;
};

export default CrmDashboard;