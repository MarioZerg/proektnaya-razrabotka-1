const PROMOTION_URL = 'https://functions.poehali.dev/5fc24d57-7e45-4a1a-898d-a610c310093a';

export type MarketplaceCode = 'ozon' | 'wildberries' | 'yandex_market';

/** Что система советует сделать с ценой размера. */
export type PriceAction = 'raise' | 'lower' | 'hold' | 'wait' | 'rollback';

export interface PriceAdvice {
  itemId: number;
  title: string;
  sku: string | null;
  action: PriceAction;
  currentPrice: number;
  suggestedPrice: number;
  currentMargin: number;
  expectedMargin: number | null;
  /** Скидка площадки за свой счёт, %. Null — площадка её не отдала. */
  spp: number | null;
  reason: string;
}

export interface Strategy {
  marginMin: number;
  marginMax: number;
  stepPercent: number;
  stepDays: number;
  minSpp: number;
}

export interface OverviewResponse {
  marketplaceCode: string;
  strategy: Strategy;
  items: PriceAdvice[];
  summary: {
    total: number;
    raise: number;
    lower: number;
    hold: number;
    wait: number;
    rollback: number;
  };
  buyout?: { used: number; fromMarketplace: number | null };
  error?: string;
}

export interface Promotion {
  marketplaceCode: string;
  marketplaceTitle: string;
  externalId: string;
  title: string;
  dateStart: string | null;
  dateEnd: string | null;
  itemsCount: number;
  /** Какая маржа останется, если участвовать по ценам площадки. */
  avgMargin: number | null;
  lossmakingCount: number;
  /** good — идём, risky — осторожно, bad — в убыток. */
  verdict: string | null;
  syncedAt: string | null;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(PROMOTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');
  return data;
};

export const fetchOverview = async (
  marketplace: MarketplaceCode,
  actorId?: number,
): Promise<OverviewResponse> => {
  const res = await fetch(
    `${PROMOTION_URL}?action=overview&marketplace=${marketplace}&actorId=${actorId ?? ''}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить советы');
  return data;
};

export const fetchPromotions = async (actorId?: number): Promise<Promotion[]> => {
  const res = await fetch(`${PROMOTION_URL}?action=promotions&actorId=${actorId ?? ''}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить акции');
  return data.items || [];
};

export const fetchPriceHistory = async (itemId: number, actorId?: number) => {
  const res = await fetch(
    `${PROMOTION_URL}?action=history&itemId=${itemId}&actorId=${actorId ?? ''}`,
  );
  const data = await res.json();
  return data.items || [];
};

/** Запоминает решение владельца: применил совет или отклонил. */
export const decideAdvice = (
  items: Array<Partial<PriceAdvice> & { marketplaceCode: string }>,
  decision: 'applied' | 'skipped',
  actorId?: number,
) => post({ action: 'decide', items, decision, actorId });

export const saveStrategy = (
  payload: Omit<Strategy, 'minSpp'> & { actorId?: number },
) => post({ action: 'save_strategy', ...payload });

export const syncPromotions = (actorId?: number) =>
  post({ action: 'sync_promotions', actorId });

export const scorePromotions = (actorId?: number) =>
  post({ action: 'score_promotions', actorId });
