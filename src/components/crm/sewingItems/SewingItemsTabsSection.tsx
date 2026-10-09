import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  CANCELLED_CUT_TAB,
  type StatusTab,
  type TabValue,
  visibleTabGroups,
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

/** Вкладки этапов, собранные по маршруту цеха, и пояснения к особым очередям. */
const SewingItemsTabsSection = ({
  visibleTabs,
  activeTab,
  setActiveTab,
  setPage,
  countForTab,
  isSewer,
  loading,
}: SewingItemsTabsSectionProps) => {
  const groups = useMemo(() => visibleTabGroups(visibleTabs), [visibleTabs]);
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
        <div className="flex flex-wrap items-start gap-2">
          {groups.map((group) => {
            const groupCount = group.tabs.reduce((sum, tab) => sum + countForTab(tab.value), 0);
            const hasActive = group.tabs.some((tab) => tab.value === activeTab);
            return (
              <div
                key={group.id}
                className={`flex w-max max-w-full flex-col gap-1 rounded-xl border border-l-[3px] px-1.5 pb-1.5 pt-1 max-sm:w-full ${
                  group.accent
                } ${
                  hasActive
                    ? 'border-slate-300 bg-white shadow-sm'
                    : 'border-slate-200 bg-slate-50/80'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </span>
                  {group.tabs.length > 1 && (
                    <span className="tabular-nums text-[10px] text-slate-400">{groupCount}</span>
                  )}
                </div>
                <TabsList className="flex h-auto max-w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                  {group.tabs.map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="h-8 shrink-0 gap-1 rounded-md bg-white/80 px-2.5 text-xs hover:bg-white data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm sm:text-sm"
                    >
                      {tab.label}
                      <Badge
                        variant="secondary"
                        className={`ml-0.5 px-1.5 py-0 text-[10px] ${
                          bumped.has(tab.value) ? 'animate-count-bump' : ''
                        }`}
                      >
                        {countForTab(tab.value)}
                      </Badge>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            );
          })}
        </div>
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
