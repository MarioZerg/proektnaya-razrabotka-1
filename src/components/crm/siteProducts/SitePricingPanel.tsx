import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { saveSitePricing, type SitePricing } from '@/lib/siteOrdersApi';

interface Props {
  pricing: SitePricing;
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onSaved: (p: SitePricing) => void;
}

const FIELDS: { key: keyof SitePricing; label: string; suffix: string }[] = [
  { key: 'targetProfitPct', label: 'Чистая прибыль', suffix: '% от цены' },
  { key: 'taxPct', label: 'Налог УСН', suffix: '% от цены' },
  { key: 'acquiringPct', label: 'Эквайринг', suffix: '% от цены' },
  { key: 'deliveryRub', label: 'Доставка за наш счёт', suffix: '₽ с заказа' },
  { key: 'bloggerPct', label: 'Блогеру', suffix: '% от цены' },
];

/** Из чего считается цена на сайте: прибыль от цены, а не от себестоимости. */
const SitePricingPanel = ({ pricing, canEdit, actor, onSaved }: Props) => {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(pricing[f.key])])));
  }, [pricing]);

  const changed = FIELDS.some((f) => Number(form[f.key]?.replace(',', '.')) !== pricing[f.key]);

  const save = async () => {
    const next = Object.fromEntries(
      FIELDS.map((f) => [f.key, Number((form[f.key] || '0').replace(',', '.'))])
    ) as unknown as SitePricing;
    setSaving(true);
    try {
      const saved = await saveSitePricing(next, actor);
      toast({ title: 'Настройки цен сохранены' });
      onSaved(saved);
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon name="Calculator" size={16} />
        Расчёт цены
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Чистая прибыль = цена витрины − доля блогера − налог − эквайринг − доставка − себестоимость.
        Рекомендуемая цена закладывает долю блогера: заданный % остаётся нам даже при продаже по его
        ссылке, без блогера прибыль выше.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              inputMode="decimal"
              value={form[f.key] ?? ''}
              disabled={!canEdit}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              className="h-8"
            />
            <p className="text-[11px] text-muted-foreground">{f.suffix}</p>
          </div>
        ))}
      </div>
      {canEdit && changed && (
        <Button size="sm" className="mt-3" onClick={save} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      )}
    </div>
  );
};

export default SitePricingPanel;
