const SUPPLIES_URL = 'https://functions.poehali.dev/d0a75e82-2c63-440c-8eae-dd036df61fac';

export interface Supply {
  id: number;
  marketplace: string;
  status: string;
  comment: string | null;
  createdAt: string;
  shippedAt: string | null;
  itemsCount: number;
}

export interface SupplyItem {
  id: number;
  goodsWarehouseId: number;
  orderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
}

export interface SupplyDetail extends Supply {
  items: SupplyItem[];
}

export const fetchSupplies = async (): Promise<Supply[]> => {
  const res = await fetch(SUPPLIES_URL);
  const data = await res.json();
  return data.supplies || [];
};

export const fetchSupplyDetail = async (id: number): Promise<SupplyDetail> => {
  const res = await fetch(`${SUPPLIES_URL}?id=${id}`);
  const data = await res.json();
  return data.supply;
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SUPPLIES_URL, {
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

export const createSupply = (payload: { marketplace: string; comment?: string; goodsWarehouseIds: number[] }) =>
  postAction({ action: 'create', ...payload });

export const deleteSupply = (id: number) => postAction({ action: 'delete', id });
