import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { Input } from '@/components/ui/input';

interface KioskPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminName: string;
}

/** Роли, которые реально работают за терминалом цеха. Администратор и менеджер в киоск не
 * ходят, но админу нужно видеть терминал их глазами — поэтому список именно рабочий. */
const KIOSK_ROLES: Role[] = ['sewer', 'cutter', 'packer', 'storekeeper', 'senior_storekeeper'];

/**
 * Вход администратора в терминал цеха для проверки: он выбирает цех и роль и попадает в киоск
 * так, как его видит сотрудник этой должности. Реальная смена при этом не открывается —
 * это режим просмотра, ничего в отчёты не пишется.
 */
const KioskPreviewDialog = ({ open, onOpenChange, adminName }: KioskPreviewDialogProps) => {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [workshopId, setWorkshopId] = useState('');
  const [role, setRole] = useState<Role>('sewer');
  // Режим: 'role' — смотреть обезличенно глазами должности, 'employee' — глазами конкретного
  // сотрудника, с его настоящими заказами, рулонами и сменой.
  const [mode, setMode] = useState<'role' | 'employee'>('role');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employeeId, setEmployeeId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchWorkshops()
      .then((list) => {
        setWorkshops(list);
        if (list.length > 0) setWorkshopId((prev) => prev || String(list[0].id));
      })
      .catch(() => setWorkshops([]));
    fetchEmployees()
      .then((list) => setEmployees(list.filter((e) => e.isActive)))
      .catch(() => setEmployees([]));
  }, [open]);

  // Показываем только тех, кто реально работает за терминалом — админов и менеджеров там нет.
  const kioskEmployees = employees.filter((e) => KIOSK_ROLES.includes(e.role));
  const foundEmployees = employeeQuery.trim()
    ? kioskEmployees.filter((e) =>
        e.fullName.toLowerCase().includes(employeeQuery.trim().toLowerCase()),
      )
    : kioskEmployees;
  const selectedEmployee = employees.find((e) => e.id === employeeId) || null;

  const handleOpen = () => {
    if (!workshopId) return;
    const params = new URLSearchParams({ preview: '1' });
    if (mode === 'employee' && selectedEmployee) {
      // Подставляем настоящего сотрудника: терминал покажет его заказы, рулоны и смену.
      params.set('role', selectedEmployee.role);
      params.set('name', selectedEmployee.fullName);
      params.set('userId', String(selectedEmployee.id));
    } else {
      params.set('role', role);
      params.set('name', adminName);
    }
    window.open(`/kiosk/${workshopId}?${params.toString()}`, '_blank');
    onOpenChange(false);
  };

  const canOpen = !!workshopId && (mode === 'role' || !!selectedEmployee);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Открыть терминал цеха для проверки</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Терминал откроется в новой вкладке так, как его видит выбранная должность. Смена не
            открывается, отчёты не меняются — это режим просмотра.
          </p>

          <div className="space-y-1.5">
            <Label>Цех</Label>
            <Select value={workshopId} onValueChange={setWorkshopId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите цех" />
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

          <div className="flex gap-2">
            <button
              onClick={() => setMode('role')}
              className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                mode === 'role'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              По должности
            </button>
            <button
              onClick={() => setMode('employee')}
              className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                mode === 'employee'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              По сотруднику
            </button>
          </div>

          {mode === 'role' ? (
            <div className="space-y-1.5">
              <Label>Смотреть глазами</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIOSK_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabels[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Найти сотрудника</Label>
              <Input
                placeholder="Фамилия или имя"
                value={employeeQuery}
                onChange={(e) => {
                  setEmployeeQuery(e.target.value);
                  setEmployeeId(null);
                }}
              />
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {foundEmployees.length === 0 ? (
                  <p className="p-2 text-sm text-muted-foreground">Сотрудники не найдены</p>
                ) : (
                  foundEmployees.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setEmployeeId(e.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                        employeeId === e.id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <span className="truncate font-medium">{e.fullName}</span>
                      <span className="shrink-0 text-xs opacity-80">
                        {roleLabels[e.role]}
                        {e.workshop ? ` · ${e.workshop}` : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <Button className="w-full" onClick={handleOpen} disabled={!canOpen}>
            <Icon name="MonitorPlay" size={16} className="mr-2" />
            Открыть терминал
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KioskPreviewDialog;
