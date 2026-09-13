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
  <>
    <div className="space-y-1.5">
      <Label>Сотрудник</Label>
      <Select value={userId} onValueChange={setUserId}>
        <SelectTrigger>
          <SelectValue placeholder="Выберите сотрудника" />
        </SelectTrigger>
        <SelectContent>
          {/* В списке только те, кому правда есть что выплатить.
              Раньше стояли все сотрудники компании, включая уволенных и
              тех, у кого ничего не начислено: админ выбирал наугад и
              получал отказ «нет начислений» уже после нажатия. */}
          {pending.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              Невыплаченных начислений нет
            </div>
          ) : (
            pending.map((e) => (
              <SelectItem key={e.userId} value={String(e.userId)}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="truncate">{e.fullName}</span>
                  <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                    {formatMoney(e.amount)} ₽
                  </span>
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-1.5">
      <Label>Период</Label>
      <div className="flex flex-wrap gap-1.5">
        {quickPeriods().map((p) => (
          <Button
            key={p.label}
            type="button"
            variant={from === p.from && to === p.to ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
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
          className="h-7 text-xs"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          Всё целиком
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-9"
        />
        <span className="text-xs text-muted-foreground">—</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-9"
        />
      </div>
    </div>
  </>
);

export default PayoutEmployeePeriod;
