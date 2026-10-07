import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { LiveCounts } from '@/lib/liveFloorApi';
import { STAGES, stageIndex, type StageKey } from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import type { Comet } from '@/components/crm/dashboard/liveFloor/LiveFloorPipeline';

interface LiderTvPipelineProps {
  counts: LiveCounts;
  flows: number[];
  activeStages: Set<StageKey>;
  overlockHolder?: string | null;
  comets: Comet[];
  onCometDone: (id: string) => void;
}

const COUNT_BY_STAGE: Record<StageKey, keyof LiveCounts> = {
  new: 'new',
  cutting: 'cutting',
  overlock: 'overlock',
  cutReady: 'cutReady',
  sewing: 'sewing',
  stickering: 'stickering',
  done: 'doneToday',
};

const center = (key: StageKey) => ((stageIndex(key) + 0.5) / STAGES.length) * 100;

const CometPill = ({ comet, onDone }: { comet: Comet; onDone: (id: string) => void }) => {
  const [go, setGo] = useState(false);
  const to = STAGES[stageIndex(comet.to)];

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setGo(true));
    });
    const done = setTimeout(() => onDone(comet.id), 2800);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(done);
    };
  }, [comet.id, onDone]);

  return (
    <div
      className="pointer-events-none absolute top-[42px] z-20 -translate-x-1/2"
      style={{
        left: `${go ? center(comet.to) : center(comet.from)}%`,
        opacity: go ? 0 : 1,
        transition: 'left 2.1s cubic-bezier(0.45, 0, 0.2, 1), opacity 0.5s ease 2.1s',
      }}
    >
      <span
        className="whitespace-nowrap rounded-full border bg-slate-950 px-3 py-1 font-mono text-lg font-semibold shadow-lg"
        style={{ borderColor: to.hex, color: to.hex }}
      >
        {comet.orderNumber}
      </span>
    </div>
  );
};

/** Конвейер на телевизор: крупные цифры этапов, видно с другого конца цеха. */
const LiderTvPipeline = ({
  counts,
  flows,
  activeStages,
  overlockHolder,
  comets,
  onCometDone,
}: LiderTvPipelineProps) => (
  <div className="relative px-6 pt-2">
    {STAGES.slice(0, -1).map((s, i) => {
      const next = STAGES[i + 1];
      const flow = flows[i] || 0;
      return (
        <div
          key={s.key}
          className="absolute top-[52px] h-2.5"
          style={{ left: `${center(s.key)}%`, width: `${100 / STAGES.length}%` }}
        >
          <div
            className={`absolute inset-x-8 inset-y-0 rounded-full ${flow ? 'animate-belt' : ''}`}
            style={{
              background: flow
                ? `repeating-linear-gradient(90deg, ${s.hex}55 0 14px, ${next.hex}33 14px 28px)`
                : '#1e293b',
            }}
          />
          {flow > 0 && (
            <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-medium text-slate-400">
              {flow}/ч
            </span>
          )}
        </div>
      );
    })}

    <div className="relative z-10 grid" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
      {STAGES.map((s) => {
        const value = counts?.[COUNT_BY_STAGE[s.key]] ?? 0;
        const active = activeStages.has(s.key);
        return (
          <div key={s.key} className="flex flex-col items-center gap-1 text-center">
            <div className="relative flex h-[88px] w-[88px] items-center justify-center">
              {active && (
                <span
                  className="absolute inset-2 animate-widget-pulse rounded-full opacity-40"
                  style={{ background: s.hex }}
                />
              )}
              <div
                className={`relative flex h-[64px] w-[64px] items-center justify-center rounded-full text-white ${s.solid}`}
                style={{ boxShadow: active ? `0 0 22px ${s.hex}99` : undefined }}
              >
                <Icon name={s.icon} size={28} />
              </div>
            </div>
            <span key={value} className="inline-block animate-count-bump text-5xl font-bold leading-none tabular-nums text-white">
              {value}
            </span>
            <span className="text-xl font-semibold leading-tight text-slate-300">
              {s.label}
              {s.key === 'done' && <span className="block text-sm font-medium text-slate-500">сегодня</span>}
            </span>
            {s.key === 'overlock' && overlockHolder && (
              <span className="max-w-full truncate rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-base text-fuchsia-200">
                {overlockHolder}
              </span>
            )}
          </div>
        );
      })}
    </div>

    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {comets.map((c) => (
        <CometPill key={c.id} comet={c} onDone={onCometDone} />
      ))}
    </div>
  </div>
);

export default LiderTvPipeline;