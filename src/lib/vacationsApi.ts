const VACATIONS_URL = 'https://functions.poehali.dev/357a4c05-fc74-4149-bf03-ecb7b9d895d7';

/** Оформленный отпуск сотрудника. */
export interface Vacation {
  id: number;
  userId: number;
  userName: string;
  role: string;
  startsOn: string;
  endsOn: string;
  /** Рабочий год от даты первого отпуска: 1-й, 2-й и так далее. */
  workYear: number;
  comment: string;
  workshopName: string | null;
  shiftNumber: number | null;
  cancelled: boolean;
}

/** Когда сотруднику положен следующий отпуск. */
export interface VacationRight {
  /** Дата первого отпуска — от неё считается рабочий год. */
  firstVacationDate: string | null;
  /** Ближайшая дата, с которой можно оформить отпуск. */
  nextDate: string | null;
  workYear: number;
  /** Сколько отпусков уже взято в текущем рабочем году. */
  usedInYear: number;
  perYear?: number;
  days?: number;
  /** Почему отпуск оформить нельзя. Пусто — можно. */
  reason: string | null;
}

export const fetchVacations = async (): Promise<Vacation[]> => {
  const res = await fetch(VACATIONS_URL);
  const data = await res.json();
  return data.items || [];
};

/** Права сотрудника на отпуск: когда ближайший и сколько уже отгулял. */
export const fetchVacationRight = async (userId: number): Promise<VacationRight> => {
  const res = await fetch(`${VACATIONS_URL}?userId=${userId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить данные об отпуске');
  return data;
};

/** Оформить отпуск на две недели с указанной даты. */
export const createVacation = async (payload: {
  userId: number;
  startsOn: string;
  comment?: string;
  actorId?: number | null;
}) => {
  const res = await fetch(VACATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось оформить отпуск');
  return data;
};

/** Отменить оформленный отпуск. */
export const cancelVacation = async (id: number, actorId?: number | null) => {
  const res = await fetch(VACATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', id, actorId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отменить отпуск');
  return data;
};
