import type { Role } from '@/lib/roles';

const AUTH_URL = 'https://functions.poehali.dev/eca1843f-b794-48c6-a9e6-4dead2174136';

/**
 * Запрос с ограничением по времени.
 *
 * В цехе связь проседает, а у обычного fetch нет предела ожидания: браузер держит
 * запрос минутами, экран входа всё это время крутится и в конце показывает
 * «плохое соединение». Обрываем сами через 12 секунд — страница откроется, пусть
 * и без необязательных данных вроде счётчика смены.
 */
const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  ms = 12000
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export interface TestAccount {
  id: number;
  name: string;
  role: Role;
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
  /** Допуск к оверлоку: у швей таких аккаунта два — обычный и с допуском. */
  canOverlock?: boolean;
}

/** Что показать сотруднику при входе — одним запросом. */
export interface StartupInfo {
  /** Неподписанные договоры: пока есть, вместо страниц идёт экран подписания. */
  pendingContracts: number;
  /** Срок на загрузку документов вышел — доступ приостановлен. */
  docsBlocked: boolean;
  /** Счётчик подбора в меню кладовщика. */
  picking: number;
  /** Вещи «на руках»: отказы из цеха и возвраты, ждущие разбора. */
  awaitingShelf: number;
}

/**
 * Всё, что нужно для отрисовки меню при входе, — ОДНИМ вызовом.
 *
 * Раньше при каждом открытии системы уходило три отдельных запроса к трём разным
 * облачным функциям: договоры, документы и счётчик работы. Все три — про одного
 * человека, и все три решаются одним походом в базу.
 */
/**
 * Ответ на прошлый вопрос «есть ли неподписанные договоры и просрочены ли
 * документы» — вместе с тем, кого спрашивали, и временем ответа.
 *
 * Оболочка системы (меню, шапка) живёт ВНУТРИ каждой страницы, а не над ними:
 * при каждом переходе по разделам она создаётся заново и заново задаёт этот
 * вопрос. Кладовщик за смену обходит десятки экранов — и получал десятки
 * одинаковых ответов подряд, хотя договор подписывают один раз при устройстве,
 * а срок документов меряется месяцами.
 *
 * Держим ответ пять минут: за это время он не успеет устареть, а переходы по
 * разделам перестают дёргать сервер вовсе.
 */
let startupCache: { userId: number; role: string; at: number; data: StartupInfo } | null = null;
const STARTUP_TTL_MS = 5 * 60 * 1000;

/** Сбрасывает запомненный ответ — после подписания договора или загрузки документов. */
export const resetStartupInfoCache = () => {
  startupCache = null;
};

export const fetchStartupInfo = async (
  userId: number,
  role: string,
): Promise<StartupInfo> => {
  const fresh =
    startupCache &&
    startupCache.userId === userId &&
    startupCache.role === role &&
    Date.now() - startupCache.at < STARTUP_TTL_MS;
  if (fresh && startupCache) return startupCache.data;

  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'startup', userId, role }),
  });
  if (!res.ok) throw new Error('Не удалось загрузить данные входа');
  const data = (await res.json()) as StartupInfo;
  startupCache = { userId, role, at: Date.now(), data };
  return data;
};

export const fetchTestAccounts = async (): Promise<TestAccount[]> => {
  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test_accounts' }),
  });
  const data = await res.json();
  return data.accounts || [];
};

/** Публичная ссылка на бота MAX для кнопки «Войти через MAX». */
export interface MaxBotLink {
  /** Ссылка на бота с меткой этой вкладки: по ней бот узнаёт, куда вернуть код. */
  botUrl: string | null;
  loginToken: string | null;
}

export const fetchMaxBotUrl = async (): Promise<MaxBotLink> => {
  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'bot_info' }),
  });
  const data = await res.json();
  return { botUrl: data.botUrl || null, loginToken: data.loginToken || null };
};

export interface MaxLoginStatus {
  code: string | null;
  awaitingContact: boolean;
  expired: boolean;
}

/** Готов ли код входа: вкладка спрашивает об этом, пока человек в мессенджере. */
export const fetchMaxLoginStatus = async (loginToken: string): Promise<MaxLoginStatus> => {
  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'max_login_status', loginToken }),
  });
  const data = await res.json();
  return {
    code: data.code || null,
    awaitingContact: !!data.awaitingContact,
    expired: !!data.expired,
  };
};

export interface OnlineNow {
  total: number;
  byWorkshop: { workshop: string; count: number }[];
}

/** Сколько человек сейчас на смене — для экрана входа. Данные обезличенные: только числа. */
export const fetchOnlineNow = async (): Promise<OnlineNow> => {
  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'online_now' }),
  });
  const data = await res.json();
  return { total: data.total || 0, byWorkshop: data.byWorkshop || [] };
};

const postAuthAction = async (payload: Record<string, unknown>) => {
  const res = await fetchWithTimeout(AUTH_URL, {
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

// Заявка на доступ убрана с экрана входа: вход в систему только через MAX. Бот сам
// заводит нового человека по номеру телефона и присылает код, должность он выбирает
// на сайте. Серверное действие 'register_request' пока оставлено — на случай, если
// понадобится вернуть приём заявок для людей без MAX.

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

export interface ImpersonateResult extends EnterRoleResult {
  availableRoles: Role[];
}

/**
 * Вход администратора в аккаунт сотрудника — посмотреть его рабочую панель.
 *
 * Пароль сотрудника не нужен: права проверяет сервер по adminId. Возвращает такие же
 * данные сессии, как обычный вход, плюс все утверждённые должности — чтобы внутри
 * аккаунта можно было переключаться между ними.
 */
export const impersonateUser = (
  adminId: number,
  userId: number,
  role?: Role
): Promise<ImpersonateResult> =>
  postAuthAction({ action: 'impersonate', adminId, userId, role });

export { AUTH_URL };

/**
 * Проверяет, действует ли ещё доступ вошедшего сотрудника.
 *
 * Вход в систему бессрочный: человек авторизуется один раз и работает, пока
 * администратор не закроет доступ. Раз выхода нет, доступ нужно уметь отзывать —
 * приложение периодически сверяется с сервером и выходит само, если учётную запись
 * отключили или сняли должность.
 */
export const checkAccess = async (
  userId: number,
  role?: string
): Promise<{ active: boolean; reason?: string }> => {
  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'check_access', userId, role }),
  });
  if (!res.ok) return { active: true };
  return res.json();
};