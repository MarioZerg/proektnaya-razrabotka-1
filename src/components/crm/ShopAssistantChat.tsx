import { useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useMarketplaceAssistant } from '@/hooks/useMarketplaceAssistant';
import { Bubble, Thinking, dayLabel, sameDay } from '@/components/crm/aiChat/ChatBubbles';
import NotesStrip from '@/components/crm/aiChat/NotesStrip';
import ChatComposer from '@/components/crm/aiChat/ChatComposer';
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
    canAsk,
    error,
    notes,
    pendingFiles,
    bottomRef,
    send,
    addFiles,
    removePending,
    reset,
    saveNote,
    removeNote,
  } = useMarketplaceAssistant();
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const empty = messages.length === 0 && !loading && typing === null;

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

  const takeFiles = (list: FileList | File[] | null) => {
    if (!list || busy || !canAsk) return;
    const files = Array.from(list);
    if (files.length) void addFiles(files);
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-50/50 via-transparent to-transparent"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        takeFiles(e.dataTransfer.files);
      }}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-amber-700 bg-background/80">
          <p className="px-4 text-center text-sm font-medium text-amber-900">
            Отпустите файл — разберу выгрузку с маркетплейса
          </p>
        </div>
      ) : null}
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

        {loading && <Thinking stages={stages} isAccountant={false} kind="shop" compact />}

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

      <ChatComposer
        pendingFiles={pendingFiles}
        removePending={removePending}
        takeFiles={takeFiles}
        question={question}
        setQuestion={setQuestion}
        send={send}
        placeholder={placeholder}
        busy={busy}
        canAsk={canAsk}
        tone="shop"
      />

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
