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
  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
    <Icon name="AlertTriangle" size={20} className="shrink-0 text-destructive" />
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-destructive">{title}</p>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
    <Button type="button" variant="outline" size="sm" onClick={onRetry}>
      <Icon name="RefreshCw" size={14} className="mr-1.5" />
      Повторить
    </Button>
  </div>
);

export default WarehouseFetchError;
