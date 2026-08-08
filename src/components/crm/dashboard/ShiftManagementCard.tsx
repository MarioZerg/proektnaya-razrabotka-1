import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const openCount = employees.filter((e) => e.isOpen).length;
  const visibleEmployees = employees.filter((e) => {
    if (onlyOpen && !e.isOpen) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      e.fullName.toLowerCase().includes(q) ||
      (roleLabels[e.role as Role] || e.role).toLowerCase().includes(q)
    );
  });

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
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Управление сменами</CardTitle>
          <Badge variant="secondary">На смене: {openCount}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Icon
              name="Search"
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени или должности"
              className="h-9 pl-8"
            />
          </div>
          <Button
            size="sm"
            variant={onlyOpen ? 'default' : 'outline'}
            onClick={() => setOnlyOpen((v) => !v)}
          >
            Только на смене
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : visibleEmployees.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {employees.length === 0 ? 'Сотрудников пока нет' : 'Никто не найден'}
          </p>
        ) : (
          <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {visibleEmployees.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    s.isOpen ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                  }`}
                />
                <div className="min-w-[160px] flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {s.fullName}
                    {/* Гость — сотрудник вышел в чужой цех. Видно сразу, кто где работает. */}
                    {s.isGuest && (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-400 bg-amber-50 px-1.5 py-0 text-[11px] font-normal text-amber-900"
                      >
                        гость
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {roleLabels[s.role as Role] || s.role}
                    {s.shiftNumber ? ` · смена ${s.shiftNumber}` : ''}
                    {s.shiftFree ? ' · свободный график' : ''}
                    {s.isOpen && s.openedAt ? ` · с ${formatTime(s.openedAt)}` : ''}
                    {s.isGuest && s.sessionWorkshopName
                      ? ` · в ${s.sessionWorkshopName} (свой — ${s.homeWorkshopName})`
                      : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    title="Переключить смену"
                    onClick={() => openSwitch(s)}
                  >
                    <Icon name="ArrowLeftRight" size={15} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    title={s.shiftFree ? 'Вернуть в штатную смену' : 'Перевести на свободный график'}
                    disabled={freeTogglingId === s.id}
                    onClick={() => handleToggleFree(s)}
                  >
                    <Icon
                      name={freeTogglingId === s.id ? 'Loader2' : s.shiftFree ? 'Lock' : 'LockOpen'}
                      size={15}
                      className={freeTogglingId === s.id ? 'animate-spin' : ''}
                    />
                  </Button>
                  <Button
                    size="sm"
                    variant={s.isOpen ? 'destructive' : 'default'}
                    className="h-8"
                    disabled={togglingId === s.id}
                    onClick={() => onToggle(s)}
                  >
                    {togglingId === s.id ? (
                      <Icon name="Loader2" size={14} className="animate-spin" />
                    ) : s.isOpen ? (
                      'Закрыть'
                    ) : (
                      'Открыть'
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
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