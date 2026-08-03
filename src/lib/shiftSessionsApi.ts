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
}

export const openShift = (
  userId: number,
  workshopId?: number | null,
  shiftNumber?: number | null,
  openedByAdmin?: boolean
): Promise<OpenShiftResult> =>
  postAction({ action: 'open', userId, workshopId, shiftNumber, openedByAdmin });

export const closeShift = (userId: number) => postAction({ action: 'close', userId });