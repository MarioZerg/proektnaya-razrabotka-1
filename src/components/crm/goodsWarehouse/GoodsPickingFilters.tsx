import type { RefObject } from 'react';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';

interface GoodsPickingFiltersProps {
  /** Поле поиска держим в фокусе: кладовщик пикает сканером, а не щёлкает мышкой. */
  searchRef: RefObject<HTMLInputElement>;
  search: string;
  setSearch: (value: string) => void;
  /** Сколько работы в списке — по ним решаем, показывать ли плитки FBS/FBO. */
  workOrdersCount: number;
  fbsCount: number;
  fboCount: number;
}

/** Поиск по списку подбора и две плитки-фильтра: FBS и FBO. */
const GoodsPickingFilters = ({
  searchRef,
  search,
  setSearch,
  workOrdersCount,
  fbsCount,
  fboCount,
}: GoodsPickingFiltersProps) => (
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
  </>
);

export default GoodsPickingFilters;
