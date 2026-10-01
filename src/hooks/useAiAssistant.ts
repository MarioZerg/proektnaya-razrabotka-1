import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isMegabuhRole } from '@/lib/roles';
import { askAiAssistant, givenName, prepareChatUploads, type AiMessage, type AiNote, type AiUpload } from '@/lib/aiAssistantApi';
import { playMegabuhReplySound, primeMegabuhSound } from '@/lib/megabuhSound';
import {
  alreadyHasDigest,
  MEGABUH_DIGEST_EVENT,
  markMegabuhActivity,
  setMegabuhBusy,
  setMegabuhChatOpen,
} from '@/lib/megabuhDigest';

const ACCOUNTANT_STAGES = [
  { delay: 0, label: 'Читаю ваш вопрос' },
  { delay: 800, label: 'Обдумываю, как подойти' },
  { delay: 2000, label: 'Ищу в 1С, СБИС, Диадоке и Точке' },
  { delay: 4200, label: 'Сверяю законы и справку маркетплейса' },
  { delay: 7000, label: 'Печатаю ответ' },
];

const DOCUMENT_STAGES = [
  { delay: 0, label: 'Открываю документ' },
  { delay: 700, label: 'Читаю суммы и реквизиты' },
  { delay: 2000, label: 'Сверяю с НК РФ и 402-ФЗ' },
  { delay: 4200, label: 'Собираю проводки и первичку' },
  { delay: 7000, label: 'Печатаю ответ' },
];

const MAX_STORED = 80;
const MAX_NOTES = 40;

const storageKey = (userId: number, role: string) => `ai-assistant-chat:v3:${userId}:${role}`;
const notesKey = (userId: number, role: string) => `ai-assistant-notes:v1:${userId}:${role}`;

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
      kind: m.kind === 'news' ? 'news' : undefined,
      digestDay: typeof m.digestDay === 'string' ? m.digestDay : undefined,
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
  isAccountant: boolean;
  agentName: string;
  youName: string;
  greeting: string;
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

const AiAssistantContext = createContext<ChatApi | null>(null);

/**
 * Переписка с МЕГАБУХ: бухгалтер, учёт и программы.
 * История лежит в браузере.
 */
export const AiAssistantProvider = ({ children }: { children: ReactNode }) => {
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
  const sendingDocs = useRef(false);

  const role = user?.role;
  const isAccountant = isMegabuhRole(role);
  const canAsk = isMegabuhRole(role);
  const youName = givenName(user?.name);
  const agentName = 'МЕГАБУХ';
  const placeholder = 'Спросить...';
  const greeting = youName
    ? `${youName}, это МЕГАБУХ — я на связи`
    : 'Это МЕГАБУХ — я на связи';

  const busy = loading || typing !== null;

  useEffect(() => {
    persistRef.current = false;
    setHydrated(false);
    if (!user?.id || !role) {
      setMessages([]);
      setNotes([]);
      setHydrated(true);
      return;
    }
    setMessages(readStored(storageKey(user.id, role)));
    setNotes(readNotes(notesKey(user.id, role)));
    setPendingFiles([]);
    setHydrated(true);
    persistRef.current = true;
  }, [user?.id, role]);

  useEffect(() => {
    if (!persistRef.current || !user?.id || !role) return;
    localStorage.setItem(storageKey(user.id, role), JSON.stringify(messages.slice(-MAX_STORED)));
  }, [messages, user?.id, role]);

  useEffect(() => {
    if (!hydrated || !persistRef.current || !user?.id || !role) return;
    localStorage.setItem(notesKey(user.id, role), JSON.stringify(notes.slice(0, MAX_NOTES)));
  }, [notes, hydrated, user?.id, role]);

  const saveNote = (question: string, answer: string) => {
    const q = question.trim();
    if (!q) return;
    setNotes((prev) => {
      const without = prev.filter((n) => n.question !== q);
      const note: AiNote = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        savedAt: Date.now(),
        question: q,
        answer: answer.trim(),
      };
      return [note, ...without].slice(0, MAX_NOTES);
    });
  };

  const removeNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, stages, typing]);

  useEffect(() => {
    setMegabuhBusy(loading || typing !== null);
  }, [loading, typing]);

  useEffect(() => {
    if (!user?.id || !role) return undefined;
    setMegabuhChatOpen(true);
    markMegabuhActivity(user.id, role);
    const onNews = (event: Event) => {
      const message = (event as CustomEvent).detail?.message as AiMessage | undefined;
      if (!message?.content) return;
      const day = message.digestDay || '';
      setMessages((prev) => (alreadyHasDigest(prev, day) ? prev : [...prev, message]));
    };
    window.addEventListener(MEGABUH_DIGEST_EVENT, onNews);
    return () => {
      setMegabuhChatOpen(false);
      setMegabuhBusy(false);
      window.removeEventListener(MEGABUH_DIGEST_EVENT, onNews);
    };
  }, [user?.id, role]);

  useEffect(() => {
    if (!user?.id || !role) return;
    markMegabuhActivity(user.id, role);
  }, [question, user?.id, role]);

  useEffect(() => {
    if (!loading) return;
    const list = sendingDocs.current ? DOCUMENT_STAGES : ACCOUNTANT_STAGES;
    setStages([list[0].label]);
    const timers = list.slice(1).map((s) =>
      window.setTimeout(() => {
        setStages((prev) => (prev.includes(s.label) ? prev : [...prev, s.label]));
      }, s.delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [loading]);

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
          playMegabuhReplySound();
          resolve();
        }
      };
      setTyping('');
      tick();
    });

  const send = async (text: string) => {
    const uploads = pendingFiles;
    const display = text.trim();
    const q = display || (uploads.length ? 'Прочитайте документ и разберите по делу.' : '');
    if ((!q && uploads.length === 0) || busy || !user?.id || !canAsk) return;
    primeMegabuhSound();
    if (role) markMegabuhActivity(user.id, role);
    sendingDocs.current = uploads.length > 0;
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
    setLoading(true);
    try {
      const r = await askAiAssistant(q, user.id, history, role, uploads);
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
      setError(e instanceof Error ? e.message : 'Помощник не ответил');
      setLoading(false);
      setStages([]);
    } finally {
      sendingDocs.current = false;
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
    if (user?.id && role) localStorage.removeItem(storageKey(user.id, role));
  };

  const value: ChatApi = {
    canAsk,
    isAccountant,
    agentName,
    youName,
    greeting,
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

  return createElement(AiAssistantContext.Provider, { value }, children);
};

export const useAiAssistant = () => {
  const ctx = useContext(AiAssistantContext);
  if (!ctx) throw new Error('useAiAssistant must be used within AiAssistantProvider');
  return ctx;
};
