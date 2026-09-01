import { Dispatch, RefObject, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import VacationSection from '@/components/crm/users/VacationSection';
import { useToast } from '@/hooks/use-toast';
import { roleLabels, type Role } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import {
  formatDateTime,
  initials,
  readFileAsBase64,
  roleOptions,
  workshopOptions,
  type CardFormState,
} from '@/components/crm/users/usersShared';
import EmployeeKioskQr from '@/components/crm/users/EmployeeKioskQr';
import PersonalDataPanel from '@/components/crm/personal/PersonalDataPanel';
import DocsReadyBadges from '@/components/crm/users/DocsReadyBadges';

/** «1 день», «3 дня», «7 дней» — чтобы подпись читалась по-русски. */
const dayWord = (n: number) => {
  const last = n % 10;
  const twoLast = n % 100;
  if (twoLast >= 11 && twoLast <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
};

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
  /** Открыть зарплату досрочно, не дожидаясь двух недель. */
  onUnlockSalary: () => void;
  roleActionLoading: boolean;
  /** Кто открыл карточку — от него зависят права на сканы и проверку данных. */
  actorId?: number;
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
  onUnlockSalary,
  roleActionLoading,
  actorId,
}: EmployeeCardDialogProps) => {
  const { toast } = useToast();

  const employeeRoles = cardEmployee?.roles || [];
  // Шьёт ли человек вообще: должность в карточке или утверждённая вторая должность.
  // От этого зависит, показывать ли допуск к оверлоку.
  const canSew =
    cardForm?.role === 'sewer' ||
    employeeRoles.some((r) => r.role === 'sewer' && r.isApproved);
  const addableRoles = roleOptions.filter((r) => !employeeRoles.some((er) => er.role === r));

  return (
    <Dialog open={cardEmployee !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Карточка длинная (аватар, график, QR, должности) — ограничиваем высоту экраном
          и прокручиваем содержимое, иначе низ окна уезжает за край и кнопки не достать. */}
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto sm:max-w-lg">
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

            {/* Готовность к договору одной строкой: сканы, паспорт, номер для
                выплат. Подробности — ниже, в панели личных данных. */}
            <DocsReadyBadges emp={cardEmployee} />

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

            {/* Технические даты переехали сюда из списка: там они занимали два широких
                столбца и выдавливали кнопки правки за край экрана, а нужны редко —
                чтобы понять, когда человека завели и когда последний раз меняли. */}
            <p className="text-xs text-muted-foreground">
              Создан: {formatDateTime(cardEmployee.createdAt)} · Изменён:{' '}
              {formatDateTime(cardEmployee.updatedAt)}
            </p>

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

            {/* ДОПУСК К ОВЕРЛОКУ.
                Часть тканей сначала обмётывают, и делать это умеет не каждая швея.
                Отдельную должность не заводим: человек работает и на оверлоке, и на
                прямострочке, переключать роль в середине смены неудобно. Галочка
                показывается только тем, кто вообще шьёт, — упаковщице или кладовщику
                она не нужна и только мешала бы в карточке. */}
            {canSew && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3">
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

            {/* Выбор графика сам проставляет часы: 2/2 — цеховая смена 12 часов,
                5/2 — обычная пятидневка. Часы ниже можно поправить вручную. */}
            <div className="space-y-1.5">
              <Label>График работы</Label>
              <Select
                value={cardForm.workSchedule || 'none'}
                onValueChange={(v) =>
                  setCardForm((f) => {
                    if (!f) return f;
                    if (v === '2/2') {
                      return { ...f, workSchedule: v, shiftFrom: '07:00', shiftTo: '19:00' };
                    }
                    if (v === '5/2') {
                      return { ...f, workSchedule: v, shiftFrom: '08:00', shiftTo: '17:00' };
                    }
                    return { ...f, workSchedule: '' };
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Не задан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2/2">2/2 — смена 12 часов (07:00–19:00)</SelectItem>
                  <SelectItem value="5/2">5/2 — пятидневка (08:00–17:00)</SelectItem>
                  <SelectItem value="none">Не задан</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Часы работы</Label>
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
              <p className="mt-1.5 text-xs text-muted-foreground">
                «С» — во сколько сотрудник должен открыть смену
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Часов в смене</Label>
              <Input
                type="number"
                min={0}
                max={24}
                step="0.5"
                value={cardForm.workHours}
                onChange={(e) => setCardForm((f) => f && { ...f, workHours: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Отсчёт идёт от прихода: открыл смену в 6:05 при 12 часах — закроет в 18:05
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Допустимое опоздание, минут</Label>
              <Input
                type="number"
                min={0}
                value={cardForm.lateToleranceMinutes}
                onChange={(e) =>
                  setCardForm((f) => f && { ...f, lateToleranceMinutes: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Опоздание в пределах этого времени не штрафуется
              </p>
            </div>

            {/* Зарплата новичка закрыта первые 2 недели: человек осваивается, суммы
                скачут. Но опытного работника берут сразу в дело — ему выдержка не нужна,
                и админ открывает баланс досрочно. */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Icon
                  name={cardEmployee.salaryDaysLeft > 0 ? 'Lock' : 'LockOpen'}
                  size={16}
                  className={
                    cardEmployee.salaryDaysLeft > 0 ? 'text-amber-600' : 'text-emerald-600'
                  }
                />
                <Label className="cursor-default">Доступ к зарплате</Label>
              </div>
              {cardEmployee.salaryDaysLeft > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Закрыт ещё {cardEmployee.salaryDaysLeft}{' '}
                    {dayWord(cardEmployee.salaryDaysLeft)} — откроется сам. Если сотрудник
                    опытный и взят сразу в работу, можно открыть сейчас.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={roleActionLoading}
                    onClick={onUnlockSalary}
                  >
                    <Icon name="LockOpen" size={14} className="mr-1.5" />
                    Открыть зарплату сейчас
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Открыт — сотрудник видит свой баланс
                </p>
              )}
            </div>

            <EmployeeKioskQr
              employeeId={cardEmployee.id}
              fullName={cardEmployee.fullName}
              shiftNumber={cardEmployee.shiftNumber}
              workshop={cardEmployee.workshop}
            />

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

            {/* Документы, реквизиты для выплат и формирование договора по должности. */}
            {actorId && (
              <PersonalDataPanel
                userId={cardEmployee.id}
                actorId={actorId}
                isAdmin
                role={cardForm.role}
              />
            )}

            {/* Отпуска: две недели, дважды за рабочий год, и только один человек
                от смены одновременно. Показывается лишь тем должностям, кому положен. */}
            <VacationSection userId={cardEmployee.id} role={cardForm.role} />

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