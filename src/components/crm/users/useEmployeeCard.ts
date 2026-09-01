import { useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchEmployees,
  updateEmployee,
  addEmployeeRole,
  approveEmployeeRole,
  removeEmployeeRole,
  unlockEmployeeSalary,
  type Employee,
} from '@/lib/usersApi';
import type { Role } from '@/lib/roles';
import type { CardFormState } from '@/components/crm/users/usersShared';

interface UseEmployeeCardArgs {
  /** Обновить список сотрудников после действия с должностями. */
  setEmployees: (list: Employee[]) => void;
  /** Перезагрузить страницу целиком после сохранения карточки. */
  load: () => void;
}

/**
 * Карточка сотрудника: форма редактирования, сохранение и работа с должностями.
 *
 * После смены должностей список перечитывается целиком, и открытая карточка
 * подменяется свежей записью: иначе админ видел бы в ней прежний набор ролей и
 * нажимал бы вторую кнопку по устаревшим данным.
 */
export const useEmployeeCard = ({ setEmployees, load }: UseEmployeeCardArgs) => {
  const { toast } = useToast();
  const [cardEmployee, setCardEmployee] = useState<Employee | null>(null);
  const [cardForm, setCardForm] = useState<CardFormState | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const [roleActionLoading, setRoleActionLoading] = useState(false);
  const cardFileRef = useRef<HTMLInputElement>(null);

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
      canOverlock: !!emp.canOverlock,
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
        canOverlock: cardForm.canOverlock,
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

  return {
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
  };
};
