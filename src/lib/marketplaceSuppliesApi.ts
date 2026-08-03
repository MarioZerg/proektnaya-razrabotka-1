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
}

export interface SupplyBox {
  id: number;
  boxNumber: number;
  barcode: string;
  createdAt: string;
  items: SupplyItem[];
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

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SUPPLIES_URL, {
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

export const createSupply = (payload: {
  marketplace: string;
  type: SupplyType;
  comment?: string;
  createdBy?: number;
  goodsWarehouseIds?: number[];
  ozonDeliveryMethod?: OzonDeliveryMethod;
}) => postAction({ action: 'create', ...payload });

export const addSupplyItems = (supplyId: number, goodsWarehouseIds: number[]) =>
  postAction({ action: 'add_items', supplyId, goodsWarehouseIds });

export interface ScanOrderResult {
  success: true;
  goodsWarehouseId: number;
}

export const scanOrderToSupply = (supplyId: number, orderNumber: string): Promise<ScanOrderResult> =>
  postAction({ action: 'scan_order', supplyId, orderNumber });

export const removeSupplyItem = (itemId: number) => postAction({ action: 'remove_item', itemId });

export interface CreateBoxResult {
  id: number;
  boxNumber: number;
  barcode: string;
  createdAt: string;
}

export const createSupplyBox = (supplyId: number): Promise<CreateBoxResult> =>
  postAction({ action: 'create_box', supplyId });

export const deleteSupplyBox = (boxId: number) => postAction({ action: 'delete_box', boxId });

export interface AddOrderToBoxResult {
  success: true;
  itemId: number;
  goodsWarehouseId: number;
}

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
  }>
) => postAction({ action: 'update', supplyId, ...fields });

export const moveSupplyStatus = (supplyId: number, status: SupplyStatus) =>
  postAction({ action: 'move_status', supplyId, status });

export const forceCompleteSupply = (supplyId: number) =>
  postAction({ action: 'force_complete', supplyId });

export const deleteSupply = (id: number) => postAction({ action: 'delete', id });