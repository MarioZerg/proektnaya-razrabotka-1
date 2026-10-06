import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { LiveCounts } from '@/lib/liveFloorApi';
import { STAGES, stageIndex, type StageKey } from '@/components/crm/dashboard/liveFloor/liveFloorShared';

export interface Comet {
  id: string;
  orderNumber: string;
  from: StageKey;
  to: StageKey;
}

interface LiveFloorPipelineProps {
  counts: LiveCounts;
  /** Переходов за последний час на каждом отрезке ленты (между этапами i и i+1). */
  flows: number[];
  /** Сейчас в работе у людей — у таких этапов кружок «дышит». */
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
  const from = STAGES[stageIndex(comet.from)];
  const to = STAGES[stageIndex(comet.to)];

  useEffect(() => {
    // Два кадра: браузер должен сначала нарисовать фишку на старте, иначе
    // переход не запустится и она просто появится на финише.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setGo(true));
    });
    const done = setTimeout(() => onDone(comet.id), 2600);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(done);
    };
  }, [comet.id, onDone]);

  return (
    <div
      className="pointer-events-none absolute top-[20px] z-20 -translate-x-1/2"
      style={{
        left: `${go ? center(comet.to) : center(comet.from)}%`,
        opacity: go ? 0 : 1,
        transition: 'left 1.9s cubic-bezier(0.45, 0, 0.2, 1), opacity 0.5s ease 1.9s',
      }}
    >
      <div className="relative flex items-center">
        <span
          className="absolute right-full top-1/2 h-1 w-12 -translate-y-1/2 rounded-full"
          style={{ background: `linear-gradient(to left, ${to.hex}, transparent)` }}
        />
        <span
          className="flex items-center gap-1 whitespace-nowrap rounded-full border bg-white px-2 py-0.5 font-mono text-[11px] font-semibold shadow-lg"
          style={{ borderColor: to.hex, color: to.hex }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: from.hex }} />
          {comet.orderNumber}
        </span>
      </div>
    </div>
  );
};

const LiveFloorPipeline = ({
  counts,
  flows,
  activeStages,
  overlockHolder,
  comets,
  onCometDone,
}: LiveFloorPipelineProps) => (
  <div className="-mx-2 overflow-x-auto px-2 pb-1">
    <div className="relative min-w-[560px] pt-1">
      {/* Отрезки ленты между этапами. Чем больше вещей проехало за час, тем
          гуще бегут точки; пустой отрезок стоит серым. */}
      {STAGES.slice(0, -1).map((s, i) => {
        const next = STAGES[i + 1];
        const flow = flows[i] || 0;
        const dots = flow === 0 ? 0 : flow < 4 ? 1 : flow < 11 ? 2 : 3;
        return (
          <div
            key={s.key}
            className="absolute top-[26px] h-2"
            style={{
              left: `${center(s.key)}%`,
              width: `${100 / STAGES.length}%`,
            }}
          >
            <div
              className={`absolute inset-x-4 inset-y-0 rounded-full ${flow ? 'animate-belt' : ''}`}
              style={{
                background: flow
                  ? `repeating-linear-gradient(90deg, ${s.hex}33 0 12px, ${next.hex}22 12px 24px)`
                  : 'hsl(var(--muted))',
              }}
            />
            {Array.from({ length: dots }).map((_, k) => (
              <span
                key={k}
                className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 animate-flow-dot rounded-full shadow"
                style={{
                  background: next.hex,
                  animationDelay: `${(-2.6 / dots) * k}s`,
                }}
              />
            ))}
            {flow > 0 && (
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground">
                {flow}/ч
              </span>
            )}
          </div>
        );
      })}

      <div className="relative z-10 grid" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
        {STAGES.map((s) => {
          const value = counts[COUNT_BY_STAGE[s.key]] ?? 0;
          const active = activeStages.has(s.key);
          return (
            <div key={s.key} className="flex flex-col items-center gap-1 text-center">
              <div className="relative">
                {active && (
                  <span
                    className="absolute inset-0 animate-ping rounded-full opacity-30"
                    style={{ background: s.hex }}
                  />
                )}
                <div
                  className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full ring-4 ring-background ${s.solid}`}
                  style={{ boxShadow: active ? `0 0 18px ${s.hex}66` : undefined }}
                >
                  <Icon name={s.icon} size={22} />
                </div>
              </div>
              <span key={value} className="inline-block animate-count-bump text-2xl font-bold tabular-nums">
                {value}
              </span>
              <span className="text-xs font-medium leading-tight text-muted-foreground">
                {s.label}
                {s.key === 'done' && <span className="block text-[10px]">сегодня</span>}
              </span>
              {s.key === 'overlock' && overlockHolder && (
                <span
                  title={`За оверлоком: ${overlockHolder}`}
                  className="inline-flex max-w-full items-center gap-0.5 truncate rounded-full bg-fuchsia-50 px-1.5 py-0.5 text-[10px] text-fuchsia-800"
                >
                  <Icon name="Hand" size={10} className="shrink-0" />
                  <span className="truncate">{overlockHolder}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Хвост кометы у крайних этапов не должен расширять ленту и давать прокрутку. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {comets.map((c) => (
          <CometPill key={c.id} comet={c} onDone={onCometDone} />
        ))}
      </div>
    </div>
  </div>
);

export default LiveFloorPipeline;
