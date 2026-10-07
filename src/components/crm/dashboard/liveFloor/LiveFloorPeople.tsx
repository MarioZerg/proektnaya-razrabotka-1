import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { LiveEvent, LiveFloorData, LiveOrder, LivePerson } from '@/lib/liveFloorApi';
import LiveOrderChip from '@/components/crm/dashboard/liveFloor/LiveOrderChip';
import {
  ROLE_LABEL,
  ROLE_ORDER,
  formatAgo,
  formatMinutes,
  initials,
  ordersInHands,
  personState,
  shortName,
  stageSince,
  useTicker,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

interface LiveFloorPeopleProps {
  people: LivePerson[];
  orders: LiveOrder[];
  events: LiveEvent[];
  today: LiveFloorData['today'];
  names: Record<string, string>;
  clockOffset: number;
  movedIds: Set<number>;
  highlightIds: Set<number>;
}

const ROLE_STYLE: Record<
  string,
  { avatar: string; icon: string; panel: string; badge: string }
> = {
  cutter: {
    avatar: 'from-amber-400 to-amber-600',
    icon: 'Scissors',
    panel: 'border-amber-200/70 bg-amber-50/40',
    badge: 'bg-amber-500',
  },
  sewer: {
    avatar: 'from-sky-400 to-sky-600',
    icon: 'Shirt',
    panel: 'border-sky-200/70 bg-sky-50/40',
    badge: 'bg-sky-500',
  },
  packer: {
    avatar: 'from-orange-400 to-orange-600',
    icon: 'PackageCheck',
    panel: 'border-orange-200/70 bg-orange-50/40',
    badge: 'bg-orange-500',
  },
  packer_returns: {
    avatar: 'from-violet-400 to-violet-600',
    icon: 'PackageOpen',
    panel: 'border-violet-200/70 bg-violet-50/40',
    badge: 'bg-violet-500',
  },
};

const HANDS_VISIBLE = 4;
const STACK_VISIBLE = 12;

const PersonCard = ({
  person,
  orders,
  events,
  today,
  names,
  clockOffset,
  movedIds,
  highlightIds,
}: Omit<LiveFloorPeopleProps, 'people'> & { person: LivePerson }) => {
  const now = useTicker() + clockOffset;
  const style = ROLE_STYLE[person.role] || ROLE_STYLE.sewer;
  const { hands: rawHands, working, idleAlert, lastAt, idleMs } = personState(
    person,
    orders,
    events,
    now,
  );
  const hands = [...rawHands].sort((a, b) => (stageSince(a) || '').localeCompare(stageSince(b) || ''));
  const stats = today[String(person.id)] || {};

  const overlockCount = hands.filter((o) => o.sewingStatus === 'Раскроено').length;
  const sewingCount = hands.length - overlockCount;

  let status: string;
  if (person.role === 'cutter') {
    status = hands.length ? `Кроит · в стеке ${hands.length}` : 'Ждёт стек';
  } else if (person.role === 'sewer') {
    const parts: string[] = [];
    if (sewingCount) parts.push(`шьёт ${sewingCount}`);
    if (overlockCount) parts.push(`на оверлоке ${overlockCount}`);
    status = parts.length ? parts.join(' · ') : 'Ждёт заказ';
  } else if (person.role === 'packer_returns') {
    status = working ? 'Перепаковывает' : 'Ждёт возвраты';
  } else {
    status = working ? 'Стикерует' : 'Ждёт вещи';
  }
  const idleText = working
    ? ''
    : idleAlert
      ? ` · простой ${formatMinutes(idleMs)}`
      : lastAt
        ? ` · последнее действие ${formatAgo(idleMs)}`
        : '';

  const [todayCount, todayCaption] =
    person.role === 'cutter'
      ? [stats.cut || 0, 'раскроено']
      : person.role === 'packer'
        ? [stats.packed || 0, 'упаковано']
        : person.role === 'packer_returns'
          ? [stats.packed || 0, 'перепаковано']
          : [stats.sewn || 0, 'отшито'];

  const packedRecently =
    person.role === 'packer'
      ? events.filter((e) => e.userId === person.id && e.kind === 'packed').slice(0, 4)
      : [];

  return (
    <article
      className={`flex h-full min-w-0 flex-col gap-3 overflow-visible rounded-xl border bg-card p-3.5 shadow-sm transition-colors ${
        idleAlert ? 'border-amber-300 ring-1 ring-amber-200' : working ? 'border-emerald-200' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0 p-0.5">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ${style.avatar} ${
              working ? '' : 'opacity-70'
            }`}
          >
            {initials(person.name)}
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center">
            {working && (
              <span className="absolute inset-0.5 animate-widget-pulse rounded-full bg-emerald-400 opacity-70" />
            )}
            <span
              className={`relative h-3.5 w-3.5 rounded-full border-2 border-card ${
                working ? 'bg-emerald-500' : idleAlert ? 'animate-breathe bg-amber-500' : 'bg-slate-400'
              }`}
            />
          </span>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="flex min-w-0 items-center gap-1 text-sm font-semibold leading-tight">
            <span className="min-w-0 truncate" title={person.name}>
              {shortName(person.name)}
            </span>
            {person.canOverlock && person.role === 'sewer' && (
              <Icon name="Zap" size={12} className="shrink-0 text-fuchsia-600" />
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {person.workshopName || 'цех не указан'}
            {' · '}
            {todayCaption}
            {person.role === 'sewer' && !!stats.overlock ? ` · обметано ${stats.overlock}` : ''}
          </p>
        </div>
        <p
          key={todayCount}
          className="shrink-0 animate-count-bump text-lg font-bold leading-none tabular-nums"
        >
          {todayCount}
        </p>
      </div>

      <div
        className={`flex items-start gap-1.5 text-xs font-medium ${
          working ? 'text-emerald-700' : idleAlert ? 'text-amber-800' : 'text-muted-foreground'
        }`}
      >
        <Icon name={working ? style.icon : idleAlert ? 'Pause' : 'Clock'} size={13} className="mt-px shrink-0" />
        <span className="min-w-0">
          {status}
          {idleText}
        </span>
      </div>

      {hands.length > 0 && person.role === 'cutter' && (
        <div className="flex flex-wrap gap-1">
          {hands.slice(0, STACK_VISIBLE).map((o) => (
            <LiveOrderChip
              key={o.id}
              order={o}
              names={names}
              clockOffset={clockOffset}
              moved={movedIds.has(o.id)}
              highlighted={highlightIds.has(o.id)}
              compact
            />
          ))}
          {hands.length > STACK_VISIBLE && (
            <span className="px-1 text-[11px] text-muted-foreground">ещё {hands.length - STACK_VISIBLE}</span>
          )}
        </div>
      )}

      {hands.length > 0 && person.role !== 'cutter' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
          {hands.slice(0, HANDS_VISIBLE).map((o) => (
            <div key={o.id} className="min-w-0 animate-scale-in">
              <LiveOrderChip
                order={o}
                names={names}
                clockOffset={clockOffset}
                moved={movedIds.has(o.id)}
                highlighted={highlightIds.has(o.id)}
              />
            </div>
          ))}
          {hands.length > HANDS_VISIBLE && (
            <div className="flex items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              ещё {hands.length - HANDS_VISIBLE}
            </div>
          )}
        </div>
      )}

      {packedRecently.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {packedRecently.map((e) => (
            <span
              key={`${e.orderId}-${e.at}`}
              className="inline-flex animate-feed-in items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[10px] text-emerald-800"
            >
              <Icon name="Check" size={10} />
              {e.orderNumber}
            </span>
          ))}
        </div>
      )}
    </article>
  );
};

/** Кто на смене и что у каждого в руках прямо сейчас — панель на каждую роль. */
const LiveFloorPeople = ({ people, ...rest }: LiveFloorPeopleProps) => {
  const now = useTicker() + rest.clockOffset;
  const [cuttersOpen, setCuttersOpen] = useState(true);
  const cutterHands = useRef<Map<number, number>>(new Map());
  const cutterPrimed = useRef(false);

  useEffect(() => {
    const cutters = people.filter((p) => p.role === 'cutter');
    let tookStack = false;
    cutters.forEach((p) => {
      const n = ordersInHands(p, rest.orders).length;
      const prev = cutterHands.current.get(p.id) ?? 0;
      if (cutterPrimed.current && n > prev) tookStack = true;
      cutterHands.current.set(p.id, n);
    });
    cutterPrimed.current = true;
    if (tookStack) setCuttersOpen(true);
  }, [people, rest.orders]);

  if (people.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        <Icon name="Users" size={16} />
        Сейчас никто из цеха не на смене.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {ROLE_ORDER.map((role) => {
        const group = people.filter((p) => p.role === role);
        if (group.length === 0) return null;
        const style = ROLE_STYLE[role];
        const states = group.map((p) => personState(p, rest.orders, rest.events, now));
        const busy = states.filter((s) => s.working).length;
        const idle = states.filter((s) => s.idleAlert).length;
        const collapsible = role === 'cutter';
        const open = !collapsible || cuttersOpen;
        return (
          <section key={role} className={`min-w-0 overflow-visible rounded-2xl border p-3 sm:p-5 ${style.panel}`}>
            {collapsible ? (
              <button
                type="button"
                onClick={() => setCuttersOpen((v) => !v)}
                aria-expanded={open}
                className="mb-0 flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 text-left"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${style.badge}`}
                >
                  <Icon name={style.icon} size={16} />
                </span>
                <h3 className="text-sm font-semibold">{ROLE_LABEL[role]}</h3>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground">
                    на смене {group.length}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                    в работе {busy}
                  </span>
                  {idle > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                      простой {idle}
                    </span>
                  )}
                </div>
                <Icon
                  name="ChevronDown"
                  size={16}
                  className={`ml-auto text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
            ) : (
              <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${style.badge}`}
                >
                  <Icon name={style.icon} size={16} />
                </span>
                <h3 className="text-sm font-semibold">{ROLE_LABEL[role]}</h3>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground">
                    на смене {group.length}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                    в работе {busy}
                  </span>
                  {idle > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                      простой {idle}
                    </span>
                  )}
                </div>
              </header>
            )}
            {open && (
              <div className={`${collapsible ? 'mt-4' : ''} grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4`}>
                {group.map((p) => (
                  <PersonCard key={p.id} person={p} {...rest} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default LiveFloorPeople;
