import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Icon from '@/components/ui/icon';
import { roleLabels } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import { formatDateTime, initials, roleOptions, workshopOptions } from '@/components/crm/users/usersShared';

interface EmployeesTableProps {
  loading: boolean;
  filtered: Employee[];
  roleFilter: string;
  setRoleFilter: (value: string) => void;
  workshopFilter: string;
  setWorkshopFilter: (value: string) => void;
  onOpenCard: (emp: Employee) => void;
  onDeleteRequest: (id: number) => void;
}

const EmployeesTable = ({
  loading,
  filtered,
  roleFilter,
  setRoleFilter,
  workshopFilter,
  setWorkshopFilter,
  onOpenCard,
  onDeleteRequest,
}: EmployeesTableProps) => {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все роли</SelectItem>
            {roleOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabels[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все цеха</SelectItem>
            {workshopOptions.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Сотрудников пока нет.</p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">#</TableHead>
                <TableHead className="text-primary-foreground">Аватар</TableHead>
                <TableHead className="text-primary-foreground">Имя</TableHead>
                <TableHead className="text-primary-foreground">Роль</TableHead>
                <TableHead className="text-primary-foreground">Цех</TableHead>
                <TableHead className="text-primary-foreground">Email / Телефон</TableHead>
                <TableHead className="text-primary-foreground">Создан</TableHead>
                <TableHead className="text-primary-foreground">Обновлен</TableHead>
                <TableHead className="text-primary-foreground">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((emp) => (
                <TableRow key={emp.id} className="cursor-pointer" onClick={() => onOpenCard(emp)}>
                  <TableCell>{emp.id}</TableCell>
                  <TableCell>
                    <Avatar className="h-9 w-9">
                      {emp.avatarUrl && <AvatarImage src={emp.avatarUrl} />}
                      <AvatarFallback className="text-xs">{initials(emp.fullName)}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">
                    <div>{emp.fullName}</div>
                    <div className="text-xs text-muted-foreground">
                      Логин: <span className="font-mono-tech">{emp.login}</span>
                    </div>
                  </TableCell>
                  <TableCell>{roleLabels[emp.role]}</TableCell>
                  <TableCell>{emp.workshop || '—'}</TableCell>
                  <TableCell>
                    <div>{emp.email}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(emp.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(emp.updatedAt)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <Button size="icon" variant="secondary" onClick={() => onOpenCard(emp)}>
                        <Icon name="Pencil" size={14} />
                      </Button>
                      <Button size="icon" variant="destructive" onClick={() => onDeleteRequest(emp.id)}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
};

export default EmployeesTable;
