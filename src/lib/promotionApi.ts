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
  /** Сколько от цены съедает реклама этого товара, %. */
  adPercent?: number;
  /** Какой была бы маржа, если рекламу не крутить. */
  marginWithoutAd?: number;
  /**
   * Наша цена до скидки площадки — та, что стоит в кабинете.
   * currentPrice выше показывает цену для покупателя (уже с СПП), а площадка
   * принимает именно эту. Шаг пересчитывается автоматически при отправке.
   */
  cardPrice?: number;
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
    /** Средняя доля рекламы в цене по площадке, %. */
    avgAdPercent?: number;
    /** Сколько позиций убыточны ТОЛЬКО из-за рекламы. */
    killedByAds?: number;
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

const PRICE_PUSH_URL = 'https://functions.poehali.dev/fc1cfb34-b57c-41d4-97d9-fcee27c9af6a';

export interface PushResult {
  pushed: number;
  /** Позиции, которые система не рискнула отправить, и почему. */
  skipped: Array<{ itemId?: number; name?: string; reason: string }>;
  /** Позиции, которые отклонила сама площадка. */
  failed: Array<{ itemId?: number; name?: string; reason: string }>;
  items: Array<{ itemId: number; name: string; oldPrice: number; newPrice: number }>;
}

/**
 * Отправляет новые цены НА площадку.
 *
 * Пишет прямо на витрину, поэтому вызывается только после явного
 * подтверждения владельца — никаких фоновых запусков.
 */
export const pushPrices = async (
  marketplace: MarketplaceCode,
  items: Array<{ itemId: number; newPrice: number }>,
  actorId?: number,
): Promise<PushResult> => {
  const res = await fetch(PRICE_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'push', marketplace, items, actorId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отправить цены');
  return data;
};