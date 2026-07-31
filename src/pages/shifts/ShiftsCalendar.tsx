import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
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
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';

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
  while (cells.length % 7 !== 0) {
    cells.push(new Date(year, month, daysInMonth + (cells.length % 7) - startOffset + 1));
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

const ShiftsCalendar = () => {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [workshopId, setWorkshopId] = useState('');
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const weeks = buildMonthGrid(today.getFullYear(), today.getMonth());

  useEffect(() => {
    fetchWorkshops()
      .then((w) => {
        setWorkshops(w);
        if (w.length > 0) setWorkshopId(String(w[0].id));
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedWorkshop = workshops.find((w) => String(w.id) === workshopId);

  const shiftForDay = (date: Date) => {
    if (!selectedWorkshop || selectedWorkshop.shiftsCount === 0) return null;
    const dayIndex = Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
    const shiftNumber = (dayIndex % selectedWorkshop.shiftsCount) + 1;
    return `Смена № ${shiftNumber}`;
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Календарь смен</h1>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Цех:</Label>
            <Select value={workshopId} onValueChange={setWorkshopId} disabled={loading}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workshops.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-sm font-medium capitalize">
          {monthNames[today.getMonth()]} {today.getFullYear()}
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
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
                      const isCurrentMonth = date.getMonth() === today.getMonth();
                      const shift = isCurrentMonth ? shiftForDay(date) : null;
                      return (
                        <TableCell
                          key={dIdx}
                          className={`min-w-[110px] align-top ${
                            isCurrentMonth ? 'bg-muted/40' : 'text-muted-foreground'
                          }`}
                        >
                          <div className="text-xs font-semibold">{formatDate(date)}</div>
                          {shift && (
                            <div className="mt-1 rounded bg-background px-2 py-1 text-xs">
                              {shift}
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

        <div className="flex gap-3">
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700">Сохранить календарь</Button>
          <Button variant="outline">Назад к сменам</Button>
        </div>
      </div>
    </CrmLayout>
  );
};

export default ShiftsCalendar;
