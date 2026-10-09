import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  CANCELLED_CUT_TAB,
  type StatusTab,
  type TabValue,
} from '@/components/crm/sewingItems/sewingItemsShared';

interface SewingItemsTabsSectionProps {
  visibleTabs: StatusTab[];
  activeTab: TabValue;
  setActiveTab: (v: TabValue) => void;
  setPage: (v: number) => void;
  countForTab: (tab: TabValue) => number;
  isSewer: boolean;
  loading: boolean;
}

/** Вкладки этапов и пояснения к особым очередям — просмотр и отменённый крой. */
const SewingItemsTabsSection = ({
  visibleTabs,
  activeTab,
  setActiveTab,
  setPage,
  countForTab,
  isSewer,
  loading,
}: SewingItemsTabsSectionProps) => {
  const prevCounts = useRef<Record<string, number>>({});
  const [bumped, setBumped] = useState<Set<string>>(() => new Set());
  const countsKey = visibleTabs.map((t) => `${t.value}:${countForTab(t.value)}`).join('|');

  useEffect(() => {
    const next = new Set<string>();
    for (const tab of visibleTabs) {
      const n = countForTab(tab.value);
      const was = prevCounts.current[tab.value];
      if (was !== undefined && was !== n) next.add(tab.value);
      prevCounts.current[tab.value] = n;
    }
    if (next.size === 0) return undefined;
    setBumped(next);
    const t = window.setTimeout(() => setBumped(new Set()), 700);
    return () => window.clearTimeout(t);
    // countsKey меняется, когда на вкладке прибавилось или убавилось.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey]);

  return (
  <>
    <Tabs
      value={activeTab}
      onValueChange={(v) => {
        setActiveTab(v as TabValue);
        setPage(1);
      }}
    >
      <TabsList className="flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto sm:flex-wrap">
        {visibleTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 gap-1.5">
            {tab.label}
            <Badge
              variant="secondary"
              className={`ml-1 ${bumped.has(tab.value) ? 'animate-count-bump' : ''}`}
            >
              {countForTab(tab.value)}
            </Badge>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>

    {/* Объясняем, что это за список и что с ним делать. Без пояснения
        вкладка выглядит как «мусорка отменённых», и вещи так и остались бы
        висеть на вешалках: непонятно, шить их или выбрасывать. */}
    {isSewer && activeTab === 'Раскроено' && !loading && (
      <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">
        <p className="flex items-start gap-2 font-semibold">
          <Icon name="Eye" size={16} className="mt-0.5 shrink-0" />
          Очередь раскроенных вещей — только просмотр
        </p>
        <p className="mt-1">
          Отсюда заказ взять нельзя. Следующую вещь выдаёт кнопка «Получить новый
          заказ» по очереди. Вкладка нужна, чтобы видеть, что скроили и что
          предстоит шить дальше.
        </p>
      </div>
    )}

    {activeTab === CANCELLED_CUT_TAB && !loading && (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="flex items-start gap-2 font-semibold">
          <Icon name="Scissors" size={16} className="mt-0.5 shrink-0" />
          Крой готов, но заказ отменил покупатель — вещи нужно доделать
        </p>
        <p className="mt-1">
          Ткань уже разрезана и в рулон не вернётся. Такую вещь дошивают и сдают
          на стикеровку как обычно: там ей напечатают складской стикер, и она
          уедет на полку хранения — ярлыка покупателя у неё не будет. Пока вещь
          не доведена до конца, она числится в цехе и на склад попасть не может.
        </p>
      </div>
    )}
  </>
  );
};

export default SewingItemsTabsSection;
