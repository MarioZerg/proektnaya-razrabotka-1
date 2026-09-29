import type { RefObject } from 'react';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import type { PickingShelfStat } from '@/components/crm/goodsWarehouse/useGoodsPicking';

interface GoodsPickingFiltersProps {
  /** Поле поиска держим в фокусе: кладовщик пикает сканером, а не щёлкает мышкой. */
  searchRef: RefObject<HTMLInputElement>;
  search: string;
  setSearch: (value: string) => void;
  /** Сколько работы в списке — по ним решаем, показывать ли плитки FBS/FBO. */
  workOrdersCount: number;
  fbsCount: number;
  fboCount: number;
  /** Выбранная полка: null — все. */
  shelfFilter: string | null;
  setShelfFilter: (value: string | null) => void;
  /** Полки из текущего подбора: имя и сколько штук на ней лежит. */
  shelfStats: PickingShelfStat[];
}

/** Поиск по списку подбора, плитки FBS/FBO и фильтр полок со счётчиками. */
const GoodsPickingFilters = ({
  searchRef,
  search,
  setSearch,
  workOrdersCount,
  fbsCount,
  fboCount,
  shelfFilter,
  setShelfFilter,
  shelfStats,
}: GoodsPickingFiltersProps) => {
  const allCount = shelfStats.reduce((sum, s) => sum + s.count, 0);
  const selectedShelf = shelfStats.find((s) => s.key === shelfFilter);

  return (
    <>
      {/* Поиск по списку: поле в фокусе, можно пикнуть сканером и сразу найти товар. */}
      <div className="relative max-w-xl">
        <Icon
          name="Search"
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={searchRef}
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск: товар, заказ, стикер или полка"
          className="pl-9 pr-9"
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              searchRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <Icon name="X" size={16} />
          </button>
        )}
      </div>

      {/* Два главных числа дня. FBS собирают поштучно — на каждую вещь свой ярлык
          маркетплейса; FBO складывают коробкой на склад площадки. Это разная работа
          и разный маршрут по складу, поэтому общая сумма кладовщику ничего не даёт:
          он планирует день по этим двум цифрам. Нажатие фильтрует список. */}
      {workOrdersCount > 0 && (
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSearch(search.toLowerCase() === 'fbs' ? '' : 'FBS')}
            className={`rounded-lg border-2 p-3 text-left transition ${
              search.toLowerCase() === 'fbs'
                ? 'border-sky-500 bg-sky-100'
                : 'border-sky-200 bg-sky-50 hover:bg-sky-100'
            }`}
          >
            <p className="text-3xl font-bold text-sky-800">{fbsCount}</p>
            <p className="text-sm font-medium text-sky-900">FBS — поштучно с ярлыком</p>
          </button>
          <button
            type="button"
            onClick={() => setSearch(search.toLowerCase() === 'fbo' ? '' : 'FBO')}
            className={`rounded-lg border-2 p-3 text-left transition ${
              search.toLowerCase() === 'fbo'
                ? 'border-violet-500 bg-violet-100'
                : 'border-violet-200 bg-violet-50 hover:bg-violet-100'
            }`}
          >
            <p className="text-3xl font-bold text-violet-800">{fboCount}</p>
            <p className="text-sm font-medium text-violet-900">FBO — коробкой на склад</p>
          </button>
        </div>
      )}

      {/* Кладовщик идёт вдоль стеллажа: выбирает полку и видит, сколько штук
          с неё собрать. Число — позиции в подборе на этой полке, не весь склад. */}
      {shelfStats.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-sm font-medium">Полки</p>
            {selectedShelf && (
              <p className="text-sm text-muted-foreground">
                На полке «{selectedShelf.name}»:{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {selectedShelf.count} шт
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={!shelfFilter}
              aria-label={`Все полки, ${allCount} шт`}
              onClick={() => setShelfFilter(null)}
              className={cn(
                'flex min-h-14 min-w-[3.75rem] flex-col items-center justify-center rounded-lg border-2 px-3 py-1.5',
                !shelfFilter
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:bg-muted/60',
              )}
            >
              <span className="text-xl font-bold tabular-nums leading-none">{allCount}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">Все</span>
            </button>
            {shelfStats.map((s) => {
              const on = shelfFilter === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  aria-label={
                    s.name === 'Без полки'
                      ? `Без полки, ${s.count} шт`
                      : `Полка ${s.name}, ${s.count} шт`
                  }
                  onClick={() => setShelfFilter(on ? null : s.key)}
                  className={cn(
                    'flex min-h-14 min-w-[3.75rem] flex-col items-center justify-center rounded-lg border-2 px-3 py-1.5',
                    on
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:bg-muted/60',
                  )}
                >
                  <span className="text-xl font-bold tabular-nums leading-none">{s.count}</span>
                  <span className="mt-0.5 max-w-[5rem] truncate text-xs text-muted-foreground">
                    {s.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default GoodsPickingFilters;
