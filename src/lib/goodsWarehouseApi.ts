const GOODS_WAREHOUSE_URL = 'https://functions.poehali.dev/370fdff8-7cae-4cc7-a853-b664f3da61cf';

export type GoodsStatus = 'in_stock' | 'shipped';

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
}

export const fetchGoodsWarehouse = async (status?: GoodsStatus): Promise<GoodsWarehouseItem[]> => {
  const url = status ? `${GOODS_WAREHOUSE_URL}?status=${status}` : GOODS_WAREHOUSE_URL;
  const res = await fetch(url);
  const data = await res.json();
  return data.items || [];
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

export const moveGoodsShelf = (id: number, shelfId: number | null) =>
  postAction({ action: 'move_shelf', id, shelfId });

export const returnGoodsToWorkshop = (id: number) => postAction({ action: 'return_to_workshop', id });
