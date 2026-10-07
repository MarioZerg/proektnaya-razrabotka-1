import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useTicker } from '@/components/crm/dashboard/liveFloor/liveFloorShared';

const UpdatedAgo = ({ at }: { at: number | null }) => {
  const now = useTicker();
  if (at == null) return null;
  const sec = Math.max(0, Math.round((now - at) / 1000));
  return <>обновлено {sec < 5 ? 'только что' : `${sec} сек назад`}</>;
};

interface LiveFloorHeaderProps {
  big: boolean;
  expanded: boolean;
  updatedAt: number | null;
  onToggle: () => void;
}

/** Заголовок «Живой цех» с индикатором live и кнопкой свернуть/развернуть. */
const LiveFloorHeader = ({ big, expanded, updatedAt, onToggle }: LiveFloorHeaderProps) => (
  <div className="flex items-start gap-2">
    <button
      type="button"
      onClick={big ? undefined : onToggle}
      aria-expanded={expanded}
      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
    >
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
        <span className="relative h-3 w-3 rounded-full bg-red-500" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 font-semibold">
          Живой цех
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-600">
            live
          </span>
        </span>
        <span className="block text-xs text-muted-foreground">
          <span className="hidden sm:inline">
            {expanded
              ? 'Движение вещей по этапам и кто что делает прямо сейчас · '
              : 'Люди, вещи и лента событий · '}
          </span>
          <UpdatedAgo at={updatedAt} />
        </span>
      </span>
    </button>
    {!big && (
      <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" onClick={onToggle}>
        <span className="hidden sm:inline">{expanded ? 'Свернуть' : 'Развернуть'}</span>
        <Icon
          name="ChevronDown"
          size={16}
          className={`transition-transform sm:ml-1 ${expanded ? 'rotate-180' : ''}`}
        />
      </Button>
    )}
  </div>
);

export default LiveFloorHeader;
