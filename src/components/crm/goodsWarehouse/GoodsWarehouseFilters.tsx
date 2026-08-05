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
import { statusLabels, reasonLabels } from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface GoodsWarehouseFiltersProps {
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  materialFilter: string;
  setMaterialFilter: (value: string) => void;
  materials: string[];
  widthFilter: string;
  setWidthFilter: (value: string) => void;
  heightFilter: string;
  setHeightFilter: (value: string) => void;
  shelfFilter: string;
  setShelfFilter: (value: string) => void;
  reasonFilter: string;
  setReasonFilter: (value: string) => void;
  shelves: Shelf[];
  /** Сколько товаров лежит на каждой полке (id полки → количество) — чтобы кладовщик сразу
   * видел, сколько штук идти собирать, не открывая каждую полку. */
  shelfCounts: Record<number, number>;
  noShelfCount: number;
  activeFiltersCount: number;
  onReset: () => void;
}

const GoodsWarehouseFilters = ({
  statusFilter,
  setStatusFilter,
  materialFilter,
  setMaterialFilter,
  materials,
  widthFilter,
  setWidthFilter,
  heightFilter,
  setHeightFilter,
  shelfFilter,
  setShelfFilter,
  reasonFilter,
  setReasonFilter,
  shelves,
  shelfCounts,
  noShelfCount,
  activeFiltersCount,
  onReset,
}: GoodsWarehouseFiltersProps) => {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-52">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(statusLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-52">
        <Select value={reasonFilter || 'all'} onValueChange={(v) => setReasonFilter(v === 'all' ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Откуда" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой источник</SelectItem>
            {Object.entries(reasonLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-52">
        <Select value={materialFilter || 'all'} onValueChange={(v) => setMaterialFilter(v === 'all' ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Материал" />
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

      <Input
        type="number"
        placeholder="Ширина"
        value={widthFilter}
        onChange={(e) => setWidthFilter(e.target.value)}
        className="w-28"
      />
      <Input
        type="number"
        placeholder="Высота"
        value={heightFilter}
        onChange={(e) => setHeightFilter(e.target.value)}
        className="w-28"
      />

      <div className="w-52">
        <Select value={shelfFilter || 'all'} onValueChange={(v) => setShelfFilter(v === 'all' ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Полка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все полки</SelectItem>
            {noShelfCount > 0 && (
              <SelectItem value="none">Без полки — {noShelfCount} шт</SelectItem>
            )}
            {shelves.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name} — {shelfCounts[s.id] || 0} шт
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeFiltersCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <Icon name="X" size={14} className="mr-1" />
          Сбросить
        </Button>
      )}

      {/* Быстрый выбор полки: кладовщик видит остатки по всем полкам сразу и одним нажатием
          отбирает нужную, чтобы идти собирать именно её. Пустые полки не показываем. */}
      <div className="flex w-full flex-wrap gap-2">
        {shelves
          .filter((s) => (shelfCounts[s.id] || 0) > 0)
          .map((s) => {
            const active = shelfFilter === String(s.id);
            return (
              <button
                key={s.id}
                onClick={() => setShelfFilter(active ? '' : String(s.id))}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:bg-muted'
                }`}
              >
                <Icon name="Layers" size={14} />
                <span className="font-medium">{s.name}</span>
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    active ? 'bg-primary-foreground/20' : 'bg-muted-foreground/10'
                  }`}
                >
                  {shelfCounts[s.id]}
                </span>
              </button>
            );
          })}
        {noShelfCount > 0 && (
          <button
            onClick={() => setShelfFilter(shelfFilter === 'none' ? '' : 'none')}
            className={`flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-sm transition ${
              shelfFilter === 'none'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-muted'
            }`}
          >
            <Icon name="PackageX" size={14} />
            <span className="font-medium">Без полки</span>
            <span
              className={`rounded-full px-1.5 text-xs ${
                shelfFilter === 'none' ? 'bg-primary-foreground/20' : 'bg-muted-foreground/10'
              }`}
            >
              {noShelfCount}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default GoodsWarehouseFilters;
