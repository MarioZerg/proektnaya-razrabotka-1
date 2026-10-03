import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isMegamagRole } from '@/lib/roles';
import {
  givenName,
  prepareChatUploads,
  type AiMessage,
  type AiNote,
  type AiUpload,
} from '@/lib/aiAssistantApi';
import { askMarketplaceAssistant } from '@/lib/marketplaceAssistantApi';

/** Кусок вопроса для подписи «что ищем» — без длинных вводных. */
const searchTopic = (text: string) => {
  const clean = text
    .replace(/\s+/g, ' ')
    .replace(/^(пожалуйста|подскажи|скажи|помоги|разбери|проверь|найди|покажи)\s+/i, '')
    .trim();
  if (!clean) return '';
  return clean.length > 72 ? `${clean.slice(0, 69)}…` : clean;
};

/** Официальный хаб справки по вопросу — для статуса «Пошёл смотреть…». */
const sourceHub = (text: string) => {
  const low = text.toLowerCase();
  if (/wildberries|\bwb\b|вб|вайлд/.test(low)) {
    return 'https://seller.wildberries.ru/instructions';
  }
  if (/яндекс|yandex|\bym\b/.test(low) && /маркет|справк|правил|партн|логист|заказ/.test(low)) {
    return 'https://partner.market.yandex.ru';
  }
  if (/ozon|озон|docs\.ozon|seller-edu/.test(low)) {
    return 'https://docs.ozon.ru';
  }
  if (/модерац|справк|правил|инструкц|требован|fbo|fbs|упаков|приёмк|приемк|комисси/.test(low)) {
    return 'https://docs.ozon.ru';
  }
  return '';
};

/** Статус: при поиске по справке — «Пошёл смотреть информацию: ссылка». */
const searchStatus = (text: string, fileNames: string[] = []) => {
  if (fileNames.length) {
    const names = fileNames.join(', ');
    const short = names.length > 56 ? `${names.slice(0, 53)}…` : names;
    return `Читаю ваш файл: ${short}`;
  }
  const hub = sourceHub(text);
  if (hub) return `Пошёл смотреть информацию: ${hub}`;
  const topic = searchTopic(text);
  return topic ? `Ищу вашу информацию: ${topic}` : 'Ищу вашу информацию…';
};

const MAX_STORED = 80;
const MAX_NOTES = 40;

const storageKey = (userId: number) => `megamag-chat:v1:${userId}`;
const notesKey = (userId: number) => `megamag-notes:v1:${userId}`;

const readStored = (key: string): AiMessage[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is AiMessage =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    ).map((m) => ({
      role: m.role,
      content: m.content,
      at: typeof m.at === 'number' ? m.at : undefined,
      files: Array.isArray(m.files)
        ? m.files.filter((f) => f && typeof f.name === 'string').map((f) => ({
          name: f.name,
          size: typeof f.size === 'number' ? f.size : undefined,
        }))
        : undefined,
      docExcerpt: typeof m.docExcerpt === 'string' ? m.docExcerpt.slice(0, 6000) : undefined,
    }));
  } catch {
    return [];
  }
};

const readNotes = (key: string): AiNote[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is AiNote =>
        n
        && typeof n.id === 'string'
        && typeof n.savedAt === 'number'
        && typeof n.question === 'string'
        && typeof n.answer === 'string',
    );
  } catch {
    return [];
  }
};

const revealDuration = (len: number) => Math.min(5200, Math.max(1400, len * 16));

type ChatApi = {
  canAsk: boolean;
  agentName: string;
  youName: string;
  placeholder: string;
  stages: string[];
  messages: AiMessage[];
  typing: string | null;
  question: string;
  setQuestion: (v: string) => void;
  loading: boolean;
  busy: boolean;
  error: string | null;
  hydrated: boolean;
  notes: AiNote[];
  pendingFiles: AiUpload[];
  bottomRef: React.RefObject<HTMLDivElement | null>;
  send: (text: string) => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  removePending: (name: string, index: number) => void;
  reset: () => void;
  saveNote: (question: string, answer: string) => void;
  removeNote: (id: string) => void;
};

const Ctx = createContext<ChatApi | null>(null);

export const MarketplaceAssistantProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [notes, setNotes] = useState<AiNote[]>([]);
  const [pendingFiles, setPendingFiles] = useState<AiUpload[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const persistRef = useRef(false);
  const cancelType = useRef(false);

  const role = user?.role;
  const canAsk = isMegamagRole(role);
  const youName = givenName(user?.name);
  const agentName = 'МЕГАМАГ';
  const placeholder = 'Спросить...';
  const busy = loading || typing !== null;

  useEffect(() => {
    persistRef.current = false;
    setHydrated(false);
    if (!user?.id) {
      setMessages([]);
      setNotes([]);
      setPendingFiles([]);
      setHydrated(true);
      return;
    }
    setMessages(readStored(storageKey(user.id)));
    setNotes(readNotes(notesKey(user.id)));
    setPendingFiles([]);
    setHydrated(true);
    persistRef.current = true;
  }, [user?.id]);

  useEffect(() => {
    if (!persistRef.current || !user?.id) return;
    localStorage.setItem(storageKey(user.id), JSON.stringify(messages.slice(-MAX_STORED)));
  }, [messages, user?.id]);

  useEffect(() => {
    if (!hydrated || !persistRef.current || !user?.id) return;
    localStorage.setItem(notesKey(user.id), JSON.stringify(notes.slice(0, MAX_NOTES)));
  }, [notes, hydrated, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, typing, loading, stages]);

  const saveNote = (q: string, answer: string) => {
    const text = q.trim();
    if (!text) return;
    setNotes((prev) => {
      const without = prev.filter((n) => n.question !== text);
      const note: AiNote = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        savedAt: Date.now(),
        question: text,
        answer,
      };
      return [note, ...without].slice(0, MAX_NOTES);
    });
  };

  const removeNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const typeOut = (full: string) =>
    new Promise<void>((resolve) => {
      cancelType.current = false;
      const total = full.length;
      if (total === 0) {
        setTyping(null);
        resolve();
        return;
      }
      const duration = revealDuration(total);
      const started = Date.now();
      const tick = () => {
        if (cancelType.current) {
          resolve();
          return;
        }
        const p = Math.min(1, (Date.now() - started) / duration);
        const eased = 1 - (1 - p) * (1 - p);
        const n = Math.max(1, Math.floor(eased * total));
        setTyping(full.slice(0, n));
        if (p < 1) {
          window.setTimeout(tick, 24);
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: full, at: Date.now() }]);
          setTyping(null);
          resolve();
        }
      };
      setTyping('');
      tick();
    });

  const send = async (text: string) => {
    const uploads = pendingFiles;
    const display = text.trim();
    const q = display || (uploads.length
      ? 'Прочитайте выгрузку с маркетплейса и разберите: свод, топ проблемных, рекомендации и экономику.'
      : '');
    if ((!q && uploads.length === 0) || busy || !user?.id || !canAsk) return;
    setError(null);
    setQuestion('');
    setPendingFiles([]);
    const history = messages;
    const userMsg: AiMessage = {
      role: 'user',
      content: display || (uploads.length ? '' : q),
      at: Date.now(),
      files: uploads.map((f) => ({ name: f.name, size: f.size })),
    };
    setMessages([...history, userMsg]);
    setStages([searchStatus(display || q, uploads.map((f) => f.name))]);
    setLoading(true);
    try {
      const r = await askMarketplaceAssistant(
        q,
        user.id,
        history,
        role,
        uploads,
        (status) => setStages([status]),
      );
      if (r.docExcerpt) {
        setMessages((prev) =>
          prev.map((m) =>
            m.at === userMsg.at && m.role === 'user' ? { ...m, docExcerpt: r.docExcerpt } : m,
          ),
        );
      }
      setLoading(false);
      setStages([]);
      await typeOut(r.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'МЕГАМАГ не ответил');
      setLoading(false);
      setStages([]);
    }
  };

  const addFiles = async (files: File[]) => {
    if (busy || files.length === 0) return;
    const { uploads, error: err } = await prepareChatUploads(files, pendingFiles.length);
    if (uploads.length) setPendingFiles((prev) => [...prev, ...uploads]);
    setError(err);
  };

  const removePending = (_name: string, index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const reset = () => {
    cancelType.current = true;
    setMessages([]);
    setError(null);
    setStages([]);
    setTyping(null);
    setLoading(false);
    setPendingFiles([]);
    if (user?.id) localStorage.removeItem(storageKey(user.id));
  };

  const value: ChatApi = {
    canAsk,
    agentName,
    youName,
    placeholder,
    stages,
    messages,
    typing,
    question,
    setQuestion,
    loading,
    busy,
    error,
    hydrated,
    notes,
    pendingFiles,
    bottomRef,
    send,
    addFiles,
    removePending,
    reset,
    saveNote,
    removeNote,
  };

  return createElement(Ctx.Provider, { value }, children);
};

export const useMarketplaceAssistant = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMarketplaceAssistant must be used within MarketplaceAssistantProvider');
  return ctx;
};
