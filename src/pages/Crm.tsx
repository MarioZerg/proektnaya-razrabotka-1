import CrmLayout from '@/components/crm/CrmLayout';
import CrmDashboardHeader from '@/components/crm/dashboard/CrmDashboardHeader';
import CrmDashboardSections from '@/components/crm/dashboard/CrmDashboardSections';
import { useCrmDashboardData } from '@/components/crm/dashboard/useCrmDashboardData';

const CrmDashboard = () => {
  const {
    user,
    isAdmin,
    isSewer,
    isStorekeeper,
    canSeeShiftCalendar,
    canSeeFboBoard,
    canSeeWorkingToday,
    dataLoading,
    shiftsLoading,
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
    <div className="space-y-8">
      <CrmDashboardHeader
        userName={user?.name}
        userId={user?.id}
        userRole={user?.role}
        isAdmin={isAdmin}
        isSewer={isSewer}
        isStorekeeper={isStorekeeper}
        myShiftStatus={myShiftStatus}
        shiftsLoading={shiftsLoading}
      />

      <CrmDashboardSections
        userId={user?.id}
        isAdmin={isAdmin}
        canSeeWorkingToday={canSeeWorkingToday}
        canSeeFboBoard={canSeeFboBoard}
        canSeeShiftCalendar={canSeeShiftCalendar}
        widgets={widgets}
        dataLoading={dataLoading}
        employeeShifts={employeeShifts}
        allShifts={allShifts}
        shiftsLoading={shiftsLoading}
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
