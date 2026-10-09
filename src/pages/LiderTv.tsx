import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { buildLiveFloorView, useLiveFloorData } from '@/components/crm/dashboard/liveFloor/useLiveFloorData';
import { personState, useTicker } from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import LiderTvPipeline from '@/components/lider/LiderTvPipeline';
import LiderTvPeople from '@/components/lider/LiderTvPeople';
import LiderTvFeed from '@/components/lider/LiderTvFeed';
import LiderTvRace from '@/components/lider/LiderTvRace';
import { useSlowScroll } from '@/components/lider/useSlowScroll';
import { useTvCanvas } from '@/components/lider/useTvCanvas';
import { useTvBuildWatch } from '@/components/lider/useTvBuildWatch';
import type { LiveFloorData, LivePerson, LiveRace } from '@/lib/liveFloorApi';

const MoscowClock = () => {
  useTicker();
  return (
    <>
      {new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      })}
    </>
  );
};

/** Пока сервер не отдал гонку: прячем норму, двигаем по заказам как по скрытым п.м. */
const localRace = (people: LivePerson[], today: LiveFloorData['today']): LiveRace => {
  const metersGoal = 250;
  const metersPerOrder = 4;
  const runners = people
    .map((p) => {
      const stats = today[String(p.id)] || {};
      const items =
        p.role === 'cutter'
          ? stats.cut || 0
          : p.role === 'packer' || p.role === 'packer_returns'
            ? stats.packed || 0
            : stats.sewn || 0;
      const progress = Math.min(1, (items * metersPerOrder) / metersGoal);
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        avatarUrl: p.avatarUrl,
        progress,
        finished: progress >= 1,
        place: 0,
      };
    })
    .sort((a, b) => b.progress - a.progress || a.name.localeCompare(b.name, 'ru'))
    .map((r, i) => ({ ...r, place: i + 1 }));
  return { prize: 50, winner: null, runners };
};

/**
 * Экран «Живой цех» на телевизор: кадр цеха чередуется с гонкой до замка.
 */
const IDLE_PUNISH_MS = 5 * 60000;
const RACE_HOLD_MS = 30000;
const FLOOR_MIN_MS = 18000;
const FLOOR_MAX_MS = 50000;

const LiderTv = () => {
  const { scale, left, top, frameW, frameH } = useTvCanvas();
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<HTMLDivElement>(null);
  useTvBuildWatch();
  const [screen, setScreen] = useState<'floor' | 'race'>('floor');
  const nowTick = useTicker();
  const {
    data,
    error,
    comets,
    movedIds,
    freshKeys,
    clockOffset,
    updatedAt,
    load,
    removeComet,
  } = useLiveFloorData(true);

  const view = useMemo(() => buildLiveFloorView(data, 'all', clockOffset), [data, clockOffset]);
  const race = data?.race || (view ? localRace(view.people, data?.today || {}) : null);
  const nowMs = nowTick + clockOffset;
  const workingIds = useMemo(() => {
    const ids = new Set<number>();
    if (!view) return ids;
    view.people.forEach((p) => {
      if (personState(p, view.orders, view.events, nowMs).working) ids.add(p.id);
    });
    return ids;
  }, [view, nowMs]);
  const idlePunishIds = useMemo(() => {
    const ids = new Set<number>();
    if (!view) return ids;
    view.people.forEach((p) => {
      if (p.role !== 'sewer' && p.role !== 'cutter') return;
      const s = personState(p, view.orders, view.events, nowMs);
      if (!s.working && s.idleMs >= IDLE_PUNISH_MS) ids.add(p.id);
    });
    return ids;
  }, [view, nowMs]);

  const floorReady = Boolean(view);
  useSlowScroll(scrollRef, panRef, floorReady && screen === 'floor', 32, () => {
    window.setTimeout(() => setScreen('race'), 1600);
  });

  // view — новый объект на каждый опрос цеха (12 с). Если повесить таймер на него,
  // гонка на телевизоре никогда не откроется. WebView2 к тому же иногда не скроллит —
  // тогда всё равно уходим на карту по потолку FLOOR_MAX_MS.
  useEffect(() => {
    if (screen !== 'floor' || !floorReady) return;
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      setScreen('race');
    };
    const noOverflow = window.setTimeout(() => {
      const view = scrollRef.current;
      const content = panRef.current;
      const max = view && content ? content.offsetHeight - view.clientHeight : 0;
      if (max <= 8) go();
    }, FLOOR_MIN_MS);
    const safety = window.setTimeout(go, FLOOR_MAX_MS);
    return () => {
      gone = true;
      window.clearTimeout(noOverflow);
      window.clearTimeout(safety);
    };
  }, [screen, floorReady]);

  useEffect(() => {
    if (screen !== 'race') return;
    const t = window.setTimeout(() => {
      if (panRef.current) panRef.current.style.transform = '';
      setScreen('floor');
    }, RACE_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [screen]);

  useEffect(() => {
    document.title = 'Живой цех';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      meta.remove();
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const ask = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* телевизор и так не спит — это запасной держатель */
      }
    };
    void ask();
    const onVis = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, []);

  const agoSec = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;

  return (
    <div className="h-screen w-screen cursor-none overflow-hidden bg-black">
      <div
        className="absolute overflow-hidden bg-[#0b1220] text-slate-100"
        style={{
          width: frameW,
          height: frameH,
          left,
          top,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <header className="flex items-center gap-4 px-8 pt-5">
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative h-4 w-4 rounded-full bg-red-500" />
          </span>
          <h1 className="text-4xl font-black tracking-tight text-white">
            {screen === 'race' ? 'Путь к замку' : 'Живой цех'}
          </h1>
          <span className="rounded bg-red-500/20 px-2 py-0.5 text-sm font-bold uppercase tracking-widest text-red-300">
            {screen === 'race' ? 'замок' : 'live'}
          </span>
          <span className="min-w-0 flex-1 truncate text-xl text-slate-400">
            {view ? (
              <>
                на смене {view.people.length}
                {' · '}
                в работе {view.working}
                {view.idle > 0 ? ` · простой ${view.idle}` : ''}
              </>
            ) : (
              'подключаемся…'
            )}
            {agoSec != null && <> · обновлено {agoSec < 5 ? 'только что' : `${agoSec} сек назад`}</>}
          </span>
          <span className="ml-auto shrink-0 font-mono text-5xl font-bold tabular-nums text-white">
            <MoscowClock />
          </span>
        </header>

        {error && !data ? (
          <div className="flex h-[calc(1080px-88px)] flex-col items-center justify-center gap-4 px-10 text-center">
            <p className="text-3xl text-red-300">Нет связи с цехом</p>
            <p className="max-w-3xl text-2xl text-slate-400">{error}</p>
            <button
              type="button"
              onClick={load}
              className="cursor-none rounded-xl bg-white/10 px-6 py-3 text-2xl text-white"
            >
              Повторить
            </button>
          </div>
        ) : !view || !data ? (
          <div className="flex h-[calc(1080px-88px)] items-center justify-center gap-3 text-3xl text-slate-400">
            <Icon name="Loader2" size={36} className="animate-spin" />
            Подключаемся к цеху…
          </div>
        ) : (
          <div className="relative h-[calc(1080px-88px)]">
            <div
              className={`flex h-full min-h-0 flex-col px-6 pb-5 pt-2 ${
                screen === 'floor' ? '' : 'invisible pointer-events-none'
              }`}
            >
              <div className="shrink-0 pb-3">
                <LiderTvPipeline
                  counts={view.counts}
                  flows={view.flows}
                  activeStages={view.active}
                  overlockHolder={view.holderName}
                  comets={comets}
                  onCometDone={removeComet}
                />
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px] gap-4">
                <div
                  ref={scrollRef}
                  data-tv-scroll="1"
                  className="min-h-0 overflow-hidden"
                >
                  <div ref={panRef} data-tv-pan="1">
                    <LiderTvPeople
                      people={view.people}
                      orders={view.orders}
                      events={view.events}
                      today={data.today}
                      names={data.names}
                      clockOffset={clockOffset}
                      movedIds={movedIds}
                    />
                    {view.stickeringQueue.length > 0 && (
                      <section className="mt-5 rounded-2xl border border-orange-400/30 bg-orange-500/10 p-4">
                        <h2 className="mb-3 text-2xl font-bold text-white">
                          Ждут стикеровки · {view.stickeringQueue.length}
                        </h2>
                        <div className="flex flex-wrap gap-2">
                          {view.stickeringQueue.slice(0, 24).map((o) => (
                            <span
                              key={o.id}
                              className="rounded-lg border border-orange-400/40 bg-black/30 px-3 py-1 font-mono text-xl font-semibold text-orange-100"
                            >
                              {o.orderNumber}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </div>
                <LiderTvFeed events={view.events} names={data.names} freshKeys={freshKeys} />
              </div>
            </div>
            {race ? (
              <div
                className={`absolute inset-0 z-20 px-5 pb-4 pt-1 ${
                  screen === 'race' ? '' : 'hidden'
                }`}
              >
                <LiderTvRace
                  active={screen === 'race'}
                  race={race}
                  people={view.people}
                  workingIds={workingIds}
                  idlePunishIds={idlePunishIds}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default LiderTv;
