import { Dispatch, RefObject, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { roleLabels, type Role } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import {
  initials,
  readFileAsBase64,
  roleOptions,
  workshopOptions,
  type CardFormState,
} from '@/components/crm/users/usersShared';

interface EmployeeCardDialogProps {
  cardEmployee: Employee | null;
  cardForm: CardFormState | null;
  setCardForm: Dispatch<SetStateAction<CardFormState | null>>;
  cardSaving: boolean;
  onClose: () => void;
  onSave: () => void;
  cardFileRef: RefObject<HTMLInputElement>;
  onApproveRole: (role: Role) => void;
  onAddRole: (role: Role) => void;
  onRemoveRole: (role: Role) => void;
  roleActionLoading: boolean;
}

const EmployeeCardDialog = ({
  cardEmployee,
  cardForm,
  setCardForm,
  cardSaving,
  onClose,
  onSave,
  cardFileRef,
  onApproveRole,
  onAddRole,
  onRemoveRole,
  roleActionLoading,
}: EmployeeCardDialogProps) => {
  const { toast } = useToast();

  const employeeRoles = cardEmployee?.roles || [];
  const addableRoles = roleOptions.filter((r) => !employeeRoles.some((er) => er.role === r));

  return (
    <Dialog open={cardEmployee !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Карточка сотрудника</DialogTitle>
        </DialogHeader>

        {cardForm && cardEmployee && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-16 w-16">
                {(cardForm.avatarBase64 || cardEmployee.avatarUrl) && (
                  <AvatarImage src={cardForm.avatarBase64 || cardEmployee.avatarUrl || ''} />
                )}
                <AvatarFallback>{initials(cardEmployee.fullName)}</AvatarFallback>
              </Avatar>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => cardFileRef.current?.click()}
                >
                  Сменить аватар
                </Button>
              </div>
              <input
                ref={cardFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const base64 = await readFileAsBase64(file);
                  setCardForm((f) => f && { ...f, avatarBase64: base64 });
                }}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2">
              <div>
                <p className="text-xs text-muted-foreground">Логин для входа</p>
                <p className="font-mono-tech text-sm font-semibold">{cardEmployee.login}</p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(cardEmployee.login);
                  toast({ title: 'Логин скопирован' });
                }}
              >
                <Icon name="Copy" size={14} />
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Имя</Label>
              <Input
                value={cardForm.fullName}
                onChange={(e) => setCardForm((f) => f && { ...f, fullName: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Роль</Label>
                <Select
                  value={cardForm.role}
                  onValueChange={(v) => setCardForm((f) => f && { ...f, role: v as Role })}
                >
                  <SelectTrigger>
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
                  <SelectTrigger>
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

            <div className="space-y-1.5">
              <Label>Заработная плата, ₽</Label>
              <Input
                type="number"
                min={0}
                value={cardForm.salary}
                onChange={(e) => setCardForm((f) => f && { ...f, salary: e.target.value })}
              />
            </div>

            <div>
              <Label>График — когда можно открыть смену</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">С</Label>
                  <Input
                    type="time"
                    value={cardForm.shiftFrom}
                    onChange={(e) => setCardForm((f) => f && { ...f, shiftFrom: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">До</Label>
                  <Input
                    type="time"
                    value={cardForm.shiftTo}
                    onChange={(e) => setCardForm((f) => f && { ...f, shiftTo: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Новый пароль</Label>
              <Input
                type="text"
                placeholder="Оставьте пустым, чтобы не менять"
                value={cardForm.newPassword}
                onChange={(e) => setCardForm((f) => f && { ...f, newPassword: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>MAX ID сотрудника</Label>
              <Input
                type="text"
                placeholder="Заполняется автоматически при входе через бота"
                value={cardForm.maxUserId}
                onChange={(e) => setCardForm((f) => f && { ...f, maxUserId: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {cardEmployee.phone
                  ? `Телефон, которым поделился сотрудник: ${cardEmployee.phone}`
                  : 'Заполняется автоматически, когда сотрудник делится номером телефона в боте MAX.'}
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>Должности</Label>
              {employeeRoles.length === 0 ? (
                <p className="text-xs text-muted-foreground">У сотрудника пока нет должностей.</p>
              ) : (
                <div className="space-y-2">
                  {employeeRoles.map((r) => (
                    <div key={r.role} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
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
                      <div className="flex items-center gap-1">
                        {!r.isApproved && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
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
                  <SelectTrigger className="h-9 text-sm">
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

            <Button
              onClick={onSave}
              disabled={cardSaving}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {cardSaving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EmployeeCardDialog;