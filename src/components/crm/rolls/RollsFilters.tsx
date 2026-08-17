import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';

interface RollsFiltersProps {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  materialFilter: string;
  setMaterialFilter: (v: string) => void;
  workshopFilter: string;
  setWorkshopFilter: (v: string) => void;
  shiftFilter: string;
  setShiftFilter: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  /** Материалы своей роли: закройщику тюль, швее тесьма, упаковщице пакеты. */
  filterMaterials: Material[];
  workshops: Workshop[];
  /** Цех, выбранный в фильтре: из него берём названия смен. */
  filterWorkshop: Workshop | undefined;
}

/** Панель фильтров списка рулонов: статус, материал, цех, смена и поиск. */
const RollsFilters = ({
  statusFilter,
  setStatusFilter,
  materialFilter,
  setMaterialFilter,
  workshopFilter,
  setWorkshopFilter,
  shiftFilter,
  setShiftFilter,
  search,
  setSearch,
  filterMaterials,
  workshops,
  filterWorkshop,
}: RollsFiltersProps) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Select value={statusFilter} onValueChange={setStatusFilter}>
      <SelectTrigger>
        <SelectValue placeholder="Все статусы" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все статусы</SelectItem>
        <SelectItem value="in_storage">На складе</SelectItem>
        <SelectItem value="in_workshop">В цехе</SelectItem>
        <SelectItem value="completed">Завершён</SelectItem>
      </SelectContent>
    </Select>

    <Select value={materialFilter} onValueChange={setMaterialFilter}>
      <SelectTrigger>
        <SelectValue placeholder="Все материалы" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все материалы</SelectItem>
        {filterMaterials.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
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
        {/* Рулоны на складе цеху не принадлежат — их отбирают отдельным пунктом,
            иначе кладовщик не сможет посмотреть только складские. */}
        <SelectItem value="none">Без цеха (на складе)</SelectItem>
        {workshops.map((w) => (
          <SelectItem key={w.id} value={String(w.id)}>
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>

    {/* Смена выбирается внутри цеха: у каждого цеха свои смены и своё их число. */}
    <Select
      value={shiftFilter}
      onValueChange={setShiftFilter}
      disabled={filterWorkshop === undefined}
    >
      <SelectTrigger>
        <SelectValue placeholder={filterWorkshop ? 'Все смены' : 'Сначала выберите цех'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все смены</SelectItem>
        {(filterWorkshop?.shiftNames || []).map((name, idx) => (
          <SelectItem key={idx} value={String(idx + 1)}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>

    <Input
      placeholder="Поиск по штрихкоду"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />
  </div>
);

export default RollsFilters;
