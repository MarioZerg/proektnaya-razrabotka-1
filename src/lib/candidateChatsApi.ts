import { getAuthToken } from '@/lib/authToken';

const USERS_URL = 'https://functions.poehali.dev/1db3a89a-f0f6-470e-bef4-fb5ca8fa02df';

export type CandidateStatus = 'new' | 'selected' | 'meeting' | 'rejected';

export interface CandidateChat {
  id: number;
  candidateName: string;
  vacancyTitle: string;
  vacancyUrl: string;
  lastMessage: string;
  lastMessageAt: string | null;
  unread: boolean;
  status: CandidateStatus;
}

export interface CandidateMessage {
  direction: 'in' | 'out';
  text: string;
  createdAt: string | null;
}

const authHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) headers['X-Auth-Token'] = token;
  return headers;
};

const readError = async (res: Response): Promise<string> => {
  try {
    const data = await res.json();
    return data.error || 'Ошибка запроса';
  } catch {
    return 'Ошибка запроса';
  }
};

export const fetchCandidateChats = async (): Promise<CandidateChat[]> => {
  const res = await fetch(`${USERS_URL}?candidateChats=1`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return (data.chats || []).map((chat: CandidateChat) => ({
    ...chat,
    status: chat.status || 'new',
  }));
};

export const fetchCandidateThread = async (
  chatId: number,
  live = true,
): Promise<{ chat: Pick<CandidateChat, 'id' | 'candidateName' | 'vacancyTitle' | 'vacancyUrl'>; messages: CandidateMessage[] }> => {
  const liveFlag = live ? '1' : '0';
  const res = await fetch(`${USERS_URL}?candidateChat=${chatId}&live=${liveFlag}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
};

export const syncCandidateChats = async (): Promise<{ synced: number; webhookError?: string; partial?: boolean }> => {
  const res = await fetch(USERS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: 'candidate_chats_sync' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось обновить чаты');
  return { synced: data.synced || 0, webhookError: data.webhookError || '' };
};

export const setCandidateStatus = async (
  chatId: number,
  status: CandidateStatus,
): Promise<void> => {
  const res = await fetch(USERS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: 'candidate_chat_status', chatId, status }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось сменить статус');
};

export const sendCandidateReply = async (chatId: number, text: string): Promise<void> => {
  const res = await fetch(USERS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: 'candidate_chat_send', chatId, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отправить сообщение');
};
