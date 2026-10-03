import { askMegabuhDigest, type AiMessage } from '@/lib/aiAssistantApi';
import { megabuhApiRole, type Role } from '@/lib/roles';

/** Событие: сводка готова и чат сейчас открыт — хук допишет пузырь в состояние. */
export const MEGABUH_DIGEST_EVENT = 'megabuh-digest';

const chatKey = (userId: number, role: string) => `ai-assistant-chat:v3:${userId}:${role}`;
const digestKey = (userId: number, role: string) => `ai-assistant-digest:v1:${userId}:${role}`;
const activityKey = (userId: number, role: string) => `ai-assistant-activity:v1:${userId}:${role}`;

const BUSY_KEY = 'megabuh-chat-busy';
const OPEN_KEY = 'megabuh-chat-open';

/** Пока бухгалтер печатает или ждёт ответ — сводку в ленту не кладём. */
const IDLE_MS = 90_000;

type DigestState = {
  lastCheckDay?: string;
  lastToastDay?: string;
  pending?: { content: string; at: number; digestDay: string } | null;
};

export const moscowDay = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export const setMegabuhChatOpen = (open: boolean) => {
  try {
    if (open) sessionStorage.setItem(OPEN_KEY, '1');
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    /* ignore */
  }
};

export const setMegabuhBusy = (busy: boolean) => {
  try {
    if (busy) sessionStorage.setItem(BUSY_KEY, '1');
    else sessionStorage.removeItem(BUSY_KEY);
  } catch {
    /* ignore */
  }
};

export const markMegabuhActivity = (userId: number, role: string) => {
  try {
    localStorage.setItem(activityKey(userId, role), String(Date.now()));
  } catch {
    /* ignore */
  }
};

/** Диалог идёт: бухгалтер в чате и либо ждёт ответ, либо недавно писал. */
export const isMegabuhDialogue = (userId: number, role: string, pathname: string): boolean => {
  if (pathname !== '/crm/chat') return false;
  try {
    if (sessionStorage.getItem(BUSY_KEY) === '1') return true;
    const last = Number(localStorage.getItem(activityKey(userId, role)) || 0);
    if (last && Date.now() - last < IDLE_MS) return true;
  } catch {
    return true;
  }
  return false;
};

const readDigest = (userId: number, role: string): DigestState => {
  try {
    const raw = localStorage.getItem(digestKey(userId, role));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeDigest = (userId: number, role: string, state: DigestState) => {
  localStorage.setItem(digestKey(userId, role), JSON.stringify(state));
};

const readChat = (userId: number, role: string): AiMessage[] => {
  try {
    const raw = localStorage.getItem(chatKey(userId, role));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeChat = (userId: number, role: string, messages: AiMessage[]) => {
  localStorage.setItem(chatKey(userId, role), JSON.stringify(messages.slice(-80)));
};

export const alreadyHasDigest = (messages: AiMessage[], day: string) =>
  messages.some((m) => m.kind === 'news' && m.digestDay === day);

const isQuiet = (answer: string, quiet?: boolean) => {
  if (quiet) return true;
  const t = answer.trim().toUpperCase();
  return t === 'NO_NEWS' || t.startsWith('NO_NEWS');
};

export const makeNewsMessage = (content: string, day: string, at = Date.now()): AiMessage => ({
  role: 'assistant',
  content,
  at,
  kind: 'news',
  digestDay: day,
});

/**
 * Кладём сводку в сохранённый чат, если страница чата закрыта.
 * Если чат открыт — только событие: иначе перезапись из React сотрёт пузырь.
 */
export const deliverDigestMessage = (userId: number, role: string, message: AiMessage) => {
  const day = message.digestDay || moscowDay();
  try {
    if (sessionStorage.getItem(OPEN_KEY) === '1') {
      window.dispatchEvent(new CustomEvent(MEGABUH_DIGEST_EVENT, { detail: { message } }));
      return;
    }
  } catch {
    /* fall through to storage */
  }
  const chat = readChat(userId, role);
  if (alreadyHasDigest(chat, day)) return;
  writeChat(userId, role, [...chat, message]);
};

export const peekPendingDigest = (userId: number, role: string) => {
  const state = readDigest(userId, role);
  return state.pending || null;
};

export const markDigestToastShown = (userId: number, role: string, day: string) => {
  const state = readDigest(userId, role);
  writeDigest(userId, role, { ...state, lastToastDay: day, pending: null });
};

export const shouldToastDigest = (userId: number, role: string, day: string) => {
  const state = readDigest(userId, role);
  return state.lastToastDay !== day;
};

/** Нужно ли сегодня ходить на площадки. */
export const needsDigestCheck = (userId: number, role: string) => {
  const state = readDigest(userId, role);
  return state.lastCheckDay !== moscowDay();
};

/**
 * Один запрос в сутки. Новостей нет — запоминаем день и молчим.
 * Есть — кладём в pending, доставку делает сторож, когда чат свободен.
 */
export const runMegabuhDigestCheck = async (userId: number, role: string): Promise<AiMessage | null> => {
  const day = moscowDay();
  const state = readDigest(userId, role);
  if (state.lastCheckDay === day) {
    if (state.pending?.digestDay === day) {
      return makeNewsMessage(state.pending.content, day, state.pending.at);
    }
    return null;
  }

  const r = await askMegabuhDigest(userId, megabuhApiRole(role as Role) ?? (role as Role));
  const answer = (r.answer || '').trim();
  if (!answer || isQuiet(answer, r.quiet)) {
    writeDigest(userId, role, { ...state, lastCheckDay: day, pending: null });
    return null;
  }

  const pending = { content: answer, at: Date.now(), digestDay: day };
  writeDigest(userId, role, { ...state, lastCheckDay: day, pending });
  return makeNewsMessage(pending.content, day, pending.at);
};
