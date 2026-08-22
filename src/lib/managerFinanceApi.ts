const MANAGER_FINANCE_URL =
  'https://functions.poehali.dev/406daf92-dd75-4e27-946d-e90aa720fe70';

/** Начисление за один недельный отчёт площадки. */
export interface ManagerAccrual {
  id: number;
  periodStart: string;
  periodEnd: string;
  /** Вещей закрыто отчётом. */
  units: number;
  /** Перечислено на расчётный счёт — база начисления. */
  baseAmount: number;
  percent: number;
  amount: number;
  /** Сколько приходится на одну вещь. */
  perUnit: number | null;
  /** hold — ждёт проверки, confirmed — подтверждено, cancelled — аннулировано. */
  status: 'hold' | 'confirmed' | 'cancelled';
  /** До этой даты возврат уменьшает начисление. */
  holdUntil: string;
  returnedUnits: number;
  returnedAmount: number;
  cancelReason: string | null;
  confirmedAt: string | null;
  /** К выплате за период. */
  net: number;
  /** Вещей продано ниже юнит-экономики — процент с них не платится. */
  lossUnits: number;
  /** На сколько уменьшена база из-за убыточных продаж. */
  lossAmount: number;
  /** База после вычета убыточных — с неё и взят процент. */
  payableBase: number | null;
}

export interface ManagerBalance {
  percent: number;
  holdDays: number;
  /** С какой даты считает система: раньше отчёты сверяются вручную. */
  accrueFrom: string | null;
  /** Подтверждено — к выплате. */
  confirmed: number;
  /** В холде: ещё проверяется, может уменьшиться при возврате. */
  hold: number;
  cancelled: number;
  items: ManagerAccrual[];
}

/** Что менеджер видит в своих финансах: баланс и недельные отчёты. */
export const fetchManagerBalance = async (
  userId: number,
): Promise<ManagerBalance> => {
  const res = await fetch(
    `${MANAGER_FINANCE_URL}?action=balance&userId=${userId}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить финансы');
  return data;
};

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(MANAGER_FINANCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

/** Считает новые начисления, применяет возвраты и закрывает холды. */
export const accrueManager = (actorId?: number) =>
  post({ action: 'accrue', actorId });

/** Полный пересчёт — после смены ставки или правил. */
export const recalcManager = (actorId?: number) =>
  post({ action: 'recalc', actorId });

/** Кому начисляем процент и на сколько дней держим холд. */
export const setManagerUser = (payload: {
  userId: number;
  holdDays?: number;
  actorId?: number;
}) => post({ action: 'set_user', ...payload });
