import Icon from '@/components/ui/icon';
import type { LiveOrder } from '@/lib/liveFloorApi';
import {
  chainOf,
  formatClock,
  formatElapsed,
  productLabel,
  shortName,
  stageDef,
  stageSince,
  useTicker,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

interface LiveOrderChainProps {
  order: LiveOrder;
  names: Record<string, string>;
  clockOffset: number;
}

const WAITING_FOR: Partial<Record<string, string>> = {
  cutting: 'ждёт закройщика',
  overlock: 'ждёт оверлок',
  sewing: 'ждёт швею',
  stickering: 'ждёт упаковку',
};

const minutesBetween = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const diff = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return diff >= 0 ? diff : null;
};

/** Полный путь вещи по цеху: кто, когда и сколько держал её на каждом этапе. */
const LiveOrderChain = ({ order, names, clockOffset }: LiveOrderChainProps) => {
  const now = useTicker() + clockOffset;
  const steps = chainOf(order);
  const since = stageSince(order);

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-bold">{order.orderNumber}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
            {order.marketplace} {order.orderType}
          </span>
          {order.isCancelled && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
              отменён — на склад
            </span>
          )}
          {order.groupKey && (order.groupSize || 0) > 1 && (
            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-800">
              связка {order.groupPosition}/{order.groupSize}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{productLabel(order)}</p>
      </div>

      <ol className="relative space-y-0">
        {steps.map((step, i) => {
          const def = stageDef(step.key);
          const took = step.state === 'done' ? minutesBetween(step.startedAt, step.at) : null;
          const who = step.userId ? names[String(step.userId)] : null;
          const last = i === steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3 pb-3 last:pb-0">
              {!last && (
                <span
                  className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-0.5 rounded-full"
                  style={{
                    background:
                      step.state === 'done' ? def.hex : 'hsl(var(--border))',
                  }}
                />
              )}
              <span className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
                {step.state === 'current' && (
                  <span
                    className="absolute inset-0 animate-ping rounded-full opacity-40"
                    style={{ background: def.hex }}
                  />
                )}
                <span
                  className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                    step.state === 'done' || step.state === 'current' ? 'text-white' : 'bg-background'
                  }`}
                  style={{
                    borderColor: step.state === 'pending' ? 'hsl(var(--border))' : def.hex,
                    background:
                      step.state === 'done' || step.state === 'current' ? def.hex : undefined,
                    color: step.state === 'waiting' ? def.hex : undefined,
                  }}
                >
                  <Icon
                    name={step.state === 'done' ? 'Check' : step.state === 'waiting' ? 'Clock' : def.icon}
                    size={12}
                  />
                </span>
              </span>
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`font-semibold ${step.state === 'pending' ? 'text-muted-foreground' : ''}`}
                  >
                    {step.label}
                  </span>
                  {step.state === 'done' && step.at && (
                    <span className="tabular-nums text-muted-foreground">{formatClock(step.at)}</span>
                  )}
                </div>
                {step.state === 'done' && (
                  <p className="text-muted-foreground">
                    {who ? shortName(who) : '—'}
                    {took != null && ` · ${took} мин`}
                  </p>
                )}
                {(step.state === 'current' || step.state === 'waiting') && (
                  <p style={{ color: def.hex }} className="font-medium">
                    {step.state === 'current'
                      ? `сейчас у ${who ? shortName(who) : 'сотрудника'}`
                      : WAITING_FOR[step.key] || 'ждёт'}
                    {since && ` · ${formatElapsed(now - new Date(since).getTime())}`}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default LiveOrderChain;
