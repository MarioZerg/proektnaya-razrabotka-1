import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';

/** Ниже этого остатка ткань пора заказывать: пока едет поставка, цех не должен встать. */
export const LOW_STOCK_METERS = 200;

/** Сколько ткани уйдёт на одну позицию заказа.
 *
 * Берём реальный расход из карточки товара — в нём учтён запас на подгибку, именно
 * столько спишется со склада. Карточка не заведена — падаем на чистую ширину, чтобы
 * заказ не потерялся в подсчёте. */
const orderMeters = (o: Order) =>
  (o.fabricPerItem ?? (o.width || 0) / 100) * o.quantity;

/** Метраж ткани по списку заказов. */
export const meters = (list: Order[]) =>
  list.reduce((sum, o) => sum + orderMeters(o), 0);

/** Разбивка заказов по материалам: сколько погонных метров каждой ткани нужно
 * отгрузить в цех. Кладовщик сразу видит, чего уйдёт много, и везёт нужные рулоны. */
export const byMaterial = (list: Order[]) => {
  const map = new Map<string, { meters: number; items: number }>();
  list.forEach((o) => {
    const name = o.material || 'Без материала';
    const prev = map.get(name) || { meters: 0, items: 0 };
    map.set(name, {
      meters: prev.meters + orderMeters(o),
      items: prev.items + o.quantity,
    });
  });
  // Самый «тяжёлый» материал сверху — с него кладовщик и начинает отгрузку.
  return [...map.entries()].sort((a, b) => b[1].meters - a[1].meters);
};

export type StockMap = Map<string, { qty: number; unit: string }>;

interface MaterialNeedsTableProps {
  rows: ReturnType<typeof byMaterial>;
  stock: StockMap;
}

/**
 * Таблица «сколько ткани нужно и сколько её на складе».
 *
 * Вынесена отдельно, потому что показывается трижды — под FBS, FBO и индивидуальные
 * заказы. Раньше разметка жила прямо в сводке; три копии одной таблицы неминуемо
 * разъехались бы при первой же правке.
 *
 * Числа выровнены по правому краю и набраны моноширинными цифрами: остаток разных
 * тканей сравнивают взглядом сверху вниз, а не выискивают в строке текста.
 */
const MaterialNeedsTable = ({ rows, stock }: MaterialNeedsTableProps) => {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-1.5 text-left font-normal">Материал</th>
            <th className="pb-1.5 pl-3 text-right font-normal">Нужно</th>
            <th className="pb-1.5 pl-3 text-right font-normal">Заказов</th>
            <th className="pb-1.5 pl-3 text-right font-normal">На складе</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, v]) => {
            const left = stock.get(name.trim().toLowerCase());
            // Ткани нет в справочнике (например, «Без материала») — остаток
            // показать нечего, но строку заказов не прячем.
            const low = left !== undefined && left.qty < LOW_STOCK_METERS;
            return (
              <tr key={name} className="border-t border-border/50">
                <td className="py-1.5 pr-2">
                  <span className="block truncate">{name}</span>
                  {/* Предупреждение — под названием ткани, а не в отдельной
                      колонке: так оно не ломает выравнивание чисел и его
                      видно первым делом. */}
                  {low && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-destructive">
                      <Icon name="TriangleAlert" size={12} className="shrink-0" />
                      Пора заказывать материал
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 pl-3 text-right font-semibold tabular-nums">
                  {v.meters.toFixed(2)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">пог.м.</span>
                </td>
                <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                  {v.items}
                  <span className="ml-1 text-xs">шт.</span>
                </td>
                <td
                  className={`whitespace-nowrap py-1.5 pl-3 text-right tabular-nums ${
                    low ? 'font-semibold text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {left === undefined ? (
                    '—'
                  ) : (
                    <>
                      {left.qty.toFixed(2)}
                      <span className="ml-1 text-xs font-normal">{left.unit}</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default MaterialNeedsTable;
