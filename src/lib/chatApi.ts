import funcUrls from '../../backend/func2url.json';

/**
 * Чат живёт внутри функции сотрудников: тариф ограничивает число облачных функций,
 * и заводить отдельную ради переписки расточительно. Тема общая — люди.
 */
const CHAT_URL = (funcUrls as Record<string, string>).users;

export interface ChatMessage {
  id: number;
  userId: number;
  userName: string;
  text: string;
  createdAt: string;
  /** Фото автора: поставленное им самим в чате, загруженное админом или из профиля MAX. */
  avatarUrl?: string | null;
  /**
   * Сообщение показано у автора до ответа сервера.
   *
   * 'sending' — уходит, 'failed' — не дошло (можно повторить), нет поля — на сервере.
   * Пока сообщение не дошло, у него нет настоящего id, поэтому такие сообщения
   * живут только в браузере автора и нумеруются отрицательными числами, чтобы
   * никогда не столкнуться с настоящими id из базы.
   */
  status?: 'sending' | 'failed';
}

/** Кто сейчас смотрит в чат. */
export interface ChatPresenceUser {
  userId: number;
  userName: string;
  avatarUrl?: string | null;
}

/** Свой профиль: чтобы человек видел и мог сменить своё фото прямо в чате. */
export interface ChatMe {
  id: number;
  name: string;
  role: string;
  avatarUrl: string | null;
  /** Фото поставлено вручную — значит, его можно убрать (под ним может быть фото из MAX). */
  ownAvatar: boolean;
}

export interface ChatFeed {
  messages: ChatMessage[];
  hasMore: boolean;
  me: ChatMe | null;
  online: ChatPresenceUser[];
  typing: ChatPresenceUser[];
}

/** Ответ на опрос новых сообщений: сама добавка плюс живое состояние чата. */
export interface ChatUpdate {
  messages: ChatMessage[];
  online: ChatPresenceUser[];
  typing: ChatPresenceUser[];
}

const asMessages = (value: unknown): ChatMessage[] => (Array.isArray(value) ? value : []);
const asPeople = (value: unknown): ChatPresenceUser[] => (Array.isArray(value) ? value : []);

/** Последние сообщения ленты, свой профиль и кто сейчас на связи. */
export const fetchMessages = async (): Promise<ChatFeed> => {
  // ping=1 — заодно отмечаемся в чате: пусть остальные видят, что человек здесь.
  const res = await fetch(`${CHAT_URL}?chat=1&ping=1`);
  const data = res.ok ? await res.json() : {};
  return {
    messages: asMessages(data.messages),
    hasMore: Boolean(data.hasMore),
    me: (data.me as ChatMe | null) ?? null,
    online: asPeople(data.online),
    typing: asPeople(data.typing),
  };
};

interface PollOptions {
  /** Человек только что печатал — сообщаем это тем же запросом, без отдельного. */
  typing?: boolean;
  /** Пора обновить отметку «я в чате». */
  ping?: boolean;
}

/**
 * Только новые сообщения после известного id.
 *
 * Этим запросом лента живёт «в реальном времени»: он лёгкий и почти всегда
 * возвращает пустой список, поэтому его можно повторять часто. Отметки «я в чате»
 * и «я печатаю» едут в нём же — отдельных обращений к серверу ради зелёной точки
 * нет, каждый вызов облачной функции оплачивается.
 */
export const fetchNewMessages = async (
  sinceId: number,
  options: PollOptions = {},
): Promise<ChatUpdate> => {
  const extra = `${options.typing ? '&typing=1' : ''}${options.ping ? '&ping=1' : ''}`;
  const res = await fetch(`${CHAT_URL}?chat=1&since=${sinceId}${extra}`);
  const data = res.ok ? await res.json() : {};
  return {
    messages: asMessages(data.messages),
    online: asPeople(data.online),
    typing: asPeople(data.typing),
  };
};

/** Более старые сообщения — подгрузка истории вверх. */
export const fetchOlderMessages = async (
  beforeId: number,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> => {
  const res = await fetch(`${CHAT_URL}?chat=1&before=${beforeId}`);
  const data = res.ok ? await res.json() : {};
  return {
    messages: asMessages(data.messages),
    hasMore: Boolean(data.hasMore),
  };
};

/** Отправляет сообщение. Автора сервер определяет по ключу сессии, а не по телу запроса. */
export const sendMessage = async (text: string): Promise<ChatMessage> => {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'chat_send', text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отправить сообщение');
  return data.message;
};

/** Убрать сообщение из ленты: своё — автор, любое — администратор. */
export const hideMessage = async (id: number): Promise<void> => {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'chat_hide', id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось убрать сообщение');
};

/**
 * Ставит себе фото прямо из чата.
 *
 * Меняется только СВОЁ фото: чей аватар обновить, сервер берёт из ключа сессии.
 * base64 = null убирает загруженное фото — тогда снова показывается снимок из
 * профиля MAX, если он есть.
 */
export const saveOwnAvatar = async (
  base64: string | null,
): Promise<{ avatarUrl: string | null; ownAvatar: boolean }> => {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      base64 ? { action: 'chat_avatar', avatarBase64: base64 } : { action: 'chat_avatar', remove: true },
    ),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось сохранить фото');
  return { avatarUrl: data.avatarUrl ?? null, ownAvatar: Boolean(data.ownAvatar) };
};
