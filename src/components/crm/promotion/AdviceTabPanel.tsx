import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import StrategySettingsCard from '@/components/crm/promotion/StrategySettingsCard';
import AdviceMarketplacePanel from '@/components/crm/promotion/AdviceMarketplacePanel';
import type { MarketplaceCode, OverviewResponse } from '@/lib/promotionApi';

interface AdviceTabPanelProps {
  marketplaces: { code: MarketplaceCode; label: string }[];
  marketplace: MarketplaceCode;
  setMarketplace: (code: MarketplaceCode) => void;
  data: OverviewResponse | null;
  selected: Set<number>;
  loading: boolean;
  busy: boolean;
  showSettings: boolean;
  onToggleSettings: () => void;
  onReload: () => void;
  marginMin: string;
  marginMax: string;
  stepPercent: string;
  stepDays: string;
  setMarginMin: (v: string) => void;
  setMarginMax: (v: string) => void;
  setStepPercent: (v: string) => void;
  setStepDays: (v: string) => void;
  onSaveStrategy: () => void;
  onToggle: (itemId: number) => void;
  onToggleAll: () => void;
  onPushOpen: () => void;
  onDecide: (decision: 'applied' | 'skipped') => void;
}

/**
 * Вкладка «Советы по товарам»: правила, выбор площадки и таблица советов.
 *
 * В отличие от робота, который ведёт весь магазин сам, здесь точечная работа:
 * каждое изменение цены владелец подтверждает вручную.
 */
const AdviceTabPanel = ({
  marketplaces,
  marketplace,
  setMarketplace,
  data,
  selected,
  loading,
  busy,
  showSettings,
  onToggleSettings,
  onReload,
  marginMin,
  marginMax,
  stepPercent,
  stepDays,
  setMarginMin,
  setMarginMax,
  setStepPercent,
  setStepDays,
  onSaveStrategy,
  onToggle,
  onToggleAll,
  onPushOpen,
  onDecide,
}: AdviceTabPanelProps) => {
  const s = data?.summary;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onToggleSettings}>
          <Icon name="Settings" size={14} className="mr-1.5" />
          Правила
        </Button>
        <Button variant="outline" size="sm" onClick={onReload} disabled={loading}>
          <Icon
            name={loading ? 'Loader2' : 'RefreshCw'}
            size={14}
            className={`mr-1.5 ${loading ? 'animate-spin' : ''}`}
          />
          Пересчитать
        </Button>
      </div>

      {showSettings && (
        <StrategySettingsCard
          marginMin={marginMin}
          marginMax={marginMax}
          stepPercent={stepPercent}
          stepDays={stepDays}
          setMarginMin={setMarginMin}
          setMarginMax={setMarginMax}
          setStepPercent={setStepPercent}
          setStepDays={setStepDays}
          busy={busy}
          onSave={onSaveStrategy}
        />
      )}

      <Tabs value={marketplace} onValueChange={(v) => setMarketplace(v as MarketplaceCode)}>
        <TabsList>
          {marketplaces.map((m) => (
            <TabsTrigger key={m.code} value={m.code}>
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {marketplaces.map((m) => (
          <TabsContent key={m.code} value={m.code} className="space-y-4 pt-4">
            <AdviceMarketplacePanel
              summary={s}
              items={data?.items || []}
              selected={selected}
              loading={loading}
              busy={busy}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              onPushOpen={onPushOpen}
              onDecide={onDecide}
            />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
};

export default AdviceTabPanel;
