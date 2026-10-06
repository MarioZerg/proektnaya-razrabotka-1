import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { usePolling } from '@/hooks/usePolling';
import { fetchLiveFloor, type LiveFloorData, type LiveOrder } from '@/lib/liveFloorApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import LiveFloorPipeline, { type Comet } from '@/components/crm/dashboard/liveFloor/LiveFloorPipeline';
import LiveFloorPeople from '@/components/crm/dashboard/liveFloor/LiveFloorPeople';
import LiveFloorFeed, { eventKey } from '@/components/crm/dashboard/liveFloor/LiveFloorFeed';
import LiveOrderChain from '@/components/crm/dashboard/liveFloor/LiveOrderChain';
import LiveOrderChip from '@/components/crm/dashboard/liveFloor/LiveOrderChip';
import {
  shortName,
  stageIndex,
  stageOf,
  useTicker,
  type StageKey,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

const POLL_MS = 12000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_COMETS = 8;

const UpdatedAgo = ({ at }: { at: number | null }) => {
  const now = useTicker();
  if (at == null) return null;
  const sec = Math.max(0, Math.round((now - at) / 1000));
  return <> · обновлено {sec < 5 ? 'только что' : `${sec} сек назад`}</>;
};

/**
 * ЖИВОЙ ЦЕХ — экран администратора: как вещи под своими номерами едут по цепочке
 * раскрой → оверлок → пошив → стикеровка → готово, и что каждый человек на смене
 * делает прямо сейчас.
 */
const LiveFloorCard = () => {
  const [data, setData] = useState<LiveFloorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workshop, setWorkshop] = useState<number | 'all'>('all');
  const [big, setBig] = useState(false);
  const [query, setQuery] = useState('');
  const [comets, setComets] = useState<Comet[]>([]);
  const [movedIds, setMovedIds] = useState<Set<number>>(new Set());
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  const [clockOffset, setClockOffset] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const prevStages = useRef<Map<number, StageKey> | null>(null);
  const prevEvents = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const load = useCallback(async () => {
    const later = (fn: () => void, ms: number) => {
      const list = timers.current;
      const t = setTimeout(() => {
        list.splice(list.indexOf(t), 1);
        fn();
      }, ms);
      list.push(t);
    };
    try {
      const d = await fetchLiveFloor();
      setError(null);
      setClockOffset(new Date(d.now).getTime() - Date.now());
      setUpdatedAt(Date.now());

      // Сравниваем с прошлым снимком: кто сдвинулся вперёд по цепочке, тот
      // вспыхивает и пролетает кометой по ленте.
      const stages = new Map<number, StageKey>(d.orders.map((o) => [o.id, stageOf(o)]));
      const prev = prevStages.current;
      if (prev) {
        const moved: number[] = [];
        const flying: Comet[] = [];
        d.orders.forEach((o) => {
          const nowStage = stages.get(o.id)!;
          const before = prev.get(o.id) ?? (nowStage === 'cutting' ? 'new' : undefined);
          if (before && before !== nowStage && stageIndex(nowStage) > stageIndex(before)) {
            moved.push(o.id);
            flying.push({ id: `${o.id}-${nowStage}-${Date.now()}`, orderNumber: o.orderNumber, from: before, to: nowStage });
          }
        });
        if (moved.length) {
          setMovedIds(new Set(moved));
          later(() => setMovedIds(new Set()), 4000);
          // Пачкой не запускаем — кометы идут друг за другом, иначе сливаются.
          flying.slice(0, MAX_COMETS).forEach((c, i) => {
            later(() => setComets((cs) => [...cs, c]), i * 450);
          });
        }
      }
      prevStages.current = stages;

      const keys = new Set(d.events.map(eventKey));
      if (prevEvents.current) {
        const fresh = new Set([...keys].filter((k) => !prevEvents.current!.has(k)));
        if (fresh.size) {
          setFreshKeys(fresh);
          later(() => setFreshKeys(new Set()), 5000);
        }
      }
      prevEvents.current = keys;

      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить живой цех');
    }
  }, []);

  usePolling(load, POLL_MS);

  const removeComet = useCallback((id: string) => {
    setComets((cs) => cs.filter((c) => c.id !== id));
  }, []);

  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBig(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [big]);

  const view = useMemo(() => {
    if (!data) return null;
    const inWs = (id: number | null) => workshop === 'all' || id == null || id === workshop;
    const people = data.people
      .filter((p) => workshop === 'all' || p.workshopId === workshop)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const orders = data.orders.filter((o) => inWs(o.workshopId));
    const events = data.events.filter((e) => inWs(e.workshopId));

    const byId = new Map<number, LiveOrder>(orders.map((o) => [o.id, o]));
    const hourAgo = Date.now() + clockOffset - HOUR_MS;
    const flows = [0, 0, 0, 0, 0, 0];
    orders.forEach((o) => {
      if (o.sewingStatus === 'На раскрое' && o.takenAt && new Date(o.takenAt).getTime() > hourAgo) {
        flows[0] += 1;
      }
    });
    events.forEach((e) => {
      if (new Date(e.at).getTime() < hourAgo) return;
      if (e.kind === 'cut') {
        flows[1] += 1;
        if (!byId.get(e.orderId)?.requiresOverlock) flows[2] += 1;
      } else if (e.kind === 'overlock') flows[2] += 1;
      else if (e.kind === 'taken') flows[3] += 1;
      else if (e.kind === 'sewn') flows[4] += 1;
      else if (e.kind === 'packed') flows[5] += 1;
    });

    const active = new Set<StageKey>();
    const holder = orders.find(
      (o) => o.sewingStatus === 'Раскроено' && o.requiresOverlock && !o.overlockedAt && o.overlockUserId,
    );
    if (orders.some((o) => o.sewingStatus === 'На раскрое' && o.assignedUserId)) active.add('cutting');
    if (holder) active.add('overlock');
    if (orders.some((o) => o.sewingStatus === 'В работе')) active.add('sewing');
    if (events.some((e) => e.kind === 'packed' && Date.now() + clockOffset - new Date(e.at).getTime() < 10 * 60000)) {
      active.add('stickering');
    }

    const stickeringQueue = orders
      .filter((o) => o.sewingStatus === 'Стикеровка')
      .sort((a, b) => (a.sewnAt || '').localeCompare(b.sewnAt || ''));

    const workshops = Array.from(
      new Map(
        data.people
          .filter((p) => p.workshopId != null)
          .map((p) => [p.workshopId as number, p.workshopName || `Цех #${p.workshopId}`]),
      ),
    ).sort((a, b) => a[1].localeCompare(b[1], 'ru'));

    return {
      people,
      orders,
      events,
      flows,
      active,
      holderName: holder?.overlockUserId ? shortName(data.names[String(holder.overlockUserId)]) : null,
      stickeringQueue,
      workshops,
    };
  }, [data, workshop, clockOffset]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (view && q.length >= 3 ? view.orders.filter((o) => o.orderNumber.toLowerCase().includes(q)) : []),
    [view, q],
  );
  const highlightIds = useMemo(() => new Set(matches.map((o) => o.id)), [matches]);

  const body = (
    <Card className={`overflow-hidden border-border shadow-none ${big ? 'min-h-full rounded-none border-0' : ''}`}>
      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative h-3 w-3 rounded-full bg-red-500" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold">
                Живой цех
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-600">
                  live
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Движение вещей по этапам и кто что делает прямо сейчас
                <UpdatedAgo at={updatedAt} />
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {view && view.workshops.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {[['all', 'Все цеха'] as const, ...view.workshops].map(([id, name]) => (
                  <button
                    key={String(id)}
                    type="button"
                    onClick={() => setWorkshop(id as number | 'all')}
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
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Где товар? Номер заказа"
                className="h-8 pl-8 text-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Очистить"
                >
                  <Icon name="X" size={14} />
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setBig((v) => !v)}>
              <Icon name={big ? 'X' : 'MonitorPlay'} size={14} className="mr-1.5" />
              {big ? 'Свернуть' : 'На весь экран'}
            </Button>
          </div>
        </div>

        {error && !data ? (
          <WarehouseFetchError title="Не удалось загрузить живой цех" description={error} onRetry={load} />
        ) : !view || !data ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Подключаемся к цеху…
          </div>
        ) : (
          <>
            <div className="rounded-2xl border bg-gradient-to-b from-muted/40 to-transparent px-3 pb-3 pt-5">
              <LiveFloorPipeline
                counts={data.counts}
                flows={view.flows}
                activeStages={view.active}
                overlockHolder={view.holderName}
                comets={comets}
                onCometDone={removeComet}
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

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-5">
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
                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Icon name="Tag" size={15} className="text-orange-500" />
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

              <aside className="min-w-0 space-y-2 lg:sticky lg:top-4 lg:self-start">
                <div className="flex items-center gap-2 text-sm">
                  <Icon name="TrendingUp" size={15} className="text-muted-foreground" />
                  <span className="font-semibold">Что только что случилось</span>
                </div>
                <div className={`overflow-y-auto pr-1 ${big ? 'max-h-[calc(100vh-280px)]' : 'max-h-[560px]'}`}>
                  <LiveFloorFeed
                    events={view.events}
                    names={data.names}
                    freshKeys={freshKeys}
                    onPickOrder={setQuery}
                  />
                </div>
              </aside>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  return big ? <div className="fixed inset-0 z-40 overflow-y-auto bg-background">{body}</div> : body;
};

export default LiveFloorCard;
