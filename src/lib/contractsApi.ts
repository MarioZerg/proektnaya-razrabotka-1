import func2url from '../../backend/func2url.json';
import { cachedRequest, invalidateCache } from '@/lib/requestCache';

const CONTRACTS_URL = (func2url as Record<string, string>).contracts;

/**
 * Открывает договор так, чтобы в адресной строке был НАШ домен.
 *
 * Файл лежит во внешнем хранилище, и любая прямая ссылка — хоть на хранилище,
 * хоть на адрес функции — показывала бы сотруднику чужой домен. Под документом,
 * который человек подписывает с вашим ИП, это выглядит несерьёзно.
 *
 * Поэтому файл сначала скачивается в браузер, а открывается уже из памяти: в
 * строке адреса остаётся домен самой системы. Ссылку освобождаем через минуту —
 * этого хватает, чтобы вкладка успела показать документ.
 */
export const openContractFile = async (contractId: number, userId?: number) => {
  const res = await fetch(
    `${CONTRACTS_URL}?file=${contractId}&userId=${userId ?? ''}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Не удалось открыть документ');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    // Браузер заблокировал вкладку — тогда просто скачиваем файл, иначе
    // человек нажал кнопку и не увидел вообще ничего.
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dogovor.pdf';
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

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
/**
 * Есть ли у сотрудника неподписанные документы — вопрос на входе в систему.
 *
 * Ответ кэшируем на 5 минут: проверка идёт при появлении общего макета, а он
 * пересобирается на каждом переходе по меню. Без кэша человек, кликающий по
 * разделам, слал бы этот запрос десятки раз за смену — при том что договор
 * появляется раз в несколько месяцев.
 */
export const fetchPendingContracts = (userId: number): Promise<number> =>
  cachedRequest(
    `contracts:pending:${userId}`,
    async () => {
      const res = await fetch(`${CONTRACTS_URL}?pending=1&userId=${userId}`);
      const data = await res.json();
      return (data.pending || 0) as number;
    },
    5 * 60 * 1000,
  );

/** Админ загружает договор на сотрудника — документ сразу становится обязательным. */
export const createContract = (payload: {
  userId: number;
  title: string;
  fileBase64: string;
  fileName: string;
  actorId?: number;
  actorName?: string;
}) => {
  // Договор появился — сотрудник должен увидеть заслонку сразу, а не через
  // пять минут, пока держится кэш проверки.
  invalidateCache(`contracts:pending:${payload.userId}`);
  return postAction({ action: 'create', actorRole: 'admin', ...payload });
};

/** Сотрудник просит код подписи — бот присылает 6 цифр в MAX. */
export const sendSignCode = (contractId: number, userId: number) =>
  postAction({ action: 'send_code', contractId, userId });

/** Подпись договора кодом из MAX. */
export const signContract = async (
  contractId: number,
  userId: number,
  code: string,
) => {
  const r = (await postAction({ action: 'sign', contractId, userId, code })) as {
    success: true;
    title: string;
  };
  // Сбрасываем кэш: человек только что подписал, и заслонка должна пропустить
  // его сразу, а не через пять минут.
  invalidateCache(`contracts:pending:${userId}`);
  return r;
};

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
export const sendGeneratedContract = (userId: number, actorId: number, role?: string) => {
  invalidateCache(`contracts:pending:${userId}`);
  return postAction({ action: 'send_generated', userId, actorId, role }) as Promise<{
    id: number;
    fileUrl: string;
    title: string;
  }>;
};

/** Реквизиты ИП — подставляются в каждый договор. */
export interface CompanyRequisites {
  name: string;
  ogrnip: string;
  inn: string;
  address: string;
  phone: string;
  city: string;
}

export const fetchCompanyRequisites = async (
  actorId: number
): Promise<CompanyRequisites> => {
  const res = await fetch(`${CONTRACTS_URL}?company=1&actorId=${actorId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить реквизиты');
  return data;
};

export const saveCompanyRequisites = (
  actorId: number,
  values: CompanyRequisites
) => postAction({ action: 'save_company', actorId, ...values });