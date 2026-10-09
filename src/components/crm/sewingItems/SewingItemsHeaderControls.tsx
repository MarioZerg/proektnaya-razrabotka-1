import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Workshop } from '@/lib/workshopsApi';

interface SewingItemsHeaderControlsProps {
  isProductionRole: boolean;
  workshops: Workshop[];
  workshopFilter: string;
  setWorkshopFilter: (v: string) => void;
}

/** Переключатель цехов над конвейером. Счётчики этапов живут на вкладках. */
const SewingItemsHeaderControls = ({
  isProductionRole,
  workshops,
  workshopFilter,
  setWorkshopFilter,
}: SewingItemsHeaderControlsProps) => {
  const activeWorkshops = workshops.filter((w) => w.isActive);
  if (isProductionRole || activeWorkshops.length <= 1) return null;

  return (
    <Tabs value={workshopFilter} onValueChange={setWorkshopFilter}>
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
        <TabsTrigger value="all" className="shrink-0">
          Все цеха
        </TabsTrigger>
        {activeWorkshops.map((w) => (
          <TabsTrigger key={w.id} value={String(w.id)} className="shrink-0">
            {w.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};

export default SewingItemsHeaderControls;
