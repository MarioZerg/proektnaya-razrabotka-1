import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { ROLL_LOW_STOCK_THRESHOLD } from '@/components/crm/rolls/rollsShared';
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
  /** Показывать только заканчивающиеся рулоны — те же, что в виджете на главной. */
  lowStockOnly: boolean;
  setLowStockOnly: (v: boolean) => void;
  /** Сколько всего рулонов заканчивается — цифра на кнопке фильтра. */
  lowStockCount: number;
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
  lowStockOnly,
  setLowStockOnly,
  lowStockCount,
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

    {/* Заканчивающиеся рулоны — отдельной кнопкой, а не пунктом в списке статусов:
        это не статус, а тревога, и включают её чаще всего. Сюда же ведёт виджет
        с главной страницы. */}
    <Button
      variant={lowStockOnly ? 'destructive' : 'outline'}
      onClick={() => setLowStockOnly(!lowStockOnly)}
      className="justify-start gap-2"
    >
      <Icon name={lowStockOnly ? 'Check' : 'AlertTriangle'} size={16} />
      <span className="truncate">
        Заканчиваются (&lt;{ROLL_LOW_STOCK_THRESHOLD}&nbsp;м)
      </span>
      {lowStockCount > 0 && (
        <span
          className={`ml-auto shrink-0 rounded-full px-1.5 text-xs font-bold ${
            lowStockOnly
              ? 'bg-destructive-foreground/20'
              : 'bg-destructive text-destructive-foreground'
          }`}
        >
          {lowStockCount}
        </span>
      )}
    </Button>
  </div>
);

export default RollsFilters;
