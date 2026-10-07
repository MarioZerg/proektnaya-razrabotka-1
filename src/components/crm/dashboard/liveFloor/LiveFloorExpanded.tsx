import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import type { LiveFloorData, LiveOrder } from '@/lib/liveFloorApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import LiveFloorPipeline, { type Comet } from '@/components/crm/dashboard/liveFloor/LiveFloorPipeline';
import LiveFloorPeople from '@/components/crm/dashboard/liveFloor/LiveFloorPeople';
import LiveFloorFeed from '@/components/crm/dashboard/liveFloor/LiveFloorFeed';
import LiveOrderChain from '@/components/crm/dashboard/liveFloor/LiveOrderChain';
import LiveOrderChip from '@/components/crm/dashboard/liveFloor/LiveOrderChip';
import type { LiveFloorView } from '@/components/crm/dashboard/liveFloor/useLiveFloorData';

interface LiveFloorExpandedProps {
  data: LiveFloorData | null;
  view: LiveFloorView | null;
  error: string | null;
  onRetry: () => void;
  big: boolean;
  onToggleBig: () => void;
  workshop: number | 'all';
  onWorkshopChange: (id: number | 'all') => void;
  query: string;
  onQueryChange: (q: string) => void;
  q: string;
  matches: LiveOrder[];
  highlightIds: Set<number>;
  comets: Comet[];
  onCometDone: (id: string) => void;
  movedIds: Set<number>;
  freshKeys: Set<string>;
  clockOffset: number;
  feedOpen: boolean;
  onToggleFeed: () => void;
}

/** Раскрытый вид: фильтры, конвейер, поиск, люди, стикеровка и лента событий. */
const LiveFloorExpanded = ({
  data,
  view,
  error,
  onRetry,
  big,
  onToggleBig,
  workshop,
  onWorkshopChange,
  query,
  onQueryChange,
  q,
  matches,
  highlightIds,
  comets,
  onCometDone,
  movedIds,
  freshKeys,
  clockOffset,
  feedOpen,
  onToggleFeed,
}: LiveFloorExpandedProps) => (
  <>
    <div className="flex flex-wrap items-center gap-2">
      {view && view.workshops.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {[['all', 'Все цеха'] as const, ...view.workshops].map(([id, name]) => (
            <button
              key={String(id)}
              type="button"
              onClick={() => onWorkshopChange(id as number | 'all')}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                workshop === id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="relative w-full sm:w-56">
        <Icon name="Search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Где товар? Номер заказа"
          className="h-8 pl-8 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Очистить"
          >
            <Icon name="X" size={14} />
          </button>
        )}
      </div>
      <Button variant="outline" size="sm" className="h-8" onClick={onToggleBig}>
        <Icon name={big ? 'X' : 'MonitorPlay'} size={14} className="mr-1.5" />
        {big ? 'Выйти из полного экрана' : 'На весь экран'}
      </Button>
    </div>

    {error && !data ? (
      <WarehouseFetchError title="Не удалось загрузить живой цех" description={error} onRetry={onRetry} />
    ) : !view || !data ? (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Подключаемся к цеху…
      </div>
    ) : (
      <>
        <div className="overflow-visible rounded-2xl border bg-gradient-to-b from-muted/40 to-transparent px-3 pb-3 pt-4">
          <LiveFloorPipeline
            counts={view.counts}
            flows={view.flows}
            activeStages={view.active}
            overlockHolder={view.holderName}
            comets={comets}
            onCometDone={onCometDone}
          />
          {workshop !== 'all' && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Счётчики этапов — по всему конвейеру, люди и движение — по выбранному цеху
            </p>
          )}
        </div>

        {q.length >= 3 && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            {matches.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                «{query.trim()}» в живом цехе нет — последние 3 часа вещь не двигалась.
                Найдите её на странице «Пошив» через поиск по номеру.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {matches.slice(0, 3).map((o) => (
                  <div key={o.id} className="rounded-lg border bg-card p-3">
                    <LiveOrderChain order={o} names={data.names} clockOffset={clockOffset} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <LiveFloorPeople
              people={view.people}
              orders={view.orders}
              events={view.events}
              today={data.today}
              names={data.names}
              clockOffset={clockOffset}
              movedIds={movedIds}
              highlightIds={highlightIds}
            />

            {view.stickeringQueue.length > 0 && (
              <section className="rounded-2xl border p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                    <Icon name="Tag" size={16} />
                  </span>
                  <span className="font-semibold">Ждут стикеровки</span>
                  <span className="text-xs text-muted-foreground">
                    {view.stickeringQueue.length} · сначала самые давние
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
                  {view.stickeringQueue.slice(0, 18).map((o) => (
                    <div key={o.id} className="min-w-0 animate-scale-in">
                      <LiveOrderChip
                        order={o}
                        names={data.names}
                        clockOffset={clockOffset}
                        moved={movedIds.has(o.id)}
                        highlighted={highlightIds.has(o.id)}
                        slowAfterMin={30}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="min-w-0 rounded-2xl border p-3 xl:sticky xl:top-4 xl:self-start">
            <button
              type="button"
              onClick={onToggleFeed}
              aria-expanded={feedOpen}
              className="mb-2 flex w-full items-center gap-2 text-left text-sm"
            >
              <Icon name="TrendingUp" size={15} className="text-muted-foreground" />
              <span className="font-semibold">Что только что случилось</span>
              {freshKeys.size > 0 && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                  +{freshKeys.size}
                </span>
              )}
              <Icon
                name="ChevronDown"
                size={16}
                className={`ml-auto shrink-0 text-muted-foreground transition-transform ${
                  feedOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            <div
              className={`overflow-hidden transition-[max-height] duration-500 ease-out ${
                feedOpen
                  ? big
                    ? 'max-h-[calc(100vh-220px)]'
                    : 'max-h-[320px]'
                  : 'max-h-[7.25rem]'
              }`}
            >
              <div className={`overflow-y-auto pr-1 ${feedOpen ? 'max-h-[inherit]' : 'max-h-[7.25rem]'}`}>
                <LiveFloorFeed
                  events={view.events}
                  names={data.names}
                  freshKeys={freshKeys}
                  onPickOrder={onQueryChange}
                  limit={feedOpen ? 12 : 3}
                />
              </div>
            </div>
          </aside>
        </div>
      </>
    )}
  </>
);

export default LiveFloorExpanded;
