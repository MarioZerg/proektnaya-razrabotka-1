import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import type { RepairPieceStatus } from '@/lib/repairFabricApi';

interface RepairFabricFiltersProps {
  summary: Array<{ material: string; count: number }>;
  tab: RepairPieceStatus | 'all';
  setTab: (v: RepairPieceStatus | 'all') => void;
  material: string;
  setMaterial: (v: string) => void;
  materials: string[];
  isAdmin: boolean;
  search: string;
  setSearch: (v: string) => void;
}

const RepairFabricFilters = ({
  summary,
  tab,
  setTab,
  material,
  setMaterial,
  materials,
  isAdmin,
  search,
  setSearch,
}: RepairFabricFiltersProps) => (
  <>
    {/* Сводка по материалам — главное, что нужно закройщику: сколько
        чего есть в цехе, без вчитывания в строки. */}
    {summary.length > 0 && tab === 'available' && (
      <div className="flex flex-wrap gap-2">
        {summary.map((s) => (
          <button
            key={s.material}
            type="button"
            onClick={() => setMaterial(material === s.material ? 'all' : s.material)}
            className={`rounded-lg border-2 px-3 py-2 text-left transition ${
              material === s.material
                ? 'border-violet-500 bg-violet-50'
                : 'border-border hover:border-violet-300'
            }`}
          >
            <p className="text-xl font-bold">{s.count}</p>
            <p className="text-xs text-muted-foreground">{s.material}</p>
          </button>
        ))}
      </div>
    )}

    {/* Историю (израсходованные, списанные) показываем только админу:
        закройщику важен текущий остаток, а не архив. */}
    {isAdmin && (
      <Tabs value={tab} onValueChange={(v) => setTab(v as RepairPieceStatus | 'all')}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="available">В цехе</TabsTrigger>
          {/* Закреплённые — это куски, которые закройщица отложила под заказ,
              но ещё не разрезала. Их важно видеть отдельно: если вещь зависла,
              отсюда понятно, какой отрез лежит без движения. */}
          <TabsTrigger value="reserved">Под заказ</TabsTrigger>
          <TabsTrigger value="used">Израсходованы</TabsTrigger>
          <TabsTrigger value="written_off">Списаны</TabsTrigger>
          <TabsTrigger value="all">Все</TabsTrigger>
        </TabsList>
      </Tabs>
    )}

    <div className="flex flex-wrap gap-2">
      <Input
        placeholder="Поиск: номер RS-…, материал, размер, причина, кто отправил"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full sm:w-80"
      />
      {materials.length > 1 && material !== 'all' && (
        <Button variant="outline" size="sm" onClick={() => setMaterial('all')}>
          <Icon name="X" size={14} className="mr-1.5" />
          {material}
        </Button>
      )}
    </div>
  </>
);

export default RepairFabricFilters;
