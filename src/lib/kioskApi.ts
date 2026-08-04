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

export const closeKioskOrder = async (
  orderId: number,
  packerId: number,
  actorId?: number,
  actorName?: string
) => {
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