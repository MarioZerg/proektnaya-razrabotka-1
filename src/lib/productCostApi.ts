const PRODUCT_COST_URL = 'https://functions.poehali.dev/7e85cd3d-e5cd-44e2-a803-5ff07584de12';

/** Один материал в составе изделия. */
export interface CostMaterial {
  materialId: number;
  name: string;
  /** «Тюль», «Аксессуары», «Упаковка». */
  typeName: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
  sum: number;
  /** Откуда взята цена: прайс поставщика, рулоны на складе или нигде. */
  priceSource: 'supplier' | 'rolls' | 'none';
}

/**
 * Себестоимость сочетания «ткань + ширина».
 *
 * Высота изделия на себестоимость не влияет — кроят, обшивают тесьмой и пакуют
 * по ширине. Поэтому одна такая запись закрывает весь ряд высот.
 */
export interface CostGroup {
  material: string | null;
  width: number | null;
  /** Сколько карточек товара закрывает эта запись (все высоты). */
  productsCount: number;
  materials: CostMaterial[];
  fabricCost: number;
  trimCost: number;
  packCost: number;
  materialsCost: number;
  cutCost: number;
  sewCost: number;
  packWorkCost: number;
  laborCost: number;
  overhead: number;
  /** Во сколько вещь обходится цеху. Без налога и комиссии площадки. */
  total: number;
  /** Чего не хватает для честной цифры. */
  missing: string[];
}

/** Статья дополнительных расходов: сумма, поделённая на число вещей. */
export interface ExtraExpense {
  id: number;
  name: string;
  amount: number;
  perItems: number;
  note: string | null;
  isActive: boolean;
  /** Сколько ложится на одну вещь. */
  perUnit: number;
}

export interface CostSettings {
  overheadPerItem: number;
  workshopId: number | null;
}

/** Продажи одной площадки за период, с разбивкой по схемам. */
export interface SoldByMarketplace {
  marketplace: string;
  /** Продано по факту получения денег, за вычетом возвратов. */
  net: number;
  /** Со склада площадки — товар уходит покупателю без нашего участия. */
  fbo: number;
  /** Со своего склада: собираем и отправляем сами. */
  fbs: number;
  /** Доставлено покупателю — до вычета возвратов. */
  delivered: number;
  /** Вернулось обратно: возвраты, отмены, невыкупы. */
  returned: number;
  /**
   * Откуда цифра: 'marketplace' — из финансовых операций площадки (видны обе
   * схемы), 'orders' — из наших заказов, там только FBS.
   */
  source: 'marketplace' | 'orders';
}

/** Сколько вещей реально продано — подсказка для делителя расходов. */
export interface SoldUnits {
  days: number;
  total: number;
  byMarketplace: SoldByMarketplace[];
}

/** Вознаграждение менеджера маркетплейсов за прошлый месяц. */
export interface ManagerCommission {
  percent: number;
  isActive: boolean;
  comment: string | null;
  /** Первое число месяца, за который считаем. */
  month: string;
  monthEnd: string;
  /** Сколько отчётов площадки попало в расчёт. */
  periods: number;
  /** Начислено по отчётам — база процента. */
  accrued: number;
  /** Удержано досрочными выплатами: на процент не влияет. */
  earlyPayout: number;
  payout: number;
  /** Сколько это на одну проданную вещь. */
  perUnit: number | null;
  /** Периоды с перерасчётом площадки — они раздувают базу. */
  oddPeriods: number;
  oddAmount: number;
  /** Сколько вышло бы без перерасчётов. */
  payoutWithoutOdd: number | null;
}

export interface CostResponse {
  settings: CostSettings;
  groups: CostGroup[];
  extras: ExtraExpense[];
  workshops: { id: number; name: string }[];
  sold: SoldUnits;
  manager: ManagerCommission | null;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(PRODUCT_COST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const fetchProductCosts = async (): Promise<CostResponse> => {
  const res = await fetch(PRODUCT_COST_URL);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить расчёт');
  return data;
};

export const saveCostSettings = (settings: CostSettings & { actorId?: number }) =>
  post({ action: 'save_settings', ...settings });

export const addExtraExpense = (payload: {
  name: string;
  amount: number;
  perItems: number;
  note?: string;
  actorId?: number;
}) => post({ action: 'add_expense', ...payload });

export const updateExtraExpense = (payload: {
  id: number;
  name: string;
  amount: number;
  perItems: number;
  note?: string | null;
  isActive: boolean;
  actorId?: number;
}) => post({ action: 'update_expense', ...payload });

export const deleteExtraExpense = (id: number, actorId?: number) =>
  post({ action: 'delete_expense', id, actorId });

export const saveManagerCommission = (payload: {
  percent: number;
  isActive: boolean;
  comment?: string;
  actorId?: number;
}) => post({ action: 'save_manager', ...payload });
