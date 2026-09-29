import { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSection } from '@/components/ui/form-section';
import type { SupplierFormState } from '@/components/crm/suppliers/supplierCard/supplierCardShared';

interface SupplierContactsSectionProps {
  form: SupplierFormState;
  setForm: Dispatch<SetStateAction<SupplierFormState>>;
  defaultOpen: boolean;
}

/** Контакты поставщика: название, телефон, адрес и комментарий. */
const SupplierContactsSection = ({
  form,
  setForm,
  defaultOpen,
}: SupplierContactsSectionProps) => (
  <FormSection
    title="Контакты"
    hint={form.phone || form.address || undefined}
    defaultOpen={defaultOpen}
  >
    <div className="space-y-1.5">
      <Label>Название</Label>
      <Input
        className="h-11 sm:h-10"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
      />
    </div>
    <div className="space-y-1.5">
      <Label>Телефон</Label>
      <Input
        type="tel"
        inputMode="tel"
        className="h-11 sm:h-10"
        value={form.phone}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
      />
    </div>
    <div className="space-y-1.5">
      <Label>Адрес</Label>
      <Input
        className="h-11 sm:h-10"
        value={form.address}
        onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
      />
    </div>
    <div className="space-y-1.5">
      <Label>Комментарий</Label>
      <Input
        className="h-11 sm:h-10"
        value={form.comment}
        onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
      />
    </div>
  </FormSection>
);

export default SupplierContactsSection;
