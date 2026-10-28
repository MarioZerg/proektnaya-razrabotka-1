import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Icon from '@/components/ui/icon';
import type { SitePricing } from '@/lib/siteOrdersApi';
import { siteProfit, targetProfit } from '@/lib/sitePricing';
import type { SiteWidthGroup } from '@/components/crm/siteProducts/siteWidthGroups';

const rub = (v: number) =>
  `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;

interface Props {
  group: SiteWidthGroup;
  pricing: SitePricing;
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
  sign?: '−' | '=';
  muted?: boolean;
  bold?: boolean;
}) => (
  <div
    className={`flex justify-between gap-3 text-xs ${muted ? 'pl-4 text-muted-foreground' : ''} ${
      bold ? 'font-semibold' : ''
    }`}
  >
    <span className="min-w-0 truncate">
      {sign && <span className="mr-1 inline-block w-3">{sign}</span>}
      {label}
    </span>
    <span className="shrink-0">{rub(value)}</span>
  </div>
);

/** Цепочка расчёта по каждой высоте ширины: от цены витрины до чистой прибыли. */
const SiteProfitChain = ({ group, pricing }: Props) => {
  const priced = group.items.filter((i) => i.price != null && i.cost != null);
  const [activeId, setActiveId] = useState<number | null>(null);
  if (priced.length === 0) return null;

  const item = priced.find((i) => i.id === activeId) ?? priced[0];
  const price = item.price as number;
  const cost = item.cost as number;
  const blog = siteProfit(price, cost, pricing, true);
  const base = siteProfit(price, cost, pricing);
  const target = targetProfit(group.width, pricing);
  const parts = item.costParts;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline">
          <Icon name="ListTree" size={12} />
          как считается
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] space-y-3" align="start">
        <div>
          <p className="text-sm font-semibold">
            {group.title} · {group.width}×{item.height} см
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">{item.article}</p>
        </div>

        <div className="flex flex-wrap gap-1">
          {priced.map((i) => {
            const p = siteProfit(i.price as number, i.cost as number, pricing, true).profit;
            const isActive = i.id === item.id;
            const low = target != null && p < target - 5;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => setActiveId(i.id)}
                className={`rounded px-2 py-1 text-left text-[11px] leading-tight transition ${
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
                }`}
              >
                <span className="block font-semibold">{i.height}</span>
                <span className={isActive ? '' : low ? 'text-amber-700' : 'text-emerald-700'}>
                  {Math.round(p)} ₽
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-1">
          <p className="text-[11px] uppercase text-muted-foreground">По ссылке блогера</p>
          <Line label="Цена на витрине" value={price} bold />
          <Line label={`Блогеру ${pricing.bloggerPct}% от цены`} value={blog.blogger} sign="−" />
          <Line label={`Налог УСН ${pricing.taxPct}%`} value={blog.tax} sign="−" />
          <Line label={`Эквайринг ${pricing.acquiringPct}%`} value={blog.acquiring} sign="−" />
          <Line label="Себестоимость" value={cost} sign="−" />
          {parts && (
            <>
              {(parts.lines || []).map((l) => (
                <Line key={l.name} label={`${l.name} · ${l.quantity} × ${rub(l.price)}`} value={l.sum} muted />
              ))}
              <Line label="недостачи материалов" value={parts.shortage} muted />
              <Line label="работа цеха и оклады" value={parts.labor} muted />
              <Line label="прочие расходы" value={parts.overhead} muted />
            </>
          )}
          <div className="border-t border-border pt-1">
            <Line label="Наша чистая прибыль" value={blog.profit} sign="=" bold />
            <p className="pl-4 text-xs text-muted-foreground">
              {Math.round(blog.profitPct)}% от цены{target != null ? ` · цель ширины ${rub(target)}` : ''}
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
