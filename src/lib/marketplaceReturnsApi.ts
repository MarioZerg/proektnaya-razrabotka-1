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
  /** Наш статус: new — ждёт решения админа, approved — одобрен и едет к нам,
   * processed — вещь приехала и обработана кладовщиком, rejected — заявка отклонена. */
  status: 'new' | 'approved' | 'processed' | 'rejected';
  /** Судьба вещи после осмотра кладовщиком. */
  outcome: 'utilized' | 'repack' | 'stored' | null;
  damageNote: string | null;
  returnBarcode: string | null;
  outcomeAt: string | null;
  outcomeByName: string | null;
  /** Кто делал эту вещь — заполняется при сканировании внутреннего стикера TR{id}. */
  sewerName?: string | null;
  cutterName?: string | null;
  packerName?: string | null;
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
}): Promise<{
  returns: MarketplaceReturn[];
  counts: Record<string, number>;
  outcomes: Record<string, number>;
}> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.marketplace) params.set('marketplace', filters.marketplace);
  const qs = params.toString();
  const res = await fetch(qs ? `${RETURNS_URL}?${qs}` : RETURNS_URL);
  const data = await res.json();
  return {
    returns: data.returns || [],
    counts: data.counts || {},
    outcomes: data.outcomes || {},
  };
};

/** Строка отчёта: сколько швея отшила и сколько из этого вернулось. */
export interface ReturnsBySewer {
  sewerName: string;
  cutterName: string;
  total: number;
  utilized: number;
  repack: number;
  stored: number;
  madeTotal: number;
  /** Процент возвратов от отшитого. null — объём за период неизвестен. */
  returnRate: number | null;
}

export interface ReturnReasonStat {
  reason: string;
  count: number;
}

/** Отчёт по возвратам: разрез по швеям и топ причин возврата. */
export const fetchReturnsReport = async (
  days = 90
): Promise<{ bySewer: ReturnsBySewer[]; reasons: ReturnReasonStat[] }> => {
  const res = await fetch(`${RETURNS_URL}?report=1&days=${days}`);
  const data = await res.json();
  return { bySewer: data.bySewer || [], reasons: data.reasons || [] };
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

/** Админ одобряет заявку: вещь поедет к нам и появится у кладовщика в приёмке. */
export const approveMarketplaceReturn = (id: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'approve', id, actorId, actorName, actorRole: 'admin' });

/** Админ отклоняет заявку на возврат. */
export const rejectMarketplaceReturn = (id: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'reject', id, actorId, actorName, actorRole: 'admin' });

/** Кладовщик сканирует стикер возврата с коробки — система находит заявку. */
export const scanMarketplaceReturn = (code: string): Promise<{ return: MarketplaceReturn }> =>
  postAction({ action: 'scan', code });

/** Судьба вещи после осмотра: утилизация, перепаковка в цехе или сразу на полку. */
export const processMarketplaceReturn = (payload: {
  id: number;
  outcome: 'utilized' | 'repack' | 'stored';
  damageNote?: string;
  actorId?: number;
  actorName?: string;
  /** Полка, если кладовщик кладёт вещь сразу — тогда отдельная укладка не нужна. */
  shelfId?: number | null;
}): Promise<{
  outcome: string;
  storageBarcode: string | null;
  needsManualOrder: boolean;
  shelfName: string | null;
  placedOnShelf: boolean;
}> => postAction({ action: 'process', ...payload });
