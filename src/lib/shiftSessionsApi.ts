const SHIFT_SESSIONS_URL = 'https://functions.poehali.dev/6143d29d-094c-4dc6-a520-eb0eeb10d8a0';

export interface EmployeeShiftStatus {
  id: number;
  fullName: string;
  role: string;
  shiftNumber: number | null;
  isOpen: boolean;
  openedAt: string | null;
  canCloseAt: string | null;
  /** Гостевой режим — сотрудник не привязан жёстко к штатной смене. */
  shiftFree: boolean;
  /** Цех/смена ТЕКУЩЕЙ открытой смены — может отличаться от штатной (workshop/shiftNumber
   * профиля), если сотрудник зашёл гостем в другую смену. */
  sessionWorkshopId: number | null;
  sessionShiftNumber: number | null;
  /** Должность, в которой сотрудник работает в текущей открытой смене. */
  sessionRole?: string | null;
}

export const fetchEmployeeShifts = async (): Promise<EmployeeShiftStatus[]> => {
  const res = await fetch(SHIFT_SESSIONS_URL);
  const data = await res.json();
  return data.employees || [];
};

export interface ShiftCalendarDay {
  date: string;
  employees: string[];
  activeShift: number | null;
}

export const fetchShiftCalendar = async (month: string): Promise<ShiftCalendarDay[]> => {
  const res = await fetch(`${SHIFT_SESSIONS_URL}?calendar=1&month=${month}`);
  const data = await res.json();
  return data.days || [];
};

export interface AvailableShift {
  workshopId: number;
  workshopName: string;
  shiftNumber: number;
  shiftName: string;
  isHome: boolean;
}

export const fetchAvailableShifts = async (userId: number): Promise<AvailableShift[]> => {
  const res = await fetch(`${SHIFT_SESSIONS_URL}?available_shifts=1&userId=${userId}`);
  const data = await res.json();
  return data.shifts || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SHIFT_SESSIONS_URL, {
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

export interface OpenShiftResult {
  id: number;
  openedAt: string;
  workshopId: number;
  shiftNumber: number;
  /** Смена открыта позже начала рабочего дня — зафиксировано опоздание. */
  isLate?: boolean;
}

export const openShift = (
  userId: number,
  workshopId?: number | null,
  shiftNumber?: number | null,
  openedByAdmin?: boolean,
  /** Должность, в которой сотрудник выходит в эту смену (из его разрешённых ролей). */
  role?: string | null
): Promise<OpenShiftResult> =>
  postAction({ action: 'open', userId, workshopId, shiftNumber, openedByAdmin, role });

/** Закрывает смену. Швее и закройщику нельзя, пока за ними числятся заказы — придёт
 * ошибка с их количеством. Администратор закрывает принудительно (closedByAdmin). */
export const closeShift = (userId: number, closedByAdmin = false) =>
  postAction({ action: 'close', userId, ...(closedByAdmin ? { closedByAdmin: true } : {}) });

export interface AutoClosedShift {
  userId: number;
  name: string;
  ordersInWork: number;
  penalty: number;
}

/** Закрывает смены, которые сотрудники забыли закрыть: время берётся из настроек цеха
 * (конец рабочего дня), при заказах в работе начисляется повышенный штраф. */
export const autoCloseShifts = (): Promise<{
  success: true;
  closedCount: number;
  closed: AutoClosedShift[];
}> => postAction({ action: 'auto_close' });
export interface DefectCheck {
  ask: boolean;
  question: string;
  hint: string;
  defectsCount: number;
  defectsQuantity: number;
  role: string;
}

/** Перед закрытием смены спрашиваем про брак: текст свой для каждой роли — закройщик режет
 * ткань, швея работает с тесьмой. Нулевой счётчик обычно значит, что человек забыл оформить
 * брак, а не что его не было. */
export const checkShiftDefects = async (userId: number): Promise<DefectCheck | null> => {
  const res = await fetch(SHIFT_SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_check', userId }),
  });
  const data = await res.json();
  return data.ask ? data : null;
};
