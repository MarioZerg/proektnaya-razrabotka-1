import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { profileAvatarSrc } from '@/lib/profileAvatar';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePolling } from '@/hooks/usePolling';
import { fetchLogEvents, type LogEvent } from '@/lib/logsApi';
import { fetchSupplies, type Supply } from '@/lib/marketplaceSuppliesApi';
import { isStorekeeperRole, roleLabels, type Role } from '@/lib/roles';
import { fetchEmployeeShifts, type EmployeeShiftStatus } from '@/lib/shiftSessionsApi';
import { fetchEmployees } from '@/lib/usersApi';

const RING_MS = 2800;
let ringOrigin = 0;

/** Один и тот же момент старта, чтобы полоска кружка совпадала с полоской виджета. */
const ringDelay = () => {
  if (!ringOrigin) ringOrigin = performance.now();
  return `-${((performance.now() - ringOrigin) % RING_MS).toFixed(0)}ms`;
};

/** Рамка виджета. Свет обрезан по контуру и наружу не выходит. */
export const WidgetRunRing = () => {
  const delay = useRef(ringDelay());
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      <span
        className="absolute left-1/2 top-1/2 aspect-square w-[280%] animate-tile-ring bg-[conic-gradient(from_0deg,transparent_62%,#6ee7b7_80%,#047857_90%,transparent_100%)]"
        style={{ animationDelay: delay.current }}
      />
    </span>
  );
};
const SIZE = 28;
const OVERLAP = SIZE / 2;

interface SupplyLine {
  id: number;
  type: 'FBS' | 'FBO';
  title: string;
  done: boolean;
}

/** Цифры только с момента открытия этой смены. Новая смена начинает счёт заново. */
interface ShiftWork {
  cut: number;
  sewn: number;
  stickered: number;
  supplies: SupplyLine[];
}

interface PersonOnShift {
  id: number;
  name: string;
  role: string;
  openedAt: string;
  avatarUrl: string | null;
  cutter: boolean;
}

/** Журнал работы и поставки обновляем реже списка смен. */
const WORK_REFRESH_MS = 5 * 60 * 1000;

interface WorkCache {
  at: number;
  day: string;
  withSupplies: boolean;
  sewn: LogEvent[];
  cut: LogEvent[];
  packed: LogEvent[];
  supplies: Supply[];
}

/** Аватарки берём один раз на вкладку: справочник сотрудников тяжёлый и меняется редко. */
let avatarsPromise: Promise<Map<number, string | null | undefined>> | null = null;
const loadAvatars = () => {
  if (!avatarsPromise) {
    avatarsPromise = fetchEmployees()
      .then((employees) => new Map(employees.map((employee) => [employee.id, employee.avatarUrl])))
      .catch(() => {
        avatarsPromise = null;
        return new Map<number, string | null | undefined>();
      });
  }
  return avatarsPromise;
};

const moscowDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

const dutyOf = (person: EmployeeShiftStatus) => person.sessionRole || person.role;

const roleTitle = (role: string) => roleLabels[role as Role] || role;

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

const pullToday = async (stage: 'sewing' | 'cutting' | 'stickering') => {
  const day = moscowDay();
  const limit = 500;
  const first = await fetchLogEvents({ stage, dateFrom: day, dateTo: day, limit, offset: 0 });
  const pages = Math.min(4, Math.ceil((first.total || first.items.length) / limit));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
      fetchLogEvents({ stage, dateFrom: day, dateTo: day, limit, offset: (index + 1) * limit }),
    ),
  );
  return [first.items, ...rest.map((page) => page.items)].flat();
};

const afterOpen = (person: PersonOnShift, at: string | null | undefined) =>
  !!at && new Date(at).getTime() >= new Date(person.openedAt).getTime();

const suppliesForShift = (person: PersonOnShift, supplies: Supply[]): SupplyLine[] =>
  supplies
    .filter((supply) => supply.type === 'FBS' || supply.type === 'FBO')
    .filter((supply) => {
      if (supply.status === 'На сборке' || supply.status === 'Отгрузка') return true;
      // «Отгружено» — поставка уже уехала целиком и ждёт автозакрытия.
      if (supply.status === 'Отгружено') return afterOpen(person, supply.autoStatusAt);
      return supply.status === 'Выполнена' && afterOpen(person, supply.completedAt);
    })
    .map((supply) => ({
      id: supply.id,
      type: supply.type,
      title: supply.supplyNumber || supply.cluster || `№${supply.id}`,
      done: supply.status === 'Выполнена' || supply.status === 'Отгружено',
    }));

/** Что показать в карточке — зависит от должности и только от этой смены. */
const workFor = (
  person: PersonOnShift,
  sewn: LogEvent[],
  cut: LogEvent[],
  packed: LogEvent[],
  supplies: Supply[],
): ShiftWork => {
  const ownSewn = sewn.filter(
    (event) => event.action === 'send_to_stickering' && event.userId === person.id && afterOpen(person, event.at),
  );
  const ownOrders = new Set(
    sewn
      .filter((event) => event.action === 'send_to_stickering' && event.userId === person.id && event.entityId != null)
      .map((event) => event.entityId),
  );
  return {
    cut: cut.filter((event) => event.action === 'cut' && event.userId === person.id && afterOpen(person, event.at)).length,
    sewn: ownSewn.length,
    stickered: person.cutter
      ? 0
      : person.role === 'packer' || person.role === 'packer_returns'
        ? packed.filter((event) => event.action === 'close_order' && event.userId === person.id && afterOpen(person, event.at)).length
        : packed.filter(
            (event) =>
              event.action === 'close_order' &&
              event.entityId != null &&
              ownOrders.has(event.entityId) &&
              afterOpen(person, event.at),
          ).length,
    supplies: isStorekeeperRole(person.role as Role) ? suppliesForShift(person, supplies) : [],
  };
};

const WorkLines = ({ person, work }: { person: PersonOnShift; work: ShiftWork | null }) => {
  if (!work) return <p className="mt-3 text-sm text-muted-foreground">Считаем смену…</p>;
  if (isStorekeeperRole(person.role as Role)) {
    if (work.supplies.length === 0) {
      return <p className="mt-3 text-sm text-muted-foreground">Сборок FBS и FBO в эту смену нет</p>;
    }
    return (
      <div className="mt-3 max-h-40 space-y-1 overflow-auto">
        {work.supplies.map((supply) => (
          <Link
            key={supply.id}
            to={`/crm/shipments/to-marketplace/${supply.id}`}
            className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted"
          >
            <span className="min-w-0 truncate">
              {supply.type} · {supply.title}
            </span>
            <span className={supply.done ? 'shrink-0 text-emerald-700' : 'shrink-0 text-amber-700'}>
              {supply.done ? 'завершена' : 'ещё'}
            </span>
          </Link>
        ))}
      </div>
    );
  }
  if (person.cutter) {
    return (
      <p className="mt-3 text-sm">
        Раскроено <span className="font-semibold tabular-nums">{work.cut}</span>
      </p>
    );
  }
  if (person.role === 'packer' || person.role === 'packer_returns') {
    return (
      <p className="mt-3 text-sm">
        Застикеровано <span className="font-semibold tabular-nums">{work.stickered}</span>
      </p>
    );
  }
  if (person.role === 'sewer') {
    return (
      <div className="mt-3 space-y-1 text-sm">
        <p>
          Отшито <span className="font-semibold tabular-nums">{work.sewn}</span>
        </p>
        <p>
          Застикеровано <span className="font-semibold tabular-nums">{work.stickered}</span>
        </p>
      </div>
    );
  }
  return null;
};

const Face = ({ person }: { person: PersonOnShift }) => (
  <span className="absolute inset-[3px] overflow-hidden rounded-full bg-card">
    <Avatar className="h-full w-full">
      <AvatarImage
        src={profileAvatarSrc(person.avatarUrl)}
        alt=""
        referrerPolicy="no-referrer"
        className="object-cover"
      />
      <AvatarFallback className="text-[9px]">{initials(person.name)}</AvatarFallback>
    </Avatar>
  </span>
);

const Circle = ({
  person,
  index,
  count,
  hostRef,
}: {
  person: PersonOnShift;
  index: number;
  count: ShiftWork | null;
  hostRef: RefObject<HTMLDivElement | null>;
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const delay = useRef(ringDelay());
  const [glow, setGlow] = useState<{ dx: number; dy: number; size: number } | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const button = buttonRef.current;
    if (!host || !button) return;
    const place = () => {
      const hostBox = host.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      setGlow({
        dx: hostBox.left + hostBox.width / 2 - (buttonBox.left + buttonBox.width / 2),
        dy: hostBox.top + hostBox.height / 2 - (buttonBox.top + buttonBox.height / 2),
        size: Math.max(hostBox.width, hostBox.height) * 2.8,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef]);

  return (
  <Popover>
    <PopoverTrigger asChild>
      <button
        ref={buttonRef}
        type="button"
        aria-label={person.name}
        className="relative h-7 w-7 overflow-hidden rounded-full transition-transform duration-200 hover:z-30 hover:scale-[1.7] focus-visible:z-30 focus-visible:scale-[1.7] focus-visible:outline-none"
        style={{ marginRight: index === 0 ? 0 : -OVERLAP, zIndex: index + 1 }}
      >
        {glow && (
          <span
            aria-hidden
            className="pointer-events-none absolute animate-tile-ring bg-[conic-gradient(from_0deg,transparent_62%,#6ee7b7_80%,#047857_90%,transparent_100%)]"
            style={{
              left: `calc(50% + ${glow.dx}px)`,
              top: `calc(50% + ${glow.dy}px)`,
              width: glow.size,
              height: glow.size,
              animationDelay: delay.current,
            }}
          />
        )}
        <Face person={person} />
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-64 p-3" side="bottom" align="end">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
            <AvatarImage
              src={profileAvatarSrc(person.avatarUrl)}
              alt=""
              referrerPolicy="no-referrer"
              className="object-cover"
            />
            <AvatarFallback>{initials(person.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{person.name}</p>
          <p className="text-xs text-muted-foreground">{roleTitle(person.role)}</p>
        </div>
      </div>
      <WorkLines person={person} work={count} />
    </PopoverContent>
  </Popover>
  );
};

const Chain = ({
  people,
  counts,
  hostRef,
}: {
  people: PersonOnShift[];
  counts: Map<number, ShiftWork> | null;
  hostRef: RefObject<HTMLDivElement | null>;
}) => (
  <div className="flex flex-row-reverse items-center">
    {people.map((person, index) => (
      <Circle key={person.id} person={person} index={index} count={counts?.get(person.id) ?? null} hostRef={hostRef} />
    ))}
  </div>
);

/** Кружки открытых смен на углу плитки «Новые задания». */
const ShiftAvatarRail = ({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) => {
  const [people, setPeople] = useState<PersonOnShift[]>([]);
  const [counts, setCounts] = useState<Map<number, ShiftWork> | null>(null);

  const work = useRef<WorkCache | null>(null);

  const load = useCallback(async () => {
    try {
      const [shifts, avatars] = await Promise.all([fetchEmployeeShifts(), loadAvatars()]);
      const open = shifts
        .filter((shift) => shift.isOpen && shift.openedAt)
        .map((shift) => {
          const role = dutyOf(shift);
          return {
            id: shift.id,
            name: shift.fullName,
            role,
            openedAt: shift.openedAt as string,
            avatarUrl: avatars.get(shift.id) || null,
            cutter: role === 'cutter',
          };
        })
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
      setPeople(open);
      if (open.length === 0) {
        setCounts(new Map());
        return;
      }
      // Журнал и поставки тяжелее списка смен, поэтому берём их раз в несколько
      // минут, а не на каждом тике. Новая смена, новый день или кладовщик,
      // которому ещё не грузили поставки, — повод взять сразу.
      const needsSupplies = open.some((person) => isStorekeeperRole(person.role as Role));
      const cached = work.current;
      const stale =
        !cached ||
        cached.day !== moscowDay() ||
        Date.now() - cached.at >= WORK_REFRESH_MS ||
        (needsSupplies && !cached.withSupplies) ||
        open.some((person) => new Date(person.openedAt).getTime() > cached.at);
      let fresh = cached;
      if (stale) {
        const [sewn, cut, packed, assembling, shipping, finished, shippedFbs] = await Promise.all([
          pullToday('sewing').catch(() => [] as LogEvent[]),
          pullToday('cutting').catch(() => [] as LogEvent[]),
          pullToday('stickering').catch(() => [] as LogEvent[]),
          needsSupplies ? fetchSupplies({ status: 'На сборке' }).catch(() => [] as Supply[]) : Promise.resolve([] as Supply[]),
          needsSupplies ? fetchSupplies({ status: 'Отгрузка' }).catch(() => [] as Supply[]) : Promise.resolve([] as Supply[]),
          needsSupplies
            ? fetchSupplies({ status: 'Выполнена', dateFrom: moscowDay() }).catch(() => [] as Supply[])
            : Promise.resolve([] as Supply[]),
          needsSupplies ? fetchSupplies({ status: 'Отгружено' }).catch(() => [] as Supply[]) : Promise.resolve([] as Supply[]),
        ]);
        fresh = {
          at: Date.now(),
          day: moscowDay(),
          withSupplies: needsSupplies,
          sewn,
          cut,
          packed,
          supplies: [...assembling, ...shipping, ...finished, ...shippedFbs],
        };
        work.current = fresh;
      }
      const data = fresh as WorkCache;
      setCounts(new Map(open.map((person) => [person.id, workFor(person, data.sewn, data.cut, data.packed, data.supplies)])));
    } catch {
      setPeople([]);
    }
  }, []);

  usePolling(load, 60000);

  if (people.length === 0) return null;

  const crew = people.filter((person) => !person.cutter);
  const cutters = people.filter((person) => person.cutter);

  return (
    <div data-shift-rail="" className="pointer-events-none absolute -right-3.5 -top-3.5 z-20 flex flex-row-reverse items-start">
      <div className="pointer-events-auto">
        <Chain people={crew} counts={counts} hostRef={hostRef} />
      </div>
      {cutters.length > 0 && (
        <div className="pointer-events-auto mr-4 mt-3">
          <Chain people={cutters} counts={counts} hostRef={hostRef} />
        </div>
      )}
    </div>
  );
};

export default ShiftAvatarRail;
