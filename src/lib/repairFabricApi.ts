const REPAIR_FABRIC_URL = 'https://functions.poehali.dev/580fc69a-16df-4299-ae73-af0a840f29d1';

export type RepairPieceStatus = 'available' | 'used' | 'written_off';

/** Кусок ткани на перешив — отрез с фиксированными размерами, лежащий в цехе. */
export interface RepairPiece {
  id: number;
  material: string;
  materialId?: number | null;
  width: number;
  height: number;
  status: RepairPieceStatus;
  workshopId?: number | null;
  workshopName?: string | null;
  shiftNumber?: number | null;
  createdByName?: string | null;
  createdAt: string;
  usedOrderId?: number | null;
  usedOrderNumber?: string | null;
  usedByName?: string | null;
  usedAt?: string | null;
  comment?: string | null;
  /** Насколько кусок больше заказа — только в подборе под заказ. */
  extraWidth?: number;
  extraHeight?: number;
}

export interface RepairPiecesResult {
  pieces: RepairPiece[];
  /** Сколько кусков каждого материала лежит в цехе. */
  summary: Array<{ material: string; count: number }>;
}

export interface SuitablePiecesResult {
  pieces: RepairPiece[];
  order: {
    orderNumber?: string;
    material: string | null;
    width: number | null;
    height: number | null;
  };
  note?: string;
}

const request = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка склада перешива');
  return data;
};

const post = (payload: Record<string, unknown>) =>
  request(REPAIR_FABRIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/** Остатки кусков в цехе. status='all' — вся история, включая израсходованные. */
export const fetchRepairPieces = (
  params: { status?: RepairPieceStatus | 'all'; material?: string } = {},
): Promise<RepairPiecesResult> => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.material) q.set('material', params.material);
  return request(`${REPAIR_FABRIC_URL}?${q.toString()}`);
};

/**
 * Куски, которыми можно перешить конкретный заказ.
 *
 * Сервер отбирает только тот же материал и размер НЕ МЕНЬШЕ заказа: из куска
 * 300×255 штору 400×265 не сшить. Список отсортирован от наименее
 * расточительных — сверху куски, которые почти впритык.
 */
export const fetchSuitablePieces = (orderId: number): Promise<SuitablePiecesResult> =>
  request(`${REPAIR_FABRIC_URL}?action=suitable&orderId=${orderId}`);

/**
 * Упаковщица отправляет вещь в перешив.
 *
 * Рулон указывать не нужно: кусок сохраняет свои размеры и попадает
 * закройщикам как отдельный отрез.
 */
export const sendToRepair = (
  goodsWarehouseId: number,
  actor?: { id?: number | null; name?: string | null },
): Promise<{ success: true; pieceId: number; material: string; width: number; height: number }> =>
  post({
    action: 'send',
    goodsWarehouseId,
    userId: actor?.id,
    userName: actor?.name,
  }) as Promise<{ success: true; pieceId: number; material: string; width: number; height: number }>;

/** Закройщик берёт кусок под заказ — кусок уходит из остатков. */
export const takeRepairPiece = (
  pieceId: number,
  orderId: number,
  actor?: { id?: number | null; name?: string | null },
): Promise<{ success: true; material: string; width: number; height: number }> =>
  post({
    action: 'use',
    pieceId,
    orderId,
    userId: actor?.id,
    userName: actor?.name,
  }) as Promise<{ success: true; material: string; width: number; height: number }>;

/** Администратор списывает кусок (брак, потеря). */
export const writeOffRepairPiece = (pieceId: number, reason: string) =>
  post({ action: 'write_off', pieceId, reason });
