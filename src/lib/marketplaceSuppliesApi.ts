const SUPPLIES_URL = 'https://functions.poehali.dev/d0a75e82-2c63-440c-8eae-dd036df61fac';

export type SupplyStatus = 'Открытая' | 'На сборке' | 'Отгрузка' | 'Выполнена';
export type SupplyType = 'FBO' | 'FBS';
export type OzonDeliveryMethod = 'direct' | 'cross_docking';
export type PackagingType = 'boxes' | 'pallets';

export const supplyStatusFlow: SupplyStatus[] = ['Открытая', 'На сборке', 'Отгрузка', 'Выполнена'];

export interface Supply {
  id: number;
  marketplace: string;
  type: SupplyType;
  status: SupplyStatus;
  comment: string | null;
  createdAt: string;
  supplyNumber: string | null;
  supplyBarcode: string | null;
  cluster: string | null;
  gazelkaId: string | null;
  shipToGazelkaAt: string | null;
  shipToMarketplaceAt: string | null;
  completedAt: string | null;
  itemsCount: number;
  createdByName: string | null;
  ozonDeliveryMethod: OzonDeliveryMethod | null;
  ozonApplicationNumber: string | null;
  ozonStatus: string | null;
  wbOrdersCount?: number;
}

export interface SupplyItem {
  id: number;
  goodsWarehouseId: number;
  orderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  goodsStatus: string | null;
  shippedAt: string | null;
  boxId: number | null;
  /** Заказ покупателя из нескольких вещей (Яндекс Маркет) — ярлык на них общий. */
  groupKey?: string | null;
  groupSize?: number | null;
  groupPosition?: number | null;
  /** Заказ отменён маркетплейсом уже после стикеровки: отгружать вещь нельзя, она должна
   * уехать на полку хранения и ждать нового покупателя. */
  isCancelled?: boolean;
  storageBarcode?: string | null;
  shelfId?: number | null;
}

export interface SupplyShelf {
  id: number;
  name: string;
}

/** Связка — заказ покупателя из нескольких вещей, которые едут по одному общему ярлыку.
 * Отгрузить такой заказ можно только целиком, поэтому кладовщик должен видеть, где связка
 * собрана, а где ещё нет. */
export interface SupplyGroup {
  groupKey: string;
  total: number;
  inSupply: number;
  isComplete: boolean;
  orderNumbers: string | null;
}

export interface SupplyBox {
  id: number;
  boxNumber: number;
  barcode: string;
  createdAt: string;
  items: SupplyItem[];
  ozonCargoId?: number | null;
  closedAt?: string | null;
  stickerUrl?: string | null;
  stickerName?: string | null;
}

export interface WbSupplyOrder {
  id: number;
  orderId: number;
  orderNumber: string;
  product: string | null;
  wbTrbxId: string | null;
  stickerUrl: string | null;
  stickerName: string | null;
  scannedAt: string | null;
}

export interface SupplyDetail extends Supply {
  items: SupplyItem[];
  /** Связки заказов с общим ярлыком, попавшие в эту поставку. */
  groups?: SupplyGroup[];
  /** Полки склада — для отправки отменённых заказов на хранение прямо из поставки. */
  shelves?: SupplyShelf[];
  boxes: SupplyBox[];
  createdBy: number | null;
  totalQuantityMarketplace: number | null;
  passStickerUrl: string | null;
  passStickerName: string | null;
  supplyDate: string | null;
  timeslot: string | null;
  shipmentType: string | null;
  packagingType: PackagingType | null;
  packagingCount: number | null;
  gazelkaPickup: boolean;
  wbSupplyId: string | null;
  wbOrders: WbSupplyOrder[];
  wbReadyCount: number;
  /** id заявки OZON FBO на стороне OZON (для повторной загрузки товарного состава). */
  ozonSupplyOrderId: number | null;
  /** Тип грузоместа OZON FBO при закрытии коробов: 'BOX' (короб) или 'PALLET' (палета). */
  ozonCargoType: string | null;
  /** id привязанной заявки в сервисе грузоперевозок Газелька (для печати стикеров коробов). */
  gazelkaPlanId: number | null;
  /** IDS (id склада поставки) и IDM для штрихкода упаковочного листа Газельки (ручной ввод). */
  gazelkaIds: number;
  gazelkaIdm: number;
  /** Реквизиты клиента-отправителя для упаковочного листа (общие настройки). */
  gazelkaClientName: string;
  gazelkaClientPhone: string;
}

export interface SupplyFilters {
  status?: string;
  type?: SupplyType;
  marketplace?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export const fetchSupplies = async (filters?: SupplyFilters): Promise<Supply[]> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.marketplace) params.set('marketplace', filters.marketplace);
  if (filters?.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters?.dateTo) params.set('date_to', filters.dateTo);
  if (filters?.search) params.set('search', filters.search);
  const qs = params.toString();
  const res = await fetch(qs ? `${SUPPLIES_URL}?${qs}` : SUPPLIES_URL);
  const data = await res.json();
  return data.supplies || [];
};

export const fetchSupplyDetail = async (id: number): Promise<SupplyDetail> => {
  const res = await fetch(`${SUPPLIES_URL}?id=${id}`);
  const data = await res.json();
  return data.supply;
};

export interface SupplyCandidate {
  orderId: number;
  orderNumber: string;
  product: string | null;
  sewingStatus: string;
  supplyItemId: number | null;
  boxNumber: number | null;
  status: string;
}

export const fetchSupplyCandidates = async (id: number): Promise<SupplyCandidate[]> => {
  const res = await fetch(`${SUPPLIES_URL}?id=${id}&candidates=1`);
  const data = await res.json();
  return data.candidates || [];
};

/** Роль текущего сотрудника — backend по ней решает, что человеку можно менять.
 * Например, менеджеру закрыто редактирование FBS-поставок: их собирает кладовщик. */
const currentRole = (): string | undefined => {
  try {
    const raw = localStorage.getItem('megatul_user');
    return raw ? JSON.parse(raw).role : undefined;
  } catch {
    return undefined;
  }
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SUPPLIES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorRole: currentRole(), ...payload }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const createSupply = (payload: {
  marketplace: string;
  type: SupplyType;
  comment?: string;
  createdBy?: number;
  goodsWarehouseIds?: number[];
  ozonDeliveryMethod?: OzonDeliveryMethod;
}) => postAction({ action: 'create', ...payload });


export interface ScanOrderResult {
  success: true;
  goodsWarehouseId: number;
  orderNumber?: string | null;
  /** Заполняется, если товар из заказа с общим ярлыком (Яндекс Маркет): такой заказ
   * отгружается только целиком, поэтому сразу показываем, сколько вещей ещё не отсканировано. */
  group?: {
    groupKey: string;
    inSupply: number;
    total: number;
    remaining: number;
  } | null;
}

export const scanOrderToSupply = (supplyId: number, orderNumber: string): Promise<ScanOrderResult> =>
  postAction({ action: 'scan_order', supplyId, orderNumber });

export const removeSupplyItem = (itemId: number) => postAction({ action: 'remove_item', itemId });

/** Убрать отменённый заказ из поставки на полку хранения. Для связки Яндекса на полку
 * уходит вся связка целиком — ярлык на неё общий. */
export const cancelledToShelf = (
  itemId: number,
  shelfId: number,
  actor?: { id?: number | null; name?: string | null }
): Promise<{ movedCount: number; shelfName: string; groupKey: string | null }> =>
  postAction({
    action: 'cancelled_to_shelf',
    itemId,
    shelfId,
    actorId: actor?.id,
    actorName: actor?.name,
  }) as Promise<{ movedCount: number; shelfName: string; groupKey: string | null }>;

export interface CreateBoxResult {
  id: number;
  boxNumber: number;
  barcode: string;
  createdAt: string;
}

export const createSupplyBox = (supplyId: number): Promise<CreateBoxResult> =>
  postAction({ action: 'create_box', supplyId });

export const deleteSupplyBox = (boxId: number) => postAction({ action: 'delete_box', boxId });

export interface CloseBoxResult {
  success: true;
  closedAt: string | null;
}

export const closeSupplyBox = (boxId: number): Promise<CloseBoxResult> =>
  postAction({ action: 'close_box', boxId });

export interface AddOrderToBoxResult {
  success: true;
  itemId: number;
  goodsWarehouseId: number;
}

/** Кладёт товар в короб поставки по ШТРИХКОДУ ХРАНЕНИЯ (GW-XXXXXX). Параметр называется
 * orderNumber ради совместимости, но номер заказа маркетплейса сюда передавать нельзя —
 * в поставку попадает только реально отсканированная вещь. */
export const addOrderToBox = (boxId: number, orderNumber: string): Promise<AddOrderToBoxResult> =>
  postAction({ action: 'add_order_to_box', boxId, orderNumber });

export const removeBoxItem = (itemId: number) => postAction({ action: 'remove_box_item', itemId });

export const updateSupply = (
  supplyId: number,
  fields: Partial<{
    supplyNumber: string;
    supplyBarcode: string;
    cluster: string;
    gazelkaId: string;
    comment: string;
    shipToGazelkaAt: string;
    shipToMarketplaceAt: string;
    totalQuantityMarketplace: number | null;
    passStickerBase64: string;
    passStickerName: string;
    ozonApplicationNumber: string;
    ozonStatus: string;
    supplyDate: string;
    timeslot: string;
    shipmentType: string;
    packagingType: PackagingType | '';
    packagingCount: number | null;
    gazelkaPickup: boolean;
    ozonCargoType: 'BOX' | 'PALLET';
    gazelkaPlanId: number | null;
    gazelkaIds: number;
    gazelkaIdm: number;
  }>
) => postAction({ action: 'update', supplyId, ...fields });

export const moveSupplyStatus = (supplyId: number, status: SupplyStatus) =>
  postAction({ action: 'move_status', supplyId, status });

export const forceCompleteSupply = (supplyId: number) =>
  postAction({ action: 'force_complete', supplyId });

export const deleteSupply = (id: number) => postAction({ action: 'delete', id });