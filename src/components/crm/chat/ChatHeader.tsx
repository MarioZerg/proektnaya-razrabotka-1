import Icon from '@/components/ui/icon';
import ChatAvatar from '@/components/crm/chat/ChatAvatar';
import { firstName, onlineText } from '@/components/crm/chat/chatShared';
import type { ChatMe, ChatPresenceUser } from '@/lib/chatApi';

interface ChatHeaderProps {
  /** Кто сейчас в чате, кроме себя. */
  online: ChatPresenceUser[];
  /** Связи с сервером нет — лента могла отстать. */
  offline: boolean;
  me: ChatMe | null;
  myName: string;
  onAvatarClick: () => void;
}

/** Сколько лиц показываем в шапке. Дальше — «+3»: иначе строка расползается. */
const FACES = 4;

/**
 * Шапка чата: кто на связи и своё фото.
 *
 * Раньше здесь висела статичная подпись про «общую переписку цехов». Человек,
 * написавший вопрос, не понимал главного: есть ли вообще кто-то у планшета —
 * ждать ответ или идти в цех ногами. Теперь видно лица тех, кто в чате.
 */
const ChatHeader = ({ online, offline, me, myName, onAvatarClick }: ChatHeaderProps) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-xl font-bold">Чат сотрудников</h1>
      <div className="mt-1 flex min-h-[24px] flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {offline ? (
          <span className="flex items-center gap-1.5 text-amber-600">
            <Icon name="TriangleAlert" size={14} />
            Нет связи — сообщения появятся, как только она вернётся
          </span>
        ) : online.length ? (
          <>
            <span className="flex -space-x-2">
              {online.slice(0, FACES).map((p) => (
                <ChatAvatar key={p.userId} name={p.userName} url={p.avatarUrl} />
              ))}
            </span>
            <span className="truncate">
              {online.length <= FACES
                ? online.map((p) => firstName(p.userName)).join(', ')
                : onlineText(online.length)}
            </span>
          </>
        ) : (
          <span>Пока в чате никого — сообщение увидят, когда откроют</span>
        )}
      </div>
    </div>

    {/* Своё фото — на видном месте: чтобы поставить его, не нужно ни искать
        настройки, ни просить администратора. */}
    <button
      type="button"
      onClick={onAvatarClick}
      className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left transition hover:bg-accent"
      title="Сменить своё фото"
    >
      <span className="relative">
        <ChatAvatar name={myName} url={me?.avatarUrl} />
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icon name="Camera" size={10} />
        </span>
      </span>
      <span className="hidden text-xs leading-tight sm:block">
        <span className="block font-medium">Ваше фото</span>
        <span className="block text-muted-foreground">
          {me?.avatarUrl ? 'сменить' : 'поставить'}
        </span>
      </span>
    </button>
  </div>
);

export default ChatHeader;
