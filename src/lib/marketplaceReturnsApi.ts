const RETURNS_URL = 'https://functions.poehali.dev/015dbb02-13c9-49de-8718-8fe37c329b30';

/** Заявка на возврат, загруженная с маркетплейса по API. */
export interface MarketplaceReturn {
  id: number;
  marketplace: string;
  externalId: string;
  postingNumber: string | null;
  offerId: string | null;
  productName: string | null;
  quantity: number;
  /** Статус возврата на стороне маркетплейса (как его показывает OZON/WB). */
  mpStatus: string | null;
  returnReason: string | null;
  /** Наш статус обработки: new — ждёт приёмки, received — принят, rejected — не приехал. */
  status: 'new' | 'received' | 'rejected';
  mpCreatedAt: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  storageBarcode: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  orderNumber: string | null;
}

export interface ReturnsSyncResult {
  created: number;
  updated: number;
  error: string | null;
}

export const fetchMarketplaceReturns = async (filters?: {
  status?: string;
  marketplace?: string;
}): Promise<{ returns: MarketplaceReturn[]; counts: Record<string, number> }> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.marketplace) params.set('marketplace', filters.marketplace);
  const qs = params.toString();
  const res = await fetch(qs ? `${RETURNS_URL}?${qs}` : RETURNS_URL);
  const data = await res.json();
  return { returns: data.returns || [], counts: data.counts || {} };
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(RETURNS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

/** Загрузить свежие заявки на возврат с OZON и Wildberries. */
export const syncMarketplaceReturns = (
  days: number,
  actorId?: number,
  actorName?: string
): Promise<{
  ozon: ReturnsSyncResult;
  wildberries: ReturnsSyncResult;
  created: number;
}> => postAction({ action: 'sync', days, actorId, actorName });

/** Возврат физически доехал — заводим вещь на склад в очередь «Ждёт полку». */
export const receiveMarketplaceReturn = (
  id: number,
  actorId?: number,
  actorName?: string
): Promise<{ storageBarcode: string | null; needsManualOrder: boolean }> =>
  postAction({ action: 'receive', id, actorId, actorName });

/** Возврат не приехал или отменён маркетплейсом. */
export const rejectMarketplaceReturn = (id: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'reject', id, actorId, actorName });
