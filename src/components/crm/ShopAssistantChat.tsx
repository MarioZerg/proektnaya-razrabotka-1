import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import { useMarketplaceAssistant } from '@/hooks/useMarketplaceAssistant';
import { Bubble, Thinking, dayLabel, sameDay } from '@/components/crm/aiChat/ChatBubbles';
import NotesStrip from '@/components/crm/aiChat/NotesStrip';
import ShopChatGreeting from '@/components/crm/aiChat/ShopChatGreeting';

/** Окно переписки с МЕГАМАГ. */
const ShopAssistantChat = ({ fill }: { fill?: boolean }) => {
  const {
    agentName,
    youName,
    placeholder,
    stages,
    messages,
    typing,
    question,
    setQuestion,
    loading,
    busy,
    error,
    hydrated,
    notes,
    bottomRef,
    send,
    reset,
    saveNote,
    removeNote,
  } = useMarketplaceAssistant();
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [greetingOpen, setGreetingOpen] = useState(false);

  const empty = hydrated && !messages.some((m) => m.role === 'user') && !loading && typing === null;

  const pairAt = (i: number) => {
    const m = messages[i];
    if (!m) return { question: '', answer: '' };
    if (m.role === 'user') {
      const next = messages.slice(i + 1).find((x) => x.role === 'assistant');
      return { question: m.content, answer: next?.content || '' };
    }
    const prev = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user');
    return { question: prev?.content || '', answer: m.content };
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-50/50 via-transparent to-transparent">
      {fill && messages.length > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 px-3 py-1.5">
          <p className="text-[11px] text-muted-foreground">История сохраняется на этом компьютере</p>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon name="RotateCcw" size={13} />
            Новый разговор
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-scroll overscroll-contain p-3">
        {empty && (
          <ShopChatGreeting
            agentName={agentName}
            youName={youName}
            greetingOpen={greetingOpen}
            setGreetingOpen={setGreetingOpen}
          />
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = m.at && (!prev?.at || !sameDay(prev.at, m.at));
          return (
            <div key={`${m.at || i}-${i}`}>
              {showDay && (
                <div className="mb-3 mt-1 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{dayLabel(m.at)}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <Bubble
                m={m}
                youName={youName}
                agentName={agentName}
                isAccountant={false}
                kind="shop"
                canSave={fill && m.role === 'assistant'}
                saved={notes.some((n) => n.question === pairAt(i).question)}
                onSave={() => {
                  const pair = pairAt(i);
                  if (pair.question) saveNote(pair.question, pair.answer);
                }}
              />
            </div>
          );
        })}

        {loading && <Thinking stages={stages} isAccountant={false} kind="shop" />}

        {typing !== null && (
          <Bubble
            m={{ role: 'assistant', content: typing || ' ' }}
            youName={youName}
            agentName={agentName}
            isAccountant={false}
            kind="shop"
            live
          />
        )}

        {error && (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-snug text-destructive">
              {error}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border bg-background/80 p-2 backdrop-blur-sm">
        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!busy && question.trim()) void send(question);
              }
            }}
            placeholder={placeholder}
            disabled={busy}
            rows={1}
            className="min-h-[40px] max-h-32 resize-none"
          />
          <button
            type="button"
            disabled={busy || !question.trim()}
            onClick={() => send(question)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-600 text-white disabled:opacity-40"
            aria-label="Отправить"
          >
            <Icon name="Send" size={16} />
          </button>
        </div>
      </div>

      {fill ? (
        <NotesStrip
          notes={notes}
          openId={openNoteId}
          onToggle={(id) => setOpenNoteId((cur) => (cur === id ? null : id))}
          onAsk={(q) => send(q)}
          onRemove={removeNote}
        />
      ) : null}
    </div>
  );
};

export default ShopAssistantChat;
