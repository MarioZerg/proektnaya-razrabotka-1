import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { fetchPlatformFees, type FeesMonth } from '@/lib/unitEconomicsApi';

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

const money = (v: number) =>
  Math.round(v).toLocaleString('ru-RU');

/** Понятное имя группы и её иконка. */
const CATEGORIES: Record<string, { label: string; icon: string }> = {
  storage: { label: 'Хранение на складе', icon: 'Warehouse' },
  logistics: { label: 'Логистика и приёмка', icon: 'Truck' },
  service: { label: 'Услуги и подписки', icon: 'Receipt' },
  marketing: { label: 'Продвижение карточек', icon: 'Sparkles' },
  penalty: { label: 'Штрафы и нарушения', icon: 'TriangleAlert' },
  other: { label: 'Прочее', icon: 'CircleEllipsis' },
};

/**
 * Удержания площадки, которых нет в юнит-экономике товара.
 *
 * Зачем отдельный экран. В юнитке сидит только то, что зависит от самой
 * продажи: комиссия, логистика, эквайринг, реклама. А подписка Premium,
 * досрочная выплата, платные слоты приёмки и штрафы относятся к МАГАЗИНУ и
 * МЕСЯЦУ — подписка не дорожает от того, что продали ещё одну штору.
 *
 * Если размазать их по стоимости единицы, цифра станет ложной: товар,
 * проданный в месяц с крупным штрафом, «подорожает» без всякой причины.
 * Поэтому показываем их здесь — рядом с оборотом и числом проданных вещей,
 * чтобы был виден масштаб.
 */
const PlatformFeesPanel = ({ marketplace }: { marketplace: string }) => {
  const [data, setData] = useState<FeesMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchPlatformFees(marketplace, 6)
      .then((r) => {
        const withData = r.filter((m) => m.items.length > 0);
        setData(withData);
        if (withData[0]) setOpenMonth(withData[0].month);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [marketplace]);

  if (loading) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Собираю расходы площадки...
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Нет данных. Нажмите «Обновить рекламу» — расходы приходят вместе с
          финансовыми операциями площадки
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon name="ReceiptText" size={15} />
          Расходы площадки сверх комиссии
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Подписки, досрочная выплата, платные слоты, хранение, штрафы. В
          стоимость товара это не входит намеренно: расходы относятся к
          магазину и месяцу, а не к конкретной вещи
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((m) => {
          const isOpen = openMonth === m.month;
          const prev = data[data.indexOf(m) + 1];
          const growth = prev?.feesTotal
            ? ((m.feesTotal - prev.feesTotal) / prev.feesTotal) * 100
            : null;

          return (
            <div key={m.month} className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setOpenMonth(isOpen ? null : m.month)}
                className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"
              >
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Icon
                      name={isOpen ? 'ChevronDown' : 'ChevronRight'}
                      size={14}
                    />
                    {monthLabel(m.month)}
                    {/* Рост удержаний — самый важный сигнал: он означает, что
                        площадка стала забирать больше при том же обороте. */}
                    {growth != null && Math.abs(growth) > 15 && (
                      <Badge
                        variant={growth > 0 ? 'destructive' : 'secondary'}
                        className="text-[11px]"
                      >
                        {growth > 0 ? '+' : ''}
                        {Math.round(growth)}% к прошлому
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    оборот {money(m.revenue)} ₽ · продано {m.soldUnits} шт
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">−{money(m.feesTotal)} ₽</p>
                  <p className="text-xs text-muted-foreground">
                    {m.feesPercent}% оборота
                    {m.feesPerUnit != null && ` · ${m.feesPerUnit} ₽ на вещь`}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border p-3">
                  {/* Главный вывод месяца: сколько прибыли осталось ПОСЛЕ
                      удержаний. Юнитка их не видит, и, умножая прибыль с вещи
                      на количество проданного, владелец завышал результат. */}
                  {m.grossProfit > 0 && (
                    <div className="mb-3 rounded-md bg-muted/50 p-2.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Прибыль по расчёту товара ({m.unitProfit} ₽ ×{' '}
                          {m.soldUnits} шт)
                        </span>
                        <span>{money(m.grossProfit)} ₽</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Удержания площадки</span>
                        <span>−{money(m.feesTotal)} ₽</span>
                      </div>
                      <div className="mt-1 flex justify-between border-t border-border pt-1 font-bold">
                        <span>Осталось за месяц</span>
                        <span
                          className={
                            m.netProfit > 0 ? 'text-emerald-700' : 'text-destructive'
                          }
                        >
                          {money(m.netProfit)} ₽
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Сначала группы — чтобы было видно, куда уходит основное,
                      а потом уже детальные строки. */}
                  <div className="mb-3 flex flex-wrap gap-2">
                    {Object.entries(m.byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, sum]) => {
                        const c = CATEGORIES[cat] || CATEGORIES.other;
                        return (
                          <span
                            key={cat}
                            className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
                          >
                            <Icon name={c.icon} size={12} />
                            {c.label}
                            <b>{money(sum)} ₽</b>
                          </span>
                        );
                      })}
                  </div>

                  <div className="space-y-1">
                    {m.items.map((it) => (
                      <div
                        key={it.name}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="min-w-0 text-muted-foreground">
                          {it.name}
                          {it.operations > 1 && (
                            <span className="ml-1 text-[11px]">
                              ×{it.operations}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono-tech">
                          {money(it.amount)} ₽
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default PlatformFeesPanel;
