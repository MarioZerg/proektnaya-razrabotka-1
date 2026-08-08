import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import { roleLabels, type Role } from '@/lib/roles';
import { fetchGuestShiftHistory, type GuestShiftSession } from '@/lib/shiftSessionsApi';

const PERIODS = [
  { days: 7, label: 'Неделя' },
  { days: 30, label: 'Месяц' },
  { days: 90, label: '3 месяца' },
];

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Сколько сотрудник отработал в чужом цехе. */
const formatDuration = (openedAt: string, closedAt: string | null) => {
  if (!closedAt) return 'ещё работает';
  const minutes = Math.round(
    (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60000
  );
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
};

/**
 * Отчёт по гостевым сменам: кто из сотрудников выходил работать в чужой цех.
 *
 * Нужен потому, что карточка смен на главной показывает только тех, кто работает прямо
 * сейчас. А разбираться, кто кого подменял на прошлой неделе, приходится задним числом —
 * при расчёте зарплаты и разборе, почему в цехе не сходится выработка.
 */
const GuestShifts = () => {
  const [sessions, setSessions] = useState<GuestShiftSession[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchGuestShiftHistory(days)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Гостевые смены</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Сотрудники, которые выходили работать в чужой цех
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.days}
              variant={days === p.days ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Должность</TableHead>
                <TableHead>Свой цех</TableHead>
                <TableHead>Работал в цехе</TableHead>
                <TableHead>Смена</TableHead>
                <TableHead>Начало</TableHead>
                <TableHead>Отработано</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Загрузка…
                  </TableCell>
                </TableRow>
              ) : sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    За выбранный период никто не выходил в чужой цех
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.fullName}</TableCell>
                    <TableCell>{roleLabels[s.role as Role] || s.role}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.homeWorkshopName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="border-amber-400 bg-amber-50 font-normal text-amber-900"
                      >
                        {s.workshopName}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.shiftNumber != null ? `№${s.shiftNumber}` : '—'}</TableCell>
                    <TableCell>{formatDateTime(s.openedAt)}</TableCell>
                    <TableCell>
                      {!s.closedAt ? (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Icon name="Circle" size={8} className="fill-current" />
                          ещё работает
                        </span>
                      ) : (
                        formatDuration(s.openedAt, s.closedAt)
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && sessions.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Всего гостевых смен за период: {sessions.length}
          </p>
        )}
      </div>
    </CrmLayout>
  );
};

export default GuestShifts;
