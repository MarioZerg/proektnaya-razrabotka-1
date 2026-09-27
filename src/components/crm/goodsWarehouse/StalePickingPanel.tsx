import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { shortProductName } from '@/lib/shortProductName';
import MarketplaceBadge from '@/components/crm/MarketplaceBadge';
import NotFoundDialog, {
  type NotFoundTarget,
} from '@/components/crm/goodsWarehouse/NotFoundDialog';
import {
  fetchStalePicking,
  repickToFree,
  type StalePickingItem,
} from '@/lib/goodsWarehouseApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

interface StalePickingPanelProps {
  /** Перечитать списки вокруг: подбор и счётчики склада. */
  onReload?: () => void;
}

/**
 * Вещи, которые искали и не нашли: строка висит в подборе со вчера и раньше.
 *
 * ПОЧЕМУ ИМЕННО «СО ВЧЕРА». Подбор — работа одного дня: кладовщик проходит по
 * списку вдоль стеллажа и клеит ярлыки. Если строка дожила до следующего дня без
 * ярлыка, значит по ней уже прошли и вещи на полке не оказалось. Сама такая
 * строка не двинется никогда: назавтра автоподбор предложит её снова, кладовщик
 * снова обойдёт стеллаж — а заказ покупателя всё это время стоит. Так и
 * накапливались «висяки», которые искали больше месяца.
 *
 * ПОЧЕМУ ПАНЕЛЬ, А НЕ АВТОМАТИКА. Оба выхода стоят денег или остатков: пошив
 * тратит ткань и работу цеха второй раз, перецепка означает «вещь со склада
 * пропала». Такое решение принимает человек, глядя на конкретную строку, —
 * поэтому панель только показывает работу и даёт кнопки, ничего не делая сама.
 *
 * Что предлагаем по каждой строке:
 *   * такая же вещь свободно лежит на складе — перецепляем заказ на неё. Вещи
 *     одного товара физически неотличимы, покупатель получит ровно то, что
 *     заказал, и пошив не нужен;
 *   * замены нет — только пошив: вещь списывается, заказ уезжает в цех.
 *
 * Решение стоит денег, поэтому панель видят админ и старший кладовщик. Пусто —
 * панель не рисуется, и это нормальное состояние склада.
 */
const StalePickingPanel = ({ onReload }: StalePickingPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<StalePickingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Какую строку перецепляем прямо сейчас: кнопки соседних строк не блокируем.
  const [repicking, setRepicking] = useState<number | null>(null);
  // Строка, по которой открыто окно «списать и отправить в пошив».
  const [sewingTarget, setSewingTarget] = useState<NotFoundTarget | null>(null);

  // Списание и перецепка меняют остатки склада — решение не для всех.
  const canDecide = user?.role === 'admin' || user?.role === 'senior_storekeeper';

  const load = () => {
    fetchStalePicking()
      .then((d) => {
        setLoadError(null);
        setItems(d.items);
        setTotal(d.count);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить список');
      });
  };

  useEffect(() => {
    if (canDecide) load();
  }, [canDecide]);

  if (!canDecide) return null;
  if (loadError) {
    return (
      <WarehouseFetchError
        title="Не удалось загрузить ненайденные вещи"
        description={loadError}
        onRetry={load}
      />
    );
  }
  if (items.length === 0) return null;

  const handleRepick = async (item: StalePickingItem) => {
    if (repicking) return;
    setRepicking(item.id);
    try {
      const res = await repickToFree(item.id, '', user?.id, user?.name);
      toast({
        title: `Заказ ${res.orderNumber || ''} перецеплен`,
        description:
          `Берите вещь ${res.newBarcode}` +
          (res.newShelfName ? ` с полки «${res.newShelfName}»` : '') +
          '. В пошив заказ не пошёл',
      });
      load();
      onReload?.();
    } catch (e) {
      toast({
        title: 'Не удалось перецепить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      // Свободную вещь могли забрать, пока панель была открыта: перечитываем,
      // чтобы кнопка «Перецепить» не обещала замену, которой уже нет.
      load();
    } finally {
      setRepicking(null);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Icon name="SearchX" size={24} className="shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-amber-900">
            Не нашли на складе: {total || items.length} шт.
          </p>
          <p className="text-sm text-amber-900">
            Эти вещи ищут со вчера и раньше — по списку уже прошли, на полке их нет.
            Сами такие строки не уйдут: назавтра подбор предложит их снова, а заказы
            покупателей стоят. Решите по каждой: закрыть замену со склада или шить заново
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} className="mr-1" />
          {open ? 'Свернуть' : 'Разобрать'}
        </Button>
      </div>

      {open && (
        <div className="max-h-96 space-y-2 overflow-y-auto border-t border-amber-200 px-4 py-3">
          {items.map((i) => (
            <div
              key={i.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-200 bg-background p-2.5"
            >
              <div className="min-w-[12rem] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{shortProductName(i)}</span>
                  {/* Площадка и схема: у FBS и FBO работа разная, а по номеру
                      заказа их не различить. */}
                  <MarketplaceBadge marketplace={i.marketplace} />
                  {i.orderType && (
                    <span className="rounded-sm bg-muted px-1.5 text-[10px] font-medium uppercase text-muted-foreground">
                      {i.orderType}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {i.orderNumber || '—'}
                  {i.storageBarcode ? ` · ${i.storageBarcode}` : ''}
                  {i.shelfName ? ` · полка «${i.shelfName}»` : ' · полка не указана'}
                  {' · '}
                  ищут {i.daysInPicking}{' '}
                  {i.daysInPicking === 1 ? 'день' : 'дн.'}
                </p>
              </div>

              {/* ПОДСКАЗКА РЕШЕНИЯ ПРЯМО В СТРОКЕ.
                  Есть свободная такая же — шить заново незачем, и человек должен
                  видеть это, не ходя на склад пересчитывать полки. */}
              {i.freeSameCount > 0 ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs font-medium text-emerald-700">
                    свободных на складе: {i.freeSameCount}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => handleRepick(i)}
                    disabled={repicking === i.id}
                  >
                    <Icon
                      name={repicking === i.id ? 'Loader2' : 'Replace'}
                      size={14}
                      className={`mr-1.5 ${repicking === i.id ? 'animate-spin' : ''}`}
                    />
                    Перецепить на свободную
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">замены нет</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      setSewingTarget({
                        id: i.id,
                        title: shortProductName(i),
                        orderNumber: i.orderNumber,
                        storageBarcode: i.storageBarcode,
                        shelfName: i.shelfName,
                      })
                    }
                  >
                    <Icon name="Scissors" size={14} className="mr-1.5" />
                    Списать и в пошив
                  </Button>
                </div>
              )}
            </div>
          ))}

          {/* Показали не всё: список ограничен сервером, а цифра выше — полная.
              Молчать нельзя, иначе человек решит, что разобрал всё. */}
          {total > items.length && (
            <p className="pt-1 text-xs text-amber-800">
              Показаны первые {items.length} — всего {total}
            </p>
          )}
        </div>
      )}

      {/* Пошив запускается тем же окном, что и на складе: там честно написано,
          что вещь списывается, а цех шьёт заново за наш счёт. */}
      <NotFoundDialog
        item={sewingTarget}
        onOpenChange={(v) => {
          if (!v) setSewingTarget(null);
        }}
        onDone={() => {
          load();
          onReload?.();
        }}
      />
    </div>
  );
};

export default StalePickingPanel;
