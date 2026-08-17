import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useChat } from '@/components/crm/chat/useChat';
import ChatAvatar from '@/components/crm/chat/ChatAvatar';
import { formatDateTime, formatTime } from '@/lib/dateUtils';

/** Отбивка «Сегодня / Вчера / дата» между сообщениями разных дней. */
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Сегодня';
  if (same(d, yesterday)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', timeZone: 'Europe/Moscow' });
};

// Время сообщений — московское, единое для всей системы: цех, склад и офис должны
// видеть одни и те же часы независимо от настроек своего устройства.
const timeOnly = (iso: string) => formatTime(iso);

const Chat = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { messages, loading, sending, send, hide, hasMore, loadingOlder, loadOlder } = useChat(
    user?.id,
    user?.name,
  );
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Человек отлистал вверх и читает старое — не дёргаем его вниз при новом сообщении.
  const stickToBottom = useRef(true);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  const handleSend = async () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    stickToBottom.current = true;
    try {
      await send(value);
    } catch (e) {
      setText(value);
      toast({
        title: 'Сообщение не отправлено',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleHide = async (id: number) => {
    try {
      await hide(id);
    } catch (e) {
      toast({
        title: 'Не удалось убрать сообщение',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const isAdmin = user?.role === 'admin';
  let lastDay = '';

  return (
    <CrmLayout>
      <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold">Чат сотрудников</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Общая переписка цехов и склада — вопросы по работе, а не крик через весь цех
          </p>
        </div>

        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-card p-4"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Icon name="Loader2" size={20} className="animate-spin" />
              Загружаем переписку...
            </div>
          ) : messages.length === 0 ? (
            <div className="py-12 text-center">
              <Icon name="MessagesSquare" size={40} className="mx-auto text-muted-foreground" />
              <p className="mt-3 font-semibold">Пока никто не написал</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Напишите первым — сообщение увидят все сотрудники
              </p>
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadOlder}
                    disabled={loadingOlder}
                  >
                    {loadingOlder ? 'Загружаем...' : 'Показать более старые'}
                  </Button>
                </div>
              )}
              {messages.map((m) => {
                const mine = m.userId === user?.id;
                const day = dayLabel(m.createdAt);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <div key={m.id}>
                    {showDay && (
                      <div className="my-3 flex items-center gap-3">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs text-muted-foreground">{day}</span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <div className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                      <ChatAvatar name={m.userName} url={m.avatarUrl} />
                      <div className={`min-w-0 max-w-[75%] ${mine ? 'items-end text-right' : ''}`}>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {mine ? 'Вы' : m.userName}
                          </span>
                          <span title={formatDateTime(m.createdAt)}>{timeOnly(m.createdAt)}</span>
                          {(mine || isAdmin) && (
                            <button
                              type="button"
                              onClick={() => handleHide(m.id)}
                              title="Убрать сообщение"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Icon name="Trash2" size={12} />
                            </button>
                          )}
                        </div>
                        <div
                          className={`mt-1 inline-block whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                            mine
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground'
                          }`}
                        >
                          {m.text}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter отправляет, Shift+Enter переносит строку — привычно по мессенджерам.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Написать сообщение..."
            rows={2}
            className="min-h-[52px] resize-none"
          />
          <Button
            size="lg"
            className="h-[52px] shrink-0"
            onClick={handleSend}
            disabled={sending || !text.trim()}
          >
            <Icon name={sending ? 'Loader2' : 'Send'} size={18} className={sending ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>
    </CrmLayout>
  );
};

export default Chat;
