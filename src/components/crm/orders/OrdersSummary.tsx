import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';

interface OrdersSummaryProps {
  orders: Order[];
}

const marketplaces: Array<{ code: string; label: string }> = [
  { code: 'OZON', label: 'OZON' },
  { code: 'WB', label: 'WB' },
  { code: 'Yandex', label: 'Яндекс' },
];

const meters = (list: Order[]) =>
  list.reduce((sum, o) => sum + ((o.width || 0) * o.quantity) / 100, 0);

/** Сводка сверху страницы заказов: новые заказы (кол-во + пог.м.) и разбивка заказов
 * по типу поставки (FBO/FBS) и площадкам (OZON/WB/Яндекс). Отменённые не учитываются. */
const OrdersSummary = ({ orders }: OrdersSummaryProps) => {
  const active = orders.filter((o) => o.status !== 'Отменён');
  const newOrders = active.filter((o) => o.sewingStatus === 'Новый');

  const countBy = (type: string, code: string) =>
    active.filter((o) => o.orderType === type && o.marketplace === code).length;

  const TypeCard = ({ title, type, icon }: { title: string; type: string; icon: string }) => {
    const total = active.filter((o) => o.orderType === type).length;
    return (
      <Card className="border-border shadow-none">
        <CardContent className="space-y-2 pt-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon name={icon} size={15} className="text-muted-foreground" />
              {title}
            </span>
            <span className="text-lg font-bold">{total}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {marketplaces.map((m) => (
              <div key={m.code} className="rounded border border-border px-2 py-1 text-center">
                <div className="text-xs text-muted-foreground">{m.label}</div>
                <div className="text-base font-semibold">{countBy(type, m.code)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="border-border shadow-none">
        <CardContent className="flex h-full flex-col justify-center gap-1 pt-5">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon name="Sparkles" size={15} className="text-blue-600" />
            Новые заказы
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{newOrders.length}</span>
            <span className="text-sm text-muted-foreground">шт.</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {meters(newOrders).toFixed(2)} пог.м.
          </span>
        </CardContent>
      </Card>

      <TypeCard title="FBO" type="FBO" icon="Warehouse" />
      <TypeCard title="FBS" type="FBS" icon="Truck" />
    </div>
  );
};

export default OrdersSummary;
