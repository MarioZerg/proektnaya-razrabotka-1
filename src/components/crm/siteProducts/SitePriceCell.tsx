import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setSitePrice, setSitePrices, type SitePricing } from '@/lib/siteOrdersApi';
import { recommendedPrice } from '@/lib/sitePricing';
import type { SiteWidthGroup } from '@/components/crm/siteProducts/siteWidthGroups';

interface Props {
  group: SiteWidthGroup;
  pricing: SitePricing;
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onSaved: () => void;
}

const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

/** Цена ширины: одна на все высоты, сохраняется и уходит на сайт сразу для всех. */
const SitePriceCell = ({ group, pricing, canEdit, actor, onSaved }: Props) => {
  const { toast } = useToast();
  const saved = typeof group.price === 'number' ? group.price : null;
  const [value, setValue] = useState(saved != null ? String(saved) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(saved != null ? String(saved) : '');
  }, [saved]);

  const current = value.trim() ? Number(value.replace(',', '.')) : null;
  const changed = group.price === 'mixed' ? current != null : (current ?? null) !== saved;
  const recommended = group.cost != null ? recommendedPrice(group.cost, group.width, pricing) : null;

  const byHeight: Record<number, number> = {};
  group.items.forEach((i) => {
    const r = i.cost != null ? recommendedPrice(i.cost, group.width, pricing) : null;
    if (r != null) byHeight[i.id] = r;
  });
  const byHeightDiffers =
    Object.keys(byHeight).length > 0 &&
    group.items.some((i) => byHeight[i.id] != null && byHeight[i.id] !== i.price);

  const saveByHeight = async () => {
    setSaving(true);
    try {
      const r = await setSitePrices(byHeight, actor);
      toast(
        r.pushed
          ? { title: `Цены по высотам отправлены на сайт: ${Object.keys(byHeight).length}` }
          : { title: 'Цены сохранены, на сайт не ушли', description: r.pushError || undefined, variant: 'destructive' }
      );
      onSaved();
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const save = async (price: number | null) => {
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      toast({ title: 'Цена должна быть больше нуля', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const r = await setSitePrice(
        group.items.map((i) => i.id),
        price,
        actor
      );
      toast(
        r.pushed
          ? { title: `Цена сохранена для ${group.items.length} высот и отправлена на сайт` }
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
    return (
      <span>{group.price === 'mixed' ? 'разная' : saved != null ? rub(saved) : '—'}</span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && changed && save(current)}
          placeholder={group.price === 'mixed' ? 'разная' : 'Цена'}
          className="h-8 w-24"
        />
        {changed && (
          <Button size="sm" className="h-8 px-2" onClick={() => save(current)} disabled={saving}>
            <Icon name={saving ? 'Loader2' : 'Check'} size={14} className={saving ? 'animate-spin' : ''} />
          </Button>
        )}
      </div>
      {recommended != null && recommended !== group.price && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save(recommended)}
          className="w-fit text-left text-xs text-sky-700 hover:underline"
        >
          поставить {rub(recommended)}
        </button>
      )}
      {recommended == null && group.cost == null && (
        <span
          className="w-fit text-xs text-muted-foreground"
          title="Подсказка цены считается от себестоимости: нужна ткань в расходе материалов и её цена по поставкам"
        >
          нет себестоимости
        </span>
      )}
      {byHeightDiffers && (
        <button
          type="button"
          disabled={saving}
          onClick={saveByHeight}
          className="w-fit text-left text-xs text-sky-700 hover:underline"
          title="Каждой высоте — своя цена по её себестоимости и цели прибыли ширины"
        >
          по высотам
        </button>
      )}
      {group.pushError && (
        <span className="text-xs text-red-600" title={group.pushError}>
          не ушло на сайт
        </span>
      )}
    </div>
  );
};

export default SitePriceCell;