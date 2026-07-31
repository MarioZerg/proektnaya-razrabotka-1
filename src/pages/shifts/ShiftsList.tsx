import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
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
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';

interface ShiftRow {
  id: string;
  name: string;
  workshopName: string;
  isActive: boolean;
  employeesCount: number;
}

const ShiftsList = () => {
  const navigate = useNavigate();
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchWorkshops(), fetchEmployees()])
      .then(([w, e]) => {
        setWorkshops(w);
        setEmployees(e);
      })
      .finally(() => setLoading(false));
  }, []);

  const shifts: ShiftRow[] = workshops.flatMap((w) =>
    Array.from({ length: w.shiftsCount }, (_, i) => {
      const number = i + 1;
      const employeesCount = employees.filter(
        (e) => e.workshop === w.name && e.shiftNumber === number
      ).length;
      return {
        id: `${w.id}-${number}`,
        name: `Смена № ${number}`,
        workshopName: w.name,
        isActive: w.isActive,
        employeesCount,
      };
    })
  );

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Смены</h1>
          <div className="flex gap-3">
            <Button className="bg-blue-600 text-white hover:bg-blue-700">
              <Icon name="Plus" size={16} className="mr-1.5" />
              Создать смену
            </Button>
            <Button variant="outline" onClick={() => navigate('/crm/shifts/calendar')}>
              <Icon name="Calendar" size={16} className="mr-1.5" />
              Календарь смен
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Смен пока нет.</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Название</TableHead>
                  <TableHead className="text-primary-foreground">Цех</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Сотрудники</TableHead>
                  <TableHead className="text-primary-foreground">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s, idx) => (
                  <TableRow key={s.id}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.workshopName}</TableCell>
                    <TableCell>
                      <Badge
                        variant={s.isActive ? 'secondary' : 'outline'}
                        className={s.isActive ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}
                      >
                        {s.isActive ? 'Активна' : 'Неактивна'}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.employeesCount}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="icon" className="bg-sky-500 text-white hover:bg-sky-600">
                          <Icon name="Eye" size={14} />
                        </Button>
                        <Button size="icon" variant="destructive">
                          <Icon name="Ban" size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default ShiftsList;
