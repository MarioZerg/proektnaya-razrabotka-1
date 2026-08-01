import { useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import {
  dashboardWidgets,
  employeeShifts as initialShifts,
  shiftCalendar,
} from '@/lib/dashboardData';

const toneStyles: Record<string, string> = {
  default: 'text-foreground',
  warning: 'text-amber-600',
  urgent: 'text-destructive',
};

const CrmDashboard = () => {
  const { user } = useAuth();
  const [shifts, setShifts] = useState(initialShifts);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  const toggleShift = (id: string) => {
    setShifts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isOpen: !s.isOpen } : s))
    );
  };

  const selectedDayKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
  const selectedDayRecord = shiftCalendar.find((d) => d.date === selectedDayKey);
  const activeShiftDays = shiftCalendar.map((d) => new Date(d.date));

  const content = (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Главная</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обзор производства и складских процессов на сегодня
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {dashboardWidgets.map((w) => (
          <Card key={w.label} className="border-border shadow-none">
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <span
                  className={`grid h-8 w-8 place-items-center rounded-md bg-muted ${toneStyles[w.tone]}`}
                >
                  <Icon name={w.icon} size={16} />
                </span>
                {w.tone !== 'default' && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      w.tone === 'urgent' ? 'bg-destructive' : 'bg-amber-500'
                    }`}
                  />
                )}
              </div>
              <p className="text-2xl font-bold leading-none">{w.value}</p>
              <p className="text-xs leading-snug text-muted-foreground">{w.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="border-border shadow-none lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Управление сменами</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Смена</TableHead>
                  <TableHead className="text-right">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <p className="font-medium">{s.fio}</p>
                      <p className="text-xs text-muted-foreground">{s.role}</p>
                    </TableCell>
                    <TableCell>
                      {s.shiftNumber ? (
                        <Badge variant="secondary">Смена {s.shiftNumber}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={s.isOpen ? 'destructive' : 'default'}
                        onClick={() => toggleShift(s.id)}
                      >
                        {s.isOpen ? 'Закрыть смену' : 'Открыть смену'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Календарь смен</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              locale={ru}
              modifiers={{ hasShift: activeShiftDays }}
              modifiersClassNames={{ hasShift: 'font-bold underline' }}
              className="rounded-md border"
            />
            <div className="w-full rounded-md bg-muted p-3 text-sm">
              {selectedDayRecord ? (
                <>
                  <p className="font-medium">
                    Смена {selectedDayRecord.activeShift} —{' '}
                    {selectedDate && format(selectedDate, 'd MMMM', { locale: ru })}
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                    {selectedDayRecord.employees.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-muted-foreground">Нет данных о сменах на этот день</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  if (user && user.availableRoles.length === 0) {
    return (
      <CrmLayout>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">Главная</h1>
          <p className="text-sm text-muted-foreground">
            Добро пожаловать, {user.name}. Ваша должность ещё не утверждена администратором —
            как только это произойдёт, вам откроется доступ к разделам системы.
          </p>
        </div>
      </CrmLayout>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <CrmLayout>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">Главная</h1>
          <p className="text-sm text-muted-foreground">
            Добро пожаловать, {user?.name}
          </p>
        </div>
      </CrmLayout>
    );
  }

  return <CrmLayout>{content}</CrmLayout>;
};

export default CrmDashboard;