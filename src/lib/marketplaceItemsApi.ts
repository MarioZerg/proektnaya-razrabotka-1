const ITEMS_URL = 'https://functions.poehali.dev/9959a7b8-9bf6-4fbe-8170-68cc9e031f77';

export interface MarketplaceItem {
  id: number;
  name: string;
  article: string | null;
  width: number | null;
  height: number | null;
  ozonSku: string | null;
  wbSku: string | null;
  material: string | null;
  barcode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceItemMaterial {
  id: number;
  materialId: number | null;
  materialName: string | null;
  unit: string | null;
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
  article?: string;
  width?: number;
  height?: number;
  ozonSku?: string;
  wbSku?: string;
  material?: string;
  barcode?: string;
}) => postAction({ action: 'create', ...payload });

export const updateMarketplaceItem = (
  id: number,
  fields: Partial<{
    name: string;
    article: string;
    width: number;
    height: number;
    ozonSku: string;
    wbSku: string;
    material: string;
    barcode: string;
  }>
) => postAction({ action: 'update', id, ...fields });

export const deleteMarketplaceItem = (id: number) => postAction({ action: 'delete', id });

const SYNC_URL = 'https://functions.poehali.dev/f43a35f0-f914-443a-92c0-fc08a2a09fa4';

export interface SyncResult {
  created: number;
  ozonCards: number;
  wbCards: number;
  totalArticles: number;
  skipped: number;
  warnings: string[];
}

/** Синхронизация карточек товаров из OZON и Wildberries — добавляет новые в справочник. */
export const syncMarketplaceItems = async (): Promise<SyncResult> => {
  const res = await fetch(SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sync' }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка синхронизации');
  }
  return data;
};

export const setMarketplaceItemMaterials = (
  itemId: number,
  materials: Array<{ materialId: number; quantity: number }>
) => postAction({ action: 'set_materials', itemId, materials });