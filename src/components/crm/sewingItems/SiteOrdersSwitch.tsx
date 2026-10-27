import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { syncSiteOrders } from '@/lib/siteOrdersApi';

export type OrdersSource = 'marketplace' | 'site';

interface SiteOrdersSwitchProps {
  value: OrdersSource;
  onChange: (v: OrdersSource) => void;
  marketplaceCount: number;
  siteCount: number;
  canSync: boolean;
  actor?: { id?: number; name?: string };
  onSynced: () => void;
}

/** Переключатель конвейера: заказы маркетплейсов и заказы интернет-магазина мегатюль.рф. */
const SiteOrdersSwitch = ({
  value,
  onChange,
  marketplaceCount,
  siteCount,
  canSync,
  actor,
  onSynced,
}: SiteOrdersSwitchProps) => {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  const tab = (v: OrdersSource, label: string, icon: string, count: number) => {
    const active = value === v;
    return (
      <button
        type="button"
        onClick={() => onChange(v)}
        className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition sm:flex-none ${
          active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-muted-foreground hover:bg-muted'
        }`}
      >
        <Icon name={icon} size={15} />
        {label}
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            active ? 'bg-primary-foreground/20' : 'bg-muted'
          }`}
        >
          {count}
        </span>
      </button>
    );
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await syncSiteOrders(actor);
      toast({
        title: r.created ? `Загружено вещей: ${r.created}` : 'Новых заказов нет',
        description: r.unmatched.length
          ? `Не опознано товаров: ${r.unmatched.length} — заведите их в справочник магазина`
          : undefined,
      });
      onSynced();
    } catch (e) {
      toast({
        title: 'Не удалось забрать заказы',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab('marketplace', 'Маркетплейсы', 'ShoppingBag', marketplaceCount)}
      {tab('site', 'Магазин мегатюль.рф', 'Store', siteCount)}
      {value === 'site' && canSync && (
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing} className="ml-auto">
          <Icon name={syncing ? 'Loader2' : 'RefreshCw'} size={14} className={syncing ? 'animate-spin' : ''} />
          Забрать заказы с сайта
        </Button>
      )}
    </div>
  );
};

export default SiteOrdersSwitch;
