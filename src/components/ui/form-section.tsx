import { ReactNode } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

/** Шапка сворачиваемого блока настроек — серая плашка, поля внутри белые. */
export const formSectionTriggerClass =
  'group flex min-h-11 w-full items-center gap-2 bg-muted px-3 py-3 text-left hover:bg-muted/80';

export const FormSection = ({
  title,
  hint,
  defaultOpen = false,
  children,
  className,
  contentClassName,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <Collapsible
    defaultOpen={defaultOpen}
    className={cn('min-w-0 overflow-hidden rounded-lg border border-border', className)}
  >
    <CollapsibleTrigger className={formSectionTriggerClass}>
      <Icon
        name="ChevronRight"
        size={16}
        className="shrink-0 text-foreground/60 transition-transform group-data-[state=open]:rotate-90"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug">{title}</p>
        {hint ? <p className="truncate text-sm text-muted-foreground">{hint}</p> : null}
      </div>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className={cn('min-w-0 space-y-4 bg-background px-3 py-3', contentClassName)}>
        {children}
      </div>
    </CollapsibleContent>
  </Collapsible>
);
