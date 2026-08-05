import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

const formatDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;

const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ShiftsCalendar = () => {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<ShiftListItem[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [loading, setLoading] = useState(true);
  const [daysOff, setDaysOff] = useState<Set<string>>(new Set());
  const [savingDate, setSavingDate] = useState<string | null>(null);
  // Цикличный график смены (2/2 и т.п.): если задан, выходные считает система, а клики
  // по дням в календаре отключаются — иначе ручные отметки конфликтовали бы с расчётом.
  const [cycle, setCycle] = useState<ShiftCycle | null>(null);

  const today = new Date();
  const [monthOffset, setMonthOffset] = useState(0);
  const viewDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const weeks = useMemo(() => buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()), [viewDate]);

  useEffect(() => {
    fetchShifts()
      .then((data) => {
        setShifts(data);
        if (data.length > 0) setShiftId(String(data[0].id));
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedShift = shifts.find((s) => String(s.id) === shiftId);

  const loadDaysOff = () => {
    if (!selectedShift) return;
    const month = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
    fetchShiftDaysOff(selectedShift.workshopId, selectedShift.shiftNumber, month).then((data) => {
      setDaysOff(new Set(data.daysOff));
      setCycle(data.cycle);
    });
  };

  useEffect(() => {
    loadDaysOff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShift?.id, viewDate.getFullYear(), viewDate.getMonth()]);

  const toggleDayOff = async (date: Date, isCurrentMonth: boolean) => {
    if (!selectedShift || !isCurrentMonth) return;
    if (cycle) {
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

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Календарь смен</h1>
        <p className="text-sm text-muted-foreground">
          {cycle
            ? 'У смены включён автоматический график — выходные рассчитаны системой и отмечены в календаре.'
            : 'Кликните по дню, чтобы отметить его выходным для выбранной смены — в этот день сотрудники смены не смогут открыть смену.'}
        </p>


        {selectedShift && (
          <ShiftCycleSetup
            workshopId={selectedShift.workshopId}
            shiftNumber={selectedShift.shiftNumber}
            shiftName={`${selectedShift.workshopName} — ${selectedShift.name}`}
            cycle={cycle}
            onSaved={loadDaysOff}
          />
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Смена:</Label>
            <Select value={shiftId} onValueChange={setShiftId} disabled={loading}>
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shifts.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.workshopName} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-border p-1.5 hover:bg-muted"
              onClick={() => setMonthOffset((v) => v - 1)}
            >
              <Icon name="ChevronLeft" size={16} />
            </button>
            <p className="min-w-[140px] text-center text-sm font-medium capitalize">
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </p>
            <button
              className="rounded-md border border-border p-1.5 hover:bg-muted"
              onClick={() => setMonthOffset((v) => v + 1)}
            >
              <Icon name="ChevronRight" size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Сначала создайте смену на вкладке «Смены».</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  {weekDays.map((d) => (
                    <TableHead key={d} className="text-center text-primary-foreground">
                      {d}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((week, wIdx) => (
                  <TableRow key={wIdx}>
                    {week.map((date, dIdx) => {
                      const isCurrentMonth = date.getMonth() === viewDate.getMonth();
                      const iso = toIsoDate(date);
                      const isDayOff = daysOff.has(iso);
                      const isSaving = savingDate === iso;
                      return (
                        <TableCell
                          key={dIdx}
                          onClick={() => toggleDayOff(date, isCurrentMonth)}
                          className={`min-w-[110px] align-top ${
                            isCurrentMonth ? 'cursor-pointer bg-muted/40 hover:bg-muted' : 'text-muted-foreground'
                          } ${isDayOff && isCurrentMonth ? 'bg-destructive/10' : ''}`}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold">
                            {formatDate(date)}
                            {isSaving && <Icon name="Loader2" size={11} className="animate-spin" />}
                          </div>
                          {isDayOff && isCurrentMonth && (
                            <div className="mt-1 rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground">
                              Выходной
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default ShiftsCalendar;