import { useMemo, useState } from 'react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { roleLabels, isStorekeeperRole, type Role } from '@/lib/roles';
import type { EmployeeShiftStatus } from '@/lib/shiftSessionsApi';
import type { ShiftListItem } from '@/lib/shiftsApi';
import { formatTime } from '@/components/crm/dashboard/dashboardShared';
import StorekeeperTaskChecklistDialog from '@/components/crm/dashboard/StorekeeperTaskChecklistDialog';

interface ShiftManagementCardProps {
  employees: EmployeeShiftStatus[];
  shifts: ShiftListItem[];
  loading: boolean;
  togglingId: number | null;
  onToggle: (employee: EmployeeShiftStatus) => void;
  onSwitchShift: (employeeId: number, shiftId: number) => Promise<void>;
  onToggleFree: (employeeId: number, shiftFree: boolean) => Promise<void>;
}

type Filter = 'open' | 'closed' | 'all';

/**
 * Управление сменами: кто сейчас работает и кому открыть/закрыть смену.
 *
 * Карточка намеренно КОРОТКАЯ. Раньше она печатала весь штат подряд — сотня
 * строк в две строки текста каждая, по четыре кнопки в ряд, — и виджет уезжал
 * далеко за экран. При этом девяносто процентов времени админу нужны только
 * те, кто на смене прямо сейчас: остальных он трогает раз в месяц.
 *
 * Поэтому по умолчанию показаны работающие, редкие действия (переключить смену,
 * свободный график, чек-лист) убраны под меню строки, а сама строка — одна
 * строчка текста. Полный список открывается фильтром «Все».
 */
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
  const [filter, setFilter] = useState<Filter>('open');
  // Кладовщик, чей чек-лист сейчас смотрит администратор.
  const [checklistTarget, setChecklistTarget] = useState<EmployeeShiftStatus | null>(null);

  const openCount = employees.filter((e) => e.isOpen).length;
  const guestCount = employees.filter((e) => e.isOpen && e.isGuest).length;

  const visibleEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      // Поиск важнее фильтра: если админ ищет человека по имени, он хочет найти
      // его независимо от того, на смене тот или нет.
      if (q) {
        return (
          e.fullName.toLowerCase().includes(q) ||
          (roleLabels[e.role as Role] || e.role).toLowerCase().includes(q)
        );
      }
      if (filter === 'open') return e.isOpen;
      if (filter === 'closed') return !e.isOpen;
      return true;
    });
  }, [employees, search, filter]);

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

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: 'open', label: 'На смене', count: openCount },
    { key: 'closed', label: 'Не вышли', count: employees.length - openCount },
    { key: 'all', label: 'Все', count: employees.length },
  ];

  return (
    <Card className="border-border shadow-none lg:col-span-3">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Управление сменами</CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {openCount}
            </Badge>
            {guestCount > 0 && (
              <Badge
                variant="outline"
                className="border-amber-400 bg-amber-50 font-normal text-amber-900"
              >
                гостей {guestCount}
              </Badge>
            )}
          </div>
        </div>

        {/* Фильтр вместо бесконечной прокрутки: экран показывает одну группу. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md bg-muted p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === f.key && !search
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
                <span className="ml-1 tabular-nums opacity-60">{f.count}</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-[140px] flex-1">
            <Icon
              name="Search"
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти сотрудника"
              className="h-8 pl-8 text-sm"
            />
          </div>
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
            {employees.length === 0
              ? 'Сотрудников пока нет'
              : search
                ? 'Никто не найден'
                : filter === 'open'
                  ? 'Сейчас никто не на смене'
                  : 'Все на смене'}
          </p>
        ) : (
          <div className="max-h-[340px] divide-y divide-border overflow-y-auto">
            {visibleEmployees.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    s.isOpen ? 'bg-emerald-500' : 'bg-muted-foreground/25'
                  }`}
                  title={s.isOpen ? 'На смене' : 'Смена закрыта'}
                />

                <div className="min-w-0 flex-1">
                  {/* Имя и подпись — в одну строку на широком экране, в две на
                      телефоне: подпись служебная и переносить ради неё имя нельзя. */}
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <p className="truncate text-sm font-medium">{s.fullName}</p>
                    {s.isGuest && (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-400 bg-amber-50 px-1 py-0 text-[10px] font-normal text-amber-900"
                      >
                        гость
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {roleLabels[s.role as Role] || s.role}
                    {s.shiftNumber ? ` · см. ${s.shiftNumber}` : ''}
                    {s.shiftFree ? ' · свободный' : ''}
                    {s.isOpen && s.openedAt ? ` · с ${formatTime(s.openedAt)}` : ''}
                    {s.isGuest && s.sessionWorkshopName ? ` · в ${s.sessionWorkshopName}` : ''}
                  </p>
                </div>

                {/* Главное действие остаётся кнопкой, редкое — уходит в меню:
                    четыре иконки в ряд не помещались на телефоне и заставляли
                    строку разъезжаться на два этажа. */}
                <Button
                  size="sm"
                  variant={s.isOpen ? 'outline' : 'default'}
                  className="h-7 shrink-0 px-2.5 text-xs"
                  disabled={togglingId === s.id}
                  onClick={() => onToggle(s)}
                >
                  {togglingId === s.id ? (
                    <Icon name="Loader2" size={13} className="animate-spin" />
                  ) : s.isOpen ? (
                    'Закрыть'
                  ) : (
                    'Открыть'
                  )}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 p-0"
                      aria-label="Ещё действия"
                    >
                      <Icon name="EllipsisVertical" size={15} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {isStorekeeperRole(s.role as Role) && s.isOpen && (
                      <DropdownMenuItem onClick={() => setChecklistTarget(s)}>
                        <Icon name="ClipboardList" size={15} className="mr-2" />
                        Задания смены
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => openSwitch(s)}>
                      <Icon name="ArrowLeftRight" size={15} className="mr-2" />
                      Переключить смену
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={freeTogglingId === s.id}
                      onClick={() => handleToggleFree(s)}
                    >
                      <Icon
                        name={freeTogglingId === s.id ? 'Loader2' : s.shiftFree ? 'Lock' : 'LockOpen'}
                        size={15}
                        className={`mr-2 ${freeTogglingId === s.id ? 'animate-spin' : ''}`}
                      />
                      {s.shiftFree ? 'Вернуть в штатную смену' : 'Свободный график'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
              {switchTarget?.isOpen && (
                <>
                  {' '}Открытая сейчас смена сразу переедет в новый цех — заказы и материал
                  этого цеха станут доступны немедленно, время прихода сохранится.
                </>
              )}
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

      <StorekeeperTaskChecklistDialog
        employee={checklistTarget}
        onClose={() => setChecklistTarget(null)}
      />
    </Card>
  );
};

export default ShiftManagementCard;
