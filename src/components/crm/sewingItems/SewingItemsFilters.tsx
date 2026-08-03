import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';
import { widthOptions, heightOptions } from '@/components/crm/sewingItems/sewingItemsShared';

interface SewingItemsFiltersProps {
  employees: Employee[];
  materials: Material[];
  workshops: Workshop[];
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  employeeFilter: string;
  setEmployeeFilter: (v: string) => void;
  materialFilter: string;
  setMaterialFilter: (v: string) => void;
  widthFilter: string;
  setWidthFilter: (v: string) => void;
  heightFilter: string;
  setHeightFilter: (v: string) => void;
  workshopFilter: string;
  setWorkshopFilter: (v: string) => void;
}

const SewingItemsFilters = ({
  employees,
  materials,
  workshops,
  typeFilter,
  setTypeFilter,
  employeeFilter,
  setEmployeeFilter,
  materialFilter,
  setMaterialFilter,
  widthFilter,
  setWidthFilter,
  heightFilter,
  setHeightFilter,
  workshopFilter,
  setWorkshopFilter,
}: SewingItemsFiltersProps) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-between sm:hidden"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          <Icon name="SlidersHorizontal" size={14} />
          Фильтры
        </span>
        <Icon name={mobileOpen ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </Button>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 ${mobileOpen ? 'mt-3 grid' : 'hidden'} sm:mt-0 sm:grid`}>
      <Select value={typeFilter} onValueChange={setTypeFilter}>
        <SelectTrigger>
          <SelectValue placeholder="Все типы" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все типы</SelectItem>
          <SelectItem value="FBO">FBO</SelectItem>
          <SelectItem value="FBS">FBS</SelectItem>
        </SelectContent>
      </Select>

      <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
        <SelectTrigger>
          <SelectValue placeholder="Все сотрудники" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все сотрудники</SelectItem>
          {employees.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {e.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={materialFilter} onValueChange={setMaterialFilter}>
        <SelectTrigger>
          <SelectValue placeholder="Все ткани" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все ткани</SelectItem>
          {materials.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={widthFilter} onValueChange={setWidthFilter}>
        <SelectTrigger>
          <SelectValue placeholder="Все ширины" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все ширины</SelectItem>
          {widthOptions.map((w) => (
            <SelectItem key={w} value={w}>
              {w}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={heightFilter} onValueChange={setHeightFilter}>
        <SelectTrigger>
          <SelectValue placeholder="Все высоты" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все высоты</SelectItem>
          {heightOptions.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
        <SelectTrigger>
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
    </div>
  );
};

export default SewingItemsFilters;