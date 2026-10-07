import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import { formatDateTime, formatTime, timeAgo } from '@/lib/dateUtils';
import {
  isOnOverlock,
  isOrderCancelled,
  shortFio,
} from '@/components/crm/sewingItems/sewingItemsShared';

interface SewingItemTimelineProps {
  selectedOrder: Order;
  /** Без своей рамки — когда блок уже внутри свёртки. */
  bare?: boolean;
}

type StepState = 'done' | 'current' | 'waiting' | 'pending';

interface Step {
  key: string;
  label: string;
  icon: string;
  hex: string;
  at: string | null;
  who: string | null;
  state: StepState;
}

const waitingText: Record<string, string> = {
  cutting: 'ждёт закройщика',
  overlock: 'ждёт оверлок',
  sewing: 'ждёт швею',
  stickering: 'ждёт упаковку',
  done: 'ещё не готово',
};

const buildSteps = (o: Order): Step[] => {
  const status = o.sewingStatus;
  const fromStock = status === 'Со склада';
  const cutDone = !!o.cutAt;
  const ovNeeded = !!o.requiresOverlock;
  const ovDone = !!o.overlockedAt;
  const ovWork = isOnOverlock(o);
  const sewDone = !!o.sewnAt;
  const packed = !!o.packedAt || status === 'Готовые';
  const cuttingNow = status === 'На раскрое';
  const sewingNow = status === 'В работе';
  const stickeringNow = status === 'Стикеровка';

  const created: Step = {
    key: 'created',
    label: 'Создан в системе',
    icon: 'Plus',
    hex: '#64748b',
    at: o.createdAt,
    who: null,
    state: 'done',
  };

  if (fromStock) {
    return [
      created,
      {
        key: 'done',
        label: 'Закрыт со склада',
        icon: 'PackageCheck',
        hex: '#0d9488',
        at: o.completedAt || o.packedAt || null,
        who: o.packerUserName,
        state: 'done',
      },
    ];
  }

  const cutting: Step = {
    key: 'cutting',
    label: 'Раскрой',
    icon: 'Scissors',
    hex: '#f59e0b',
    at: o.cutAt || null,
    who: o.cutterUserName || (cuttingNow ? o.assignedUserName : null),
    state: cutDone ? 'done' : cuttingNow ? 'current' : 'waiting',
  };

  const overlock: Step | null = ovNeeded
    ? {
        key: 'overlock',
        label: 'Оверлок',
        icon: 'Zap',
        hex: '#c026d3',
        at: o.overlockedAt || o.overlockTakenAt || null,
        who: o.overlockUserName,
        state: ovDone
          ? 'done'
          : ovWork
            ? 'current'
            : cutDone
              ? 'waiting'
              : 'pending',
      }
    : null;

  const sewing: Step = {
    key: 'sewing',
    label: 'Пошив',
    icon: 'Shirt',
    hex: '#0ea5e9',
    at: o.sewnAt || o.takenAt || null,
    who: o.sewerUserName || (sewingNow ? o.assignedUserName : null),
    state: sewDone
      ? 'done'
      : sewingNow
        ? 'current'
        : cutDone && (!ovNeeded || ovDone)
          ? 'waiting'
          : 'pending',
  };

  const stickering: Step = {
    key: 'stickering',
    label: 'Стикеровка',
    icon: 'Tag',
    hex: '#f97316',
    at: o.packedAt || (packed ? o.completedAt || null : null),
    who: o.packerUserName,
    state: packed ? 'done' : stickeringNow ? 'waiting' : sewDone ? 'waiting' : 'pending',
  };

  const done: Step = {
    key: 'done',
    label: 'Готово',
    icon: 'PackageCheck',
    hex: '#059669',
    at: packed ? o.packedAt || o.completedAt || null : null,
    who: null,
    state: packed ? 'done' : 'pending',
  };

  return [created, cutting, ...(overlock ? [overlock] : []), sewing, stickering, done];
};

const captionOf = (step: Step) => {
  if (step.state === 'done') {
    const parts: string[] = [];
    if (step.who) parts.push(shortFio(step.who));
    if (step.at) parts.push(timeAgo(step.at));
    return parts.join(' · ') || 'готово';
  }
  if (step.state === 'current') {
    const who = step.who ? shortFio(step.who) : 'сотрудника';
    const since = step.at ? ` с ${formatTime(step.at)} · ${timeAgo(step.at)}` : '';
    return `сейчас у ${who}${since}`;
  }
  if (step.state === 'waiting') {
    return waitingText[step.key] || 'ждёт';
  }
  return 'ещё не начат';
};

/** Движение вещи по цеху: создан → раскрой → оверлок → пошив → стикеровка → готово. */
const SewingItemTimeline = ({ selectedOrder, bare = false }: SewingItemTimelineProps) => {
  const steps = buildSteps(selectedOrder);
  const cancelled = isOrderCancelled(selectedOrder);

  const body = (
    <>
        {cancelled && (
          <p className="mb-3 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
            Отменён покупателем — дальше на склад
          </p>
        )}
        {selectedOrder.marketplaceCreatedAt && (
          <p className="mb-3 text-xs text-muted-foreground">
            Заказ на площадке {formatDateTime(selectedOrder.marketplaceCreatedAt)}
          </p>
        )}
        <ol>
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            return (
              <li key={step.key} className="relative flex gap-3 pb-3 last:pb-0">
                {!last && (
                  <span
                    className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-0.5 rounded-full"
                    style={{
                      background: step.state === 'done' ? step.hex : 'hsl(var(--border))',
                    }}
                  />
                )}
                <span className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
                  {step.state === 'current' && (
                    <span
                      className="absolute inset-0 animate-ping rounded-full opacity-40"
                      style={{ background: step.hex }}
                    />
                  )}
                  <span
                    className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                      step.state === 'done' || step.state === 'current' ? 'text-white' : 'bg-background'
                    }`}
                    style={{
                      borderColor: step.state === 'pending' ? 'hsl(var(--border))' : step.hex,
                      background:
                        step.state === 'done' || step.state === 'current' ? step.hex : undefined,
                      color: step.state === 'waiting' ? step.hex : undefined,
                    }}
                  >
                    <Icon
                      name={
                        step.state === 'done' ? 'Check' : step.state === 'waiting' ? 'Clock' : step.icon
                      }
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
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatDateTime(step.at)}
                      </span>
                    )}
                  </div>
                  <p
                    className={
                      step.state === 'current' || step.state === 'waiting'
                        ? 'font-medium'
                        : 'text-muted-foreground'
                    }
                    style={
                      step.state === 'current' || step.state === 'waiting'
                        ? { color: step.hex }
                        : undefined
                    }
                  >
                    {captionOf(step)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
    </>
  );

  if (bare) return <div className="space-y-0">{body}</div>;

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Таймлайн</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">{body}</CardContent>
    </Card>
  );
};

export default SewingItemTimeline;
