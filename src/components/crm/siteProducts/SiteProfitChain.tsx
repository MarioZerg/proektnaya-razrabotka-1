import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Icon from '@/components/ui/icon';
import type { SitePricing } from '@/lib/siteOrdersApi';
import { siteProfit, targetProfit, type CostRange } from '@/lib/sitePricing';
import type { SiteWidthGroup } from '@/components/crm/siteProducts/siteWidthGroups';

const rub = (v: number) =>
  `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;

interface Props {
  group: SiteWidthGroup;
  pricing: SitePricing;
  range: CostRange;
}

const Line = ({
  label,
  value,
  sign,
  muted,
  bold,
}: {
  label: string;
  value: number;
  sign?: '−' | '+' | '=';
  muted?: boolean;
  bold?: boolean;
}) => (
  <div className={`flex justify-between gap-3 text-xs ${muted ? 'pl-3 text-muted-foreground' : ''} ${bold ? 'font-semibold' : ''}`}>
    <span>
      {sign && <span className="mr-1 inline-block w-3">{sign}</span>}
      {label}
    </span>
    <span className="shrink-0">{rub(value)}</span>
  </div>
);

/** Цепочка расчёта: от цены витрины до нашей чистой прибыли. */
const SiteProfitChain = ({ group, pricing, range }: Props) => {
  const price = typeof group.price === 'number' ? group.price : null;
  const cost = group.cost;
  if (price == null || cost == null) return null;

  const blog = siteProfit(price, cost, pricing, true);
  const base = siteProfit(price, cost, pricing);
  const target = targetProfit(cost, range, pricing);
  const parts = group.costParts;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline"
        >
          <Icon name="ListTree" size={12} />
          как считается
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start">
        <div>
          <p className="text-sm font-semibold">
            {group.title} · {group.width} см
          </p>
          <p className="text-xs text-muted-foreground">Продажа по ссылке блогера</p>
        </div>

        <div className="space-y-1">
          <Line label="Цена на витрине" value={price} bold />
          <Line label={`Блогеру ${pricing.bloggerPct}% от цены`} value={blog.blogger} sign="−" />
          <Line label={`Налог УСН ${pricing.taxPct}%`} value={blog.tax} sign="−" />
          <Line label={`Эквайринг ${pricing.acquiringPct}%`} value={blog.acquiring} sign="−" />
          <Line label="Себестоимость" value={cost} sign="−" />
          {parts && (
            <>
              <Line label="материалы" value={parts.materials} muted />
              <Line label="недостачи материалов" value={parts.shortage} muted />
              <Line label="работа цеха и оклады" value={parts.labor} muted />
              <Line label="прочие расходы" value={parts.overhead} muted />
            </>
          )}
          <div className="border-t border-border pt-1">
            <Line label="Наша чистая прибыль" value={blog.profit} sign="=" bold />
            <p className="pl-4 text-xs text-muted-foreground">
              {Math.round(blog.profitPct)}% от цены · цель {rub(Math.round(target))}
            </p>
          </div>
        </div>

        <div className="rounded-md bg-muted/50 p-2 text-xs">
          Без блогера его {rub(blog.blogger)} остаются нам:{' '}
          <span className="font-semibold">{rub(base.profit)}</span> ({Math.round(base.profitPct)}%).
          Доставку клиент оплачивает на сайте отдельно.
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SiteProfitChain;
