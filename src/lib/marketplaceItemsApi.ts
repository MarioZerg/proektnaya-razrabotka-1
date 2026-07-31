const ITEMS_URL = 'https://functions.poehali.dev/9959a7b8-9bf6-4fbe-8170-68cc9e031f77';

export interface MarketplaceItem {
  id: number;
  name: string;
  sku: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceItemMaterial {
  id: number;
  workshopId: number | null;
  workshopName: string | null;
  materialId: number | null;
  materialName: string | null;
  quantity: number;
}

export interface MarketplaceItemDetail extends MarketplaceItem {
  materials: MarketplaceItemMaterial[];
}

export const fetchMarketplaceItems = async (): Promise<MarketplaceItem[]> => {
  const res = await fetch(ITEMS_URL);
  const data = await res.json();
  return data.items || [];
};

export const fetchMarketplaceItemDetail = async (id: number): Promise<MarketplaceItemDetail> => {
  const res = await fetch(`${ITEMS_URL}?id=${id}`);
  const data = await res.json();
  return data.item;
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(ITEMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const createMarketplaceItem = (payload: {
  name: string;
  sku?: string;
  material?: string;
  width?: number;
  height?: number;
}) => postAction({ action: 'create', ...payload });

export const updateMarketplaceItem = (
  id: number,
  fields: Partial<{ name: string; sku: string; material: string; width: number; height: number }>
) => postAction({ action: 'update', id, ...fields });

export const deleteMarketplaceItem = (id: number) => postAction({ action: 'delete', id });

export const setMarketplaceItemMaterials = (
  itemId: number,
  materials: Array<{ workshopId: number | null; materialId: number | null; quantity: number }>
) => postAction({ action: 'set_materials', itemId, materials });
