import { useCallback, useEffect, useState } from 'react';
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

const STATUS_TABS: { id: CandidateStatus; label: string }[] = [
  { id: 'new', label: 'Новые' },
  { id: 'selected', label: 'Отобранные' },
  { id: 'meeting', label: 'Договорились о встрече' },
  { id: 'rejected', label: 'Отклонённые' },
];

const MOVE_BUTTONS: { id: CandidateStatus; label: string }[] = [
  { id: 'selected', label: 'Отобрать' },
  { id: 'meeting', label: 'Встреча' },
  { id: 'rejected', label: 'Отклонить' },
  { id: 'new', label: 'Вернуть в новые' },
];

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
  const [threadTitle, setThreadTitle] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [folder, setFolder] = useState<CandidateStatus>('new');
  const [moving, setMoving] = useState(false);

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
    setSelectedId(id);
    setThreadLoading(true);
    fetchCandidateThread(id)
      .then((data) => {
        setThreadTitle(`${data.chat.candidateName} · ${data.chat.vacancyTitle}`);
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
  }, [toast]);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Диалоги по вакансиям Авито. После одного обновления новые сообщения приходят сами, а администраторам — уведомление в MAX.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void handleSync()} disabled={syncing}>
          <Icon
            name={syncing ? 'Loader2' : 'RefreshCw'}
            size={14}
            className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
          />
          Обновить с Авито
        </Button>
      </div>

      <Tabs value={folder} onValueChange={(value) => setFolder(value as CandidateStatus)}>
        <TabsList>
          {STATUS_TABS.map((item) => {
            const count = chats.filter((chat) => (chat.status || 'new') === item.id).length;
            return (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label} ({count})
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

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="max-h-[32rem] overflow-y-auto rounded-md border">
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
              className={`block w-full border-b px-3 py-3 text-left last:border-b-0 hover:bg-muted/60 ${
                selectedId === chat.id ? 'bg-muted' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {chat.unread ? '• ' : ''}
                  {chat.candidateName}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(chat.lastMessageAt)}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{chat.vacancyTitle}</div>
              <div className="truncate text-sm">{chat.lastMessage}</div>
            </button>
          ))}
        </div>

        <div className="flex min-h-[24rem] flex-col rounded-md border">
          {!selectedId && (
            <p className="p-4 text-sm text-muted-foreground">Выберите диалог слева.</p>
          )}
          {selectedId && (
            <>
              <div className="space-y-2 border-b px-4 py-3">
                <div className="text-sm font-medium">{threadTitle || 'Диалог'}</div>
                <div className="flex flex-wrap gap-2">
                  {MOVE_BUTTONS.filter((item) => item.id !== currentStatus).map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      size="sm"
                      variant={item.id === 'rejected' ? 'outline' : 'secondary'}
                      disabled={moving}
                      onClick={() => void handleStatus(item.id)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {threadLoading && <p className="text-sm text-muted-foreground">Загрузка переписки…</p>}
                {!threadLoading && messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
                )}
                {messages.map((message, index) => (
                  <div
                    key={`${message.createdAt}-${index}`}
                    className={`max-w-[80%] rounded-md px-3 py-2 text-sm ${
                      message.direction === 'out'
                        ? 'ml-auto bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <div>{message.text}</div>
                    <div className={`mt-1 text-xs ${message.direction === 'out' ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {formatWhen(message.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2 border-t p-3">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ответ кандидату"
                  rows={3}
                />
                <Button type="button" size="sm" onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
                  {sending ? 'Отправка…' : 'Отправить в Авито'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CandidateChatsPanel;
