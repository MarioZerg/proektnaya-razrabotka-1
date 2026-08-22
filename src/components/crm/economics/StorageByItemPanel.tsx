import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { fetchStorageReport, type StorageReport } from '@/lib/unitEconomicsApi';

const money = (v: number) => Math.round(v).toLocaleString('ru-RU');

/**
 * Хранение в разрезе товаров.
 *
 * Площадка присылает хранение одной суммой за месяц, и по ней не понять, какие
 * позиции его тянут. Сколько дней лежит конкретная штука, она не отдаёт,
 * поэтому считаем оборачиваемость: остаток делим на средние продажи в день.
 *
 * Счёт раскладываем пропорционально «штуко-дням». Позиция с остатком 300 штук
 * при продаже 2 в день пролежит 150 дней и наберёт хранения, а такая же при
 * 30 в день уйдёт за декаду — платить одинаково они не должны.
 */
const StorageByItemPanel = ({ marketplace }: { marketplace: string }) => {
  const [data, setData] = useState<StorageReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchStorageReport(marketplace, 30)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [marketplace]);

  if (loading) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Считаю хранение по товарам...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Нет данных об остатках. Нажмите «Обновить остатки» — они приходят из
          кабинета площадки
        </CardContent>
      </Card>
    );
  }

  // Мёртвый запас: лежит больше полугода при текущих продажах.
  const dead = data.items.filter((i) => i.daysLeft >= 180);
  const deadCost = dead.reduce((s, i) => s + i.storageCost, 0);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Icon name="Warehouse" size={15} />
          Хранение по товарам
          <Badge variant="secondary">{money(data.storageTotal)} ₽ за месяц</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.positions} позиций, {data.totalStock} шт на складе. Счёт
          разложен по оборачиваемости: чем дольше товар лежит, тем больше его
          доля
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Главный вывод: сколько денег съедает то, что не продаётся.
            Это и есть повод вывезти товар или снизить цену. */}
        {dead.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5">
            <p className="flex items-start gap-1.5 text-xs text-amber-900">
              <Icon name="TriangleAlert" size={13} className="mt-0.5 shrink-0" />
              <span>
                <b>{dead.length}</b> позиций лежат дольше полугода при текущих
                продажах — это {money(deadCost)} ₽ хранения в месяц. Такой товар
                дешевле вывезти или распродать, чем держать
              </span>
            </p>
          </div>
        )}

        <div className="space-y-1">
          {data.items.slice(0, 25).map((i) => (
            <div
              key={i.sku}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border p-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{i.name || i.offerId || i.sku}</p>
                <p className="text-xs text-muted-foreground">
                  {i.stock} шт на складе · продажи {i.perDay}/день ·{' '}
                  <span
                    className={
                      i.daysLeft >= 180 ? 'font-medium text-destructive' : ''
                    }
                  >
                    {i.daysLeft >= 365
                      ? 'почти не продаётся'
                      : `запаса на ${i.daysLeft} дн`}
                  </span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono-tech text-sm">
                  {money(i.storageCost)} ₽
                </p>
                {i.storagePerUnit != null && (
                  <p className="text-xs text-muted-foreground">
                    {i.storagePerUnit} ₽ за штуку
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          В стоимость товара хранение не входит намеренно: оно зависит от того,
          сколько вещь пролежала, а платится за остаток, а не за проданное
        </p>
      </CardContent>
    </Card>
  );
};

export default StorageByItemPanel;
