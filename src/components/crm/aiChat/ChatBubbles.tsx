import Icon from '@/components/ui/icon';
import MegabuhAvatar from '@/components/crm/MegabuhAvatar';
import MegamagAvatar from '@/components/crm/MegamagAvatar';
import type { AiMessage, AiMessageFile } from '@/lib/aiAssistantApi';

export const formatNoteDate = (at: number) =>
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

export const sameDay = (a?: number, b?: number) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

export const dayLabel = (at?: number) => {
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

export const AgentFace = ({
  isAccountant,
  kind,
  size,
}: {
  isAccountant?: boolean;
  kind?: 'accountant' | 'shop';
  size: number;
}) => {
  const mode = kind || (isAccountant ? 'accountant' : 'generic');
  if (mode === 'accountant') return <MegabuhAvatar size={size} />;
  if (mode === 'shop') return <MegamagAvatar size={size} />;
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-600 to-slate-800 text-white shadow-sm"
      style={{ width: size, height: size }}
    >
      <Icon name="Sparkles" size={Math.round(size * 0.44)} />
    </div>
  );
};

export const Bubble = ({
  m,
  youName,
  agentName,
  isAccountant,
  kind,
  live,
  canSave,
  saved,
  onSave,
}: {
  m: AiMessage;
  youName: string;
  agentName: string;
  isAccountant: boolean;
  kind?: 'accountant' | 'shop';
  live?: boolean;
  canSave?: boolean;
  saved?: boolean;
  onSave?: () => void;
}) => {
  const mine = m.role === 'user';
  const initial = (youName || '?').slice(0, 1).toUpperCase();
  const face = kind || (isAccountant ? 'accountant' : undefined);

  return (
    <div className={`flex w-full items-start gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <div className="mt-4"><AgentFace isAccountant={isAccountant} kind={face} size={32} /></div>}
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

export const Thinking = ({
  stages,
  isAccountant,
  kind,
  compact,
}: {
  stages: string[];
  isAccountant: boolean;
  kind?: 'accountant' | 'shop';
  /** Только текущий статус поиска — без списка «рассуждений». */
  compact?: boolean;
}) => {
  const current = stages[stages.length - 1] || 'Думаю...';
  const face = kind || (isAccountant ? 'accountant' : undefined);
  const spin = kind === 'shop' ? 'text-amber-700' : 'text-teal-700';
  const linkClass = kind === 'shop'
    ? 'break-all font-semibold text-amber-800 underline underline-offset-2'
    : 'break-all font-semibold text-teal-800 underline underline-offset-2';
  const dot = kind === 'shop' ? 'bg-amber-600' : 'bg-teal-600';

  const formatStatus = (text: string) => {
    const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
    return parts.map((p, i) =>
      /^https?:\/\//.test(p) ? (
        <span key={i} className={linkClass}>{p}</span>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };

  return (
    <div className="flex gap-2 animate-in fade-in duration-200">
      <AgentFace isAccountant={isAccountant} kind={face} size={32} />
      <div className="min-w-0 max-w-[86%] rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2.5 shadow-sm">
        <div className={`flex items-start gap-2 ${compact ? '' : 'mb-2'}`}>
          <Icon name="Loader2" size={14} className={`mt-0.5 shrink-0 animate-spin ${spin}`} />
          <span className="min-w-0 text-[13px] font-medium leading-snug text-foreground">
            {formatStatus(current)}
          </span>
          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot} animate-bounce [animation-delay:-0.3s]`} />
            <span className={`h-1.5 w-1.5 rounded-full ${dot} animate-bounce [animation-delay:-0.15s]`} />
            <span className={`h-1.5 w-1.5 rounded-full ${dot} animate-bounce`} />
          </span>
        </div>
        {!compact ? (
          <ul className="space-y-1">
            {stages.map((s, i) => {
              const last = i === stages.length - 1;
              return (
                <li
                  key={`${s}-${i}`}
                  className={`flex items-start gap-2 text-[12px] ${last ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {last ? (
                    <Icon name="Loader2" size={12} className={`mt-0.5 shrink-0 animate-spin ${spin}`} />
                  ) : (
                    <Icon name="Check" size={12} className={`mt-0.5 shrink-0 ${spin}`} />
                  )}
                  <span className="min-w-0">{formatStatus(s)}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
};
