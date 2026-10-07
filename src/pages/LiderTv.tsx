import { useEffect, useMemo, useRef } from 'react';
import Icon from '@/components/ui/icon';
import { buildLiveFloorView, useLiveFloorData } from '@/components/crm/dashboard/liveFloor/useLiveFloorData';
import { useTicker } from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import LiderTvPipeline from '@/components/lider/LiderTvPipeline';
import LiderTvPeople from '@/components/lider/LiderTvPeople';
import LiderTvFeed from '@/components/lider/LiderTvFeed';
import { useSlowScroll } from '@/components/lider/useSlowScroll';
import { useTvCanvas } from '@/components/lider/useTvCanvas';

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
 * Экран «Живой цех» на телевизор: статичный кадр 1920×1080, внутри данные обновляются.
 * Вход не нужен — тот же снимок, что на дашборде администратора. Если люди не влезают,
 * карточки медленно едут вниз и обратно.
 */
const LiderTv = () => {
  const { scale, left, top, frameW, frameH } = useTvCanvas();
  const scrollRef = useRef<HTMLDivElement>(null);
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
  useSlowScroll(scrollRef, `${view?.people.length || 0}-${view?.orders.length || 0}`);

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
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <header className="flex items-center gap-4 px-8 pt-5">
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative h-4 w-4 rounded-full bg-red-500" />
          </span>
          <h1 className="text-4xl font-black tracking-tight text-white">Живой цех</h1>
          <span className="rounded bg-red-500/20 px-2 py-0.5 text-sm font-bold uppercase tracking-widest text-red-300">
            live
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
          <div className="flex h-[calc(1080px-88px)] flex-col px-6 pb-5 pt-2">
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
                className="min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
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
              <LiderTvFeed events={view.events} names={data.names} freshKeys={freshKeys} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiderTv;
