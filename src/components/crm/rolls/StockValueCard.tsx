import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { formatQuantity } from '@/lib/formatQuantity';
import { fetchStockValue, type StockValue } from '@/lib/rollsApi';

const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Сколько денег лежит в остатках материалов — на складе и в цехах.
 *
 * Считается по себестоимости КАЖДОГО рулона, а не по средней цене материала: один и тот же
 * материал у разных поставщиков стоит по-разному, плюс в цену входят курс валюты и логистика
 * конкретной поставки.
 *
 * Показывается только администратору — закупочные цены остальным ролям знать не нужно.
 */
const StockValueCard = () => {
  const [data, setData] = useState<StockValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchStockValue()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Считаю стоимость остатков…
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const materials = data.byMaterial;
  const visible = expanded ? materials : materials.slice(0, 5);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon name="Wallet" size={18} className="text-muted-foreground" />
          Стоимость остатков
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-3xl font-bold">{formatMoney(data.totalValue)} ₽</p>
          <p className="text-sm text-muted-foreground">
            весь материал компании: на складе и выданный в цеха
          </p>
        </div>

        {/* Рулоны без цены портят картину — предупреждаем, что сумма неполная. */}
        {data.rollsWithoutCost > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
            <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0" />
            <p>
              У {data.rollsWithoutCost} рулонов не указана себестоимость — они не вошли в
              сумму. Укажите цены в прайсе поставщика, и новые поставки посчитаются сами.
            </p>
          </div>
        )}

        {materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Остатков материалов нет</p>
        ) : (
          <div className="space-y-1.5">
            {visible.map((m) => (
              <div key={m.materialId} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.material}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatQuantity(m.remaining)} {m.unit} · {m.rolls}{' '}
                    {m.rolls === 1 ? 'рулон' : 'рулонов'}
                    {m.rollsWithoutCost > 0 ? ` · ${m.rollsWithoutCost} без цены` : ''}
                  </p>
                  {/* Показываем склад и цех раздельно: этот виджет считает деньги
                      компании целиком, а страница «Материалы на складе» — только то,
                      что лежит на полке. Без разбивки цифры выглядели противоречиво. */}
                  {m.inWorkshop > 0 && (
                    <p className="text-xs text-muted-foreground">
                      на складе {formatQuantity(m.inStorage)} {m.unit}
                      {m.rollsInStorage > 0 ? ` (${m.rollsInStorage} рул.)` : ''}
                      {' · '}в цехах {formatQuantity(m.inWorkshop)} {m.unit}
                      {m.rollsInWorkshop > 0 ? ` (${m.rollsInWorkshop} рул.)` : ''}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-medium">{formatMoney(m.value)} ₽</span>
              </div>
            ))}

            {materials.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Свернуть' : `Показать все (${materials.length})`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StockValueCard;
