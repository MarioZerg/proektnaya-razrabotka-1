import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import type { RepairPiecesTab } from '@/lib/repairFabricApi';

interface RepairFabricFiltersProps {
  summary: Array<{ material: string; count: number }>;
  tab: RepairPiecesTab;
  setTab: (v: RepairPiecesTab) => void;
  removalRequests?: number;
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
  removalRequests = 0,
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
    {/* Уведомление администратору: закройщики просят удалить куски. */}
    {isAdmin && removalRequests > 0 && tab !== 'removal' && (
      <button
        type="button"
        onClick={() => setTab('removal')}
        className="flex w-full items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-red-900 transition hover:bg-red-100"
      >
        <Icon name="BellRing" size={20} className="shrink-0 text-red-600" />
        <span className="flex-1 text-sm">
          <span className="font-semibold">Закройщики просят удалить куски: {removalRequests}</span>
          <span className="block text-xs text-red-800/80">
            Не соответствуют стикеру или бракованные. Откройте и решите: удалить, списать или оставить
          </span>
        </span>
        <Icon name="ChevronRight" size={18} className="shrink-0" />
      </button>
    )}

    {isAdmin && (
      <Tabs value={tab} onValueChange={(v) => setTab(v as RepairPiecesTab)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="available">В цехе</TabsTrigger>
          {/* Закреплённые — это куски, которые закройщица отложила под заказ,
              но ещё не разрезала. Их важно видеть отдельно: если вещь зависла,
              отсюда понятно, какой отрез лежит без движения. */}
          <TabsTrigger value="reserved">Под заказ</TabsTrigger>
          <TabsTrigger value="used">Израсходованы</TabsTrigger>
          <TabsTrigger value="written_off">Списаны</TabsTrigger>
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="removal" className="gap-1.5">
            Просят удалить
            {removalRequests > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-4 text-white">
                {removalRequests}
              </span>
            )}
          </TabsTrigger>
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
