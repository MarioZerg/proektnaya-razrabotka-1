const GOODS_WAREHOUSE_URL = 'https://functions.poehali.dev/370fdff8-7cae-4cc7-a853-b664f3da61cf';

export type GoodsStatus = 'in_stock' | 'picking' | 'reserved' | 'shipped' | 'lost';

export interface GoodsWarehouseItem {
  id: number;
  orderId: number;
  orderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  shelfId: number | null;
  shelfName: string | null;
  status: GoodsStatus;
  receivedAt: string;
  shippedAt: string | null;
  storageBarcode: string;
  lostReason: string | null;
  lostAt: string | null;
}

export interface GoodsWarehouseFilters {
  status?: GoodsStatus | 'all';
  material?: string;
  width?: number;
  height?: number;
  shelfId?: number;
}

export const fetchGoodsWarehouse = async (
  filters?: GoodsStatus | GoodsWarehouseFilters
): Promise<GoodsWarehouseItem[]> => {
  const f: GoodsWarehouseFilters = typeof filters === 'string' ? { status: filters } : filters || {};
  const params = new URLSearchParams();
  if (f.status && f.status !== 'all') params.set('status', f.status);
  if (f.material) params.set('material', f.material);
  if (f.width) params.set('width', String(f.width));
  if (f.height) params.set('height', String(f.height));
  if (f.shelfId) params.set('shelf_id', String(f.shelfId));
  const qs = params.toString();
  const res = await fetch(qs ? `${GOODS_WAREHOUSE_URL}?${qs}` : GOODS_WAREHOUSE_URL);
  const data = await res.json();
  return data.items || [];
};

export const fetchGoodsByBarcode = async (barcode: string): Promise<GoodsWarehouseItem> => {
  const res = await fetch(`${GOODS_WAREHOUSE_URL}?barcode=${encodeURIComponent(barcode)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Товар не найден');
  }
  return data.item;
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(GOODS_WAREHOUSE_URL, {
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

export const receiveGoods = (orderId: number, shelfId?: number) =>
  postAction({ action: 'receive', orderId, shelfId });

// Приём возврата с маркетплейса по номеру заказа (ручной ввод, до появления API-интеграции).
// Если заказ уже был на складе (даже отгружен ранее) — та же запись возвращается в "На хранении".
export const receiveReturn = (orderNumber: string, shelfId?: number) =>
  postAction({ action: 'receive_return', orderNumber, shelfId });

export const groupReceiveGoods = (orderIds: number[], shelfId?: number) =>
  postAction({ action: 'group_receive', orderIds, shelfId });

export const moveGoodsShelf = (id: number, shelfId: number | null) =>
  postAction({ action: 'move_shelf', id, shelfId });

export const moveGoodsShelfByBarcode = (barcode: string, shelfId: number | null) =>
  postAction({ action: 'move_shelf_by_barcode', barcode, shelfId });

export const returnGoodsToWorkshop = (id: number) => postAction({ action: 'return_to_workshop', id });

// Сканер подбора: отмечает товар (по штрихкоду хранения) как нужный для будущей поставки FBS.
export const startPicking = (barcode: string) => postAction({ action: 'start_picking', barcode });

export const cancelPicking = (id: number) => postAction({ action: 'cancel_picking', id });

export const markGoodsLost = (id: number, reason: string) =>
  postAction({ action: 'mark_lost', id, reason });
