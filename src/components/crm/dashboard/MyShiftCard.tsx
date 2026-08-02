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
  onToggle: (choice?: { workshopId: number; shiftNumber: number }) => void;
}

const MyShiftCard = ({ status, userId, loading, toggling, needsShiftChoice, onToggle }: MyShiftCardProps) => {
  const [availableShifts, setAvailableShifts] = useState<AvailableShift[]>([]);
  const [choice, setChoice] = useState('');

  useEffect(() => {
    if (needsShiftChoice && userId && !status?.isOpen) {
      fetchAvailableShifts(userId).then(setAvailableShifts);
    }
  }, [needsShiftChoice, userId, status?.isOpen]);

  const handleOpen = () => {
    if (needsShiftChoice && !status?.isOpen) {
      const selected = availableShifts.find((s) => `${s.workshopId}-${s.shiftNumber}` === choice);
      if (!selected) return;
      onToggle({ workshopId: selected.workshopId, shiftNumber: selected.shiftNumber });
      return;
    }
    onToggle();
  };

  const showChoicePicker = needsShiftChoice && !status?.isOpen && !loading;

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
                  {status?.shiftFree
                    ? 'Ваш свободный график — выберите цех/смену на сегодня'
                    : 'Ваша штатная смена сейчас выключена — выберите, где работать сегодня'}
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

            <Button
              className="w-full"
              variant={status?.isOpen ? 'destructive' : 'default'}
              disabled={toggling || (showChoicePicker && !choice)}
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
