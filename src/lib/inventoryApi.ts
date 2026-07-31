const INVENTORY_URL = 'https://functions.poehali.dev/0c96a548-215d-445d-863a-988abeea9a23';

export interface InventoryItem {
  id: number;
  categoryId: number;
  name: string;
  quantity: string;
  rolls: string;
  status: string;
  sortOrder: number;
}

export interface InventoryCategory {
  id: number;
  name: string;
  tab: string;
  sortOrder: number;
  items: InventoryItem[];
}

export const fetchCategories = async (tab?: string): Promise<InventoryCategory[]> => {
  const url = tab ? `${INVENTORY_URL}?tab=${encodeURIComponent(tab)}` : INVENTORY_URL;
  const res = await fetch(url);
  const data = await res.json();
  return data.categories || [];
};

export const createCategory = async (name: string, tab: string) => {
  const res = await fetch(INVENTORY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_category', name, tab }),
  });
  return res.json();
};

export const createItem = async (
  categoryId: number,
  name: string,
  quantity: string,
  rolls: string,
  status: string
) => {
  const res = await fetch(INVENTORY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_item', categoryId, name, quantity, rolls, status }),
  });
  return res.json();
};
