import Icon from '@/components/ui/icon';
import type { LiveEvent, LiveFloorData, LiveOrder, LivePerson } from '@/lib/liveFloorApi';
import {
  ROLE_LABEL,
  ROLE_ORDER,
  formatAgo,
  formatMinutes,
  initials,
  personState,
  productLabel,
  shortName,
  stageSince,
  useTicker,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

interface LiderTvPeopleProps {
  people: LivePerson[];
  orders: LiveOrder[];
  events: LiveEvent[];
  today: LiveFloorData['today'];
  names: Record<string, string>;
  clockOffset: number;
  movedIds: Set<number>;
}

const ROLE_STYLE: Record<string, { avatar: string; icon: string; panel: string; badge: string }> = {
  cutter: {
    avatar: 'from-amber-400 to-amber-600',
    icon: 'Scissors',
    panel: 'border-amber-400/30 bg-amber-500/10',
    badge: 'bg-amber-500',
  },
  sewer: {
    avatar: 'from-sky-400 to-sky-600',
    icon: 'Shirt',
    panel: 'border-sky-400/30 bg-sky-500/10',
    badge: 'bg-sky-500',
  },
  packer: {
    avatar: 'from-orange-400 to-orange-600',
    icon: 'PackageCheck',
    panel: 'border-orange-400/30 bg-orange-500/10',
    badge: 'bg-orange-500',
  },
  packer_returns: {
    avatar: 'from-violet-400 to-violet-600',
    icon: 'PackageOpen',
    panel: 'border-violet-400/30 bg-violet-500/10',
    badge: 'bg-violet-500',
  },
};

const personStatus = (person: LivePerson, hands: LiveOrder[], working: boolean) => {
  const overlockCount = hands.filter((o) => o.sewingStatus === 'Раскроено').length;
  const sewingCount = hands.length - overlockCount;
  if (person.role === 'cutter') return hands.length ? `Кроит · в стеке ${hands.length}` : 'Ждёт стек';
  if (person.role === 'sewer') {
    const parts: string[] = [];
    if (sewingCount) parts.push(`шьёт ${sewingCount}`);
    if (overlockCount) parts.push(`оверлок ${overlockCount}`);
    return parts.length ? parts.join(' · ') : 'Ждёт заказ';
  }
  if (person.role === 'packer_returns') return working ? 'Перепаковывает' : 'Ждёт возвраты';
  return working ? 'Стикерует' : 'Ждёт вещи';
};

const OrderPill = ({
  order,
  clockOffset,
  moved,
}: {
  order: LiveOrder;
  clockOffset: number;
  moved: boolean;
}) => {
  const now = useTicker() + clockOffset;
  const since = stageSince(order);
  const elapsed = since ? now - new Date(since).getTime() : 0;
  const slow = since && elapsed > 45 * 60000;
  const label = productLabel(order);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-lg font-semibold ${
        moved
          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
          : slow
            ? 'border-red-400/60 bg-red-500/15 text-red-100'
            : 'border-white/15 bg-black/30 text-slate-100'
      }`}
    >
      {order.orderNumber}
      {label && <span className="max-w-[9rem] truncate font-sans text-base font-medium text-slate-400">{label}</span>}
    </span>
  );
};

const PersonCard = ({
  person,
  orders,
  events,
  today,
  names,
  clockOffset,
  movedIds,
}: Omit<LiderTvPeopleProps, 'people'> & { person: LivePerson }) => {
  const now = useTicker() + clockOffset;
  const style = ROLE_STYLE[person.role] || ROLE_STYLE.sewer;
  const { hands: rawHands, working, idleAlert, lastAt, idleMs } = personState(person, orders, events, now);
  const hands = [...rawHands].sort((a, b) => (stageSince(a) || '').localeCompare(stageSince(b) || ''));
  const stats = today[String(person.id)] || {};
  const status = personStatus(person, hands, working);
  const idleText = working
    ? ''
    : idleAlert
      ? ` · простой ${formatMinutes(idleMs)}`
      : lastAt
        ? ` · ${formatAgo(idleMs)}`
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
    person.role === 'packer' ? events.filter((e) => e.userId === person.id && e.kind === 'packed').slice(0, 4) : [];
  const visible = person.role === 'cutter' ? 10 : 5;

  return (
    <article
      className={`flex min-w-0 flex-col gap-2.5 rounded-2xl border bg-slate-900/70 p-3.5 ${
        idleAlert ? 'border-amber-400 ring-2 ring-amber-400/40' : working ? 'border-emerald-400/50' : 'border-white/10'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xl font-bold text-white ${style.avatar} ${
            working ? '' : 'opacity-70'
          }`}
        >
          {initials(person.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-bold leading-tight text-white">{shortName(person.name)}</p>
          <p className="truncate text-base text-slate-400">
            {person.workshopName || 'цех'}
            {' · '}
            {todayCaption}
            {person.role === 'sewer' && !!stats.overlock ? ` · обмётка ${stats.overlock}` : ''}
          </p>
        </div>
        <p key={todayCount} className="shrink-0 animate-count-bump text-5xl font-bold leading-none tabular-nums text-white">
          {todayCount}
        </p>
      </div>

      <p
        className={`text-xl font-semibold leading-snug ${
          working ? 'text-emerald-300' : idleAlert ? 'text-amber-300' : 'text-slate-400'
        }`}
      >
        {status}
        {idleText}
      </p>

      {hands.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hands.slice(0, visible).map((o) => (
            <OrderPill key={o.id} order={o} clockOffset={clockOffset} moved={movedIds.has(o.id)} />
          ))}
          {hands.length > visible && (
            <span className="self-center text-lg text-slate-400">ещё {hands.length - visible}</span>
          )}
        </div>
      )}

      {packedRecently.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {packedRecently.map((e) => (
            <span
              key={`${e.orderId}-${e.at}`}
              className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-mono text-lg text-emerald-200"
            >
              {e.orderNumber}
            </span>
          ))}
        </div>
      )}
    </article>
  );
};

/** Кто на смене и что у каждого в руках — крупные карточки на телевизор. */
const LiderTvPeople = ({ people, ...rest }: LiderTvPeopleProps) => {
  const now = useTicker() + rest.clockOffset;

  if (people.length === 0) {
    return (
      <div className="flex items-center gap-3 py-10 text-3xl text-slate-400">
        <Icon name="Users" size={36} />
        Сейчас никто из цеха не на смене
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
        return (
          <section key={role} className={`rounded-2xl border p-4 ${style.panel}`}>
            <header className="mb-3 flex flex-wrap items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${style.badge}`}>
                <Icon name={style.icon} size={22} />
              </span>
              <h2 className="text-2xl font-bold text-white">{ROLE_LABEL[role]}</h2>
              <span className="rounded-full bg-black/30 px-3 py-1 text-lg text-slate-300">на смене {group.length}</span>
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-lg text-emerald-200">в работе {busy}</span>
              {idle > 0 && (
                <span className="rounded-full bg-amber-500/20 px-3 py-1 text-lg text-amber-200">простой {idle}</span>
              )}
            </header>
            <div className="grid grid-cols-2 gap-3">
              {group.map((p) => (
                <PersonCard key={p.id} person={p} {...rest} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default LiderTvPeople;
