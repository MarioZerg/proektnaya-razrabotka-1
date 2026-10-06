import { useEffect, useState } from 'react';
import type { LiveEventKind, LiveOrder, LivePerson } from '@/lib/liveFloorApi';

export type StageKey =
  | 'new'
  | 'cutting'
  | 'cutReady'
  | 'overlock'
  | 'sewing'
  | 'stickering'
  | 'done';

export interface StageDef {
  key: StageKey;
  label: string;
  icon: string;
  /** Цвет этапа для градиентов и точек на ленте — как бейджи конвейера. */
  hex: string;
  /** Классы бейджа/кружка этапа. */
  solid: string;
  soft: string;
}

// Оверлок стоит перед «Крой готов», как на конвейере: обметанная вещь
// возвращается в общую очередь кроя и оттуда уходит к швеям.
export const STAGES: StageDef[] = [
  { key: 'new', label: 'Новые', icon: 'ClipboardList', hex: '#64748b', solid: 'bg-slate-500 text-white', soft: 'bg-slate-100 text-slate-700' },
  { key: 'cutting', label: 'Раскрой', icon: 'Scissors', hex: '#f59e0b', solid: 'bg-amber-500 text-white', soft: 'bg-amber-50 text-amber-800' },
  { key: 'overlock', label: 'Оверлок', icon: 'Zap', hex: '#c026d3', solid: 'bg-fuchsia-600 text-white', soft: 'bg-fuchsia-50 text-fuchsia-800' },
  { key: 'cutReady', label: 'Крой готов', icon: 'Layers', hex: '#8b5cf6', solid: 'bg-violet-500 text-white', soft: 'bg-violet-50 text-violet-800' },
  { key: 'sewing', label: 'Пошив', icon: 'Shirt', hex: '#0ea5e9', solid: 'bg-sky-500 text-white', soft: 'bg-sky-50 text-sky-800' },
  { key: 'stickering', label: 'Стикеровка', icon: 'Tag', hex: '#f97316', solid: 'bg-orange-500 text-white', soft: 'bg-orange-50 text-orange-800' },
  { key: 'done', label: 'Готово', icon: 'PackageCheck', hex: '#059669', solid: 'bg-emerald-600 text-white', soft: 'bg-emerald-50 text-emerald-800' },
];

export const stageDef = (key: StageKey): StageDef => STAGES.find((s) => s.key === key) || STAGES[0];
export const stageIndex = (key: StageKey) => STAGES.findIndex((s) => s.key === key);

export const stageOf = (o: LiveOrder): StageKey => {
  switch (o.sewingStatus) {
    case 'Готовые':
      return 'done';
    case 'Стикеровка':
      return 'stickering';
    case 'В работе':
      return 'sewing';
    case 'Раскроено':
      return o.requiresOverlock && !o.overlockedAt ? 'overlock' : 'cutReady';
    case 'На раскрое':
      return 'cutting';
    default:
      return 'new';
  }
};

export const ROLE_LABEL: Record<string, string> = {
  cutter: 'Закройщики',
  sewer: 'Швеи',
  packer: 'Упаковка',
};

export const ROLE_ORDER = ['cutter', 'sewer', 'packer'];

export const EVENT_META: Record<LiveEventKind, { label: string; icon: string; stage: StageKey }> = {
  cut: { label: 'раскроен', icon: 'Scissors', stage: 'cutting' },
  overlock: { label: 'край обметан', icon: 'Zap', stage: 'overlock' },
  taken: { label: 'взят в пошив', icon: 'Hand', stage: 'sewing' },
  sewn: { label: 'отшит, на стикеровку', icon: 'Shirt', stage: 'stickering' },
  packed: { label: 'упакован', icon: 'PackageCheck', stage: 'done' },
};

export const initials = (name?: string | null) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Фамилия + инициал: «Иванова А.» — полное ФИО в плотной ленте не помещается. */
export const shortName = (name?: string | null) => {
  if (!name) return '—';
  const [last, first] = name.split(/\s+/);
  return first ? `${last} ${first[0]}.` : last;
};

export const productLabel = (o: Pick<LiveOrder, 'material' | 'width' | 'height'>) =>
  [o.material, o.width && o.height ? `${o.width}×${o.height}` : null].filter(Boolean).join(' ');

export const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });

/** «12:05» до часа, «1 ч 05 мин» дальше. */
export const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} мин`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const formatMinutes = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
};

export const formatAgo = (ms: number) =>
  ms < 60000 ? 'только что' : `${formatMinutes(ms)} назад`;

// Один таймер на весь экран: у каждой вещи свой отсчёт, и сотня setInterval
// на одной странице заметно грела бы планшет.
const tickListeners = new Set<(t: number) => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

export const useTicker = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    tickListeners.add(setNow);
    if (!tickTimer) {
      tickTimer = setInterval(() => {
        const t = Date.now();
        tickListeners.forEach((fn) => fn(t));
      }, 1000);
    }
    return () => {
      tickListeners.delete(setNow);
      if (tickListeners.size === 0 && tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    };
  }, []);
  return now;
};

/** Что человек держит в руках прямо сейчас. */
export const ordersInHands = (person: LivePerson, orders: LiveOrder[]) => {
  if (person.role === 'cutter') {
    return orders.filter((o) => o.sewingStatus === 'На раскрое' && o.assignedUserId === person.id);
  }
  if (person.role === 'sewer') {
    return orders.filter(
      (o) =>
        (o.sewingStatus === 'В работе' && o.assignedUserId === person.id) ||
        (o.sewingStatus === 'Раскроено' &&
          o.requiresOverlock &&
          !o.overlockedAt &&
          o.overlockUserId === person.id),
    );
  }
  return [];
};

/** С какого момента вещь на текущем этапе — от этого идёт таймер на фишке. */
export const stageSince = (o: LiveOrder): string | null => {
  switch (stageOf(o)) {
    case 'sewing':
      return o.takenAt;
    case 'overlock':
      return o.overlockTakenAt || o.cutAt;
    case 'cutReady':
      return o.overlockedAt || o.cutAt;
    case 'stickering':
      return o.sewnAt;
    case 'done':
      return o.packedAt;
    case 'cutting':
      return o.takenAt;
    default:
      return null;
  }
};

export interface ChainStep {
  key: StageKey;
  label: string;
  /** Когда этап закончен. */
  at: string | null;
  /** Когда за вещь на этом этапе взялись — от него считается чистое время этапа. */
  startedAt: string | null;
  userId: number | null;
  state: 'done' | 'current' | 'waiting' | 'pending';
}

/**
 * Цепочка вещи: раскрой → (оверлок) → пошив → стикеровка → готово.
 * «current» — с вещью работают прямо сейчас, «waiting» — она лежит и ждёт
 * следующего человека.
 */
export const chainOf = (o: LiveOrder): ChainStep[] => {
  const stage = stageOf(o);
  // У раскроя времени начала нет: taken_at перезаписывается, когда вещь берёт швея.
  const steps: Omit<ChainStep, 'state'>[] = [
    { key: 'cutting', label: 'Раскрой', at: o.cutAt, startedAt: null, userId: o.cutterUserId },
  ];
  if (o.requiresOverlock) {
    steps.push({
      key: 'overlock', label: 'Оверлок', at: o.overlockedAt, startedAt: o.overlockTakenAt, userId: o.overlockUserId,
    });
  }
  steps.push(
    {
      key: 'sewing', label: 'Пошив', at: o.sewnAt, startedAt: o.takenAt,
      userId: o.sewerUserId || (stage === 'sewing' ? o.assignedUserId : null),
    },
    { key: 'stickering', label: 'Стикеровка', at: o.packedAt, startedAt: o.sewnAt, userId: o.packerUserId },
    { key: 'done', label: 'Готово', at: o.packedAt, startedAt: null, userId: null },
  );

  const order: StageKey[] = steps.map((s) => s.key);
  let currentKey: StageKey;
  let working: boolean;
  switch (stage) {
    case 'new':
    case 'cutting':
      currentKey = 'cutting';
      working = stage === 'cutting';
      break;
    case 'overlock':
      currentKey = 'overlock';
      working = !!o.overlockUserId;
      break;
    case 'cutReady':
      currentKey = 'sewing';
      working = false;
      break;
    case 'sewing':
      currentKey = 'sewing';
      working = true;
      break;
    case 'stickering':
      currentKey = 'stickering';
      working = false;
      break;
    default:
      currentKey = 'done';
      working = false;
  }
  const currentIdx = order.indexOf(currentKey);
  return steps.map((s, i) => ({
    ...s,
    state:
      stage === 'done' || i < currentIdx
        ? 'done'
        : i === currentIdx
          ? working
            ? 'current'
            : 'waiting'
          : 'pending',
  }));
};
