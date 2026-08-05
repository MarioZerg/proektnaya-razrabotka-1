const SHIFTS_URL = 'https://functions.poehali.dev/88851192-9090-480d-b9f7-aecfea5e7bdf';

export interface ShiftListItem {
  id: number;
  workshopId: number;
  workshopName: string;
  shiftNumber: number;
  name: string;
  isActive: boolean;
  workshopIsActive: boolean;
  employeesCount: number;
}

export interface ShiftEmployee {
  id: number;
  fullName: string;
  role: string;
  shiftFree: boolean;
}

export interface ShiftDetail extends ShiftListItem {
  createdAt: string;
  updatedAt: string;
  employees: ShiftEmployee[];
}

export const fetchShifts = async (workshopId?: number): Promise<ShiftListItem[]> => {
  const qs = workshopId ? `?workshop_id=${workshopId}` : '';
  const res = await fetch(`${SHIFTS_URL}${qs}`);
  const data = await res.json();
  return data.shifts || [];
};

export const fetchShiftDetail = async (id: number): Promise<ShiftDetail> => {
  const res = await fetch(`${SHIFTS_URL}?id=${id}`);
  const data = await res.json();
  return data.shift;
};

/** Смена, которая по графику работает сегодня. */
export interface WorkingShiftToday {
  workshopId: number;
  workshopName: string;
  shiftNumber: number;
  shiftName: string;
  /** Сколько сотрудников этой смены уже открыли смену. */
  openedCount: number;
}

/** Какие смены должны быть в цехах сегодня — с учётом графика 2/2, 5/2 и ручных выходных. */
export const fetchWorkingToday = async (): Promise<WorkingShiftToday[]> => {
  const res = await fetch(`${SHIFTS_URL}?today=1`);
  const data = await res.json();
  return data.working || [];
};

/** Цикличный график смены: работает workDays дней, отдыхает offDays, отсчёт от startDate. */
export interface ShiftCycle {
  workDays: number;
  offDays: number;
  startDate: string;
}

/** Выходные смены за месяц. Если у смены задан цикл (2/2 и т.п.), выходные считаются
 * автоматически и приходят вместе с параметрами цикла. */
export const fetchShiftDaysOff = async (
  workshopId: number,
  shiftNumber: number,
  month: string
): Promise<{ daysOff: string[]; cycle: ShiftCycle | null; workWeekdays: number[] | null }> => {
  const res = await fetch(
    `${SHIFTS_URL}?calendar=1&workshop_id=${workshopId}&shift_number=${shiftNumber}&month=${month}`
  );
  const data = await res.json();
  return {
    daysOff: data.daysOff || [],
    cycle: data.cycle || null,
    workWeekdays: data.workWeekdays || null,
  };
};

/** Включить цикличный график смены. Пустые значения выключают цикл и возвращают
 * ручную отметку выходных в календаре. */
export const setShiftCycle = (payload: {
  workshopId: number;
  shiftNumber: number;
  workDays?: number | null;
  offDays?: number | null;
  startDate?: string | null;
  /** Сохранить, даже если смена работает одновременно с другой (5/2 рядом с бригадами 2/2). */
  force?: boolean;
}) => postAction({ action: 'set_cycle', ...payload });

/** Недельный график (5/2 и др.): рабочие дни недели, 1 = понедельник ... 7 = воскресенье.
 * Пустой список выключает недельный график. */
export const setShiftWeekdays = (payload: {
  workshopId: number;
  shiftNumber: number;
  workWeekdays: number[] | null;
}) => postAction({ action: 'set_weekdays', ...payload });

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SHIFTS_URL, {
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

export const createShift = (payload: { workshopId: number; name: string; shiftNumber?: number }) =>
  postAction({ action: 'create', ...payload });

export const updateShift = (id: number, fields: Partial<{ name: string; isActive: boolean }>) =>
  postAction({ action: 'update', id, ...fields });

export const deleteShift = (id: number) => postAction({ action: 'delete', id });

export const addEmployeeToShift = (shiftId: number, userId: number) =>
  postAction({ action: 'add_employee', shiftId, userId });

export const removeEmployeeFromShift = (userId: number) =>
  postAction({ action: 'remove_employee', userId });

export const setShiftDayOff = (workshopId: number, shiftNumber: number, date: string, dayOff: boolean) =>
  postAction({ action: 'set_day_off', workshopId, shiftNumber, date, dayOff });
