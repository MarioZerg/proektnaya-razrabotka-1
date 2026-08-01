import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Employee } from '@/lib/usersApi';
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';
import { widthOptions, heightOptions, statusOptions } from '@/components/crm/sewingItems/sewingItemsShared';

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
  statusFilter: string;
  setStatusFilter: (v: string) => void;
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
  statusFilter,
  setStatusFilter,
  workshopFilter,
  setWorkshopFilter,
}: SewingItemsFiltersProps) => {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
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

      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger>
          <SelectValue placeholder="Все статусы" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все статусы</SelectItem>
          {statusOptions.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
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
  );
};

export default SewingItemsFilters;
