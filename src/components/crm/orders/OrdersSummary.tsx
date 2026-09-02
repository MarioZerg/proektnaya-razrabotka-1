import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import { fetchMaterialsData } from '@/lib/materialsApi';

interface OrdersSummaryProps {
  orders: Order[];
}

/** Ниже этого остатка ткань пора заказывать: пока едет поставка, цех не должен встать. */
const LOW_STOCK_METERS = 200;

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
 * Сводка сверху страницы заказов: сколько новых заказов и сколько метров ткани под
 * них нужно, с разбивкой по материалам и остатком каждой ткани на складе.
 *
 * Плашки «FBO / FBS в работе» с разбивкой по площадкам отсюда убраны: они считались
 * по загруженной на страницу выборке, а не по всей базе, и потому показывали не то
 * количество, которое было на самом деле. Верные числа по схемам поставки видны в
 * разделе поставок и на главной — дублировать их здесь неверными значениями хуже,
 * чем не показывать вовсе.
 */
const OrdersSummary = ({ orders }: OrdersSummaryProps) => {
  // Остаток каждой ткани на складе. Раньше сводка показывала только СКОЛЬКО нужно
  // сшить, а хватит ли материала — приходилось смотреть в другом разделе. Решение
  // «пора заказывать» принимается по двум числам сразу, поэтому они стоят рядом.
  const [stock, setStock] = useState<Map<string, { qty: number; unit: string }>>(new Map());

  useEffect(() => {
    fetchMaterialsData()
      .then((d) => {
        const map = new Map<string, { qty: number; unit: string }>();
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
            {meters(newOrders).toFixed(2)} пог.м. ткани
          </span>

          {/* Разбивка по тканям: кладовщик сразу видит, какого материала уйдёт больше
              всего, и отгружает в цех нужные рулоны, а не наугад. */}
          {materialRows.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {materialRows.map(([name, v]) => {
                const left = stock.get(name.trim().toLowerCase());
                // Ткани нет в справочнике (например, «Без материала») — остаток
                // показать нечего, но саму строку заказов не прячем.
                const low = left !== undefined && left.qty < LOW_STOCK_METERS;
                return (
                  <div
                    key={name}
                    className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{name}</span>
                    <span className="whitespace-nowrap">
                      <span className="font-semibold">{v.meters.toFixed(2)}</span>
                      <span className="text-muted-foreground"> пог.м.</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        · {v.items} шт.
                      </span>
                      {left !== undefined && (
                        <span
                          className={`ml-1.5 text-xs ${
                            low ? 'font-semibold text-destructive' : 'text-muted-foreground'
                          }`}
                        >
                          · на складе {left.qty.toFixed(2)} {left.unit}
                        </span>
                      )}
                    </span>
                    {/* Предупреждение отдельной строкой, а не мелкой подписью в
                        хвосте: закупку ткани легко пропустить среди цифр, а из-за
                        неё встаёт весь цех. */}
                    {low && (
                      <span className="flex w-full items-center gap-1 text-xs font-semibold text-destructive">
                        <Icon name="TriangleAlert" size={12} />
                        Пора заказывать материал — осталось меньше {LOW_STOCK_METERS} пог.м.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
};

export default OrdersSummary;