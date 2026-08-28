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
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Статус</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
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
      <div className="space-y-1.5">
        <Label className="text-xs">Поставщик</Label>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
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
      <div className="space-y-1.5">
        <Label className="text-xs">Дата от</Label>
        <Input type="date" className="w-full sm:w-[170px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Дата до</Label>
        <Input type="date" className="w-full sm:w-[170px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
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

export default SuppliesFilters;
