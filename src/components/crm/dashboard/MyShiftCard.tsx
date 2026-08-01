import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { EmployeeShiftStatus } from '@/lib/shiftSessionsApi';
import { formatTime } from '@/components/crm/dashboard/dashboardShared';

interface MyShiftCardProps {
  status: EmployeeShiftStatus | null;
  loading: boolean;
  toggling: boolean;
  onToggle: () => void;
}

const MyShiftCard = ({ status, loading, toggling, onToggle }: MyShiftCardProps) => {
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
              {status?.shiftNumber && <Badge variant="outline">Смена {status.shiftNumber}</Badge>}
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
            <Button
              className="w-full"
              variant={status?.isOpen ? 'destructive' : 'default'}
              disabled={toggling}
              onClick={onToggle}
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
