import type { SitePricing } from '@/lib/siteOrdersApi';

export interface SiteProfit {
  tax: number;
  acquiring: number;
  blogger: number;
  profit: number;
  profitPct: number;
}

/**
 * Чистая прибыль с продажи — от цены витрины:
 * цена − налог − эквайринг − себестоимость (− доля блогера, если продажа по его ссылке).
 * Доставку клиент оплачивает на сайте отдельно — в расчёт не входит.
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
  const profit = price - tax - acquiring - blogger - cost;
  return { tax, acquiring, blogger, profit, profitPct: price > 0 ? (profit / price) * 100 : 0 };
};

export interface CostRange {
  min: number;
  max: number;
}

/**
 * Сколько рублей хотим заработать на штуке. Самая дешёвая вещь каталога —
 * минимум, самая дорогая — максимум, между ними плавно. Рублей с большой вещи
 * больше, но в процентах от цены — меньше, чем с маленькой.
 */
export const targetProfit = (cost: number, range: CostRange, p: SitePricing): number => {
  if (range.max <= range.min) return (p.minProfitRub + p.maxProfitRub) / 2;
  const t = Math.min(1, Math.max(0, (cost - range.min) / (range.max - range.min)));
  return p.minProfitRub + t * (p.maxProfitRub - p.minProfitRub);
};

/**
 * Цена витрины, при которой целевая прибыль остаётся нам даже при продаже по
 * ссылке блогера: его % от цены заложен сверху и нашу прибыль не трогает.
 * Кратна 10 ₽ вверх.
 */
export const recommendedPrice = (cost: number, range: CostRange, p: SitePricing): number | null => {
  const share = 1 - (p.taxPct + p.acquiringPct + p.bloggerPct) / 100;
  if (share <= 0) return null;
  return Math.ceil((cost + targetProfit(cost, range, p)) / share / 10) * 10;
};
