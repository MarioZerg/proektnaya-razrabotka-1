import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import {
  createSupplier,
  updateSupplier,
  setSupplierPrices,
  CURRENCIES,
  currencySymbols,
  type Supplier,
} from '@/lib/suppliersApi';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

export type SupplierFormSection = 'contacts' | 'settings' | 'prices';

interface SupplierFormState {
  name: string;
  phone: string;
  address: string;
  comment: string;
  currency: string;
  exchangeRate: string;
  shortageNormPercent: string;
}

const emptyForm: SupplierFormState = {
  name: '',
  phone: '',
  address: '',
  comment: '',
  currency: 'RUB',
  exchangeRate: '',
  shortageNormPercent: '',
};

interface PriceRow {
  price: string;
  currency: string;
}

const formFromSupplier = (s: Supplier): SupplierFormState => ({
  name: s.name,
  phone: s.phone || '',
  address: s.address || '',
  comment: s.comment || '',
  currency: s.currency || 'RUB',
  exchangeRate: s.exchangeRate != null ? String(s.exchangeRate) : '',
  shortageNormPercent: s.shortageNormPercent != null ? String(s.shortageNormPercent) : '',
});

const payloadFromForm = (form: SupplierFormState) => ({
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

const rublesOf = (row: PriceRow | undefined, rate: number | null) => {
  const value = Number((row?.price || '').replace(',', '.'));
  const cur = row?.currency || 'RUB';
  if (!value) return null;
  if (cur === 'RUB') return value;
  if (!rate) return null;
  return value * rate;
};


interface SupplierCardDialogProps {
  open: boolean;
  supplier: Supplier | null;
  focusSection?: SupplierFormSection;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Карточка поставщика: контакты, настройки и прайс в одной форме.
 *
 * Раньше прайс открывался отдельным окном, а валюта с недостачей — ещё одним.
 * На телефоне это два длинных экрана подряд. Здесь блоки сворачиваются,
 * одна кнопка «Сохранить» пишет и карточку, и цены.
 */
const SupplierCardDialog = ({
  open,
  supplier,
  focusSection = 'contacts',
  onClose,
  onSaved,
}: SupplierCardDialogProps) => {
  const { toast } = useToast();
  const { busy: saving, run } = useSubmitGuard();
  const [form, setForm] = useState<SupplierFormState>(
    () => (supplier ? formFromSupplier(supplier) : emptyForm),
  );
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [rows, setRows] = useState<Record<number, PriceRow>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [pricesReady, setPricesReady] = useState(false);
  const [search, setSearch] = useState('');

  const rate = form.exchangeRate.trim()
    ? Number(form.exchangeRate.replace(',', '.')) || null
    : null;

  useEffect(() => {
    if (!open) return;
    setForm(supplier ? formFromSupplier(supplier) : emptyForm);
    setSearch('');
    setRows({});
    setPricesReady(false);
    setPricesError(null);
  }, [open, supplier]);

  const loadPrices = () => {
    if (!supplier) return;
    setPricesLoading(true);
    fetchMaterialsData()
      .then(({ materials: list, types: typeList }) => {
        setPricesError(null);
        const active = list.filter((m) => m.status === 'active');
        setMaterials(active);
        setTypes(typeList);
        const existing: Record<number, PriceRow> = {};
        for (const m of active) {
          const saved = supplier.prices?.find((p) => p.materialId === m.id);
          existing[m.id] = {
            price: saved ? String(saved.price) : '',
            currency: saved?.currency || supplier.currency || 'RUB',
          };
        }
        setRows(existing);
        setPricesReady(true);
      })
      .catch((e) => {
        setPricesError(e instanceof Error ? e.message : 'Не удалось загрузить материалы');
        setPricesReady(false);
      })
      .finally(() => setPricesLoading(false));
  };

  useEffect(() => {
    if (!open || !supplier) return;
    loadPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = q
      ? materials.filter((m) => m.name.toLowerCase().includes(q))
      : materials;
    const byType = types
      .map((t) => ({
        type: t,
        items: visible.filter((m) => m.typeId === t.id),
      }))
      .filter((g) => g.items.length > 0);
    const typedIds = new Set(types.map((t) => t.id));
    const other = visible.filter((m) => !typedIds.has(m.typeId));
    if (other.length) {
      byType.push({ type: { id: 0, name: 'Прочее', sortOrder: 999 }, items: other });
    }
    return byType;
  }, [materials, types, search]);

  const filledCount = Object.values(rows).filter((r) => r.price.trim() !== '').length;

  const settingsHint = (() => {
    const parts: string[] = [];
    if (!form.currency || form.currency === 'RUB') {
      parts.push('Рубли');
    } else if (form.exchangeRate.trim()) {
      parts.push(`1 ${currencySymbols[form.currency] || form.currency} = ${form.exchangeRate} ₽`);
    } else {
      parts.push(`${form.currency} — нет курса`);
    }
    if (form.shortageNormPercent.trim()) {
      parts.push(`недостача ${form.shortageNormPercent}%`);
    }
    return parts.join(' · ');
  })();

  const handleSave = () =>
    run(async () => {
      if (!form.name.trim()) return;
      const payload = payloadFromForm(form);
      let supplierId = supplier?.id ?? null;

      if (pricesReady) {
        const prices = Object.entries(rows)
          .filter(([, r]) => r.price.trim() !== '')
          .map(([materialId, r]) => ({
            materialId: Number(materialId),
            price: Number(r.price.replace(',', '.')),
            currency: r.currency,
          }));
        if (prices.some((p) => Number.isNaN(p.price) || p.price < 0)) {
          toast({
            title: 'Проверьте цены',
            description: 'Цена должна быть числом не меньше нуля',
            variant: 'destructive',
          });
          return;
        }
        if (supplierId) {
          await updateSupplier(supplierId, payload);
          await setSupplierPrices(supplierId, prices);
        } else {
          const created = await createSupplier(payload);
          supplierId = Number(created?.id);
          if (supplierId) {
            await setSupplierPrices(supplierId, prices);
          }
        }
      } else if (supplierId) {
        await updateSupplier(supplierId, payload);
      } else {
        await createSupplier(payload);
      }

      onSaved();
      onClose();
    }).catch((err) => {
      toast({
        title: 'Не удалось сохранить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="relative z-20 shrink-0 border-b border-border bg-background px-4 pb-2 pt-4 pr-12">
          <DialogTitle>{supplier ? supplier.name : 'Новый поставщик'}</DialogTitle>
        </DialogHeader>

        <div
          key={`${supplier?.id ?? 'new'}-${focusSection}`}
          className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 [touch-action:pan-y]"
        >
          <FormSection
            title="Контакты"
            hint={form.phone || form.address || undefined}
            defaultOpen={focusSection === 'contacts' || !supplier}
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

          <FormSection
            title="Настройки"
            hint={settingsHint}
            defaultOpen={focusSection === 'settings' || !supplier}
          >
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

          <FormSection
            title="Прайс материалов"
            hint={
              supplier
                ? (pricesReady ? filledCount : supplier.prices?.length || 0)
                  ? `${pricesReady ? filledCount : supplier.prices.length} в прайсе`
                  : 'Прайс пуст'
                : 'После сохранения'
            }
            defaultOpen={focusSection === 'prices'}
          >
            {!supplier ? (
              <p className="text-sm text-muted-foreground">
                Сначала сохраните поставщика — затем можно указать цены материалов.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Цена за единицу. При приёмке подставится сама. Валютная цена
                  умножается на курс, рублёвая берётся как есть.
                </p>
                {rate ? (
                  <p className="text-sm">
                    Курс:{' '}
                    <b>
                      1 {currencySymbols[form.currency] || form.currency} = {rate} ₽
                    </b>
                  </p>
                ) : form.currency !== 'RUB' ? (
                  <p className="text-sm text-destructive">
                    Нет курса {form.currency} — валютные цены не пересчитаются в рубли.
                    Укажите курс в настройках.
                  </p>
                ) : null}

                {pricesLoading && materials.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Icon name="Loader2" size={16} className="animate-spin" />
                    Загрузка материалов…
                  </div>
                ) : pricesError && materials.length === 0 ? (
                  <WarehouseFetchError
                    title="Не удалось загрузить материалы"
                    description={pricesError}
                    onRetry={loadPrices}
                  />
                ) : (
                  <>
                    <div className="relative">
                      <Icon
                        name="Search"
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Найти материал"
                        className="h-11 pl-9 sm:h-10"
                      />
                    </div>
                    {grouped.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Ничего не нашли.</p>
                    ) : (
                      grouped.map((group) => (
                        <div key={group.type.id} className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {group.type.name}
                          </p>
                          {group.items.map((m) => {
                            const row = rows[m.id];
                            const rub = rublesOf(row, rate);
                            const cur = row?.currency || form.currency || 'RUB';
                            const value = Number((row?.price || '').replace(',', '.'));
                            return (
                              <div
                                key={m.id}
                                className="min-w-0 space-y-2 rounded-lg border border-border p-3"
                              >
                                <div>
                                  <p className="font-medium leading-snug">{m.name}</p>
                                  <p className="text-xs text-muted-foreground">за 1 {m.unit}</p>
                                </div>
                                <div className="grid min-w-0 grid-cols-[1fr_7.5rem] gap-2">
                                  <div className="relative min-w-0">
                                    <Input
                                      inputMode="decimal"
                                      placeholder="—"
                                      className="h-11 pr-7 sm:h-10"
                                      value={row?.price ?? ''}
                                      onChange={(e) =>
                                        setRows((prev) => ({
                                          ...prev,
                                          [m.id]: {
                                            price: e.target.value,
                                            currency: prev[m.id]?.currency || form.currency || 'RUB',
                                          },
                                        }))
                                      }
                                    />
                                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                      {currencySymbols[cur]}
                                    </span>
                                  </div>
                                  <Select
                                    value={cur}
                                    onValueChange={(v) =>
                                      setRows((prev) => ({
                                        ...prev,
                                        [m.id]: {
                                          price: prev[m.id]?.price || '',
                                          currency: v,
                                        },
                                      }))
                                    }
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
                                <p className="text-sm">
                                  {value ? (
                                    cur === 'RUB' ? (
                                      <span className="font-medium">{value.toFixed(2)} ₽</span>
                                    ) : rub != null ? (
                                      <span className="text-muted-foreground">
                                        ≈{' '}
                                        <span className="font-medium text-foreground">
                                          {rub.toFixed(2)} ₽
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="text-destructive">нужен курс</span>
                                    )
                                  ) : (
                                    <span className="text-muted-foreground">Нет цены</span>
                                  )}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </>
                )}
              </>
            )}
          </FormSection>
        </div>

        <div className="relative z-20 shrink-0 border-t border-border bg-background px-4 py-3">
          <Button
            onClick={() => {
              void handleSave();
            }}
            disabled={saving || !form.name.trim()}
            className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:h-10"
          >
            {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SupplierCardDialog;
