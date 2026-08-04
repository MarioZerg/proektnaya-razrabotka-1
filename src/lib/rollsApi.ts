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
  /** По рулону было движение материала в текущей смене (заполняется при запросе с usedSinceUserId). */
  usedInShift?: boolean;
}

export type RollMovementKind = 'order' | 'defect' | 'return_to_supplier' | 'workshop_writeoff';

/** Этап выполнения заказа: кто раскроил / сшил / упаковал. */
export interface RollOrderStage {
  role: 'cutter' | 'sewer' | 'packer';
  label: string;
  userName: string | null;
  at: string | null;
}

export interface RollMovement {
  kind: RollMovementKind;
  quantity: number;
  createdAt: string;
  orderNumber: string | null;
  userName: string | null;
  comment: string | null;
  /** Лесенка этапов заказа (только для движений kind='order'). */
  stages?: RollOrderStage[] | null;
  /** Роль исполнителя брака: 'cutter' для ткани, 'sewer' для тесьмы. */
  defectRole?: 'cutter' | 'sewer' | null;
  defectRoleLabel?: string | null;
}

/** Рулон в деталях: тип материала (ткань/тесьма) для правильной атрибуции брака. */
export interface RollDetailInfo extends Roll {
  materialType: string | null;
  kind: 'fabric' | 'trim';
}

export interface RollDetail {
  roll: RollDetailInfo;
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

export const fetchRolls = async (filters?: {
  materialId?: number;
  status?: string;
  /** Отметить рулоны, по которым было движение в текущей смене этого сотрудника. */
  usedSinceUserId?: number;
}): Promise<Roll[]> => {
  const params = new URLSearchParams();
  if (filters?.materialId) params.set('material_id', String(filters.materialId));
  if (filters?.status) params.set('status', filters.status);
  if (filters?.usedSinceUserId) params.set('usedSinceUserId', String(filters.usedSinceUserId));
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

/** Закрытие рулона в цехе: рулон закончился. Если ткани не хватило — передаётся недостача. */
export const closeRoll = (id: number, shortage = 0) =>
  postAction({ action: 'close_roll', id, shortage });