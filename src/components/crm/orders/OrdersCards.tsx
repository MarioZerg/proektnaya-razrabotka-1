import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import ShopBadge from '@/components/crm/ShopBadge';
import { canPullFromConveyor, canRestoreOrder, type Order } from '@/lib/ordersApi';
import {
  formatDate,
  marketplaceLogo,
  statusVariant,
  timeAgo,
} from '@/components/crm/orders/ordersShared';

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

/** Мобильный вид списка заказов маркетплейса — карточки вместо широкой таблицы,
 * чтобы не было горизонтальной прокрутки на телефоне. */
const OrdersCards = ({
  orders,
  onEdit,
  onDelete,
  onRestore,
  ozonStatusLabel,
  canManage,
}: OrdersCardsProps) => {
  return (
    <div className="space-y-3">
      {orders.map((o) => {
        // Признак отмены считает сервер: у каждой площадки своё слово для неё
        // (ozon_status='cancelled', ym_status='...CANCELLED'), а наш status при
        // этом остаётся прежним. Раньше здесь смотрели только на наш status — и на
        // телефоне у отменённого заказа оставалась живая кнопка «Удалить».
        const isCancelled =
          !!o.isCancelled || o.status === 'Отменён' || o.sewingStatus === 'Отменён';
        return (
          <div
            key={o.id}
            className={`rounded-md border border-border p-3 ${
              isCancelled ? 'text-muted-foreground line-through opacity-70' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{o.orderNumber}</span>
                  <ShopBadge name={o.shopName} color={o.shopColor} />
                </div>
                <div className="text-xs text-muted-foreground">#{o.id}</div>
              </div>
              <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={marketplaceLogo[o.marketplace]?.className}>
                {marketplaceLogo[o.marketplace]?.label || o.marketplace}
              </span>
              <Badge variant="outline" className="font-normal">
                {o.orderType}
              </Badge>
              {ozonStatusLabel(o.ozonStatus) && (
                <Badge variant="outline" className="font-normal">
                  {ozonStatusLabel(o.ozonStatus)}
                </Badge>
              )}
            </div>

            <div className="mt-2 text-sm">
              {o.product} — {o.quantity} шт.
            </div>
            {o.cluster && (
              <div className="text-sm text-muted-foreground">Кластер: {o.cluster}</div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Создан: {formatDate(o.createdAt)}</span>
              <Badge variant="destructive" className="font-normal">
                {timeAgo(o.createdAt)}
              </Badge>
              {o.completedAt && <span>Выполнен: {formatDate(o.completedAt)}</span>}
            </div>

            {canManage && (
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => onEdit(o)}>
                  <Icon name="Pencil" size={14} className="mr-1.5" />
                  Изменить
                </Button>
                {/* Только нетронутый заказ: раскроенное и шьющееся с конвейера не
                    снимается — ткань разрезана, работа оплачена, вещь нужно отгрузить. */}
                {canPullFromConveyor(o) && (
                  <Button size="sm" variant="destructive" onClick={() => onDelete(o.id)}>
                    <Icon name="Trash2" size={14} className="mr-1.5" />
                    Снять с конвейера
                  </Button>
                )}
                {/* Снятый по ошибке заказ возвращается на конвейер. Отменённый
                    самим маркетплейсом — нет: отгружать вещь будет некуда. */}
                {canRestoreOrder(o) && (
                  <Button size="sm" variant="outline" onClick={() => onRestore(o)}>
                    <Icon name="Undo2" size={14} className="mr-1.5" />
                    Вернуть в работу
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default OrdersCards;