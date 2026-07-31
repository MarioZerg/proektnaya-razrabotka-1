const ORDERS_URL = 'https://functions.poehali.dev/1d8ed922-bded-4f5a-a367-a0742711203a';

export type OrderStatus = 'Новый' | 'В работе' | 'Выполнен' | 'Отменён';
export type OrderType = 'FBO' | 'FBS' | 'Индивидуальный';
export type Marketplace = 'OZON' | 'WB' | 'Yandex';

export interface Order {
  id: number;
  orderNumber: string;
  marketplace: Marketplace;
  orderType: OrderType;
  status: OrderStatus;
  cluster: string | null;
  product: string;
  quantity: number;
  source: 'manual' | 'api';
  createdAt: string;
  completedAt: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  sewingStatus: string;
  assignedUserId: number | null;
  assignedUserName: string | null;
  workshopId: number | null;
  workshopName: string | null;
}

export const fetchOrders = async (): Promise<Order[]> => {
  const res = await fetch(ORDERS_URL);
  const data = await res.json();
  return data.orders || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(ORDERS_URL, {
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

export const createManualOrder = (order: {
  orderNumber: string;
  marketplace: Marketplace;
  orderType: OrderType;
  cluster?: string;
  product: string;
}) => postAction({ action: 'create_manual', ...order });

export const updateOrder = (
  id: number,
  fields: Partial<{
    orderNumber: string;
    marketplace: Marketplace;
    orderType: OrderType;
    status: OrderStatus;
    product: string;
  }>
) => postAction({ action: 'update_order', id, ...fields });

export const deleteOrder = (id: number) => postAction({ action: 'delete_order', id });