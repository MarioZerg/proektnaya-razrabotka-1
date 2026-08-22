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
  /** Какой процент рекламы применён к этому товару. */
  promoPercent?: number;
  /** Процент взят из фактических трат площадки, а не из ручной настройки. */
  promoIsFact?: boolean;
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
  /** Ставка НДС, % — нужна, чтобы показать формулу расчёта. */
  vatPercent: number;
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
  /** Считать рекламу по фактическим тратам, а не по ручному проценту. */
  promoFromFact?: boolean;
  /** Сколько реально ушло на рекламу за месяц, % от выручки площадки. */
  promoFactPercent?: number | null;
  /** Когда факт по рекламе последний раз обновлялся. */
  promoSyncedAt?: string | null;
}

/** Фактические траты на рекламу по площадке за период. */
export interface AdSpendTotal {
  marketplaceCode: string;
  adSpend: number;
  revenue: number;
  adPercent: number | null;
  periodDays: number;
  calculatedAt: string | null;
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

/** Одна статья удержания площадки за месяц. */
export interface FeeItem {
  name: string;
  amount: number;
  /** Сколько раз статья встретилась: разовый платёж или поштучный. */
  operations: number;
  category: string;
}

export interface FeesMonth {
  month: string;
  revenue: number;
  adSpend: number;
  soldUnits: number;
  /** Всего удержано за месяц. */
  feesTotal: number;
  /** Сколько это на одну проданную вещь. */
  feesPerUnit: number | null;
  feesPercent: number | null;
  byCategory: Record<string, number>;
  /** Прибыль по юнитке: продано × прибыль с вещи. */
  grossProfit: number;
  /** Она же за вычетом удержаний магазина — сколько осталось на самом деле. */
  netProfit: number;
  /** Средняя прибыль с одной вещи по юнит-экономике. */
  unitProfit: number;
  items: FeeItem[];
}

/**
 * Удержания площадки, которых нет в юнит-экономике товара.
 *
 * Комиссия и логистика зависят от самой продажи — они в юнитке. А подписка,
 * досрочная выплата, платные слоты и штрафы относятся к магазину и месяцу:
 * подписка не дорожает от того, что продали ещё одну штору. Класть их в
 * стоимость единицы нельзя — цифра станет ложной.
 */
export const fetchPlatformFees = async (
  marketplace: string,
  months = 6,
): Promise<FeesMonth[]> => {
  const res = await fetch(
    `${UNIT_ECONOMICS_URL}?action=fees&marketplace=${marketplace}&months=${months}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить расходы площадки');
  return data.months || [];
};

/** Одна ячейка отчёта: сколько продали этого размера в этом месяце. */
export interface MonthlySizeCell {
  count: number;
  revenue: number;
}

/** Реклама за месяц — общая по площадке. */
export interface MonthlyAd {
  adPercent: number | null;
  adSpend: number;
  adRevenue: number;
}

export interface MonthlyReport {
  marketplace: string;
  /** Месяцы по порядку — ими подписаны колонки. */
  months: string[];
  adByMonth: Record<string, MonthlyAd>;
  sizes: { width: number; byMonth: Record<string, MonthlySizeCell> }[];
}

/**
 * Помесячная динамика по размерам: не упал ли спрос.
 *
 * По одной цифре за 30 дней этого не увидеть. Смотреть надо пару
 * «выручка + ДРР»: если выручка падает, а ДРР растёт — размер теряет спрос,
 * и реклама его больше не вытягивает.
 */
export const fetchMonthlyReport = async (
  marketplace: string,
  months = 6,
): Promise<MonthlyReport> => {
  const res = await fetch(
    `${UNIT_ECONOMICS_URL}?action=monthly&marketplace=${marketplace}&months=${months}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить отчёт по месяцам');
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

const AD_SPEND_URL = 'https://functions.poehali.dev/29442dba-b5a9-4e15-b9ba-5fdc52eef574';

const postAd = async (payload: Record<string, unknown>) => {
  const res = await fetch(AD_SPEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const fetchAdSpend = async (
  actorId?: number,
): Promise<{ totals: AdSpendTotal[]; itemsWithSpend: Record<string, number> }> => {
  const res = await fetch(`${AD_SPEND_URL}?action=status&actorId=${actorId ?? ''}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить');
  return { totals: data.totals || [], itemsWithSpend: data.itemsWithSpend || {} };
};

/**
 * Тянет фактические траты на рекламу с площадки.
 *
 * OZON считается одним запросом. Wildberries — в несколько приёмов: у него
 * десятки кампаний, и каждая требует отдельного обращения к площадке, а у
 * функции всего пять секунд. Поэтому идём шагами, пока не кончатся кампании,
 * и только потом считаем процент.
 */
export const syncAdSpend = async (
  marketplace: 'ozon' | 'wildberries',
  actorId?: number,
  onProgress?: (stage: string) => void,
): Promise<{ percent: number | null; spend: number; revenue: number }> => {
  if (marketplace === 'ozon') {
    onProgress?.('Считаем траты на рекламу…');
    const d = await postAd({ action: 'sync', marketplace, actorId });
    if (!d.ok) throw new Error(d.error || 'Не удалось посчитать');
    return { percent: d.percent, spend: d.spend, revenue: d.revenue };
  }

  let spend = 0;
  for (let step = 0; step < 12; step += 1) {
    onProgress?.(`Собираем рекламные кампании… (${step + 1})`);
    const d = await postAd({
      action: 'sync', marketplace, actorId, stage: 'spend', step,
    });
    if (!d.ok) throw new Error(d.error || 'Не удалось получить расходы');
    spend = d.spend || spend;
    if (d.done) break;
  }

  onProgress?.('Считаем долю рекламы в выручке…');
  const r = await postAd({
    action: 'sync', marketplace, actorId, stage: 'revenue', totalSpend: spend,
  });
  if (!r.ok) throw new Error(r.error || 'Не удалось посчитать процент');
  return { percent: r.percent, spend, revenue: r.revenue };
};

/** Подтягивает номера товаров WB — без них рекламу не разнести по позициям. */
export const syncWbNmIds = async (actorId?: number): Promise<number> => {
  let cursor: unknown = null;
  let total = 0;
  for (let i = 0; i < 15; i += 1) {
    const d = await postAd({ action: 'sync_nm_ids', actorId, cursor });
    total += d.saved || 0;
    cursor = d.cursor;
    if (d.done) break;
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