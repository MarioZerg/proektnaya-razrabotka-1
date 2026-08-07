const SALARY_URL = 'https://functions.poehali.dev/16c53065-6726-495b-9e59-70d16dd9328f';

export interface SalaryRate {
  id: number;
  role: string;
  materialId: number | null;
  materialName: string | null;
  width: number | null;
  rate: number;
  workshopId: number;
  workshopName: string;
}

export const fetchSalaryRates = async (workshopId: number): Promise<SalaryRate[]> => {
  const res = await fetch(`${SALARY_URL}?rates=1&workshopId=${workshopId}`);
  const data = await res.json();
  return data.rates || [];
};

export interface SalaryOperation {
  id: number;
  userId: number;
  userName: string;
  type: string;
  amount: number;
  description: string;
  orderNumber: string | null;
  accruedFor: string;
  createdAt: string;
  paidAt: string | null;
}

export interface SalarySummary {
  operations: SalaryOperation[];
  totalCount: number;
  totalPages: number;
  /** Сумма ПОЛОЖИТЕЛЬНЫХ невыплаченных остатков — считается по каждому сотруднику
   * отдельно, затем суммируется, чтобы штраф одного не компенсировал незаметно премию
   * другого в общей цифре. Это то, что реально нужно выплатить. */
  totalToAccrue: number;
  /** Сумма ОТРИЦАТЕЛЬНЫХ невыплаченных остатков (штрафы превысили начисления) —
   * суммарный долг сотрудников компании. */
  totalDebts: number;
  period1Total: number;
  period2Total: number;
}

export const fetchSalarySummary = async (filters?: {
  userId?: number;
  type?: string;
  page?: number;
}): Promise<SalarySummary> => {
  const params = new URLSearchParams();
  if (filters?.userId) params.set('userId', String(filters.userId));
  if (filters?.type) params.set('type', filters.type);
  if (filters?.page) params.set('page', String(filters.page));
  const qs = params.toString();
  const res = await fetch(qs ? `${SALARY_URL}?${qs}` : SALARY_URL);
  const data = res.ok ? await res.json() : {};
  // Страница финансов рисует таблицу и суммы сразу из ответа. Если запрос не удался
  // (сеть моргнула, сервер ответил ошибкой), полей в ответе нет — без подстановки
  // пустых значений таблица падала и весь раздел становился белым экраном.
  return {
    operations: Array.isArray(data.operations) ? data.operations : [],
    totalCount: data.totalCount ?? 0,
    totalPages: data.totalPages ?? 1,
    totalToAccrue: data.totalToAccrue ?? 0,
    totalDebts: data.totalDebts ?? 0,
    period1Total: data.period1Total ?? 0,
    period2Total: data.period2Total ?? 0,
  };
};

export interface SalaryPayout {
  id: number;
  userId: number;
  userName: string;
  amount: number;
  paidAt: string;
  periodFrom: string | null;
  periodTo: string | null;
}

export const fetchSalaryPayouts = async (userId?: number): Promise<SalaryPayout[]> => {
  const params = new URLSearchParams({ payouts: '1' });
  if (userId) params.set('userId', String(userId));
  const res = await fetch(`${SALARY_URL}?${params.toString()}`);
  const data = await res.json();
  return data.payouts || [];
};

export interface MyAccrual {
  id: number;
  type: string;
  amount: number;
  description: string;
  orderNumber: string | null;
  accruedFor: string;
  createdAt: string;
  paidAt: string | null;
}

export interface MyPayout {
  id: number;
  amount: number;
  paidAt: string;
}

export interface MySalaryData {
  accruals: MyAccrual[];
  balance: number;
  payouts: MyPayout[];
  /** У новичков баланс закрыт первые 14 дней после регистрации. */
  salaryLocked?: boolean;
  /** Сколько дней осталось до открытия. */
  daysLeft?: number;
  /** Дата, когда баланс откроется сам. */
  unlockAt?: string | null;
}

export const fetchMySalary = async (userId: number): Promise<MySalaryData> => {
  const res = await fetch(`${SALARY_URL}?my=1&userId=${userId}`);
  const data = res.ok ? await res.json() : {};
  // Пустые списки вместо отсутствующих полей — иначе экран «Моя зарплата» падает.
  return {
    ...data,
    accruals: Array.isArray(data.accruals) ? data.accruals : [],
    payouts: Array.isArray(data.payouts) ? data.payouts : [],
    balance: data.balance ?? 0,
  };
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SALARY_URL, {
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

export const updateSalaryRate = (id: number, rate: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'update_rate', id, rate, actorId, actorName });

export const createManualAccrual = (payload: {
  userId: number;
  amount: number;
  description: string;
  actorId?: number;
  actorName?: string;
}) => postAction({ action: 'manual_accrual', ...payload });

export const createPenalty = (payload: {
  userId: number;
  amount: number;
  description: string;
  actorId?: number;
  actorName?: string;
}) => postAction({ action: 'penalty', ...payload });

export const deleteAccrual = (id: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'delete_accrual', id, actorId, actorName });

export const updateAccrual = (payload: {
  id: number;
  amount: number;
  description: string;
  actorId?: number;
  actorName?: string;
}) => postAction({ action: 'update_accrual', ...payload });

export interface PayoutResult {
  id: number;
  amount: number;
}

export const payoutSalary = (userId: number, actorId?: number, actorName?: string): Promise<PayoutResult> =>
  postAction({ action: 'payout', userId, actorId, actorName });

export const deletePayout = (id: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'delete_payout', id, actorId, actorName });

export interface CashBoxTransaction {
  id: number;
  amount: number;
  description: string;
  payoutId: number | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CashBoxData {
  balance: number;
  transactions: CashBoxTransaction[];
}

export const fetchCashBox = async (): Promise<CashBoxData> => {
  const res = await fetch(`${SALARY_URL}?cashBox=1`);
  const data = res.ok ? await res.json() : {};
  return {
    balance: data.balance ?? 0,
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
  };
};

export const cashDeposit = (payload: { amount: number; description: string; actorId?: number; actorName?: string }) =>
  postAction({ action: 'cash_deposit', ...payload });