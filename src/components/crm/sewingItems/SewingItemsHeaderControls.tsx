import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import type { Workshop } from '@/lib/workshopsApi';
import { type TabValue } from '@/components/crm/sewingItems/sewingItemsShared';

interface SewingItemsHeaderControlsProps {
  isProductionRole: boolean;
  workshops: Workshop[];
  workshopFilter: string;
  setWorkshopFilter: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  activeTab: TabValue;
  setActiveTab: (v: TabValue) => void;
  setPage: (v: number) => void;
  countForTab: (tab: TabValue) => number;
  piecesForTab: (tab: TabValue) => number;
}

/** Верх конвейера: переключатель цехов, поиск и три плитки со сводкой по этапам. */
const SewingItemsHeaderControls = ({
  isProductionRole,
  workshops,
  workshopFilter,
  setWorkshopFilter,
  searchQuery,
  setSearchQuery,
  activeTab,
  setActiveTab,
  setPage,
  countForTab,
  piecesForTab,
}: SewingItemsHeaderControlsProps) => (
  <>
    {/* Конвейер по цехам: у каждого цеха свои ткани и свои сотрудники, поэтому
        смешанный список читать неудобно. Переключатель открывает конвейер одного
        цеха. Производственным ролям он не нужен — они и так видят только свой цех. */}
    {!isProductionRole && workshops.filter((w) => w.isActive).length > 1 && (
      <Tabs value={workshopFilter} onValueChange={setWorkshopFilter}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="all" className="shrink-0">
            Все цеха
          </TabsTrigger>
          {workshops
            .filter((w) => w.isActive)
            .map((w) => (
              <TabsTrigger key={w.id} value={String(w.id)} className="shrink-0">
                {w.name}
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>
    )}

    {!isProductionRole && (
      <div className="relative">
        <Icon
          name="Search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Поиск по номеру заказа или ШК"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          className="pl-9"
        />
      </div>
    )}

    {!isProductionRole && (
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { tab: 'На раскрое' as TabValue, label: 'В закрое', icon: 'Scissors' },
            { tab: 'Раскроено' as TabValue, label: 'Раскроено', icon: 'CheckCircle2' },
            { tab: 'В работе' as TabValue, label: 'В пошиве', icon: 'Shirt' },
          ] as const
        ).map((s) => (
          <button
            key={s.tab}
            type="button"
            onClick={() => {
              setActiveTab(s.tab);
              setPage(1);
            }}
            className={`rounded-lg border p-2.5 text-left transition ${
              activeTab === s.tab ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
            }`}
          >
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Icon name={s.icon} size={12} />
              {s.label}
            </p>
            <p className="mt-1 text-xl font-bold leading-none tabular-nums">{piecesForTab(s.tab)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              шт · {countForTab(s.tab)} зак.
            </p>
          </button>
        ))}
      </div>
    )}
  </>
);

export default SewingItemsHeaderControls;
