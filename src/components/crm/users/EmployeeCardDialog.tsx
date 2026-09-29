import { Dispatch, RefObject, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import VacationSection from '@/components/crm/users/VacationSection';
import { roleLabels, type Role } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import type { CardFormState } from '@/components/crm/users/usersShared';
import PersonalDataPanel from '@/components/crm/personal/PersonalDataPanel';
import EmployeeProfileSection from '@/components/crm/users/employeeCard/EmployeeProfileSection';
import EmployeeRolesSection from '@/components/crm/users/employeeCard/EmployeeRolesSection';
import EmployeeScheduleSection from '@/components/crm/users/employeeCard/EmployeeScheduleSection';
import EmployeeAccessSection from '@/components/crm/users/employeeCard/EmployeeAccessSection';

const VACATION_ROLES = ['sewer', 'cutter', 'packer', 'storekeeper', 'senior_storekeeper', 'cleaner'];


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
  const scheduleHint = !cardForm
    ? undefined
    : cardForm.workSchedule === '2/2'
      ? '2/2 — 12 часов'
      : cardForm.workSchedule === '5/2'
        ? '5/2 — пятидневка'
        : 'График не задан';

  const workHint = cardForm
    ? [roleLabels[cardForm.role], cardForm.workshop].filter(Boolean).join(' · ')
    : undefined;

  return (
    <Dialog open={cardEmployee !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="relative z-20 shrink-0 border-b border-border bg-background px-4 pb-2 pt-4 pr-12">
          <DialogTitle>Карточка сотрудника</DialogTitle>
        </DialogHeader>

        {cardForm && cardEmployee && (
          <>
            <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-1 [touch-action:pan-y]">
              <EmployeeProfileSection
                cardEmployee={cardEmployee}
                cardForm={cardForm}
                setCardForm={setCardForm}
                cardFileRef={cardFileRef}
              />

              <EmployeeRolesSection
                cardEmployee={cardEmployee}
                cardForm={cardForm}
                setCardForm={setCardForm}
                onApproveRole={onApproveRole}
                onAddRole={onAddRole}
                onRemoveRole={onRemoveRole}
                roleActionLoading={roleActionLoading}
                workHint={workHint}
              />

              <EmployeeScheduleSection
                cardForm={cardForm}
                setCardForm={setCardForm}
                scheduleHint={scheduleHint}
              />

              <EmployeeAccessSection
                cardEmployee={cardEmployee}
                cardForm={cardForm}
                setCardForm={setCardForm}
                onUnlockSalary={onUnlockSalary}
                roleActionLoading={roleActionLoading}
              />

              {actorId && (
                <FormSection title="Документы" hint="Сканы, паспорт, выплаты">
                  <PersonalDataPanel
                    userId={cardEmployee.id}
                    actorId={actorId}
                    isAdmin
                    role={cardForm.role}
                  />
                </FormSection>
              )}

              {VACATION_ROLES.includes(cardForm.role) && (
                <FormSection title="Отпуск">
                  <VacationSection userId={cardEmployee.id} role={cardForm.role} />
                </FormSection>
              )}
            </div>

            <div className="relative z-20 shrink-0 border-t border-border bg-background px-4 py-3">
              <Button
                onClick={onSave}
                disabled={cardSaving}
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:h-10"
              >
                {cardSaving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EmployeeCardDialog;
