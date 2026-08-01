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
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import type { EmployeeShiftStatus } from '@/lib/shiftSessionsApi';
import { formatTime } from '@/components/crm/dashboard/dashboardShared';

interface ShiftManagementCardProps {
  employees: EmployeeShiftStatus[];
  loading: boolean;
  togglingId: number | null;
  onToggle: (employee: EmployeeShiftStatus) => void;
}

const ShiftManagementCard = ({ employees, loading, togglingId, onToggle }: ShiftManagementCardProps) => {
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
                <TableHead className="text-right">Действие</TableHead>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default ShiftManagementCard;
