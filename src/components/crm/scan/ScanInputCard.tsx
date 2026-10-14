import type { MouseEvent, ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

interface ScanInputCardProps {
  title: string;
  hint?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
  /** Крупнее текст — терминал / работа стоя. */
  touch?: boolean;
  className?: string;
  onBackgroundClick?: (e: MouseEvent) => void;
}

/**
 * Единая CRM-оболочка сканера: светлая primary-полоска, иконка, поле ввода внутри.
 * Все экраны склада/поставок с видимым полем скана должны выглядеть так.
 */
const ScanInputCard = ({
  title,
  hint,
  headerRight,
  children,
  touch = false,
  className,
  onBackgroundClick,
}: ScanInputCardProps) => (
  <Card className={cn('border-primary/30 bg-primary/5 shadow-none', className)}>
    <CardContent
      className={cn('space-y-2 pt-6', touch && 'space-y-3')}
      onClick={onBackgroundClick}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className={cn(
            'flex min-w-0 items-center gap-2 font-medium text-foreground',
            touch ? 'text-xl' : 'text-sm',
          )}
        >
          <Icon name="ScanLine" size={touch ? 24 : 18} className="shrink-0" />
          <span className="min-w-0">{title}</span>
        </div>
        {headerRight}
      </div>
      {hint ? (
        <p className={cn('text-muted-foreground', touch ? 'text-base' : 'text-xs')}>{hint}</p>
      ) : null}
      {children}
    </CardContent>
  </Card>
);

export default ScanInputCard;
