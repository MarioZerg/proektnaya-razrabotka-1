import { useState } from 'react';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import Icon from '@/components/ui/icon';

interface ToMarketplaceFiltersProps {
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
}: ToMarketplaceFiltersProps) => {
  const [open, setOpen] = useState(false);
  const active =
    (statusFilter !== 'open' ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    (marketplaceFilter !== 'all' ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (search ? 1 : 0);

  return (
  <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
    <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40">
      <Icon
        name="ChevronRight"
        size={16}
        className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
      />
      <span className="font-medium">Фильтр</span>
      {active > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
          {active}
        </span>
      )}
    </CollapsibleTrigger>
    <CollapsibleContent>
  <div className="grid grid-cols-1 items-end gap-3 border-t border-border p-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">Статус</Label>
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-full lg:w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Все активные</SelectItem>
          <SelectItem value="Открытая">Открытая</SelectItem>
          <SelectItem value="На сборке">На сборке</SelectItem>
          <SelectItem value="Отгрузка">Отгрузка</SelectItem>
          <SelectItem value="Отгружено">Отгружено</SelectItem>
          <SelectItem value="Принята">Принята</SelectItem>
          <SelectItem value="Выполнена">Выполнена</SelectItem>
          <SelectItem value="Отменена">Отменена</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">Тип</Label>
      <Select value={typeFilter} onValueChange={setTypeFilter}>
        <SelectTrigger className="w-full lg:w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все типы</SelectItem>
          <SelectItem value="FBS">FBS</SelectItem>
          <SelectItem value="FBO">FBO</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-1">
      <Label className="text-xs">Маркетплейс</Label>
      <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
        <SelectTrigger className="w-full lg:w-[170px]">
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
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">Отгрузка от</Label>
      <Input type="date" className="w-full lg:w-[170px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
    </div>
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">Отгрузка до</Label>
      <Input type="date" className="w-full lg:w-[170px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
    </div>
    {/* Ищем по ходу набора — кнопка больше не нужна. Раньше без нажатия на
        неё набранный запрос не применялся, и человек видел старый список. */}
    <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-1">
      <Label className="text-xs">Поиск</Label>
      <div className="relative">
        <Icon
          name="Search"
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="w-full pl-8 lg:w-[180px]"
          placeholder="Номер поставки"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
    </div>
    <Button variant="ghost" size="sm" className="justify-start sm:col-span-2 lg:w-auto" onClick={onReset}>
      <Icon name="X" size={14} className="mr-1" />
      Сбросить
      <span className="hidden sm:inline">&nbsp;фильтр</span>
    </Button>
  </div>
    </CollapsibleContent>
  </Collapsible>
  );
};

export default ToMarketplaceFilters;
