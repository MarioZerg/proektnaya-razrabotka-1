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
/** Товар — кандидат в акцию с готовым расчётом прибыли. */
export interface ActionCandidate {
  productId: number;
  offerId: string;
  name: string;
  currentPrice: number;
  actionPrice: number;
  profit: number;
  margin: number;
  /** Проходит ли по прибыльности: убыточные заводить нельзя. */
  eligible: boolean;
  reason: string;
  /** В каких акциях товар уже участвует: скидки складываются. */
  inActions?: string[];
}

export const fetchActionCandidates = (
  actionId: number | string,
  actorId?: number,
  minMargin = 5,
): Promise<{
  items: ActionCandidate[];
  eligible: number;
  total: number;
  /** Сколько товаров занято срочными акциями. */
  busyShort?: number;
  /** Предел товаров в акциях и всего в каталоге. */
  limitItems?: number;
  totalItems?: number;
  maxActionsPerItem?: number;
}> => post({ action: 'action_candidates', actionId, actorId, minMargin });

/** Акция в плане по материалу: что проходит и чем придётся пожертвовать. */
export interface PlanAction {
  actionId: string;
  title: string;
  dateEnd: string | null;
  /** Сколько размеров материала проходит по прибыльности. */
  fits: number;
  total: number;
  /** Средняя маржа размеров внутри этой акции. */
  avgMargin: number;
  /** Во сколько обходится скидка: теряем рублей с вещи. */
  profitDrop: number;
  /** Сколько размеров добавится сверх предыдущих акций. */
  newItems: number;
  /** Средняя маржа по всему материалу после входа в эту акцию. */
  avgAfter: number;
  /** Стоит ли входить: средняя маржа не должна упасть ниже порога. */
  recommended: boolean;
  reason: string;
  items: ActionCandidate[];
}

/**
 * План продвижения по всему материалу.
 *
 * Акции идут в порядке очерёдности: сначала та, где скидка обходится дешевле
 * всего. Как только средняя маржа по ассортименту опускается ниже порога,
 * остальные помечаются «стоп».
 */
export const fetchMaterialPlan = (
  material: string,
  actorId?: number,
  minAvgMargin = 4.5,
): Promise<{
  material: string;
  actions: PlanAction[];
  minAvgMargin: number;
  baseAvgMargin: number;
  sizes: number;
}> => post({ action: 'material_plan', material, actorId, minAvgMargin });

/** Завести товары в акцию. Убыточные сервер не пропустит. */
export const joinAction = (payload: {
  actionId: number | string;
  offerIds: string[];
  minMargin?: number;
  actorId?: number;
  actorName?: string;
}) => post({ action: 'join_action', ...payload });

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