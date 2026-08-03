const OZON_FBS_URL = 'https://functions.poehali.dev/c1ec58fb-3291-4827-a469-11a1e7019684';

export interface OzonUnmatchedOrder {
  postingNumber: string;
  ozonSku: number | null;
  offerId: string | null;
}

export interface OzonSyncResult {
  created: number;
  skippedExisting: number;
  skippedNoItem: number;
  totalFromOzon: number;
  unmatched: OzonUnmatchedOrder[];
  createdNumbers: string[];
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(OZON_FBS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка OZON');
  }
  return data;
};

export const syncOzonOrders = (actor?: {
  id?: number | null;
  name?: string | null;
}): Promise<OzonSyncResult> =>
  post({ action: 'sync_orders', actorId: actor?.id, actorName: actor?.name }) as Promise<OzonSyncResult>;

export const refreshOzonStatus = (
  postingNumber: string
): Promise<{ postingNumber: string; ozonStatus: string | null }> =>
  post({ action: 'refresh_status', postingNumber }) as Promise<{
    postingNumber: string;
    ozonStatus: string | null;
  }>;
