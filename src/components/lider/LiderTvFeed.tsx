import Icon from '@/components/ui/icon';
import type { LiveEvent } from '@/lib/liveFloorApi';
import {
  EVENT_META,
  formatClock,
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
  <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
    <h2 className="mb-2 flex shrink-0 items-center gap-2 text-xl font-bold text-white">
      <Icon name="TrendingUp" size={18} />
      Только что
    </h2>
    {events.length === 0 ? (
      <p className="text-lg text-slate-400">За последние 3 часа переходов не было</p>
    ) : (
      <ol className="min-h-0 flex-1 space-y-1 overflow-hidden">
        {events.slice(0, 16).map((e) => {
          const meta = EVENT_META[e.kind];
          const stage = stageDef(meta.stage);
          const fresh = freshKeys.has(eventKey(e));
          const who = e.userId ? names[String(e.userId)] : '';
          return (
            <li
              key={eventKey(e)}
              className={`flex items-start gap-2 rounded-lg px-1.5 py-1 ${
                fresh ? 'animate-feed-in bg-emerald-500/15' : ''
              }`}
            >
              <span className="w-12 shrink-0 text-base tabular-nums text-slate-400">{formatClock(e.at)}</span>
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: stage.hex }}
              >
                <Icon name={meta.icon} size={12} />
              </span>
              <div className="min-w-0 break-words text-base leading-snug">
                <span className="font-mono font-bold text-white">{e.orderNumber}</span>
                <span className="text-slate-300"> {meta.label}</span>
                {who && <span className="text-slate-400"> · {who}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    )}
  </aside>
);

export default LiderTvFeed;
