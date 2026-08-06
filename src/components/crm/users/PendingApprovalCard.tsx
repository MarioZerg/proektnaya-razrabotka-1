import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';

const roleIcons: Record<Role, string> = {
  admin: 'ShieldCheck',
  storekeeper: 'Warehouse',
  sewer: 'Shirt',
  cutter: 'Scissors',
  packer: 'PackageCheck',
  cleaner: 'Sparkles',
  manager: 'Briefcase',
};

interface PendingApprovalCardProps {
  employee: Employee;
  /** Должность, которую человек запросил и которая ждёт решения администратора. */
  role: Role;
  busy: boolean;
  onApprove: (employee: Employee, role: Role) => void;
  onReject: (employee: Employee, role: Role) => void;
}

/** Карточка новичка, ожидающего утверждения должности. Показывает, кем человек
 * представился, его почту и телефон — по ним администратор узнаёт сотрудника и решает,
 * впускать ли его в систему. */
const PendingApprovalCard = ({
  employee,
  role,
  busy,
  onApprove,
  onReject,
}: PendingApprovalCardProps) => {
  const registeredAt = new Date(employee.createdAt).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-4">
        {employee.avatarUrl ? (
          <img
            src={employee.avatarUrl}
            alt={employee.fullName}
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <Icon name="User" size={22} />
          </div>
        )}

        <div className="min-w-[180px] flex-1">
          <p className="text-base font-semibold">{employee.fullName}</p>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {employee.phone && (
              <span className="flex items-center gap-1">
                <Icon name="Phone" size={13} />
                {employee.phone}
              </span>
            )}
            {employee.email && (
              <span className="flex items-center gap-1">
                <Icon name="Mail" size={13} />
                {employee.email}
              </span>
            )}
            {employee.registeredViaMax && (
              <Badge variant="secondary" className="gap-1 font-normal">
                <Icon name="MessageCircle" size={12} />
                MAX
              </Badge>
            )}
          </div>

          <p className="mt-1 text-xs text-muted-foreground">Заявка от {registeredAt}</p>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          <Icon name={roleIcons[role] || 'User'} size={18} />
          <div>
            <p className="text-[11px] uppercase tracking-wide opacity-70">Просит должность</p>
            <p className="font-semibold leading-tight">{roleLabels[role] || role}</p>
          </div>
        </div>

        <div className="flex flex-1 justify-end gap-2">
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={busy}
            onClick={() => onReject(employee, role)}
          >
            <Icon name="X" size={16} className="mr-1.5" />
            Отклонить
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={busy}
            onClick={() => onApprove(employee, role)}
          >
            <Icon name={busy ? 'Loader2' : 'Check'} size={16} className={`mr-1.5 ${busy ? 'animate-spin' : ''}`} />
            Подтвердить
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PendingApprovalCard;
