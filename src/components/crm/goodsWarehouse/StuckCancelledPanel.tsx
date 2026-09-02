import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  releaseStuckCancelled,
  type StuckCancelledItem,
} from '@/lib/goodsWarehouseApi';
import MarketplaceBadge from '@/components/crm/MarketplaceBadge';

interface StuckCancelledPanelProps {
  items: StuckCancelledItem[];
  /** Перечитать список и остальные счётчики склада после возврата вещей. */
  onReload: () => void;
}

/**
 * Вещи, зависшие после отмены заказа на маркетплейсе.
 *
 * Покупатель отказался уже после того, как вещь сшили и наклеили ярлык отправления.
 * Заказ мы с конвейера НЕ снимаем — он доводится до конца, это рабочее правило. А вот
 * сама вещь повисает между двумя состояниями: в поставку не уедет (на приёмке ярлык
 * отменённого заказа не примут), но и свободным остатком не считается — числится
 * «в сборке». Товар молча выпадает из оборота.
 *
 * Раньше такие вещи находились только выборочной проверкой раз в неделю. Теперь они
 * видны сразу, и вернуть их в оборот можно одной кнопкой.
 */
const StuckCancelledPanel = ({ items, onReload }: StuckCancelledPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);

  if (items.length === 0) return null;

  const handleRelease = async () => {
    if (releasing) return;
    setReleasing(true);
    try {
      const res = await releaseStuckCancelled(
        items.map((i) => i.id),
        user?.id,
        user?.name,
      );
      // Часть вещей уходит сразу на полку, часть — на раскладку: у них не была
      // указана полка, и кладовщик должен отсканировать их на место.
      const parts: string[] = [];
      if (res.toShelf) parts.push(`на полку: ${res.toShelf}`);
      if (res.toSorting) parts.push(`на раскладку: ${res.toSorting}`);
      toast({
        title: `Возвращено в оборот: ${res.released} шт.`,
        description: parts.length
          ? `${parts.join(', ')}. Заказы остались на конвейере — их не трогали`
          : 'Заказы остались на конвейере — их не трогали',
      });
      onReload();
    } catch (e) {
      toast({
        title: 'Не удалось вернуть в оборот',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Icon name="PackageX" size={24} className="shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-amber-900">
            Зависли после отмены: {items.length} шт.
          </p>
          <p className="text-sm text-amber-900">
            Покупатель отказался уже после стикеровки. В поставку такие вещи не уедут —
            на приёмке ярлык отменённого заказа не примут. Верните их в оборот, чтобы
            они подобрались под нового покупателя
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} className="mr-1" />
            {open ? 'Свернуть' : 'Показать'}
          </Button>
          <Button size="sm" onClick={handleRelease} disabled={releasing}>
            <Icon
              name={releasing ? 'Loader2' : 'PackageCheck'}
              size={14}
              className={`mr-1 ${releasing ? 'animate-spin' : ''}`}
            />
            Вернуть в оборот
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-amber-200 px-4 py-2">
          <ul className="divide-y divide-amber-200">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
                <span className="font-medium text-amber-900">
                  {i.material && i.width ? `${i.material} ${i.width}×${i.height}` : i.product || 'Товар'}
                </span>
                {/* Площадка: отмены WB, Яндекса и OZON лежат вперемешку, а по
                    номеру заказа их не различить. */}
                <MarketplaceBadge marketplace={i.marketplace} />
                <span className="font-mono-tech text-xs text-amber-800">{i.storageBarcode}</span>
                <span className="text-xs text-amber-800">заказ {i.orderNumber || '—'}</span>
                {/* Полка нужна кладовщику, чтобы найти вещь. Без неё вещь уедет
                    на раскладку — там он отсканирует её на место. */}
                <span className="text-xs text-amber-800">
                  {i.shelfName ? `полка: ${i.shelfName}` : 'полка не указана'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default StuckCancelledPanel;