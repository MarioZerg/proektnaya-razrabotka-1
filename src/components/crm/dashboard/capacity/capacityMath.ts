import { fetchSewerPackedDays, type SewerPackedDay } from '@/lib/ordersApi';

export const MSK = 'Europe/Moscow';
/** Сколько последних рабочих дней берём, пока человек сам не попросит всю историю. */
export const RECENT_DAYS = 14;

export interface DayRow {
  key: string;
  label: string;
  total: number;
  fbs: number;
  bySewer: Map<number, number>;
}

export const rowsFromDays = (days: SewerPackedDay[]) => {
  const names = new Map<number, string>();
  const rows: DayRow[] = days.map((day) => {
    const bySewer = new Map<number, number>();
    day.sewers.forEach((sewer) => {
      bySewer.set(sewer.id, sewer.count);
      if (sewer.name) names.set(sewer.id, sewer.name);
    });
    return {
      key: day.date,
      label: formatDay(day.date),
      total: day.total,
      fbs: day.fbs,
      bySewer,
    };
  });
  return { rows, names };
};

/**
 * Сдача швей кэшируется на вкладку: повторное открытие окна не ходит на сервер.
 * Через 10 минут ответ считается устаревшим и берётся заново.
 */
const CACHE_MS = 10 * 60 * 1000;
let packedCache: { at: number; days: SewerPackedDay[] } | null = null;

export const loadPackedDays = async () => {
  if (packedCache && Date.now() - packedCache.at < CACHE_MS) return packedCache.days;
  const days = await fetchSewerPackedDays();
  if (!days) throw new Error('Сервер не отдал сдачу швей. Попробуйте позже.');
  packedCache = { at: Date.now(), days };
  return days;
};

export const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: MSK });

export const moscowHour = () => {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: MSK,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  return Number(hour);
};

export const weekdayOf = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 9, 0, 0)).getUTCDay();
};

export const addDays = (key: string, days: number) => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 9, 0, 0));
  return date.toLocaleDateString('en-CA', { timeZone: 'UTC' });
};

export const formatDay = (key: string, withWeekday = false) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 9, 0, 0)).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    weekday: withWeekday ? 'short' : undefined,
    timeZone: 'UTC',
  });
};

export const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

export const ruDays = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 дней';
  const rounded = Math.round(value * 10) / 10;
  const whole = Math.floor(rounded);
  const mod10 = whole % 10;
  const mod100 = whole % 100;
  const word = !Number.isInteger(rounded)
    ? 'дня'
    : mod10 === 1 && mod100 !== 11
      ? 'день'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'дня'
        : 'дней';
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace('.', ',');
  return `${text} ${word}`;
};

export const piecesWord = (value: number) => {
  const n = Math.abs(Math.round(value));
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? 'штука' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'штуки' : 'штук';
  return `${n} ${word}`;
};

/**
 * День, к которому очередь будет сдана.
 * Сегодня учитываем только остаток мощности: уже сданное из дня вычитаем.
 * Дальше идём по тем дням недели, в которые цех реально шил.
 */
export const finishOn = (
  pieces: number,
  rate: number,
  today: string,
  todaySewn: number,
  workdays: Set<number>,
) => {
  if (pieces <= 0) return 'уже в очереди нет';
  if (rate <= 0 || workdays.size === 0) return null;
  let left = pieces;
  if (workdays.has(weekdayOf(today))) {
    left -= Math.max(0, rate - todaySewn);
  }
  if (left <= 0) return 'сегодня';
  let cursor = addDays(today, 1);
  for (let step = 0; step < 400 && left > 0; step += 1) {
    if (workdays.has(weekdayOf(cursor))) {
      left -= rate;
      if (left <= 0) return formatDay(cursor, true);
    }
    cursor = addDays(cursor, 1);
  }
  return null;
};

/**
 * FBS приходит каждый день и шьётся первым. На FBO остаётся только
 * мощность минус этот приход. Очередь FBS, которая уже на конвейере,
 * тоже забирает дни, пока не разойдётся.
 */
export const planFbo = (
  capacity: number,
  fbsPerDay: number,
  fboPieces: number,
  fbsBacklog: number,
  today: string,
  todaySewn: number,
  workdays: Set<number>,
) => {
  const freePerDay = Math.max(0, capacity - fbsPerDay);
  const stalled = fboPieces > 0 && freePerDay <= 0;
  const fboOnlyDays = freePerDay > 0 ? fboPieces / freePerDay : 0;
  if (fboPieces <= 0 || capacity <= 0 || stalled || workdays.size === 0) {
    return { freePerDay, stalled, fboOnlyDays, withQueueDays: fboOnlyDays, finish: null as string | null };
  }
  let backlog = Math.max(0, fbsBacklog);
  let left = fboPieces;
  let cursor = today;
  let days = 0;
  let finish: string | null = null;
  for (let step = 0; step < 500 && left > 0; step += 1) {
    if (!workdays.has(weekdayOf(cursor))) {
      cursor = addDays(cursor, 1);
      continue;
    }
    const room = cursor === today ? Math.max(0, capacity - todaySewn) : capacity;
    if (room <= 0) {
      cursor = addDays(cursor, 1);
      continue;
    }
    if (cursor !== today) backlog += fbsPerDay;
    const sewFbs = Math.min(room, backlog);
    backlog -= sewFbs;
    left -= room - sewFbs;
    days += capacity > 0 ? room / capacity : 1;
    if (left <= 0) finish = cursor === today ? 'сегодня' : formatDay(cursor, true);
    cursor = addDays(cursor, 1);
  }
  return { freePerDay, stalled: left > 0, fboOnlyDays, withQueueDays: days, finish };
};

/** Сколько FBO успеют простикеровать к дате отвоза. FBS каждого дня шьётся первым. */
export const fboReadyBy = (
  capacity: number,
  fbsPerDay: number,
  fbsBacklog: number,
  today: string,
  todaySewn: number,
  workdays: Set<number>,
  haulDate: string,
) => {
  if (haulDate < today) return { past: true, pieces: 0 };
  let backlog = Math.max(0, fbsBacklog);
  let sewn = 0;
  let cursor = today;
  for (let step = 0; step < 500 && cursor <= haulDate; step += 1) {
    if (workdays.has(weekdayOf(cursor))) {
      const room = cursor === today ? Math.max(0, capacity - todaySewn) : capacity;
      if (room > 0) {
        if (cursor !== today) backlog += fbsPerDay;
        const sewFbs = Math.min(room, backlog);
        backlog -= sewFbs;
        sewn += room - sewFbs;
      }
    }
    if (cursor === haulDate) break;
    cursor = addDays(cursor, 1);
  }
  return { past: false, pieces: Math.floor(sewn) };
};

export interface SewerStat {
  id: number;
  name: string;
  perDay: number;
  days: number;
  total: number;
}

export interface CapacityReport {
  all: DayRow[];
  chart: DayRow[];
  windowDays: DayRow[];
  rate: number;
  fbsUsual: number;
  workdays: Set<number>;
  today: string;
  todayOpen: boolean;
  todaySewn: number;
  sewers: SewerStat[];
}

export type FboPlan = ReturnType<typeof planFbo>;
export type HaulForecast = ReturnType<typeof fboReadyBy>;

