import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { askAiAssistant, type AiMessage } from '@/lib/aiAssistantApi';

/** Готовые вопросы — с них проще начать, чем с пустого поля. */
const EXAMPLES = [
  'Сколько заказов сейчас в работе и на раскрое?',
  'Какие рулоны в цехе заканчиваются?',
  'Кто сегодня на смене?',
  'Сколько вещей лежит на складе и сколько из них в подборе?',
  'Сколько возвратов приехало за последнюю неделю?',
];

/**
 * Помощник по системе — задаёшь вопрос словами, получаешь ответ по своим данным.
 *
 * ЗАЧЕМ. Цифры о работе фабрики разбросаны по десяткам страниц: чтобы узнать,
 * сколько заказов висит в раскрое или какие рулоны заканчиваются, надо знать,
 * куда идти. Здесь достаточно спросить обычными словами.
 *
 * ВАЖНО. Помощник только СМОТРИТ данные и ничего не меняет: изменения делаются
 * в своих разделах, руками и осознанно. Раздел открыт только администраторам —
 * помощник видит зарплаты и выручку.
 */
const AiAssistant = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Держим последнее сообщение на виду: длинная переписка иначе уезжает вверх.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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

  if (!isAdmin) {
    return (
      <CrmLayout>
        <div className="mx-auto max-w-md py-16 text-center">
          <Icon name="Lock" size={32} className="mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-lg font-bold">Раздел доступен только администраторам</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Помощник показывает финансовые данные и сведения о сотрудниках.
          </p>
        </div>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
        <div className="mb-3 shrink-0">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Icon name="Sparkles" size={20} className="text-primary" />
            Помощник по системе
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Спросите про заказы, склад, смены или деньги — ответ соберётся по вашим
            данным. Помощник только смотрит и ничего не меняет.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
          {messages.length === 0 && !loading && (
            <div className="py-6">
              <p className="mb-3 text-center text-sm text-muted-foreground">
                С чего начнём?
              </p>
              <div className="mx-auto flex max-w-lg flex-col gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => send(ex)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:text-primary"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed ${
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
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                <Icon name="Loader2" size={14} className="animate-spin" />
                Смотрю данные...
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="mt-3 shrink-0">
          <div className="flex items-end gap-2">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                // Enter отправляет, Shift+Enter — перенос строки: так привычнее
                // в переписке, а длинный вопрос всё равно можно набрать.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(question);
                }
              }}
              placeholder="Спросите что-нибудь про работу фабрики..."
              rows={2}
              className="min-h-[52px] resize-none bg-background"
            />
            <Button
              onClick={() => send(question)}
              disabled={loading || !question.trim()}
              className="h-[52px] shrink-0 px-4"
            >
              {loading ? (
                <Icon name="Loader2" size={18} className="animate-spin" />
              ) : (
                <Icon name="Send" size={18} />
              )}
            </Button>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Начать новый разговор
            </button>
          )}
        </div>
      </div>
    </CrmLayout>
  );
};

export default AiAssistant;
