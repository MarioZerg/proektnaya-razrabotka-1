import type { SiteFixedCosts, SitePricing } from '@/lib/siteOrdersApi';

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
 * Доставка до города клиента прибавляется на сайте сверху и уходит Ozon — в расчёт не входит.
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

/** Целевая прибыль ширины, ₽. Не задана — берём ближайшую меньшую заданную ширину. */
export const targetProfit = (width: number | null, p: SitePricing): number | null => {
  const map = p.profitByWidth || {};
  if (width != null && map[String(width)] != null) return map[String(width)];
  const known = Object.keys(map)
    .map(Number)
    .filter((w) => Number.isFinite(w))
    .sort((a, b) => a - b);
  if (!known.length) return null;
  const lower = width != null ? known.filter((w) => w <= width).pop() : undefined;
  return map[String(lower ?? known[0])];
};

/**
 * Цена витрины, при которой прибыль ширины остаётся нам даже при продаже по
 * ссылке блогера: его % от цены заложен сверху и нашу прибыль не трогает.
 * Кратна 10 ₽ вверх.
 */
export const recommendedPrice = (cost: number, width: number | null, p: SitePricing): number | null => {
  const target = targetProfit(width, p);
  const share = 1 - (p.taxPct + p.acquiringPct + p.bloggerPct) / 100;
  if (target == null || share <= 0) return null;
  return Math.ceil((cost + target) / share / 10) * 10;
};

/**
 * Постоянные расходы на одну вещь сайта при режиме из настроек (в т.ч. несохранённых).
 * shared — доля от деления на все продажи; site_only — ежемесячные суммы ÷ план сайта.
 * Ежемесячный расход «только сайт» всегда делится на план сайта.
 */
export const fixedPerUnit = (fixed: SiteFixedCosts | null | undefined, p: SitePricing): number | null => {
  if (!fixed) return null;
  const units = Math.max(Number(p.siteMonthlyUnits) || 0, 1);
  const siteOnly = p.fixedMode === 'site_only';
  const sum = fixed.lines.reduce((s, l) => {
    const perUnit =
      l.isMonthly && l.monthly != null && (siteOnly || l.channel === 'site') ? l.monthly / units : l.perUnitShared;
    return s + perUnit;
  }, 0);
  return Math.round(sum * 100) / 100;
};

/** Сколько вещей в месяц нужно продать, чтобы покрыть ежемесячные постоянные расходы. */
export const breakEvenUnits = (monthlyFixed: number, avgMarginPerUnit: number): number | null =>
  avgMarginPerUnit > 0 ? Math.ceil(monthlyFixed / avgMarginPerUnit) : null;
