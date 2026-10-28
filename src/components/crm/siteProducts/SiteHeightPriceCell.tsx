import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setSitePrice, type SiteCatalogItem } from '@/lib/siteOrdersApi';

interface Props {
  item: SiteCatalogItem;
  /** Рекомендуемая цена этой высоты по её себестоимости. */
  recommended: number | null;
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onSaved: () => void;
}

const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

/** Цена одной высоты — отдельно от остальных высот ширины. */
const SiteHeightPriceCell = ({ item, recommended, canEdit, actor, onSaved }: Props) => {
  const { toast } = useToast();
  const [value, setValue] = useState(item.price != null ? String(item.price) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(item.price != null ? String(item.price) : '');
  }, [item.price]);

  const current = value.trim() ? Number(value.replace(',', '.')) : null;
  const changed = (current ?? null) !== (item.price ?? null);

  const save = async (price: number | null) => {
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      toast({ title: 'Цена должна быть больше нуля', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const r = await setSitePrice([item.id], price, actor);
      toast(
        r.pushed
          ? { title: `Цена ${item.width}×${item.height} отправлена на сайт` }
          : { title: 'Цена сохранена, на сайт не ушла', description: r.pushError || undefined, variant: 'destructive' }
      );
      onSaved();
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) return <span>{item.price != null ? rub(item.price) : '—'}</span>;

  return (
    <div className="flex items-center gap-1">
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && changed && save(current)}
        placeholder="Цена"
        className="h-7 w-20 text-xs"
      />
      {changed && (
        <Button size="sm" className="h-7 px-2" onClick={() => save(current)} disabled={saving}>
          <Icon name={saving ? 'Loader2' : 'Check'} size={12} className={saving ? 'animate-spin' : ''} />
        </Button>
      )}
      {recommended != null && recommended !== item.price && !changed && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save(recommended)}
          className="text-[11px] text-sky-700 hover:underline"
        >
          {rub(recommended)}
        </button>
      )}
    </div>
  );
};

export default SiteHeightPriceCell;
