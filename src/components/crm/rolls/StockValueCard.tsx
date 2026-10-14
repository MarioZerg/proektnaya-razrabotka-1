import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatQuantity } from '@/lib/formatQuantity';
import { fetchStockValue, type StockValue, type StockValueMaterial } from '@/lib/rollsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const rollsWord = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'рулон';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'рулона';
  return 'рулонов';
};

const qtyWithUnit = (qty: number, unit: string) => `${formatQuantity(qty)} ${unit}`;

const sharePercent = (value: number, total: number) =>
  total > 0 ? (value / total) * 100 : 0;

const MaterialMeta = ({ m }: { m: StockValueMaterial }) => (
  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
    {m.materialType ? (
      <Badge variant="secondary" className="font-normal">
        {m.materialType}
      </Badge>
    ) : null}
    {m.rollsWithoutCost > 0 ? (
      <Badge
        variant="secondary"
        className="bg-amber-100 font-normal text-amber-900 hover:bg-amber-100"
      >
        {m.rollsWithoutCost} без цены
      </Badge>
    ) : null}
  </div>
);

const MobileMaterialCard = ({
  m,
  totalValue,
}: {
  m: StockValueMaterial;
  totalValue: number;
}) => {
  const share = sharePercent(m.value, totalValue);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold leading-snug">{m.material}</p>
          <div className="mt-1">
            <MaterialMeta m={m} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold tabular-nums">{formatMoney(m.value)} ₽</p>
          {share >= 0.5 ? (
            <p className="text-[11px] text-muted-foreground tabular-nums">{share.toFixed(1)}%</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <span className="text-muted-foreground">Остаток</span>
        <span className="text-right tabular-nums">
          {qtyWithUnit(m.remaining, m.unit)}
          <span className="text-muted-foreground">
            {' '}
            · {m.rolls} {rollsWord(m.rolls)}
          </span>
        </span>
        <span className="text-muted-foreground">На складе</span>
        <span className="text-right tabular-nums">
          {qtyWithUnit(m.inStorage, m.unit)}
          {m.rollsInStorage > 0 ? (
            <span className="text-muted-foreground"> · {m.rollsInStorage} рул.</span>
          ) : null}
        </span>
        <span className="text-muted-foreground">В цехах</span>
        <span className="text-right tabular-nums">
          {m.inWorkshop > 0 ? (
            <>
              {qtyWithUnit(m.inWorkshop, m.unit)}
              {m.rollsInWorkshop > 0 ? (
                <span className="text-muted-foreground"> · {m.rollsInWorkshop} рул.</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      </div>

      {share >= 0.5 ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/70"
            style={{ width: `${Math.min(share, 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};

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
  const [listError, setListError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = () => {
    setLoading(true);
    fetchStockValue()
      .then((d) => {
        setListError(null);
        setData(d);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось посчитать остатки');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Считаю стоимость остатков…
        </CardContent>
      </Card>
    );
  }

  if (listError && !data) {
    return (
      <WarehouseFetchError
        title="Не удалось посчитать стоимость остатков"
        description={listError}
        onRetry={load}
      />
    );
  }

  if (!data) return null;

  const materials = data.byMaterial;
  const visible = expanded ? materials : materials.slice(0, 8);
  const totalRolls = materials.reduce((s, m) => s + m.rolls, 0);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon name="Wallet" size={18} className="text-muted-foreground" />
              Стоимость остатков
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              весь материал компании: на складе и выданный в цеха
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-3xl font-bold tracking-tight tabular-nums">
              {formatMoney(data.totalValue)} ₽
            </p>
            {materials.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {materials.length}{' '}
                {materials.length === 1 ? 'материал' : 'материалов'} · {totalRolls}{' '}
                {rollsWord(totalRolls)}
              </p>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
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
          <>
            {/* Мобилка: карточки — узкая таблица с 5 колонками плохо читается. */}
            <div className="space-y-2 md:hidden">
              {visible.map((m) => (
                <MobileMaterialCard key={m.materialId} m={m} totalValue={data.totalValue} />
              ))}
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-border md:block">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="min-w-[180px]">Материал</TableHead>
                    <TableHead className="text-right">Остаток</TableHead>
                    <TableHead className="text-right">Рулонов</TableHead>
                    <TableHead className="text-right">На складе</TableHead>
                    <TableHead className="text-right">В цехах</TableHead>
                    <TableHead className="text-right">Доля</TableHead>
                    <TableHead className="text-right">Стоимость</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((m) => {
                    const share = sharePercent(m.value, data.totalValue);
                    return (
                      <TableRow key={m.materialId}>
                        <TableCell>
                          <p className="max-w-[280px] font-medium leading-snug lg:max-w-none">
                            {m.material}
                          </p>
                          <div className="mt-1">
                            <MaterialMeta m={m} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {qtyWithUnit(m.remaining, m.unit)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{m.rolls}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {qtyWithUnit(m.inStorage, m.unit)}
                          {m.rollsInStorage > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {m.rollsInStorage} рул.
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {m.inWorkshop > 0 ? (
                            <>
                              {qtyWithUnit(m.inWorkshop, m.unit)}
                              {m.rollsInWorkshop > 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {m.rollsInWorkshop} рул.
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="ml-auto flex w-16 flex-col items-end gap-1">
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {share.toFixed(1)}%
                            </span>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary/70"
                                style={{ width: `${Math.min(share, 100)}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                          {formatMoney(m.value)} ₽
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {expanded || materials.length <= 8 ? (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={6} className="font-medium">
                        Итого
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums whitespace-nowrap">
                        {formatMoney(data.totalValue)} ₽
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </div>

            {materials.length > 8 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Свернуть' : `Показать все (${materials.length})`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StockValueCard;
