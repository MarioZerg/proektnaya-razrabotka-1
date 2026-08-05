import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { fetchAvailableShifts, type EmployeeShiftStatus, type AvailableShift } from '@/lib/shiftSessionsApi';
import { formatTime } from '@/components/crm/dashboard/dashboardShared';

interface MyShiftCardProps {
  status: EmployeeShiftStatus | null;
  userId: number | undefined;
  loading: boolean;
  toggling: boolean;
  /** Штатный цех сотрудника из профиля пуст/неактивен или смена выключена — нужен выбор. */
  needsShiftChoice: boolean;
  onToggle: (choice?: { workshopId: number; shiftNumber: number; role?: string }) => void;
  /** Разрешённые администратором должности сотрудника — можно выбрать при открытии смены. */
  allowedRoles?: string[];
  /** Основная должность из профиля. */
  defaultRole?: string;
}

const roleLabels: Record<string, string> = {
  sewer: 'Швея',
  cutter: 'Закройщик',
  packer: 'Упаковщик',
  storekeeper: 'Кладовщик',
  cleaner: 'Уборщица',
  manager: 'Менеджер',
};

const MyShiftCard = ({
  status,
  userId,
  loading,
  toggling,
  needsShiftChoice,
  onToggle,
  allowedRoles = [],
  defaultRole,
}: MyShiftCardProps) => {
  const [availableShifts, setAvailableShifts] = useState<AvailableShift[]>([]);
  const [choice, setChoice] = useState('');
  const [roleChoice, setRoleChoice] = useState(defaultRole || '');

  useEffect(() => {
    if (needsShiftChoice && userId && !status?.isOpen) {
      fetchAvailableShifts(userId).then(setAvailableShifts);
    }
  }, [needsShiftChoice, userId, status?.isOpen]);

  const handleOpen = () => {
    if (needsShiftChoice && !status?.isOpen) {
      const selected = availableShifts.find((s) => `${s.workshopId}-${s.shiftNumber}` === choice);
      if (!selected) return;
      onToggle({
        workshopId: selected.workshopId,
        shiftNumber: selected.shiftNumber,
        role: roleChoice || undefined,
      });
      return;
    }
    onToggle();
  };

  const showChoicePicker = needsShiftChoice && !status?.isOpen && !loading;
  // Должность выбирается, только если админ разрешил сотруднику больше одной роли.
  const showRolePicker = showChoicePicker && allowedRoles.length > 1;

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Моя смена</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={status?.isOpen ? 'default' : 'secondary'}>
                {status?.isOpen ? 'Смена открыта' : 'Смена закрыта'}
              </Badge>
              {status?.isOpen && status.sessionShiftNumber && (
                <Badge variant="outline">Смена {status.sessionShiftNumber}</Badge>
              )}
              {status?.isOpen && status.sessionRole && (
                <Badge variant="outline">{roleLabels[status.sessionRole] || status.sessionRole}</Badge>
              )}
            </div>
            {status?.isOpen && status.openedAt && (
              <p className="text-sm text-muted-foreground">
                Открыта в {formatTime(status.openedAt)}
                {status.canCloseAt && (
                  <>
                    {' '}
                    · закрыть можно после {formatTime(status.canCloseAt)}
                  </>
                )}
              </p>
            )}

            {showChoicePicker && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Выберите цех и смену, в которой работаете сегодня
                </Label>
                <Select value={choice} onValueChange={setChoice}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите цех и смену" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableShifts.map((s) => (
                      <SelectItem key={`${s.workshopId}-${s.shiftNumber}`} value={`${s.workshopId}-${s.shiftNumber}`}>
                        {s.workshopName} — {s.shiftName}
                        {s.isHome ? ' (штатная)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showRolePicker && (
              <div className="space-y-1.5">
                <Label className="text-xs">Должность в этой смене</Label>
                <Select value={roleChoice} onValueChange={setRoleChoice}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите должность" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedRoles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabels[r] || r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              className="w-full"
              variant={status?.isOpen ? 'destructive' : 'default'}
              disabled={toggling || (showChoicePicker && !choice) || (showRolePicker && !roleChoice)}
              onClick={handleOpen}
            >
              {toggling ? (
                <Icon name="Loader2" size={16} className="animate-spin" />
              ) : status?.isOpen ? (
                'Закрыть смену'
              ) : (
                'Открыть смену'
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default MyShiftCard;