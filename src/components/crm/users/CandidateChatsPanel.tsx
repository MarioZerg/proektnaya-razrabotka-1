import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { useToast } from '@/hooks/use-toast';
import {
  fetchCandidateChats,
  fetchCandidateThread,
  sendCandidateReply,
  setCandidateStatus,
  syncCandidateChats,
  type CandidateChat,
  type CandidateMessage,
  type CandidateStatus,
} from '@/lib/candidateChatsApi';

const STATUS_TABS: { id: CandidateStatus; label: string; short: string }[] = [
  { id: 'new', label: 'Новые', short: 'Новые' },
  { id: 'selected', label: 'Отобранные', short: 'Отобранные' },
  { id: 'meeting', label: 'Договорились о встрече', short: 'Встреча' },
  { id: 'rejected', label: 'Отклонённые', short: 'Отказ' },
];

const MOVE_BUTTONS: { id: CandidateStatus; label: string }[] = [
  { id: 'selected', label: 'Отобрать' },
  { id: 'meeting', label: 'Встреча' },
  { id: 'rejected', label: 'Отклонить' },
  { id: 'new', label: 'Вернуть в новые' },
];

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]).join('');
  return (letters || '?').toUpperCase();
};

const formatWhen = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Диалоги с людьми, которые написали на вакансию в Авито.
 * Список живёт в базе, кнопка «Обновить» забирает новые чаты из кабинета.
 */
const CandidateChatsPanel = () => {
  const { toast } = useToast();
  const [chats, setChats] = useState<CandidateChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<CandidateMessage[]>([]);
  const [threadName, setThreadName] = useState('');
  const [threadVacancy, setThreadVacancy] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [folder, setFolder] = useState<CandidateStatus>('new');
  const [moving, setMoving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    fetchCandidateChats()
      .then((list) => {
        setError(null);
        setChats(list);
      })
      .catch((e) => {
        if (!quiet) setError(e instanceof Error ? e.message : 'Не удалось загрузить чаты');
      })
      .finally(() => {
        if (!quiet) setLoading(false);
      });
  }, []);

  const openChat = useCallback((id: number) => {
    const chat = chats.find((item) => item.id === id);
    if (chat) {
      setThreadName(chat.candidateName);
      setThreadVacancy(chat.vacancyTitle);
    }
    setSelectedId(id);
    setThreadLoading(true);
    fetchCandidateThread(id)
      .then((data) => {
        setThreadName(data.chat.candidateName);
        setThreadVacancy(data.chat.vacancyTitle);
        setMessages(data.messages);
        setChats((prev) => prev.map((chat) => (chat.id === id ? { ...chat, unread: false } : chat)));
      })
      .catch((e) => {
        toast({
          title: 'Диалог не открылся',
          description: e instanceof Error ? e.message : 'Ошибка',
          variant: 'destructive',
        });
      })
      .finally(() => setThreadLoading(false));
  }, [chats, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Список и открытый диалог читают базу. Новые реплики туда кладёт webhook
  // Авито, поэтому кнопку «Обновить» для каждого сообщения жать не нужно.
  useEffect(() => {
    const timer = window.setInterval(() => {
      load(true);
      if (!selectedId) return;
      fetchCandidateThread(selectedId, false)
        .then((data) => {
          setMessages(data.messages);
        })
        .catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, selectedId, threadLoading]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncCandidateChats();
      toast({
        title: 'Чаты обновлены',
        description: [
          `Диалогов по вакансиям: ${result.synced}.`,
          result.webhookError || 'Новые сообщения придут в MAX.',
          result.partial ? 'Самые старые чаты подтянутся при следующем нажатии.' : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      load();
      if (selectedId) openChat(selectedId);
    } catch (e) {
      toast({
        title: 'Авито не обновился',
        description: e instanceof Error ? e.message : 'Ошибка',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleStatus = async (status: CandidateStatus) => {
    if (!selectedId || moving) return;
    setMoving(true);
    try {
      await setCandidateStatus(selectedId, status);
      setChats((prev) => prev.map((chat) => (chat.id === selectedId ? { ...chat, status } : chat)));
      setFolder(status);
    } catch (e) {
      toast({
        title: 'Статус не сохранился',
        description: e instanceof Error ? e.message : 'Ошибка',
        variant: 'destructive',
      });
    } finally {
      setMoving(false);
    }
  };

  const handleSend = async () => {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      await sendCandidateReply(selectedId, draft.trim());
      setDraft('');
      openChat(selectedId);
    } catch (e) {
      toast({
        title: 'Сообщение не ушло',
        description: e instanceof Error ? e.message : 'Ошибка',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const visibleChats = chats.filter((chat) => (chat.status || 'new') === folder);
  const currentStatus = chats.find((chat) => chat.id === selectedId)?.status || 'new';

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className={selectedId ? 'hidden lg:flex lg:items-center lg:justify-between lg:gap-3' : 'flex items-center justify-between gap-2'}>
        <p className="hidden text-sm leading-relaxed text-muted-foreground lg:block">
          Диалоги по вакансиям. Новое сообщение само появляется здесь и приходит администраторам в MAX.
        </p>
        <Button type="button" variant="outline" size="sm" className="w-full rounded-full sm:w-auto" onClick={() => void handleSync()} disabled={syncing}>
          <Icon
            name={syncing ? 'Loader2' : 'RefreshCw'}
            size={14}
            className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
          />
          Обновить с Авито
        </Button>
      </div>

      <Tabs
        value={folder}
        onValueChange={(value) => setFolder(value as CandidateStatus)}
        className={selectedId ? 'hidden lg:block' : undefined}
      >
        <TabsList className="h-auto w-full justify-start gap-1 rounded-full bg-muted/70 p-1">
          {STATUS_TABS.map((item) => {
            const count = chats.filter((chat) => (chat.status || 'new') === item.id).length;
            return (
              <TabsTrigger key={item.id} value={item.id}>
                <span className="sm:hidden">{item.short}</span>
                <span className="hidden sm:inline">{item.label}</span>
                {' '}({count})
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {error && (
        <WarehouseFetchError
          title="Не удалось загрузить чаты"
          description={error}
          onRetry={load}
        />
      )}

      <div className="lg:grid lg:h-[min(40rem,calc(100dvh-14rem))] lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden lg:rounded-2xl lg:border lg:bg-card lg:shadow-sm">
        <div className={`max-h-[70dvh] overflow-y-auto bg-card lg:max-h-none lg:border-r ${selectedId ? 'hidden lg:block' : 'rounded-2xl border shadow-sm lg:rounded-none lg:border-0 lg:shadow-none'}`}>
          {loading && <p className="p-4 text-sm text-muted-foreground">Загрузка…</p>}
          {!loading && visibleChats.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {folder === 'new'
                ? 'Новых диалогов нет. Нажмите «Обновить с Авито», если кандидаты уже писали.'
                : 'В этом списке пока никого нет.'}
            </p>
          )}
          {visibleChats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => openChat(chat.id)}
              className={`flex w-full gap-3 border-b border-border/70 px-3 py-3.5 text-left last:border-b-0 active:bg-muted/80 ${
                selectedId === chat.id ? 'bg-primary/10' : 'hover:bg-muted/50'
              }`}
            >
              <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {initials(chat.candidateName)}
                {chat.unread && (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-card" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{chat.candidateName}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatWhen(chat.lastMessageAt)}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-primary/80">{chat.vacancyTitle}</span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">{chat.lastMessage || 'Нет сообщений'}</span>
              </span>
            </button>
          ))}
        </div>

        <div
          className={`min-h-0 flex-col bg-[#f4f1ea] lg:flex ${
            selectedId
              ? 'fixed inset-x-0 bottom-0 top-14 z-40 flex lg:static lg:z-auto'
              : 'hidden'
          }`}
        >
          {!selectedId && (
            <p className="p-4 text-sm text-muted-foreground">Выберите диалог слева.</p>
          )}
          {selectedId && (
            <>
              <div className="shrink-0 space-y-2 border-b bg-card/95 px-3 py-2.5 backdrop-blur-md sm:px-4 sm:py-3">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 rounded-full px-2 lg:hidden"
                    onClick={() => setSelectedId(null)}
                  >
                    <Icon name="ArrowLeft" size={16} />
                  </Button>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials(threadName || 'К')}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{threadName || 'Диалог'}</div>
                    <div className="truncate text-xs text-muted-foreground">{threadVacancy}</div>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {MOVE_BUTTONS.filter((item) => item.id !== currentStatus).map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      size="sm"
                      className="shrink-0"
                      variant={item.id === 'rejected' ? 'outline' : 'secondary'}
                      disabled={moving}
                      onClick={() => void handleStatus(item.id)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
                {threadLoading && <p className="text-sm text-muted-foreground">Загрузка переписки…</p>}
                {!threadLoading && messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
                )}
                {messages.map((message, index) => (
                  <div
                    key={`${message.createdAt}-${index}`}
                    className={`max-w-[85%] px-3.5 py-2 text-sm break-words shadow-sm ${
                      message.direction === 'out'
                        ? 'ml-auto rounded-2xl rounded-br-md bg-primary text-primary-foreground'
                        : 'rounded-2xl rounded-bl-md border border-border/80 bg-card'
                    }`}
                  >
                    <div>{message.text}</div>
                    <div className={`mt-1 text-xs ${message.direction === 'out' ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {formatWhen(message.createdAt)}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="shrink-0 border-t bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Написать кандидату"
                    rows={2}
                    className="min-h-[46px] flex-1 resize-none rounded-2xl bg-background text-base"
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-full"
                    aria-label="Отправить"
                    onClick={() => void handleSend()}
                    disabled={sending || !draft.trim()}
                  >
                    <Icon name={sending ? 'Loader2' : 'Send'} size={18} className={sending ? 'animate-spin' : ''} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CandidateChatsPanel;
