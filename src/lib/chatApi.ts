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
  /** Фото автора: загруженное администратором или из профиля MAX. */
  avatarUrl?: string | null;
}

/** Последние сообщения ленты. */
export const fetchMessages = async (): Promise<{
  messages: ChatMessage[];
  hasMore: boolean;
}> => {
  const res = await fetch(`${CHAT_URL}?chat=1`);
  const data = res.ok ? await res.json() : {};
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    hasMore: Boolean(data.hasMore),
  };
};

/**
 * Только новые сообщения после известного id.
 *
 * Этим запросом лента живёт «в реальном времени»: он лёгкий и почти всегда
 * возвращает пустой список, поэтому его можно повторять часто.
 */
export const fetchNewMessages = async (sinceId: number): Promise<ChatMessage[]> => {
  const res = await fetch(`${CHAT_URL}?chat=1&since=${sinceId}`);
  const data = res.ok ? await res.json() : {};
  return Array.isArray(data.messages) ? data.messages : [];
};

/** Более старые сообщения — подгрузка истории вверх. */
export const fetchOlderMessages = async (
  beforeId: number,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> => {
  const res = await fetch(`${CHAT_URL}?chat=1&before=${beforeId}`);
  const data = res.ok ? await res.json() : {};
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    hasMore: Boolean(data.hasMore),
  };
};

export const sendMessage = async (
  userId: number,
  userName: string,
  text: string,
): Promise<ChatMessage> => {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'chat_send', userId, userName, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отправить сообщение');
  return data.message;
};

/** Убрать сообщение из ленты: своё — автор, любое — администратор. */
export const hideMessage = async (id: number, actorId: number): Promise<void> => {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'chat_hide', id, actorId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось убрать сообщение');
};
