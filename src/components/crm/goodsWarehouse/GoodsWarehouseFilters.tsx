import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Shelf } from '@/lib/shelvesApi';

interface GoodsWarehouseFiltersProps {
  /** Строка поиска: стикер хранения, номер заказа или название товара. */
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  materialFilter: string;
  setMaterialFilter: (value: string) => void;
  materials: string[];
  widthFilter: string;
  setWidthFilter: (value: string) => void;
  widths: number[];
  heightFilter: string;
  setHeightFilter: (value: string) => void;
  heights: number[];
  shelfFilter: string;
  setShelfFilter: (value: string) => void;
  shelves: Shelf[];
  /** Сколько товаров лежит на каждой полке (id полки → количество) — чтобы кладовщик сразу
   * видел, сколько штук идти собирать, не открывая каждую полку. */
  shelfCounts: Record<number, number>;
  noShelfCount: number;
  activeFiltersCount: number;
  onReset: () => void;
}

/**
 * Пять фильтров склада товара: состояние вещи, материал, ширина, высота и полка.
 *
 * Ширины и высоты берём из того, что реально лежит на складе: выбрать из списка быстрее
 * и без опечаток, чем набирать число руками.
 */
const GoodsWarehouseFilters = ({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  materialFilter,
  setMaterialFilter,
  materials,
  widthFilter,
  setWidthFilter,
  widths,
  heightFilter,
  setHeightFilter,
  heights,
  shelfFilter,
  setShelfFilter,
  shelves,
  shelfCounts,
  noShelfCount,
  activeFiltersCount,
  onReset,
}: GoodsWarehouseFiltersProps) => {
  return (
    <div className="space-y-3">
      {/* Поиск отдельной строкой над фильтрами: чаще всего кладовщик ищет ОДНУ вещь —
          пикает её стикер сканером или вбивает номер заказа. Перебирать ради этого
          фильтры бессмысленно. Сканер подставит код сам, поле ловит фокус первым. */}
      <div className="relative max-w-xl">
        <Icon
          name="Search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск: стикер хранения, номер заказа, товар или материал"
          className="h-11 pl-9 pr-9"
          autoComplete="off"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            title="Очистить поиск"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <Icon name="X" size={16} />
          </button>
        )}
      </div>

      {search.trim() && (
        <p className="text-xs text-muted-foreground">
          Ищем по всему складу — состояние вещи не учитывается
        </p>
      )}

    {/* Все пять фильтров в одну строку. Раньше у каждого была своя жёсткая ширина —
        в сумме они не помещались, и выбор полки уезжал на вторую строку, отодвигая
        таблицу вниз. Теперь это сетка: поля делят строку поровну и сжимаются вместе
        с окном. На телефоне встают в две колонки — там одна строка нечитаема. */}
    <div className="flex flex-wrap items-center gap-2">
      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {/* 1. Состояние вещи. «Возвраты с маркетплейса» — не статус, а происхождение:
          вещи, приехавшие обратно от покупателя, в любом состоянии. */}
      <div className="min-w-0">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {/* mp_return — состояние «приехал с ПВЗ, лежит у кладовщика».
                Этапы разбора и осмотра сюда не выносим: их место в воронке
                «Возвраты на осмотре», где по ним и работают. */}
            <SelectItem value="mp_return">Возврат с маркетплейса</SelectItem>
            <SelectItem value="repacking">На проверке</SelectItem>
            <SelectItem value="inspected">Осмотрено</SelectItem>
            <SelectItem value="taken">Забрано с производства</SelectItem>
            <SelectItem value="in_stock">На хранении</SelectItem>
            <SelectItem value="picking">На сборке</SelectItem>
            {/* Отстикерованные вещи, ждущие поставку: и FBS, и FBO. Кладовщику нужно
                быстро найти такую вещь, чтобы перепечатать ярлык маркетплейса. */}
            <SelectItem value="awaiting_supply">На поставке</SelectItem>
            <SelectItem value="lost">Утерян</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 2. Материал */}
      <div className="min-w-0">
        <Select
          value={materialFilter || 'all'}
          onValueChange={(v) => setMaterialFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все материалы</SelectItem>
            {materials.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 3. Ширина изделия */}
      <div className="min-w-0">
        <Select
          value={widthFilter || 'all'}
          onValueChange={(v) => setWidthFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все ширины</SelectItem>
            {widths.map((w) => (
              <SelectItem key={w} value={String(w)}>
                {w} см
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 4. Высота изделия */}
      <div className="min-w-0">
        <Select
          value={heightFilter || 'all'}
          onValueChange={(v) => setHeightFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все высоты</SelectItem>
            {heights.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h} см
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 5. Полка. Рядом с названием — сколько вещей на ней лежит. */}
      <div className="min-w-0">
        <Select
          value={shelfFilter || 'all'}
          onValueChange={(v) => setShelfFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все полки</SelectItem>
            {noShelfCount > 0 && (
              <SelectItem value="none">Без полки ({noShelfCount})</SelectItem>
            )}
            {shelves.map((sh) => (
              <SelectItem key={sh.id} value={String(sh.id)}>
                {sh.name}
                {shelfCounts[sh.id] ? ` (${shelfCounts[sh.id]})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      </div>

      {activeFiltersCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onReset} className="shrink-0">
          <Icon name="X" size={14} className="mr-1" />
          Сбросить ({activeFiltersCount})
        </Button>
      )}
      </div>
    </div>
  );
};

export default GoodsWarehouseFilters;