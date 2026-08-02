import { useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import type { EmployeeShiftStatus } from '@/lib/shiftSessionsApi';
import type { ShiftListItem } from '@/lib/shiftsApi';
import { formatTime } from '@/components/crm/dashboard/dashboardShared';

interface ShiftManagementCardProps {
  employees: EmployeeShiftStatus[];
  shifts: ShiftListItem[];
  loading: boolean;
  togglingId: number | null;
  onToggle: (employee: EmployeeShiftStatus) => void;
  onSwitchShift: (employeeId: number, shiftId: number) => Promise<void>;
  onToggleFree: (employeeId: number, shiftFree: boolean) => Promise<void>;
}

// Карточка администратора: список всех сотрудников со статусом смены + два инструмента
// управления привязкой — "Переключить" (постоянно меняет штатную смену сотрудника) и
// переключатель "Свободный график" (гостевой режим — сотрудник сам выбирает смену при входе).
const ShiftManagementCard = ({
  employees,
  shifts,
  loading,
  togglingId,
  onToggle,
  onSwitchShift,
  onToggleFree,
}: ShiftManagementCardProps) => {
  const [switchTarget, setSwitchTarget] = useState<EmployeeShiftStatus | null>(null);
  const [switchShiftId, setSwitchShiftId] = useState('');
  const [switching, setSwitching] = useState(false);
  const [freeTogglingId, setFreeTogglingId] = useState<number | null>(null);

  const openSwitch = (employee: EmployeeShiftStatus) => {
    setSwitchTarget(employee);
    setSwitchShiftId('');
  };

  const handleSwitch = async () => {
    if (!switchTarget || !switchShiftId) return;
    setSwitching(true);
    try {
      await onSwitchShift(switchTarget.id, Number(switchShiftId));
      setSwitchTarget(null);
    } finally {
      setSwitching(false);
    }
  };

  const handleToggleFree = async (employee: EmployeeShiftStatus) => {
    setFreeTogglingId(employee.id);
    try {
      await onToggleFree(employee.id, !employee.shiftFree);
    } finally {
      setFreeTogglingId(null);
    }
  };

  return (
    <Card className="border-border shadow-none lg:col-span-3">
      <CardHeader>
        <CardTitle className="text-base">Управление сменами</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : employees.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Сотрудников пока нет</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Смена</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-medium">{s.fullName}</p>
                    <p className="text-xs text-muted-foreground">{roleLabels[s.role as Role] || s.role}</p>
                    {s.isOpen && s.openedAt && (
                      <p className="text-xs text-muted-foreground">
                        Открыл в {formatTime(s.openedAt)}
                        {s.canCloseAt && ` · закроет после ${formatTime(s.canCloseAt)}`}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.shiftNumber ? (
                        <Badge variant="secondary">Смена {s.shiftNumber}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {s.shiftFree && (
                        <Badge variant="outline" className="text-xs">
                          Свободный график
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openSwitch(s)}>
                        Переключить
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={freeTogglingId === s.id}
                        onClick={() => handleToggleFree(s)}
                      >
                        {freeTogglingId === s.id ? (
                          <Icon name="Loader2" size={14} className="animate-spin" />
                        ) : s.shiftFree ? (
                          'Вернуть в смену'
                        ) : (
                          'Выключить смену'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant={s.isOpen ? 'destructive' : 'default'}
                        disabled={togglingId === s.id}
                        onClick={() => onToggle(s)}
                      >
                        {togglingId === s.id ? (
                          <Icon name="Loader2" size={14} className="animate-spin" />
                        ) : s.isOpen ? (
                          'Закрыть смену'
                        ) : (
                          'Открыть смену'
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!switchTarget} onOpenChange={(open) => !open && setSwitchTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Переключить смену — {switchTarget?.fullName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Сотрудник будет постоянно числиться в выбранной смене, пока вы не переключите его снова.
            </p>
            <div className="space-y-1.5">
              <Label>Новая смена</Label>
              <Select value={switchShiftId} onValueChange={setSwitchShiftId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите смену" />
                </SelectTrigger>
                <SelectContent>
                  {shifts.map((sh) => (
                    <SelectItem key={sh.id} value={String(sh.id)}>
                      {sh.workshopName} — {sh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSwitch} disabled={switching || !switchShiftId} className="w-full">
              {switching ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Переключить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ShiftManagementCard;
