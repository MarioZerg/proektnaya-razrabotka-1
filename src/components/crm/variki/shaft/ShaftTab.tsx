import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { claimShaft, fetchShaft, type ShaftDesk } from '@/lib/varikiApi';
import { playShaftCoins } from '@/lib/gameSounds';

const money = (value: number) => value.toLocaleString('ru-RU');

const BAG_CLOSED = '/shaft/bag-closed.jpg';
const BAG_OPEN = '/shaft/bag-open.jpg';

const fadeMask = (at: string) => ({
  WebkitMaskImage: `radial-gradient(ellipse 74% 80% at ${at}, #000 52%, transparent 78%)`,
  maskImage: `radial-gradient(ellipse 74% 80% at ${at}, #000 52%, transparent 78%)`,
});

const dayTitle = (status: ShaftDesk['days'][number]['status']) => {
  if (status === 'open') return 'горит';
  if (status === 'taken') return 'унесла';
  if (status === 'missed') return 'погас';
  if (status === 'spent') return 'закрыт';
  return 'спит';
};

const face = (name: string) =>
  name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();

const SHAFT_DAYS = [15, 16, 17];

type MoscowClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
};

const moscowClock = (now: Date): MoscowClock => {
  const bag: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)) {
    if (part.type !== 'literal') bag[part.type] = Number(part.value);
  }
  return { year: bag.year, month: bag.month, day: bag.day, hour: bag.hour };
};

/** 17:00 или 18:00 Москвы. Смещение Москвы постоянное: UTC+3. */
const moscowHour = (year: number, month: number, day: number, hour: number) =>
  new Date(Date.UTC(year, month - 1, day, hour - 3, 0, 0));

const nextMonthStart = (year: number, month: number) => {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return moscowHour(nextYear, nextMonth, 15, 17);
};

type ShaftWait =
  | { kind: 'open'; until: Date }
  | { kind: 'soon'; at: Date; day: number }
  | { kind: 'later'; at: Date };

/** До ближайшего вечера 15, 16 или 17 числа. После захода — уже до 15-го следующего месяца. */
const shaftWait = (now: Date, claimed: boolean): ShaftWait => {
  const clock = moscowClock(now);
  const hourOpen = SHAFT_DAYS.includes(clock.day) && clock.hour >= 17 && clock.hour < 18;
  if (hourOpen && !claimed) {
    return { kind: 'open', until: moscowHour(clock.year, clock.month, clock.day, 18) };
  }
  if (!claimed) {
    for (const day of SHAFT_DAYS) {
      const start = moscowHour(clock.year, clock.month, day, 17);
      if (start.getTime() > now.getTime()) return { kind: 'soon', at: start, day };
    }
  }
  return { kind: 'later', at: nextMonthStart(clock.year, clock.month) };
};

const splitLeft = (target: Date) => {
  const total = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
};

const Tick = ({ value, label }: { value: number; label: string }) => (
  <div className="min-w-[3.4rem] rounded-xl border border-amber-700/70 bg-black/40 px-2 py-1.5">
    <p className="font-mono text-2xl font-black tabular-nums text-amber-200">
      {String(value).padStart(2, '0')}
    </p>
    <p className="text-[10px] uppercase tracking-wide text-amber-100/55">{label}</p>
  </div>
);

interface ShaftTabProps {
  userId: number;
}

/** Угольная шахта: мешок с живыми деньгами и три вечерних часа в месяц. */
const ShaftTab = ({ userId }: ShaftTabProps) => {
  const { toast } = useToast();
  const [desk, setDesk] = useState<ShaftDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const load = () => {
    fetchShaft(userId)
      .then((next) => {
        setDesk(next);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось открыть шахту'));
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const take = async () => {
    setBusy(true);
    try {
      const res = await claimShaft(userId);
      playShaftCoins();
      toast({
        title: 'Горсть ваша',
        description: `${money(res.payout)} ₽ унесли из мешка. Выплатят отдельно от зарплаты.`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Мешок не открылся',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const tied = !desk || desk.tied;
  const claimed = (desk?.claims.length ?? 0) > 0;
  const wait = shaftWait(new Date(), claimed);
  const left = splitLeft(wait.kind === 'open' ? wait.until : wait.at);
  void tick;

  return (
    <div className="overflow-hidden rounded-[28px] border border-[#3a2a18] bg-[#100e0c] text-[#f3e6cf] shadow-[0_18px_50px_rgba(0,0,0,.35)]">
      <div
        className="relative px-4 pb-6 pt-6 sm:px-6"
        style={{ background: 'radial-gradient(circle at 50% 0%, #5c4630 0%, #1a140f 46%, #0c0b0a 100%)' }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[repeating-linear-gradient(90deg,#2a2118_0_18px,#1a140f_18px_28px)] opacity-80" />
        <div className="relative text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.42em] text-amber-300">Шахта</p>
          <h2 className="mt-1 text-4xl font-black text-white">Угольный мешок</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-amber-50/85">
            В темноте цеха стоит мешок, и каждая готовая вещь роняет в него монету.
            Три вечера в месяц верёвка на час слабеет, а заглянуть можно только один раз.
            Успеешь — унесёшь горсть живых денег. Опоздаешь на вечер — он погаснет,
            но оставшиеся ещё можно успеть.
          </p>
        </div>

        <div className="relative mx-auto mt-4 flex max-w-sm flex-col items-center">
          <div className="pointer-events-none absolute left-1/2 top-8 h-40 w-40 -translate-x-1/2 rounded-full bg-amber-400/25 blur-3xl" />
          <div className="relative z-10 aspect-[3/4] w-56 sm:w-64">
              <img
                src={BAG_CLOSED}
                alt=""
                className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${
                  tied ? 'opacity-100' : 'opacity-0'
                }`}
                style={fadeMask('50% 46%')}
              />
              <img
                src={BAG_OPEN}
                alt=""
                className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${
                  tied ? 'opacity-0' : 'opacity-100'
                }`}
                style={fadeMask('50% 58%')}
              />
              <div className="absolute inset-x-2 bottom-2 rounded-2xl bg-black/55 px-2 py-1.5 text-center shadow-[0_8px_24px_rgba(0,0,0,.45)] backdrop-blur-[2px] sm:inset-x-3 sm:bottom-3">
                <p className="text-2xl font-black text-amber-100 sm:text-3xl">
                  {desk ? `${money(desk.bag)} ₽` : '…'}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-amber-200/80 sm:text-xs">уже в мешке</p>
              </div>
          </div>
          <p className="mt-1 text-sm text-amber-100/80">
            {desk?.full
              ? 'Мешок переполнен, заберите хоть чуть-чуть'
              : tied
                ? 'Верёвка затянута'
                : 'Верёвка ослабла'}
          </p>
          <div className="mt-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-300">
              {wait.kind === 'open'
                ? 'Час горит'
                : wait.kind === 'later'
                  ? 'Следующие вечера'
                  : `До вечера ${wait.day} числа`}
            </p>
            {wait.kind === 'open' ? (
              <p className="mt-1 font-mono text-3xl font-black tabular-nums text-amber-300">
                ещё {String(left.minutes).padStart(2, '0')}:{String(left.seconds).padStart(2, '0')}
              </p>
            ) : (
              <div className="mt-2 flex justify-center gap-2">
                <Tick value={left.days} label="дн" />
                <Tick value={left.hours} label="ч" />
                <Tick value={left.minutes} label="мин" />
                <Tick value={left.seconds} label="сек" />
              </div>
            )}
            <p className="mt-2 text-xs text-amber-100/55">
              {wait.kind === 'later'
                ? 'Горсть в этом месяце уже унесли. Новые вечера — 15, 16 и 17 числа.'
                : '15, 16 и 17 числа верёвка слабеет с 17:00 до 18:00'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 bg-[#161310] px-3 py-4 sm:px-4">
        {error && (
          <p className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-red-100">{error}</p>
        )}

        {desk && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {desk.days.map((day) => (
                <div
                  key={day.day}
                  className={`rounded-2xl border px-2 py-3 text-center ${
                    day.status === 'open'
                      ? 'border-amber-400 bg-amber-900/40'
                      : day.status === 'missed' || day.status === 'spent'
                        ? 'border-stone-700 bg-black/30 text-stone-400'
                        : 'border-amber-900/60 bg-[#241910]'
                  }`}
                >
                  <p className="text-lg font-black">{day.day}</p>
                  <p className="text-[11px] uppercase tracking-wide">{dayTitle(day.status)}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-xs tracking-wide text-amber-100/55">
              С пяти до шести вечера верёвка на час слабеет. За все три вечера — один заход.
            </p>

            {(desk.diggers?.length ?? 0) > 0 ? (
              <div className="rounded-2xl border border-amber-900/60 bg-[#241910] px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-amber-100/50">В этом месяце рылись</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {desk.diggers?.map((person) => (
                    <span key={person.id} title={person.name} className="inline-flex">
                      {person.avatarUrl ? (
                        <img
                          src={person.avatarUrl}
                          alt={person.name}
                          className="h-9 w-9 rounded-full object-cover ring-2 ring-amber-700"
                        />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3a2412] text-[11px] font-bold text-amber-100 ring-2 ring-amber-700">
                          {face(person.name)}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-amber-100/45">В этом месяце в мешке ещё никто не рылся</p>
            )}

            {desk.full && (
              <p className="rounded-xl border border-amber-400/50 bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
                Мешок переполнен, заберите хоть чуть-чуть.
              </p>
            )}

            {desk.blockReason && !desk.canClaim && (
              <p className="rounded-xl border border-amber-900/70 bg-black/30 px-3 py-2 text-sm text-amber-100/80">
                {desk.blockReason}
                {desk.nextOpenAt && !desk.windowOpen && !desk.tied
                  ? ` · следующее окно ${new Date(desk.nextOpenAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
                  : ''}
              </p>
            )}

            {desk.percent != null && desk.previewPayout != null && (
              <div className="rounded-2xl border border-amber-500/40 bg-[#2a1c10] px-4 py-3 text-center">
                <p className="text-xs uppercase tracking-[0.25em] text-amber-300">Горсть, которую можно унести</p>
                <p className="mt-1 text-3xl font-black text-white">{desk.percent}%</p>
                <p className="text-sm text-amber-100/80">это {money(desk.previewPayout)} ₽ из того, что уже лежит в мешке</p>
              </div>
            )}

            {desk.canClaim && (
              <Button
                className="h-12 w-full bg-amber-400 text-base font-bold text-stone-950 hover:bg-amber-300"
                disabled={busy}
                onClick={take}
              >
                Зачерпнуть горсть
              </Button>
            )}

            {desk.claims.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-xs uppercase tracking-wide text-amber-100/50">Что уже унесла</p>
                {desk.claims.map((claim) => (
                  <p key={claim.day} className="text-sm text-amber-50/80">
                    {claim.day} числа · {claim.percent}% · {money(claim.payout)} ₽
                    {claim.paid ? ' · уже выдали' : ' · ждёт выплаты'}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ShaftTab;
