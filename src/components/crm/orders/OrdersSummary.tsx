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

/** Метраж ткани по списку заказов. Берём реальный расход из карточки товара (в нём
 * учтён запас на подгибку) — именно столько уйдёт со склада. Если карточка не заведена,
 * падаем на чистую ширину, чтобы заказ не потерялся в подсчёте. */
const meters = (list: Order[]) =>
  list.reduce(
    (sum, o) => sum + (o.fabricPerItem ?? (o.width || 0) / 100) * o.quantity,
    0,
  );

/** Разбивка новых заказов по материалам: сколько погонных метров каждой ткани нужно
 * отгрузить в цех. Кладовщик сразу видит, чего уйдёт много, и везёт нужные рулоны. */
const byMaterial = (list: Order[]) => {
  const map = new Map<string, { meters: number; items: number }>();
  list.forEach((o) => {
    const name = o.material || 'Без материала';
    const prev = map.get(name) || { meters: 0, items: 0 };
    map.set(name, {
      meters: prev.meters + (o.fabricPerItem ?? (o.width || 0) / 100) * o.quantity,
      items: prev.items + o.quantity,
    });
  });
  // Самый «тяжёлый» материал сверху — с него кладовщик и начинает отгрузку.
  return [...map.entries()].sort((a, b) => b[1].meters - a[1].meters);
};

/**
 * Сводка сверху страницы заказов: новые заказы (кол-во + пог.м.) и разбивка ТЕКУЩЕЙ
 * работы по типу поставки (FBO/FBS) и площадкам (OZON/WB/Яндекс).
 *
 * Считаем только заказы, которые ещё в работе. Раньше сюда попадала вся история за
 * всё время, и цифры не сходились ни с чем: например, «FBO WB — 4 шт.» — это четыре
 * заказа, отшитых ещё весной и давно отгруженных, хотя таких заказов в работе нет
 * вообще. Сводка должна отвечать на вопрос «сколько мне сейчас делать», а не
 * «сколько сделано за всё время» — для истории есть вкладка «Готовые».
 */
const OrdersSummary = ({ orders }: OrdersSummaryProps) => {
  const active = orders.filter(
    (o) =>
      o.status !== 'Отменён' &&
      // «Готовые» — заказ отшит и закрыт, «Со склада» — закрыт готовой вещью с полки:
      // ни там, ни там работы для цеха уже нет.
      o.sewingStatus !== 'Готовые' &&
      o.sewingStatus !== 'Со склада',
  );
  const newOrders = active.filter((o) => o.sewingStatus === 'Новый');

  const materialRows = byMaterial(newOrders);

  const countBy = (type: string, code: string) =>
    active.filter((o) => o.orderType === type && o.marketplace === code).length;

  const TypeCard = ({ title, type, icon }: { title: string; type: string; icon: string }) => {
    const total = active.filter((o) => o.orderType === type).length;
    return (
      <Card className="border-border shadow-none">
        <CardContent className="space-y-2 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon name={icon} size={15} className="text-muted-foreground" />
              {title} — в работе
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
            {meters(newOrders).toFixed(2)} пог.м. ткани
          </span>

          {/* Разбивка по тканям: кладовщик сразу видит, какого материала уйдёт больше
              всего, и отгружает в цех нужные рулоны, а не наугад. */}
          {materialRows.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {materialRows.map(([name, v]) => (
                <div key={name} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{name}</span>
                  <span className="whitespace-nowrap">
                    <span className="font-semibold">{v.meters.toFixed(2)}</span>
                    <span className="text-muted-foreground"> пог.м.</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      · {v.items} шт.
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TypeCard title="FBO" type="FBO" icon="Warehouse" />
      <TypeCard title="FBS" type="FBS" icon="Truck" />
    </div>
  );
};

export default OrdersSummary;
