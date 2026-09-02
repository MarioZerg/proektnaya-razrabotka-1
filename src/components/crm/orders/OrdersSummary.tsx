import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order, OrderType } from '@/lib/ordersApi';
import { fetchMaterialsData } from '@/lib/materialsApi';
import MaterialNeedsTable, {
  byMaterial,
  meters,
  type StockMap,
} from '@/components/crm/orders/MaterialNeedsTable';

interface OrdersSummaryProps {
  orders: Order[];
}

/** Схемы поставки идут отдельными блоками: под FBS шьют поштучно под конкретного
 * покупателя, под FBO — партией на склад площадки, индивидуальные считают отдельно
 * от маркетплейсов. Ткань под них закупают разными партиями, поэтому и метраж
 * нужен раздельный, а не общим котлом. */
const GROUPS: { type: OrderType; title: string; hint: string; icon: string }[] = [
  {
    type: 'FBS',
    title: 'FBS',
    hint: 'под заказы покупателей',
    icon: 'Truck',
  },
  {
    type: 'FBO',
    title: 'FBO',
    hint: 'партией на склад площадки',
    icon: 'Boxes',
  },
  {
    type: 'Индивидуальный',
    title: 'Индивидуальные',
    hint: 'вне маркетплейсов',
    icon: 'UserRound',
  },
];

/**
 * Сводка сверху страницы заказов: сколько новых заказов и сколько метров ткани под
 * них нужно, с разбивкой по схемам поставки, материалам и остатком ткани на складе.
 *
 * Раньше все схемы считались одним списком. Для закупки это бесполезно: FBO шьют
 * партией под будущую поставку, а FBS — поштучно под живых покупателей, и ткань под
 * них заказывают отдельно. Теперь под каждой схемой своя таблица, а общий остаток
 * склада виден в каждой — он один на всех, и тратят его все три потока.
 */
const OrdersSummary = ({ orders }: OrdersSummaryProps) => {
  // Остаток каждой ткани на складе. Раньше сводка показывала только СКОЛЬКО нужно
  // сшить, а хватит ли материала — приходилось смотреть в другом разделе. Решение
  // «пора заказывать» принимается по двум числам сразу, поэтому они стоят рядом.
  const [stock, setStock] = useState<StockMap>(new Map());

  useEffect(() => {
    fetchMaterialsData()
      .then((d) => {
        const map: StockMap = new Map();
        // Ключ в нижнем регистре: в заказах ткань пишут как придётся, а совпасть
        // со справочником она должна в любом написании.
        d.materials.forEach((m) => {
          map.set(m.name.trim().toLowerCase(), {
            qty: m.warehouseQuantity,
            unit: m.unit,
          });
        });
        setStock(map);
      })
      // Справочник не дошёл — сводка по заказам всё равно показывается: это
      // главное на странице, а остаток здесь дополнение.
      .catch(() => {});
  }, []);

  const newOrders = orders.filter(
    (o) =>
      o.status !== 'Отменён' &&
      // Работа для цеха — только «Новый». «Готовые» отшиты и закрыты, «Со склада»
      // закрыты вещью с полки: ткань на них уже не потребуется.
      o.sewingStatus === 'Новый',
  );

  // Пустые схемы не показываем: FBO-заказов может не быть вовсе, и пустой блок
  // только занимал бы место. Появятся — блок встанет сам.
  const groups = GROUPS.map((g) => {
    const list = newOrders.filter((o) => o.orderType === g.type);
    return { ...g, list, rows: byMaterial(list) };
  }).filter((g) => g.list.length > 0);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="border-border shadow-none">
        <CardContent className="flex h-full flex-col gap-1 pt-5">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon name="Sparkles" size={15} className="text-blue-600" />
            Новые заказы
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{newOrders.length}</span>
            <span className="text-sm text-muted-foreground">шт.</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {meters(newOrders).toFixed(2)} пог.м. ткани всего
          </span>

          {/* По схеме поставки: сколько ткани нужно под каждую и хватает ли её на
              складе. Кладовщик отгружает в цех нужные рулоны, закупщик видит, что
              пора дозаказать. */}
          {groups.map((g) => (
            <div key={g.type} className="mt-3 border-t border-border pt-3">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Icon name={g.icon} size={14} className="text-muted-foreground" />
                  {g.title}
                </span>
                <span className="text-xs text-muted-foreground">{g.hint}</span>
                <span className="ml-auto whitespace-nowrap text-sm">
                  <span className="font-semibold tabular-nums">
                    {meters(g.list).toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground"> пог.м.</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    · {g.list.length} зак.
                  </span>
                </span>
              </div>
              <MaterialNeedsTable rows={g.rows} stock={stock} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default OrdersSummary;
