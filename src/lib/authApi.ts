import type { Role } from '@/lib/roles';

const AUTH_URL = 'https://functions.poehali.dev/eca1843f-b794-48c6-a9e6-4dead2174136';

export interface TestAccount {
  id: number;
  name: string;
  role: Role;
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
}

export const fetchTestAccounts = async (): Promise<TestAccount[]> => {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test_accounts' }),
  });
  const data = await res.json();
  return data.accounts || [];
};

export interface BotUrls {
  max: string | null;
  telegram: string | null;
}

/** Публичные ссылки на ботов MAX и Telegram для кнопок входа на странице авторизации. */
export const fetchBotUrls = async (): Promise<BotUrls> => {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'bot_info' }),
  });
  const data = await res.json();
  return { max: data.botUrl || null, telegram: data.telegramBotUrl || null };
};

const postAuthAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(AUTH_URL, {
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

export interface UserRoleEntry {
  role: Role;
  isApproved: boolean;
}

/** Мессенджер, через который сотрудник входит в систему. */
export type Messenger = 'max' | 'telegram';

export interface MaxVerifyResult {
  id: number;
  name: string;
  phone: string | null;
  roles: UserRoleEntry[];
}

/** Проверяет код, присланный ботом MAX или Telegram. Возвращает пользователя и его должности. */
export const verifyMessengerCode = (
  code: string,
  messenger: Messenger
): Promise<MaxVerifyResult> =>
  postAuthAction({
    action: messenger === 'telegram' ? 'telegram_verify_code' : 'max_verify_code',
    code,
  });

/** Новый пользователь (без единой должности) выбирает желаемую роль — уходит на утверждение админом. */
export const selectDesiredRole = (userId: number, role: Role): Promise<{ success: true }> =>
  postAuthAction({ action: 'select_role', userId, role });

export interface EnterRoleResult {
  id: number;
  name: string;
  role: Role;
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
}

/** Вход в конкретную утверждённую роль пользователя — завершает авторизацию. */
export const enterRole = (userId: number, role: Role): Promise<EnterRoleResult> =>
  postAuthAction({ action: 'enter_role', userId, role });

export { AUTH_URL };
