import { useMemo, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import type { VacationPerson } from '@/lib/usersApi';

const ROLE_ORDER: Role[] = [
  'sewer', 'cutter', 'packer', 'packer_returns',
  'storekeeper', 'senior_storekeeper', 'cleaner', 'manager',
];

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parse = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const formatRange = (from: string, to: string) => {
  const a = parse(from);
  const b = parse(to);
  const left = a.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const right = b.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return from === to ? left : `${left} – ${right}`;
};

interface VacationCalendarProps {
  people: VacationPerson[];
  today: string;
  /** Сотрудник бронирует только себя. Без id календарь только для просмотра. */
  selfId?: number | null;
  onBook?: (from: string, to: string) => void;
  onCancel?: (bookingId: number) => void;
  saving?: boolean;
}

/** Календарь отпусков: сверху должности и брони, в клетках — аватар того, кто занял день. */
const VacationCalendar = ({
  people,
  today,
  selfId = null,
  onBook,
  onCancel,
  saving = false,
}: VacationCalendarProps) => {
  const anchor = parse(today || iso(new Date()));
  const [cursor, setCursor] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, VacationPerson>();
    people.forEach((person) => {
      person.bookings.forEach((booking) => {
        const from = parse(booking.from);
        const to = parse(booking.to);
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          map.set(iso(d), person);
        }
      });
    });
    return map;
  }, [people]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(year, month, i + 1))),
  ];

  const self = people.find((p) => p.id === selfId) || null;
  const rangeFrom = start && end ? (start < end ? start : end) : start;
  const rangeTo = start && end ? (start < end ? end : start) : start;

  const addDays = (value: string, count: number) => {
    const next = parse(value);
    next.setDate(next.getDate() + count);
    return iso(next);
  };

  const blockFits = (day: string) => {
    if (!self || self.takenThisPeriod) return false;
    if (day <= today) return false;
    if (self.periodFrom && day < self.periodFrom) return false;
    const last = addDays(day, 13);
    if (self.periodTo && last > self.periodTo) return false;
    for (let offset = 0; offset < 14; offset += 1) {
      const who = byDay.get(addDays(day, offset));
      if (who && who.id !== self.id) return false;
    }
    return true;
  };

  const pick = (day: string) => {
    if (!onBook || !blockFits(day)) return;
    setStart(day);
    setEnd(addDays(day, 13));
  };

  const inSelection = (day: string) =>
    !!rangeFrom && !!rangeTo && day >= rangeFrom && day <= rangeTo;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed">
        <p className="font-semibold">Как работает календарь</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>В году 28 дней отпуска. Их делят на два раза по 14 дней: один отпуск в каждом полугодии.</li>
          <li>Первые полгода после даты выхода отпуск закрыт. Дату ставит администратор в профиле.</li>
          <li>На терминале отмечают первый день. Система сама ставит 14 дней подряд внутри текущего полугодия. Второй раз в том же полугодии уйти нельзя.</li>
          <li>В один день может уйти только один сотрудник. Занятые дни отмечены аватаркой, и чужой блок из 14 дней на них не встать.</li>
          <li>Пропущенное полугодие не удлиняет следующий отпуск: он снова будет ровно 14 дней.</li>
        </ul>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {ROLE_ORDER.map((role) => {
          const group = people.filter((p) => p.role === role && p.bookings.length > 0);
          if (!group.length) return null;
          return (
            <div key={role} className="min-w-[12rem] shrink-0 rounded-lg border border-border bg-card p-2">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {roleLabels[role]}
              </p>
              <div className="space-y-2">
                {group.map((person) => (
                  <div key={person.id} className="flex items-center gap-2">
                    <Avatar className="h-9 w-9 shrink-0">
                      {person.avatarUrl && <AvatarImage src={person.avatarUrl} />}
                      <AvatarFallback>{initials(person.fullName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{person.fullName}</p>
                      {person.bookings.map((b) => (
                        <p key={b.id} className="text-xs text-muted-foreground">
                          {formatRange(b.from, b.to)}
                          {onCancel && (
                            <button
                              type="button"
                              className="ml-1 text-destructive"
                              onClick={() => onCancel(b.id)}
                            >
                              снять
                            </button>
                          )}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setCursor(new Date(year, month - 1, 1))}>
          <Icon name="ChevronLeft" size={16} />
        </Button>
        <p className="text-base font-semibold capitalize">
          {cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setCursor(new Date(year, month + 1, 1))}>
          <Icon name="ChevronRight" size={16} />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div key={`e-${index}`} />;
          const who = byDay.get(day);
          const past = day <= today;
          const closed = !!onBook && !!self && !blockFits(day);
          const selected = inSelection(day);
          return (
            <button
              key={day}
              type="button"
              disabled={!onBook || closed}
              onClick={() => pick(day)}
              className={`flex min-h-[4.25rem] flex-col items-center justify-start rounded-md border p-1 text-sm ${
                selected ? 'border-primary bg-primary/10' : 'border-border bg-card'
              } ${past || closed ? 'opacity-40' : ''}`}
            >
              <span>{Number(day.slice(-2))}</span>
              {who && (
                <Avatar className="mt-1 h-7 w-7" title={who.fullName}>
                  {who.avatarUrl && <AvatarImage src={who.avatarUrl} />}
                  <AvatarFallback className="text-[10px]">{initials(who.fullName)}</AvatarFallback>
                </Avatar>
              )}
            </button>
          );
        })}
      </div>

      {self && onBook && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          {!self.hiredAt && (
            <p className="text-sm text-amber-700">Администратор ещё не указал дату выхода на работу</p>
          )}
          {self.hiredAt && self.eligibleFrom && self.eligibleFrom > today && (
            <p className="text-sm">
              Отпуск откроется {parse(self.eligibleFrom).toLocaleDateString('ru-RU')}
            </p>
          )}
          {self.eligibleFrom && self.eligibleFrom <= today && self.takenThisPeriod && (
            <p className="text-sm">В этом полугодии отпуск уже выбран</p>
          )}
          {self.eligibleFrom && self.eligibleFrom <= today && !self.takenThisPeriod && (
            <p className="text-sm">
              Нажмите первый день — встанут 14 дней подряд
              {self.periodFrom && self.periodTo
                ? ` в окне ${parse(self.periodFrom).toLocaleDateString('ru-RU')} – ${parse(self.periodTo).toLocaleDateString('ru-RU')}`
                : ''}
              .
            </p>
          )}
          {rangeFrom && (
            <p className="text-sm font-medium">{formatRange(rangeFrom, rangeTo || rangeFrom)}</p>
          )}
          <Button
            type="button"
            className="w-full"
            disabled={saving || !rangeFrom || !rangeTo}
            onClick={() => rangeFrom && rangeTo && onBook(rangeFrom, rangeTo)}
          >
            Забронировать
          </Button>
        </div>
      )}
    </div>
  );
};

export default VacationCalendar;
