import Icon from '@/components/ui/icon';
import type { OutsideDebt } from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface PayoutDebtsCardProps {
  debts: OutsideDebt[];
  debtIds: number[];
  setDebtIds: (updater: (prev: number[]) => number[]) => void;
  willRepay: number;
  carryOver: number;
}

/**
 * СТАРЫЕ ДОЛГИ ВНЕ ВЫБРАННОГО ПЕРИОДА.
 * Штраф выписан 21-го, а закрывают первую половину месяца — он не попадал
 * в выплату и висел вечно, копясь в виджете кассы. Теперь он виден здесь,
 * и его можно удержать галочкой.
 */
const PayoutDebtsCard = ({
  debts,
  debtIds,
  setDebtIds,
  willRepay,
  carryOver,
}: PayoutDebtsCardProps) => (
  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
    <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
      <Icon name="TriangleAlert" size={13} className="shrink-0" />
      Непогашенные удержания за другие даты
    </p>
    <div className="mt-2 space-y-1.5">
      {debts.map((d) => (
        <label
          key={d.id}
          className="flex cursor-pointer items-start gap-2 text-xs"
        >
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-600"
            checked={debtIds.includes(d.id)}
            onChange={(e) =>
              setDebtIds((prev) =>
                e.target.checked
                  ? [...prev, d.id]
                  : prev.filter((x) => x !== d.id),
              )
            }
          />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-amber-900">
              {formatMoney(Math.abs(d.amount))} ₽
            </span>
            <span className="text-amber-800">
              {' '}
              · {d.type === 'penalty' ? 'штраф' : 'удержание'} от {d.accruedFor}
            </span>
            <span className="block truncate text-amber-700">
              {d.description}
            </span>
          </span>
        </label>
      ))}
    </div>
    {/* Долг больше заработка — гасим частично, остальное перенесём.
        Человек не должен уйти с выплатой «минус». */}
    {carryOver > 0 && (
      <p className="mt-2 text-xs text-amber-800">
        Заработка хватает на {formatMoney(willRepay)} ₽ — остаток{' '}
        {formatMoney(carryOver)} ₽ перейдёт на следующую выплату
      </p>
    )}
  </div>
);

export default PayoutDebtsCard;
