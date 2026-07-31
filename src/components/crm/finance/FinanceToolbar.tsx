import { Button } from '@/components/ui/button';
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
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';

interface FinanceToolbarProps {
  employees: Employee[];
  userFilter: string;
  setUserFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
}

const FinanceToolbar = ({
  employees,
  userFilter,
  setUserFilter,
  typeFilter,
  setTypeFilter,
}: FinanceToolbarProps) => {
  const handleReset = () => {
    setUserFilter('all');
    setTypeFilter('all');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-blue-600 text-white hover:bg-blue-700">
              Добавить операцию
              <Icon name="ChevronDown" size={16} className="ml-1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>зарплата</DropdownMenuItem>
            <DropdownMenuItem>бонусы</DropdownMenuItem>
            <DropdownMenuItem>операция компании</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button className="bg-blue-600 text-white hover:bg-blue-700">Выплатить зарплату</Button>
        <Button className="bg-blue-600 text-white hover:bg-blue-700">Выплатить бонусы</Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="salary">Операции сотрудников</SelectItem>
            <SelectItem value="company">Операция компании</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline">Фильтр</Button>
        <Button variant="ghost" onClick={handleReset}>
          Сбросить
        </Button>
      </div>
    </div>
  );
};

export default FinanceToolbar;