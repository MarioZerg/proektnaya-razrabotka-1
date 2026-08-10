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
  /**
   * Закройщик отставил рулон из-за брака в начале полотна. Рулон физически ещё в цехе,
   * но в раскрой не идёт и ждёт, когда кладовщик заберёт его на склад или откажет.
   */
  defectFlaggedAt?: string | null;
  defectFlaggedByName?: string | null;
  defectReason?: string | null;
  /**
   * Рулон отгружен в цех, но смена его ещё не приняла. Работать с ним нельзя:
   * материал мог не доехать или приехать не в том количестве. Сначала цех
   * подтверждает приёмку поставки, потом рулон становится рабочим.
   */
  pendingAcceptance?: boolean;
  /** Недостача: сколько метража не хватило в рулоне при закрытии в цехе. */
  shortageQuantity?: number;
}

export type RollMovementKind =
  | 'order'
  | 'defect'
  | 'return_to_supplier'
  | 'workshop_writeoff'
  /** Закройщик закрыл рулон на терминале: остаток списан, зафиксирована недостача. */
  | 'close';

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
  /** Себестоимость рулона — видит только администратор. */
  supplierName?: string | null;
  shipmentId?: number | null;
  /** Цена за единицу в валюте поставщика на момент приёмки. */
  purchasePrice?: number | null;
  purchaseCurrency?: string | null;
  /** Курс валюты, по которому приняли (у рублёвых позиций — 1). */
  purchaseRate?: number | null;
  /** Логистика, пришедшаяся на единицу. */
  logisticsPerUnit?: number | null;
  /** Итог: сколько стоит 1 пог.м. или 1 шт в рублях. */
  costPerUnit?: number | null;
}

export interface RollDetail {
  roll: RollDetailInfo;
  history: RollMovement[];
  /** Сколько расхода подтверждено историей движений. */
  trackedQuantity?: number;
  /** Расход без записей — данные перенесены из старой системы. */
  untrackedQuantity?: number;
}

/** Стоимость остатков одного материала на складе и в цехах. */
export interface StockValueMaterial {
  materialId: number;
  material: string;
  unit: string;
  materialType: string | null;
  /** Остаток в метрах или штуках. */
  remaining: number;
  /** Во сколько этот остаток обошёлся, ₽. */
  value: number;
  /** Всего рулонов с остатком: склад и цех вместе. */
  rolls: number;
  /** Рулоны без себестоимости — их стоимость в сумму не вошла. */
  rollsWithoutCost: number;
  inStorage: number;
  inWorkshop: number;
  /** Сколько рулонов физически лежит на складе. */
  rollsInStorage: number;
  /** Сколько рулонов сейчас в цехах. */
  rollsInWorkshop: number;
}

export interface StockValue {
  byMaterial: StockValueMaterial[];
  totalValue: number;
  rollsWithoutCost: number;
}

/** Сколько денег лежит в остатках материалов. Только для администратора. */
export const fetchStockValue = async (): Promise<StockValue> => {
  const res = await fetch(`${ROLLS_URL}?stock_value=1`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось посчитать стоимость склада');
  return data as StockValue;
};

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
  /** Поиск по штрихкоду. Ищется в базе: список ограничен свежими рулонами,
   * и закрытый рулон полугодовой давности иначе не нашёлся бы. */
  search?: string;
}): Promise<Roll[]> => {
  const params = new URLSearchParams();
  if (filters?.materialId) params.set('material_id', String(filters.materialId));
  if (filters?.status) params.set('status', filters.status);
  if (filters?.usedSinceUserId) params.set('usedSinceUserId', String(filters.usedSinceUserId));
  if (filters?.forUserId) params.set('forUserId', String(filters.forUserId));
  if (filters?.search) params.set('search', filters.search);
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
/** Закрытый рулон с недостачей, ожидающий решения администратора. */
export interface PendingPenalty {
  rollId: number;
  barcode: string;
  materialName: string;
  unit: string;
  initialQuantity: number;
  shortage: number;
  normPercent: number | null;
  costPerUnit: number;
  /** Допустимая недостача в единицах — сколько прощается по норме поставщика. */
  allowed?: number;
  /** Метраж сверх нормы, за который начисляется штраф. */
  excess: number;
  /** Сумма удержания по рулону. */
  total: number;
  /** Сколько снимут с каждого. */
  perUser?: number;
  /** Кого коснётся: «Швеи» для тесьмы, «Закройщицы» для ткани. */
  role?: string;
  users: Array<{ id: number; name: string; amount: number }>;
  /** Почему штраф начислить нельзя. Пусто — можно начислять. */
  reason: string | null;
}

/** Рулоны с недостачей, по которым решение ещё не принято. */
export const fetchPendingPenalties = async (): Promise<PendingPenalty[]> => {
  const res = await fetch(`${ROLLS_URL}?shortage_pending=1`);
  const data = await res.json();
  return data.items || [];
};

/** Удержать деньги с сотрудников за недостачу сверх нормы. */
export const chargePenalty = async (rollId: number) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'charge_penalty', id: rollId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось начислить штраф');
  return data;
};

/** Признать недостачу виной поставщика и никого не штрафовать. */
export const dismissPenalty = async (rollId: number) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dismiss_penalty', id: rollId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось выполнить');
  return data;
};

/** Закройщик отставил рулон: брак в начале полотна, резать дальше нельзя. */
export const flagRollDefect = async (id: number, reason: string, actorId?: number, actorName?: string) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'flag_defect', id, reason, actorId, actorName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отметить рулон');
  return data;
};

/** Кладовщик забирает бракованный рулон из цеха — сканированием штрихкода рулона. */
export const receiveDefectRoll = async (
  barcode: string,
  actorId?: number,
  actorName?: string,
): Promise<{
  barcode: string;
  materialName: string;
  remaining: number;
  unit: string | null;
  reason: string | null;
  flaggedBy: string | null;
}> => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'receive_defect_roll', barcode, actorId, actorName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось забрать рулон');
  return data;
};

/** Брак не подтвердился — рулон возвращается в работу. */
export const declineDefectRoll = async (id: number, reason: string, actorId?: number) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'decline_defect_roll', id, reason, actorId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отклонить');
  return data;
};
