import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import type { Employee } from '@/lib/usersApi';
import type { Workshop } from '@/lib/workshopsApi';
import type { EmployeeShiftStatus } from '@/lib/shiftSessionsApi';
import { statusOptions, employeeLabel } from '@/components/crm/sewingItems/sewingItemsShared';

interface AdminActionsCardProps {
  selectedOrder: Order;
  saving: boolean;
  cutting: boolean;
  isAlreadyCut: boolean;
  employees: Employee[];
  workshops: Workshop[];
  onStatusChange: (status: string) => void;
  onAssignUser: (userId: string) => void;
  onAssignWorkshop: (workshopId: string) => void;
  onCut: (rollId?: number, hangerNumber?: number) => void;
  assignedShift?: EmployeeShiftStatus;
  assignedNotOnShift: boolean;
  assignedOtherWorkshop: boolean;
}

/** Блок администратора: статус пошива, назначение сотрудника и цеха, ручной раскрой. */
const AdminActionsCard = ({
  selectedOrder,
  saving,
  cutting,
  isAlreadyCut,
  employees,
  workshops,
  onStatusChange,
  onAssignUser,
  onAssignWorkshop,
  onCut,
  assignedShift,
  assignedNotOnShift,
  assignedOtherWorkshop,
}: AdminActionsCardProps) => (
  <Card className="border-border shadow-none">
    <CardHeader className="pb-3">
      <CardTitle className="text-sm">Действия</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-wrap items-end gap-3">
      <div className="w-full space-y-1.5 sm:w-48">
        <Label>Статус пошива</Label>
        <Select value={selectedOrder.sewingStatus} onValueChange={onStatusChange} disabled={saving}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full space-y-1.5 sm:w-48">
        <Label>Сотрудник</Label>
        <Select
          value={selectedOrder.assignedUserId ? String(selectedOrder.assignedUserId) : 'none'}
          onValueChange={onAssignUser}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue placeholder="Не назначен" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Не назначен</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {/* ПОЛНЫХ ТЁЗОК В СПИСКЕ РАЗЛИЧАТЬ НЕЧЕМ.
                    В цехе работают два человека с почти одинаковым именем
                    («Беляева Наталия» и «Беляева Наталия Николаевна»), и админ
                    назначал заказ не на того: в списке они выглядели одинаково.
                    Заказ уходил на карточку, под которой человек не работает, —
                    у самой швеи он не появлялся. Показываем рядом смену, цех и
                    последние цифры телефона: этого хватает, чтобы не промахнуться. */}
                {employeeLabel(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Назначить мало — человек должен увидеть заказ у себя. Пока смена
            не открыта, конвейер у него пуст, и работа стоит. */}
        {assignedNotOnShift && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
            <span>
              Смена не открыта — сотрудник не увидит этот заказ у себя. Он появится
              у него, как только смена будет открыта.
            </span>
          </p>
        )}
        {assignedOtherWorkshop && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
            <span>
              Сотрудник на смене в другом цехе
              {assignedShift?.sessionWorkshopName
                ? ` (${assignedShift.sessionWorkshopName})`
                : ''}{' '}
              — заказ этого цеха он не увидит.
            </span>
          </p>
        )}
      </div>

      <div className="w-full space-y-1.5 sm:w-48">
        <Label>Цех</Label>
        <Select
          value={selectedOrder.workshopId ? String(selectedOrder.workshopId) : 'none'}
          onValueChange={onAssignWorkshop}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue placeholder="Не назначен" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Не назначен</SelectItem>
            {workshops.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={() => onCut()} disabled={cutting || isAlreadyCut}>
        {cutting ? (
          <>
            <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
            Списываем материалы...
          </>
        ) : (
          <>
            <Icon name="Scissors" size={16} className="mr-2" />
            Раскроить
          </>
        )}
      </Button>
    </CardContent>
  </Card>
);

export default AdminActionsCard;
