import type { BoughtOrder } from '@/lib/managerFinanceApi';

/** Сколько выкупов держим на экране: их тысячи, всё сразу не показать. */
export const PER_PAGE = 10;

/** Имена площадок: в отчёте они приходят кодами. */
export const MP: Record<string, { label: string; className: string }> = {
  ozon: { label: 'OZON', className: 'text-blue-700' },
  wildberries: { label: 'WB', className: 'text-fuchsia-700' },
  yandex_market: { label: 'Яндекс', className: 'text-amber-600' },
  OZON: { label: 'OZON', className: 'text-blue-700' },
  WB: { label: 'WB', className: 'text-fuchsia-700' },
  Yandex: { label: 'Яндекс', className: 'text-amber-600' },
};

export const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

export const fullDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
};

/** Итог по всему отбору, а не по видимой странице. */
export interface BuyoutsTotals {
  revenue: number;
  profit: number;
  margin: number;
  knownRevenue?: number;
  breakdown?: Record<string, number>;
  feeShare?: number;
  bonus?: { points: number; bank: number };
}

/** Сколько выкупов по каждой площадке и схеме — для переключателей. */
export interface BuyoutsSlice {
  marketplace: string;
  scheme: string;
  count: number;
}

/** Что отдаёт лента выкупов на один запрос страницы. */
export interface BuyoutsData {
  items: BoughtOrder[];
  total: number;
  pages: number;
  totals?: BuyoutsTotals;
  breakdown?: BuyoutsSlice[];
}
