import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { fetchNoShelfItems, placeNoShelfItem, type NoShelfItem } from '@/lib/goodsWarehouseApi';

const STATUS_RU: Record<string, string> = {
  in_stock: 'на хранении',
  awaiting_shelf: 'ждёт полку',
  picking: 'в подборе',
  awaiting_supply: 'ждала поставку',
};

const Row = ({
  item,
  shelves,
  onPlaced,
}: {
  item: NoShelfItem;
  shelves: Shelf[];
  onPlaced: (id: number) => void;
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [shelfId, setShelfId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const place = async () => {
    if (!shelfId) return;
    setSaving(true);
    try {
      const res = await placeNoShelfItem(item.id, Number(shelfId), user?.id, user?.name);
      toast({ title: `${item.storageBarcode} уложена на «${res.shelf}»` });
      onPlaced(item.id);
    } catch (e) {
      toast({
        title: 'Не удалось уложить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-background p-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="font-semibold tabular-nums">{item.storageBarcode}</div>
        <div className="text-xs text-muted-foreground">
          {item.product || 'Товар'}
          {item.orderNumber ? ` · ${item.orderNumber}` : ''} · {STATUS_RU[item.status] || item.status}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={shelfId} onValueChange={setShelfId}>
          <SelectTrigger className="h-9 w-full sm:w-52">
            <SelectValue placeholder="Выберите полку" />
          </SelectTrigger>
          <SelectContent>
            {shelves.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={!shelfId || saving}
          onClick={place}
          aria-label="Уложить на полку"
        >
          <Icon name={saving ? 'Loader2' : 'Check'} size={18} className={saving ? 'animate-spin' : ''} />
        </Button>
      </div>
    </div>
  );
};

/**
 * Вещи на складе без полки.
 *
 * Без полки вещь теряется: подбор её не видит, кладовщик не знает, где искать,
 * и цех шьёт вторую такую же. Блок висит на подборе, пока есть хоть одна такая
 * вещь: найти её, выбрать полку и нажать галочку.
 */
const NoShelfPanel = () => {
  const [items, setItems] = useState<NoShelfItem[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);

  const load = useCallback(async () => {
    try {
      const [list, sh] = await Promise.all([fetchNoShelfItems(), fetchShelves()]);
      setItems(list);
      setShelves(sh);
    } catch {
      /* блок подсказочный — без связи просто не показываем */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (items.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border-2 border-destructive bg-destructive/5 p-3">
      <div className="flex items-start gap-2">
        <Icon name="TriangleAlert" size={22} className="mt-0.5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-destructive">
            Есть товары без полки: {items.length}. Найдите их и уложите на полку
          </p>
          <p className="text-xs text-muted-foreground">
            Вещь без полки не видит подбор, и под заказ шьют такую же. Выберите полку и нажмите галочку
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={load} aria-label="Обновить">
          <Icon name="RefreshCw" size={15} />
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((i) => (
          <Row
            key={i.id}
            item={i}
            shelves={shelves}
            onPlaced={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
          />
        ))}
      </div>
    </div>
  );
};

export default NoShelfPanel;
