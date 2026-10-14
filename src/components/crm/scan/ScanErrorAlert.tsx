import type { ReactNode } from 'react';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

interface ScanErrorAlertProps {
  children: ReactNode;
  /** Крупнее — терминал. */
  touch?: boolean;
  className?: string;
}

/** Ошибка скана: одна рамка и иконка во всех экранах. */
const ScanErrorAlert = ({ children, touch = false, className }: ScanErrorAlertProps) => (
  <div
    className={cn(
      'flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-3',
      className,
    )}
  >
    <Icon
      name="TriangleAlert"
      size={touch ? 24 : 22}
      className="mt-0.5 shrink-0 text-destructive"
    />
    <div className={cn('min-w-0 font-medium text-destructive', touch ? 'text-lg' : 'text-sm')}>
      {children}
    </div>
  </div>
);

export default ScanErrorAlert;
