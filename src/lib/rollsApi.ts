const ROLLS_URL = 'https://functions.poehali.dev/10824802-d4e4-48de-b98a-0fc06f8412d5';

export type RollStatus = 'in_storage' | 'in_workshop' | 'completed';

export interface Roll {
  id: number;
  barcode: string;
  materialId: number;
  materialName: string | null;
  unit: string | null;
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
  initialQuantity: number;
  remainingQuantity: number;
  status: RollStatus;
  createdAt: string;
  completedAt: string | null;
}

export type RollMovementKind = 'order' | 'defect' | 'return_to_supplier' | 'workshop_writeoff';

export interface RollMovement {
  kind: RollMovementKind;
  quantity: number;
  createdAt: string;
  orderNumber: string | null;
  userName: string | null;
  comment: string | null;
}

export interface RollDetail {
  roll: Roll;
  history: RollMovement[];
}

export const fetchRollDetail = async (id: number): Promise<RollDetail> => {
  const res = await fetch(`${ROLLS_URL}?id=${id}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Рулон не найден');
  }
  return data as RollDetail;
};

export const fetchRolls = async (filters?: { materialId?: number; status?: string }): Promise<Roll[]> => {
  const params = new URLSearchParams();
  if (filters?.materialId) params.set('material_id', String(filters.materialId));
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  const res = await fetch(qs ? `${ROLLS_URL}?${qs}` : ROLLS_URL);
  const data = await res.json();
  return data.rolls || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(ROLLS_URL, {
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

export const createRoll = (payload: {
  barcode: string;
  materialId: number;
  initialQuantity: number;
  workshopId?: number;
  shiftNumber?: number;
}) => postAction({ action: 'create', ...payload });

export const updateRoll = (
  id: number,
  fields: Partial<{ status: RollStatus; workshopId: number | null; shiftNumber: number | null }>
) => postAction({ action: 'update', id, ...fields });

export const writeOffRoll = (id: number, quantity: number, orderId?: number) =>
  postAction({ action: 'write_off', id, quantity, orderId });

export const deleteRoll = (id: number) => postAction({ action: 'delete', id });