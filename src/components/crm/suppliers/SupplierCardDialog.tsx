import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import {
  createSupplier,
  updateSupplier,
  setSupplierPrices,
  currencySymbols,
  type Supplier,
} from '@/lib/suppliersApi';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import SupplierContactsSection from '@/components/crm/suppliers/supplierCard/SupplierContactsSection';
import SupplierSettingsSection from '@/components/crm/suppliers/supplierCard/SupplierSettingsSection';
import SupplierPricesSection from '@/components/crm/suppliers/supplierCard/SupplierPricesSection';
import {
  emptyForm,
  formFromSupplier,
  payloadFromForm,
  type PriceRow,
  type SupplierFormState,
} from '@/components/crm/suppliers/supplierCard/supplierCardShared';

export type SupplierFormSection = 'contacts' | 'settings' | 'prices';


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
          <SupplierContactsSection
            form={form}
            setForm={setForm}
            defaultOpen={focusSection === 'contacts' || !supplier}
          />

          <SupplierSettingsSection
            form={form}
            setForm={setForm}
            defaultOpen={focusSection === 'settings' || !supplier}
            settingsHint={settingsHint}
          />

          <SupplierPricesSection
            supplier={supplier}
            form={form}
            rate={rate}
            rows={rows}
            setRows={setRows}
            materials={materials}
            grouped={grouped}
            search={search}
            setSearch={setSearch}
            pricesLoading={pricesLoading}
            pricesError={pricesError}
            pricesReady={pricesReady}
            filledCount={filledCount}
            loadPrices={loadPrices}
            defaultOpen={focusSection === 'prices'}
          />
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
