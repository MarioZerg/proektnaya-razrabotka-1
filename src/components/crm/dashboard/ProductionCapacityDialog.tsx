import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { fetchSewerPackedDays, type SewerPackedDay } from '@/lib/ordersApi';
import { fetchLogEvents, type LogStage } from '@/lib/logsApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';

const MSK = 'Europe/Moscow';
/** Сколько последних рабочих дней берём, пока человек сам не попросит всю историю. */
const RECENT_DAYS = 14;

interface ProductionCapacityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** FBS на конвейере: эти штуки шьются раньше FBO. */
  fbsQueue: number;
  /** FBO на конвейере — подставляется в поле, цифру можно заменить. */
  fboQueue: number;
}

interface DayRow {
  key: string;
  label: string;
  total: number;
  fbs: number;
  bySewer: Map<number, number>;
}

const isSewer = (employee: Employee) =>
  employee.role === 'sewer' || employee.roles?.some((entry) => entry.role === 'sewer');

const rowsFromDays = (days: SewerPackedDay[]) => {
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

/** Журнал читает packed_at и sewn_at из заказов целиком, без лимита списка. */
const pullStage = async (stage: LogStage, dateFrom: string, dateTo: string) => {
  const limit = 500;
  const first = await fetchLogEvents({ stage, dateFrom, dateTo, limit, offset: 0 });
  const total = first.total || first.items.length;
  const pages = Math.min(40, Math.ceil(total / limit));
  const rest: typeof first.items[] = [];
  for (let start = 1; start < pages; start += 6) {
    const chunk = await Promise.all(
      Array.from({ length: Math.min(6, pages - start) }, (_, index) =>
        fetchLogEvents({ stage, dateFrom, dateTo, limit, offset: (start + index) * limit }),
      ),
    );
    rest.push(...chunk.map((page) => page.items));
  }
  return [first.items, ...rest].flat();
};

const loadPackedFromLogs = async (allowed: Set<number> | null) => {
  const end = todayKey();
  const packFrom = addDays(end, -13);
  const sewFrom = addDays(end, -44);
  const [packed, sewn] = await Promise.all([
    pullStage('stickering', packFrom, end),
    pullStage('sewing', sewFrom, end),
  ]);
  const sewerByOrder = new Map<number, { id: number; name: string }>();
  sewn.forEach((event) => {
    if (event.action !== 'send_to_stickering' || event.entityId == null || event.userId == null) return;
    if (allowed && !allowed.has(event.userId)) return;
    sewerByOrder.set(event.entityId, { id: event.userId, name: event.who });
  });
  const byDay = new Map<string, { fbs: number; bySewer: Map<number, number> }>();
  const names = new Map<number, string>();
  packed.forEach((event) => {
    if (event.action !== 'close_order' || event.entityId == null || !event.at) return;
    const sewer = sewerByOrder.get(event.entityId);
    if (!sewer) return;
    const key = dayKey(event.at);
    const bucket = byDay.get(key) || { fbs: 0, bySewer: new Map<number, number>() };
    bucket.bySewer.set(sewer.id, (bucket.bySewer.get(sewer.id) || 0) + 1);
    byDay.set(key, bucket);
    names.set(sewer.id, sewer.name);
  });
  const rows: DayRow[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => ({
      key,
      label: formatDay(key),
      total: [...bucket.bySewer.values()].reduce((sum, count) => sum + count, 0),
      fbs: bucket.fbs,
      bySewer: bucket.bySewer,
    }));
  return { rows, names };
};

const dayKey = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: MSK });

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: MSK });

const moscowHour = () => {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: MSK,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  return Number(hour);
};

const weekdayOf = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 9, 0, 0)).getUTCDay();
};

const addDays = (key: string, days: number) => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 9, 0, 0));
  return date.toLocaleDateString('en-CA', { timeZone: 'UTC' });
};

const formatDay = (key: string, withWeekday = false) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 9, 0, 0)).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    weekday: withWeekday ? 'short' : undefined,
    timeZone: 'UTC',
  });
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const ruDays = (value: number) => {
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

const piecesWord = (value: number) => {
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
const finishOn = (
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
const planFbo = (
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
const fboReadyBy = (
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

const ProductionCapacityDialog = ({
  open,
  onOpenChange,
  fbsQueue,
  fboQueue,
}: ProductionCapacityDialogProps) => {
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [sewerNames, setSewerNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState('');
  const [fbsDailyInput, setFbsDailyInput] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [minusInput, setMinusInput] = useState('');
  const [showAll, setShowAll] = useState(false);
  const seeded = useRef(false);
  const fbsSeeded = useRef(false);

  useEffect(() => {
    if (!open) {
      seeded.current = false;
      fbsSeeded.current = false;
      setShowAll(false);
      setPieces('');
      setFbsDailyInput('');
      setShipDate('');
      setMinusInput('');
      return;
    }
    if (!seeded.current && fboQueue > 0) {
      seeded.current = true;
      setPieces((current) => (current === '' ? String(fboQueue) : current));
    }
  }, [open, fboQueue]);

  useEffect(() => {
    if (!open || rows) return;
    let cancelled = false;
    Promise.all([
      fetchSewerPackedDays().catch(() => null),
      fetchEmployees().catch(() => null as Employee[] | null),
    ])
      .then(async ([days, employees]) => {
        if (cancelled) return;
        setError(null);
        const roster = (employees || []).filter(isSewer);
        const allowed = roster.length ? new Set(roster.map((employee) => employee.id)) : null;
        const built = days ? rowsFromDays(days) : await loadPackedFromLogs(allowed);
        if (cancelled) return;
        setSewerNames((current) => {
          const next = new Map(current);
          roster.forEach((employee) => next.set(employee.id, employee.fullName));
          built.names.forEach((name, id) => {
            if (!next.has(id)) next.set(id, name);
          });
          return next;
        });
        setRows(built.rows);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить сдачу швей');
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows]);

  const report = useMemo(() => {
    const all = rows || [];
    const today = todayKey();
    const previous = all.filter((day) => day.key !== today);
    const todayRow = all.find((day) => day.key === today);
    const usual = median(previous.map((day) => day.total));
    const todayOpen =
      !!todayRow && moscowHour() < 17 && (usual === 0 || todayRow.total < usual * 0.65);
    const finished = todayOpen ? previous : all;
    const windowDays = showAll ? finished : finished.slice(-RECENT_DAYS);
    const rate = windowDays.length > 0
      ? median(windowDays.map((day) => day.total))
      : (todayRow?.total ?? 0);
    const fbsUsual = median((windowDays.length > 0 ? windowDays : previous).map((day) => day.fbs));
    const workdays = new Set((windowDays.length > 0 ? windowDays : all).map((day) => weekdayOf(day.key)));
    const chart = todayOpen && todayRow
      ? [...windowDays, todayRow]
      : windowDays;
    const ids = new Set<number>();
    chart.forEach((day) => day.bySewer.forEach((_count, id) => ids.add(id)));
    const sewers = [...ids]
      .map((id) => {
        const worked = windowDays.filter((day) => (day.bySewer.get(id) || 0) > 0);
        const total = worked.reduce((sum, day) => sum + (day.bySewer.get(id) || 0), 0);
        const todayCount = todayRow?.bySewer.get(id) || 0;
        const perDay = worked.length > 0 ? total / worked.length : todayCount;
        return {
          id,
          name: sewerNames.get(id) || 'Швея',
          perDay,
          days: worked.length || (todayCount > 0 ? 1 : 0),
          total: total + (todayOpen ? todayCount : 0),
        };
      })
      .sort((a, b) => b.perDay - a.perDay || b.total - a.total);
    return { all, chart, windowDays, rate, fbsUsual, workdays, today, todayOpen, todaySewn: todayRow?.total || 0, sewers };
  }, [rows, sewerNames, showAll]);

  useEffect(() => {
    if (!open || fbsSeeded.current || report.fbsUsual <= 0) return;
    fbsSeeded.current = true;
    setFbsDailyInput(String(Math.round(report.fbsUsual)));
  }, [open, report.fbsUsual]);

  const fboPieces = Math.max(0, Math.floor(Number(pieces) || 0));
  const fbsPerDay = Math.max(0, Math.floor(Number(fbsDailyInput) || 0));
  const minusPercent = Math.min(100, Math.max(0, Number(minusInput) || 0));
  const standardRate = report.rate;
  const rate = standardRate * (1 - minusPercent / 100);
  const plan = planFbo(
    rate,
    fbsPerDay,
    fboPieces,
    fbsQueue,
    report.today,
    report.todaySewn,
    report.workdays,
  );
  const quietDays = rate > 0 ? (fbsQueue + fboPieces) / rate : 0;
  const quietFinish = finishOn(
    fbsQueue + fboPieces,
    rate,
    report.today,
    report.todaySewn,
    report.workdays,
  );
  const haul = shipDate
    ? fboReadyBy(rate, fbsPerDay, fbsQueue, report.today, report.todaySewn, report.workdays, shipDate)
    : null;
  const haulFits = haul != null && !haul.past && fboPieces > 0 && haul.pieces >= fboPieces;
  const maxBar = Math.max(1, ...report.chart.map((day) => day.total));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        className="w-[calc(100vw-1rem)] min-w-0 max-w-[calc(100vw-1rem)] gap-3 overflow-x-hidden p-3 sm:w-[calc(100vw-2rem)] sm:max-w-5xl sm:p-5"
      >
        <DialogHeader className="space-y-1 pr-6 text-left">
          <DialogTitle className="text-base sm:text-lg">Мощность производства</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Мощность — штуки швей после стикеровки. Упаковщицы и закройщики в расчёт не входят. Новый FBS забирает часть дня, на FBO остаётся остаток.
          </DialogDescription>
        </DialogHeader>

        {rows === null && !error && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Считаем сдачу швей после стикеровки…
          </div>
        )}

        {error && rows === null && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {rows && report.all.length === 0 && (
          <p className="text-sm text-muted-foreground">
            После стикеровки ещё ничего не сдано — расчёт появится, когда упаковщица закроет первые вещи.
          </p>
        )}

        {rows && report.all.length > 0 && (
          <div className="min-w-0 max-w-full space-y-3">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:[grid-template-columns:repeat(2,minmax(0,1fr))] xl:[grid-template-columns:repeat(4,minmax(0,1fr))]">
              <label className="min-w-0 rounded-xl border-2 border-sky-400 bg-sky-50 p-3 shadow-sm">
                <span className="block text-sm font-semibold text-sky-950 sm:text-base">FBS приходит в день</span>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={fbsDailyInput}
                  placeholder="сколько штук"
                  onChange={(event) => setFbsDailyInput(event.target.value)}
                  className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
                />
                <span className="mt-1.5 block text-xs leading-snug text-sky-900/80">
                  {report.fbsUsual > 0
                    ? `Обычно ${Math.round(report.fbsUsual)} после стикеровки. Можно поставить своё.`
                    : 'Средний приход FBS за день. Без этой цифры FBO не посчитать.'}
                </span>
              </label>
              <label className="min-w-0 rounded-xl border-2 border-violet-400 bg-violet-50 p-3 shadow-sm">
                <span className="block text-sm font-semibold text-violet-950 sm:text-base">Нужно отшить FBO</span>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={pieces}
                  placeholder="сколько штук"
                  onChange={(event) => setPieces(event.target.value)}
                  className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
                />
                <span className="mt-1.5 block text-xs leading-snug text-violet-900/80">
                  На конвейере сейчас {piecesWord(fboQueue)} FBO и {piecesWord(fbsQueue)} FBS.
                </span>
              </label>
              <label className="min-w-0 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 shadow-sm">
                <span className="block text-sm font-semibold text-amber-950 sm:text-base">Дата отвоза FBO</span>
                <Input
                  type="date"
                  value={shipDate}
                  min={report.today}
                  onChange={(event) => setShipDate(event.target.value)}
                  className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
                />
                <span className="mt-1.5 block text-xs leading-snug text-amber-900/80">
                  К этому дню партия уже должна пройти стикеровку.
                </span>
              </label>
              <label className="min-w-0 rounded-xl border-2 border-rose-400 bg-rose-50 p-3 shadow-sm">
                <span className="block text-sm font-semibold text-rose-950 sm:text-base">Минус к выработке, %</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={minusInput}
                  placeholder="0"
                  onChange={(event) => setMinusInput(event.target.value)}
                  className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
                />
                <span className="mt-1.5 block text-xs leading-snug text-rose-900/80">
                  {minusPercent > 0
                    ? `Обычные ${Math.round(standardRate)} шт/день станут ${Math.round(rate)}.`
                    : 'На сколько процентов занизить обычную сдачу швей. 0 — без скидки.'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-center sm:gap-2">
              <div className="rounded-lg bg-muted/60 px-1.5 py-2">
                <div className="text-base font-bold tabular-nums sm:text-lg">{Math.round(rate)}</div>
                <div className="text-[10px] leading-tight text-muted-foreground sm:text-[11px]">
                  {minusPercent > 0 ? `шт/день −${minusPercent}%` : 'шт/день швеи'}
                </div>
              </div>
              <div className="rounded-lg bg-muted/60 px-1.5 py-2">
                <div className="text-base font-bold tabular-nums sm:text-lg">{report.sewers.length}</div>
                <div className="text-[10px] leading-tight text-muted-foreground sm:text-[11px]">швей в окне</div>
              </div>
              <div className="rounded-lg bg-muted/60 px-1.5 py-2">
                <div className="text-base font-bold tabular-nums sm:text-lg">{report.windowDays.length}</div>
                <div className="text-[10px] leading-tight text-muted-foreground sm:text-[11px]">дней в расчёте</div>
              </div>
            </div>

            <div>
              {rate <= 0 ? (
                <p className="text-sm text-muted-foreground">
                  Пока не из чего взять мощность: в выбранных днях нет сдачи.
                </p>
              ) : fbsDailyInput.trim() === '' ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Укажите средний приход FBS — без него день на FBO не посчитать.
                </p>
              ) : plan.stalled ? (
                <p className="mt-3 text-sm text-amber-800">
                  {fbsPerDay > rate
                    ? `При ${piecesWord(fbsPerDay)} FBS в день не хватает ${piecesWord(Math.ceil(fbsPerDay - rate))}: на FBO день не остаётся.`
                    : 'Такой приход FBS забирает весь день, на FBO ничего не остаётся.'}
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-md bg-sky-50 px-2.5 py-2 text-sky-950">
                    <div className="text-[11px]">На FBO в день</div>
                    <div className="text-base font-semibold tabular-nums">{Math.round(plan.freePerDay)} шт</div>
                    <div className="text-[11px]">после ежедневного FBS</div>
                  </div>
                  <div className="rounded-md bg-violet-50 px-2.5 py-2 text-violet-950">
                    <div className="text-[11px]">Партия FBO</div>
                    <div className="text-base font-semibold">{fboPieces === 0 ? 'штуки не заданы' : ruDays(plan.fboOnlyDays)}</div>
                    <div className="text-[11px]">если очередь FBS уже пустая</div>
                  </div>
                  <div className="rounded-md bg-emerald-50 px-2.5 py-2 text-emerald-950">
                    <div className="text-[11px]">С очередью FBS</div>
                    <div className="text-base font-semibold">
                      {fboPieces === 0 ? 'штуки не заданы' : ruDays(plan.withQueueDays)}
                    </div>
                    <div className="text-[11px]">
                      {plan.finish ? `ориентир ${plan.finish}` : `${piecesWord(fbsQueue)} уже на конвейере`}
                    </div>
                  </div>
                </div>
              )}
              {haul && rate > 0 && fbsDailyInput.trim() !== '' && !plan.stalled && (
                <p className={`mt-3 rounded-md px-2.5 py-2 text-sm ${haulFits ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'}`}>
                  {haul.past
                    ? 'Эта дата отвоза уже прошла.'
                    : fboPieces === 0
                      ? `К ${formatDay(shipDate, true)} швеи успеют около ${piecesWord(haul.pieces)} FBO.`
                      : haulFits
                        ? `К ${formatDay(shipDate, true)} партия успевает: будет около ${piecesWord(haul.pieces)}, нужно ${piecesWord(fboPieces)}.`
                        : `К ${formatDay(shipDate, true)} будет около ${piecesWord(haul.pieces)} из ${piecesWord(fboPieces)}. Не хватает ${piecesWord(fboPieces - haul.pieces)}.`}
                </p>
              )}
              {haul && rate > 0 && fbsDailyInput.trim() !== '' && plan.stalled && !haul.past && (
                <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-950">
                  К {formatDay(shipDate, true)} FBO не сдвинется: день занят приходом FBS.
                </p>
              )}
              {rate > 0 && fboPieces + fbsQueue > 0 && (
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  Если новый FBS больше не придёт, очередь и партия займут {ruDays(quietDays)}
                  {quietFinish ? `, ориентир ${quietFinish}` : ''}.
                </p>
              )}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="text-sm font-medium">
                  Сдано после стикеровки
                  <span className="ml-2 font-normal text-muted-foreground">
                    с {formatDay(report.all[0].key)}
                  </span>
                </p>
                {report.all.length - (report.todayOpen ? 1 : 0) > RECENT_DAYS && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary"
                    onClick={() => setShowAll((value) => !value)}
                  >
                    {showAll ? `последние ${RECENT_DAYS}` : `все ${report.all.length} дней`}
                  </button>
                )}
              </div>
              <div className="w-full min-w-0 max-w-full overflow-x-auto pb-1">
                <div
                  className="flex h-28 items-end gap-1"
                  style={{ minWidth: `${report.chart.length * 52}px` }}
                >
                  {report.chart.map((day) => {
                    const openDay = report.todayOpen && day.key === report.today;
                    return (
                      <div key={day.key} className="flex h-full w-12 shrink-0 flex-col justify-end gap-0.5">
                        <div className="text-center text-[10px] leading-none tabular-nums text-muted-foreground">
                          {day.total}
                        </div>
                        <div className="flex min-h-0 flex-1 items-end">
                          <div
                            className={`w-full rounded-t ${openDay ? 'bg-emerald-300' : 'bg-emerald-600'}`}
                            style={{ height: `${Math.max(8, (day.total / maxBar) * 100)}%` }}
                            title={`${day.label}: ${day.total}`}
                          />
                        </div>
                        <div className="text-center text-[10px] text-muted-foreground">{day.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {report.todayOpen
                  ? 'Светлый столбик — сегодня, день ещё идёт и в мощность не входит. Считаются только вещи после стикеровки.'
                  : 'Пустые дни не входят. В столбике — штуки, которые в этот день прошли стикеровку.'}
              </p>
            </div>

            <p className="text-sm font-medium">Штуки по швеям и датам</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              «Штук в день» — среднее швеи. В дате — сколько её вещей прошло стикеровку именно в этот день.
            </p>
            <ul className="max-h-72 min-w-0 space-y-2 overflow-auto lg:hidden">
              {report.sewers.map((sewer) => (
                <li key={sewer.id} className="rounded-lg border px-2 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{sewer.name}</span>
                    <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                      {sewer.perDay === 0 ? '—' : sewer.perDay.toFixed(1).replace('.', ',')}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">штук в день</span>
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {report.chart.map((day) => {
                      const count = day.bySewer.get(sewer.id) || 0;
                      if (!count) return null;
                      return (
                        <li key={day.key} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">{day.label}</span>
                          <span className="tabular-nums">{count} шт</span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="hidden max-h-64 w-full min-w-0 max-w-full overflow-auto rounded-lg border lg:block">
              <table className="w-max min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted/90">
                  <tr>
                    <th className="sticky left-0 bg-muted/90 px-2 py-1.5 text-left font-medium">Швея</th>
                    <th className="px-2 py-1.5 text-right font-medium">штук в день</th>
                    {report.chart.map((day) => (
                      <th key={day.key} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                        {day.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.sewers.map((sewer) => (
                    <tr key={sewer.id} className="border-t">
                      <td className="sticky left-0 bg-background px-2 py-1.5 font-medium">{sewer.name}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                        {sewer.perDay === 0 ? '—' : sewer.perDay.toFixed(1).replace('.', ',')}
                      </td>
                      {report.chart.map((day) => {
                        const count = day.bySewer.get(sewer.id) || 0;
                        return (
                          <td key={day.key} className="px-2 py-1.5 text-right tabular-nums">
                            {count || '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProductionCapacityDialog;
