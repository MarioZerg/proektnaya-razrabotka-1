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
  tax: number;
  commission: number;
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
  taxPercent: number;
  marketplacePercent: number;
  overheadPerItem: number;
  workshopId: number | null;
}

export interface CostResponse {
  settings: CostSettings;
  groups: CostGroup[];
  extras: ExtraExpense[];
  workshops: { id: number; name: string }[];
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
