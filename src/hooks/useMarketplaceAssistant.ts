import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isMegamagRole } from '@/lib/roles';
import { givenName, type AiMessage, type AiNote } from '@/lib/aiAssistantApi';
import { askMarketplaceAssistant } from '@/lib/marketplaceAssistantApi';

const STAGES = [
  { delay: 0, label: 'Читаю ваш вопрос' },
  { delay: 800, label: 'Смотрю кабинеты магазинов' },
  { delay: 2200, label: 'Сверяю карточки и SEO со справкой' },
  { delay: 4500, label: 'Смотрю рекламу и что требует внимания' },
  { delay: 7000, label: 'Печатаю ответ' },
];

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
  bottomRef: React.RefObject<HTMLDivElement | null>;
  send: (text: string) => Promise<void>;
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const persistRef = useRef(false);
  const cancelType = useRef(false);

  const role = user?.role;
  const canAsk = isMegamagRole(role);
  const youName = givenName(user?.name);
  const agentName = 'МЕГАМАГ';
  const placeholder = 'Спросить про витрину, SEO, рекламу...';
  const busy = loading || typing !== null;

  useEffect(() => {
    persistRef.current = false;
    setHydrated(false);
    if (!user?.id) {
      setMessages([]);
      setNotes([]);
      setHydrated(true);
      return;
    }
    setMessages(readStored(storageKey(user.id)));
    setNotes(readNotes(notesKey(user.id)));
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
    if (!loading) {
      setStages([]);
      return undefined;
    }
    const timers = STAGES.map((s) =>
      window.setTimeout(() => setStages((prev) => [...prev, s.label]), s.delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [loading]);

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
    const q = text.trim();
    if (!q || busy || !user?.id || !canAsk) return;
    setError(null);
    setQuestion('');
    const history = messages;
    const userMsg: AiMessage = { role: 'user', content: q, at: Date.now() };
    setMessages([...history, userMsg]);
    setLoading(true);
    try {
      const r = await askMarketplaceAssistant(q, user.id, history, role);
      setLoading(false);
      setStages([]);
      await typeOut(r.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'МЕГАМАГ не ответил');
      setLoading(false);
      setStages([]);
    }
  };

  const reset = () => {
    cancelType.current = true;
    setMessages([]);
    setError(null);
    setStages([]);
    setTyping(null);
    setLoading(false);
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
    bottomRef,
    send,
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
