import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import {
  fetchFboMissingTrace,
  type FboMissingItem,
  type FboMissingOrder,
} from '@/lib/marketplaceSuppliesApi';

interface FboMissingTraceProps {
  supplyId: number;
  /** Меняется после каждого скана — сверка перечитывается сама. */
  refreshKey?: number;
}

const GOODS_STATUS: Record<string, string> = {
  in_stock: 'на полке',
  picking: 'в подборе',
  awaiting_supply: 'ждёт короба',
  awaiting_shelf: 'ждёт полку',
};

/** Где сейчас вещь заказа — одной строкой, чтобы кладовщик знал, куда идти. */
const whereIs = (o: FboMissingOrder): { text: string; tone: string; icon: string } => {
  if (o.storageBarcode) {
    const st = GOODS_STATUS[o.goodsStatus || ''] || o.goodsStatus || 'на складе';
    const place = o.shelf ? `${st}: ${o.shelf}` : st;
    return {
      text: `${o.storageBarcode} — ${place}${o.labeled ? ', стикер наклеен' : ''}`,
      tone: 'text-emerald-700',
      icon: 'Package',
    };
  }
  switch (o.sewingStatus) {
    case 'Новый':
      return { text: 'Ещё не взят в раскрой', tone: 'text-muted-foreground', icon: 'Clock' };
    case 'На раскрое':
    case 'Раскроено':
      return { text: `В раскрое${o.worker ? ` · ${o.worker}` : ''}`, tone: 'text-amber-700', icon: 'Scissors' };
    case 'В работе':
      return { text: `В пошиве${o.worker ? ` · ${o.worker}` : ''}`, tone: 'text-amber-700', icon: 'Shirt' };
    case 'Стикеровка':
      return { text: 'На стикеровке — вещь сшита, ищите у упаковщиц', tone: 'text-sky-700', icon: 'Tag' };
    case 'Готовые':
      return {
        text: 'Сшит и закрыт, но вещи нет на складе — ищите среди готовых пакетов в цехе',
        tone: 'text-destructive',
        icon: 'SearchX',
      };
    case 'Со склада':
      return {
        text: 'Закрыт вещью со склада, но вещь уже ушла — нужна другая с полки',
        tone: 'text-destructive',
        icon: 'SearchX',
      };
    default:
      return { text: o.sewingStatus, tone: 'text-muted-foreground', icon: 'Circle' };
  }
};

const MissingRow = ({ item }: { item: FboMissingItem }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.name || item.offerId || 'Товар'}</div>
          <div className="text-xs text-muted-foreground">
            {item.offerId} · по заявке {item.planned}, в коробах {item.inBoxes}
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900">
          −{item.missing}
        </span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} className="shrink-0" />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-sm">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Заказы поставки, ещё не в коробе
            </div>
            {item.orders.length === 0 ? (
              <p className="text-muted-foreground">Нет — недостача из-за лишних штук в коробах других размеров</p>
            ) : (
              <ul className="space-y-1.5">
                {item.orders.map((o) => {
                  const w = whereIs(o);
                  return (
                    <li key={o.orderId} className="flex items-start gap-2">
                      <Icon name={w.icon} size={15} className={`mt-0.5 shrink-0 ${w.tone}`} />
                      <div className="min-w-0">
                        <div className="font-medium tabular-nums">{o.orderNumber}</div>
                        <div className={`text-xs ${w.tone}`}>{w.text}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Свободные на складе
            </div>
            {item.stock.length === 0 ? (
              <p className="text-muted-foreground">Свободных вещей этого размера нет</p>
            ) : (
              <ul className="space-y-1">
                {item.stock.map((s) => (
                  <li key={s.storageBarcode} className="flex items-center gap-2">
                    <Icon name="Package" size={15} className="shrink-0 text-emerald-700" />
                    <span className="font-medium tabular-nums">{s.storageBarcode}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.shelf || GOODS_STATUS[s.goodsStatus] || s.goodsStatus}
                      {s.labeled ? ' · стикер наклеен' : ' · нужно отстикеровать в «Сборке товара с полок»'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Сверка FBO: чего не хватает в коробах и где это искать.
 *
 * Свёрнута по умолчанию. По каждому размеру с недобором раскрывается список:
 * заказы поставки, которые ещё не в коробе (и где они — в цехе или на складе),
 * и свободные вещи этого размера на полках.
 */
const FboMissingTrace = ({ supplyId, refreshKey }: FboMissingTraceProps) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FboMissingItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchFboMissingTrace(supplyId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сверку');
    } finally {
      setLoading(false);
    }
  }, [supplyId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!items || items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.missing, 0);

  return (
    <Card className="border-amber-300 shadow-none">
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Icon name="SearchCheck" size={18} className="shrink-0 text-amber-700" />
            <span className="font-semibold">Чего не хватает</span>
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-900">
              {total} шт.
            </span>
            <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} className="ml-auto shrink-0" />
          </button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={load} disabled={loading}>
            <Icon name={loading ? 'Loader2' : 'RefreshCw'} size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {open && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Нажмите на товар — покажем, где он: в цехе, на складе или на полке.
            </p>
            {items.map((i) => (
              <MissingRow key={`${i.itemId ?? 'x'}-${i.offerId ?? ''}`} item={i} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FboMissingTrace;
