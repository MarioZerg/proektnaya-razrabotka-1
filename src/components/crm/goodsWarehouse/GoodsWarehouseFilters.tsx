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
            {shelves.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
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
    </div>
  );
};

export default GoodsWarehouseFilters;
