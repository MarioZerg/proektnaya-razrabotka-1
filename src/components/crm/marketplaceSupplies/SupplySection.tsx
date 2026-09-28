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
      <CollapsibleTrigger className="flex w-full items-start gap-2 px-3 py-3 text-left hover:bg-muted/50 sm:items-center sm:gap-3 sm:px-4">
        <Icon
          name="ChevronRight"
          size={16}
          className={`mt-0.5 shrink-0 text-muted-foreground transition-transform sm:mt-0 ${
            open ? 'rotate-90' : ''
          }`}
        />
        <div className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug">{title}</span>
          {summary && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground sm:hidden">
              {summary}
            </div>
          )}
        </div>
        {summary && (
          <div className="hidden shrink-0 items-center gap-2 text-sm text-muted-foreground sm:flex">
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
