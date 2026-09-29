import { Dispatch, RefObject, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSection } from '@/components/ui/form-section';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import type { Employee } from '@/lib/usersApi';
import {
  formatDateTime,
  initials,
  readFileAsBase64,
  type CardFormState,
} from '@/components/crm/users/usersShared';
import DocsReadyBadges from '@/components/crm/users/DocsReadyBadges';

interface EmployeeProfileSectionProps {
  cardEmployee: Employee;
  cardForm: CardFormState;
  setCardForm: Dispatch<SetStateAction<CardFormState | null>>;
  cardFileRef: RefObject<HTMLInputElement>;
}

/** Профиль сотрудника: аватар, готовность документов, логин, имя и даты. */
const EmployeeProfileSection = ({
  cardEmployee,
  cardForm,
  setCardForm,
  cardFileRef,
}: EmployeeProfileSectionProps) => {
  const { toast } = useToast();

  return (
    <FormSection title="Профиль" hint={cardForm.fullName} defaultOpen>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-16 w-16 shrink-0">
          {(cardForm.avatarBase64 || cardEmployee.avatarUrl) && (
            <AvatarImage src={cardForm.avatarBase64 || cardEmployee.avatarUrl || ''} />
          )}
          <AvatarFallback>{initials(cardEmployee.fullName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto"
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

      <DocsReadyBadges emp={cardEmployee} />

      <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Логин для входа</p>
          <p className="truncate font-mono-tech text-sm font-semibold">{cardEmployee.login}</p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
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
          className="h-11 sm:h-10"
          value={cardForm.fullName}
          onChange={(e) => setCardForm((f) => f && { ...f, fullName: e.target.value })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Создан: {formatDateTime(cardEmployee.createdAt)} · Изменён:{' '}
        {formatDateTime(cardEmployee.updatedAt)}
      </p>
    </FormSection>
  );
};

export default EmployeeProfileSection;
