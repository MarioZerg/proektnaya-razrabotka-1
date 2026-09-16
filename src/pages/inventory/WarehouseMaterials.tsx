import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import { STOCK_LOW_LIMIT, STOCK_MEDIUM_LIMIT } from '@/lib/stockLevels';
import WarehouseMaterialsTable from '@/components/crm/warehouseMaterials/WarehouseMaterialsTable';
import {
  groupByType,
  matchesStockFilter,
  warehouseStatus,
  type StockFilter,
} from '@/components/crm/warehouseMaterials/warehouseMaterialsShared';

const STOCK_TABS: { value: StockFilter; title: string; hint: string }[] = [
  { value: 'all', title: 'Все', hint: 'Позиции на складе' },
  { value: 'in_stock', title: 'В наличии', hint: 'Есть рулоны' },
  { value: 'low', title: 'Мало', hint: `Меньше ${STOCK_LOW_LIMIT} пог.м` },
  { value: 'empty', title: 'Нет на складе', hint: 'Рулонов нет' },
];

const WarehouseMaterials = () => {
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchMaterialsData()
      .then((data) => {
        setTypes(data.types);
        setMaterials(data.materials);
      })
      .finally(() => setLoading(false));
  }, []);

  const activeMaterials = useMemo(
    () => materials.filter((m) => m.status === 'active'),
    [materials]
  );

  const stockCounts = useMemo(() => {
    const counts: Record<StockFilter, number> = {
      all: activeMaterials.length,
      in_stock: 0,
      low: 0,
      empty: 0,
    };
    activeMaterials.forEach((m) => {
      const kind = warehouseStatus(m).kind;
      if (kind === 'empty') counts.empty += 1;
      else counts.in_stock += 1;
      if (kind === 'low') counts.low += 1;
    });
    return counts;
  }, [activeMaterials]);

  const typesWithMaterials = useMemo(
    () =>
      types.filter((t) => activeMaterials.some((m) => m.typeId === t.id)),
    [types, activeMaterials]
  );

  const visibleMaterials = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeMaterials.filter((m) => {
      if (typeFilter !== 'all' && m.typeId !== typeFilter) return false;
      if (!matchesStockFilter(m, stockFilter)) return false;
      if (q && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activeMaterials, typeFilter, stockFilter, search]);

  const groups = useMemo(
    () => groupByType(types, visibleMaterials),
    [types, visibleMaterials]
  );

  // Группу убрали из справочника, а фильтр на неё ещё стоит — сбрасываем, иначе
  // таблица молча останется пустой.
  useEffect(() => {
    if (typeFilter !== 'all' && !typesWithMaterials.some((t) => t.id === typeFilter)) {
      setTypeFilter('all');
    }
  }, [typesWithMaterials, typeFilter]);

  const filtered =
    stockFilter !== 'all' || typeFilter !== 'all' || search.trim().length > 0;

  return (
    <CrmLayout>
      <div className="min-w-0 space-y-6 overflow-x-hidden">
        <div>
          <h1 className="text-xl font-bold">Материалы на складе</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Что физически лежит на складе. Материал, выданный в цеха, сюда не входит —
            его видно в «Стоимости остатков» на странице рулонов
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STOCK_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStockFilter(tab.value)}
              className={cn(
                'min-w-0 rounded-md border px-3 py-3 text-left transition-colors',
                stockFilter === tab.value
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-card hover:bg-muted/40'
              )}
            >
              <div className="text-sm font-semibold">{tab.title}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums leading-none">
                {stockCounts[tab.value]}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">{tab.hint}</div>
            </button>
          ))}
        </div>

        <div className="relative max-w-xl">
          <Icon
            name="Search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию материала"
            className="h-10 pl-9 pr-9"
            autoComplete="off"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              title="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" size={16} />
            </button>
          )}
        </div>

        {typesWithMaterials.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={typeFilter === 'all' ? 'default' : 'outline'}
              className="h-8"
              onClick={() => setTypeFilter('all')}
            >
              Все группы
              <span className="opacity-70">{activeMaterials.length}</span>
            </Button>
            {typesWithMaterials.map((t) => {
              const count = activeMaterials.filter((m) => m.typeId === t.id).length;
              const selected = typeFilter === t.id;
              return (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  className="h-8"
                  onClick={() => setTypeFilter(selected ? 'all' : t.id)}
                >
                  {t.name}
                  <span className="opacity-70">{count}</span>
                </Button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-red-100 ring-1 ring-red-300" />
            меньше {STOCK_LOW_LIMIT} пог.м
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" />
            до {STOCK_MEDIUM_LIMIT} пог.м
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-300" />
            свыше {STOCK_MEDIUM_LIMIT} пог.м
          </span>
        </div>

        <WarehouseMaterialsTable loading={loading} groups={groups} filtered={filtered} />
      </div>
    </CrmLayout>
  );
};

export default WarehouseMaterials;
