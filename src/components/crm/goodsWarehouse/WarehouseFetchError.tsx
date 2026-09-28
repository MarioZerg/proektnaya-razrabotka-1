import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface WarehouseFetchErrorProps {
  title: string;
  /** Что именно не пришло — чтобы не путать с «работы нет». */
  description?: string;
  onRetry: () => void;
}

/**
 * FRONTEND-ONLY: экран ошибки загрузки.
 *
 * POEHALI: новых полей и action нет. Баннер рисуется, когда уже существующий
 * GET склада / полок / очередей не ответил. Раньше сбой глотался, плитки
 * показывали 0, и кладовщик думал, что работы нет.
 */
const WarehouseFetchError = ({ title, description, onRetry }: WarehouseFetchErrorProps) => (
  <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <Icon name="AlertTriangle" size={20} className="mt-0.5 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="font-semibold leading-snug text-destructive">{title}</p>
        {description ? (
          <p className="mt-0.5 break-words text-sm leading-snug text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
    <Button type="button" variant="outline" size="sm" className="self-start sm:self-auto" onClick={onRetry}>
      <Icon name="RefreshCw" size={14} className="mr-1.5" />
      Повторить
    </Button>
  </div>
);

export default WarehouseFetchError;
