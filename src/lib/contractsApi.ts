import func2url from '../../backend/func2url.json';

const CONTRACTS_URL = (func2url as Record<string, string>).contracts;

export interface Contract {
  id: number;
  userId: number;
  userName: string;
  title: string;
  fileUrl: string;
  fileName: string | null;
  /** pending — ждёт подписи, signed — подписан, cancelled — отозван администратором. */
  status: 'pending' | 'signed' | 'cancelled';
  createdAt: string;
  signedAt: string | null;
  signedPhone: string | null;
}

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(CONTRACTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось выполнить действие');
  return data;
};

/** Договоры конкретного сотрудника — его личная вкладка «Договоры». */
export const fetchMyContracts = async (userId: number): Promise<Contract[]> => {
  const res = await fetch(`${CONTRACTS_URL}?userId=${userId}`);
  const data = await res.json();
  return data.contracts || [];
};

/** Все договоры всех сотрудников — только для администратора. Роль проверяется на
 * сервере по actorId, поэтому подменить её на стороне браузера нельзя. */
export const fetchAllContracts = async (actorId: number): Promise<Contract[]> => {
  const res = await fetch(`${CONTRACTS_URL}?all=1&actorId=${actorId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Нет доступа');
  return data.contracts || [];
};

/** Сколько документов ждут подписи. Пока больше нуля — система для сотрудника закрыта. */
export const fetchPendingContracts = async (userId: number): Promise<number> => {
  const res = await fetch(`${CONTRACTS_URL}?pending=1&userId=${userId}`);
  const data = await res.json();
  return data.pending || 0;
};

/** Админ загружает договор на сотрудника — документ сразу становится обязательным. */
export const createContract = (payload: {
  userId: number;
  title: string;
  fileBase64: string;
  fileName: string;
  actorId?: number;
  actorName?: string;
}) => postAction({ action: 'create', actorRole: 'admin', ...payload });

/** Сотрудник просит код подписи — бот присылает 6 цифр в MAX. */
export const sendSignCode = (contractId: number, userId: number) =>
  postAction({ action: 'send_code', contractId, userId });

/** Подпись договора кодом из MAX. */
export const signContract = (contractId: number, userId: number, code: string) =>
  postAction({ action: 'sign', contractId, userId, code }) as Promise<{
    success: true;
    title: string;
  }>;

/** Админ отзывает ошибочно загруженный документ — блокировка снимается. */
export const cancelContract = (id: number) =>
  postAction({ action: 'cancel', id, actorRole: 'admin' });

/** Роли, для которых система умеет собирать договор сама. */
export const ROLES_WITH_TEMPLATE = [
  'sewer',
  'cutter',
  'storekeeper',
  'senior_storekeeper',
  'packer',
] as const;

/** Собирает договор из шаблона роли и данных сотрудника, но НЕ отправляет:
 * админ сначала смотрит, что попало в документ. */
export const previewGeneratedContract = (userId: number, actorId: number, role?: string) =>
  postAction({ action: 'preview_generated', userId, actorId, role }) as Promise<{
    fileUrl: string;
    title: string;
    preview: true;
  }>;

/** Отправляет собранный договор сотруднику на подпись. */
export const sendGeneratedContract = (userId: number, actorId: number, role?: string) =>
  postAction({ action: 'send_generated', userId, actorId, role }) as Promise<{
    id: number;
    fileUrl: string;
    title: string;
  }>;
