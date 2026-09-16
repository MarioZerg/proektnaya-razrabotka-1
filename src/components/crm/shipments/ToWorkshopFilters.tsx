import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';

interface ToWorkshopFiltersProps {
  materialFilter: string;
  setMaterialFilter: (value: string) => void;
  materials: Material[];
  isProduction: boolean;
  workshopFilter: string;
  setWorkshopFilter: (value: string) => void;
  workshops: Workshop[];
  shiftFilter: string;
  setShiftFilter: (value: string) => void;
  shiftOptions: number[];
  shiftOptionLabel: (shiftNumber: number) => string;
  activeFiltersCount: number;
  onReset: () => void;
}

/**
 * Фильтры списка заявок в цех. Та же рамка и сетка, что у приёмки от поставщика:
 * поля делят строку поровну и не выталкивают страницу вбок.
 */
const ToWorkshopFilters = ({
  materialFilter,
  setMaterialFilter,
  materials,
  isProduction,
  workshopFilter,
  setWorkshopFilter,
  workshops,
  shiftFilter,
  setShiftFilter,
  shiftOptions,
  shiftOptionLabel,
  activeFiltersCount,
  onReset,
}: ToWorkshopFiltersProps) => {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
      <div
        className={`grid grid-cols-1 gap-3 ${
          isProduction ? 'sm:grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-3'
        }`}
      >
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Материал</Label>
          <Select value={materialFilter} onValueChange={setMaterialFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Все материалы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все материалы</SelectItem>
              {materials.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Фильтр по цеху/смене нужен только админу и кладовщику — сотрудники цеха
            и так видят только заявки своего цеха и смены, им выбирать нечего. */}
        {!isProduction && (
          <>
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs">Цех</Label>
              <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Все цеха" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все цеха</SelectItem>
                  {workshops.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs">Смена</Label>
              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Все смены" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все смены</SelectItem>
                  {shiftOptions.map((num) => (
                    <SelectItem key={num} value={String(num)}>
                      {shiftOptionLabel(num)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
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

export default ToWorkshopFilters;
