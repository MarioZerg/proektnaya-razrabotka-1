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

/** Смена, за которую сделано начисление оклада (у сдельных начислений пусто). */
export interface AccrualShiftInfo {
  /** Цех, в котором сотрудник работал в эту смену. */
  shiftWorkshopName?: string | null;
  shiftNumber?: number | null;
  shiftOpenedAt?: string | null;
}

export interface SalaryOperation extends AccrualShiftInfo {
  id: number;
  userId: number;
  userName: string;
  type: string;
  amount: number;
  description: string;
  orderNumber: string | null;
  accruedFor: string;
  /** Оклад начислен за смену в чужом цехе — сотрудник работал гостем. */
  shiftIsGuest?: boolean;
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
  /** Сумма ВСЕХ невыплаченных удержаний по компании. В отличие от totalDebts
   * считается независимо от заработка: штраф в 170 ₽ при зарплате 32 000 ₽ не
   * уводит баланс в минус, и без этой строки он не виден в сводке нигде. */
  totalPenalties: number;
  /** Сколько всего записей-удержаний и по скольким сотрудникам. */
  penaltiesCount: number;
  penaltiesUsers: number;
  /** Удержания БЕЗ вины (спецодежда, выкуп товара, аванс) — часть totalPenalties,
   * но показывается отдельно: это не нарушения, а расчёты с сотрудником. */
  totalDeductions: number;
  deductionsCount: number;
  /** Кому реально есть что выплатить — с суммой остатка. */
  pendingPayouts: PendingPayout[];
  period1Total: number;
  period2Total: number;
  /** Сумма по ВСЕМ записям текущего фильтра (не только видимой страницы). */
  filteredTotal: number;
}

export const fetchSalarySummary = async (filters?: {
  userId?: number;
  type?: string;
  page?: number;
  /** Период начислений: по дате, ЗА которую начислено. */
  dateFrom?: string;
  dateTo?: string;
}): Promise<SalarySummary> => {
  const params = new URLSearchParams();
  if (filters?.userId) params.set('userId', String(filters.userId));
  if (filters?.type) params.set('type', filters.type);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
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
    totalPenalties: data.totalPenalties ?? 0,
    penaltiesCount: data.penaltiesCount ?? 0,
    penaltiesUsers: data.penaltiesUsers ?? 0,
    totalDeductions: data.totalDeductions ?? 0,
    deductionsCount: data.deductionsCount ?? 0,
    pendingPayouts: data.pendingPayouts ?? [],
    period1Total: data.period1Total ?? 0,
    period2Total: data.period2Total ?? 0,
    filteredTotal: data.filteredTotal ?? 0,
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
  /** Реквизиты на момент выплаты. */
  sbpPhone?: string;
  sbpBank?: string;
}

export const fetchSalaryPayouts = async (userId?: number): Promise<SalaryPayout[]> => {
  const params = new URLSearchParams({ payouts: '1' });
  if (userId) params.set('userId', String(userId));
  const res = await fetch(`${SALARY_URL}?${params.toString()}`);
  const data = await res.json();
  return data.payouts || [];
};

export interface MyAccrual extends AccrualShiftInfo {
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

/**
 * Удержание — списание БЕЗ вины сотрудника.
 *
 * Спецодежда, купленный у компании товар, материал для себя, погашение аванса.
 * Деньги вычитаются так же, как по штрафу, но в отчётах и в личном кабинете
 * это не наказание: человек рассчитывается за покупку, а не нарушил правило.
 */
export const createDeduction = (payload: {
  userId: number;
  amount: number;
  description: string;
  actorId?: number;
  actorName?: string;
}) => postAction({ action: 'deduction', ...payload });

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

/** Что выйдет к выплате за период — до нажатия кнопки. */
/** Сотрудник с невыплаченным остатком: только такие попадают в выбор выплаты. */
export interface PendingPayout {
  userId: number;
  fullName: string;
  amount: number;
}

export interface PayoutPreview {
  amount: number;
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  cashBalance: number;
  fullName?: string | null;
  /** Номер для перевода по СБП — сотрудник указал его при оформлении документов. */
  sbpPhone?: string;
  sbpBank?: string;
  /** Реквизиты сверены администратором. */
  sbpConfirmed?: boolean;
  /** Телефон входа: ориентир, если СБП не заполнен. */
  loginPhone?: string;
}

export const previewPayout = (
  userId: number,
  periodFrom?: string,
  periodTo?: string,
): Promise<PayoutPreview> =>
  postAction({ action: 'payout_preview', userId, periodFrom, periodTo });

export const payoutSalary = (
  userId: number,
  actorId?: number,
  actorName?: string,
  periodFrom?: string,
  periodTo?: string,
): Promise<PayoutResult> =>
  postAction({
    action: 'payout', userId, actorId, actorName, periodFrom, periodTo,
  });

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

/** Сотрудник, у которого есть выполненная работа без начисления. */
export interface MissedAccrual {
  userId: number;
  userName: string;
  /** Этап, за который не заплатили: Раскрой / Пошив / Стикеровка. */
  stage: string;
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
}

/** Убрать строку предупреждения о неначислении. Если у сотрудника на этом этапе
 * появятся НОВЫЕ незакрытые заказы, предупреждение вернётся само. */
export const dismissMissedAccrual = (
  item: { userId: number; stage: string; count: number },
  actorId?: number,
  actorName?: string,
) =>
  fetch(SALARY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'dismiss_missed_accrual',
      userId: item.userId,
      stage: item.stage,
      count: item.count,
      actorId,
      actorName,
    }),
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json()).error || 'Не удалось скрыть');
    return true;
  });

/** Доначислить зарплату за этапы, оставшиеся без начисления. Считает по тем же
 *  ставкам, что и обычное начисление. Возвращает, сколько начислено и на какую
 *  сумму, и сколько заказов пропущено из-за незаведённой ставки. */
export const accrueMissed = (
  item: { userId: number; stage: string },
  actorId?: number,
  actorName?: string,
): Promise<{ created: number; skipped: number; amount: number }> =>
  fetch(SALARY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'accrue_missed',
      userId: item.userId,
      stage: item.stage,
      actorId,
      actorName,
    }),
  }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Не удалось доначислить');
    return d;
  });

export const fetchMissedAccruals = async (): Promise<MissedAccrual[]> => {
  const res = await fetch(`${SALARY_URL}?missedAccruals=1`);
  const data = res.ok ? await res.json() : {};
  return Array.isArray(data.missed) ? data.missed : [];
};

export const cashDeposit = (payload: { amount: number; description: string; actorId?: number; actorName?: string }) =>
  postAction({ action: 'cash_deposit', ...payload });
/** Прогресс одной швеи в бонусной программе. */
export interface SewerBonusRow {
  userId: number;
  userName: string;
  /** Сдано на стикеровку за расчётный месяц, пог.м. */
  meters: number;
}

export interface SewerBonusInfo {
  /** upcoming — программа ещё не началась, active — идёт, finished — месяц закрыт. */
  state: 'upcoming' | 'active' | 'finished';
  periodFrom: string;
  periodTo: string;
  /** Сколько метров нужно сдать за месяц ради премии. */
  target: number;
  /** Размер премии в рублях. */
  amount: number;
  sewers: SewerBonusRow[];
}

/**
 * Бонусная программа швей: цель месяца и текущая выработка каждой.
 *
 * Этот же запрос запускает начисление премий за прошедший месяц — платформа не умеет
 * работать по расписанию, поэтому расчёт привязан к первому обращению в новом месяце.
 */
export const fetchSewerBonus = async (): Promise<SewerBonusInfo | null> => {
  const res = await fetch(`${SALARY_URL}?sewerBonus=1`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !Array.isArray(data.sewers)) return null;
  return data as SewerBonusInfo;
};

export interface SewerDailyInfo {
  /** На сегодня акции нет — карточку не показываем. */
  active: boolean;
  date: string;
  title: string;
  /** Сколько метров нужно сдать ЗА ДЕНЬ ради премии. */
  target: number;
  amount: number;
  sewers: SewerBonusRow[];
}

/**
 * Акция дня для швей: цель на сегодня и выработка каждой с начала дня.
 *
 * Отдельно от месячной премии: акции объявляются разово («сегодня 300 метров —
 * плюс тысяча»), живут один день и не отменяют месячную цель.
 */
export const fetchSewerDaily = async (): Promise<SewerDailyInfo | null> => {
  const res = await fetch(`${SALARY_URL}?sewerDaily=1`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.active || !Array.isArray(data.sewers)) return null;
  return data as SewerDailyInfo;
};