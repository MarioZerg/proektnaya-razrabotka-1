import { Button } from '@/components/ui/button';
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
    <div className="flex flex-wrap items-center gap-3">
      {/* 1. Состояние вещи. «Возвраты с маркетплейса» — не статус, а происхождение:
          вещи, приехавшие обратно от покупателя, в любом состоянии. */}
      <div className="w-56">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {/* mp_return — состояние «лежит у кладовщика, полки нет».
                returns — происхождение вещи: она когда-либо приезжала назад, в любом
                состоянии. Названия разные, иначе два пункта не отличить. */}
            <SelectItem value="mp_return">Возврат с маркетплейса</SelectItem>
            <SelectItem value="returns">Все возвраты (за всё время)</SelectItem>
            <SelectItem value="awaiting_shelf">На разборе с производства</SelectItem>
            <SelectItem value="checking">На разборе с маркетплейса</SelectItem>
            <SelectItem value="repacking">На проверке</SelectItem>
            <SelectItem value="inspected">Осмотрено</SelectItem>
            <SelectItem value="taken">Забрано с производства</SelectItem>
            <SelectItem value="in_stock">На хранении</SelectItem>
            <SelectItem value="picking">На сборке</SelectItem>
            <SelectItem value="lost">Утерян</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 2. Материал */}
      <div className="w-48">
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
      <div className="w-40">
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
      <div className="w-40">
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
      <div className="w-52">
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

      {activeFiltersCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <Icon name="X" size={14} className="mr-1" />
          Сбросить ({activeFiltersCount})
        </Button>
      )}
    </div>
  );
};

export default GoodsWarehouseFilters;