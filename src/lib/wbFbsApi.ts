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

export const syncWbOrders = async (actor?: {
  id?: number | null;
  name?: string | null;
}): Promise<WbSyncResult> => {
  const data = await post({ action: 'sync_orders', actorId: actor?.id, actorName: actor?.name });
  return data as WbSyncResult;
};

export interface WbCreateSupplyResult {
  wbSupplyId: string;
  alreadyCreated?: boolean;
}

export const createWbSupply = (supplyId: number): Promise<WbCreateSupplyResult> =>
  post({ action: 'create_supply', supplyId }) as Promise<WbCreateSupplyResult>;

export const scanWbOrderToSupply = (
  supplyId: number,
  orderNumber: string
): Promise<{ success: true; orderNumber: string; product: string }> =>
  post({ action: 'scan_order_to_supply', supplyId, orderNumber }) as Promise<{
    success: true;
    orderNumber: string;
    product: string;
  }>;

export const removeWbOrderFromSupply = (
  supplyId: number,
  orderId: number
): Promise<{ success: true; orderNumber: string }> =>
  post({ action: 'remove_order_from_supply', supplyId, orderId }) as Promise<{
    success: true;
    orderNumber: string;
  }>;

export const deliverWbSupply = (
  supplyId: number
): Promise<{ success: true; stickersSaved: number; sandbox: boolean }> =>
  post({ action: 'deliver_supply', supplyId }) as Promise<{
    success: true;
    stickersSaved: number;
    sandbox: boolean;
  }>;
/** Маркетплейсный стикер WB на вещь FBS (PNG 58×40 в base64). */
export const fetchWbLabel = async (orderNumber: string): Promise<string> => {
  const data = (await post({ action: 'label', orderNumber })) as { pngBase64: string };
  return data.pngBase64;
};

/** Отменённый заказ из сборки — убрать с WB и положить на полку склада. */
export const shelfCancelledOrder = (
  supplyId: number,
  orderId: number
): Promise<{ success: true; orderNumber: string; storageBarcode: string }> =>
  post({ action: 'shelf_cancelled_order', supplyId, orderId }) as Promise<{
    success: true;
    orderNumber: string;
    storageBarcode: string;
  }>;

/** Заказ, собранный упаковщицей и ждущий в свободной поставке. */
export interface WbPendingOrder {
  orderId: number;
  orderNumber: string;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  fromSupplyId: number;
  fromSupplyNumber: string | null;
}

/** Заказы, накопленные упаковщицами при печати стикеров, — их можно забрать в поставку. */
export const fetchWbPendingOrders = (
  supplyId?: number
): Promise<{ orders: WbPendingOrder[]; count: number }> =>
  post({ action: 'list_pending_orders', supplyId }) as Promise<{
    orders: WbPendingOrder[];
    count: number;
  }>;

/** Переносит выбранные накопленные заказы в поставку кладовщика. */
export const moveWbOrdersToSupply = (
  supplyId: number,
  orderIds: number[]
): Promise<{ moved: number; errors: string[] }> =>
  post({ action: 'move_orders_to_supply', supplyId, orderIds }) as Promise<{
    moved: number;
    errors: string[];
  }>;
