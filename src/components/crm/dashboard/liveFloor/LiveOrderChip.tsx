import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { LiveOrder } from '@/lib/liveFloorApi';
import LiveOrderChain from '@/components/crm/dashboard/liveFloor/LiveOrderChain';
import {
  chainOf,
  formatElapsed,
  shortName,
  stageDef,
  stageOf,
  stageSince,
  useTicker,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

interface LiveOrderChipProps {
  order: LiveOrder;
  names: Record<string, string>;
  clockOffset: number;
  /** Вещь только что перешла на этот этап — вспыхивает. */
  moved?: boolean;
  /** Совпала с поиском по номеру. */
  highlighted?: boolean;
  /** После скольких минут на этапе таймер краснеет. */
  slowAfterMin?: number;
  /** Таблетка с одним номером — для стека закройщика, где вещей десятки. */
  compact?: boolean;
}

const LiveOrderChip = ({
  order,
  names,
  clockOffset,
  moved = false,
  highlighted = false,
  slowAfterMin = 45,
  compact = false,
}: LiveOrderChipProps) => {
  const now = useTicker() + clockOffset;
  const stage = stageDef(stageOf(order));
  const since = stageSince(order);
  const elapsedMs = since ? now - new Date(since).getTime() : 0;
  const slow = since && elapsedMs > slowAfterMin * 60000;
  const steps = chainOf(order);
  const current = steps.find((s) => s.state === 'current' || s.state === 'waiting');
  const currentWho = current?.userId ? shortName(names[String(current.userId)]) : null;
  const currentText =
    current?.state === 'current'
      ? `${current.label} · ${currentWho || 'в работе'}`
      : current
        ? `${current.label} · ждёт`
        : stage.label;

  const details = (
    <PopoverContent className="w-80" align="start">
      <LiveOrderChain order={order} names={names} clockOffset={clockOffset} />
    </PopoverContent>
  );

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 font-mono text-[10.5px] font-medium transition hover:shadow ${
              moved ? 'animate-moved-glow' : ''
            } ${highlighted ? 'ring-2 ring-primary ring-offset-1' : ''}`}
            style={{ borderColor: `${stage.hex}66` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: stage.hex }} />
            {order.orderNumber}
            {order.isCancelled && <span className="text-[9px] font-sans font-semibold text-red-600">отм.</span>}
          </button>
        </PopoverTrigger>
        {details}
      </Popover>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-order-id={order.id}
          className={`group relative flex w-full min-w-0 flex-col gap-1 overflow-visible rounded-lg border bg-card px-2.5 py-1.5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
            moved ? 'animate-moved-glow' : ''
          } ${highlighted ? 'ring-2 ring-primary ring-offset-1' : ''}`}
          style={{ borderLeft: `4px solid ${stage.hex}` }}
        >
          <span className="truncate font-mono text-[11px] font-semibold">{order.orderNumber}</span>
          <div className="flex items-center gap-0.5 overflow-visible">
            {steps.map((s, i) => {
              const def = stageDef(s.key);
              return (
                <span key={s.key} className="flex items-center gap-0.5">
                  {i > 0 && (
                    <span
                      className="h-0.5 w-2.5 rounded-full"
                      style={{ background: s.state === 'done' || s.state === 'current' ? def.hex : 'hsl(var(--border))' }}
                    />
                  )}
                  <span className="relative flex h-2.5 w-2.5 overflow-visible">
                    {s.state === 'current' && (
                      <span
                        className="absolute -inset-0.5 animate-ping rounded-full"
                        style={{ background: def.hex }}
                      />
                    )}
                    <span
                      className="relative m-auto h-2 w-2 rounded-full border"
                      style={{
                        borderColor: s.state === 'pending' ? 'hsl(var(--border))' : def.hex,
                        background: s.state === 'done' || s.state === 'current' ? def.hex : 'transparent',
                      }}
                    />
                  </span>
                </span>
              );
            })}
            {order.isCancelled && (
              <span className="ml-1 text-[9px] font-semibold uppercase text-red-600">отм.</span>
            )}
            {since && (
              <span
                className={`ml-auto shrink-0 pl-1 tabular-nums text-[10px] font-medium ${
                  slow ? 'text-red-600' : 'text-muted-foreground'
                }`}
              >
                {formatElapsed(elapsedMs)}
              </span>
            )}
          </div>
          <span className="truncate text-[10px] font-medium" style={{ color: stage.hex }}>
            {currentText}
          </span>
        </button>
      </PopoverTrigger>
      {details}
    </Popover>
  );
};

export default LiveOrderChip;
