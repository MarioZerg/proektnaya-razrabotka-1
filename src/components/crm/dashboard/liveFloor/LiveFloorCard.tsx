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
  STAGES,
  inOverlockWork,
  personState,
  shortName,
  stageIndex,
  stageOf,
  useTicker,
  type StageKey,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

const POLL_MS = 12000;
// Свёрнутый блок показывает только сводку — дёргать сервер каждые 12 секунд незачем.
const POLL_COLLAPSED_MS = 60000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_COMETS = 8;
const OPEN_KEY = 'megatul_live_floor_open';

const COUNT_KEYS: Record<StageKey, keyof LiveFloorData['counts']> = {
  new: 'new',
  cutting: 'cutting',
  overlock: 'overlock',
  cutReady: 'cutReady',
  sewing: 'sewing',
  stickering: 'stickering',
  done: 'doneToday',
};

const UpdatedAgo = ({ at }: { at: number | null }) => {
  const now = useTicker();
  if (at == null) return null;
  const sec = Math.max(0, Math.round((now - at) / 1000));
  return <>обновлено {sec < 5 ? 'только что' : `${sec} сек назад`}</>;
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
  // Свёрнут по умолчанию: на телефоне раскрытый блок занимает несколько экранов.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const expanded = open || big;

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(OPEN_KEY, next ? '1' : '0');
      } catch {
        /* приватный режим браузера — просто не запоминаем */
      }
      return next;
    });
  };
  const [query, setQuery] = useState('');
  const [comets, setComets] = useState<Comet[]>([]);
  const [movedIds, setMovedIds] = useState<Set<number>>(new Set());
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  const [clockOffset, setClockOffset] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Лента короткой: при движении чуть раскрывается и через 10 с снова сжимается.
  const [feedOpen, setFeedOpen] = useState(false);
  const feedPinned = useRef(false);
  const feedCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevStages = useRef<Map<number, StageKey> | null>(null);
  const prevEvents = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // В свёрнутом виде ленты нет — кометы копились бы и вылетали пачкой при раскрытии.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      if (feedCollapseTimer.current) clearTimeout(feedCollapseTimer.current);
    };
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
        if (moved.length && expandedRef.current) {
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
          setFeedOpen(true);
          if (feedCollapseTimer.current) clearTimeout(feedCollapseTimer.current);
          feedCollapseTimer.current = setTimeout(() => {
            if (!feedPinned.current) setFeedOpen(false);
          }, 10000);
        }
      }
      prevEvents.current = keys;

      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить живой цех');
    }
  }, []);

  usePolling(load, expanded ? POLL_MS : POLL_COLLAPSED_MS);

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

    const nowMs = Date.now() + clockOffset;
    const states = people.map((p) => personState(p, orders, events, nowMs));

    // В работе на оверлоке — все такие вещи есть в снимке. Старый сервер
    // ещё кладёт в «Оверлок» всю очередь; перекладываем её в крой готов.
    const overlockBusy = data.orders.filter(inOverlockWork).length;
    const overlockQueued = Math.max(0, data.counts.overlock - overlockBusy);
    const counts = {
      ...data.counts,
      overlock: overlockBusy,
      cutReady: data.counts.cutReady + overlockQueued,
    };

    return {
      people,
      orders,
      events,
      flows,
      active,
      counts,
      holderName: holder?.overlockUserId ? shortName(data.names[String(holder.overlockUserId)]) : null,
      stickeringQueue,
      workshops,
      working: states.filter((s) => s.working).length,
      idle: states.filter((s) => s.idleAlert).length,
    };
  }, [data, workshop, clockOffset]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (view && q.length >= 3 ? view.orders.filter((o) => o.orderNumber.toLowerCase().includes(q)) : []),
    [view, q],
  );
  const highlightIds = useMemo(() => new Set(matches.map((o) => o.id)), [matches]);

  const body = (
    <Card className={`overflow-visible border-border shadow-none ${big ? 'min-h-full rounded-none border-0' : ''}`}>
      <CardContent className={`px-3 sm:px-6 ${expanded ? 'space-y-5 pt-6' : 'space-y-3 py-4'}`}>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={big ? undefined : toggleOpen}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative h-3 w-3 rounded-full bg-red-500" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-semibold">
                Живой цех
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-600">
                  live
                </span>
              </span>
              <span className="block text-xs text-muted-foreground">
                <span className="hidden sm:inline">
                  {expanded
                    ? 'Движение вещей по этапам и кто что делает прямо сейчас · '
                    : 'Люди, вещи и лента событий · '}
                </span>
                <UpdatedAgo at={updatedAt} />
              </span>
            </span>
          </button>
          {!big && (
            <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" onClick={toggleOpen}>
              <span className="hidden sm:inline">{expanded ? 'Свернуть' : 'Развернуть'}</span>
              <Icon
                name="ChevronDown"
                size={16}
                className={`transition-transform sm:ml-1 ${expanded ? 'rotate-180' : ''}`}
              />
            </Button>
          )}
        </div>

        {!expanded && (
          error && !data ? (
            <p className="text-xs text-destructive">
              Не удалось загрузить: {error}{' '}
              <button type="button" className="underline" onClick={load}>
                Повторить
              </button>
            </p>
          ) : view && data ? (
            <button type="button" onClick={toggleOpen} className="block w-full space-y-2 text-left">
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {STAGES.map((s) => (
                  <span
                    key={s.key}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: s.hex }} />
                    <span className="font-semibold tabular-nums">{view.counts[COUNT_KEYS[s.key]] ?? 0}</span>
                    <span className="text-muted-foreground">{s.label}</span>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                  на смене {view.people.length}
                </span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                  в работе {view.working}
                </span>
                {view.idle > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                    простой {view.idle}
                  </span>
                )}
                {view.holderName && (
                  <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-fuchsia-800">
                    оверлок: {view.holderName}
                  </span>
                )}
              </div>
            </button>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon name="Loader2" size={14} className="animate-spin" />
              Подключаемся к цеху…
            </p>
          )
        )}

        {expanded && (
          <>
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
              {big ? 'Выйти из полного экрана' : 'На весь экран'}
            </Button>
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
            <div className="overflow-visible rounded-2xl border bg-gradient-to-b from-muted/40 to-transparent px-3 pb-3 pt-4">
              <LiveFloorPipeline
                counts={view.counts}
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
                  onClick={() => {
                    setFeedOpen((v) => {
                      const next = !v;
                      feedPinned.current = next;
                      return next;
                    });
                  }}
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
                      onPickOrder={setQuery}
                      limit={feedOpen ? 12 : 3}
                    />
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
          </>
        )}
      </CardContent>
    </Card>
  );

  return big ? <div className="fixed inset-0 z-40 overflow-y-auto bg-background">{body}</div> : body;
};

export default LiveFloorCard;
