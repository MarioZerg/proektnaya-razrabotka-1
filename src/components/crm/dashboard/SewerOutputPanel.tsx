import { useCallback, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  fetchSewerDaily,
  fetchSewerBonus,
  type SewerDailyInfo,
  type SewerBonusInfo,
} from '@/lib/salaryApi';

const money = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/Moscow',
  });

/** Одна шкала прогресса: цвет ведёт себя одинаково у акции и у премии. */
const Meter = ({
  value,
  target,
  tone,
}: {
  value: number;
  target: number;
  tone: 'amber' | 'violet';
}) => {
  const percent = Math.min(100, Math.round((value / Math.max(1, target)) * 100));
  const done = value >= target;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={done ? 'font-semibold text-emerald-700' : 'text-muted-foreground'}>
          {done ? 'цель взята' : `${percent}%`}
        </span>
        <span className="tabular-nums">
          <span className="font-semibold text-foreground">{value}</span>
          <span className="text-muted-foreground">/{target}</span>
        </span>
      </div>
      <div
        className={`mt-1 h-1.5 w-full overflow-hidden rounded-full ${
          tone === 'amber' ? 'bg-amber-100' : 'bg-violet-100'
        }`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            done ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-violet-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

/**
 * Выработка швей одним экраном: акция дня и премия месяца в одной таблице.
 *
 * Раньше это были две отдельные карточки, и каждая рисовала СВОЙ список всех
 * швей — одни и те же двадцать фамилий шли по странице дважды, разделённые
 * полутора экранами прокрутки. Сравнить «сегодня» и «за месяц» по одному
 * человеку было нельзя: строки стояли слишком далеко друг от друга.
 *
 * Здесь на человека приходится одна строка и две шкалы рядом. Сразу видно
 * и того, кто сегодня не двигается при хорошем месяце, и обратное.
 */
const SewerOutputPanel = () => {
  const [daily, setDaily] = useState<SewerDailyInfo | null>(null);
  const [bonus, setBonus] = useState<SewerBonusInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetchSewerDaily().catch(() => null),
      fetchSewerBonus().catch(() => null),
    ]).then(([d, b]) => {
      setDaily(d);
      setBonus(b);
      setLoaded(true);
    });
  }, []);

  // Раз в две минуты: метраж растёт по мере упаковки, но не поминутно.
  usePolling(load, 120000);

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загружаем выработку…
      </div>
    );
  }

  const upcoming = bonus?.state === 'upcoming';

  // Сводим два списка в один по сотруднику: у акции и у премии свои наборы,
  // и человек может быть только в одном из них.
  const byUser = new Map<
    number,
    { userId: number; userName: string; dayMeters: number; monthMeters: number }
  >();
  for (const s of daily?.sewers || []) {
    byUser.set(s.userId, {
      userId: s.userId,
      userName: s.userName,
      dayMeters: s.meters,
      monthMeters: 0,
    });
  }
  for (const s of bonus?.sewers || []) {
    const row = byUser.get(s.userId);
    if (row) row.monthMeters = s.meters;
    else
      byUser.set(s.userId, {
        userId: s.userId,
        userName: s.userName,
        dayMeters: 0,
        monthMeters: s.meters,
      });
  }

  // Сортировка по сегодняшнему метражу: акция — это то, на что ещё можно
  // повлиять до конца смены, месяц уже почти сложился.
  const rows = [...byUser.values()].sort(
    (a, b) => b.dayMeters - a.dayMeters || b.monthMeters - a.monthMeters,
  );

  if (!daily && !bonus) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Ни акции на сегодня, ни активной премии за выработку нет
      </p>
    );
  }

  const dayDone = daily ? rows.filter((r) => r.dayMeters >= daily.target).length : 0;
  const monthDone = bonus ? rows.filter((r) => r.monthMeters >= bonus.target).length : 0;

  return (
    <div className="space-y-3">
      {/* Условия обеих программ — двумя плашками, а не двумя экранами текста. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {daily ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
              <Icon name="Zap" size={15} className="shrink-0 text-amber-600" />
              <span className="truncate">{daily.title}</span>
              <Badge className="ml-auto shrink-0 bg-amber-500 text-white hover:bg-amber-500">
                сегодня
              </Badge>
            </p>
            <p className="mt-1 text-xs text-amber-900">
              {daily.target} пог.м. за смену → {money(daily.amount)} на баланс. Взяли:{' '}
              <b>
                {dayDone} из {rows.length}
              </b>
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Icon name="Zap" size={15} className="shrink-0" />
              Акции на сегодня нет
            </p>
          </div>
        )}

        {bonus ? (
          <div className="rounded-lg border border-violet-300 bg-violet-50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-bold text-violet-900">
              <Icon name="Trophy" size={15} className="shrink-0 text-violet-600" />
              Премия за выработку
              <Badge className="ml-auto shrink-0 bg-violet-500 text-white hover:bg-violet-500">
                {formatDay(bonus.periodFrom)} — {formatDay(bonus.periodTo)}
              </Badge>
            </p>
            <p className="mt-1 text-xs text-violet-900">
              {upcoming
                ? `Стартует ${formatDay(bonus.periodFrom)}: ${bonus.target} пог.м. → ${money(bonus.amount)}`
                : `${bonus.target} пог.м. за месяц → ${money(bonus.amount)}. Взяли: `}
              {!upcoming && (
                <b>
                  {monthDone} из {rows.length}
                </b>
              )}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Icon name="Trophy" size={15} className="shrink-0" />
              Премия сейчас не идёт
            </p>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Пока никто не сдал метраж</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {/* Подписи колонок только на широком экране: на телефоне шкалы и так
              подписаны словами «сегодня» / «за месяц» внутри строки. */}
          <div className="hidden bg-muted/50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:gap-3">
            <span>Швея</span>
            <span>Акция дня</span>
            <span>Премия месяца</span>
          </div>
          <div className="divide-y">
            {rows.map((r) => (
              <div
                key={r.userId}
                className="px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:items-center sm:gap-3"
              >
                <p className="truncate text-sm font-medium">{r.userName}</p>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:col-span-2 sm:mt-0 sm:grid sm:grid-cols-2">
                  <div>
                    <p className="mb-0.5 text-[10px] uppercase text-muted-foreground sm:hidden">
                      сегодня
                    </p>
                    {daily ? (
                      <Meter value={r.dayMeters} target={daily.target} tone="amber" />
                    ) : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-0.5 text-[10px] uppercase text-muted-foreground sm:hidden">
                      за месяц
                    </p>
                    {bonus && !upcoming ? (
                      <Meter value={r.monthMeters} target={bonus.target} tone="violet" />
                    ) : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SewerOutputPanel;
