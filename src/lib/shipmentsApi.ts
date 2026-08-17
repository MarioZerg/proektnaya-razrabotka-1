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
  materialId: number | null;
  /** Причина отказа сотрудника цеха в приёме — заявка при этом остаётся в статусе "Отправлено". */
  rejectReason: string | null;
  /** Все поставщики приёмки через запятую: их может быть несколько в одной машине. */
  itemSuppliers?: string | null;
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
  /** Цена за единицу в валюте, указанная администратором при проверке. */
  price?: number | null;
  currency?: string | null;
  /** Итоговая себестоимость 1 единицы в рублях (после подтверждения). */
  costPerUnit?: number | null;
  /** Цена из прайса поставщика — подставляется в форму по умолчанию. */
  supplierPrice?: number | null;
  supplierCurrency?: string | null;
  /** Поставщик именно этой позиции — в одной приёмке их может быть несколько. */
  supplierId?: number | null;
  supplierName?: string | null;
  /**
   * Штрихкоды, забронированные системой ещё при оформлении приёмки. Кладовщик печатает
   * и клеит их сразу при разгрузке, не дожидаясь администратора — после подтверждения
   * рулоны получают ровно эти же коды.
   */
  reservedBarcodes?: string[];
  /** Состояние рулона на складе: in_storage / in_workshop / completed. */
  rollStatus?: string | null;
  rollInitialQuantity?: number | null;
  rollRemainingQuantity?: number | null;
  /** Метраж можно править: рулон целый и лежит на складе. */
  canEditQuantity?: boolean;
}

export interface ShipmentDetail extends Shipment {
  items: ShipmentItem[];
  requestedBy: number | null;
  createdBy: number | null;
  /** Стоимость логистики приёмки. Ноль — её ещё не указали. */
  logisticsCost?: number;
  exchangeRate?: number | null;
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
  items: Array<{
    materialId: number;
    quantity: number;
    numberRolls: number;
    /** Поставщик этой позиции — если у машины их несколько. */
    supplierId?: number | null;
  }>;
}): Promise<CreateFromSupplierResult> => postAction({ action: 'create', type: 'from_supplier', ...payload });

// Правка позиций неподтверждённой поставки (например, кладовщик ошибся в метраже)
export const updatePendingSupply = (
  id: number,
  payload: {
    supplierId?: number;
    items: Array<{
      /** id существующей позиции — по нему сохраняются уже напечатанные штрихкоды. */
      id?: number;
      materialId: number;
      quantity: number;
      numberRolls: number;
      /** Цена за единицу в валюте поставщика. Пусто — подставится прайс поставщика. */
      price?: number | null;
      currency?: string | null;
      supplierId?: number | null;
    }>;
  }
) => postAction({ action: 'update_pending_supply', id, ...payload });

export interface ApproveSupplyResult {
  success: true;
  createdRolls: string[];
}

/** Подтверждение поставки: только теперь создаются реальные рулоны на складе и
 * рассчитывается себестоимость каждого — цена умножается на курс, сверху добавляется
 * логистика, разделённая поровну на все метры и штуки поставки. */
export const approveSupply = (
  id: number,
  payload?: { exchangeRate?: number | null; logisticsCost?: number }
): Promise<ApproveSupplyResult> =>
  postAction({ action: 'approve_supply', id, ...(payload || {}) });

export const rejectSupply = (id: number) => postAction({ action: 'reject_supply', id });

/**
 * Правка метража одного рулона в уже принятой приёмке (только администратор).
 *
 * Бирки поставщика врут: на рулоне «50 м», по факту 47. Пока рулон целый лежит на
 * складе, цифру нужно поправить — иначе учёт материала и себестоимость метра считаются
 * от неверного числа. Тронутый рулон править нельзя: за ним уже стоят чужие раскрои.
 */
export const updateRollQuantity = (itemId: number, quantity: number) =>
  postAction({ action: 'update_roll_quantity', itemId, quantity }) as Promise<{
    success: true;
    barcode: string;
    quantity: number;
  }>;

/**
 * Дозаполнение логистики в принятой приёмке (только администратор).
 *
 * Счёт за перевозку часто приходит позже машины. Указать сумму можно, только если её
 * ещё нет: по уже проставленной логистике могли посчитать недостачи и себестоимость.
 */
export const updateShipmentLogistics = (id: number, logisticsCost: number) =>
  postAction({ action: 'update_logistics', id, logisticsCost }) as Promise<{
    success: true;
    logisticsCost: number;
  }>;

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

// Кладовщик убирает обратно ошибочно отсканированный рулон из собираемой заявки — без
// жёстких условий, пока заявка ещё в статусе "Новый". Сам рулон остаётся на складе.
export const removeScannedRoll = (itemId: number) => postAction({ action: 'remove_scanned_roll', itemId });

export const shipToWorkshop = (shipmentId: number) => postAction({ action: 'ship', shipmentId });

export const receiveAtWorkshop = (shipmentId: number) => postAction({ action: 'receive', shipmentId });

// Сотрудник цеха отказывается принять заявку (состав не в порядке). Заявка ОСТАЁТСЯ в
// статусе "Отправлено" с указанной причиной — кладовщик/админ смогут открыть экран сборки,
// поправить состав (добавить/убрать рулоны) и отправить заявку заново.
export const rejectWorkshopReceive = (shipmentId: number, rejectReason: string) =>
  postAction({ action: 'reject_receive', shipmentId, rejectReason });

// Списание материала прямо в цехе (без указания рулона — FIFO по остаткам в цехе)
export const workshopWriteoff = (payload: {
  workshopId?: number;
  shiftNumber?: number;
  comment?: string;
  items: Array<{ materialId: number; quantity: number }>;
}) => postAction({ action: 'workshop_writeoff', ...payload });

export const deleteShipment = (id: number) => postAction({ action: 'delete', id });