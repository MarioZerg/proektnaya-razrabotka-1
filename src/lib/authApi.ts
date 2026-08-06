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

/** Публичная ссылка на бота MAX для кнопки «Войти через MAX». */
export const fetchMaxBotUrl = async (): Promise<string | null> => {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'bot_info' }),
  });
  const data = await res.json();
  return data.botUrl || null;
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

export interface MaxVerifyResult {
  id: number;
  name: string;
  phone: string | null;
  roles: UserRoleEntry[];
}

/** Проверяет код, присланный ботом MAX. Возвращает пользователя и список его должностей. */
export const verifyMaxCode = (code: string): Promise<MaxVerifyResult> =>
  postAuthAction({ action: 'max_verify_code', code });

export interface RegistrationForm {
  fullName: string;
  role: Role;
  email: string;
  phone: string;
}

/** Новый сотрудник заполняет анкету (ФИО, должность, почта, телефон) — заявка уходит
 * на утверждение администратором. */
export const submitRegistration = (
  userId: number,
  form: RegistrationForm
): Promise<{ success: true }> =>
  postAuthAction({ action: 'select_role', userId, ...form });

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
