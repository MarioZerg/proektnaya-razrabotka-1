import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';
import ManualAccrualDialog from '@/components/crm/finance/ManualAccrualDialog';
import PayoutDialog from '@/components/crm/finance/PayoutDialog';

interface FinanceToolbarProps {
  employees: Employee[];
  userFilter: string;
  setUserFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  savingAccrual: boolean;
  onManualAccrual: (userId: number, amount: number, description: string) => Promise<void>;
  onPenalty: (userId: number, amount: number, description: string) => Promise<void>;
  onPayout: (userId: number) => Promise<void>;
}

const FinanceToolbar = ({
  employees,
  userFilter,
  setUserFilter,
  typeFilter,
  setTypeFilter,
  savingAccrual,
  onManualAccrual,
  onPenalty,
  onPayout,
}: FinanceToolbarProps) => {
  const handleReset = () => {
    setUserFilter('all');
    setTypeFilter('all');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <ManualAccrualDialog employees={employees} mode="accrual" saving={savingAccrual} onSubmit={onManualAccrual} />
        <ManualAccrualDialog employees={employees} mode="penalty" saving={savingAccrual} onSubmit={onPenalty} />
        <PayoutDialog employees={employees} saving={savingAccrual} onSubmit={onPayout} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все сотрудники</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="cutter_cut">Раскрой</SelectItem>
            <SelectItem value="sewer_piece">Пошив</SelectItem>
            <SelectItem value="packer_stickering">Стикеровка</SelectItem>
            <SelectItem value="packer_repack">Перепаковка возврата</SelectItem>
            <SelectItem value="storekeeper_shift">Оклад кладовщика</SelectItem>
            <SelectItem value="cleaner_shift">Оклад уборщицы</SelectItem>
            <SelectItem value="admin_daily">Оклад администратора</SelectItem>
            <SelectItem value="manual">Ручное начисление</SelectItem>
            <SelectItem value="penalty">Штраф</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="ghost" onClick={handleReset}>
          <Icon name="X" size={14} className="mr-1" />
          Сбросить
        </Button>
      </div>
    </div>
  );
};

export default FinanceToolbar;
