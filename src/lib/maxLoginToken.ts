/**
 * Метка входа через MAX: по ней страница ввода кода узнаёт, что бот выдал код.
 *
 * Раньше метка жила в sessionStorage — это память ОДНОЙ вкладки. Кнопка
 * «Вернуться на сайт» в MAX нередко открывает сайт в новой вкладке или во
 * встроенном браузере, и там метки не было: страница заводила новую, пустую, и
 * код не подставлялся. Теперь метка лежит в localStorage (общая для всех вкладок
 * сайта) и дополнительно приходит в адресе возврата (?t=...).
 */
const KEY = 'maxLoginToken';
/** Метка на сервере живёт 15 минут — дольше хранить её незачем. */
const TTL_MS = 15 * 60 * 1000;

const read = (storage: Storage): string | null => {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    if (!raw.startsWith('{')) return raw; // старый формат: просто метка
    const { token, at } = JSON.parse(raw) as { token?: string; at?: number };
    if (!token || !at || Date.now() - at > TTL_MS) return null;
    return token;
  } catch {
    return null;
  }
};

export const getMaxLoginToken = (): string | null => {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('t');
    if (fromUrl && /^[\w-]{10,64}$/.test(fromUrl)) return fromUrl;
  } catch {
    // адрес не разобрался — берём из памяти браузера
  }
  return read(localStorage) || read(sessionStorage);
};

export const setMaxLoginToken = (token: string) => {
  const value = JSON.stringify({ token, at: Date.now() });
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // приватный режим: остаётся адрес возврата и память вкладки
  }
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    // ничего страшного
  }
};

export const clearMaxLoginToken = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ничего страшного
  }
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ничего страшного
  }
};
