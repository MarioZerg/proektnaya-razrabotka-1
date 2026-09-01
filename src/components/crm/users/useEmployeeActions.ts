import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { impersonateUser } from '@/lib/authApi';
import { useToast } from '@/hooks/use-toast';
import {
  createEmployee,
  deleteEmployee,
  archiveEmployee,
  unarchiveEmployee,
  type Employee,
} from '@/lib/usersApi';
import {
  emptyCreateForm,
  type CreateFormState,
} from '@/components/crm/users/usersShared';

interface UseEmployeeActionsArgs {
  /** Перезагрузить список после создания, удаления, увольнения и возврата. */
  load: () => void;
}

/**
 * Действия над сотрудником: приём, удаление, увольнение в архив, возврат к работе
 * и вход администратора в чужой аккаунт.
 */
export const useEmployeeActions = ({ load }: UseEmployeeActionsArgs) => {
  const { toast } = useToast();
  const { user, impersonate } = useAuth();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const createFileRef = useRef<HTMLInputElement>(null);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Employee | null>(null);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [enteringId, setEnteringId] = useState<number | null>(null);

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

  const handleArchive = async (reason: string) => {
    if (!archiveTarget) return;
    setArchiveSaving(true);
    try {
      await archiveEmployee(archiveTarget.id, reason, user?.id);
      toast({
        title: 'Сотрудник уволен',
        description: `${archiveTarget.fullName} перенесён в архив — история сохранена`,
      });
      setArchiveTarget(null);
      load();
    } catch (err) {
      toast({
        title: 'Не удалось уволить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setArchiveSaving(false);
    }
  };

  const handleUnarchive = async (employee: Employee) => {
    try {
      await unarchiveEmployee(employee.id);
      toast({
        title: 'Сотрудник вернулся к работе',
        description: `${employee.fullName} снова в списках и может войти в систему`,
      });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось вернуть',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    }
  };

  return {
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
  };
};
