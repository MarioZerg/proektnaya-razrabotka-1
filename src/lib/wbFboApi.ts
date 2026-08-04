const WB_FBS_URL = 'https://functions.poehali.dev/142096e2-0171-412b-b6df-1631cb52574a';

export interface WbWarehouse {
  id: number | null;
  name: string;
  address: string;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(WB_FBS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка WildBerries');
  }
  return data;
};

/** Список складов приёмки FBO WildBerries — для выпадающего списка выбора склада. */
export const fetchWbWarehouses = async (): Promise<WbWarehouse[]> => {
  const data = await post({ action: 'list_warehouses' });
  return (data.warehouses || []) as WbWarehouse[];
};
