import Icon from '@/components/ui/icon';
import ChatAvatar from '@/components/crm/chat/ChatAvatar';
import { firstName, splitLinks, timeOnly } from '@/components/crm/chat/chatShared';
import { formatDateTime } from '@/lib/dateUtils';
import type { ChatMessage } from '@/lib/chatApi';

interface ChatMessageRowProps {
  message: ChatMessage;
  mine: boolean;
  /** Продолжение реплики того же автора — фото и имя не повторяем. */
  grouped: boolean;
  /** Автор сейчас в чате. */
  online: boolean;
  /** Администратор может убрать любое сообщение, автор — только своё. */
  canHide: boolean;
  onHide: () => void;
  onRetry: () => void;
  /** Нажатие на своё фото — сменить его. */
  onAvatarClick?: () => void;
}

/** Текст сообщения: ссылки делаем кликабельными, остальное оставляем как есть. */
const MessageText = ({ text, mine }: { text: string; mine: boolean }) => (
  <>
    {splitLinks(text).map((part, i) =>
      part.href ? (
        <a
          key={i}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline underline-offset-2 ${mine ? 'text-primary-foreground' : 'text-primary'}`}
        >
          {part.text}
        </a>
      ) : (
        <span key={i}>{part.text}</span>
      ),
    )}
  </>
);

/**
 * Одно сообщение в ленте.
 *
 * Свои сообщения справа, чужие слева — так с одного взгляда видно, где твоя
 * реплика, не вчитываясь в подписи. Время и признак доставки стоят внутри пузыря:
 * вынесенные наружу, они сдвигали текст и рвали ровный край ленты.
 */
const ChatMessageRow = ({
  message,
  mine,
  grouped,
  online,
  canHide,
  onHide,
  onRetry,
  onAvatarClick,
}: ChatMessageRowProps) => {
  const failed = message.status === 'failed';
  const sending = message.status === 'sending';

  return (
    <div className={`group flex items-end gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
      {grouped ? (
        // Место под фото сохраняем, чтобы пузыри в одной реплике стояли ровным столбцом.
        <div className="h-9 w-9 shrink-0" />
      ) : (
        <ChatAvatar
          name={message.userName}
          url={message.avatarUrl}
          online={online}
          onClick={mine ? onAvatarClick : undefined}
          title={mine ? 'Сменить своё фото' : message.userName}
        />
      )}

      <div className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[70%] ${mine ? 'items-end' : ''}`}>
        {!grouped && !mine && (
          <span className="mb-1 px-1 text-xs font-medium text-muted-foreground">
            {firstName(message.userName)}
          </span>
        )}

        <div
          className={`relative rounded-2xl px-3 py-2 text-sm ${
            mine
              ? `bg-primary text-primary-foreground ${grouped ? 'rounded-tr-md' : ''}`
              : `bg-muted text-foreground ${grouped ? 'rounded-tl-md' : ''}`
          } ${failed ? 'ring-1 ring-destructive' : ''} ${sending ? 'opacity-70' : ''}`}
        >
          <p className="whitespace-pre-wrap break-words">
            <MessageText text={message.text} mine={mine} />
          </p>

          <div
            className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none ${
              mine ? 'text-primary-foreground/70' : 'text-muted-foreground'
            }`}
          >
            <span title={formatDateTime(message.createdAt)}>{timeOnly(message.createdAt)}</span>
            {mine && sending && <Icon name="Clock" size={11} />}
            {mine && !sending && !failed && <Icon name="Check" size={11} />}
            {failed && <Icon name="TriangleAlert" size={11} className="text-destructive" />}
          </div>
        </div>

        {failed ? (
          // Сообщение не ушло — предлагаем повторить прямо здесь. Текст сохранён,
          // набирать заново не нужно: в цехе связь проседает по нескольку раз в час.
          <div className="mt-1 flex items-center gap-2 px-1 text-xs text-destructive">
            <span>Не отправлено</span>
            <button type="button" onClick={onRetry} className="font-medium underline">
              Повторить
            </button>
            <button type="button" onClick={onHide} className="text-muted-foreground underline">
              Убрать
            </button>
          </div>
        ) : (
          canHide &&
          !sending && (
            <button
              type="button"
              onClick={onHide}
              title="Убрать сообщение"
              className="mt-1 px-1 text-muted-foreground transition hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
            >
              <Icon name="Trash2" size={12} />
            </button>
          )
        )}
      </div>
    </div>
  );
};

export default ChatMessageRow;
