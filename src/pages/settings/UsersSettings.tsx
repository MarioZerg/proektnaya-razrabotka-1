import CrmLayout from '@/components/crm/CrmLayout';
import CreateEmployeeDialog from '@/components/crm/users/CreateEmployeeDialog';
import EmployeesTable from '@/components/crm/users/EmployeesTable';
import EmployeeCardDialog from '@/components/crm/users/EmployeeCardDialog';
import DeleteEmployeeDialog from '@/components/crm/users/DeleteEmployeeDialog';
import ArchiveEmployeeDialog from '@/components/crm/users/ArchiveEmployeeDialog';
import EmployeesTabsSwitch from '@/components/crm/users/EmployeesTabsSwitch';
import { useEmployeesData } from '@/components/crm/users/useEmployeesData';
import { useEmployeeCard } from '@/components/crm/users/useEmployeeCard';
import { useEmployeeActions } from '@/components/crm/users/useEmployeeActions';

const UsersSettings = () => {
  const {
    setEmployees,
    loading,
    load,
    roleFilter,
    setRoleFilter,
    search,
    setSearch,
    workshopFilter,
    setWorkshopFilter,
    tab,
    setTab,
    activeCount,
    archivedCount,
    filtered,
  } = useEmployeesData();

  const {
    user,
    createOpen,
    setCreateOpen,
    createForm,
    setCreateForm,
    creating,
    createFileRef,
    openCreate,
    handleCreate,
    deleteId,
    setDeleteId,
    handleDelete,
    archiveTarget,
    setArchiveTarget,
    archiveSaving,
    handleArchive,
    handleUnarchive,
    enteringId,
    handleImpersonate,
  } = useEmployeeActions({ load });

  const {
    cardEmployee,
    cardForm,
    setCardForm,
    cardSaving,
    cardFileRef,
    roleActionLoading,
    openCard,
    closeCard,
    handleCardSave,
    handleApproveRole,
    handleAddRole,
    handleRemoveRole,
    handleUnlockSalary,
  } = useEmployeeCard({ setEmployees, load });

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Пользователи</h1>

          <CreateEmployeeDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onTriggerClick={openCreate}
            createForm={createForm}
            setCreateForm={setCreateForm}
            creating={creating}
            onCreate={handleCreate}
            createFileRef={createFileRef}
          />
        </div>

        <EmployeesTabsSwitch
          tab={tab}
          setTab={setTab}
          activeCount={activeCount}
          archivedCount={archivedCount}
        />

        <EmployeesTable
          loading={loading}
          filtered={filtered}
          archiveView={tab === 'archived'}
          onArchiveRequest={setArchiveTarget}
          onUnarchive={handleUnarchive}
          roleFilter={roleFilter}
          setRoleFilter={setRoleFilter}
          workshopFilter={workshopFilter}
          setWorkshopFilter={setWorkshopFilter}
          search={search}
          setSearch={setSearch}
          onOpenCard={openCard}
          onDeleteRequest={setDeleteId}
          onImpersonate={handleImpersonate}
          enteringId={enteringId}
          currentUserId={user?.id}
        />
      </div>

      <EmployeeCardDialog
        cardEmployee={cardEmployee}
        cardForm={cardForm}
        setCardForm={setCardForm}
        cardSaving={cardSaving}
        onClose={closeCard}
        onSave={handleCardSave}
        cardFileRef={cardFileRef}
        onApproveRole={handleApproveRole}
        onAddRole={handleAddRole}
        onRemoveRole={handleRemoveRole}
        onUnlockSalary={handleUnlockSalary}
        roleActionLoading={roleActionLoading}
        actorId={user?.id}
      />

      <DeleteEmployeeDialog
        deleteId={deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        onConfirm={handleDelete}
      />

      <ArchiveEmployeeDialog
        employee={archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        onConfirm={handleArchive}
        saving={archiveSaving}
      />
    </CrmLayout>
  );
};

export default UsersSettings;
