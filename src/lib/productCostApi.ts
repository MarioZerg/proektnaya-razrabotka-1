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

/** Себестоимость одной единицы товара. */
export interface ProductCost {
  id: number;
  name: string;
  width: number | null;
  height: number | null;
  material: string | null;
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

export interface CostSettings {
  taxPercent: number;
  marketplacePercent: number;
  overheadPerItem: number;
  workshopId: number | null;
}

export interface CostResponse {
  settings: CostSettings;
  items: ProductCost[];
  workshops: { id: number; name: string }[];
}

export const fetchProductCosts = async (): Promise<CostResponse> => {
  const res = await fetch(PRODUCT_COST_URL);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить расчёт');
  return data;
};

export const saveCostSettings = async (
  settings: CostSettings & { actorId?: number },
): Promise<void> => {
  const res = await fetch(PRODUCT_COST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save_settings', ...settings }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось сохранить');
};
