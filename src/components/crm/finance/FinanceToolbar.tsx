import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  dateFrom: string;
  setDateFrom: (value: string) => void;
  dateTo: string;
  setDateTo: (value: string) => void;
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
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  savingAccrual,
  onManualAccrual,
  onPenalty,
  onPayout,
}: FinanceToolbarProps) => {
  const handleReset = () => {
    setUserFilter('all');
    setTypeFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  /** Быстрые периоды: за ними обращаются чаще всего, вручную даты набирать долго. */
  const setPeriod = (kind: 'month' | 'prevMonth' | 'first' | 'second') => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (kind === 'month') {
      setDateFrom(iso(new Date(y, m, 1)));
      setDateTo(iso(new Date(y, m + 1, 0)));
    } else if (kind === 'prevMonth') {
      setDateFrom(iso(new Date(y, m - 1, 1)));
      setDateTo(iso(new Date(y, m, 0)));
    } else if (kind === 'first') {
      setDateFrom(iso(new Date(y, m, 1)));
      setDateTo(iso(new Date(y, m, 15)));
    } else {
      setDateFrom(iso(new Date(y, m, 16)));
      setDateTo(iso(new Date(y, m + 1, 0)));
    }
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

        <div className="flex items-end gap-2">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Начислено с</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">по</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </div>

        <Button variant="ghost" onClick={handleReset}>
          <Icon name="X" size={14} className="mr-1" />
          Сбросить
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setPeriod('month')}>
          Текущий месяц
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPeriod('prevMonth')}>
          Прошлый месяц
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPeriod('first')}>
          1–15 число
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPeriod('second')}>
          16–конец месяца
        </Button>
      </div>
    </div>
  );
};

export default FinanceToolbar;
