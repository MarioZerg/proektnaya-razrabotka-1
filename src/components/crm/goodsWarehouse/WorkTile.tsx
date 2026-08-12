import Icon from '@/components/ui/icon';

interface WorkTileProps {
  icon: string;
  title: string;
  /** Короткое пояснение: что именно попадает в этот счётчик. */
  hint: string;
  count: number;
  onClick: () => void;
  /** Подпись кнопки шага, который идёт ПЕРЕД этой плиткой (рисуется сверху со стрелкой). */
  stepLabel?: string;
  stepIcon?: string;
  onStep?: () => void;
}

/**
 * Плитка работы на складе: крупное число и понятное действие.
 *
 * Раньше все действия склада были одинаковыми кнопками в один ряд — десяток штук,
 * переносившихся на две-три строки. Кладовщик каждый раз читал их глазами, чтобы найти
 * нужную, и не видел главного: где сейчас есть работа, а где пусто.
 *
 * Здесь наоборот: если вещей ноль, плитка серая и в глаза не лезет; если работа есть —
 * подсвечивается и показывает количество крупно, видно с другого конца склада.
 */
const WorkTile = ({
  icon,
  title,
  hint,
  count,
  onClick,
  stepLabel,
  stepIcon,
  onStep,
}: WorkTileProps) => {
  const active = count > 0;

  const tile = (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition ${
        active
          ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
          : 'border-border bg-card hover:bg-muted/50'
      }`}
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-tight">{title}</p>
        <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{hint}</p>
      </div>
      <span
        className={`shrink-0 text-2xl font-bold ${
          active ? 'text-primary' : 'text-muted-foreground/50'
        }`}
      >
        {count}
      </span>
    </button>
  );

  if (!onStep) return tile;

  // Двухуровневая плитка: сверху шаг, который делают ПЕРВЫМ, снизу — куда это ведёт.
  // Стрелка показывает порядок: сначала принял привезённое, потом разбираешь его.
  // Без такой связки кладовщик видел две отдельные кнопки и не понимал, что одна
  // наполняет другую.
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onStep}
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted/50"
      >
        <Icon name={stepIcon || 'PackageOpen'} size={16} className="text-primary" />
        {stepLabel}
      </button>
      <div className="flex justify-center py-0.5">
        <Icon name="ArrowDown" size={16} className="text-muted-foreground" />
      </div>
      {tile}
    </div>
  );
};

export default WorkTile;