import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { impersonateUser } from '@/lib/authApi';
import { useToast } from '@/hooks/use-toast';
import {
  fetchEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  addEmployeeRole,
  approveEmployeeRole,
  removeEmployeeRole,
  unlockEmployeeSalary,
  type Employee,
} from '@/lib/usersApi';
import type { Role } from '@/lib/roles';
import {
  emptyCreateForm,
  type CardFormState,
  type CreateFormState,
} from '@/components/crm/users/usersShared';
import CreateEmployeeDialog from '@/components/crm/users/CreateEmployeeDialog';
import EmployeesTable from '@/components/crm/users/EmployeesTable';
import EmployeeCardDialog from '@/components/crm/users/EmployeeCardDialog';
import DeleteEmployeeDialog from '@/components/crm/users/DeleteEmployeeDialog';

const UsersSettings = () => {
  const { toast } = useToast();
  const { user, impersonate } = useAuth();
  const navigate = useNavigate();
  const [enteringId, setEnteringId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [workshopFilter, setWorkshopFilter] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const createFileRef = useRef<HTMLInputElement>(null);

  const [cardEmployee, setCardEmployee] = useState<Employee | null>(null);
  const [cardForm, setCardForm] = useState<CardFormState | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const cardFileRef = useRef<HTMLInputElement>(null);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchEmployees()
      .then(setEmployees)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createForm.fullName.trim() || !createForm.email.trim() || !createForm.password.trim()) return;
    setCreating(true);
    try {
      const result = await createEmployee({
        fullName: createForm.fullName.trim(),
        email: createForm.email.trim(),
        role: createForm.role,
        password: createForm.password,
        workshop: createForm.workshop || undefined,
        avatarBase64: createForm.avatarBase64 || undefined,
      });
      setCreateOpen(false);
      load();
      toast({
        title: 'Сотрудник добавлен',
        description: `Логин для входа: ${result.login} — сообщите его сотруднику вместе с паролем`,
      });
    } catch (err) {
      toast({
        title: 'Не удалось добавить сотрудника',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  /**
   * Админ входит в аккаунт сотрудника, чтобы увидеть его рабочую панель.
   *
   * Пароль не нужен — права проверяет сервер. После входа приложение ведёт туда же,
   * куда попадает сам сотрудник, а сверху висит полоса с возвратом в свой аккаунт.
   */
  const handleImpersonate = async (emp: Employee) => {
    if (!user) return;
    setEnteringId(emp.id);
    try {
      const target = await impersonateUser(user.id, emp.id);
      impersonate({
        id: target.id,
        name: target.name,
        role: target.role,
        availableRoles: target.availableRoles,
        workshopId: target.workshopId,
        workshopName: target.workshopName,
        shiftNumber: target.shiftNumber,
      });
      navigate('/');
    } catch (e) {
      toast({
        title: 'Не удалось войти',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      });
    } finally {
      setEnteringId(null);
    }
  };

  const openCard = (emp: Employee) => {
    setCardEmployee(emp);
    setCardForm({
      fullName: emp.fullName,
      role: emp.role,
      workshop: emp.workshop || '',
      shiftFrom: emp.shiftFrom || '',
      shiftTo: emp.shiftTo || '',
      workSchedule: emp.workSchedule || '',
      lateToleranceMinutes: String(emp.lateToleranceMinutes ?? 15),
      workHours: emp.workHours != null ? String(emp.workHours) : '',
      newPassword: '',
      avatarBase64: '',
      maxUserId: emp.maxUserId || '',
    });
  };

  const closeCard = () => {
    setCardEmployee(null);
    setCardForm(null);
  };

  const handleCardSave = async () => {
    if (!cardEmployee || !cardForm) return;
    setCardSaving(true);
    try {
      await updateEmployee(cardEmployee.id, {
        fullName: cardForm.fullName.trim(),
        role: cardForm.role,
        workshop: cardForm.workshop || '',
        shiftFrom: cardForm.shiftFrom || null,
        shiftTo: cardForm.shiftTo || null,
        workSchedule: cardForm.workSchedule || '',
        lateToleranceMinutes: Number(cardForm.lateToleranceMinutes) || 0,
        workHours: cardForm.workHours.trim() ? Number(cardForm.workHours) : null,
        maxUserId: cardForm.maxUserId.trim() || null,
        ...(cardForm.newPassword.trim() ? { password: cardForm.newPassword.trim() } : {}),
        ...(cardForm.avatarBase64 ? { avatarBase64: cardForm.avatarBase64 } : {}),
      });
      closeCard();
      load();
      toast({ title: 'Изменения сохранены' });
    } catch (err) {
      toast({
        title: 'Не удалось сохранить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setCardSaving(false);
    }
  };

  const [roleActionLoading, setRoleActionLoading] = useState(false);

  const handleApproveRole = async (role: Role) => {
    if (!cardEmployee) return;
    setRoleActionLoading(true);
    try {
      await approveEmployeeRole(cardEmployee.id, role);
      const updated = await fetchEmployees();
      setEmployees(updated);
      const fresh = updated.find((e) => e.id === cardEmployee.id);
      if (fresh) setCardEmployee(fresh);
      toast({ title: 'Должность утверждена' });
    } catch (err) {
      toast({
        title: 'Не удалось утвердить должность',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setRoleActionLoading(false);
    }
  };

  const handleAddRole = async (role: Role) => {
    if (!cardEmployee) return;
    setRoleActionLoading(true);
    try {
      await addEmployeeRole(cardEmployee.id, role, true);
      const updated = await fetchEmployees();
      setEmployees(updated);
      const fresh = updated.find((e) => e.id === cardEmployee.id);
      if (fresh) setCardEmployee(fresh);
      toast({ title: 'Должность добавлена' });
    } catch (err) {
      toast({
        title: 'Не удалось добавить должность',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setRoleActionLoading(false);
    }
  };

  // Опытного работника берут сразу в дело — двухнедельная выдержка ему ни к чему.
  const handleUnlockSalary = async () => {
    if (!cardEmployee) return;
    setRoleActionLoading(true);
    try {
      await unlockEmployeeSalary(cardEmployee.id);
      const updated = await fetchEmployees();
      setEmployees(updated);
      const fresh = updated.find((e) => e.id === cardEmployee.id);
      if (fresh) setCardEmployee(fresh);
      toast({
        title: 'Зарплата открыта',
        description: `${cardEmployee.fullName} уже видит свой баланс`,
      });
    } catch (err) {
      toast({
        title: 'Не удалось открыть зарплату',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setRoleActionLoading(false);
    }
  };

  const handleRemoveRole = async (role: Role) => {
    if (!cardEmployee) return;
    setRoleActionLoading(true);
    try {
      await removeEmployeeRole(cardEmployee.id, role);
      const updated = await fetchEmployees();
      setEmployees(updated);
      const fresh = updated.find((e) => e.id === cardEmployee.id);
      if (fresh) setCardEmployee(fresh);
      toast({ title: 'Должность убрана' });
    } catch (err) {
      toast({
        title: 'Не удалось убрать должность',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setRoleActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteEmployee(deleteId);
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteId(null);
      toast({
        title: 'Не удалось удалить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    }
  };

  const q = search.trim().toLowerCase();

  const filtered = employees.filter((e) => {
    // Пока в поиске что-то есть, фильтры по должности и цеху не сужают выборку:
    // администратор ищет КОНКРЕТНОГО человека и не должен гадать, в каком он цехе.
    if (q) {
      const haystack = [e.fullName, e.login, e.email, e.phone, e.workshop]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    }
    if (roleFilter !== 'all' && e.role !== roleFilter) return false;
    if (workshopFilter !== 'all' && (e.workshop || '') !== workshopFilter) return false;
    return true;
  });

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

        <EmployeesTable
          loading={loading}
          filtered={filtered}
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
    </CrmLayout>
  );
};

export default UsersSettings;