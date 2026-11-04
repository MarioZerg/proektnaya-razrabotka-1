import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { syncSiteOrders } from '@/lib/siteOrdersApi';

interface SiteOrdersSwitchProps {
  /** Сколько вещей сейчас на конвейере (маркетплейсы и интернет-магазин вместе). */
  conveyorCount: number;
  canSync: boolean;
  actor?: { id?: number; name?: string };
  onSynced: () => void;
}

/**
 * Шапка конвейера: одна вкладка «Конвейер» для всех заказов — маркетплейсов и
 * интернет-магазина мегатюль.рф. Кнопка «Забрать заказы с сайта» — для тех, кто
 * не в цехе: подтянуть свежие заказы сайта, не дожидаясь расписания.
 */
const SiteOrdersSwitch = ({ conveyorCount, canSync, actor, onSynced }: SiteOrdersSwitchProps) => {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

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
      <span className="flex items-center gap-2 rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
        <Icon name="Workflow" fallback="ShoppingBag" size={15} />
        Конвейер
        <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-bold">
          {conveyorCount}
        </span>
      </span>
      {canSync && (
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing} className="ml-auto">
          <Icon name={syncing ? 'Loader2' : 'RefreshCw'} size={14} className={syncing ? 'animate-spin' : ''} />
          Забрать заказы с сайта
        </Button>
      )}
    </div>
  );
};

export default SiteOrdersSwitch;
