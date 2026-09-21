import { useState, type ReactNode } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import Icon from '@/components/ui/icon';

interface SupplySectionProps {
  /** Заголовок плашки — по нему же и кликают, чтобы развернуть. */
  title: string;
  /** Короткая сводка справа от заголовка: видна в свёрнутом виде. */
  summary?: ReactNode;
  /** Развернуть сразу при открытии карточки. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Сворачиваемая плашка в карточке поставки.
 *
 * КАРТОЧКА FBO ПЕРЕСТАЛА ПОМЕЩАТЬСЯ НА ЭКРАН. Данные заявки, транспортная
 * накладная и список пошива — это три длинных блока подряд, и до товарного
 * состава, ради которого карточку и открывают, приходилось прокручивать
 * несколько экранов. При этом заглядывают в них редко: накладную заполняют
 * один раз, пошив смотрит менеджер раз в день.
 *
 * Поэтому по умолчанию они свёрнуты, а в заголовке остаётся сводка — статус
 * накладной, счётчик сшитого. Так видно главное, не открывая блок.
 */
const SupplySection = ({
  title,
  summary,
  defaultOpen = false,
  children,
}: SupplySectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name="ChevronRight"
            size={16}
            className={`shrink-0 text-muted-foreground transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          />
          <span className="font-semibold">{title}</span>
        </div>
        {summary && (
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            {summary}
          </div>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SupplySection;
