import { useRef } from 'react';
import Icon from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import { CHAT_FILE_ACCEPT } from '@/lib/aiAssistantApi';

interface ChatComposerProps {
  pendingFiles: { name: string }[];
  removePending: (name: string, index: number) => void;
  takeFiles: (list: FileList | File[] | null) => void;
  question: string;
  setQuestion: (v: string) => void;
  send: (text: string) => void;
  placeholder: string;
  busy: boolean;
}

/** Поле ввода: вложения, скрепка, текст вопроса и кнопка отправки. */
const ChatComposer = ({
  pendingFiles,
  removePending,
  takeFiles,
  question,
  setQuestion,
  send,
  placeholder,
  busy,
}: ChatComposerProps) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
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
  );
};

export default ChatComposer;
