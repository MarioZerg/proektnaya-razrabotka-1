const PRODUCT_COST_URL = 'https://functions.poehali.dev/7e85cd3d-e5cd-44e2-a803-5ff07584de12';

/** POEHALI: себестоимость. FRONTEND-ONLY: сбой GET не писать как «тканей не найдено». */

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
  /** Откуда взята цена: последняя поставка, прайс поставщика или нигде. */
  priceSource: 'supplier' | 'rolls' | 'supply' | 'none';
  /** Последняя приёмка, из которой взята цена. */
  shipmentId?: number | null;
  shipmentDate?: string | null;
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
  /** Надбавка на недостачи материалов: обрезки, брак, пересорт. */
  shortageCost?: number;
  /** Процент, по которому посчитана надбавка. */
  shortagePercent?: number;
  cutCost: number;
  sewCost: number;
  packWorkCost: number;
  /** Оклады из «Финансов» на одну изготовленную вещь — часть работы цеха. */
  salariedCost?: number;
  laborCost: number;
  overhead: number;
  /** Из чего сложились прочие расходы: ручные статьи. */
  overheadExtra?: number;
  /** Во сколько вещь обходится цеху. Без налога и комиссии площадки. */
  total: number;
  /** Постоянные расходы на вещь для маркетплейсов (оклады + прочие). */
  mpFixed?: number;
  /** Постоянные расходы на вещь для интернет-магазина. */
  siteFixed?: number;
  /** Себестоимость для интернет-магазина. */
  siteTotal?: number;
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
  /** all — все каналы; marketplaces — только маркетплейсы; site — только интернет-магазин. */
  channel?: ExpenseChannel;
  /** Ежемесячная сумма (аренда, оклад) — зависит от объёма продаж. */
  isMonthly?: boolean;
}

export type ExpenseChannel = 'all' | 'marketplaces' | 'site';

export interface CostSettings {
  overheadPerItem: number;
  workshopId: number | null;
  /** Надбавка на недостачи материалов, % от стоимости ткани и упаковки. */
  shortagePercent?: number;
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

/** Оклады из «Финансов» за прошлый месяц, поделённые на изготовленные вещи. */
export interface SalariedCost {
  month: string;
  total: number;
  madeUnits: number;
  perUnit: number;
  parts: { type: string; label: string; amount: number }[];
}

export interface CostResponse {
  settings: CostSettings;
  groups: CostGroup[];
  extras: ExtraExpense[];
  workshops: { id: number; name: string }[];
  sold: SoldUnits;
  salaried?: SalariedCost;
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
  channel?: ExpenseChannel;
  isMonthly?: boolean;
  actorId?: number;
}) => post({ action: 'add_expense', ...payload });

export const updateExtraExpense = (payload: {
  id: number;
  name: string;
  amount: number;
  perItems: number;
  note?: string | null;
  isActive: boolean;
  channel?: ExpenseChannel;
  isMonthly?: boolean;
  actorId?: number;
}) => post({ action: 'update_expense', ...payload });

export const deleteExtraExpense = (id: number, actorId?: number) =>
  post({ action: 'delete_expense', id, actorId });

/** Пока облачная функция не отдаёт поставки — собираем их из приёмок. */
