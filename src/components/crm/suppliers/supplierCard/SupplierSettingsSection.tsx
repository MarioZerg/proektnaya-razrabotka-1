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
import { CURRENCIES, currencySymbols } from '@/lib/suppliersApi';
import type { SupplierFormState } from '@/components/crm/suppliers/supplierCard/supplierCardShared';

interface SupplierSettingsSectionProps {
  form: SupplierFormState;
  setForm: Dispatch<SetStateAction<SupplierFormState>>;
  defaultOpen: boolean;
  settingsHint: string;
}

/** Настройки поставщика: валюта прайса, курс и допустимая недостача. */
const SupplierSettingsSection = ({
  form,
  setForm,
  defaultOpen,
  settingsHint,
}: SupplierSettingsSectionProps) => (
  <FormSection title="Настройки" hint={settingsHint} defaultOpen={defaultOpen}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <Label>Валюта прайса</Label>
        <Select
          value={form.currency}
          onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
        >
          <SelectTrigger className="h-11 min-w-0 [&>span]:min-w-0 [&>span]:flex-1 text-base sm:h-10 sm:text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c} {currencySymbols[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {form.currency !== 'RUB' && (
        <div className="min-w-0 space-y-1.5">
          <Label>
            Рублей за 1 {currencySymbols[form.currency] || form.currency}
          </Label>
          <Input
            inputMode="decimal"
            placeholder="65"
            className="h-11 min-w-0 sm:h-10"
            value={form.exchangeRate}
            onChange={(e) => setForm((f) => ({ ...f, exchangeRate: e.target.value }))}
          />
        </div>
      )}
    </div>
    {form.currency !== 'RUB' && (
      <p className="text-xs text-muted-foreground">
        Курс подставится при приёмке — администратор сможет поправить его под
        реальный курс дня.
      </p>
    )}
    <div className="space-y-1.5">
      <Label>Допустимая недостача в рулоне, %</Label>
      <Input
        inputMode="decimal"
        placeholder="Не задана — штрафов нет"
        className="h-11 sm:h-10"
        value={form.shortageNormPercent}
        onChange={(e) =>
          setForm((f) => ({ ...f, shortageNormPercent: e.target.value }))
        }
      />
      <p className="text-xs text-muted-foreground">
        Сколько метров может не хватить в рулоне без штрафа. Например, 2% — в
        рулоне 100 м допустимо 2 м недостачи. За превышение сотрудники платят
        по себестоимости рулона. Оставьте пустым, чтобы не штрафовать.
      </p>
    </div>
  </FormSection>
);

export default SupplierSettingsSection;
