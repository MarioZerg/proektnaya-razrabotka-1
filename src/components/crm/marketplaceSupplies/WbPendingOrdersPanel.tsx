import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchWbPendingOrders,
  moveWbOrdersToSupply,
  type WbPendingOrder,
} from '@/lib/wbFbsApi';

interface WbPendingOrdersPanelProps {
  supplyId: number;
  onMoved: () => void;
}

/**
 * Заказы, собранные упаковщицами и ждущие поставки.
 *
 * Упаковщица печатает стикер — вещь сразу попадает в свободную поставку. Кладовщик
 * создаёт свою поставку и видит здесь всё накопленное: отмечает нужное и забирает
 * к себе. Сканировать каждую вещь повторно не нужно.
 */
const WbPendingOrdersPanel = ({ supplyId, onMoved }: WbPendingOrdersPanelProps) => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<WbPendingOrder[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchWbPendingOrders(supplyId)
      .then((d) => {
        setOrders(d.orders);
        setSelected(new Set());
      })
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [supplyId]);

  useEffect(() => {
    load();
  }, [load]);

  const query = search.trim().toLowerCase();
  const visible = query
    ? orders.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(query) ||
          (o.product || '').toLowerCase().includes(query) ||
          (o.material || '').toLowerCase().includes(query)
      )
    : orders;

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((o) => selected.has(o.orderId));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((o) => next.delete(o.orderId));
      else visible.forEach((o) => next.add(o.orderId));
      return next;
    });
  };

  const handleMove = async () => {
    if (selected.size === 0) return;
    setMoving(true);
    try {
      const res = await moveWbOrdersToSupply(supplyId, Array.from(selected));
      toast({
        title: `Перенесено заказов: ${res.moved}`,
        description: res.errors.length ? res.errors.slice(0, 3).join('; ') : undefined,
        variant: res.errors.length ? 'destructive' : undefined,
      });
      load();
      onMoved();
    } catch (e) {
      toast({
        title: 'Не удалось перенести заказы',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setMoving(false);
    }
  };

  if (!loading && orders.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50/60 shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium">
            <Icon name="PackageCheck" size={18} className="mr-1.5 inline align-text-bottom" />
            Собрано упаковщицами и ждёт поставки: <b>{orders.length}</b>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <Icon
                name={loading ? 'Loader2' : 'RefreshCw'}
                size={15}
                className={`mr-1.5 ${loading ? 'animate-spin' : ''}`}
              />
              Обновить
            </Button>
            <Button size="sm" onClick={handleMove} disabled={moving || selected.size === 0}>
              <Icon
                name={moving ? 'Loader2' : 'ArrowDownToLine'}
                size={15}
                className={`mr-1.5 ${moving ? 'animate-spin' : ''}`}
              />
              Забрать в поставку ({selected.size})
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру заказа или товару"
            className="h-9 max-w-xs"
          />
          <Button variant="ghost" size="sm" onClick={toggleAll} disabled={visible.length === 0}>
            {allVisibleSelected ? 'Снять все' : 'Выбрать все'}
          </Button>
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {visible.map((o) => {
            const size =
              o.width && o.height ? `${o.material || ''} ${o.width}×${o.height}`.trim() : null;
            return (
              <label
                key={o.orderId}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-2.5 hover:bg-accent"
              >
                <Checkbox
                  checked={selected.has(o.orderId)}
                  onCheckedChange={() => toggle(o.orderId)}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-mono-tech text-sm font-semibold">{o.orderNumber}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {size || o.product}
                  </div>
                </div>
              </label>
            );
          })}
          {visible.length === 0 && !loading && (
            <p className="py-4 text-center text-sm text-muted-foreground">Ничего не найдено</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default WbPendingOrdersPanel;
