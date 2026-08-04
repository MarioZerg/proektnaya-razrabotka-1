const ORDERS_URL = 'https://functions.poehali.dev/1d8ed922-bded-4f5a-a367-a0742711203a';

export type OrderStatus = 'Новый' | 'В работе' | 'Выполнен' | 'Отменён';
export type OrderType = 'FBO' | 'FBS' | 'Индивидуальный';
export type Marketplace = 'OZON' | 'WB' | 'Yandex';
export type SewingStatus = 'Новый' | 'На раскрое' | 'Раскроено' | 'В работе' | 'Стикеровка' | 'Готовые';

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
  /** Кто раскроил заказ — отдельно от assignedUserId, который перезаписывается на швею
   * при take_order. Заполняется в момент раскроя (action 'cut') и дальше не меняется. */
  cutterUserId: number | null;
  cutterUserName: string | null;
  /** Кто отшил заказ — заполняется при отправке на стикеровку (action 'send_to_stickering')
   * и дальше не меняется, аналогично cutterUserId. */
  sewerUserId: number | null;
  sewerUserName: string | null;
  /** Кто упаковал (закрыл) заказ на терминале стикеровки — заполняется при закрытии
   * заказа (backend/kiosk, action 'close_order') и дальше не меняется. */
  packerUserId: number | null;
  packerUserName: string | null;
  /** Номер вешалки, на которую подвешен раскроенный товар. 0 = не назначена (заполняется
   * через отдельную вкладку "Вешалки", ещё не реализована). */
  hangerNumber: number;
  /** Статус отправления на стороне OZON (только чтение, для FBS-заказов OZON). */
  ozonStatus?: string | null;
  ozonPostingNumber?: string | null;
  /** Штрихкод товара маркетплейса (из справочника, фиксируется при импорте OZON FBO) —
   * печатается на стикере FBO сшитого товара. */
  productBarcode?: string | null;
  /** OZON SKU товара (из справочника) — именно по нему товар добавляется в поставку FBO OZON,
   * поэтому на стикере OZON печатается он (OZN + ozonSku), а не штрихкод. */
  productOzonSku?: string | null;
}

export interface OrderMaterialUsage {
  id: number;
  materialId: number;
  materialName: string | null;
  unit: string | null;
  rollId: number | null;
  rollBarcode: string | null;
  quantity: number;
  createdAt: string;
}

export interface OrderDetail extends Order {
  materialUsage: OrderMaterialUsage[];
  requiredFabricMaterialId: number | null;
  requiredFabricMaterialName: string | null;
  requiredTrimMaterialId: number | null;
  requiredTrimMaterialName: string | null;
  /** Товар справочника, к которому привязан заказ — определяет штрихкод для стикера FBO. */
  marketplaceItemId: number | null;
  /** Последняя вешалка, выбранная закройщиком заказа — подставляется по умолчанию при раскрое. */
  lastHangerNumber: number | null;
}

export const fetchOrders = async (): Promise<Order[]> => {
  const res = await fetch(ORDERS_URL);
  const data = await res.json();
  return data.orders || [];
};

export const fetchOrderDetail = async (id: number): Promise<OrderDetail> => {
  const res = await fetch(`${ORDERS_URL}?id=${id}`);
  const data = await res.json();
  return data.order;
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
  marketplace: Marketplace;
  orderType: OrderType;
  cluster?: string;
  marketplaceItemId: number;
}) => postAction({ action: 'create_manual', ...order });

export const updateOrder = (
  id: number,
  fields: Partial<{
    orderNumber: string;
    marketplace: Marketplace;
    orderType: OrderType;
    status: OrderStatus;
    product: string;
    sewingStatus: SewingStatus;
    assignedUserId: number | null;
    workshopId: number | null;
    marketplaceItemId: number | null;
    actorId: number;
  }>
) => postAction({ action: 'update_order', id, ...fields });

export const cutOrder = (id: number, rollId?: number, hangerNumber?: number) =>
  postAction({ action: 'cut', id, rollId, hangerNumber });

export const deleteOrder = (id: number) => postAction({ action: 'delete_order', id });

export interface TakenOrder {
  id: number;
  orderNumber: string;
  orderType: OrderType;
  marketplace: Marketplace;
  material: string | null;
  width: number | null;
  height: number | null;
}

export interface TakeStackResult {
  success: true;
  count: number;
  orderIds: number[];
  orders: TakenOrder[];
}

export const takeStack = (userId: number, workshopId: number, shiftNumber?: number | null): Promise<TakeStackResult> =>
  postAction({ action: 'take_stack', userId, workshopId, shiftNumber });

export interface TakeOrderResult {
  success: true;
  orderId: number;
}

export const takeOrder = (userId: number): Promise<TakeOrderResult> =>
  postAction({ action: 'take_order', userId });

export const sendToStickering = (id: number, rollId?: number) =>
  postAction({ action: 'send_to_stickering', id, rollId });

export const cancelOrder = (id: number) => postAction({ action: 'cancel_order', id });