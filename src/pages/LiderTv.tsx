import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon from '@/components/ui/icon';
import { buildLiveFloorView, useLiveFloorData } from '@/components/crm/dashboard/liveFloor/useLiveFloorData';
import { useTicker } from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import LiderTvPipeline from '@/components/lider/LiderTvPipeline';
import LiderTvPeople from '@/components/lider/LiderTvPeople';
import LiderTvFeed from '@/components/lider/LiderTvFeed';
import LiderTvBubbles from '@/components/lider/LiderTvBubbles';
import LiveFloorBoundary from '@/components/crm/dashboard/liveFloor/LiveFloorBoundary';
import LiderTvDuel from '@/components/lider/LiderTvDuel';
import { fetchTvDuel, type TvDuel } from '@/lib/varikiApi';
import { playDuelStart, playDuelWin } from '@/lib/gameSounds';
import { useTvCanvas } from '@/components/lider/useTvCanvas';
import { useTvBuildWatch } from '@/components/lider/useTvBuildWatch';

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

/**
 * Экран «Живой цех» на телевизор: кадр цеха чередуется с пузырями выработки.
 */
const BUBBLES_HOLD_MS = 32000;
/** Кадр цеха стоит на месте: всё уже в одном экране, листать вниз не нужно. */
const FLOOR_HOLD_MS = 24000;

/** Сжимает блок в оставшуюся высоту кадра. Вниз ничего не уезжает. */
const TvFit = ({ children, watch }: { children: ReactNode; watch: string }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const body = bodyRef.current;
    if (!host || !body) return;
    const fit = () => {
      const available = Math.max(0, host.clientHeight - 8);
      if (available <= 0) return;
      body.style.transform = 'none';
      body.style.width = '100%';
      let height = body.scrollHeight;
      let next = height > 0 ? Math.min(1, available / height) : 1;
      if (next < 0.999) {
        body.style.width = `${100 / next}%`;
        height = body.scrollHeight;
        if (height > 0) next = Math.min(1, available / height);
      }
      const rounded = Math.round(next * 1000) / 1000;
      // Сразу ставим масштаб обратно. Если оставить transform: none, повторный
      // замер решит, что значение не изменилось, и нижние карточки останутся за кадром.
      body.style.transform = `scale(${rounded})`;
      body.style.transformOrigin = 'top left';
      body.style.width = rounded < 0.999 ? `${100 / rounded}%` : '100%';
      setZoom((prev) => (Math.abs(prev - rounded) < 0.01 ? prev : rounded));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [watch]);

  return (
    <div className="relative h-full min-h-0">
      {/* Абсолютный кадр не растёт вместе с карточками: иначе шкала
          считает, что места хватает, и нижние сотрудники уезжают за 1080. */}
      <div ref={hostRef} className="absolute inset-0 overflow-hidden">
        <div
          ref={bodyRef}
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            width: zoom < 0.999 ? `${100 / zoom}%` : '100%',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

const LiderTv = () => {
  const { scale, left, top, frameW, frameH } = useTvCanvas();
  useTvBuildWatch();
  const [duel, setDuel] = useState<TvDuel | null>(null);
  const playedDuel = useRef(new Set<string>());
  const [screen, setScreen] = useState<'floor' | 'bubbles'>(() =>
    new URLSearchParams(window.location.search).get('screen') === 'bubbles' ? 'bubbles' : 'floor',
  );
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

  useEffect(() => {
    let stop = false;
    const tick = () => {
      fetchTvDuel()
        .then((next) => {
          if (!stop) setDuel(next);
        })
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 1500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!duel) return;
    if (duel.phase === 'draw' && !playedDuel.current.has(`${duel.id}:draw`)) {
      playedDuel.current.add(`${duel.id}:draw`);
      playDuelStart();
    }
    if (
      (duel.phase === 'award' || duel.phase === 'done') &&
      !playedDuel.current.has(`${duel.id}:win`)
    ) {
      playedDuel.current.add(`${duel.id}:win`);
      playDuelWin();
    }
  }, [duel]);

  const view = useMemo(() => buildLiveFloorView(data, 'all', clockOffset), [data, clockOffset]);
  const floorReady = Boolean(view);

  useEffect(() => {
    if (screen !== 'floor' || !floorReady) return;
    const hold = window.setTimeout(() => setScreen('bubbles'), FLOOR_HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [screen, floorReady]);

  useEffect(() => {
    if (screen !== 'bubbles') return;
    const t = window.setTimeout(() => setScreen('floor'), BUBBLES_HOLD_MS);
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
  const agoText = (() => {
    if (agoSec == null) return '';
    if (agoSec < 5) return 'только что';
    const mod10 = agoSec % 10;
    const mod100 = agoSec % 100;
    const word =
      mod10 === 1 && mod100 !== 11
        ? 'секунду'
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
          ? 'секунды'
          : 'секунд';
    return `${agoSec} ${word} назад`;
  })();

  return (
    <div className="h-screen w-screen cursor-none overflow-hidden bg-black">
      <div
        className="absolute flex flex-col overflow-hidden bg-[#0b1220] text-slate-100"
        style={{
          width: frameW,
          height: frameH,
          left,
          top,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <header className="flex shrink-0 items-center gap-4 px-6 py-3">
          <span className="relative flex h-3.5 w-3.5 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative h-3.5 w-3.5 rounded-full bg-red-500" />
          </span>
          <h1 className="shrink-0 text-3xl font-black tracking-tight text-white">
            {screen === 'bubbles' ? 'Сотрудники смены' : 'Живой цех'}
          </h1>
          <span className="shrink-0 rounded bg-red-500/20 px-2 py-0.5 text-sm font-bold text-red-300">
            {screen === 'bubbles' ? 'выработка' : 'сейчас'}
          </span>
          <span className="min-w-0 flex-1 text-lg leading-tight text-slate-300">
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
            {agoText && <> · обновлено {agoText}</>}
          </span>
          <span className="ml-auto shrink-0 font-mono text-4xl font-bold tabular-nums text-white">
            <MoscowClock />
          </span>
        </header>

        {error && !data ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-10 text-center">
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
          <div className="flex min-h-0 flex-1 items-center justify-center gap-3 text-3xl text-slate-400">
            <Icon name="Loader2" size={36} className="animate-spin" />
            Подключаемся к цеху…
          </div>
        ) : (
          <div data-tv-body="1" className="relative min-h-0 flex-1 overflow-hidden">
            <div
              data-tv-floor="1"
              className={`flex h-full min-h-0 flex-col overflow-hidden px-5 pb-3 pt-1 ${
                screen === 'floor' ? '' : 'invisible pointer-events-none'
              }`}
            >
              <div className="shrink-0 pb-1">
                <LiderTvPipeline
                  counts={view.counts}
                  flows={view.flows}
                  activeStages={view.active}
                  overlockHolder={view.holderName}
                  comets={comets}
                  onCometDone={removeComet}
                />
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] grid-rows-[minmax(0,1fr)] gap-3 overflow-hidden">
                <TvFit
                  watch={`${view.people.length}:${view.orders.length}:${view.stickeringQueue.length}:${view.events.length}`}
                >
                  <div className="flex flex-col gap-2">
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
                      <section className="rounded-xl border border-orange-400/30 bg-orange-500/10 px-3 py-2">
                        <h2 className="mb-1 text-lg font-bold text-white">
                          Ждут стикеровки · {view.stickeringQueue.length}
                        </h2>
                        <div className="flex max-h-14 flex-wrap content-start gap-1.5 overflow-hidden">
                          {view.stickeringQueue.map((o) => (
                            <span
                              key={o.id}
                              className="rounded-md border border-orange-400/40 bg-black/30 px-2 py-0.5 font-mono text-base font-semibold text-orange-100"
                            >
                              {o.orderNumber}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </TvFit>
                <LiderTvFeed events={view.events} names={data.names} freshKeys={freshKeys} />
              </div>
            </div>
            <div
              className={`absolute inset-0 z-20 px-5 pb-4 pt-1 ${
                screen === 'bubbles' ? '' : 'hidden'
              }`}
            >
              <LiveFloorBoundary>
                <LiderTvBubbles active={screen === 'bubbles'} people={view.people} today={data.today || {}} />
              </LiveFloorBoundary>
            </div>
          </div>
        )}
        {duel && <LiderTvDuel duel={duel} />}
      </div>
    </div>
  );
};

export default LiderTv;
