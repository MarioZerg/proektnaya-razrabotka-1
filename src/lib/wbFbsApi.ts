const WB_FBS_URL = 'https://functions.poehali.dev/142096e2-0171-412b-b6df-1631cb52574a';

export interface WbUnmatchedOrder {
  wbOrderId: number;
  nmId: number | null;
  article: string | null;
  skus: string[];
}

export interface WbSyncResult {
  created: number;
  skippedExisting: number;
  skippedNoItem: number;
  totalFromWb: number;
  unmatched: WbUnmatchedOrder[];
  createdNumbers: string[];
  sandbox: boolean;
}

export const syncWbOrders = async (actor?: {
  id?: number | null;
  name?: string | null;
}): Promise<WbSyncResult> => {
  const res = await fetch(WB_FBS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sync_orders', actorId: actor?.id, actorName: actor?.name }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось загрузить заказы с WildBerries');
  }
  return data as WbSyncResult;
};
