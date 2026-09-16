import { useCallback, useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useChat } from '@/components/crm/chat/useChat';
import ChatAvatarDialog from '@/components/crm/chat/ChatAvatarDialog';
import ChatComposer from '@/components/crm/chat/ChatComposer';
import ChatHeader from '@/components/crm/chat/ChatHeader';
import ChatMessageRow from '@/components/crm/chat/ChatMessageRow';
import { continuesGroup, dayLabel, typingText, unreadText } from '@/components/crm/chat/chatShared';

/** Насколько близко к концу ленты человек считается «читающим последние сообщения». */
const BOTTOM_ZONE = 120;

/** За сколько до верха ленты начинаем подтягивать старую переписку. */
const TOP_ZONE = 200;

const Chat = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    messages,
    loading,
    hasMore,
    loadingOlder,
    online,
    typing,
    offline,
    me,
    savingAvatar,
    send,
    retry,
    hide,
    loadOlder,
    notifyTyping,
    setMyAvatar,
  } = useChat(user?.id);

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);
  // Человек листает историю — показываем кнопку возврата к концу переписки.
  const [atBottom, setAtBottom] = useState(true);

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Человек отлистал вверх и читает старое — не дёргаем его вниз при новом сообщении.
  const stickToBottom = useRef(true);
  // Самое свежее сообщение, которое человек уже видел на экране.
  const seenIdRef = useRef(0);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const markSeen = useCallback(() => {
    const last = messages[messages.length - 1];
    if (last && last.id > seenIdRef.current) seenIdRef.current = last.id;
    setUnread(0);
    setFirstUnreadId(null);
  }, [messages]);

  /**
   * Подгрузка старой переписки с сохранением места.
   *
   * Сообщения добавляются СВЕРХУ, поэтому лента под пальцем уезжает вниз на всю
   * высоту добавленного. Запоминаем расстояние до конца ленты, а восстанавливаем его
   * ниже — эффектом, который срабатывает уже после того, как браузер разместил новые
   * сообщения. Тогда строка, которую человек читал, остаётся точно на месте.
   */
  const restoreFromBottom = useRef<number | null>(null);

  const handleLoadOlder = useCallback(async () => {
    const el = listRef.current;
    restoreFromBottom.current = el ? el.scrollHeight - el.scrollTop : null;
    await loadOlder();
  }, [loadOlder]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_ZONE;
    stickToBottom.current = bottom;
    setAtBottom(bottom);
    if (bottom) markSeen();
    // Долистали почти до начала — подтягиваем историю сами, без кнопки: пролистать
    // смену назад пальцем и есть самое естественное «показать раньше».
    if (el.scrollTop < TOP_ZONE && hasMore && !loadingOlder) handleLoadOlder();
  };

  // Новые сообщения: если человек внизу — прокручиваем к ним, если читает старое —
  // считаем непрочитанные и предлагаем спуститься кнопкой, но экран не трогаем.
  useEffect(() => {
    if (!messages.length) return;
    // Пришла старая история, а не новое сообщение — вниз не прокручиваем ни в каком
    // случае: место в переписке восстанавливает эффект ниже.
    if (restoreFromBottom.current !== null) return;
    if (stickToBottom.current && !document.hidden) {
      markSeen();
      scrollToBottom();
      return;
    }
    const fresh = messages.filter((m) => m.id > seenIdRef.current && m.userId !== user?.id);
    setUnread(fresh.length);
    setFirstUnreadId(fresh.length ? fresh[0].id : null);
    // markSeen меняется вместе с messages — в зависимостях он избыточен и вызывал бы
    // повторный проход по всей ленте на каждое сообщение.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, user?.id, scrollToBottom]);

  // Место в переписке после подгрузки истории. Эффект стоит последним: он должен
  // сработать уже после того, как решение о прокрутке к концу ленты принято выше.
  useEffect(() => {
    const el = listRef.current;
    if (!el || restoreFromBottom.current === null) return;
    el.scrollTop = el.scrollHeight - restoreFromBottom.current;
    restoreFromBottom.current = null;
  }, [messages]);

  const handleSend = async (text: string) => {
    stickToBottom.current = true;
    try {
      await send(text, user?.name || 'Сотрудник');
    } catch (e) {
      toast({
        title: 'Сообщение не отправлено',
        description: e instanceof Error ? e.message : 'Проверьте связь и повторите',
        variant: 'destructive',
      });
      throw e;
    }
  };

  const handleRetry = async (id: number) => {
    try {
      await retry(id);
    } catch (e) {
      toast({
        title: 'Всё ещё не отправляется',
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

  const handleAvatarSave = async (base64: string | null) => {
    await setMyAvatar(base64);
    toast({ title: base64 ? 'Фото обновлено' : 'Фото убрано' });
  };

  const isAdmin = user?.role === 'admin';
  const onlineIds = new Set(online.map((p) => p.userId));
  const typingLine = typingText(typing);
  let lastDay = '';

  return (
    <CrmLayout>
      <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
        <ChatHeader
          online={online}
          offline={offline}
          me={me}
          myName={user?.name || 'Вы'}
          onAvatarClick={() => setAvatarOpen(true)}
        />

        <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-card">
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="h-full space-y-2 overflow-y-auto overscroll-contain p-4"
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
                  <div className="flex justify-center pb-2">
                    <Button variant="ghost" size="sm" onClick={handleLoadOlder} disabled={loadingOlder}>
                      {loadingOlder ? (
                        <>
                          <Icon name="Loader2" size={14} className="mr-2 animate-spin" />
                          Загружаем...
                        </>
                      ) : (
                        'Показать более старые'
                      )}
                    </Button>
                  </div>
                )}

                {messages.map((m, i) => {
                  const day = dayLabel(m.createdAt);
                  const showDay = day !== lastDay;
                  lastDay = day;
                  const grouped = !showDay && continuesGroup(m, messages[i - 1]);
                  const mine = m.userId === user?.id;
                  return (
                    <div key={m.id} className={grouped ? '' : 'pt-1.5'}>
                      {showDay && (
                        <div className="my-3 flex items-center gap-3">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-xs text-muted-foreground">{day}</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      {m.id === firstUnreadId && (
                        <div className="my-3 flex items-center gap-3">
                          <div className="h-px flex-1 bg-primary/40" />
                          <span className="text-xs font-medium text-primary">Новые сообщения</span>
                          <div className="h-px flex-1 bg-primary/40" />
                        </div>
                      )}
                      <ChatMessageRow
                        message={m}
                        mine={mine}
                        grouped={grouped}
                        online={onlineIds.has(m.userId)}
                        canHide={mine || isAdmin}
                        onHide={() => handleHide(m.id)}
                        onRetry={() => handleRetry(m.id)}
                        onAvatarClick={() => setAvatarOpen(true)}
                      />
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Кнопка возврата к концу ленты. Появляется только когда человек ушёл
              наверх: иначе она закрывала бы последнее сообщение просто так. */}
          {!atBottom && !loading && messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                stickToBottom.current = true;
                setAtBottom(true);
                markSeen();
                scrollToBottom(true);
              }}
              className={`absolute bottom-4 right-4 flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium shadow-lg transition ${
                unread > 0
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card text-muted-foreground'
              }`}
            >
              <Icon name="ArrowDown" size={14} />
              {unread > 0 ? unreadText(unread) : 'К последним'}
            </button>
          )}
        </div>

        {/* Строка «печатает» стоит между лентой и полем ввода и держит свою высоту:
            появляясь и исчезая, она иначе подпрыгивала бы вместе с лентой. */}
        <div className="flex h-4 items-center px-1 text-xs text-muted-foreground">
          {typingLine && (
            <span className="flex items-center gap-1.5">
              <Icon name="PenLine" size={12} className="animate-pulse" />
              {typingLine}...
            </span>
          )}
        </div>

        <ChatComposer onSend={handleSend} onTyping={notifyTyping} />
      </div>

      <ChatAvatarDialog
        open={avatarOpen}
        onOpenChange={setAvatarOpen}
        name={user?.name || 'Вы'}
        currentUrl={me?.avatarUrl ?? null}
        ownAvatar={Boolean(me?.ownAvatar)}
        saving={savingAvatar}
        onSave={handleAvatarSave}
      />
    </CrmLayout>
  );
};

export default Chat;
