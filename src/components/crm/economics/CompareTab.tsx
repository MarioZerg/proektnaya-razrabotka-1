import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  fetchCompare,
  MARKETPLACE_LABELS,
  type CompareRow,
  type MarketplaceCode,
} from '@/lib/unitEconomicsApi';
import { moneyShort, profitColor } from './economicsShared';

const ALL: { code: MarketplaceCode; scheme: 'FBO' | 'FBS' }[] = [
  { code: 'ozon', scheme: 'FBS' },
  { code: 'ozon', scheme: 'FBO' },
  { code: 'wildberries', scheme: 'FBS' },
  { code: 'wildberries', scheme: 'FBO' },
  { code: 'yandex_market', scheme: 'FBS' },
  { code: 'yandex_market', scheme: 'FBO' },
];

/**
 * Сравнение площадок и схем.
 *
 * Одна ткань и ширина сразу на всех площадках и в обеих схемах: видно, где вещь
 * приносит больше и какая схема выгоднее. Лучший вариант подсвечен — по нему и
 * стоит распределять товар.
 */
const CompareTab = () => {
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchCompare()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const withData = rows.filter((r) => r.variants.length > 0);
    if (!q) return withData;
    return withData.filter((r) => (r.material || '').toLowerCase().includes(q));
  }, [rows, search]);

  // Где выгоднее в целом: считаем, сколько позиций выигрывает каждый вариант.
  const winners = useMemo(() => {
    const map = new Map<string, number>();
    visible.forEach((r) => {
      if (!r.best) return;
      const key = `${r.best.marketplaceCode}|${r.best.scheme}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()]
      .map(([key, count]) => {
        const [code, scheme] = key.split('|');
        return { code: code as MarketplaceCode, scheme, count };
      })
      .sort((a, b) => b.count - a.count);
  }, [visible]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Считаем по всем площадкам…
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="font-bold text-amber-900">Пока нечего сравнивать</p>
        <p className="mt-1 text-sm text-amber-900">
          Зайдите на вкладку площадки и нажмите «Обновить цены» — после загрузки цен
          здесь появится сравнение
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {winners.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {winners.slice(0, 3).map((w) => (
            <div key={`${w.code}-${w.scheme}`} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Выгоднее всего</p>
              <p className="text-lg font-bold">
                {MARKETPLACE_LABELS[w.code]} {w.scheme}
              </p>
              <p className="text-xs text-muted-foreground">
                лучший вариант по {w.count} позициям
              </p>
            </div>
          ))}
        </div>
      )}

      <Input
        placeholder="Поиск по ткани"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      <Card className="shadow-none">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Товар</TableHead>
                <TableHead className="text-right">Себест.</TableHead>
                {ALL.map((v) => (
                  <TableHead key={`${v.code}-${v.scheme}`} className="text-right">
                    <div className="whitespace-nowrap">{MARKETPLACE_LABELS[v.code]}</div>
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {v.scheme}
                    </div>
                  </TableHead>
                ))}
                <TableHead>Лучше всего</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={`${r.material}-${r.width}`}>
                  <TableCell className="font-medium">
                    {r.material} · {r.width} см
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {moneyShort(r.productionCost)} ₽
                  </TableCell>
                  {ALL.map((v) => {
                    const found = r.variants.find(
                      (x) => x.marketplaceCode === v.code && x.scheme === v.scheme,
                    );
                    const isBest =
                      r.best &&
                      r.best.marketplaceCode === v.code &&
                      r.best.scheme === v.scheme;
                    return (
                      <TableCell
                        key={`${v.code}-${v.scheme}`}
                        className={`text-right ${isBest ? 'bg-emerald-50' : ''}`}
                      >
                        {found ? (
                          <>
                            <div className={`font-bold ${profitColor(found.margin)}`}>
                              {found.profit > 0 ? '+' : ''}
                              {moneyShort(found.profit)}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {found.margin}%
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    {r.best ? (
                      <Badge variant="secondary" className="whitespace-nowrap">
                        {MARKETPLACE_LABELS[r.best.marketplaceCode]} {r.best.scheme}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Прибыль с одной проданной вещи после всех расходов площадки, себестоимости и
        налога. Процент выкупа берётся реальный — по нашим заказам на каждой площадке
      </p>
    </div>
  );
};

export default CompareTab;
