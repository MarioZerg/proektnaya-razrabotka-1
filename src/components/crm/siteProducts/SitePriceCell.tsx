import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setSitePrice, type SiteCatalogItem, type SitePricing } from '@/lib/siteOrdersApi';
import { recommendedPrice } from '@/lib/sitePricing';

interface Props {
  item: SiteCatalogItem;
  pricing: SitePricing;
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onSaved: () => void;
}

const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

/** Цена на сайте: вписывается вручную или берётся рекомендуемая. */
const SitePriceCell = ({ item, pricing, canEdit, actor, onSaved }: Props) => {
  const { toast } = useToast();
  const [value, setValue] = useState(item.price != null ? String(item.price) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(item.price != null ? String(item.price) : '');
  }, [item.price]);

  const current = value.trim() ? Number(value.replace(',', '.')) : null;
  const changed = (current ?? null) !== (item.price ?? null);
  const recommended = item.cost != null ? recommendedPrice(item.cost, pricing) : null;

  const save = async (price: number | null) => {
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      toast({ title: 'Цена должна быть больше нуля', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const r = await setSitePrice(item.id, price, actor);
      toast(
        r.pushed
          ? { title: 'Цена сохранена и отправлена на сайт' }
          : { title: 'Цена сохранена, на сайт не ушла', description: r.pushError || undefined, variant: 'destructive' }
      );
      onSaved();
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return <span>{item.price != null ? rub(item.price) : '—'}</span>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && changed && save(current)}
          placeholder="Цена"
          className="h-8 w-24"
        />
        {changed && (
          <Button size="sm" className="h-8 px-2" onClick={() => save(current)} disabled={saving}>
            <Icon name={saving ? 'Loader2' : 'Check'} size={14} className={saving ? 'animate-spin' : ''} />
          </Button>
        )}
      </div>
      {recommended != null && recommended !== item.price && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save(recommended)}
          className="w-fit text-left text-xs text-sky-700 hover:underline"
        >
          поставить {rub(recommended)}
        </button>
      )}
      {item.pushError && (
        <span className="text-xs text-red-600" title={item.pushError}>
          не ушло на сайт
        </span>
      )}
    </div>
  );
};

export default SitePriceCell;
