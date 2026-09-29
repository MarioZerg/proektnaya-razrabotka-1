import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchShifts,
  fetchShiftDaysOff,
  setShiftDayOff,
  type ShiftListItem,
  type ShiftCycle,
} from '@/lib/shiftsApi';
import ShiftCycleSetup from '@/components/crm/shifts/ShiftCycleSetup';
import { fetchVacations, type Vacation } from '@/lib/vacationsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { cn } from '@/lib/utils';

const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const buildMonthGrid = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Date[] = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push(new Date(year, month, i - startOffset + 1));
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  // Хвост недели заполняем днями СЛЕДУЮЩЕГО месяца (1, 2, 3...), а не текущего —
  // иначе последние числа месяца дублировались бы в последней строке.
  let nextMonthDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push(new Date(year, month + 1, nextMonthDay));
    nextMonthDay += 1;
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
};

const monthNames = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const monthGenitive = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const weekdayLong = [
  'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота',
];

const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const ShiftsCalendar = () => {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<ShiftListItem[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [daysOff, setDaysOff] = useState<Set<string>>(new Set());
  const [savingDate, setSavingDate] = useState<string | null>(null);
  // Цикличный график смены (2/2 и т.п.): если задан, выходные считает система, а клики
  // по дням в календаре отключаются — иначе ручные отметки конфликтовали бы с расчётом.
  const [cycle, setCycle] = useState<ShiftCycle | null>(null);
  const [workWeekdays, setWorkWeekdays] = useState<number[] | null>(null);
  // Отпуска сотрудников: в календаре сразу видно, кто и когда отдыхает, чтобы при
  // планировании не оставить смену без людей.
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [selectedIso, setSelectedIso] = useState(() => toIsoDate(new Date()));

  useEffect(() => {
    fetchVacations()
      .then((list) => setVacations(list.filter((v) => !v.cancelled)))
      // FRONTEND-ONLY: отпуска на календаре. Сбой не обнуляет уже показанных.
      .catch(() => undefined);
  }, []);

  const today = new Date();
  const todayIso = toIsoDate(today);
  const [monthOffset, setMonthOffset] = useState(0);
  const baseYear = today.getFullYear();
  const baseMonth = today.getMonth();
  const viewDate = useMemo(
    () => new Date(baseYear, baseMonth + monthOffset, 1),
    [baseYear, baseMonth, monthOffset],
  );
  const weeks = useMemo(() => buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()), [viewDate]);

  const load = () => {
    setLoading(true);
    fetchShifts()
      .then((data) => {
        setListError(null);
        setShifts(data);
        if (data.length > 0) setShiftId(String(data[0].id));
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить смены');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const selectedShift = shifts.find((s) => String(s.id) === shiftId);

  const loadDaysOff = () => {
    if (!selectedShift) return;
    const month = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
    fetchShiftDaysOff(selectedShift.workshopId, selectedShift.shiftNumber, month).then((data) => {
      setDaysOff(new Set(data.daysOff));
      setCycle(data.cycle);
      setWorkWeekdays(data.workWeekdays);
    });
  };

  useEffect(() => {
    loadDaysOff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShift?.id, viewDate.getFullYear(), viewDate.getMonth()]);

  useEffect(() => {
    const selected = parseIso(selectedIso);
    if (
      selected.getMonth() !== viewDate.getMonth() ||
      selected.getFullYear() !== viewDate.getFullYear()
    ) {
      setSelectedIso(monthOffset === 0 ? todayIso : toIsoDate(viewDate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate.getFullYear(), viewDate.getMonth()]);

  const vacationsOn = (iso: string) =>
    selectedShift
      ? vacations.filter(
          (v) =>
            v.shiftNumber === selectedShift.shiftNumber &&
            (v.workshopName === selectedShift.workshopName || v.workshopName === null) &&
            iso >= v.startsOn.slice(0, 10) &&
            iso <= v.endsOn.slice(0, 10),
        )
      : [];

  const toggleDayOff = async (date: Date, isCurrentMonth: boolean) => {
    if (!selectedShift || !isCurrentMonth) return;
    if (cycle || workWeekdays) {
      toast({
        title: 'Выходные считаются автоматически',
        description: 'У смены включён график — измените его выше или выключите',
      });
      return;
    }
    const iso = toIsoDate(date);
    const isDayOff = daysOff.has(iso);
    setSavingDate(iso);
    try {
      await setShiftDayOff(selectedShift.workshopId, selectedShift.shiftNumber, iso, !isDayOff);
      setDaysOff((prev) => {
        const next = new Set(prev);
        if (isDayOff) next.delete(iso);
        else next.add(iso);
        return next;
      });
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingDate(null);
    }
  };

  const selectedDate = parseIso(selectedIso);
  const selectedIsCurrentMonth = selectedDate.getMonth() === viewDate.getMonth()
    && selectedDate.getFullYear() === viewDate.getFullYear();
  const selectedDayOff = daysOff.has(selectedIso);
  const selectedVacations = vacationsOn(selectedIso);
  const autoSchedule = Boolean(cycle || workWeekdays);

  const scheduleSummary = workWeekdays
    ? `По дням: ${workWeekdays.map((n) => weekDays[n - 1]).join(', ')}`
    : cycle
      ? `Цикл ${cycle.workDays}/${cycle.offDays}`
      : 'Выходные вручную';

  return (
    <CrmLayout>
      <div className="space-y-4 pb-4 sm:space-y-6">
        <div>
          <h1 className="text-xl font-bold">Календарь смен</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {autoSchedule
              ? 'Выходные считает график. Нажмите день — кто в отпуске.'
              : 'Нажмите день, чтобы посмотреть его. Выходной ставится кнопкой снизу.'}
          </p>
        </div>

        {shifts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shifts.map((s) => {
              const on = String(s.id) === shiftId;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setShiftId(String(s.id))}
                  className={cn(
                    'min-h-11 min-w-[30%] flex-1 rounded-md border px-2 py-1.5 text-center text-sm leading-tight',
                    on
                      ? 'border-emerald-600 bg-emerald-50 font-medium text-foreground'
                      : 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}

        {selectedShift && (
          <FormSection title="График смены" hint={scheduleSummary}>
            <ShiftCycleSetup
              workshopId={selectedShift.workshopId}
              shiftNumber={selectedShift.shiftNumber}
              shiftName={`${selectedShift.workshopName} — ${selectedShift.name}`}
              cycle={cycle}
              workWeekdays={workWeekdays}
              onSaved={loadDaysOff}
            />
          </FormSection>
        )}

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
            onClick={() => setMonthOffset((v) => v - 1)}
            aria-label="Предыдущий месяц"
          >
            <Icon name="ChevronLeft" size={18} />
          </Button>
          <p className="min-w-0 flex-1 text-center text-sm font-medium capitalize sm:text-base">
            {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
          </p>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
            onClick={() => setMonthOffset((v) => v + 1)}
            aria-label="Следующий месяц"
          >
            <Icon name="ChevronRight" size={18} />
          </Button>
          {monthOffset !== 0 && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 shrink-0 px-2 text-sm sm:h-9"
              onClick={() => setMonthOffset(0)}
            >
              Сегодня
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-destructive" />
            Выходной
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-amber-500" />
            Отпуск
          </span>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить смены"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && shifts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shifts.length === 0 ? (
          listError ? null : (
            <p className="text-sm text-muted-foreground">Сначала создайте смену на вкладке «Смены».</p>
          )
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-7 bg-primary">
              {weekDays.map((d) => (
                <div
                  key={d}
                  className="py-2 text-center text-xs font-medium text-primary-foreground sm:text-sm"
                >
                  {d}
                </div>
              ))}
            </div>
            <div>
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="grid grid-cols-7 border-t border-border">
                  {week.map((date, dIdx) => {
                    const isCurrentMonth = date.getMonth() === viewDate.getMonth();
                    const iso = toIsoDate(date);
                    const isDayOff = daysOff.has(iso);
                    const isSaving = savingDate === iso;
                    const isSelected = iso === selectedIso && isCurrentMonth;
                    const isToday = iso === todayIso;
                    const dayVacations = vacationsOn(iso);
                    return (
                      <button
                        key={dIdx}
                        type="button"
                        disabled={!isCurrentMonth}
                        onClick={() => setSelectedIso(iso)}
                        className={cn(
                          'relative flex min-h-12 flex-col items-center gap-0.5 border-r border-border p-1 last:border-r-0 sm:min-h-[4.5rem] sm:items-stretch sm:p-1.5',
                          !isCurrentMonth && 'bg-muted/30 text-muted-foreground/40',
                          isCurrentMonth && 'bg-background hover:bg-muted/60',
                          isDayOff && isCurrentMonth && 'bg-destructive/10 hover:bg-destructive/15',
                          isSelected && 'z-[1] ring-2 ring-inset ring-emerald-600',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold sm:h-7 sm:w-7',
                            isToday && isCurrentMonth && !isDayOff && 'bg-emerald-600 text-white',
                            isToday && isCurrentMonth && isDayOff && 'bg-destructive text-white',
                            isDayOff && isCurrentMonth && !isToday && 'text-destructive',
                          )}
                        >
                          {date.getDate()}
                        </span>
                        {isSaving && (
                          <Icon name="Loader2" size={12} className="animate-spin text-muted-foreground" />
                        )}
                        {dayVacations.length > 0 && (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 sm:hidden" />
                            <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                              {dayVacations.slice(0, 2).map((v) => (
                                <span
                                  key={v.id}
                                  className="truncate rounded bg-amber-500 px-1 text-[10px] leading-4 text-white"
                                  title={`${v.userName} — отпуск`}
                                >
                                  {v.userName.split(' ')[0]}
                                </span>
                              ))}
                              {dayVacations.length > 2 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{dayVacations.length - 2}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedShift && selectedIsCurrentMonth && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div>
              <p className="font-medium">
                {`${selectedDate.getDate()} ${monthGenitive[selectedDate.getMonth()]}, ${weekdayLong[selectedDate.getDay()]}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {selectedDayOff ? 'Выходной смены' : 'Рабочий день'}
                {selectedVacations.length > 0
                  ? ` · в отпуске ${selectedVacations.length}`
                  : ''}
              </p>
            </div>
            {selectedVacations.length > 0 && (
              <ul className="space-y-1.5">
                {selectedVacations.map((v) => (
                  <li
                    key={v.id}
                    className="rounded-md bg-amber-500/15 px-2.5 py-2 text-sm"
                  >
                    {v.userName}
                  </li>
                ))}
              </ul>
            )}
            {!autoSchedule && (
              <Button
                type="button"
                variant={selectedDayOff ? 'outline' : 'default'}
                className="h-11 w-full sm:h-10 sm:w-auto"
                disabled={savingDate === selectedIso}
                onClick={() => toggleDayOff(selectedDate, true)}
              >
                {savingDate === selectedIso ? (
                  <Icon name="Loader2" size={16} className="animate-spin" />
                ) : selectedDayOff ? (
                  'Сделать рабочим'
                ) : (
                  'Отметить выходным'
                )}
              </Button>
            )}
            {autoSchedule && (
              <p className="text-sm text-muted-foreground">
                Этот день считает график смены. Чтобы править вручную — выключите график выше.
              </p>
            )}
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default ShiftsCalendar;
