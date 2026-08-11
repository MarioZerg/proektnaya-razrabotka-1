import Icon from '@/components/ui/icon';

interface WorkTileProps {
  icon: string;
  title: string;
  /** Короткое пояснение: что именно попадает в этот счётчик. */
  hint: string;
  count: number;
  onClick: () => void;
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
const WorkTile = ({ icon, title, hint, count, onClick }: WorkTileProps) => {
  const active = count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg border p-4 text-left transition ${
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
};

export default WorkTile;
