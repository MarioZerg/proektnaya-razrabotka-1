import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import type { ShiftCalendarDay, ShiftCalendarPerson } from '@/lib/shiftSessionsApi';

interface ShiftCalendarCardProps {
  selectedDate: Date | undefined;
  onSelectDate: (date: Date | undefined) => void;
  days: ShiftCalendarDay[];
}

/** Насыщенность клетки по числу вышедших: месяц читается как тепловая карта. */
const heat = (count: number, max: number) => {
  if (!count) return 'bg-transparent';
  const ratio = count / Math.max(1, max);
  if (ratio > 0.75) return 'bg-primary/25';
  if (ratio > 0.5) return 'bg-primary/[0.18]';
  if (ratio > 0.25) return 'bg-primary/[0.11]';
  return 'bg-primary/[0.06]';
};

/**
 * Календарь смен.
 *
 * Раньше это был обычный выбор даты: месяц с подчёркнутыми числами и список
 * фамилий под ним. По нему нельзя было ответить ни на один вопрос, ради
 * которого в календарь заходят, — сколько человек вышло, где провал, кто
 * опоздал. Приходилось тыкать в каждый день по очереди.
 *
 * Здесь месяц сам по себе отчёт: клетка тем плотнее, чем больше людей вышло,
 * снизу подпись с их числом, точка — если в этот день кто-то опоздал. Провал
 * в графике виден сразу, без единого клика. Выбранный день раскрывается
 * поимённо: время прихода, часы, цех.
 *
 * Сетка адаптивная: на телефоне клетки тянутся по ширине экрана, а не
 * держат фиксированные 36 пикселей от библиотечного календаря.
 */
const ShiftCalendarCard = ({ selectedDate, onSelectDate, days }: ShiftCalendarCardProps) => {
  const [detailsOpen, setDetailsOpen] = useState(true);

  // Месяц, который сейчас на экране. Через useMemo, иначе new Date() создавал бы
  // новый объект на каждый рендер и сетка месяца пересчитывалась бы вхолостую.
  const anchor = useMemo(() => selectedDate || new Date(), [selectedDate]);

  const byDate = useMemo(() => {
    const m = new Map<string, ShiftCalendarDay>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  // Полные недели с понедельника: месяц должен лежать ровной сеткой 7 колонок.
  const grid = useMemo(() => {
    const from = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: from, end: to });
  }, [anchor]);

  const monthDays = days.filter((d) => isSameMonth(new Date(d.date), anchor));
  const maxPeople = Math.max(1, ...monthDays.map((d) => d.employees.length));

  // Итоги месяца: рабочих дней, суммарных выходов, среднее в день, опоздания.
  const workedDays = monthDays.length;
  const totalVisits = monthDays.reduce((s, d) => s + d.employees.length, 0);
  const totalLate = monthDays.reduce((s, d) => s + (d.lateCount || 0), 0);
  const avgPerDay = workedDays ? Math.round(totalVisits / workedDays) : 0;

  const selectedKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
  const selectedRecord = byDate.get(selectedKey);
  const people: ShiftCalendarPerson[] =
    selectedRecord?.people ||
    // Запасной вариант для старого ответа сервера, где были только имена.
    (selectedRecord?.employees || []).map((name, i) => ({
      userId: -i,
      name,
      role: '',
      workshop: null,
      shiftNumber: null,
      openedAt: '',
      closedAt: null,
      hours: null,
      open: false,
      late: false,
    }));

  const shiftMonth = (delta: number) => onSelectDate(addMonths(anchor, delta));

  return (
    <Card className="border-border shadow-none lg:col-span-2">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Календарь смен</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => shiftMonth(-1)}
              aria-label="Предыдущий месяц"
            >
              <Icon name="ChevronLeft" size={16} />
            </Button>
            <span className="min-w-[108px] text-center text-sm font-medium capitalize">
              {format(anchor, 'LLLL yyyy', { locale: ru })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => shiftMonth(1)}
              aria-label="Следующий месяц"
            >
              <Icon name="ChevronRight" size={16} />
            </Button>
          </div>
        </div>

        {/* Итоги месяца прямо в шапке: цифры, ради которых раньше приходилось
            перебирать дни по одному. */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'рабочих дней', value: workedDays },
            { label: 'в среднем в день', value: avgPerDay },
            { label: 'опозданий', value: totalLate },
          ].map((s) => (
            <div key={s.label} className="rounded-md bg-muted/50 px-2 py-1.5">
              <p className="text-base font-bold leading-none tabular-nums">{s.value}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <div className="mb-1 grid grid-cols-7 gap-1">
            {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => (
              <span key={d} className="text-center text-[10px] uppercase text-muted-foreground">
                {d}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const rec = byDate.get(key);
              const count = rec?.employees.length || 0;
              const outside = !isSameMonth(day, anchor);
              const selected = selectedDate && isSameDay(day, selectedDate);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectDate(day)}
                  className={`relative flex aspect-square min-h-[38px] flex-col items-center justify-center rounded-md border text-sm transition-colors ${
                    selected
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-transparent hover:border-border'
                  } ${outside ? 'opacity-30' : heat(count, maxPeople)} ${
                    isToday(day) && !selected ? 'border-primary/40' : ''
                  }`}
                  title={
                    count
                      ? `${format(day, 'd MMMM', { locale: ru })}: вышло ${count}`
                      : format(day, 'd MMMM', { locale: ru })
                  }
                >
                  <span
                    className={`leading-none ${
                      isToday(day) ? 'font-bold text-primary' : count ? 'font-medium' : ''
                    }`}
                  >
                    {format(day, 'd')}
                  </span>
                  {count > 0 && (
                    <span className="mt-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  )}
                  {/* Опоздания точкой в углу: это исключение, ему не нужна цифра,
                      нужен только повод открыть день. */}
                  {!!rec?.lateCount && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive" />
                  )}
                  {/* Кто-то ещё на смене — зелёная точка снизу. */}
                  {!!rec?.openCount && (
                    <span className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-primary/25" /> плотнее — больше людей
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> опоздание
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> смена открыта
            </span>
          </div>
        </div>

        {/* Разбор выбранного дня. Свернуть можно: когда смотрят на месяц целиком,
            список за один день только мешает. */}
        <div className="rounded-lg border">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {selectedDate ? format(selectedDate, 'd MMMM, EEEE', { locale: ru }) : 'Выберите день'}
              </span>
              <span className="block text-xs text-muted-foreground">
                {people.length
                  ? `вышло ${people.length}` +
                    (selectedRecord?.shifts?.length
                      ? ` · смены ${selectedRecord.shifts.join(', ')}`
                      : '') +
                    (selectedRecord?.totalHours ? ` · ${selectedRecord.totalHours} ч` : '')
                  : 'смен не было'}
              </span>
            </span>
            {!!selectedRecord?.lateCount && (
              <Badge variant="destructive" className="shrink-0 font-normal">
                опоздали {selectedRecord.lateCount}
              </Badge>
            )}
            <Icon
              name="ChevronDown"
              size={16}
              className={`shrink-0 text-muted-foreground transition-transform ${
                detailsOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {detailsOpen && people.length > 0 && (
            <div className="max-h-56 divide-y overflow-y-auto border-t">
              {people.map((p) => (
                <div key={p.userId} className="flex items-center gap-2 px-3 py-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      p.open ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    {(p.role || p.workshop) && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {roleLabels[p.role as Role] || p.role}
                        {p.workshop ? ` · ${p.workshop}` : ''}
                      </p>
                    )}
                  </div>
                  {p.late && (
                    <Icon
                      name="AlarmClock"
                      size={13}
                      className="shrink-0 text-destructive"
                      aria-label="Опоздание"
                    />
                  )}
                  {p.openedAt && (
                    <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {p.openedAt}
                      {p.closedAt ? `–${p.closedAt}` : ' →'}
                      {p.hours != null && (
                        <span className="ml-1 font-medium text-foreground">{p.hours} ч</span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ShiftCalendarCard;