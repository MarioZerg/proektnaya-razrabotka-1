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
}

export const fetchKioskOrder = async (orderNumber: string): Promise<KioskOrder> => {
  const res = await fetch(`${KIOSK_URL}?orderNumber=${encodeURIComponent(orderNumber)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Заказ не найден');
  }
  return data.order;
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
