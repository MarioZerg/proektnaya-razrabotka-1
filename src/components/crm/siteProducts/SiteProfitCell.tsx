import type { SiteCatalogItem, SitePricing } from '@/lib/siteOrdersApi';
import { siteProfit } from '@/lib/sitePricing';

const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

/** Чистая прибыль с продажи: обычной и по ссылке блогера. */
interface Props {
  item: SiteCatalogItem;
  pricing: SitePricing;
  /** Целевая прибыль этой вещи, ₽. */
  target: number | null;
}

const SiteProfitCell = ({ item, pricing, target }: Props) => {
  if (item.price == null || item.cost == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const base = siteProfit(item.price, item.cost, pricing);
  const blog = siteProfit(item.price, item.cost, pricing, true);
  const color = (v: number) =>
    v < 0 ? 'text-red-600' : target != null && v < target - 5 ? 'text-amber-700' : 'text-emerald-700';
  const breakdown =
    `По ссылке блогера: цена ${rub(item.price)} − блогер ${rub(blog.blogger)} − налог ${rub(blog.tax)}` +
    ` − эквайринг ${rub(blog.acquiring)} − себестоимость ${rub(item.cost)} = ${rub(blog.profit)}`;

  return (
    <div className="flex flex-col gap-0.5" title={breakdown}>
      <span className={`font-medium ${color(blog.profit)}`}>
        {rub(blog.profit)} · {Math.round(blog.profitPct)}%
      </span>
      <span className="text-xs text-muted-foreground">
        {target != null ? `цель ${rub(target)} · ` : ''}без блогера {rub(base.profit)}
      </span>
    </div>
  );
};

export default SiteProfitCell;
