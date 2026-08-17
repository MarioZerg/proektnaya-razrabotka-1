import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import { hoursSince, getTone } from '@/components/crm/sewingItems/orderUrgency';

interface OrderWaitTimerProps {
  order: Order;
  /** Компактный вид — только бейдж, без подписи с датой. */
  compact?: boolean;
}


const toneClass: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 hover:bg-red-100',
  warning: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  ok: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
};

const humanize = (hours: number) => {
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))} мин`;
  if (hours < 24) return `${Math.floor(hours)} ч`;
  const days = Math.floor(hours / 24);
  const restHours = Math.floor(hours % 24);
  return restHours > 0 ? `${days} д ${restHours} ч` : `${days} д`;
};

/** Виджет «сколько заказ ждёт» — как счётчик времени на заказах WB и OZON. Считается от
 * даты оформления заказа на маркетплейсе, а при её отсутствии — от загрузки в систему. */
const OrderWaitTimer = ({ order, compact = false }: OrderWaitTimerProps) => {
  const source = order.marketplaceCreatedAt || order.createdAt;
  if (!source) return null;

  const hours = hoursSince(source);
  const tone = getTone(hours, order.orderType);
  const fromMarketplace = !!order.marketplaceCreatedAt;

  return (
    <Badge
      variant="secondary"
      className={`${toneClass[tone]} shrink-0 gap-1 font-normal`}
      title={
        fromMarketplace
          ? `Заказ оформлен на ${order.marketplace} ${new Date(source).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
          : `Загружен в систему ${new Date(source).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
      }
    >
      <Icon name={tone === 'critical' ? 'AlarmClock' : 'Clock'} size={12} />
      {humanize(hours)}
      {!compact && (fromMarketplace ? ' с заказа' : ' в системе')}
    </Badge>
  );
};

export default OrderWaitTimer;
