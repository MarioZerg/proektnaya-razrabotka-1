const SALARY_URL = 'https://functions.poehali.dev/16c53065-6726-495b-9e59-70d16dd9328f';

export interface SalaryRate {
  id: number;
  role: string;
  materialId: number | null;
  materialName: string | null;
  width: number | null;
  rate: number;
}

export const fetchSalaryRates = async (): Promise<SalaryRate[]> => {
  const res = await fetch(`${SALARY_URL}?rates=1`);
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
  totalUnpaid: number;
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
  return res.json();
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
}

export const fetchMySalary = async (userId: number): Promise<MySalaryData> => {
  const res = await fetch(`${SALARY_URL}?my=1&userId=${userId}`);
  return res.json();
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

export interface PayoutResult {
  id: number;
  amount: number;
}

export const payoutSalary = (userId: number, actorId?: number, actorName?: string): Promise<PayoutResult> =>
  postAction({ action: 'payout', userId, actorId, actorName });
