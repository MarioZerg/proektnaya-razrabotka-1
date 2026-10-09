import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import ShopBadge from '@/components/crm/ShopBadge';
import { canPullFromConveyor, canRestoreOrder, type Order } from '@/lib/ordersApi';
import {
  formatDate,
  marketplaceLogo,
  publicOrderNumber,
  timeAgo,
} from '@/components/crm/orders/ordersShared';
import { statusBadgeClass } from '@/components/crm/sewingItems/sewingItemsShared';
import OrderWaitTimer from '@/components/crm/sewingItems/OrderWaitTimer';

interface OrdersCardsProps {
  orders: Order[];
  onEdit: (order: Order) => void;
  onDelete: (id: number) => void;
  /** Вернуть ошибочно снятый заказ обратно на конвейер. */
  onRestore: (order: Order) => void;
  ozonStatusLabel: (s?: string | null) => string | null;
  /** Кладовщик и менеджер смотрят заказы только как справку — без правки и удаления. */
  canManage: boolean;
}

const marketplaceCornerClass: Record<string, string> = {
  OZON: 'bg-[#005BFF] text-white',
  WB: 'bg-[#CB11AB] text-white',
  Yandex: 'bg-[#FFCC00] text-slate-900',
};

const orderStatusClass: Record<string, string> = {
  Новый: 'bg-slate-500 text-white hover:bg-slate-500',
  'В работе': 'bg-sky-500 text-white hover:bg-sky-500',
  Выполнен: 'bg-emerald-600 text-white hover:bg-emerald-600',
  Отгружен: 'bg-teal-600 text-white hover:bg-teal-600',
  Отменён: 'bg-red-600 text-white hover:bg-red-600',
};

/** Карточки заказов маркетплейса — тот же вид, что у конвейера: ткань, размер, номер. */
const OrdersCards = ({
  orders,
  onEdit,
  onDelete,
  onRestore,
  ozonStatusLabel,
  canManage,
}: OrdersCardsProps) => {
  return (
    <div className="space-y-2">
      {orders.map((o) => {
        const isCancelled =
          !!o.isCancelled || o.status === 'Отменён' || o.sewingStatus === 'Отменён';
        const number = publicOrderNumber(o);
        const ozonLabel = ozonStatusLabel(o.ozonStatus);
        const showOrderStatus = o.status && o.status !== o.sewingStatus;
        return (
          <div
            key={o.id}
            role={canManage ? 'button' : undefined}
            tabIndex={canManage ? 0 : undefined}
            onClick={canManage ? () => onEdit(o) : undefined}
            onKeyDown={
              canManage
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onEdit(o);
                    }
                  }
                : undefined
            }
            className={`relative flex min-w-0 overflow-hidden rounded-lg border text-left shadow-none outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ${
              canManage ? 'cursor-pointer' : ''
            } ${
              isCancelled
                ? 'border-red-200 bg-red-50/40 hover:bg-red-50'
                : 'border-border bg-card hover:bg-muted/40'
            }`}
          >
            <span
              aria-hidden
              className={`w-1.5 shrink-0 ${
                isCancelled ? 'bg-red-600' : statusBadgeClass[o.sewingStatus] ? '' : 'bg-slate-400'
              } ${
                o.sewingStatus === 'Новый'
                  ? 'bg-slate-500'
                  : o.sewingStatus === 'На раскрое'
                    ? 'bg-amber-500'
                    : o.sewingStatus === 'В работе'
                      ? 'bg-sky-500'
                      : o.sewingStatus === 'Раскроено'
                        ? 'bg-violet-500'
                        : o.sewingStatus === 'Стикеровка'
                          ? 'bg-orange-500'
                          : o.sewingStatus === 'Готовые' || o.status === 'Выполнен'
                            ? 'bg-emerald-600'
                            : o.sewingStatus === 'Со склада' || o.status === 'Отгружен'
                              ? 'bg-teal-600'
                              : 'bg-slate-400'
              }`}
            />

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-start justify-between gap-1">
                <div className="flex min-w-0 flex-wrap items-stretch">
                  {(o.marketplaceCreatedAt || o.createdAt) && (
                    <span className="inline-flex items-center rounded-br-md bg-slate-100 px-2 py-1 text-[11px] font-semibold leading-none tabular-nums text-slate-700">
                      {formatDate(o.marketplaceCreatedAt || o.createdAt)}
                    </span>
                  )}
                  <span className="inline-flex items-center px-2 py-1 text-[11px] leading-none text-muted-foreground">
                    {timeAgo(o.marketplaceCreatedAt || o.createdAt)}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <OrderWaitTimer order={o} compact />
                  {(o.marketplace || o.orderType) && (
                    <span className="inline-flex overflow-hidden rounded-bl-md">
                      {o.marketplace && (
                        <span
                          className={`px-2 py-1 text-[11px] font-bold leading-none ${
                            marketplaceCornerClass[o.marketplace] || 'bg-slate-700 text-white'
                          }`}
                        >
                          {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                        </span>
                      )}
                      {o.orderType && (
                        <span
                          className={`px-2 py-1 text-[11px] font-bold leading-none ${
                            o.orderType === 'FBS'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-sky-600 text-white'
                          }`}
                        >
                          {o.orderType}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="flex shrink-0 flex-col gap-1">
                  <Badge
                    className={`w-fit whitespace-nowrap ${
                      orderStatusClass[o.status] || statusBadgeClass[o.sewingStatus] || ''
                    }`}
                  >
                    {o.status}
                  </Badge>
                  {showOrderStatus && o.sewingStatus && o.sewingStatus !== 'Новый' && (
                    <Badge
                      className={`w-fit whitespace-nowrap ${statusBadgeClass[o.sewingStatus] || ''}`}
                    >
                      {o.sewingStatus}
                    </Badge>
                  )}
                  {isCancelled && o.status !== 'Отменён' && (
                    <Badge className="w-fit whitespace-nowrap bg-red-600 text-white hover:bg-red-600">
                      Отменён
                    </Badge>
                  )}
                  {ozonLabel && (
                    <Badge variant="outline" className="w-fit font-normal">
                      {ozonLabel}
                    </Badge>
                  )}
                </div>

                <div className="min-w-[9rem] flex-1 basis-[12rem]">
                  <p className="truncate text-base font-bold leading-tight">
                    {o.material || o.product || '—'}
                    {o.width && o.height ? ` ${o.width}×${o.height}` : ''}
                  </p>
                  <p className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {number && (
                      <span className="min-w-0 truncate font-mono-tech text-sm font-semibold">
                        {number}
                      </span>
                    )}
                    <ShopBadge name={o.shopName} color={o.shopColor} />
                    {o.cluster && (
                      <span className="text-sm font-semibold text-sky-800">{o.cluster}</span>
                    )}
                  </p>
                </div>

                {canManage && (
                  <div
                    className="ml-auto flex shrink-0 flex-wrap justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button size="sm" variant="secondary" onClick={() => onEdit(o)}>
                      <Icon name="Pencil" size={14} className="mr-1.5" />
                      Изменить
                    </Button>
                    {canPullFromConveyor(o) && (
                      <Button size="sm" variant="destructive" onClick={() => onDelete(o.id)}>
                        <Icon name="Trash2" size={14} className="mr-1.5" />
                        Снять
                      </Button>
                    )}
                    {canRestoreOrder(o) && (
                      <Button size="sm" variant="outline" onClick={() => onRestore(o)}>
                        <Icon name="Undo2" size={14} className="mr-1.5" />
                        Вернуть
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default OrdersCards;
