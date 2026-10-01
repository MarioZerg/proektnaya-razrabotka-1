import Icon from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import MegabuhAvatar from '@/components/crm/MegabuhAvatar';
import { useAiAssistant } from '@/hooks/useAiAssistant.ts';
import { useRef, useState } from 'react';
import { CHAT_FILE_ACCEPT } from '@/lib/aiAssistantApi';
import type { AiMessage, AiMessageFile, AiNote } from '@/lib/aiAssistantApi';

const formatNoteDate = (at: number) =>
  new Date(at).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatTime = (at?: number) => {
  if (!at) return '';
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

const sameDay = (a?: number, b?: number) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

const dayLabel = (at?: number) => {
  if (!at) return '';
  const d = new Date(at);
  const today = new Date();
  const yday = new Date();
  yday.setDate(today.getDate() - 1);
  if (sameDay(at, today.getTime())) return 'Сегодня';
  if (sameDay(at, yday.getTime())) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

const formatContent = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s<>"'）)]+)/g);
  return parts.map((p, i) => {
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    if (/^https?:\/\//.test(p)) {
      return (
        <a
          key={i}
          href={p}
          target="_blank"
          rel="noreferrer"
          className="break-all text-teal-800 underline underline-offset-2"
        >
          {p}
        </a>
      );
    }
    return p;
  });
};

const AgentFace = ({ isAccountant, size }: { isAccountant: boolean; size: number }) =>
  isAccountant ? (
    <MegabuhAvatar size={size} />
  ) : (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-600 to-slate-800 text-white shadow-sm"
      style={{ width: size, height: size }}
    >
      <Icon name="Sparkles" size={Math.round(size * 0.44)} />
    </div>
  );

const Bubble = ({
  m,
  youName,
  agentName,
  isAccountant,
  live,
  canSave,
  saved,
  onSave,
}: {
  m: AiMessage;
  youName: string;
  agentName: string;
  isAccountant: boolean;
  live?: boolean;
  canSave?: boolean;
  saved?: boolean;
  onSave?: () => void;
}) => {
  const mine = m.role === 'user';
  const initial = (youName || '?').slice(0, 1).toUpperCase();

  return (
    <div className={`flex w-full items-start gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <div className="mt-4"><AgentFace isAccountant={isAccountant} size={32} /></div>}
      <div className="flex min-w-0 max-w-[78%] flex-col gap-0.5">
        <div className={`flex items-baseline gap-1.5 px-0.5 ${mine ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[11px] font-medium text-muted-foreground">
            {mine ? youName || 'Вы' : agentName}
          </span>
          {!live && m.at ? (
            <span className="text-[10px] text-muted-foreground/70">{formatTime(m.at)}</span>
          ) : null}
          {!mine && m.kind === 'news' ? (
            <span className="text-[10px] text-teal-800">сводка</span>
          ) : null}
          {live ? <span className="text-[10px] text-teal-800">печатает</span> : null}
          {canSave && onSave ? (
            <button
              type="button"
              onClick={onSave}
              title={saved ? 'Уже в заметках' : 'Сохранить в заметки'}
              className={`rounded p-0.5 ${
                saved
                  ? 'text-teal-700'
                  : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon name="Bookmark" size={12} />
            </button>
          ) : null}
        </div>
        <div
          className={`break-words whitespace-pre-wrap px-3 py-2 text-[13px] leading-relaxed shadow-sm ${
            mine
              ? 'rounded-2xl rounded-br-md bg-slate-800 text-white'
              : m.kind === 'news'
                ? 'rounded-2xl rounded-bl-md border border-teal-700/25 bg-teal-50/60'
                : 'rounded-2xl rounded-bl-md border border-border bg-background'
          }`}
        >
          {m.content ? formatContent(m.content) : null}
          {m.files && m.files.length > 0 ? (
            <ul className={`mt-2 space-y-1 ${mine ? 'text-white/90' : 'text-muted-foreground'}`}>
              {m.files.map((f: AiMessageFile) => (
                <li key={f.name} className="flex items-center gap-1.5 text-[12px]">
                  <Icon name="FileText" size={13} className="shrink-0" />
                  <span className="min-w-0 truncate">{f.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {live ? (
            <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-0.5 bg-foreground animate-pulse" />
          ) : null}
        </div>
      </div>
      {mine && (
        <div className="mt-4 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[12px] font-semibold text-white">
          {initial}
        </div>
      )}
    </div>
  );
};

const Thinking = ({ stages, isAccountant }: { stages: string[]; isAccountant: boolean }) => {
  const current = stages[stages.length - 1] || 'Думаю...';
  return (
    <div className="flex gap-2 animate-in fade-in duration-200">
      <AgentFace isAccountant={isAccountant} size={32} />
      <div className="min-w-0 max-w-[86%] rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2.5 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="Loader2" size={14} className="shrink-0 animate-spin text-teal-700" />
          <span className="text-[13px] font-medium text-foreground">{current}</span>
          <span className="inline-flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce" />
          </span>
        </div>
        <ul className="space-y-1">
          {stages.map((s, i) => {
            const last = i === stages.length - 1;
            return (
              <li
                key={`${s}-${i}`}
                className={`flex items-center gap-2 text-[12px] ${last ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {last ? (
                  <Icon name="Loader2" size={12} className="shrink-0 animate-spin text-teal-700" />
                ) : (
                  <Icon name="Check" size={12} className="shrink-0 text-teal-700" />
                )}
                {s}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

const NotesStrip = ({
  notes,
  openId,
  onToggle,
  onAsk,
  onRemove,
}: {
  notes: AiNote[];
  openId: string | null;
  onToggle: (id: string) => void;
  onAsk: (question: string) => void;
  onRemove: (id: string) => void;
}) => {
  if (notes.length === 0) return null;
  return (
    <div className="shrink-0 border-t border-border bg-muted/20 px-2 py-2">
      <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">
        Заметки — остаются после очистки чата
      </p>
      <div className="max-h-40 space-y-1.5 overflow-x-hidden overflow-y-auto overscroll-contain">
        {notes.map((n) => {
          const open = openId === n.id;
          return (
            <div
              key={n.id}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onToggle(n.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="text-[10px] text-muted-foreground">{formatNoteDate(n.savedAt)}</span>
                  <p className={`text-[13px] leading-snug ${open ? '' : 'line-clamp-2'}`}>{n.question}</p>
                </button>
                <button
                  type="button"
                  title="Спросить снова"
                  onClick={() => onAsk(n.question)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon name="Send" size={13} />
                </button>
                <button
                  type="button"
                  title="Убрать заметку"
                  onClick={() => onRemove(n.id)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon name="X" size={13} />
                </button>
              </div>
              {open && n.answer ? (
                <p className="mt-1.5 whitespace-pre-wrap border-t border-border/60 pt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  {n.answer}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Окно переписки с МЕГАБУХ: список сообщений и поле ввода.
 */
const AiAssistantChat = ({ fill }: { fill?: boolean }) => {
  const {
    isAccountant,
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
    pendingFiles,
    bottomRef,
    send,
    addFiles,
    removePending,
    reset,
    saveNote,
    removeNote,
  } = useAiAssistant();
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

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

  const takeFiles = (list: FileList | File[] | null) => {
    if (!list || busy) return;
    const files = Array.from(list);
    if (files.length) void addFiles(files);
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-50/40 via-transparent to-transparent"
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
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-teal-700 bg-background/80">
          <p className="px-4 text-center text-sm font-medium text-teal-800">
            Отпустите файл — прочитаю документ
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
          <div className="flex w-full items-start justify-start gap-2">
            <div className="mt-4">
              <AgentFace isAccountant size={32} />
            </div>
            <div className="flex min-w-0 max-w-[92%] flex-col gap-0.5 sm:max-w-[86%]">
              <div className="flex items-baseline gap-1.5 px-0.5">
                <span className="text-[11px] font-medium text-muted-foreground">{agentName}</span>
              </div>
              <button
                type="button"
                onClick={() => setGreetingOpen((v) => !v)}
                aria-expanded={greetingOpen}
                title={greetingOpen ? 'Свернуть' : 'Нажмите, чтобы прочитать'}
                className={`rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2.5 text-left text-[13px] leading-relaxed shadow-sm transition-shadow hover:shadow-md ${
                  greetingOpen ? '' : 'animate-megabuh-bob'
                }`}
              >
                <p className={greetingOpen ? undefined : 'line-clamp-2'}>
                  {youName ? `${youName}, это МЕГАБУХ.` : 'Это МЕГАБУХ.'} Пишите обычным языком — сверюсь
                  с НК РФ, 402-ФЗ, ПБУ/ФСБУ, приказами Минфина и разъяснениями ФНС.
                </p>
                <span className="mt-2 flex items-center gap-1 text-[11px] text-teal-800">
                  <Icon
                    name="ChevronDown"
                    size={14}
                    className={`transition-transform duration-300 ${greetingOpen ? 'rotate-180' : ''}`}
                  />
                  {greetingOpen ? 'Свернуть' : 'Нажмите, чтобы прочитать'}
                </span>
                {greetingOpen ? (
                  <div className="mt-2">
                    <p className="font-medium">Что могу найти:</p>
                    <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
                      <li>
                        <strong>Бухучёт</strong> — УСН, НДС, взносы, НДФЛ, касса, первичная, ЭДО, договоры.
                      </li>
                      <li>
                        <strong>Кадры для бухгалтерии</strong> — приём, отпуск, больничный, трудовой / ГПХ /
                        самозанятый, ЕФС-1, РСВ, 6-НДФЛ.
                      </li>
                      <li>
                        <strong>1С:Бухгалтерия 8.3</strong> (ред. 3.0, ПРОФ / КОРП / Фреш) и ЗУП — какой раздел
                        открыть, как заполнить и отправить отчёт.
                      </li>
                      <li>
                        <strong>СБИС, Диадок, Экстерн</strong> — УПД, подпись, роуминг, требование ФНС.
                      </li>
                      <li>
                        <strong>Банк Точка</strong> — выписка в 1С, ДиректБанк, доступ бухгалтеру, тарифы, эквайринг,
                        зарплатный проект.
                      </li>
                      <li>
                        <strong>Маркетплейсы</strong> — закрывающие OZON, WB, Яндекс Маркет, комиссии, налог с
                        продаж.
                      </li>
                    </ul>
                    <p className="mt-2 font-medium">Как отвечаю:</p>
                    <p className="mt-1">
                      Суть → норма (статья / ПБУ) → проводки Дт/Кт → расчёт → первичка → сроки. Если закон
                      изменился после даты сверки, в основном ответе беру только нормы до этой даты, а
                      новшества пишу отдельно предупреждением.
                    </p>
                    <p className="mt-2 font-medium">Что спрашивать:</p>
                    <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
                      <li>
                        <strong>Разнести выписку</strong> — приложите файл: по каждой строке вид, контрагент,
                        основание, категория, проводка Дт/Кт, первичка.
                      </li>
                      <li>
                        <strong>Посчитать НДС</strong> — реализация, авансы, покупки, возвраты: формула, статьи
                        НК, итог к уплате.
                      </li>
                      <li>
                        <strong>Сверить отчётность</strong> — декларация НДС и ОСВ по 19, 60, 62, 90: расхождения
                        и что запросить.
                      </li>
                    </ul>
                    <p className="mt-2">
                      Справочник контрагентов, номенклатуру и учётную политику тоже можно вложить — иначе
                      счета не выдумываю. Спорное (взаимозачёт, цессия, курсовые, ошибки прошлых лет) не
                      закрываю сам: «требуется согласование с главным бухгалтером/аудитором».
                    </p>
                    <p className="mt-2 font-medium">Документы:</p>
                    <p className="mt-1">
                      Скрепка или перетащите PDF, Word, Excel, CSV, фото. Два файла: «сопоставь оплаты из
                      файла 1 с УПД из файла 2».
                    </p>
                  </div>
                ) : null}
              </button>
            </div>
          </div>
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
                isAccountant={isAccountant}
                canSave={fill && m.role === 'assistant' && m.kind !== 'news'}
                saved={notes.some((n) => n.question === pairAt(i).question)}
                onSave={() => {
                  const pair = pairAt(i);
                  if (pair.question) saveNote(pair.question, pair.answer);
                }}
              />
            </div>
          );
        })}

        {loading && <Thinking stages={stages} isAccountant={isAccountant} />}

        {typing !== null && (
          <Bubble
            m={{ role: 'assistant', content: typing || ' ' }}
            youName={youName}
            agentName={agentName}
            isAccountant={isAccountant}
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
        {pendingFiles.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-1 text-[11px]"
              >
                <Icon name="FileText" size={12} className="shrink-0 text-teal-800" />
                <span className="min-w-0 truncate">{f.name}</span>
                <button
                  type="button"
                  title="Убрать файл"
                  onClick={() => removePending(f.name, i)}
                  className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon name="X" size={11} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={CHAT_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            takeFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          title="Приложить документ"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Icon name="Paperclip" size={16} />
        </button>
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(question);
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              takeFiles(files);
            }
          }}
          placeholder={placeholder}
          rows={1}
          disabled={busy}
          className="max-h-24 min-h-[40px] resize-none rounded-xl bg-background text-[13px]"
        />
        <button
          type="button"
          onClick={() => send(question)}
          disabled={busy || (!question.trim() && pendingFiles.length === 0)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-700 to-slate-900 text-white shadow-sm transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
        >
          <Icon
            name={busy ? 'Loader2' : 'Send'}
            size={16}
            className={busy ? 'animate-spin' : ''}
          />
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

export default AiAssistantChat;
