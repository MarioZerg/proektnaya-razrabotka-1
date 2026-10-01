import Icon from '@/components/ui/icon';
import type { AiNote } from '@/lib/aiAssistantApi';
import { formatNoteDate } from '@/components/crm/aiChat/ChatBubbles';

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

export default NotesStrip;
