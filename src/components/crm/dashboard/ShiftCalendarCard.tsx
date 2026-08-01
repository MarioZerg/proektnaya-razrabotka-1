import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import type { ShiftCalendarDay } from '@/lib/shiftSessionsApi';

interface ShiftCalendarCardProps {
  selectedDate: Date | undefined;
  onSelectDate: (date: Date | undefined) => void;
  days: ShiftCalendarDay[];
}

const ShiftCalendarCard = ({ selectedDate, onSelectDate, days }: ShiftCalendarCardProps) => {
  const selectedDayKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
  const selectedDayRecord = days.find((d) => d.date === selectedDayKey);
  const activeShiftDays = days.map((d) => new Date(d.date));

  return (
    <Card className="border-border shadow-none lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Календарь смен</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={onSelectDate}
          locale={ru}
          modifiers={{ hasShift: activeShiftDays }}
          modifiersClassNames={{ hasShift: 'font-bold underline' }}
          className="rounded-md border"
        />
        <div className="w-full rounded-md bg-muted p-3 text-sm">
          {selectedDayRecord ? (
            <>
              <p className="font-medium">
                {selectedDayRecord.activeShift ? `Смена ${selectedDayRecord.activeShift} — ` : ''}
                {selectedDate && format(selectedDate, 'd MMMM', { locale: ru })}
              </p>
              <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                {selectedDayRecord.employees.map((e, idx) => (
                  <li key={`${e}-${idx}`}>{e}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">Нет данных о сменах на этот день</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ShiftCalendarCard;
