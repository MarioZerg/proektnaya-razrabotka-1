import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { fetchBoughtFeed, type BoughtOrder } from '@/lib/managerFinanceApi';

const PER_PAGE = 10;

const MP: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-blue-700' },
  WB: { label: 'WB', className: 'text-fuchsia-700' },
  Yandex: { label: 'Яндекс', className: 'text-amber-600' },
};

const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

const fullDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
};

/**
 * Выкупы — что покупатели реально забрали и сколько мы на этом заработали.
 *
 * В ленту попадают ТОЛЬКО выкупленные заказы: это деньги, которые уже наши.
 * Товар в доставке ещё может вернуться, и считать его выручкой рано.
 *
 * По каждой продаже видно цену покупки и маржу из юнит-экономики — сразу
 * понятно, заработали мы на вещи или отдали её себе в убыток. Раньше эти
 * цифры жили в разделе цен, отдельно от денег.
 */
const Buyouts = () => {
  const [page, setPage] = useState(1);
  // Границы периода. По умолчанию пусто — показываем все выкупы.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<{
    items: BoughtOrder[];
    total: number;
    pages: number;
    totals?: { revenue: number; profit: number; margin: number };
  }>({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchBoughtFeed(page, PER_PAGE, dateFrom, dateTo)
      .then((d) =>
        setData({
          items: d.items || [],
          total: d.total,
          pages: d.pages,
          totals: d.totals,
        }),
      )
      .catch(() => setData({ items: [], total: 0, pages: 1 }))
      .finally(() => setLoading(false));
  }, [page, dateFrom, dateTo]);

  // Смена периода возвращает на первую страницу: оставаться на сотой в новом
  // отборе бессмысленно — там пусто.
  const changeFrom = (v: string) => {
    setDateFrom(v);
    setPage(1);
  };
  const changeTo = (v: string) => {
    setDateTo(v);
    setPage(1);
  };

  const marginCell = (o: BoughtOrder) => {
    if (o.margin === null || o.margin === undefined) {
      return <span className="text-muted-foreground">—</span>;
    }
    const good = o.margin > 0;
    return (
      <span
        className={`font-medium ${good ? 'text-emerald-700' : 'text-rose-700'}`}
      >
        {o.profit !== null && o.profit !== undefined && (
          <>
            {good ? '+' : ''}
            {money(o.profit)} ₽{' '}
          </>
        )}
        <span className="text-xs">({o.margin}%)</span>
      </span>
    );
  };

  return (
    <CrmLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Выкупы</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Заказы, которые покупатели забрали: цена покупки и что осталось
              нам после всех расходов площадки
            </p>
          </div>
          <Badge variant="outline" className="text-sm">
            {data.total.toLocaleString('ru-RU')} выкуплено
          </Badge>
        </div>

        {/* Период и итог по нему. Вопрос «сколько заработали за неделю»
            решается тут, без выгрузок и калькулятора. */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-3">
            <div className="space-y-1">
              <Label className="text-xs">Выкуплены с</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => changeFrom(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">по</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => changeTo(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => {
                  changeFrom('');
                  changeTo('');
                }}
              >
                <Icon name="X" size={14} className="mr-1" />
                Сбросить
              </Button>
            )}

            {/* Итог считается по всему отбору, а не по видимой странице. */}
            {data.totals && (
              <div className="ml-auto flex flex-wrap gap-4 text-right">
                <div>
                  <p className="text-xs text-muted-foreground">Выручка</p>
                  <p className="text-base font-bold">
                    {money(data.totals.revenue)} ₽
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Заработали</p>
                  <p
                    className={`text-base font-bold ${
                      data.totals.profit > 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {data.totals.profit > 0 ? '+' : ''}
                    {money(data.totals.profit)} ₽
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Маржа</p>
                  <p className="text-base font-bold">{data.totals.margin}%</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загружаем…
          </div>
        )}

        {!loading && data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Выкупленных заказов пока нет
          </p>
        )}

        {/* Телефон: шесть колонок в строку не помещаются — показываем то же
            самое карточками. На компьютере остаётся обычная таблица. */}
        {!loading && data.items.length > 0 && (
          <>
            <div className="space-y-2 md:hidden">
              {data.items.map((o) => (
                <div
                  key={o.id}
                  className="rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {o.material || 'Без ткани'}{' '}
                        <span className="text-muted-foreground">
                          {o.width}×{o.height}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className={MP[o.marketplace]?.className}>
                          {MP[o.marketplace]?.label || o.marketplace}
                        </span>
                        {o.scheme ? ` · ${o.scheme}` : ''} ·{' '}
                        {fullDate(o.soldAt)}
                      </p>
                    </div>
                    <p className="shrink-0 text-base font-bold">
                      {money(o.price)} ₽
                    </p>
                  </div>
                  <p className="mt-1.5 border-t border-border pt-1.5 text-sm">
                    {marginCell(o)}
                  </p>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-md border border-border md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">
                      Товар
                    </TableHead>
                    <TableHead className="text-primary-foreground">
                      Размер
                    </TableHead>
                    <TableHead className="text-primary-foreground">
                      Площадка
                    </TableHead>
                    <TableHead className="text-primary-foreground">
                      Выкуплен
                    </TableHead>
                    <TableHead className="text-right text-primary-foreground">
                      Цена покупки
                    </TableHead>
                    <TableHead className="text-right text-primary-foreground">
                      Заработали
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">
                        {o.material || 'Без ткани'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {o.width}×{o.height}
                      </TableCell>
                      <TableCell>
                        <span className={MP[o.marketplace]?.className}>
                          {MP[o.marketplace]?.label || o.marketplace}
                        </span>
                        {o.scheme && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {o.scheme}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fullDate(o.soldAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-bold">
                        {money(o.price)} ₽
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {marginCell(o)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* Постраничный переход: выкупов тысячи, на экране держим десяток. */}
        {!loading && data.pages > 1 && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <Icon name="ChevronLeft" size={14} className="mr-1" />
              Назад
            </Button>
            <span className="text-sm text-muted-foreground">
              Страница {page} из {data.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Вперёд
              <Icon name="ChevronRight" size={14} className="ml-1" />
            </Button>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default Buyouts;
