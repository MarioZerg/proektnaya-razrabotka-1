import { withActor } from '@/lib/actor';

const SHIPMENTS_URL = 'https://functions.poehali.dev/a68cce8d-f3b0-4f06-a66a-305eeacd17bb';

export type ShipmentType =
  | 'from_supplier'
  | 'to_workshop'
  | 'return_to_supplier'
  | 'defect_writeoff'
  | 'workshop_writeoff';

export interface Shipment {
  id: number;
  type: ShipmentType;
  status: string;
  supplierId: number | null;
  supplierName: string | null;
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
  comment: string | null;
  createdAt: string;
  completedAt: string | null;
  itemsCount: number;
  requestedByName: string | null;
  createdByName: string | null;
  totalQuantity: number;
  isAutoOrder: boolean;
  materialNames: string | null;
}

export interface ShipmentItem {
  id: number;
  materialId: number;
  materialName: string | null;
  unit: string | null;
  barcode: string | null;
  rollId: number | null;
  rollBarcode: string | null;
  quantity: number | null;
  requestedQuantity: number | null;
  numberRolls: number | null;
}

export interface ShipmentDetail extends Shipment {
  items: ShipmentItem[];
  requestedBy: number | null;
  createdBy: number | null;
}

export interface ShipmentFilters {
  type?: ShipmentType;
  supplierId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const fetchShipments = async (filters?: ShipmentType | ShipmentFilters): Promise<Shipment[]> => {
  const f: ShipmentFilters = typeof filters === 'string' ? { type: filters } : filters || {};
  const params = new URLSearchParams();
  if (f.type) params.set('type', f.type);
  if (f.supplierId) params.set('supplier_id', String(f.supplierId));
  if (f.status) params.set('status', f.status);
  if (f.dateFrom) params.set('date_from', f.dateFrom);
  if (f.dateTo) params.set('date_to', f.dateTo);
  const qs = params.toString();
  const res = await fetch(qs ? `${SHIPMENTS_URL}?${qs}` : SHIPMENTS_URL);
  const data = await res.json();
  return data.shipments || [];
};

export const fetchShipmentDetail = async (id: number): Promise<ShipmentDetail> => {
  const res = await fetch(`${SHIPMENTS_URL}?id=${id}`);
  const data = await res.json();
  return data.shipment;
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SHIPMENTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export interface CreateFromSupplierResult {
  id: number;
}

// Приёмка от поставщика теперь уходит на подтверждение админом — рулоны создаются
// только после approveSupply(). supplierId обязателен.
export const createShipmentFromSupplier = (payload: {
  supplierId: number;
  comment?: string;
  createdBy?: number;
  items: Array<{ materialId: number; quantity: number; numberRolls: number }>;
}): Promise<CreateFromSupplierResult> => postAction({ action: 'create', type: 'from_supplier', ...payload });

// Правка позиций неподтверждённой поставки (например, кладовщик ошибся в метраже)
export const updatePendingSupply = (
  id: number,
  payload: { supplierId?: number; items: Array<{ materialId: number; quantity: number; numberRolls: number }> }
) => postAction({ action: 'update_pending_supply', id, ...payload });

export interface ApproveSupplyResult {
  success: true;
  createdRolls: string[];
}

// Подтверждение поставки: только теперь создаются реальные рулоны на складе
export const approveSupply = (id: number): Promise<ApproveSupplyResult> => postAction({ action: 'approve_supply', id });

export const rejectSupply = (id: number) => postAction({ action: 'reject_supply', id });

export const createShipmentReturnToSupplier = (payload: {
  supplierId?: number;
  comment?: string;
  items: Array<{ rollId: number; quantity: number }>;
}) => postAction({ action: 'create', type: 'return_to_supplier', ...payload });

export const createShipmentDefectWriteoff = (payload: {
  comment?: string;
  items: Array<{ rollId: number; quantity: number }>;
}) => postAction({ action: 'create', type: 'defect_writeoff', ...payload });

// Отгрузка в цех — двухстадийный процесс со сканированием (как на физическом складе).
// Заявку создаёт швея/закройщик: строго 1 материал за раз, цех и смена берутся из его профиля.
// Сотрудник только выбирает материал — количество не указывается, кладовщик сам определит,
// сколько и какие рулоны собрать по факту наличия на складе.
export const requestToWorkshop = (payload: {
  workshopId: number;
  shiftNumber?: number;
  comment?: string;
  materialId: number;
  requestedQuantity?: number;
  requestedBy?: number;
}) => postAction({ action: 'request_to_workshop', ...payload });

export interface CollectScanResult {
  success: true;
  rollId: number;
  materialId: number;
  quantity: number;
}

export const collectScan = (shipmentId: number, barcode: string): Promise<CollectScanResult> =>
  postAction({ action: 'collect_scan', shipmentId, barcode });

export const shipToWorkshop = (shipmentId: number) => postAction({ action: 'ship', shipmentId });

export const receiveAtWorkshop = (shipmentId: number) => postAction({ action: 'receive', shipmentId });

// Списание материала прямо в цехе (без указания рулона — FIFO по остаткам в цехе)
export const workshopWriteoff = (payload: {
  workshopId?: number;
  shiftNumber?: number;
  comment?: string;
  items: Array<{ materialId: number; quantity: number }>;
}) => postAction({ action: 'workshop_writeoff', ...payload });

export const deleteShipment = (id: number) => postAction({ action: 'delete', id });