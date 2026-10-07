import Icon from '@/components/ui/icon';
import type { LiveEvent } from '@/lib/liveFloorApi';
import {
  EVENT_META,
  formatClock,
  shortName,
  stageDef,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

interface LiveFloorFeedProps {
  events: LiveEvent[];
  names: Record<string, string>;
  freshKeys: Set<string>;
  onPickOrder: (orderNumber: string) => void;
  /** Сколько строк показать. Свёрнутая лента держит 3, раскрытая — пачку. */
  limit?: number;
}

export const eventKey = (e: LiveEvent) => `${e.kind}-${e.orderId}-${e.at}`;

const FEED_VISIBLE = 30;

/** Лента «что только что произошло»: новые события въезжают сверху. */
const LiveFloorFeed = ({ events, names, freshKeys, onPickOrder, limit = FEED_VISIBLE }: LiveFloorFeedProps) => {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
        За последние 3 часа переходов не было.
      </p>
    );
  }

  return (
    <ol className="space-y-1">
      {events.slice(0, limit).map((e) => {
        const meta = EVENT_META[e.kind];
        const stage = stageDef(meta.stage);
        const fresh = freshKeys.has(eventKey(e));
        return (
          <li
            key={eventKey(e)}
            className={`flex items-start gap-2 rounded-lg px-2 py-1 text-xs leading-snug transition-colors ${
              fresh ? 'animate-feed-in bg-emerald-50' : 'bg-transparent'
            }`}
            style={{ transitionDuration: '2000ms' }}
          >
            <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{formatClock(e.at)}</span>
            <span
              className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: stage.hex }}
            >
              <Icon name={meta.icon} size={10} />
            </span>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onPickOrder(e.orderNumber)}
                className="font-mono font-semibold hover:underline"
              >
                {e.orderNumber}
              </button>{' '}
              <span className="text-muted-foreground">{meta.label}</span>
              {e.userId && names[String(e.userId)] && (
                <span className="text-muted-foreground"> · {shortName(names[String(e.userId)])}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default LiveFloorFeed;
