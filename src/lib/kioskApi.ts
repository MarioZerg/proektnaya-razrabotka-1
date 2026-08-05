const KIOSK_URL = 'https://functions.poehali.dev/646f604e-57e9-47fb-b2ca-dd424abfba48';

export interface KioskOrder {
  id: number;
  orderNumber: string;
  product: string;
  material: string | null;
  width: number | null;
  height: number | null;
  sewingStatus: string;
  assignedUserId: number | null;
  assignedUserName: string | null;
  /** Клиент отменил заказ: вещь дошивается, но уходит не покупателю, а на склад хранения —
   * упаковщик клеит стикер ХРАНЕНИЯ вместо стикера отправления. */
  isCancelled?: boolean;
  marketplace?: string | null;
  /** Заказ покупателя из нескольких вещей (Яндекс Маркет). Ярлык на такой заказ один общий,
   * поэтому вещи упаковываются вместе — терминал предупреждает об этом упаковщицу. */
  groupKey?: string | null;
  groupSize?: number | null;
  groupPosition?: number | null;
  /** FBS — ярлык отправления выдаёт маркетплейс по API; FBO — печатаем свой стикер товара. */
  orderType?: string | null;
}

export const fetchKioskOrder = async (orderNumber: string): Promise<KioskOrder> => {
  const res = await fetch(`${KIOSK_URL}?orderNumber=${encodeURIComponent(orderNumber)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Заказ не найден');
  }
  return data.order;
};

/** Ручной поиск заказов на стикеровке, когда сканер не работает или штрихкод не читается.
 * Ищет по размеру, материалу и швее — упаковщик выбирает нужный заказ из списка. */
export const findStickeringOrders = async (filters: {
  sewerId?: number | null;
  width?: number | null;
  height?: number | null;
  material?: string | null;
  workshopId?: number | null;
  /** Роль сотрудника — по ней сервер проверяет, разрешена ли ему стикеровка в этом цехе. */
  role?: string | null;
}): Promise<KioskOrder[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'find_stickering', ...filters }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось найти заказы');
  return data.orders || [];
};

/** Вещь на перепаковке: вернулась от покупателя годной, но с помятой упаковкой. */
export interface RepackItem {
  id: number;
  storageBarcode: string;
  orderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  returnReason: string | null;
  marketplace: string | null;
}

/** Список вещей, ожидающих перепаковки упаковщиком в цехе. */
export const fetchRepackItems = async (): Promise<RepackItem[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'repack_list' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить список');
  return data.items || [];
};

/** Решение упаковщика по вещи на перепаковке:
 *  repacked — переупакована, печатается стикер хранения и вещь уходит на склад;
 *  utilized — при вскрытии обнаружен брак, вещь списывается (нужна причина). */
export const finishRepack = async (payload: {
  id: number;
  outcome: 'repacked' | 'utilized';
  note?: string;
  actorId?: number;
  actorName?: string;
}): Promise<{ outcome: string; storageBarcode: string | null }> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'repack_done', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось завершить перепаковку');
  return data;
};

export interface KioskUser {
  id: number;
  name: string;
  role: string;
  shiftFromCode: number | null;
  /** Штатный цех сотрудника из профиля — в чужом цехе списание брака ему недоступно. */
  homeWorkshopId?: number | null;
}

export interface KioskShift {
  isOpen: boolean;
  openedAt: string | null;
  workshopId: number | null;
  shiftNumber: number | null;
}

/** Вход на терминал по личному QR-коду сотрудника (формат "{id}-{смена}-{дата}"). */
export const kioskLoginByCode = async (
  code: string
): Promise<{ user: KioskUser; shift: KioskShift }> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login_by_code', code }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось войти');
  }
  return data;
};

/** Списание брака на терминале: штатный сотрудник цеха сканирует свой штрихкод и списывает
 * метраж с рулона — в том числе за гостевых работников, которым это в чужом цехе запрещено. */
export const kioskDefectWriteoff = async (payload: {
  code: string;
  rollId: number;
  quantity: number;
  comment?: string;
}): Promise<{ success: true; id: number; actorName: string }> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_writeoff', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const closeKioskOrder = async (
  orderId: number,
  packerId: number,
  actorId?: number,
  actorName?: string
): Promise<{ success: true; isCancelled: boolean; storageBarcode: string | null }> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'close_order', orderId, packerId, actorId, actorName }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};
export interface UnlabeledCandidate {
  id: number;
  storageBarcode: string;
  orderNumber: string;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  sewerName: string | null;
  packerName: string | null;
  marketplace: string | null;
  receivedAt: string | null;
}

/** Кладовщик ищет вещь без стикера хранения среди отменённых заказов, ждущих укладки на
 * полку — по швее и/или размеру. Нужен, когда упаковщица не наклеила стикер или он потерян. */
export const findUnlabeledGoods = async (filters: {
  sewerId?: number;
  width?: number;
  height?: number;
}): Promise<UnlabeledCandidate[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'find_unlabeled', ...filters }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка поиска');
  }
  return data.candidates || [];
};

/** Швеи, у которых есть вещи, ожидающие укладки на полку. */
export const fetchUnlabeledSewers = async (): Promise<Array<{ id: number; name: string }>> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sewers_list' }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data.sewers || [];
};

/** Фиксирует факт перепечатки стикера хранения — для отчёта админу, кто пропускает стикеры. */
export const reprintStorageLabel = async (
  goodsId: number,
  actorId?: number,
  actorName?: string
): Promise<void> => {
  await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reprint_label', goodsId, actorId, actorName }),
  });
};

export interface ReprintReport {
  total: number;
  days: number;
  byPacker: Array<{ packerName: string; count: number; lastAt: string | null }>;
  events: Array<{
    createdAt: string;
    actorName: string | null;
    orderNumber: string | null;
    product: string | null;
    packerName: string | null;
    sewerName: string | null;
  }>;
}

/** Отчёт: сколько стикеров хранения перепечатано и по чьей вине. */
export const fetchReprintReport = async (days = 30): Promise<ReprintReport> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reprint_report', days }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};
