import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { shortProductName } from '@/lib/shortProductName';
import {
  fetchSupplyTails,
  clearSupplyTails,
  type SupplyTailItem,
} from '@/lib/goodsWarehouseApi';

interface SupplyTailsPanelProps {
  /** Перечитать список подбора после освобождения вещей. */
  onReload: () => void;
}

/**
 * Вещи, за которыми тянется запись старой уехавшей поставки.
 *
 * Как получается: вещь сняли с отгрузки и вернули на полку, а строка в коробе
 * уехавшей поставки осталась. Физически вещь лежит на складе со складским
 * стикером, но по системе числится уложенной в короб.
 *
 * Для кладовщика это спор с очевидностью: он держит вещь в руках, а система
 * говорит «товар в поставке FBO». Снятие такой записи ничего не ломает —
 * поставка давно уехала, её состав ни на что не влияет.
 */
const SupplyTailsPanel = ({ onReload }: SupplyTailsPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<SupplyTailItem[]>([]);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Освобождение вещи — решение об остатках склада, поэтому не для всех.
  const canClear = user?.role === 'admin' || user?.role === 'senior_storekeeper';

  const load = () => {
    fetchSupplyTails()
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  };

  useEffect(() => {
    if (canClear) load();
  }, [canClear]);

  if (!canClear || items.length === 0) return null;

  const handleClear = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      // ЧИСТИМ ПОРЦИЯМИ, ПОКА НЕ ЗАКОНЧИТСЯ.
      //
      // Сервер за один раз берёт ограниченное число вещей: на сотне записей
      // одним запросом функция упиралась в лимит времени и отвечала ошибкой.
      // Здесь просто повторяем вызов, пока сервер сообщает об остатке — для
      // человека это одно нажатие.
      let rest = items.map((i) => i.id);
      let total = 0;
      while (rest.length > 0) {
        const res = await clearSupplyTails(rest, user?.id, user?.name);
        total += res.freed;
        if (!res.remaining) break;
        rest = rest.slice(rest.length - res.remaining);
      }
      toast({
        title: `Освобождено вещей: ${total}`,
        description: 'Записи старых поставок сняты — вещи снова свободны',
      });
      setOpen(false);
      load();
      onReload();
    } catch (e) {
      toast({
        title: 'Не удалось освободить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-md border border-sky-300 bg-sky-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <Icon name="Unlink" size={18} className="mt-0.5 shrink-0 text-sky-600" />
          <div>
            <p className="text-sm font-medium text-sky-900">
              Числятся в старых поставках, а лежат на складе: {items.length}
            </p>
            <p className="text-xs text-sky-800">
              Вещь вернули на полку, а запись в коробе уехавшей поставки осталась.
              Из-за неё товар показывается как «в поставке».
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Свернуть' : 'Посмотреть'}
          </Button>
          <Button size="sm" onClick={handleClear} disabled={clearing}>
            <Icon
              name={clearing ? 'Loader2' : 'Unlink'}
              size={14}
              className={`mr-1.5 ${clearing ? 'animate-spin' : ''}`}
            />
            Освободить все
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {items.map((i) => (
            <div
              key={`${i.id}-${i.supplyId}`}
              className="flex items-start justify-between gap-3 rounded-md border border-sky-200 bg-background p-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{shortProductName(i)}</p>
                <p className="text-xs text-muted-foreground">
                  {i.storageBarcode || '—'}
                  {i.shelfName ? ` · полка ${i.shelfName}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-right text-xs text-sky-700">
                <span className="block font-medium">
                  {i.supplyNumber || `№${i.supplyId}`}
                </span>
                {/* Вещь уже лежит в живой поставке — её просто переложили,
                    и старый хвост тем более лишний. */}
                <span className="text-muted-foreground">
                  {i.inLiveSupply ? 'уже в новой поставке' : i.supplyStatus}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SupplyTailsPanel;