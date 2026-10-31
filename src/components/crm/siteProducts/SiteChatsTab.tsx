import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchSiteChat,
  fetchSiteChats,
  markSiteChatRead,
  sendSiteChatMessage,
  SITE_CHAT_CHANGED,
  type SiteChat,
} from '@/lib/siteOrdersApi';

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map((p) => p[0]).join('') || '?').toUpperCase();
};

const formatWhen = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const clientName = (c: SiteChat) => c.client?.name || c.client?.phone || 'Покупатель';

/**
 * Чат поддержки мегатюль.рф. Покупатель пишет из личного кабинета, админ
 * отвечает отсюда — ответ появляется у покупателя в течение 15 секунд.
 */
const SiteChatsTab = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const actor = { id: user?.id, name: user?.name };
  const [chats, setChats] = useState<SiteChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SiteChat | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [orderNumber, setOrderNumber] = useState<string>('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (quiet = false) => {
      if (!quiet) setLoading(true);
      fetchSiteChats({ id: user?.id, name: user?.name })
        .then((d) => {
          setError(null);
          setChats(d.chats);
        })
        .catch((e) => {
          if (!quiet) setError(e instanceof Error ? e.message : 'Не удалось загрузить чаты');
        })
        .finally(() => {
          if (!quiet) setLoading(false);
        });
    },
    [user?.id, user?.name],
  );

  const loadThread = useCallback(
    (id: string, quiet = false) => {
      if (!quiet) setThreadLoading(true);
      fetchSiteChat(id, { id: user?.id, name: user?.name })
        .then((d) => {
          setThread(d.chat);
          if ((d.chat.unread || 0) > 0) {
            markSiteChatRead(id, { id: user?.id, name: user?.name })
              .then(() => {
                setChats((prev) => prev.map((c) => (c.accountId === id ? { ...c, unread: 0 } : c)));
                window.dispatchEvent(new Event(SITE_CHAT_CHANGED));
              })
              .catch(() => {});
          }
        })
        .catch((e) => {
          if (!quiet)
            toast({
              title: 'Диалог не открылся',
              description: e instanceof Error ? e.message : undefined,
              variant: 'destructive',
            });
        })
        .finally(() => {
          if (!quiet) setThreadLoading(false);
        });
    },
    [toast, user?.id, user?.name],
  );

  const openChat = (id: string) => {
    const c = chats.find((x) => x.accountId === id) || null;
    setSelectedId(id);
    setThread(c);
    setOrderNumber('');
    loadThread(id);
  };

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => {
      load(true);
      if (selectedId) loadThread(selectedId, true);
    }, 15000);
    return () => window.clearInterval(t);
  }, [load, loadThread, selectedId]);

  const messages = thread?.messages || [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, selectedId]);

  const handleSend = async () => {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      await sendSiteChatMessage(selectedId, draft.trim(), actor, orderNumber || null);
      setDraft('');
      loadThread(selectedId, true);
      load(true);
      window.dispatchEvent(new Event(SITE_CHAT_CHANGED));
    } catch (e) {
      toast({
        title: 'Сообщение не ушло',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const orders = thread?.orders || [];
  const totalUnread = chats.reduce((s, c) => s + (c.unread || 0), 0);

  return (
    <div className="space-y-3">
      <div className={selectedId ? 'hidden lg:flex lg:items-center lg:justify-between lg:gap-3' : 'flex items-center justify-between gap-2'}>
        <p className="text-sm text-muted-foreground">
          Покупатели пишут из личного кабинета на сайте.
          {totalUnread > 0 ? ` Непрочитанных: ${totalUnread}.` : ''}
        </p>
        <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => load()} disabled={loading}>
          <Icon name={loading ? 'Loader2' : 'RefreshCw'} size={14} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      {error && <WarehouseFetchError title="Не удалось загрузить чаты" description={error} onRetry={() => load()} />}

      <div className="lg:grid lg:h-[min(40rem,calc(100dvh-16rem))] lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden lg:rounded-2xl lg:border lg:bg-card lg:shadow-sm">
        <div
          className={`max-h-[70dvh] overflow-y-auto bg-card lg:max-h-none lg:border-r ${
            selectedId ? 'hidden lg:block' : 'rounded-2xl border shadow-sm lg:rounded-none lg:border-0 lg:shadow-none'
          }`}
        >
          {loading && chats.length === 0 && <p className="p-4 text-sm text-muted-foreground">Загрузка…</p>}
          {!loading && !error && chats.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Покупатели пока не писали.</p>
          )}
          {chats.map((c) => (
            <button
              key={c.accountId}
              type="button"
              onClick={() => openChat(c.accountId)}
              className={`flex w-full gap-3 border-b border-border/70 px-3 py-3.5 text-left last:border-b-0 active:bg-muted/80 ${
                selectedId === c.accountId ? 'bg-primary/10' : 'hover:bg-muted/50'
              }`}
            >
              <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {initials(clientName(c))}
                {c.unread > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-card">
                    {c.unread}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread > 0 ? 'font-bold' : 'font-semibold'}`}>{clientName(c)}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatWhen(c.updatedAt)}</span>
                </span>
                {c.client?.phone && c.client?.name && (
                  <span className="mt-0.5 block truncate text-xs text-primary/80">{c.client.phone}</span>
                )}
                <span className={`mt-0.5 block truncate text-sm ${c.unread > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {c.lastMessage?.from === 'support' ? 'Вы: ' : ''}
                  {c.lastMessage?.text || 'Нет сообщений'}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div
          className={`min-h-0 flex-col bg-[#f4f1ea] lg:flex ${
            selectedId ? 'fixed inset-x-0 bottom-0 top-14 z-40 flex lg:static lg:z-auto' : 'hidden'
          }`}
        >
          {!selectedId && <p className="p-4 text-sm text-muted-foreground">Выберите диалог слева.</p>}
          {selectedId && (
            <>
              <div className="shrink-0 space-y-2 border-b bg-card/95 px-3 py-2.5 backdrop-blur-md sm:px-4 sm:py-3">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="shrink-0 rounded-full px-2 lg:hidden" onClick={() => setSelectedId(null)}>
                    <Icon name="ArrowLeft" size={16} />
                  </Button>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials(thread ? clientName(thread) : 'П')}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{thread ? clientName(thread) : 'Диалог'}</div>
                    {thread?.client?.phone && (
                      <a href={`tel:${thread.client.phone}`} className="truncate text-xs text-primary hover:underline">
                        {thread.client.phone}
                      </a>
                    )}
                  </div>
                </div>
                {orders.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {orders.map((o) => (
                      <button
                        key={o.number}
                        type="button"
                        onClick={() => setOrderNumber(orderNumber === o.number ? '' : o.number)}
                        title={(o.items || []).map((i) => `${i.name} ${i.size || ''} × ${i.qty}`).join('\n')}
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition ${
                          orderNumber === o.number
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background hover:bg-muted'
                        }`}
                      >
                        {o.number}
                        {o.total ? ` · ${o.total.toLocaleString('ru-RU')} ₽` : ''}
                        {o.city ? ` · ${o.city}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
                {threadLoading && messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Загрузка переписки…</p>
                )}
                {!threadLoading && messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
                )}
                {messages.map((m) => {
                  const out = m.from === 'support';
                  return (
                    <div
                      key={m.id}
                      className={`max-w-[85%] break-words px-3.5 py-2 text-sm shadow-sm ${
                        out
                          ? 'ml-auto rounded-2xl rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-2xl rounded-bl-md border border-border/80 bg-card'
                      }`}
                    >
                      {m.orderNumber && (
                        <div className={`mb-1 text-[11px] font-semibold ${out ? 'text-primary-foreground/80' : 'text-primary'}`}>
                          Заказ {m.orderNumber}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className={`mt-1 text-xs ${out ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                        {out && m.author ? `${m.author} · ` : ''}
                        {formatWhen(m.at)}
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              <div className="shrink-0 border-t bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
                {orderNumber && (
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon name="Package" size={12} />
                    Ответ по заказу {orderNumber}
                    <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setOrderNumber('')}>
                      убрать
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleSend();
                    }}
                    placeholder="Ответить покупателю"
                    rows={2}
                    className="min-h-[46px] flex-1 resize-none rounded-2xl bg-background text-base"
                  />
                  <Button
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

export default SiteChatsTab;
