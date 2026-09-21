import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { releaseGoodsToShelf, type PickingOrder } from '@/lib/goodsWarehouseApi';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { shortProductName } from '@/lib/shortProductName';

interface ExtraFboPanelProps {
  items: PickingOrder[];
  onReload: () => void;
}

/**
 * Вещи FBO, собранные СВЕРХ плана заявки.
 *
 * ОТКУДА ОНИ БЕРУТСЯ. Товар FBO обезличен: вещи одного артикула физически
 * неотличимы, и в короб уезжает та, что оказалась под рукой, — не обязательно
 * та, что система закрепила за строкой заявки. Сканирование в короб
 * перецепляет заказ на уехавшую вещь, а «запасная» так и остаётся лежать на
 * полке с наклеенным ярлыком OZN и чужой бронью.
 *
 * Именно из-за них счётчики расходились: поставка считала по коробам
 * («осталось добавить 10»), а подбор — по складским записям и звал собрать 37.
 * Кладовщик шёл к стеллажу за товаром, который уже лежит в заклеенном коробе.
 *
 * Прятать такие вещи молча нельзя — они не исчезают со склада: на них чужой
 * ярлык, в короб они не пойдут, а в свободный остаток сами не вернутся. Здесь
 * их видно списком, и админ возвращает их на полки одной кнопкой.
 */
const ExtraFboPanel = ({ items, onReload }: ExtraFboPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Вернуть на полки может админ и старший кладовщик: решение меняет и состав
  // заявки, и остатки склада. Сервер проверяет право ещё раз — спрятанной
  // кнопки для защиты мало.
  const canRelease = user?.role === 'admin' || user?.role === 'senior_storekeeper';

  if (!items.length) return null;

  const handleRelease = async (item: PickingOrder) => {
    setBusyId(item.id);
    try {
      const res = await releaseGoodsToShelf(item.id, null, undefined, user?.id, user?.name);
      toast({
        title: 'Вещь вернулась на полки',
        description:
          `${res.product || 'Товар'} · ${res.storageBarcode || ''} — ` +
          `полка ${res.shelfName || 'не указана'}. ` +
          // Ярлык снят намеренно: на вещи был OZN чужой заявки, и с ним она
          // уедет не туда. Без стикера хранения вещь на полке не опознать.
          'Наклейте стикер хранения: ярлык поставки снят' +
          (res.matched ? `. Закрыто заказов: ${res.matched}` : ''),
      });
      onReload();
    } catch (e) {
      toast({
        title: 'Не удалось вернуть вещь',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-amber-300 bg-amber-50"
    >
      <CollapsibleTrigger className="flex w-full items-start gap-2 p-3 text-left">
        <Icon name="PackageX" size={18} className="mt-0.5 shrink-0 text-amber-700" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">
            Собрано лишнего: {items.length}
          </p>
          <p className="text-sm text-amber-900">
            Эти размеры заявка уже набрала коробами — в короб они не пойдут.
            Верните их на полки, иначе они так и будут лежать с ярлыком поставки
          </p>
        </div>
        <Icon
          name="ChevronRight"
          size={16}
          className={`mt-1 shrink-0 text-amber-700 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-amber-300 p-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium" title={item.product || ''}>
                  {shortProductName(item)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.storageBarcode || '—'}
                  {item.shelfName ? ` · полка ${item.shelfName}` : ''}
                  {item.orderNumber ? ` · ${item.orderNumber}` : ''}
                </p>
              </div>
              {item.shippingLabeledAt && (
                <Badge className="bg-amber-100 font-normal text-amber-900 hover:bg-amber-100">
                  Ярлык наклеен
                </Badge>
              )}
              {canRelease && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === item.id}
                  onClick={() => handleRelease(item)}
                >
                  <Icon
                    name={busyId === item.id ? 'Loader2' : 'Undo2'}
                    size={14}
                    className={`mr-1.5 ${busyId === item.id ? 'animate-spin' : ''}`}
                  />
                  Вернуть на полки
                </Button>
              )}
            </div>
          ))}
          {!canRelease && (
            <p className="text-xs text-amber-900">
              Вернуть вещь на полки может администратор или старший кладовщик —
              позовите их, сами эти вещи не разбирайте
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default ExtraFboPanel;