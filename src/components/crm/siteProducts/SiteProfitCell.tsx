import type { SiteCatalogItem, SitePricing } from '@/lib/siteOrdersApi';
import { siteProfit } from '@/lib/sitePricing';

const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

/** Чистая прибыль с продажи: обычной и по ссылке блогера. */
const SiteProfitCell = ({ item, pricing }: { item: SiteCatalogItem; pricing: SitePricing }) => {
  if (item.price == null || item.cost == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const base = siteProfit(item.price, item.cost, pricing);
  const blog = siteProfit(item.price, item.cost, pricing, true);
  const color = (pct: number) =>
    pct < 0 ? 'text-red-600' : pct < pricing.targetProfitPct - 0.5 ? 'text-amber-700' : 'text-emerald-700';
  const breakdown =
    `Цена ${rub(item.price)} − налог ${rub(base.tax)} − эквайринг ${rub(base.acquiring)}` +
    (base.delivery ? ` − доставка ${rub(base.delivery)}` : '') +
    ` − себестоимость ${rub(item.cost)} = ${rub(base.profit)}`;

  return (
    <div className="flex flex-col gap-0.5" title={breakdown}>
      <span className={`font-medium ${color(base.profitPct)}`}>
        {rub(base.profit)} · {Math.round(base.profitPct)}%
      </span>
      <span className={`text-xs ${color(blog.profitPct)}`}>
        с блогером {rub(blog.profit)} · {Math.round(blog.profitPct)}%
      </span>
    </div>
  );
};

export default SiteProfitCell;
