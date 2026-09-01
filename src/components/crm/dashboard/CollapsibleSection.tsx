import { useEffect, useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import Icon from '@/components/ui/icon';

interface CollapsibleSectionProps {
  /** Ключ для памяти состояния: у каждого блока свой, иначе они схлопнутся вместе. */
  storageKey: string;
  title: string;
  /** Пояснение под заголовком — что внутри, пока блок свёрнут. */
  hint?: string;
  icon: string;
  /** Свёрнут ли блок при первом заходе, пока человек сам ничего не нажимал. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Сворачиваемый блок панели администратора.
 *
 * Зачем. На панели у админа блоков много, и тяжёлые аналитические — выработка,
 * эффективность, лототрон — занимают несколько экранов. Каждый день они не
 * нужны: в них заходят, когда считают премию или разбирают спорную ситуацию.
 * Всё остальное время из-за них приходится листать панель, чтобы добраться до
 * рабочих цифр по цеху.
 *
 * Свёрнутый блок оставляет одну строку-заголовок: видно, что раздел есть, но
 * место он не занимает. Состояние запоминается в браузере — если админ
 * развернул выработку, завтра она откроется развёрнутой, и наоборот.
 */
const CollapsibleSection = ({
  storageKey,
  title,
  hint,
  icon,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) => {
  const key = `dash-section:${storageKey}`;
  const [open, setOpen] = useState(() => {
    // localStorage может быть недоступен (приватный режим, встроенный браузер) —
    // тогда просто работаем без памяти, а не роняем всю панель.
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, open ? '1' : '0');
    } catch {
      /* память недоступна — состояние живёт до перезагрузки страницы */
    }
  }, [key, open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon name={icon} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
        <Icon
          name="ChevronDown"
          size={18}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
};

export default CollapsibleSection;
