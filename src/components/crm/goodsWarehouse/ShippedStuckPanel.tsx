import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { shortProductName } from '@/lib/shortProductName';
import {
  fetchShippedStuck,
  closeShippedStuck,
  type ShippedStuckItem,
} from '@/lib/goodsWarehouseApi';

interface ShippedStuckPanelProps {
  /** Перечитать список подбора после закрытия позиций. */
  onReload: () => void;
}

/** Понятная подпись, куда делась вещь. */
const whereItWent = (i: ShippedStuckItem) => {
  if (i.ozonStatus === 'delivered' || i.orderStatus === 'Доставлен') return 'Доставлено покупателю';
  if (i.ozonStatus === 'driver_pickup') return 'Забрал курьер';
  return 'Едет к покупателю';
};

/**
 * Вещи, которые уже уехали к клиенту, но остались висеть в подборе.
 *
 * Как это получается: кладовщик наклеил ярлык отправления и передал вещь в поставку,
 * но не отсканировал её в короб. Маркетплейс тем временем увёз заказ — он едет или уже
 * доставлен покупателю. У нас же строка так и висит в «Донести в короб».
 *
 * Для кладовщика это тупик: он идёт к стеллажу, а вещи там нет и быть не может.
 * Такие строки копятся и прячут за собой настоящую работу.
 *
 * Закрыть их может только администратор или старший кладовщик: это решение
 * «вещи на складе больше нет», и принимать его вслепую нельзя.
 */
const ShippedStuckPanel = ({ onReload }: ShippedStuckPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<ShippedStuckItem[]>([]);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  // Кнопка только у тех, кто отвечает за склад деньгами.
  const canClose = user?.role === 'admin' || user?.role === 'senior_storekeeper';

  const load = () => {
    fetchShippedStuck()
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  };

  useEffect(() => {
    if (canClose) load();
  }, [canClose]);

  if (!canClose || items.length === 0) return null;

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    try {
      const res = await closeShippedStuck(
        items.map((i) => i.id),
        user?.id,
        user?.name,
      );
      toast({
        title: `Закрыто позиций: ${res.closed}`,
        description: 'Эти вещи уже у клиентов — из подбора они убраны',
      });
      setOpen(false);
      load();
      onReload();
    } catch (e) {
      toast({
        title: 'Не удалось закрыть',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <Icon name="TriangleAlert" size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-900">
              Уже уехали к клиентам, но висят в подборе: {items.length}
            </p>
            <p className="text-xs text-amber-800">
              Вещь передали в отправление, но не отсканировали в короб. Искать её на
              складе бессмысленно — она у покупателя.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Свернуть' : 'Посмотреть'}
          </Button>
          <Button size="sm" onClick={handleClose} disabled={closing}>
            <Icon
              name={closing ? 'Loader2' : 'Check'}
              size={14}
              className={`mr-1.5 ${closing ? 'animate-spin' : ''}`}
            />
            Закрыть все
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {items.map((i) => (
            <div
              key={i.id}
              className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-background p-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{shortProductName(i)}</p>
                <p className="text-xs text-muted-foreground">
                  {i.orderNumber || '—'}
                  {i.shelfName ? ` · полка ${i.shelfName}` : ''}
                  {i.storageBarcode ? ` · ${i.storageBarcode}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium text-amber-700">
                {whereItWent(i)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShippedStuckPanel;
