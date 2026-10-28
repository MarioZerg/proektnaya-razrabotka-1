import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { saveSitePricing, type SitePricing } from '@/lib/siteOrdersApi';

interface Props {
  pricing: SitePricing;
  /** Ширины, которые есть в каталоге сайта. */
  widths: number[];
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onSaved: (p: SitePricing) => void;
}

const PCT_FIELDS = [
  { key: 'bloggerPct', label: 'Блогеру', suffix: '% от цены товара без доставки' },
  { key: 'taxPct', label: 'Налог УСН', suffix: '% от цены' },
  { key: 'acquiringPct', label: 'Эквайринг', suffix: '% от цены' },
] as const;

const BASE_WIDTHS = [200, 300, 400, 500, 600, 700, 800];

const num = (v: string) => Number((v || '0').replace(',', '.'));

/** Прибыль на каждую ширину в рублях и проценты, которые вычитаются из цены. */
const SitePricingPanel = ({ pricing, widths, canEdit, actor, onSaved }: Props) => {
  const { toast } = useToast();
  const [pct, setPct] = useState<Record<string, string>>({});
  const [byWidth, setByWidth] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const allWidths = useMemo(
    () =>
      [...new Set([...BASE_WIDTHS, ...widths, ...Object.keys(pricing.profitByWidth || {}).map(Number)])]
        .filter((w) => Number.isFinite(w) && w > 0)
        .sort((a, b) => a - b),
    [widths, pricing.profitByWidth]
  );

  useEffect(() => {
    setPct(Object.fromEntries(PCT_FIELDS.map((f) => [f.key, String(pricing[f.key])])));
    setByWidth(
      Object.fromEntries(
        Object.entries(pricing.profitByWidth || {}).map(([w, v]) => [w, String(v)])
      )
    );
  }, [pricing]);

  const changed =
    PCT_FIELDS.some((f) => num(pct[f.key]) !== pricing[f.key]) ||
    allWidths.some(
      (w) => (byWidth[String(w)] ?? '') !== String(pricing.profitByWidth?.[String(w)] ?? '')
    );

  const save = async () => {
    const profitByWidth = Object.fromEntries(
      Object.entries(byWidth)
        .filter(([, v]) => v.trim() !== '')
        .map(([w, v]) => [w, num(v)])
    );
    setSaving(true);
    try {
      const saved = await saveSitePricing(
        {
          profitByWidth,
          bloggerPct: num(pct.bloggerPct),
          taxPct: num(pct.taxPct),
          acquiringPct: num(pct.acquiringPct),
        },
        actor
      );
      toast({ title: 'Настройки цен сохранены' });
      onSaved(saved);
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon name="Calculator" size={16} />
        Расчёт цены
      </div>

      <div>
        <Label className="text-xs">Чистая прибыль со штуки по ширине, ₽</Label>
        <div className="mt-1 grid grid-cols-4 gap-2 sm:grid-cols-8">
          {allWidths.map((w) => {
            const inCatalog = widths.includes(w);
            return (
              <div key={w} className="space-y-0.5">
                <p className={`text-[11px] ${inCatalog ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                  {w} см
                </p>
                <Input
                  inputMode="decimal"
                  value={byWidth[String(w)] ?? ''}
                  disabled={!canEdit}
                  placeholder="—"
                  onChange={(e) => setByWidth((s) => ({ ...s, [String(w)]: e.target.value }))}
                  className="h-8"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {PCT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              inputMode="decimal"
              value={pct[f.key] ?? ''}
              disabled={!canEdit}
              onChange={(e) => setPct((s) => ({ ...s, [f.key]: e.target.value }))}
              className="h-8"
            />
            <p className="text-[11px] text-muted-foreground">{f.suffix}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Сколько рублей чистыми хотим с одной штуки каждой ширины — на все её высоты. Доля блогера
        заложена в цену сверху и нашу прибыль не трогает. Сайт прибавляет к цене доставку Ozon от
        Ярославля (ул. Елены Колесовой, 48) до города покупателя — с доставки блогер не получает.
        Жирным — ширины, которые есть в каталоге.
      </p>

      {canEdit && changed && (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      )}
    </div>
  );
};

export default SitePricingPanel;
