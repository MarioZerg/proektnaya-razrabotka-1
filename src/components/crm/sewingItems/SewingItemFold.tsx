import { useState, type ReactNode } from 'react';
import Icon from '@/components/ui/icon';

interface SewingItemFoldProps {
  title: string;
  hint?: string;
  children: ReactNode;
}

/** Справка в карточке товара: свёрнута, пока человек сам не откроет. */
const SewingItemFold = ({ title, hint, children }: SewingItemFoldProps) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
      >
        <span className="font-semibold">{title}</span>
        {hint && !open && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>
        )}
        <Icon
          name="ChevronDown"
          size={16}
          className={`ml-auto shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
};

export default SewingItemFold;
