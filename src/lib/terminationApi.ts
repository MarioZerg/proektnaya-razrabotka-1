import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>).termination;

/**
 * Расторжение договора ГПХ по инициативе сотрудника.
 *
 * Порядок повторяет раздел 5 договора: заявление → подпись Акта кодом из MAX →
 * подтверждение администратора → закрытие доступа. Аккаунт при этом остаётся:
 * по договору прекращение доступа — техническая мера, а не отказ от расчётов.
 */
export type TerminationStatus =
  | 'pending_sign'
  | 'pending_admin'
  | 'confirmed'
  | 'rejected'
  | 'cancelled';

export interface Termination {
  id: number;
  status: TerminationStatus;
  terminationDate: string;
  reason: string | null;
  createdAt: string;
  signedAt: string | null;
  rejectReason: string | null;
  rejectedAt: string | null;
  confirmedAt: string | null;
  fileName: string | null;
}

export interface UnfinishedOrder {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
}

export interface TerminationState {
  current: Termination | null;
  /** Заказы в работе: пока они есть, расторгнуть договор нельзя (п. 5.3). */
  unfinishedOrders: UnfinishedOrder[];
  /** Срок предупреждения по договору, дней. */
  noticeDays: number;
  /** Дата прекращения, если подать заявление сегодня. */
  plannedDate: string;
}

export interface PendingTermination {
  id: number;
  userId: number;
  fullName: string;
  role: string;
  status: TerminationStatus;
  terminationDate: string;
  reason: string | null;
  createdAt: string;
  signedAt: string | null;
  fileUrl: string | null;
  fileName: string | null;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const fetchTerminationState = async (
  userId: number,
): Promise<TerminationState> => {
  const res = await fetch(`${URL}?userId=${userId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить');
  return data;
};

/** Заявления, которые ждут решения администратора. */
export const fetchPendingTerminations = async (
  actorId: number,
): Promise<PendingTermination[]> => {
  const res = await fetch(`${URL}?pending=1&actorId=${actorId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить');
  return data.items || [];
};

export const requestTermination = (userId: number, reason?: string) =>
  post({ action: 'request', userId, reason });

export const sendTerminationCode = (terminationId: number, userId: number) =>
  post({ action: 'send_code', terminationId, userId });

export const signTermination = (
  terminationId: number,
  userId: number,
  code: string,
) => post({ action: 'sign', terminationId, userId, code });

export const cancelTermination = (terminationId: number, userId: number) =>
  post({ action: 'cancel', terminationId, userId });

export const confirmTermination = (terminationId: number, actorId: number) =>
  post({ action: 'confirm', terminationId, actorId });

export const rejectTermination = (
  terminationId: number,
  actorId: number,
  reason: string,
) => post({ action: 'reject', terminationId, actorId, reason });
