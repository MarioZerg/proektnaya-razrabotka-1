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
  /** Недостача: сколько метража не хватило в рулоне при закрытии в цехе. */
  shortageQuantity?: number;
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
  /** Кто отвечает за брак этого материала: Тюль — закройщик, Аксессуары — швея,
   * Упаковка — упаковщик. Для незнакомого типа материала — null. */
  defectRole?: 'cutter' | 'sewer' | 'packer' | null;
  defectRoleLabel?: string | null;
}

/** Рулон в деталях: тип материала нужен, чтобы правильно назвать ответственного за брак. */
export interface RollDetailInfo extends Roll {
  materialType: string | null;
  kind: 'fabric' | 'trim';
  defectRole?: 'cutter' | 'sewer' | 'packer' | null;
  defectRoleLabel?: string | null;
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
  /** Производственная роль: вернуть рулоны ТОЛЬКО цеха её открытой смены. */
  forUserId?: number;
}): Promise<Roll[]> => {
  const params = new URLSearchParams();
  if (filters?.materialId) params.set('material_id', String(filters.materialId));
  if (filters?.status) params.set('status', filters.status);
  if (filters?.usedSinceUserId) params.set('usedSinceUserId', String(filters.usedSinceUserId));
  if (filters?.forUserId) params.set('forUserId', String(filters.forUserId));
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

/** Ручное создание рулона — только для администратора: обычный приход оформляется
 * приёмкой от поставщика, где у партии есть документ, поставщик и цена. */
export const createRoll = (payload: {
  barcode: string;
  materialId: number;
  initialQuantity: number;
  workshopId?: number;
  shiftNumber?: number;
  actorRole?: string;
}) => postAction({ action: 'create', ...payload });

export const updateRoll = (
  id: number,
  fields: Partial<{ status: RollStatus; workshopId: number | null; shiftNumber: number | null }>
) => postAction({ action: 'update', id, ...fields });

export const writeOffRoll = (id: number, quantity: number, orderId?: number) =>
  postAction({ action: 'write_off', id, quantity, orderId });

export const deleteRoll = (id: number) => postAction({ action: 'delete', id });

/** Закрытие рулона в цехе: рулон закончился. Если ткани не хватило — передаётся недостача. */
export const closeRoll = (id: number, shortage = 0, userId?: number, userName?: string) =>
  postAction({ action: 'close_roll', id, shortage, userId, userName });

/** Сводка недостач по закрытым рулонам: средний процент по каждой ткани, разрез по
 * закройщикам и список рулонов. Пока используется только для сбора статистики. */
export interface ShortageByMaterial {
  materialId: number;
  material: string;
  unit: string;
  cost: number;
  normPercent: number | null;
  rollsClosed: number;
  shortageTotal: number;
  avgPercent: number;
  maxPercent: number;
  rollsWithShortage: number;
  costTotal: number;
}

export interface ShortageByUser {
  userId: number | null;
  userName: string;
  rollsClosed: number;
  shortageTotal: number;
  avgPercent: number;
  costTotal: number;
}

export interface ShortageRoll {
  id: number;
  barcode: string;
  material: string;
  unit: string;
  initialQuantity: number;
  shortage: number;
  shortagePercent: number;
  closedBy: string;
  completedAt: string | null;
  cost: number;
}

export const fetchShortageStats = async (params?: {
  from?: string;
  to?: string;
}): Promise<{
  byMaterial: ShortageByMaterial[];
  byUser: ShortageByUser[];
  rolls: ShortageRoll[];
}> => {
  const qs = new URLSearchParams({ shortage_stats: '1' });
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  const res = await fetch(`${ROLLS_URL}?${qs.toString()}`);
  const data = await res.json();
  return { byMaterial: data.byMaterial || [], byUser: data.byUser || [], rolls: data.rolls || [] };
};