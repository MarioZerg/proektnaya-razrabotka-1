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

const ROLE_STYLE: Record<string, { avatar: string; icon: string }> = {
  cutter: { avatar: 'from-amber-400 to-amber-600', icon: 'Scissors' },
  sewer: { avatar: 'from-sky-400 to-sky-600', icon: 'Shirt' },
  packer: { avatar: 'from-orange-400 to-orange-600', icon: 'PackageCheck' },
};

/** Через сколько минут без единого действия человек считается простаивающим. */
const IDLE_ALERT_MIN = 20;
const HANDS_VISIBLE = 6;

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
  const hands = ordersInHands(person, orders).sort((a, b) => {
    const sa = stageSince(a) || '';
    const sb = stageSince(b) || '';
    return sa.localeCompare(sb);
  });
  const myEvents = events.filter((e) => e.userId === person.id);
  const lastAt = myEvents[0]?.at || null;
  const lastMs = lastAt ? now - new Date(lastAt).getTime() : null;
  const stats = today[String(person.id)] || {};

  const overlockCount = hands.filter((o) => o.sewingStatus === 'Раскроено').length;
  const sewingCount = hands.length - overlockCount;
  // У упаковки вещей «в руках» нет — она закрывает их на терминале. Работает,
  // если что-то упаковала за последние 10 минут.
  const working =
    person.role === 'packer' ? lastMs != null && lastMs < 10 * 60000 : hands.length > 0;
  const idleSince = lastAt || person.shiftOpenedAt;
  const idleMs = idleSince ? now - new Date(idleSince).getTime() : 0;
  const idleAlert = !working && idleMs > IDLE_ALERT_MIN * 60000;
  const idleText = working
    ? ''
    : idleAlert
      ? ` · простой ${formatMinutes(idleMs)}`
      : lastAt
        ? ` · последнее действие ${formatAgo(idleMs)}`
        : '';

  let status: string;
  if (person.role === 'cutter') {
    status = hands.length ? `Кроит · в стеке ${hands.length}` : 'Ждёт стек';
  } else if (person.role === 'sewer') {
    const parts: string[] = [];
    if (sewingCount) parts.push(`шьёт ${sewingCount}`);
    if (overlockCount) parts.push(`на оверлоке ${overlockCount}`);
    status = parts.length ? parts.join(' · ') : 'Ждёт заказ';
  } else {
    status = working ? 'Стикерует' : 'Ждёт вещи';
  }

  const [todayCount, todayCaption] =
    person.role === 'cutter'
      ? [stats.cut || 0, 'раскроено']
      : person.role === 'packer'
        ? [stats.packed || 0, 'упаковано']
        : [stats.sewn || 0, 'отшито'];

  const packedRecently =
    person.role === 'packer' ? myEvents.filter((e) => e.kind === 'packed').slice(0, 4) : [];

  return (
    <div
      className={`flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-3 transition-colors ${
        idleAlert ? 'border-amber-300 bg-amber-50/40' : working ? 'border-emerald-200' : ''
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ${style.avatar} ${
              working ? '' : 'opacity-70'
            }`}
          >
            {initials(person.name)}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
            {working && (
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-70" />
            )}
            <span
              className={`relative h-3.5 w-3.5 rounded-full border-2 border-card ${
                working ? 'bg-emerald-500' : idleAlert ? 'animate-breathe bg-amber-500' : 'bg-slate-400'
              }`}
            />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-start gap-1 text-sm font-semibold leading-tight">
            <span className="min-w-0 break-words">{person.name}</span>
            {person.canOverlock && person.role === 'sewer' && (
              <Icon name="Zap" size={12} className="shrink-0 text-fuchsia-600" />
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {person.workshopName || 'цех не указан'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p key={todayCount} className="inline-block animate-count-bump text-lg font-bold leading-none tabular-nums">
            {todayCount}
          </p>
          <p className="text-[10px] leading-tight text-muted-foreground">{todayCaption} сегодня</p>
          {person.role === 'sewer' && !!stats.overlock && (
            <p className="text-[10px] leading-tight text-fuchsia-700">обметано {stats.overlock}</p>
          )}
        </div>
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
          {hands.slice(0, 12).map((o) => (
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
          {hands.length > 12 && (
            <span className="px-1 text-[11px] text-muted-foreground">ещё {hands.length - 12}</span>
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
    </div>
  );
};

/** Кто на смене и что у каждого в руках прямо сейчас. */
const LiveFloorPeople = ({ people, ...rest }: LiveFloorPeopleProps) => {
  if (people.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        <Icon name="Users" size={16} />
        Сейчас никто из цеха не на смене.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ROLE_ORDER.map((role) => {
        const group = people.filter((p) => p.role === role);
        if (group.length === 0) return null;
        const busy = group.filter((p) =>
          role === 'packer'
            ? rest.events.some(
                (e) =>
                  e.userId === p.id &&
                  Date.now() - new Date(e.at).getTime() < 10 * 60000,
              )
            : ordersInHands(p, rest.orders).length > 0,
        ).length;
        return (
          <section key={role} className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Icon name={ROLE_STYLE[role].icon} size={15} className="text-muted-foreground" />
              <span className="font-semibold">{ROLE_LABEL[role]}</span>
              <span className="text-xs text-muted-foreground">
                на смене {group.length} · в работе {busy}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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

export default LiveFloorPeople;
