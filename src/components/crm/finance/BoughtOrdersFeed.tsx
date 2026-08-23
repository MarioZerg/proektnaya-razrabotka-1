import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { fetchBoughtFeed, type BoughtOrder } from '@/lib/managerFinanceApi';

const PER_PAGE = 10;

/** Короткое имя площадки: полные названия съедают всю строку. */
const MP: Record<string, string> = {
  OZON: 'OZON',
  WB: 'WB',
  Yandex: 'Яндекс',
};

const money = (v: number | null) =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

/** Дата продажи в коротком виде: год в ленте за неделю только мешает. */
const shortDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

/**
 * Лента выкупленных заказов.
 *
 * Показываем ТОЛЬКО те заказы, что покупатель реально забрал — это деньги,
 * которые уже наши. Заказ в доставке ещё может вернуться, и считать его
 * выручкой рано.
 *
 * По каждой продаже видно цену покупки и маржу из юнит-экономики: сразу
 * понятно, заработали мы на этой вещи или отдали её себе в убыток.
 */
const BoughtOrdersFeed = () => {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    items: BoughtOrder[];
    total: number;
    pages: number;
  }>({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchBoughtFeed(page, PER_PAGE)
      .then((d) =>
        setData({ items: d.items || [], total: d.total, pages: d.pages }),
      )
      .catch(() => setData({ items: [], total: 0, pages: 1 }))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Icon name="ShoppingBag" size={16} />
            Выкупленные заказы
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {data.total.toLocaleString('ru-RU')} шт
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {loading && (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Icon name="Loader2" size={14} className="animate-spin" />
            Загружаем…
          </p>
        )}

        {!loading && data.items.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            Выкупленных заказов пока нет
          </p>
        )}

        {!loading &&
          data.items.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {o.material || 'Без ткани'}{' '}
                  <span className="text-muted-foreground">
                    {o.width}×{o.height}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {MP[o.marketplace] || o.marketplace}
                  {o.scheme ? ` · ${o.scheme}` : ''} · {shortDate(o.soldAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {/* Цена покупки — то, что заплатил покупатель. */}
                <p className="text-xs font-bold">{money(o.price)} ₽</p>
                <p
                  className={`text-[11px] ${
                    o.margin === null
                      ? 'text-muted-foreground'
                      : o.margin > 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                  }`}
                >
                  {o.margin === null ? (
                    'маржа —'
                  ) : (
                    <>
                      {o.profit !== null && (
                        <>
                          {o.profit > 0 ? '+' : ''}
                          {money(o.profit)} ₽ ·{' '}
                        </>
                      )}
                      {o.margin}%
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}

        {/* Постраничный переход: лента длинная, а на экране держим десяток. */}
        {!loading && data.pages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <Icon name="ChevronLeft" size={13} />
              Назад
            </Button>
            <span className="text-xs text-muted-foreground">
              {page} из {data.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Вперёд
              <Icon name="ChevronRight" size={13} />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BoughtOrdersFeed;
