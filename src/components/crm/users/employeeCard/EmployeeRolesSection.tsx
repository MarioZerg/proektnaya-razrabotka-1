import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import {
  roleOptions,
  workshopOptions,
  type CardFormState,
} from '@/components/crm/users/usersShared';

interface EmployeeRolesSectionProps {
  cardEmployee: Employee;
  cardForm: CardFormState;
  setCardForm: Dispatch<SetStateAction<CardFormState | null>>;
  onApproveRole: (role: Role) => void;
  onAddRole: (role: Role) => void;
  onRemoveRole: (role: Role) => void;
  roleActionLoading: boolean;
  workHint?: string;
}

/** Должность и цех: основная роль, допуск к оверлоку и список должностей. */
const EmployeeRolesSection = ({
  cardEmployee,
  cardForm,
  setCardForm,
  onApproveRole,
  onAddRole,
  onRemoveRole,
  roleActionLoading,
  workHint,
}: EmployeeRolesSectionProps) => {
  const employeeRoles = cardEmployee.roles || [];
  // Шьёт ли человек вообще: должность в карточке или утверждённая вторая должность.
  // От этого зависит, показывать ли допуск к оверлоку.
  const canSew =
    cardForm.role === 'sewer' ||
    employeeRoles.some((r) => r.role === 'sewer' && r.isApproved);
  const addableRoles = roleOptions.filter((r) => !employeeRoles.some((er) => er.role === r));

  return (
    <FormSection title="Должность и цех" hint={workHint}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Роль</Label>
          <Select
            value={cardForm.role}
            onValueChange={(v) => setCardForm((f) => f && { ...f, role: v as Role })}
          >
            <SelectTrigger className="h-11 min-w-0 text-base sm:h-10 sm:text-sm [&>span]:min-w-0 [&>span]:flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabels[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Цех</Label>
          <Select
            value={cardForm.workshop || 'none'}
            onValueChange={(v) => setCardForm((f) => f && { ...f, workshop: v === 'none' ? '' : v })}
          >
            <SelectTrigger className="h-11 min-w-0 text-base sm:h-10 sm:text-sm [&>span]:min-w-0 [&>span]:flex-1">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {workshopOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {canSew && (
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border p-3">
          <Checkbox
            checked={cardForm.canOverlock}
            onCheckedChange={(v) =>
              setCardForm((f) => f && { ...f, canOverlock: v === true })
            }
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">Допуск к работе на оверлоке</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Видит на конвейере вкладку «Оверлок» и берёт оттуда заказы на
              обмётку края
            </span>
          </span>
        </label>
      )}

      <div className="space-y-2">
        <Label>Должности</Label>
        {employeeRoles.length === 0 ? (
          <p className="text-xs text-muted-foreground">У сотрудника пока нет должностей.</p>
        ) : (
          <div className="space-y-2">
            {employeeRoles.map((r) => (
              <div key={r.role} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm">{roleLabels[r.role]}</span>
                  {r.isApproved ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Утверждена
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-600">
                      Ждёт утверждения
                    </Badge>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {!r.isApproved && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-11 min-w-0 flex-1 sm:h-9 sm:flex-none"
                      disabled={roleActionLoading}
                      onClick={() => onApproveRole(r.role)}
                    >
                      Утвердить
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
                    disabled={roleActionLoading}
                    onClick={() => onRemoveRole(r.role)}
                    aria-label="Убрать должность"
                  >
                    <Icon name="X" size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {addableRoles.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => onAddRole(v as Role)}
            disabled={roleActionLoading}
          >
            <SelectTrigger className="h-11 min-w-0 text-base sm:h-9 sm:text-sm [&>span]:min-w-0 [&>span]:flex-1">
              <SelectValue placeholder="Добавить должность..." />
            </SelectTrigger>
            <SelectContent>
              {addableRoles.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabels[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </FormSection>
  );
};

export default EmployeeRolesSection;
