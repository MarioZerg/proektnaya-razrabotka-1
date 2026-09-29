import type { Supplier } from '@/lib/suppliersApi';

export interface SupplierFormState {
  name: string;
  phone: string;
  address: string;
  comment: string;
  currency: string;
  exchangeRate: string;
  shortageNormPercent: string;
}

export const emptyForm: SupplierFormState = {
  name: '',
  phone: '',
  address: '',
  comment: '',
  currency: 'RUB',
  exchangeRate: '',
  shortageNormPercent: '',
};

export interface PriceRow {
  price: string;
  currency: string;
}

export const formFromSupplier = (s: Supplier): SupplierFormState => ({
  name: s.name,
  phone: s.phone || '',
  address: s.address || '',
  comment: s.comment || '',
  currency: s.currency || 'RUB',
  exchangeRate: s.exchangeRate != null ? String(s.exchangeRate) : '',
  shortageNormPercent: s.shortageNormPercent != null ? String(s.shortageNormPercent) : '',
});

export const payloadFromForm = (form: SupplierFormState) => ({
  name: form.name,
  phone: form.phone,
  address: form.address,
  comment: form.comment,
  currency: form.currency,
  exchangeRate:
    form.currency === 'RUB' || !form.exchangeRate.trim()
      ? null
      : Number(form.exchangeRate.replace(',', '.')),
  shortageNormPercent: form.shortageNormPercent.trim()
    ? Number(form.shortageNormPercent.replace(',', '.'))
    : null,
});

export const rublesOf = (row: PriceRow | undefined, rate: number | null) => {
  const value = Number((row?.price || '').replace(',', '.'));
  const cur = row?.currency || 'RUB';
  if (!value) return null;
  if (cur === 'RUB') return value;
  if (!rate) return null;
  return value * rate;
};
