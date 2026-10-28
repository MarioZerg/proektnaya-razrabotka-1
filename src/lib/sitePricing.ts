import type { SitePricing } from '@/lib/siteOrdersApi';

export interface SiteProfit {
  tax: number;
  acquiring: number;
  delivery: number;
  blogger: number;
  profit: number;
  profitPct: number;
}

/**
 * Чистая прибыль с продажи на сайте — от ЦЕНЫ, а не от себестоимости:
 * цена − налог − эквайринг − доставка − себестоимость (− блогер, если продажа через него).
 */
export const siteProfit = (
  price: number,
  cost: number,
  p: SitePricing,
  viaBlogger = false
): SiteProfit => {
  const tax = (price * p.taxPct) / 100;
  const acquiring = (price * p.acquiringPct) / 100;
  const blogger = viaBlogger ? (price * p.bloggerPct) / 100 : 0;
  const delivery = p.deliveryRub;
  const profit = price - tax - acquiring - blogger - delivery - cost;
  return { tax, acquiring, delivery, blogger, profit, profitPct: price > 0 ? (profit / price) * 100 : 0 };
};

/** Цена, при которой без блогера остаётся целевой % чистой прибыли. Кратна 10 ₽ вверх. */
export const recommendedPrice = (cost: number, p: SitePricing): number | null => {
  const share = 1 - (p.targetProfitPct + p.taxPct + p.acquiringPct) / 100;
  if (share <= 0) return null;
  return Math.ceil((cost + p.deliveryRub) / share / 10) * 10;
};
