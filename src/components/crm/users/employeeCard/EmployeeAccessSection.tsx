import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';
import type { CardFormState } from '@/components/crm/users/usersShared';
import EmployeeKioskQr from '@/components/crm/users/EmployeeKioskQr';

/** «1 день», «3 дня», «7 дней» — чтобы подпись читалась по-русски. */
const dayWord = (n: number) => {
  const last = n % 10;
  const twoLast = n % 100;
  if (twoLast >= 11 && twoLast <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
};

interface EmployeeAccessSectionProps {
  cardEmployee: Employee;
  cardForm: CardFormState;
  setCardForm: Dispatch<SetStateAction<CardFormState | null>>;
  onUnlockSalary: () => void;
  roleActionLoading: boolean;
}

/** Вход и зарплата: доступ к балансу, пароль, MAX ID и QR для киоска. */
const EmployeeAccessSection = ({
  cardEmployee,
  cardForm,
  setCardForm,
  onUnlockSalary,
  roleActionLoading,
}: EmployeeAccessSectionProps) => (
  <FormSection title="Вход и зарплата" hint="Пароль, MAX, QR">
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
            className="h-11 w-full sm:h-9"
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

    <div className="space-y-1.5">
      <Label>Новый пароль</Label>
      <Input
        type="text"
        className="h-11 sm:h-10"
        placeholder="Оставьте пустым, чтобы не менять"
        value={cardForm.newPassword}
        onChange={(e) => setCardForm((f) => f && { ...f, newPassword: e.target.value })}
      />
    </div>

    <div className="space-y-1.5">
      <Label>MAX ID сотрудника</Label>
      <Input
        type="text"
        className="h-11 sm:h-10"
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

    <EmployeeKioskQr
      employeeId={cardEmployee.id}
      fullName={cardEmployee.fullName}
      shiftNumber={cardEmployee.shiftNumber}
      workshop={cardEmployee.workshop}
    />
  </FormSection>
);

export default EmployeeAccessSection;
