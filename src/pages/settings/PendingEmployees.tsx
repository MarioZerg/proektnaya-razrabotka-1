import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  fetchEmployees,
  approveEmployeeRole,
  rejectEmployeeRole,
  type Employee,
} from '@/lib/usersApi';
import { roleLabels, type Role } from '@/lib/roles';
import PendingApprovalCard from '@/components/crm/users/PendingApprovalCard';
import ApproveWithPasswordDialog, {
  type IssuedCredentials,
} from '@/components/crm/users/ApproveWithPasswordDialog';

interface PendingRequest {
  employee: Employee;
  role: Role;
}

/** Заявки новых сотрудников: люди зарегистрировались сами через бота MAX или Telegram,
 * выбрали должность и ждут решения администратора. Пока должность не утверждена,
 * человек видит только экран ожидания и в систему не попадает. */
const PendingEmployees = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingRequest | null>(null);
  const [approveTarget, setApproveTarget] = useState<PendingRequest | null>(null);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);

  const load = () => {
    setLoading(true);
    fetchEmployees()
      .then((list) => {
        // Ждут решения те, у кого есть хотя бы одна неутверждённая должность и при этом
        // нет ни одной утверждённой — то есть человек ещё ни разу не получил доступ.
        const pending: PendingRequest[] = [];
        list.forEach((emp) => {
          const hasApproved = emp.roles.some((r) => r.isApproved);
          if (hasApproved) return;
          emp.roles
            .filter((r) => !r.isApproved)
            .forEach((r) => pending.push({ employee: emp, role: r.role }));
        });
        setRequests(pending);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleApprove = async (password: string) => {
    if (!approveTarget) return;
    const { employee, role } = approveTarget;
    setBusyId(employee.id);
    try {
      const res = await approveEmployeeRole(employee.id, role, password);
      setRequests((prev) => prev.filter((r) => r.employee.id !== employee.id));
      setIssued({
        fullName: employee.fullName,
        login: res.login || employee.login,
        password,
      });
      toast({
        title: 'Сотрудник допущен к работе',
        description: `${employee.fullName} — ${roleLabels[role] || role}`,
      });
    } catch (err) {
      toast({
        title: 'Не удалось подтвердить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    const { employee, role } = rejectTarget;
    setRejectTarget(null);
    setBusyId(employee.id);
    try {
      await rejectEmployeeRole(employee.id, role);
      setRequests((prev) => prev.filter((r) => r.employee.id !== employee.id));
      toast({ title: 'Заявка отклонена', description: `${employee.fullName} не получит доступ` });
    } catch (err) {
      toast({
        title: 'Не удалось отклонить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Новые сотрудники</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Люди зарегистрировались через бота и ждут, когда вы подтвердите их должность
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <Icon name={loading ? 'Loader2' : 'RefreshCw'} size={16} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Icon name="Loader2" size={18} className="animate-spin" />
            Загружаем заявки…
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
              <Icon name="CheckCheck" size={24} />
            </div>
            <div>
              <p className="font-semibold">Новых заявок нет</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Здесь появятся сотрудники, которые войдут через бота и выберут должность
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <PendingApprovalCard
                key={`${req.employee.id}-${req.role}`}
                employee={req.employee}
                role={req.role}
                busy={busyId === req.employee.id}
                onApprove={(emp, r) => setApproveTarget({ employee: emp, role: r })}
                onReject={(employee, role) => setRejectTarget({ employee, role })}
              />
            ))}
          </div>
        )}
      </div>

      <ApproveWithPasswordDialog
        employee={approveTarget?.employee ?? null}
        role={approveTarget?.role ?? null}
        saving={busyId === approveTarget?.employee.id}
        issued={issued}
        onClose={() => {
          setApproveTarget(null);
          setIssued(null);
        }}
        onApprove={handleApprove}
      />

      <AlertDialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отклонить заявку?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectTarget && (
                <>
                  {rejectTarget.employee.fullName} не получит доступ к системе. Учётная запись
                  останется в списке пользователей — вы сможете выдать доступ позже.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Отклонить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
};

export default PendingEmployees;
