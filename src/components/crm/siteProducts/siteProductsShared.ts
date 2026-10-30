import type { SitePricing } from '@/lib/siteOrdersApi';

export type View = 'active' | 'noFabric' | 'noMaterials' | 'noPrice' | 'lowProfit' | 'disabled' | 'archived';

export const DEFAULT_PRICING: SitePricing = {
  profitByWidth: { '200': 450, '300': 450, '400': 450, '500': 250, '600': 250, '700': 250, '800': 250 },
  taxPct: 6,
  acquiringPct: 2,
  bloggerPct: 10,
};

export const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

export type SiteActor = { id?: number; name?: string };
