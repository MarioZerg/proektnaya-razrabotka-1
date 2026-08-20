const UNIT_ECONOMICS_URL = 'https://functions.poehali.dev/4ebd72ad-8ca4-456c-840c-d2db30ce04cd';

/** Код площадки в системе. */
export type MarketplaceCode = 'ozon' | 'wildberries' | 'yandex_market';
/** Схема работы: со склада площадки (FBO) или со своего (FBS). */
export type Scheme = 'FBO' | 'FBS';

export const MARKETPLACE_LABELS: Record<MarketplaceCode, string> = {
  ozon: 'Ozon',
  wildberries: 'Wildberries',
  yandex_market: 'Яндекс Маркет',
};

/** Экономика одной проданной единицы. */
export interface UnitCalc {
  price: number;
  commission: number;
  commissionPercent: number;
  acquiring: number;
  promo: number;
  /** Логистика с учётом выкупа: платим за все отправленные, продаём не все. */
  logistics: number;
  /** Базовый тариф логистики до пересчёта на выкуп. */
  logisticsBase: number;
  returnCost: number;
  storage: number;
  acceptance: number;
  marketplaceCosts: number;
  productionCost: number;
  /** Налог УСН — считается с выручки без НДС. */
  tax: number;
  /** НДС, который сидит внутри цены покупателя. */
  vat: number;
  /** Выручка без НДС — база для налога УСН. */
  revenueNet: number;
  profit: number;
  margin: number;
  roi: number;
  buyoutPercent: number;
  /** Ниже этой цены товар уходит в минус. */
  breakEvenPrice: number | null;
}

export interface CostBreakdown {
  materials: {
    materialId: number;
    name: string;
    typeName: string;
    unit: string;
    quantity: number;
    pricePerUnit: number;
    sum: number;
    priceSource: string;
  }[];
  materialsCost: number;
  cutCost: number;
  sewCost: number;
  packWorkCost: number;
  laborCost: number;
  overhead: number;
  productionCost: number;
  missing: string[];
}

/** Расчёт по одной высоте изделия. */
export interface HeightRow {
  itemId: number;
  height: number | null;
  name: string;
  sku: string | null;
  source: string | null;
  discountPercent: number | null;
  /** Цена взята из фактической продажи, а не из карточки. */
  priceIsActual: boolean;
  /** Наша цена в кабинете — для сравнения с фактической. */
  cardPrice: number | null;
  unit: UnitCalc | null;
}

/** Строка расчёта: ткань + ширина. */
export interface EconomicsRow {
  material: string | null;
  width: number | null;
  productsCount: number;
  pricedCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
  cost: CostBreakdown;
  unit: UnitCalc | null;
  heights: HeightRow[];
  missing: string[];
}

export interface Tariffs {
  marketplaceCode: string;
  logisticsFbo: number;
  logisticsFbs: number;
  returnLogistics: number;
  storagePerMonth: number;
  acceptanceFee: number;
  acquiringPercent: number;
  promoPercent: number;
  storageMonths: number;
  /** Запасная комиссия: WB и Яндекс не отдают её по каждому товару. */
  commissionFboPercent: number;
  commissionFbsPercent: number;
  /** Когда тарифы последний раз пришли из кабинета площадки. */
  syncedAt?: string | null;
  /** Поля, которые площадка заполняет сама — руками их править не нужно. */
  syncedFields?: string[];
}

export interface EconomicsResponse {
  marketplaceCode: string;
  scheme: Scheme;
  settings: { taxPercent: number; vatPercent: number };
  tariffs: Tariffs;
  buyout: {
    used: number;
    real: number | null;
    isOverride: boolean;
    /** Выкуп по данным самой площадки — с учётом возвратов после доставки. */
    fromMarketplace: number | null;
    mpOrdered: number | null;
    mpDelivered: number | null;
    mpReturned: number | null;
    mpSyncedAt: string | null;
    /** Откуда взят выкуп: marketplace / orders / override / none. */
    source: string;
    orders: number;
    cancelled: number;
  };
  rows: EconomicsRow[];
}

/** Один вариант продажи в сравнении: площадка + схема. */
export interface CompareVariant {
  marketplaceCode: MarketplaceCode;
  scheme: Scheme;
  price: number;
  profit: number;
  margin: number;
  roi: number;
  buyoutPercent: number;
}

export interface CompareRow {
  material: string | null;
  width: number | null;
  productionCost: number;
  variants: CompareVariant[];
  best: CompareVariant | null;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(UNIT_ECONOMICS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const fetchEconomics = async (params: {
  marketplace: MarketplaceCode;
  scheme: Scheme;
  /** Своё значение выкупа для сценария «а если выкуп упадёт». */
  buyout?: number;
}): Promise<EconomicsResponse> => {
  const qs = new URLSearchParams({
    marketplace: params.marketplace,
    scheme: params.scheme,
  });
  if (params.buyout) qs.set('buyout', String(params.buyout));
  const res = await fetch(`${UNIT_ECONOMICS_URL}?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить расчёт');
  return data;
};

export const fetchCompare = async (): Promise<CompareRow[]> => {
  const res = await fetch(`${UNIT_ECONOMICS_URL}?action=compare`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить сравнение');
  return data.rows || [];
};

/**
 * Тянет цены из кабинета площадки ПОРЦИЯМИ.
 *
 * Карточек почти тысяча, а у функции 5 секунд на запрос — за один раз всё не
 * успевает. Поэтому загрузка идёт страницами, а сюда передаётся колбэк прогресса,
 * чтобы менеджер видел, что процесс идёт, а не завис.
 */
export const syncPrices = async (
  marketplaceCode: MarketplaceCode,
  actorId?: number,
  onProgress?: (loaded: number) => void,
): Promise<number> => {
  let cursor = '';
  let total = 0;
  for (let i = 0; i < 40; i += 1) {
    const data = await post({
      action: 'sync_prices',
      marketplaceCode,
      actorId,
      cursor,
    });
    total += data.saved || 0;
    onProgress?.(total);
    cursor = data.cursor || '';
    if (data.done || !cursor) break;
  }
  return total;
};

export const saveTariffs = (
  payload: Partial<Tariffs> & { marketplaceCode: MarketplaceCode; actorId?: number },
) => post({ action: 'save_tariffs', ...payload });

export const saveEconomicsSettings = (payload: {
  taxPercent: number;
  /** Ставка НДС, %. 0 — освобождение. */
  vatPercent: number;
  actorId?: number;
}) => post({ action: 'save_settings', ...payload });

export const savePrice = (payload: {
  itemId: number;
  marketplaceCode: MarketplaceCode;
  price?: number;
  commissionFbo?: number;
  commissionFbs?: number;
  actorId?: number;
}) => post({ action: 'save_price', ...payload });