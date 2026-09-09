/**
 * Ключ сессии: по нему сервер узнаёт, кто делает запрос.
 *
 * Раньше исполнителя передавали прямо в теле запроса — id и роль. Сотрудник мог
 * открыть консоль браузера, отправить запрос с ролью «администратор» и списать
 * материал от чужого имени. Спрятанная кнопка от этого не спасает: кнопку можно
 * не нажимать, а запрос отправить напрямую.
 *
 * Теперь при входе сервер выдаёт случайный ключ и запоминает его у себя. Он
 * хранится здесь и сам подставляется в каждый запрос к нашему серверу — см.
 * resilientFetch. Подделать его нельзя: сервер сверяет ключ со своей таблицей.
 */

const TOKEN_KEY = 'megatul_token';
/** Ключ администратора, отложенный на время просмотра чужой панели. */
const ADMIN_TOKEN_KEY = 'megatul_admin_token';

export const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Приватный режим браузера может запрещать хранилище — работаем без ключа.
    return null;
  }
};

export const setAuthToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Не смогли сохранить — не роняем вход, просто работаем в этой вкладке.
  }
};

/** Админ уходит смотреть панель сотрудника: свой ключ откладываем, чтобы вернуться. */
export const stashAdminToken = () => {
  try {
    const current = localStorage.getItem(TOKEN_KEY);
    if (current) localStorage.setItem(ADMIN_TOKEN_KEY, current);
  } catch {
    // см. выше
  }
};

/** Возврат в свой аккаунт: достаём отложенный ключ администратора. */
export const restoreAdminToken = () => {
  try {
    const saved = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (saved) {
      localStorage.setItem(TOKEN_KEY, saved);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // см. выше
  }
};

export const clearAuthToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // см. выше
  }
};
