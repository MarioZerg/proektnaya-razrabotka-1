import Icon from '@/components/ui/icon';
import type { LiveFloorData } from '@/lib/liveFloorApi';
import { STAGES, type StageKey } from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import type { LiveFloorView } from '@/components/crm/dashboard/liveFloor/useLiveFloorData';

const COUNT_KEYS: Record<StageKey, keyof LiveFloorData['counts']> = {
  new: 'new',
  cutting: 'cutting',
  overlock: 'overlock',
  cutReady: 'cutReady',
  sewing: 'sewing',
  stickering: 'stickering',
  done: 'doneToday',
};

interface LiveFloorSummaryProps {
  data: LiveFloorData | null;
  view: LiveFloorView | null;
  error: string | null;
  onRetry: () => void;
  onToggle: () => void;
}

/** Свёрнутый вид: счётчики этапов и кто на смене одной строкой. */
const LiveFloorSummary = ({ data, view, error, onRetry, onToggle }: LiveFloorSummaryProps) =>
  error && !data ? (
    <p className="text-xs text-destructive">
      Не удалось загрузить: {error}{' '}
      <button type="button" className="underline" onClick={onRetry}>
        Повторить
      </button>
    </p>
  ) : view && data ? (
    <button type="button" onClick={onToggle} className="block w-full space-y-2 text-left">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STAGES.map((s) => (
          <span
            key={s.key}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: s.hex }} />
            <span className="font-semibold tabular-nums">{view.counts[COUNT_KEYS[s.key]] ?? 0}</span>
            <span className="text-muted-foreground">{s.label}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          на смене {view.people.length}
        </span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
          в работе {view.working}
        </span>
        {view.idle > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
            простой {view.idle}
          </span>
        )}
        {view.holderName && (
          <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-fuchsia-800">
            оверлок: {view.holderName}
          </span>
        )}
      </div>
    </button>
  ) : (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon name="Loader2" size={14} className="animate-spin" />
      Подключаемся к цеху…
    </p>
  );

export default LiveFloorSummary;
