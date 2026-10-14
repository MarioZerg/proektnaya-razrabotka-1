import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

interface ScanPromptHeroProps {
  title: string;
  subtitle?: string;
  /** Крутится вместо иконки скана. */
  loading?: boolean;
  footer?: ReactNode;
  className?: string;
}

/**
 * Крупное приглашение «поднесите сканер» для терминала и цеха.
 * Без видимого поля ввода — HID-сканер пишет в скрытый input снаружи.
 */
const ScanPromptHero = ({
  title,
  subtitle,
  loading = false,
  footer,
  className,
}: ScanPromptHeroProps) => (
  <Card
    className={cn(
      'border-2 border-dashed border-primary/40 bg-primary/5 shadow-none',
      className,
    )}
  >
    <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="rounded-full bg-primary/10 p-6">
        <Icon
          name={loading ? 'Loader2' : 'ScanLine'}
          size={80}
          className={cn('text-primary', loading && 'animate-spin')}
        />
      </div>
      <div>
        <p className="text-4xl font-bold">{title}</p>
        {subtitle ? (
          <p className="mt-2 text-2xl text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {footer}
    </CardContent>
  </Card>
);

export default ScanPromptHero;
