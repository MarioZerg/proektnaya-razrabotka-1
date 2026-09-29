import { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormSection } from '@/components/ui/form-section';
import type { CardFormState } from '@/components/crm/users/usersShared';

interface EmployeeScheduleSectionProps {
  cardForm: CardFormState;
  setCardForm: Dispatch<SetStateAction<CardFormState | null>>;
  scheduleHint?: string;
}

/** График: режим работы, часы смены и допустимое опоздание. */
const EmployeeScheduleSection = ({
  cardForm,
  setCardForm,
  scheduleHint,
}: EmployeeScheduleSectionProps) => (
  <FormSection title="График" hint={scheduleHint}>
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
        <SelectTrigger className="h-11 min-w-0 text-base sm:h-10 sm:text-sm [&>span]:min-w-0 [&>span]:flex-1">
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
      <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">С</Label>
          <Input
            type="time"
            className="h-11 min-w-0 sm:h-10"
            value={cardForm.shiftFrom}
            onChange={(e) => setCardForm((f) => f && { ...f, shiftFrom: e.target.value })}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">До</Label>
          <Input
            type="time"
            className="h-11 min-w-0 sm:h-10"
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
        inputMode="decimal"
        className="h-11 sm:h-10"
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
        inputMode="numeric"
        className="h-11 sm:h-10"
        value={cardForm.lateToleranceMinutes}
        onChange={(e) =>
          setCardForm((f) => f && { ...f, lateToleranceMinutes: e.target.value })
        }
      />
      <p className="text-xs text-muted-foreground">
        Опоздание в пределах этого времени не штрафуется
      </p>
    </div>
  </FormSection>
);

export default EmployeeScheduleSection;
