import Icon from '@/components/ui/icon';
import type { LiveEvent } from '@/lib/liveFloorApi';
import {
  EVENT_META,
  formatClock,
  shortName,
  stageDef,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import { eventKey } from '@/components/crm/dashboard/liveFloor/LiveFloorFeed';

interface LiderTvFeedProps {
  events: LiveEvent[];
  names: Record<string, string>;
  freshKeys: Set<string>;
}

/** Правая колонка телевизора: что только что произошло, крупным шрифтом. */
const LiderTvFeed = ({ events, names, freshKeys }: LiderTvFeedProps) => (
  <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-slate-900/70 p-4">
    <h2 className="mb-3 flex items-center gap-2 text-2xl font-bold text-white">
      <Icon name="TrendingUp" size={22} />
      Только что
    </h2>
    {events.length === 0 ? (
      <p className="text-xl text-slate-400">За последние 3 часа переходов не было</p>
    ) : (
      <ol className="min-h-0 flex-1 space-y-1.5 overflow-hidden">
        {events.slice(0, 14).map((e) => {
          const meta = EVENT_META[e.kind];
          const stage = stageDef(meta.stage);
          const fresh = freshKeys.has(eventKey(e));
          return (
            <li
              key={eventKey(e)}
              className={`flex items-start gap-2.5 rounded-xl px-2 py-1.5 ${
                fresh ? 'animate-feed-in bg-emerald-500/15' : ''
              }`}
            >
              <span className="w-14 shrink-0 text-lg tabular-nums text-slate-400">{formatClock(e.at)}</span>
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: stage.hex }}
              >
                <Icon name={meta.icon} size={14} />
              </span>
              <div className="min-w-0 text-lg leading-snug">
                <span className="font-mono font-bold text-white">{e.orderNumber}</span>
                <span className="text-slate-300"> {meta.label}</span>
                {e.userId && names[String(e.userId)] && (
                  <span className="text-slate-400"> · {shortName(names[String(e.userId)])}</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    )}
  </aside>
);

export default LiderTvFeed;
