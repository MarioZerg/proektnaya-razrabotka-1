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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import type { SupplyType } from '@/lib/marketplaceSuppliesApi';

interface ToMarketplaceFiltersProps {
  creating: boolean;
  availableCreateOptions: Array<{ marketplace: string; type: SupplyType; label: string }>;
  onCreate: (marketplace: string, type: SupplyType) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  marketplaceFilter: string;
  setMarketplaceFilter: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  onReset: () => void;
}

const ToMarketplaceFilters = ({
  creating,
  availableCreateOptions,
  onCreate,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  marketplaceFilter,
  setMarketplaceFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  search,
  setSearch,
  onReset,
}: ToMarketplaceFiltersProps) => (
  <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/30 p-3">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={creating}>
          <Icon name="Plus" size={16} className="mr-2" />
          Создать поставку
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {availableCreateOptions.map((opt) => (
          <DropdownMenuItem key={opt.label} onClick={() => onCreate(opt.marketplace, opt.type)}>
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>

    <div className="space-y-1.5">
      <Label className="text-xs">Статус</Label>
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Все активные</SelectItem>
          <SelectItem value="Открытая">Открытая</SelectItem>
          <SelectItem value="На сборке">На сборке</SelectItem>
          <SelectItem value="Отгрузка">Отгрузка</SelectItem>
          <SelectItem value="Выполнена">Выполнена</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="space-y-1.5">
      <Label className="text-xs">Тип</Label>
      <Select value={typeFilter} onValueChange={setTypeFilter}>
        <SelectTrigger className="w-full sm:w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все типы</SelectItem>
          <SelectItem value="FBS">FBS</SelectItem>
          <SelectItem value="FBO">FBO</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="space-y-1.5">
      <Label className="text-xs">Маркетплейс</Label>
      <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
        <SelectTrigger className="w-full sm:w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все маркетплейсы</SelectItem>
          <SelectItem value="OZON">OZON</SelectItem>
          <SelectItem value="WB">WB</SelectItem>
          <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {/* 170px, а не 150: в поле даты браузер рисует свою кнопку календаря
        справа, и при 150px её обрезало краем — виден был только левый
        край значка. Дата с разделителями и кнопка вместе требуют больше
        места, чем обычное поле такой же ширины. */}
    <div className="space-y-1.5">
      <Label className="text-xs">Отгрузка от</Label>
      <Input type="date" className="w-full sm:w-[170px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
    </div>
    <div className="space-y-1.5">
      <Label className="text-xs">Отгрузка до</Label>
      <Input type="date" className="w-full sm:w-[170px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
    </div>
    {/* Ищем по ходу набора — кнопка больше не нужна. Раньше без нажатия на
        неё набранный запрос не применялся, и человек видел старый список. */}
    <div className="space-y-1.5">
      <Label className="text-xs">Поиск</Label>
      <div className="relative">
        <Icon
          name="Search"
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="w-full pl-8 sm:w-[180px]"
          placeholder="Номер поставки"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
    </div>
    <Button variant="ghost" size="sm" onClick={onReset}>
      <Icon name="X" size={14} className="mr-1" />
      Сбросить фильтр
    </Button>
  </div>
);

export default ToMarketplaceFilters;
