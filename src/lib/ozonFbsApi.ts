const OZON_FBS_URL = 'https://functions.poehali.dev/c1ec58fb-3291-4827-a469-11a1e7019684';

export interface OzonUnmatchedOrder {
  postingNumber: string;
  ozonSku: number | null;
  offerId: string | null;
}

/** Задвоенное отправление: в системе вещей больше, чем реально прислал OZON. */
export interface OzonDuplicate {
  postingNumber: string;
  /** Сколько вещей должно быть по данным OZON. */
  expected: number;
  /** Сколько числится в системе. */
  actual: number;
}

export interface OzonSyncResult {
  created: number;
  skippedExisting: number;
  skippedNoItem: number;
  totalFromOzon: number;
  unmatched: OzonUnmatchedOrder[];
  createdNumbers: string[];
  /** Непустой список = обнаружено задвоение заказов, нужно вмешательство. */
  duplicates?: OzonDuplicate[];
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

/**
 * Точечная догрузка отправлений OZON по номерам.
 *
 * Обычная синхронизация идёт по ленте маркетплейса и берёт свежие отправления
 * пачками. Если конкретный заказ в неё не попал (сбой связи, отправление
 * появилось задним числом), ждать следующего круга незачем — забираем его
 * адресно. OZON проверяет номер на своей стороне: многовещевое отправление
 * разделится на отдельные задания как при обычной загрузке.
 */
export const pullOzonOrdersByNumbers = (
  numbers: string[],
  actor?: { id?: number | null; name?: string | null },
): Promise<OzonSyncResult> =>
  post({
    action: 'sync_orders',
    postingNumbers: numbers,
    actorId: actor?.id,
    actorName: actor?.name,
  }) as Promise<OzonSyncResult>;

export const refreshOzonStatus = (
  postingNumber: string
): Promise<{ postingNumber: string; ozonStatus: string | null }> =>
  post({ action: 'refresh_status', postingNumber }) as Promise<{
    postingNumber: string;
    ozonStatus: string | null;
  }>;

export const refreshAllOzonStatuses = (): Promise<{
  updated: number;
  checked: number;
  known: number;
}> =>
  post({ action: 'refresh_all_statuses' }) as Promise<{
    updated: number;
    checked: number;
    known: number;
  }>;
/** Маркетплейсный ярлык OZON на отправление FBS (PDF в base64). */
export const fetchOzonLabel = async (orderNumber: string): Promise<string> => {
  const data = await post({ action: 'label', orderNumber });
  return data.pdfBase64;
};