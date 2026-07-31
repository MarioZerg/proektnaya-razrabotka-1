import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { ALL_MATERIALS } from '@/components/crm/marketplaceItems/marketplaceItemsShared';

interface ItemsToolbarProps {
  skuQuery: string;
  setSkuQuery: (v: string) => void;
  materialFilter: string;
  setMaterialFilter: (v: string) => void;
  setPage: (v: number) => void;
  materialOptions: string[];
  filteredCount: number;
}

const ItemsToolbar = ({
  skuQuery,
  setSkuQuery,
  materialFilter,
  setMaterialFilter,
  setPage,
  materialOptions,
  filteredCount,
}: ItemsToolbarProps) => {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full max-w-xs space-y-1.5">
        <Label>Поиск по SKU</Label>
        <div className="relative">
          <Icon
            name="Search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Например: vyal3_265"
            value={skuQuery}
            onChange={(e) => {
              setSkuQuery(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>
      </div>
      <div className="w-full max-w-xs space-y-1.5">
        <Label>Материал</Label>
        <Select
          value={materialFilter}
          onValueChange={(v) => {
            setMaterialFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_MATERIALS}>Все материалы</SelectItem>
            {materialOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(skuQuery || materialFilter !== ALL_MATERIALS) && (
        <Button
          variant="ghost"
          onClick={() => {
            setSkuQuery('');
            setMaterialFilter(ALL_MATERIALS);
            setPage(1);
          }}
        >
          <Icon name="X" size={14} className="mr-1" />
          Сбросить
        </Button>
      )}
      <p className="ml-auto text-sm text-muted-foreground">Найдено: {filteredCount}</p>
    </div>
  );
};

export default ItemsToolbar;
