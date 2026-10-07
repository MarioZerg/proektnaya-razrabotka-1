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
import { cn } from '@/lib/utils';
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

const STATUS_TABS = [
  { value: 'all', label: 'Все' },
  { value: 'Новый', label: 'Ожидают' },
  { value: 'Завершено', label: 'Приняты' },
  { value: 'Отклонена', label: 'Отклонены' },
] as const;

/**
 * Фильтры приёмок: статус — крупные вкладки, поставщик и даты — отдельной строкой.
 * Раньше четыре поля в одной рамке занимали полэкрана и мешали списку.
 */
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
  const extraActive = [supplierFilter !== 'all', !!dateFrom, !!dateTo].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
              statusFilter === tab.value
                ? 'border-primary bg-primary/5 text-foreground shadow-sm'
                : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Поставщик</Label>
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
          <Label className="text-xs text-muted-foreground">С</Label>
          <Input
            type="date"
            className="w-full min-w-0"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">По</Label>
          <Input
            type="date"
            className="w-full min-w-0"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {extraActive > 0 && (
          <Button variant="ghost" className="h-10" onClick={onReset}>
            <Icon name="X" size={14} className="mr-1" />
            Сбросить
          </Button>
        )}
      </div>
    </div>
  );
};

export default SuppliesFilters;
