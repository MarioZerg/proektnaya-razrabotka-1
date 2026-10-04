import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PendingPayout } from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Быстрые периоды: закрывают привычные отрезки в один клик. */
export const quickPeriods = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const prevFrom = new Date(y, m - 1, 1);
  const prevTo = new Date(y, m, 0);
  return [
    {
      label: 'Первая половина',
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m, 15)),
    },
    {
      label: 'Вторая половина',
      from: iso(new Date(y, m, 16)),
      to: iso(new Date(y, m, lastDay)),
    },
    {
      label: 'Текущий месяц',
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m, lastDay)),
    },
    { label: 'Прошлый месяц', from: iso(prevFrom), to: iso(prevTo) },
  ];
};

interface PayoutEmployeePeriodProps {
  pending: PendingPayout[];
  userId: string;
  setUserId: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  wholePeriod: boolean;
}

/** Кого и за какой период платим: выбор сотрудника и дат. */
const PayoutEmployeePeriod = ({
  pending,
  userId,
  setUserId,
  from,
  setFrom,
  to,
  setTo,
  wholePeriod,
}: PayoutEmployeePeriodProps) => (
  <div className="min-w-0 space-y-4">
    <div className="min-w-0 space-y-1.5">
      <Label>Сотрудник</Label>
      <Select value={userId} onValueChange={setUserId}>
        <SelectTrigger className="h-11 w-full min-w-0 sm:h-10">
          <SelectValue placeholder="Выберите сотрудника" />
        </SelectTrigger>
        {/* Ширина строго по триггеру: иначе длинное ФИО + сумма раздувают
            выпадашку шире окна и уезжают за край на телефоне. */}
        <SelectContent
          position="popper"
          className="w-[var(--radix-select-trigger-width)] min-w-0 max-w-[var(--radix-select-trigger-width)] overflow-hidden"
        >
          {pending.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              Невыплаченных начислений нет
            </div>
          ) : (
            pending.map((e) => (
              <SelectItem
                key={e.userId}
                value={String(e.userId)}
                className="w-full min-w-0 overflow-hidden pr-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:overflow-hidden"
              >
                <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <span className="min-w-0 truncate">{e.fullName}</span>
                  <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                    {formatMoney(e.amount)} ₽
                  </span>
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>

    <div className="min-w-0 space-y-1.5">
      <Label>Период</Label>
      <div className="flex flex-wrap gap-1.5">
        {quickPeriods().map((p) => (
          <Button
            key={p.label}
            type="button"
            variant={from === p.from && to === p.to ? 'default' : 'outline'}
            size="sm"
            className="h-auto min-h-7 max-w-full whitespace-normal px-2 py-1 text-xs leading-snug"
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
          >
            {p.label}
          </Button>
        ))}
        <Button
          type="button"
          variant={wholePeriod ? 'default' : 'outline'}
          size="sm"
          className="h-auto min-h-7 max-w-full whitespace-normal px-2 py-1 text-xs leading-snug"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          Всё целиком
        </Button>
      </div>
      {/* type=date на телефоне имеет большой min-width и рвёт flex-ряд —
          ставим сеткой, чтобы поля не вылезали за край окна. */}
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-11 w-full min-w-0 sm:h-9"
        />
        <span className="hidden text-center text-xs text-muted-foreground sm:inline">—</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-11 w-full min-w-0 sm:h-9"
        />
      </div>
    </div>
  </div>
);

export default PayoutEmployeePeriod;
