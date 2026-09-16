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
import type { Supplier } from '@/lib/suppliersApi';

interface SuppliesFiltersProps {
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  supplierFilter: string;
  setSupplierFilter: (value: string) => void;
  suppliers: Supplier[];
  dateFrom: string;
  setDateFrom: (value: string) => void;
  dateTo: string;
  setDateTo: (value: string) => void;
  activeFiltersCount: number;
  onReset: () => void;
}

const SuppliesFilters = ({
  statusFilter,
  setStatusFilter,
  supplierFilter,
  setSupplierFilter,
  suppliers,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  activeFiltersCount,
  onReset,
}: SuppliesFiltersProps) => {
  return (
    // Сетка вместо flex с фиксированными ширинами: поля делят строку поровну
    // и сжимаются вместе с окном. Раньше четыре селекта по 170–200px выталкивали
    // правый край за экран, и страницу приходилось двигать вправо.
    <div className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Статус</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="Новый">Ожидает подтверждения</SelectItem>
              <SelectItem value="Завершено">Завершено</SelectItem>
              <SelectItem value="Отклонена">Отклонена</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Поставщик</Label>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все поставщики</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Дата от</Label>
          <Input
            type="date"
            className="w-full min-w-0 max-w-full"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Дата до</Label>
          <Input
            type="date"
            className="w-full min-w-0 max-w-full"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>
      {activeFiltersCount > 0 && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={onReset}>
          <Icon name="X" size={14} className="mr-1" />
          Сбросить
        </Button>
      )}
    </div>
  );
};

export default SuppliesFilters;
