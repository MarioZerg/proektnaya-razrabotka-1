import { useCallback, useEffect, useRef, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { fetchLiveFloor, type LiveFloorData, type LiveOrder } from '@/lib/liveFloorApi';
import { type Comet } from '@/components/crm/dashboard/liveFloor/LiveFloorPipeline';
import { eventKey } from '@/components/crm/dashboard/liveFloor/LiveFloorFeed';
import {
  inOverlockWork,
  personState,
  stageIndex,
  stageOf,
  type StageKey,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

const POLL_MS = 12000;
// Свёрнутый блок показывает только сводку — дёргать сервер каждые 12 секунд незачем.
const POLL_COLLAPSED_MS = 60000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_COMETS = 8;

export const buildLiveFloorView = (
  data: LiveFloorData | null,
  workshop: number | 'all',
  clockOffset: number,
) => {
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
    holderName: holder?.overlockUserId ? (data.names[String(holder.overlockUserId)] || null) : null,
    stickeringQueue,
    workshops,
    working: states.filter((s) => s.working).length,
    idle: states.filter((s) => s.idleAlert).length,
  };
};

export type LiveFloorView = NonNullable<ReturnType<typeof buildLiveFloorView>>;

/** Опрос живого цеха: снимок, кометы движения, свежие события и лента. */
export const useLiveFloorData = (expanded: boolean) => {
  const [data, setData] = useState<LiveFloorData | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const toggleFeed = () => {
    setFeedOpen((v) => {
      const next = !v;
      feedPinned.current = next;
      return next;
    });
  };

  return {
    data,
    error,
    comets,
    movedIds,
    freshKeys,
    clockOffset,
    updatedAt,
    feedOpen,
    toggleFeed,
    load,
    removeComet,
  };
};
