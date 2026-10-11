import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import ShopBadge from '@/components/crm/ShopBadge';
import type { PickingOrder } from '@/lib/goodsWarehouseApi';
import { shortProductName } from '@/lib/shortProductName';
import { formatDateTime } from '@/lib/dateUtils';

interface GoodsPickingTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET подбора — не писать «заказов нет». */
  error?: string | null;
  search: string;
  /** Выбранная полка: пустой список тогда означает «на полке ничего нет». */
  shelfFilter?: string | null;
  /** Настоящая работа кладовщика — без «лишних» вещей FBO. */
  workOrders: PickingOrder[];
  /** Отобранное поиском подмножество workOrders. */
  filtered: PickingOrder[];
  /** Разбивка отобранного по площадке и схеме: «OZON FBS: 9». */
  byScheme: Record<string, number>;
  /** Открыть карточку вещи. */
  onOpenCard: (id: number) => void;
}

/** Таблица подбора: сводка по схемам сверху и строки вещей с полками. */
const GoodsPickingTable = ({
  loading,
  error = null,
  search,
  shelfFilter = null,
  workOrders,
  filtered,
  byScheme,
  onOpenCard,
}: GoodsPickingTableProps) => {
  if (loading && workOrders.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (filtered.length === 0) {
    if (error) return null;
    return (
      <p className="text-sm text-muted-foreground">
        {shelfFilter
          ? 'На этой полке сейчас нет товара к подбору'
          : search
            ? 'По запросу ничего не найдено'
            : 'Заказов к подбору нет'}
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {shelfFilter
            ? `На полке: ${filtered.length} шт`
            : search
              ? `Найдено: ${filtered.length} из ${workOrders.length}`
              : `Заказов к подбору: ${workOrders.length}`}
        </p>
        {/* Сколько работы какого вида: FBS собирают поштучно с ярлыками,
            FBO складывают коробкой. Кладовщик планирует день по этим числам. */}
        {Object.entries(byScheme).map(([label, count]) => (
          <Badge key={label} variant="outline" className="font-normal">
            {label}: {count}
          </Badge>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {filtered.map((o) => {
          const size = o.width && o.height ? `${o.width}×${o.height}` : '';
          const bar =
            o.orderType === 'FBS'
              ? 'bg-sky-500'
              : o.orderType === 'FBO'
                ? 'bg-violet-500'
                : 'bg-muted-foreground';
          return (
            <div
              key={o.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenCard(o.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpenCard(o.id);
              }}
              className={`relative grid min-w-0 cursor-pointer grid-cols-1 items-center gap-x-3 gap-y-1 overflow-hidden rounded-md border border-border bg-card px-3 py-2 pl-4 hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${
                o.shippingLabeledAt ? 'bg-amber-50/70' : ''
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />

              <div className="flex min-w-0 flex-col items-start gap-0.5">
                {o.shippingLabeledAt && (
                  <span className="inline-flex items-center gap-1 rounded-br-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    <Icon name="Printer" size={10} />
                    Стикер
                  </span>
                )}
                <span className="text-[11px] font-semibold leading-tight">
                  {o.shelfName ? `полка № ${o.shelfName}` : 'без полки'}
                </span>
                {o.createdAt && (
                  <span className="whitespace-nowrap text-[11px] leading-tight text-muted-foreground">
                    {formatDateTime(o.createdAt)}
                  </span>
                )}
                <ShopBadge name={o.shopName} color={o.shopColor} />
                {!!o.alsoOnShelves?.length && (
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    Ещё {o.alsoOnShelves.reduce((sum, x) => sum + x.count, 0)} шт:{' '}
                    {o.alsoOnShelves.map((x) => `${x.shelfName} (${x.count})`).join(', ')}
                  </span>
                )}
              </div>

              <div className="flex min-w-0 flex-col items-center px-2 text-center">
                <p className="break-words text-base font-extrabold leading-tight" title={o.product || ''}>
                  {o.material || shortProductName(o)}
                </p>
                {size && <span className="text-sm font-semibold">{size}</span>}
              </div>

              <div className="flex shrink-0 flex-col items-end justify-self-end text-right leading-tight">
                <div className="mb-1 flex items-center gap-1">
                  <Badge variant="secondary" className="font-normal">
                    {(o.marketplace || '—').toUpperCase()}
                  </Badge>
                  {o.orderType && (
                    <Badge
                      className={
                        o.orderType === 'FBS'
                          ? 'bg-sky-100 font-semibold text-sky-800 hover:bg-sky-100'
                          : 'bg-violet-100 font-semibold text-violet-800 hover:bg-violet-100'
                      }
                    >
                      {o.orderType}
                    </Badge>
                  )}
                </div>
                {o.cluster && (
                  <span className="text-[11px] text-muted-foreground">{o.cluster}</span>
                )}
                {o.storageBarcode && (
                  <span className="font-mono-tech text-sm font-bold">{o.storageBarcode}</span>
                )}
                {o.orderNumber && (
                  <span className="font-mono-tech text-xs text-muted-foreground">{o.orderNumber}</span>
                )}
              </div>

              {o.shippingLabeledAt && (
                <p className="col-span-full text-xs font-medium text-amber-900">
                  {o.status === 'awaiting_supply'
                    ? 'Стикер наклеен — отсканируйте в короб'
                    : 'Стикер наклеен — отправьте на поставку'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default GoodsPickingTable;
