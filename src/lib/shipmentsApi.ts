const SHIPMENTS_URL = 'https://functions.poehali.dev/a68cce8d-f3b0-4f06-a66a-305eeacd17bb';

export type ShipmentType = 'from_supplier' | 'to_workshop' | 'return_to_supplier' | 'defect_writeoff';

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
}

export interface ShipmentDetail extends Shipment {
  items: ShipmentItem[];
}

export const fetchShipments = async (type?: ShipmentType): Promise<Shipment[]> => {
  const url = type ? `${SHIPMENTS_URL}?type=${type}` : SHIPMENTS_URL;
  const res = await fetch(url);
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
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const createShipmentFromSupplier = (payload: {
  supplierId?: number;
  comment?: string;
  items: Array<{ materialId: number; barcode: string; quantity: number }>;
}) => postAction({ action: 'create', type: 'from_supplier', ...payload });

export const createShipmentToWorkshop = (payload: {
  workshopId: number;
  shiftNumber?: number;
  comment?: string;
  items: Array<{ rollId: number }>;
}) => postAction({ action: 'create', type: 'to_workshop', ...payload });

export const createShipmentReturnToSupplier = (payload: {
  supplierId?: number;
  comment?: string;
  items: Array<{ rollId: number; quantity: number }>;
}) => postAction({ action: 'create', type: 'return_to_supplier', ...payload });

export const createShipmentDefectWriteoff = (payload: {
  comment?: string;
  items: Array<{ rollId: number; quantity: number }>;
}) => postAction({ action: 'create', type: 'defect_writeoff', ...payload });

export const deleteShipment = (id: number) => postAction({ action: 'delete', id });
