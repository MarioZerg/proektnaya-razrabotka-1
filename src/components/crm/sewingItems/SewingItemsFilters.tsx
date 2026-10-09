import { useEffect, useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';
import {
  widthOptions,
  heightOptions,
  marketplaceOptions,
  marketplaceLogo,
} from '@/components/crm/sewingItems/sewingItemsShared';

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
  marketplaceFilter: string;
  setMarketplaceFilter: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  setPage: (v: number) => void;
  showSearch?: boolean;
  onReset: () => void;
  /** Закройщик/швея видят только заказы, назначенные на себя — выбирать другого
   * сотрудника им незачем, поэтому фильтр сотрудников для них скрыт. */
  /** Показывать выбор сотрудника. Швее и закройщику его не показываем: их вкладки
   * и так отфильтрованы по ним самим (швея — по своему пошиву, закройщик — по своему
   * крою), а выбор чужого имени ничего бы не дал — только создавал ощущение, что
   * человек видит и может взять чужую работу. Упаковщице фильтр нужен: она видит
   * заказы всех швей. */
  showEmployeeFilter?: boolean;
  /** Закройщик и швея работают только в своём цехе — выбор цеха им не нужен, фильтр скрыт. */
  showWorkshopFilter?: boolean;
}

const triggerClass = (active: boolean) =>
  `h-8 w-[calc(50%-0.25rem)] shrink-0 px-2.5 text-xs sm:w-[9rem] ${
    active ? 'border-sky-400 bg-sky-50 text-sky-900' : ''
  }`;

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
  marketplaceFilter,
  setMarketplaceFilter,
  searchQuery,
  setSearchQuery,
  setPage,
  showSearch = false,
  onReset,
  showEmployeeFilter = true,
  showWorkshopFilter = true,
}: SewingItemsFiltersProps) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Список цехов для фильтра — только активные (удалённые/выключенные цеха не должны
  // засорять выпадающий список, ведь заказов с их workshopId уже быть не может).
  const activeWorkshops = workshops.filter((w) => w.isActive);

  // Выбрали конкретный цех — показываем только его ткани. У каждого цеха свой набор
  // разрешённых материалов, и чужие в фильтре сбивают с толку: заказов с ними в этом
  // цехе всё равно нет. При «Все цеха» список полный.
  const visibleMaterials = useMemo(() => {
    if (workshopFilter === 'all') return materials;
    const w = workshops.find((x) => String(x.id) === workshopFilter);
    if (!w || !w.allowedMaterials?.length) return materials;
    const allowed = new Set(w.allowedMaterials);
    return materials.filter((m) => allowed.has(m.id));
  }, [workshopFilter, workshops, materials]);

  // Сменили цех, а выбранная ткань в нём не используется — сбрасываем фильтр, иначе
  // список заказов молча окажется пустым.
  useEffect(() => {
    if (materialFilter === 'all') return;
    if (!visibleMaterials.some((m) => String(m.id) === materialFilter)) {
      setMaterialFilter('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopFilter, visibleMaterials.length]);

  const activeCount = [
    typeFilter !== 'all',
    showEmployeeFilter && employeeFilter !== 'all',
    materialFilter !== 'all',
    widthFilter !== 'all',
    heightFilter !== 'all',
    showWorkshopFilter && workshopFilter !== 'all',
    marketplaceFilter !== 'all',
    showSearch && searchQuery.trim().length > 0,
  ].filter(Boolean).length;

  const filters = (
    <>
      <Select value={typeFilter} onValueChange={setTypeFilter}>
        <SelectTrigger className={triggerClass(typeFilter !== 'all')}>
          <SelectValue placeholder="Тип" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все типы</SelectItem>
          <SelectItem value="FBO">FBO</SelectItem>
          <SelectItem value="FBS">FBS</SelectItem>
          <SelectItem value="Индивидуальный">Индивидуальный</SelectItem>
          <SelectItem value="legal">Юр. лицо</SelectItem>
        </SelectContent>
      </Select>

      {showEmployeeFilter && (
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger className={triggerClass(employeeFilter !== 'all')}>
            <SelectValue placeholder="Сотрудник" />
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
      )}

      <Select value={materialFilter} onValueChange={setMaterialFilter}>
        <SelectTrigger className={triggerClass(materialFilter !== 'all')}>
          <SelectValue placeholder="Ткань" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все ткани</SelectItem>
          {visibleMaterials.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={widthFilter} onValueChange={setWidthFilter}>
        <SelectTrigger className={triggerClass(widthFilter !== 'all')}>
          <SelectValue placeholder="Ширина" />
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
        <SelectTrigger className={triggerClass(heightFilter !== 'all')}>
          <SelectValue placeholder="Высота" />
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

      {showWorkshopFilter && (
        <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
          <SelectTrigger className={triggerClass(workshopFilter !== 'all')}>
            <SelectValue placeholder="Цех" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все цеха</SelectItem>
            {activeWorkshops.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
        <SelectTrigger className={triggerClass(marketplaceFilter !== 'all')}>
          <SelectValue placeholder="Площадка" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все площадки</SelectItem>
          {marketplaceOptions.map((mp) => (
            <SelectItem key={mp} value={mp}>
              {marketplaceLogo[mp]?.label || mp}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-xs text-slate-600"
          onClick={onReset}
        >
          <Icon name="X" size={12} className="mr-1" />
          Сбросить
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showSearch && (
        <div className="relative w-full min-w-[12rem] sm:w-56 sm:flex-none">
          <Icon
            name="Search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Номер заказа или ШК"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0 sm:hidden"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <Icon name="SlidersHorizontal" size={14} className="mr-1.5" />
        Фильтры
        {activeCount > 0 && (
          <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-800">
            {activeCount}
          </span>
        )}
      </Button>

      <div
        className={`${
          mobileOpen ? 'flex w-full flex-wrap items-center gap-2' : 'hidden'
        } sm:contents`}
      >
        {filters}
      </div>
    </div>
  );
};

export default SewingItemsFilters;
