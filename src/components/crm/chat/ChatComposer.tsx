import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { MAX_MESSAGE_LENGTH } from '@/components/crm/chat/chatShared';

interface ChatComposerProps {
  /** Отправка. Ошибку показывает страница — здесь только возвращаем текст в поле. */
  onSend: (text: string) => Promise<void>;
  /** Человек нажал клавишу: сообщаем собеседникам «печатает». */
  onTyping: () => void;
  disabled?: boolean;
}

/** До какой высоты поле растёт вместе с текстом. Дальше — прокрутка внутри поля. */
const MAX_HEIGHT = 160;

/**
 * Поле ввода сообщения.
 *
 * Поле растёт вместе с текстом: раньше оно было фиксировано в две строки, и длинное
 * сообщение приходилось писать «в щёлочку», не видя начала. Enter отправляет,
 * Shift+Enter переносит строку — привычно по всем мессенджерам.
 */
const ChatComposer = ({ onSend, onTyping, disabled }: ChatComposerProps) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Высоту пересчитываем на каждое изменение текста, в том числе после отправки:
  // иначе опустевшее поле остаётся раздутым на весь экран.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    // Полоса прокрутки нужна только длинному сообщению. Иначе она торчит в пустом
    // поле и выглядит так, будто в нём что-то не поместилось.
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [text]);

  const handleSend = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setText('');
    setSending(true);
    try {
      await onSend(value);
    } catch {
      // Отправка не удалась — сообщение осталось в ленте помеченным как
      // недоставленное, оттуда его и повторяют. Возвращать текст в поле не нужно:
      // иначе человек отправит его второй раз и в чате появится дубль.
    } finally {
      setSending(false);
      // Возвращаем курсор в поле: разговор продолжается, и тянуться к полю
      // пальцем после каждой реплики на планшете неудобно.
      areaRef.current?.focus();
    }
  };

  const left = MAX_MESSAGE_LENGTH - text.length;

  return (
    <div className="flex items-end gap-2">
      <div className="relative flex-1">
        <Textarea
          ref={areaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, MAX_MESSAGE_LENGTH));
            onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Написать сообщение..."
          rows={1}
          className="min-h-[52px] resize-none py-3.5 pr-16"
        />
        {/* Счётчик появляется только у предела: постоянно висящее число отвлекает. */}
        {left < 200 && (
          <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground">{left}</span>
        )}
      </div>
      <Button
        size="lg"
        className="h-[52px] shrink-0"
        onClick={handleSend}
        disabled={disabled || sending || !text.trim()}
        title="Отправить (Enter)"
      >
        <Icon
          name={sending ? 'Loader2' : 'Send'}
          size={18}
          className={sending ? 'animate-spin' : ''}
        />
      </Button>
    </div>
  );
};

export default ChatComposer;
