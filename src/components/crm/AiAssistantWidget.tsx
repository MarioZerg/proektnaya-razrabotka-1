import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { askAiAssistant, type AiMessage } from '@/lib/aiAssistantApi';

/** Готовые вопросы — с них проще начать, чем с пустого поля. */
const EXAMPLES = [
  'Сколько заказов сейчас в работе?',
  'Кто сегодня на смене?',
  'Какие рулоны заканчиваются?',
];

/**
 * Помощник по системе — чат в углу экрана, поверх любой страницы.
 *
 * ЗАЧЕМ. Цифры о работе фабрики разбросаны по десяткам разделов: чтобы узнать,
 * сколько заказов висит в раскрое или какие рулоны заканчиваются, надо помнить,
 * куда идти. Здесь достаточно спросить обычными словами, не бросая текущую
 * работу и не уходя со страницы.
 *
 * КАК СЕБЯ ВЕДЁТ. В покое — круглая кнопка в правом нижнем углу, ничего не
 * закрывает. Нажал — раскрывается окно переписки. Разговор сохраняется, пока
 * не закроешь вкладку: можно свернуть, сделать дела и вернуться к ответу.
 *
 * ВАЖНО. Помощник только СМОТРИТ данные и ничего не меняет. Виден только
 * администратору: в ответах бывают зарплаты и выручка.
 */
const AiAssistantWidget = () => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'admin';

  // Держим последнее сообщение на виду: длинная переписка иначе уезжает вверх.
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  if (!isAdmin) return null;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading || !user?.id) return;
    setError(null);
    setQuestion('');
    const history = messages;
    setMessages([...history, { role: 'user', content: q }]);
    setLoading(true);
    try {
      const r = await askAiAssistant(q, user.id, history);
      setMessages((prev) => [...prev, { role: 'assistant', content: r.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помощник не ответил');
    } finally {
      setLoading(false);
    }
  };

  // СВЁРНУТОЕ СОСТОЯНИЕ — круглая кнопка, не мешает работать.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Помощник по системе"
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <Icon name="Sparkles" size={24} />
      </button>
    );
  }

  return (
    <div
      // На телефоне окно во всю ширину: узкая карточка в углу там нечитаема.
      className={`fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl ${
        isMobile
          ? 'inset-x-2 bottom-2 top-16'
          : 'bottom-4 right-4 h-[32rem] w-[24rem]'
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <Icon name="Sparkles" size={18} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">Помощник</span>
          <span className="block text-[11px] leading-tight text-muted-foreground">
            Спросит по вашим данным, ничего не меняет
          </span>
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            title="Начать новый разговор"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon name="RotateCcw" size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Свернуть"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Icon name="X" size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-muted/20 p-3">
        {messages.length === 0 && !loading && (
          <div className="space-y-2 py-2">
            <p className="text-center text-xs text-muted-foreground">С чего начнём?</p>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => send(ex)}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-left text-[13px] transition-colors hover:border-primary hover:text-primary"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] whitespace-pre-wrap rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-background'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-1.5 text-[13px] text-muted-foreground">
              <Icon name="Loader2" size={13} className="animate-spin" />
              Смотрю данные...
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12px] leading-snug text-destructive">
              {error}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="flex shrink-0 items-end gap-2 border-t border-border p-2">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Enter отправляет, Shift+Enter — перенос строки: привычное поведение
            // переписки, при этом длинный вопрос всё равно можно набрать.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(question);
            }
          }}
          placeholder="Спросите про заказы, склад, смены..."
          rows={1}
          className="max-h-24 min-h-[38px] resize-none bg-background text-[13px]"
        />
        <button
          type="button"
          onClick={() => send(question)}
          disabled={loading || !question.trim()}
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Icon
            name={loading ? 'Loader2' : 'Send'}
            size={16}
            className={loading ? 'animate-spin' : ''}
          />
        </button>
      </div>
    </div>
  );
};

export default AiAssistantWidget;
