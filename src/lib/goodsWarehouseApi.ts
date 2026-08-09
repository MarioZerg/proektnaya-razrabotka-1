const GOODS_WAREHOUSE_URL = 'https://functions.poehali.dev/370fdff8-7cae-4cc7-a853-b664f3da61cf';

export type GoodsStatus =
  | 'awaiting_shelf'
  | 'in_stock'
  | 'picking'
  | 'reserved'
  | 'shipped'
  | 'lost';

/** Почему товар оказался на складе хранения:
 * cancelled — заказ отменён клиентом (по статусу из API OZON/WB);
 * return — возврат с маркетплейса, принят вручную по номеру заказа;
 * manual — принят вручную (старые записи);
 * admin — администратор добавил вещь на склад вручную по товару из справочника. */
export type ReceiveReason = 'cancelled' | 'return' | 'manual' | 'admin' | 'individual';

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
  receiveReason: ReceiveReason;
  /** Новый заказ маркетплейса, который закрывается этой вещью с полки (автоподбор). */
  reservedOrderId: number | null;
  reservedOrderNumber: string | null;
  /** Когда кладовщик наклеил стикер отправления — после этого можно сканировать в поставку. */
  shippingLabeledAt: string | null;
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

// Приём возврата с маркетплейса по номеру заказа (ручной ввод, до появления API-интеграции).
// Полка не выбирается: вещь встаёт в очередь «Ждёт полку» и попадает на полку только
// сканированием стикера хранения — так товар не окажется не на своём месте.
export const receiveReturn = (orderNumber: string) =>
  postAction({ action: 'receive_return', orderNumber });

/** Ручной приём администратором: вещь без заказа с маркетплейса кладётся на склад по товару
 * из справочника. Такие записи помечаются как принятые админом. */
export const adminReceiveGoods = (marketplaceItemId: number, shelfId?: number) =>
  postAction({ action: 'admin_receive', marketplaceItemId, shelfId }) as Promise<{
    id: number;
    orderNumber: string;
    product: string;
    storageBarcode: string;
    status: string;
  }>;

/** Кладовщик сканирует стикер хранения вещи, отменённой клиентом, и кладёт её на полку. */
export const placeOnShelf = (barcode: string, shelfId: number) =>
  postAction({ action: 'place_on_shelf', barcode, shelfId });

/** Кладовщик наклеил стикер отправления на вещь с полки, подобранную под новый заказ. */
export const shipLabelGoods = (barcode: string) =>
  postAction({ action: 'ship_label', barcode }) as Promise<{
    id: number;
    orderId: number;
    orderNumber: string;
    product: string | null;
    shelfName: string | null;
    storageBarcode: string;
    /** Маркетплейс и тип заказа — по ним печатается нужный стикер. */
    marketplace: string | null;
    orderType: string | null;
  }>;

export const moveGoodsShelfByBarcode = (barcode: string, shelfId: number | null) =>
  postAction({ action: 'move_shelf_by_barcode', barcode, shelfId });

export const returnGoodsToWorkshop = (id: number) => postAction({ action: 'return_to_workshop', id });

// Сканер подбора: отмечает товар (по штрихкоду хранения) как нужный для будущей поставки FBS.
/** Сколько вещей уже подобрано под заказы и ждёт стикера отправления у кладовщика. */
export interface PickingPending {
  pendingLabel: number;
  awaitingShelf: number;
}

export const fetchPickingPending = async (): Promise<PickingPending> => {
  const res = await fetch(`${GOODS_WAREHOUSE_URL}?pending_count=1`);
  const data = await res.json();
  return { pendingLabel: data.pendingLabel || 0, awaitingShelf: data.awaitingShelf || 0 };
};

/** Ручной пересчёт подбора по всему складу — страховка, если что-то не подхватилось. */
export const rematchStock = () =>
  postAction({ action: 'rematch_stock' }) as Promise<{ matched: number }>;

export const startPicking = (barcode: string) => postAction({ action: 'start_picking', barcode });

export const cancelPicking = (id: number) => postAction({ action: 'cancel_picking', id });

export const markGoodsLost = (id: number, reason: string) =>
  postAction({ action: 'mark_lost', id, reason });

/** Вещь испорчена: списываем её со склада, а заказ возвращаем в производство — сошьют заново. */
export const sendGoodsToSewing = (id: number, reason: string) =>
  postAction({ action: 'send_to_sewing', id, reason }) as Promise<{
    success: true;
    returnedOrder: string | null;
  }>;