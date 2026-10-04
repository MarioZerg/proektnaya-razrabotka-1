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
import type { PendingPayout } from '@/lib/salaryApi';
import { moscowYmd } from '@/lib/dateUtils';

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
  /** Списание без вины: спецодежда, выкуп товара, аванс. */
  onDeduction: (userId: number, amount: number, description: string) => Promise<void>;
  /** Кому есть что выплатить — только они попадают в выбор выплаты. */
  pendingPayouts: PendingPayout[];
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
  onDeduction,
  pendingPayouts,
  onPayout,
}: FinanceToolbarProps) => {
  const handleReset = () => {
    setUserFilter('all');
    setTypeFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  /** Быстрые периоды по календарю Москвы: toISOString() сдвигал день из‑за UTC. */
  const setPeriod = (kind: 'month' | 'prevMonth' | 'first' | 'second') => {
    const [ys, ms] = moscowYmd(0).split('-');
    const y = Number(ys);
    const m = Number(ms) - 1;
    const lastDay = (year: number, monthIndex: number) =>
      new Date(year, monthIndex + 1, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = (year: number, monthIndex: number, day: number) =>
      `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
    if (kind === 'month') {
      setDateFrom(ymd(y, m, 1));
      setDateTo(ymd(y, m, lastDay(y, m)));
    } else if (kind === 'prevMonth') {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      setDateFrom(ymd(py, pm, 1));
      setDateTo(ymd(py, pm, lastDay(py, pm)));
    } else if (kind === 'first') {
      setDateFrom(ymd(y, m, 1));
      setDateTo(ymd(y, m, 15));
    } else {
      setDateFrom(ymd(y, m, 16));
      setDateTo(ymd(y, m, lastDay(y, m)));
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*]:min-w-0">
        <ManualAccrualDialog employees={employees} mode="accrual" saving={savingAccrual} onSubmit={onManualAccrual} />
        <ManualAccrualDialog employees={employees} mode="deduction" saving={savingAccrual} onSubmit={onDeduction} />
        <ManualAccrualDialog employees={employees} mode="penalty" saving={savingAccrual} onSubmit={onPenalty} />
        <PayoutDialog pending={pendingPayouts} saving={savingAccrual} onSubmit={onPayout} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-11 w-full min-w-0 sm:h-10 sm:w-[220px] [&>span]:min-w-0 [&>span]:truncate">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          {/* Длинные ФИО не раздувают список шире триггера — обрезаем с многоточием. */}
          <SelectContent
            position="popper"
            className="w-[var(--radix-select-trigger-width)] min-w-0 max-w-[var(--radix-select-trigger-width)] overflow-hidden"
          >
            <SelectItem value="all" className="w-full min-w-0 overflow-hidden pr-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:truncate">
              Все сотрудники
            </SelectItem>
            {employees.map((e) => (
              <SelectItem
                key={e.id}
                value={String(e.id)}
                className="w-full min-w-0 overflow-hidden pr-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:truncate"
              >
                <span className="block min-w-0 truncate">{e.fullName}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-11 w-full min-w-0 sm:h-10 sm:w-[220px] [&>span]:min-w-0 [&>span]:truncate">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent
            position="popper"
            className="w-[var(--radix-select-trigger-width)] min-w-0 max-w-[var(--radix-select-trigger-width)] overflow-hidden"
          >
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="cutter_cut">Раскрой</SelectItem>
            <SelectItem value="sewer_piece">Пошив</SelectItem>
            <SelectItem value="overlock_piece">Оверлок</SelectItem>
            <SelectItem value="packer_stickering">Стикеровка</SelectItem>
            <SelectItem value="packer_repack">Перепаковка возврата</SelectItem>
            <SelectItem value="storekeeper_shift">Оклад кладовщика</SelectItem>
            <SelectItem value="cleaner_shift">Оклад уборщицы</SelectItem>
            <SelectItem value="admin_daily">Оклад администратора</SelectItem>
            <SelectItem value="manual">Ручное начисление</SelectItem>
            <SelectItem value="penalty">Штраф</SelectItem>
            <SelectItem value="deduction">Удержание</SelectItem>
            <SelectItem value="bonus">Бонус за выработку</SelectItem>
          </SelectContent>
        </Select>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:items-end sm:gap-2">
          <div className="min-w-0 flex-1 sm:max-w-[11.5rem]">
            <Label className="mb-1 block text-xs text-muted-foreground">Начислено с</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-11 w-full min-w-0 sm:h-10"
            />
          </div>
          <div className="min-w-0 flex-1 sm:max-w-[11.5rem]">
            <Label className="mb-1 block text-xs text-muted-foreground">по</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-11 w-full min-w-0 sm:h-10"
            />
          </div>
        </div>

        <Button variant="ghost" className="h-11 w-full sm:h-10 sm:w-auto" onClick={handleReset}>
          <Icon name="X" size={14} className="mr-1" />
          Сбросить
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal px-2 py-2 text-center text-xs leading-snug sm:h-9 sm:whitespace-nowrap sm:text-sm"
          size="sm"
          onClick={() => setPeriod('month')}
        >
          Текущий месяц
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal px-2 py-2 text-center text-xs leading-snug sm:h-9 sm:whitespace-nowrap sm:text-sm"
          size="sm"
          onClick={() => setPeriod('prevMonth')}
        >
          Прошлый месяц
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal px-2 py-2 text-center text-xs leading-snug sm:h-9 sm:whitespace-nowrap sm:text-sm"
          size="sm"
          onClick={() => setPeriod('first')}
        >
          1–15 число
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal px-2 py-2 text-center text-xs leading-snug sm:h-9 sm:whitespace-nowrap sm:text-sm"
          size="sm"
          onClick={() => setPeriod('second')}
        >
          16–конец месяца
        </Button>
      </div>
    </div>
  );
};

export default FinanceToolbar;
